import { DAY_MS } from '@kiko/dates';
import { match, P } from 'ts-pattern';
import maybe, { foldMap } from 'fnts/maybe';
import { maxOf, minOf } from '@kiko/numbers';
import { settingsRepo } from '@kiko/settings';
import { logFailure } from '@kiko/diagnostics';
import either, { bifold, isLeft } from 'fnts/either';
import type { Currency } from '@kiko/currency/currency';
import type { HoldingRow, PricePointRow } from '@kiko/db';
import { type Lot, quantityAt } from '@kiko/holdings/lots';
import { asShareMeta } from '@kiko/holdings/holding-metadata';
import { shiftDecimal, compareDecimal } from '@kiko/currency/decimal';
import { holdingsRepo, type ShareQuoteCurrencyUpdate } from '@kiko/holdings/repo';

import {
  fetchEod,
  type EodClose,
  searchSymbols,
  EodhdAuthError,
  EodhdQuotaError,
  EodhdNetworkError,
  type SymbolMatch,
  EodhdNotInPlanError,
  EodhdUnavailableError,
} from '../eodhd';
import {
  reserve,
  utcDayOf,
  isBackedOff,
  currentQuota,
  type QuoteQuota,
  type SymbolLots,
  keyGenerationOf,
  refreshAllowance,
  isBackfillBackedOff,
} from '../quote-quota';
import { dayKeyOf } from '../price-book';
import { readEodhdKey } from '../eodhd-key';
import { shareInstrument } from '../instrument';
import { pricePointsRepo } from '../price-points-repo';

import {
  saveShareRefresh,
  type SharePriceRow,
  type ShareRefreshResult,
} from './share-refresh-write';

// The free EODHD plan's history reaches one year back.
const HISTORY_DAYS = 365;
// Indexed by UTC weekday, Sunday first: how far back the last weekday's close is.
const DAYS_BACK_TO_LAST_WEEKDAY = [2, 3, 1, 1, 1, 1, 1];
const NEVER_PRICED = Number.MIN_SAFE_INTEGER;
const PENCE = 'GBX';

export type ShareRefreshStatus =
  | 'ok'
  | 'noShares'
  | 'noKey'
  | 'keyRejected'
  | 'quotaExhausted'
  | 'failed';

type ShareHolding = Pick<HoldingRow, 'id' | 'currency' | 'metadata'>;
type StoredRange = Pick<PricePointRow, 'instrument'> & { firstDay: number; lastDay: number };

export type ShareRefreshDeps = {
  now?: () => number;
  fetchImpl?: typeof fetch;
  listShares?: () => Promise<ShareHolding[]>;
  readKey?: () => Promise<string | undefined>;
  loadQuota?: () => Promise<QuoteQuota | null>;
  updateQuota?: (build: (stored: QuoteQuota | null) => QuoteQuota | null) => Promise<void>;
  loadDayRanges?: () => Promise<StoredRange[]>;
  fetchEod?: typeof fetchEod;
  searchSymbols?: typeof searchSymbols;
  save?: (result: ShareRefreshResult) => Promise<void>;
};

/**
 * Every EODHD share of one symbol: they share one `share:<symbol>` series.
 * `isHeld` is false once every holding of it sold every share and has no lot
 * still to come: its series then needs closes only up to `lastLotDay`.
 */
type Listing = {
  symbol: string;
  unit: string | undefined;
  currencies: Currency[];
  unresolvedHoldingIds: string[];
  firstLotDay: number;
  lastLotDay: number;
  isHeld: boolean;
};

type ListingSearch = { code: string; exchange: string };

/**
 * One call for one listing over `[fromDay, toDay]`. `isForward` asks for the
 * newest closes, which a symbol gets once per UTC day; `extendsBack` reaches
 * back to (or before) the first stored close, so its answer is all the
 * history EODHD has from `fromDay`.
 */
type PlannedCall = {
  listing: Listing;
  fromDay: number;
  toDay: number;
  latestDay: number;
  isForward: boolean;
  extendsBack: boolean;
  search: ListingSearch | undefined;
};

type Stop = 'failed' | 'usedUp' | 'keyRejected' | 'dayChanged';

/** `isStruck`: EODHD had no use for the symbol, so it waits before the next ask. */
type CallOutcome = {
  spent: number;
  rows: SharePriceRow[];
  units: ShareQuoteCurrencyUpdate[];
  isAnswered?: boolean;
  isStruck?: boolean;
  stop?: Stop;
};

