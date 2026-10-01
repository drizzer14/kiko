import { match, P } from 'ts-pattern';
import { minOf } from '@kiko/numbers';
import maybe, { foldMap } from 'fnts/maybe';
import { settingsRepo } from '@kiko/settings';
import { logFailure } from '@kiko/diagnostics';
import either, { bifold, isLeft } from 'fnts/either';
import { shiftDecimal } from '@kiko/currency/decimal';
import type { Currency } from '@kiko/currency/currency';
import type { HoldingRow, PricePointRow } from '@kiko/db';
import { asShareMeta } from '@kiko/holdings/holding-metadata';
import { holdingsRepo, type ShareQuoteCurrencyUpdate } from '@kiko/holdings/repo';

import {
  fetchEod,
  type EodClose,
  searchSymbols,
  EodhdQuotaError,
  type SymbolMatch,
  EodhdNotInPlanError,
  EodhdRateLimitError,
  EodhdUnavailableError,
} from '../eodhd';
import { readEodhdKey } from '../eodhd-key';
import { shareInstrument } from '../instrument';
import { pricePointsRepo } from '../price-points-repo';
import { reserve, currentQuota, refreshAllowance, type QuoteQuota } from '../quote-quota';

import {
  saveShareRefresh,
  type SharePriceRow,
  type ShareRefreshResult,
} from './share-refresh-write';

const DAY_MS = 24 * 60 * 60 * 1000;
// The free EODHD plan's history reaches one year back.
const HISTORY_DAYS = 365;
// Indexed by UTC weekday, Sunday first: how far back the last weekday's close is.
const DAYS_BACK_TO_LAST_WEEKDAY = [2, 3, 1, 1, 1, 1, 1];
const NEVER_PRICED = Number.MIN_SAFE_INTEGER;
const PENCE = 'GBX';

export type ShareRefreshStatus = 'ok' | 'noShares' | 'noKey' | 'quotaExhausted' | 'failed';

type ShareHolding = Pick<HoldingRow, 'id' | 'currency' | 'metadata'>;
type StoredPoint = Pick<PricePointRow, 'instrument' | 'day'>;

export type ShareRefreshDeps = {
  now?: () => number;
  fetchImpl?: typeof fetch;
  listShares?: () => Promise<ShareHolding[]>;
  readKey?: () => Promise<string | undefined>;
  loadQuota?: () => Promise<QuoteQuota | null>;
  updateQuota?: (build: (stored: QuoteQuota | null) => QuoteQuota | null) => Promise<void>;
  loadPoints?: () => Promise<StoredPoint[]>;
  fetchEod?: typeof fetchEod;
  searchSymbols?: typeof searchSymbols;
  save?: (result: ShareRefreshResult) => Promise<void>;
};

/** Every EODHD share of one symbol: they share one `share:<symbol>` series. */
type Listing = {
  symbol: string;
  unit: string | undefined;
  currencies: Currency[];
  unresolvedHoldingIds: string[];
  firstLotDay: number;
};

type ListingSearch = { code: string; exchange: string };
type PlannedCall = { listing: Listing; fromDay: number; search: ListingSearch | undefined };
type Stop = 'failed' | 'usedUp';
type CallOutcome = {
  spent: number;
  rows: SharePriceRow[];
  units: ShareQuoteCurrencyUpdate[];
  stop?: Stop;
};
type Progress = CallOutcome & { answered: string[] };

type CallContext = {
  key: string;
  today: number;
  fetchImpl: typeof fetch;
  fetchEod: typeof fetchEod;
  searchSymbols: typeof searchSymbols;
};