type Progress = {
  spent: number;
  rows: SharePriceRow[];
  units: ShareQuoteCurrencyUpdate[];
  reached: string[];
  answered: string[];
  empty: SymbolLots[];
  struck: SymbolLots[];
  backfilledFrom: Record<string, number>;
  stop?: Stop;
};

type CallContext = {
  key: string;
  today: number;
  now: () => number;
  fetchImpl: typeof fetch;
  fetchEod: typeof fetchEod;
  searchSymbols: typeof searchSymbols;
};

const isHeldAt = (lots: readonly Lot[], now: number): boolean =>
  compareDecimal(quantityAt(lots, now), '0') > 0 ||
  maxOf(lots.map((lot) => lot.day)) > dayKeyOf(now);

const listingsOf = (holdings: readonly ShareHolding[], now: number): Listing[] => {
  const listings = new Map<string, Listing>();

  for (const holding of holdings) {
    const meta = asShareMeta(holding.metadata);

    if (meta?.quoteSource !== 'eodhd' || meta.lots.length === 0) {
      continue;
    }

    const lotDays = meta.lots.map((lot) => lot.day);
    const existing = listings.get(meta.symbol);

    listings.set(meta.symbol, {
      symbol: meta.symbol,
      unit: existing?.unit ?? meta.quoteCurrency,
      currencies: [...(existing?.currencies ?? []), holding.currency],
      unresolvedHoldingIds: [
        ...(existing?.unresolvedHoldingIds ?? []),
        ...(meta.quoteCurrency === undefined ? [holding.id] : []),
      ],
      firstLotDay: minOf([...lotDays, existing?.firstLotDay ?? Number.MAX_SAFE_INTEGER]),
      lastLotDay: maxOf([...lotDays, existing?.lastLotDay ?? Number.MIN_SAFE_INTEGER]),
      isHeld: existing?.isHeld === true || isHeldAt(meta.lots, now),
    });
  }

  return [...listings.values()];
};

const rangeBySymbol = (
  listings: readonly Listing[],
  ranges: readonly StoredRange[],
): Map<string, StoredRange> => {
  const symbolBySeries = new Map(
    listings.map((listing) => [shareInstrument(listing.symbol), listing.symbol]),
  );

  return new Map(
    ranges.flatMap(
      (range) =>
        foldMap(maybe(symbolBySeries.get(range.instrument)), (symbol): [string, StoredRange][] => [
          [symbol, range],
        ]) ?? [],
    ),
  );
};

const weekdayBefore = (day: number): number =>
  day - (DAYS_BACK_TO_LAST_WEEKDAY[new Date(day).getUTCDay()] ?? 1) * DAY_MS;

const isWeekday = (day: number): boolean => ![0, 6].includes(new Date(day).getUTCDay());

// Any three days in a row hold a weekday.
const hasWeekday = (fromDay: number, toDay: number): boolean =>
  toDay - fromDay >= 2 * DAY_MS || isWeekday(fromDay) || isWeekday(toDay);

// A close is stored only in a holding's own currency; a pence close becomes pounds.
const pointUnit = (
  unit: string,
  currencies: readonly Currency[],
): { currency: Currency; places: number } | undefined => {
  if (unit === PENCE && currencies.includes('GBP')) {
    return { currency: 'GBP', places: -2 };
  }

  return foldMap(maybe(currencies.find((currency) => currency === unit)), (currency) => ({
    currency,
    places: 0,
  }));
};

const searchFor = (symbol: string): ListingSearch | undefined => {
  const dot = symbol.lastIndexOf('.');

  if (dot <= 0 || dot === symbol.length - 1) {
    return undefined;
  }

  return { code: symbol.slice(0, dot), exchange: symbol.slice(dot + 1) };
};

type CallRange = Omit<PlannedCall, 'listing' | 'search'>;

/**
 * The newest closes once per UTC day while the last weekday's close is
 * missing (for a sold-out listing, the last weekday before its last lot) and
 * the symbol is not backed off, and the history before the first stored close
 * whenever a lot reaches further back than EODHD has answered for, unless that
 * history is backed off: both in one call, which costs the same.
 */
const rangeFor = (
  listing: Listing,
  stored: StoredRange | undefined,
  quota: QuoteQuota,
): CallRange | undefined => {
  const throughDay = listing.isHeld ? quota.day : listing.lastLotDay;
  const latestDay = stored?.lastDay ?? NEVER_PRICED;
  const isForward =
    !quota.symbols.includes(listing.symbol) &&
    !isBackedOff(quota, listing.symbol, listing.lastLotDay) &&
    latestDay < weekdayBefore(throughDay);
  const wantedFrom = Math.max(listing.firstLotDay, quota.day - HISTORY_DAYS * DAY_MS);

  if (stored === undefined) {
    return isForward && wantedFrom <= throughDay
      ? { fromDay: wantedFrom, toDay: throughDay, latestDay, isForward, extendsBack: true }
      : undefined;
  }

  const answeredFrom = Math.min(
    stored.firstDay,
    quota.backfilledFrom?.[listing.symbol] ?? stored.firstDay,
  );

  if (
    wantedFrom < answeredFrom &&
    hasWeekday(wantedFrom, answeredFrom - DAY_MS) &&
    !isBackfillBackedOff(quota, listing.symbol, listing.firstLotDay)
  ) {
    const toDay = isForward ? throughDay : stored.firstDay - DAY_MS;

    return { fromDay: wantedFrom, toDay, latestDay, isForward, extendsBack: true };
  }

  return isForward
    ? { fromDay: latestDay + DAY_MS, toDay: throughDay, latestDay, isForward, extendsBack: false }
    : undefined;
};

// The unit of a hand-typed share is never assumed: it costs one search first.
const callFor = (
  listing: Listing,
  stored: StoredRange | undefined,
  quota: QuoteQuota,
): PlannedCall | undefined => {
  const range = rangeFor(listing, stored, quota);

  if (range === undefined) {
    return undefined;
  }

  if (listing.unit === undefined) {
    return foldMap(maybe(searchFor(listing.symbol)), (search) => ({ listing, ...range, search }));
  }

  if (pointUnit(listing.unit, listing.currencies) === undefined) {
    return undefined;
  }

  return { listing, ...range, search: undefined };
};

const costOf = (call: PlannedCall): number => (call.search === undefined ? 1 : 2);

/** The oldest price first, within the calls the quota leaves for a refresh. */
const planCalls = (
  listings: readonly Listing[],
  storedRanges: ReadonlyMap<string, StoredRange>,
  quota: QuoteQuota,
): { planned: PlannedCall[]; leftOver: boolean } => {
  const candidates = listings
    .flatMap((listing) => callFor(listing, storedRanges.get(listing.symbol), quota) ?? [])
    .sort(
      (first, second) =>
        first.latestDay - second.latestDay ||
        first.listing.symbol.localeCompare(second.listing.symbol),
    );
  const planned: PlannedCall[] = [];
  let allowance = refreshAllowance(quota);

  for (const call of candidates) {
    if (costOf(call) <= allowance) {
      allowance -= costOf(call);
      planned.push(call);
    }
  }

  return { planned, leftOver: planned.length < candidates.length };
};

// Only the error's name and code are logged: a request URL carries the key.
// An answer about one symbol (outside the plan, delisted, a bad body) strikes
// it, so one bad symbol never blocks the rest. A rejected key stops the run
// and every later one until a key is saved or checked again; no network, the
// per-minute rate limit, or an EODHD server error stops the run for a later
// retry; only a 402 means the day's calls are used up.
const stopFor = (error: unknown): Stop | undefined => {
  logFailure('[share-refresh] EODHD request failed', error);

  return match(error)
    .with(P.instanceOf(EodhdNotInPlanError), P.instanceOf(EodhdUnavailableError), () => undefined)
    .with(P.instanceOf(EodhdQuotaError), () => 'usedUp' as const)
    .with(P.instanceOf(EodhdAuthError), () => 'keyRejected' as const)
    .otherwise(() => 'failed' as const);
};

// A request EODHD never answered costs no call, so offline runs never use up
// the day's allowance; a lost answer EODHD did count ends in its own 402.
const costOfFailure = (error: unknown): number => (error instanceof EodhdNetworkError ? 0 : 1);

const failedCall = (error: unknown, spent: number): CallOutcome => {
  const stop = stopFor(error);

  return {
    spent: spent + costOfFailure(error),
    rows: [],
    units: [],
    ...(stop === undefined ? { isStruck: true } : { stop }),
  };
};