const listingsOf = (holdings: readonly ShareHolding[]): Listing[] => {
  const listings = new Map<string, Listing>();

  for (const holding of holdings) {
    const meta = asShareMeta(holding.metadata);

    if (meta?.quoteSource !== 'eodhd' || meta.lots.length === 0) {
      continue;
    }

    const firstLotDay = minOf(meta.lots.map((lot) => lot.day));
    const existing = listings.get(meta.symbol);

    listings.set(meta.symbol, {
      symbol: meta.symbol,
      unit: existing?.unit ?? meta.quoteCurrency,
      currencies: [...(existing?.currencies ?? []), holding.currency],
      unresolvedHoldingIds: [
        ...(existing?.unresolvedHoldingIds ?? []),
        ...(meta.quoteCurrency === undefined ? [holding.id] : []),
      ],
      firstLotDay: Math.min(existing?.firstLotDay ?? firstLotDay, firstLotDay),
    });
  }

  return [...listings.values()];
};

const latestDayBySymbol = (
  listings: readonly Listing[],
  points: readonly StoredPoint[],
): Map<string, number> => {
  const symbolBySeries = new Map(
    listings.map((listing) => [shareInstrument(listing.symbol), listing.symbol]),
  );
  const latest = new Map<string, number>();

  for (const point of points) {
    const symbol = symbolBySeries.get(point.instrument);

    if (symbol !== undefined) {
      latest.set(symbol, Math.max(latest.get(symbol) ?? point.day, point.day));
    }
  }

  return latest;
};

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

// The unit of a hand-typed share is never assumed: it costs one search first.
const callFor = (
  listing: Listing,
  latestDay: number | undefined,
  today: number,
): PlannedCall | undefined => {
  const fromDay =
    foldMap(maybe(latestDay), (day) => day + DAY_MS) ??
    Math.max(listing.firstLotDay, today - HISTORY_DAYS * DAY_MS);

  if (listing.unit === undefined) {
    return foldMap(maybe(searchFor(listing.symbol)), (search) => ({ listing, fromDay, search }));
  }

  if (pointUnit(listing.unit, listing.currencies) === undefined) {
    return undefined;
  }

  return { listing, fromDay, search: undefined };
};

const costOf = (call: PlannedCall): number => (call.search === undefined ? 1 : 2);

/** The oldest price first, within the calls the quota leaves for a refresh. */
const planCalls = (
  listings: readonly Listing[],
  latestDays: ReadonlyMap<string, number>,
  quota: QuoteQuota,
): { planned: PlannedCall[]; leftOver: boolean } => {
  const lastWeekday =
    quota.day - (DAYS_BACK_TO_LAST_WEEKDAY[new Date(quota.day).getUTCDay()] ?? 1) * DAY_MS;
  const latestOf = (listing: Listing): number => latestDays.get(listing.symbol) ?? NEVER_PRICED;
  const candidates = listings
    .filter((listing) => !quota.symbols.includes(listing.symbol) && latestOf(listing) < lastWeekday)
    .sort(
      (first, second) =>
        latestOf(first) - latestOf(second) || first.symbol.localeCompare(second.symbol),
    )
    .flatMap((listing) => callFor(listing, latestDays.get(listing.symbol), quota.day) ?? []);
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
// An answer about one symbol (outside the plan, delisted, a bad body) skips
// it until tomorrow; only a rejected key, a used-up day, or no network stops
// the run, so one bad symbol never blocks the rest.
const stopFor = (error: unknown): Stop | undefined => {
  logFailure('[share-refresh] EODHD request failed', error);

  return match(error)
    .with(P.instanceOf(EodhdNotInPlanError), P.instanceOf(EodhdUnavailableError), () => undefined)
    .with(P.instanceOf(EodhdQuotaError), P.instanceOf(EodhdRateLimitError), () => 'usedUp' as const)
    .otherwise(() => 'failed' as const);
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
    return { spent: 1, rows: [], units: [], stop: stopFor(bifold(found)) };
  }

  const matches: SymbolMatch[] = bifold(found);
  const unit = matches.find((candidate) => candidate.symbol === listing.symbol)?.currency;

  if (unit === undefined) {
    return skipped('no matching EODHD listing', { spent: 1, rows: [], units: [] });
  }

  const units = listing.unresolvedHoldingIds.map((holdingId) => ({
    holdingId,
    symbol: listing.symbol,
    quoteCurrency: unit,
  }));

  return { spent: 1, rows: [], units, unit };
};