// The symbol is personal portfolio data and every console level reaches the
// Release os_log, so a skip logs only its kind.
const skipped = (reason: string, outcome: CallOutcome): CallOutcome => {
  logFailure(`[share-refresh] share skipped: ${reason}`, undefined);

  return outcome;
};

const resolveUnit = async (
  call: PlannedCall,
  context: CallContext,
): Promise<CallOutcome & { unit?: string }> => {
  const { listing, search } = call;

  if (search === undefined) {
    return { spent: 0, rows: [], units: [], unit: listing.unit };
  }

  const found = await either(async () =>
    context.searchSymbols(search.code, context.key, context.fetchImpl, search.exchange),
  );

  if (isLeft(found)) {
    return failedCall(bifold(found), 0);
  }

  const matches: SymbolMatch[] = bifold(found);
  const unit = matches.find((candidate) => candidate.symbol === listing.symbol)?.currency;

  if (unit === undefined) {
    return skipped('no matching EODHD listing', { spent: 1, rows: [], units: [], isStruck: true });
  }

  const units = listing.unresolvedHoldingIds.map((holdingId) => ({
    holdingId,
    symbol: listing.symbol,
    quoteCurrency: unit,
  }));

  return { spent: 1, rows: [], units, unit };
};

// A sold-out listing whose closes still stop short of its last lot has every
// close EODHD will ever have for that range (its sale fell on a closed day).
const isShortOfSale = (call: PlannedCall, rows: readonly SharePriceRow[]): boolean =>
  !call.listing.isHeld &&
  call.isForward &&
  maxOf([call.latestDay, ...rows.map((row) => row.day)]) < weekdayBefore(call.listing.lastLotDay);

const refreshListing = async (call: PlannedCall, context: CallContext): Promise<CallOutcome> => {
  const { unit, ...resolved } = await resolveUnit(call, context);

  if (resolved.stop !== undefined || resolved.isStruck === true || unit === undefined) {
    return resolved;
  }

  const target = pointUnit(unit, call.listing.currencies);

  if (target === undefined) {
    return skipped('price unit is not the holding currency', resolved);
  }

  const closes = await either(async () =>
    context.fetchEod(call.listing.symbol, call.fromDay, call.toDay, context.key, context.fetchImpl),
  );

  if (isLeft(closes)) {
    return { ...failedCall(bifold(closes), resolved.spent), units: resolved.units };
  }

  const fetched: EodClose[] = bifold(closes);
  const rows = fetched.map(
    ({ day, close }): SharePriceRow => ({
      instrument: shareInstrument(call.listing.symbol),
      day,
      price: shiftDecimal(close, target.places),
      currency: target.currency,
      source: 'eodhd',
    }),
  );

  return {
    ...resolved,
    spent: resolved.spent + 1,
    rows,
    isAnswered: true,
    isStruck: isShortOfSale(call, rows),
  };
};

// Only a close newer than the stored ones says the symbol is still listed: a
// forward call that brings none counts as empty, even when the history asked
// for in the same call came back. A history-only call neither ends a back-off
// nor counts as empty.
const record = (progress: Progress, call: PlannedCall, outcome: CallOutcome): void => {
  const { symbol, firstLotDay, lastLotDay } = call.listing;
  const hasNewClose = outcome.rows.some((row) => row.day > call.latestDay);

  progress.reached.push(symbol);

  if (outcome.isAnswered === true && call.extendsBack) {
    progress.backfilledFrom[symbol] = call.fromDay;
  }

  if (outcome.isStruck === true) {
    progress.struck.push({ symbol, firstLotDay, lastLotDay });
  } else if (outcome.isAnswered === true && call.isForward && !hasNewClose) {
    progress.empty.push({ symbol, firstLotDay, lastLotDay });
  } else if (outcome.isAnswered === true && call.isForward) {
    progress.answered.push(symbol);
  }
};

// One call at a time: a stop (see `stopFor`) ends every later call. A call
// counts on the UTC day it goes out, so the run ends at midnight UTC and the
// next one plans on the new day.
const runCalls = async (planned: PlannedCall[], context: CallContext): Promise<Progress> => {
  const progress: Progress = {
    spent: 0,
    rows: [],
    units: [],
    reached: [],
    answered: [],
    empty: [],
    struck: [],
    backfilledFrom: {},
  };

  for (const call of planned) {
    if (utcDayOf(context.now()) !== context.today) {
      return { ...progress, stop: 'dayChanged' };
    }

    const outcome = await refreshListing(call, context);

    progress.spent += outcome.spent;
    progress.rows.push(...outcome.rows);
    progress.units.push(...outcome.units);

    if (outcome.stop !== undefined) {
      return { ...progress, stop: outcome.stop };
    }

    record(progress, call, outcome);
  }

  return progress;
};

const withDefaults = (deps: ShareRefreshDeps): Required<ShareRefreshDeps> => ({
  now: Date.now,
  fetchImpl: fetch,
  listShares: () => holdingsRepo.activeSharesQuery(),
  readKey: readEodhdKey,
  loadQuota: async () => (await settingsRepo.quoteQuotaQuery()).at(0)?.quoteQuota ?? null,
  updateQuota: settingsRepo.updateQuoteQuota,
  loadDayRanges: () => pricePointsRepo.shareDayRangesQuery(),
  fetchEod,
  searchSymbols,
  save: saveShareRefresh,
  ...deps,
});

const statusOf = (stop: Stop | undefined, leftOver: boolean): ShareRefreshStatus =>
  match(stop)
    .with('usedUp', () => 'quotaExhausted' as const)
    .with('failed', () => 'failed' as const)
    .with('keyRejected', () => 'keyRejected' as const)
    .with(P.union('dayChanged', undefined), () => (leftOver ? 'quotaExhausted' : 'ok'))
    .exhaustive();

const refreshOnce = async (deps: ShareRefreshDeps): Promise<ShareRefreshStatus> => {
  const { now, listShares, readKey, loadQuota, updateQuota, loadDayRanges, save, ...network } =
    withDefaults(deps);
  const listings = listingsOf(await listShares(), now());

  if (listings.length === 0) {
    return 'noShares';
  }

  // The key state is read before the key: a key saved in between counts as a
  // newer key, so nothing this run learns lands on it.
  const quota = currentQuota(await loadQuota(), now());

  if (quota.isKeyRejected === true) {
    return 'keyRejected';
  }

  const key = await readKey();

  if (key === undefined) {
    return 'noKey';
  }

  const { planned, leftOver } = planCalls(
    listings,
    rangeBySymbol(listings, await loadDayRanges()),
    quota,
  );

  if (planned.length === 0) {
    return leftOver ? 'quotaExhausted' : 'ok';
  }

  const reserved = planned.reduce((total, call) => total + costOf(call), 0);
  const symbols = planned.filter((call) => call.isForward).map((call) => call.listing.symbol);

  await updateQuota((stored) => reserve(currentQuota(stored, quota.day), reserved, symbols));

  const progress = await runCalls(planned, { ...network, now, key, today: quota.day });

  await save({
    rows: progress.rows,
    units: progress.units,
    settlement: {
      day: quota.day,
      reserved,
      spent: progress.spent,
      unanswered: symbols.filter((symbol) => !progress.reached.includes(symbol)),
      usedUp: progress.stop === 'usedUp',
      keyGeneration: keyGenerationOf(quota),
      isKeyRejected: progress.stop === 'keyRejected',
      struck: progress.struck,
      answered: progress.answered,
      empty: progress.empty,
      backfilledFrom: progress.backfilledFrom,
    },
  });

  return statusOf(progress.stop, leftOver);
};

// Two overlapping refreshes would plan from the same stored quota and ask
// EODHD for the same symbols twice.
let previousRun: Promise<unknown> = Promise.resolve();

/**
 * Refreshes end-of-day closes for every active EODHD share under the user's
 * own daily EODHD limit. Gated on data presence: no EODHD share means no
 * Keychain read and no call, and a key EODHD rejected means no call until a
 * key is saved or checked again. Each symbol costs at most one call for its
 * newest closes per UTC day, none while its latest close is from the last
 * weekday (or, once sold out, reaches its sale), the oldest price goes first,
 * and the last 2 calls of the day stay free for a search. A symbol EODHD has
 * no use for waits longer each time. The calls are stored before they go out,
 * so a crash over-counts and never exceeds the limit; everything else lands in
 * one final write. A call made while another runs waits for it, then plans
 * from the quota that one stored.
 */
export const refreshSharePrices = (deps: ShareRefreshDeps = {}): Promise<ShareRefreshStatus> => {
  const run = previousRun.then(() => refreshOnce(deps));

  previousRun = run.catch(() => undefined);

  return run;
};