const refreshListing = async (call: PlannedCall, context: CallContext): Promise<CallOutcome> => {
  const { unit, ...resolved } = await resolveUnit(call, context);

  if (resolved.stop !== undefined || unit === undefined) {
    return resolved;
  }

  const target = pointUnit(unit, call.listing.currencies);

  if (target === undefined) {
    return skipped('price unit is not the holding currency', resolved);
  }

  const closes = await either(async () =>
    context.fetchEod(
      call.listing.symbol,
      call.fromDay,
      context.today,
      context.key,
      context.fetchImpl,
    ),
  );
  const spent = resolved.spent + 1;

  if (isLeft(closes)) {
    return { ...resolved, spent, stop: stopFor(bifold(closes)) };
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

  return { ...resolved, spent, rows };
};

// One call at a time: a rejected key or a used-up day stops every later call.
const runCalls = async (planned: PlannedCall[], context: CallContext): Promise<Progress> => {
  const progress: Progress = { spent: 0, rows: [], units: [], answered: [] };

  for (const call of planned) {
    const outcome = await refreshListing(call, context);

    progress.spent += outcome.spent;
    progress.rows.push(...outcome.rows);
    progress.units.push(...outcome.units);

    if (outcome.stop !== undefined) {
      return { ...progress, stop: outcome.stop };
    }

    progress.answered.push(call.listing.symbol);
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
  loadPoints: () => pricePointsRepo.allQuery(),
  fetchEod,
  searchSymbols,
  save: saveShareRefresh,
  ...deps,
});

const refreshOnce = async (deps: ShareRefreshDeps): Promise<ShareRefreshStatus> => {
  const { now, listShares, readKey, loadQuota, updateQuota, loadPoints, save, ...network } =
    withDefaults(deps);
  const listings = listingsOf(await listShares());

  if (listings.length === 0) {
    return 'noShares';
  }

  const key = await readKey();

  if (key === undefined) {
    return 'noKey';
  }

  const quota = currentQuota(await loadQuota(), now());
  const { planned, leftOver } = planCalls(
    listings,
    latestDayBySymbol(listings, await loadPoints()),
    quota,
  );

  if (planned.length === 0) {
    return leftOver ? 'quotaExhausted' : 'ok';
  }

  const reserved = planned.reduce((total, call) => total + costOf(call), 0);
  const symbols = planned.map((call) => call.listing.symbol);

  await updateQuota((stored) => reserve(currentQuota(stored, quota.day), reserved, symbols));

  const progress = await runCalls(planned, { ...network, key, today: quota.day });

  await save({
    rows: progress.rows,
    units: progress.units,
    settlement: {
      day: quota.day,
      reserved,
      spent: progress.spent,
      unanswered: symbols.filter((symbol) => !progress.answered.includes(symbol)),
      usedUp: progress.stop === 'usedUp',
    },
  });

  return match(progress.stop)
    .with('usedUp', () => 'quotaExhausted' as const)
    .with('failed', () => 'failed' as const)
    .otherwise(() => (leftOver ? 'quotaExhausted' : 'ok'));
};

// Two overlapping refreshes would plan from the same stored quota and ask
// EODHD for the same symbols twice.
let previousRun: Promise<unknown> = Promise.resolve();

/**
 * Refreshes end-of-day closes for every active EODHD share under the user's
 * own daily EODHD limit. Gated on data presence: no EODHD share means no
 * Keychain read and no call. Each symbol costs at most one call per UTC day,
 * none while its latest close is from the last weekday, the oldest price goes
 * first, and the last 2 calls of the day stay free for a search. The calls
 * are stored before they go out, so a crash over-counts and never exceeds the
 * limit; everything else lands in one final write. A call made while another
 * runs waits for it, then plans from the quota that one stored.
 */
export const refreshSharePrices = (deps: ShareRefreshDeps = {}): Promise<ShareRefreshStatus> => {
  const run = previousRun.then(() => refreshOnce(deps));

  previousRun = run.catch(() => undefined);

  return run;
};
