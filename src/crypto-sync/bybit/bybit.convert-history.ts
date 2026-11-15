import { rethrow } from 'fnts';
import { match, P } from 'ts-pattern';
import {
  BinanceWalkStop,
  commitSettledSpan,
  distinctGround,
  historyListWriterOf,
  isPoint,
  joinSettled,
  notImportedWriterOf,
  type OwedGround,
  readPendingMark,
  readWalkMarks,
  rowMinorUnits,
  type SettledSpan,
  type SpanRead,
  settleRecords,
  type WalkMarkWriter,
  type WalkResult,
  type WalkWindow,
  walkMarkWriterOf,
} from '@kiko/crypto-sync/exchange/walk';
import maybe, { foldMap } from 'fnts/maybe';
import { maxOf, minOf } from '@kiko/numbers';
import { compareDecimal } from '@kiko/currency/decimal';
import type { Currency } from '@kiko/currency/currency';
import { untrackedAssetCode } from '@kiko/transactions/untracked-counterpart';
import { notImportedEntry, type WalkMarkPatch } from '@kiko/crypto-sync/exchange/walk-state';

import {
  type BybitRowWalkDeps,
  defaultBybitRowWalkDeps,
  historyFloorOf,
  placeBybitRows,
  readUnderCooldown,
  taggedWith,
} from './bybit.walk-run';
import {
  type BybitFundingSourceDeps,
  type FundingSourcePlan,
  addWithFundingSources,
  defaultBybitFundingSourceDeps,
  fundingSourceOf,
} from './bybit.funding-source';
import { isBybitCoolingDown } from './bybit.cooldown';
import { fetchConvertPage } from './bybit.history-client';
import { isTrackedBybitAsset } from './bybit.tracked-coin';
import { type BybitWallet, holdingKeyOf } from './bybit.holding-keys';
import { BybitRefusalError, type BybitReadOptions } from './bybit.client';
import { type BybitHistoryRun, NO_WEIGHTS, recordBybitFailedCall } from './bybit.history-budget';

/** The series of the one range this walk owes, and of every point it owes. */
const CONVERT_SERIES = 'convert';

/**
 * A pass never reads past this page. The route says nothing of what an `index` past the end gives,
 * so a list that wraps to page 1 is cut here, and a list of more converts than this holds shows
 * its oldest ones in no run.
 */
const CONVERT_PASS_PAGES = 1_000;

/**
 * No more than this many points stay owed at once. A server that answers every row with a word
 * this walk waits on would otherwise give one point per convert, and no window reads them.
 */
const CONVERT_MAX_OWED_POINTS = 12;

const CONVERT_NOT_SETTLED = 'convert-not-settled';

const CONVERT_ROW_UNREADABLE = 'convert-row-unreadable';

const CONVERT_AMOUNT_INVALID = 'convert-amount-invalid';

const CONVERT_HOLDING_MISSING = 'convert-holding-missing';

type ConvertItem = Awaited<ReturnType<typeof fetchConvertPage>>['rows'][number];

type ConvertRow = Extract<ConvertItem, { kind: 'row' }>['row'];

/**
 * A leg mapped from a convert, before its wallets are turned into holdings: `wallet` is the key of
 * the coin's holding, `counterpartWallet` the other leg's. A leg against an untracked coin has
 * `untrackedCounterpart` instead of a counterpart and a pair id.
 */
type PlannedConvertRow = {
  wallet: string;
  counterpartWallet?: string;
  amountMinorUnits: number;
  time: number;
  externalId: string;
  exchangePairId?: string;
  untrackedCounterpart?: string;
  description: '';
  operation: 'convert';
  /** The record of a leg on the Funding wallet: a leg on Unified has none. */
  funding?: FundingSourcePlan;
};

/** The imported-transaction shape the walk hands to `transactionsRepo.addManyDedup`. */
type BybitConvertRow = Omit<PlannedConvertRow, 'wallet' | 'counterpartWallet' | 'funding'> & {
  holdingId: string;
  source: 'bybit';
  exchangeCounterpartHoldingId?: string;
};

/** A leg placed on its holding, still with the record it writes to the Funding ledger. */
type PlacedConvertRow = BybitConvertRow & { funding?: FundingSourcePlan };

type BybitConvertHistoryDeps = BybitRowWalkDeps<BybitConvertRow> &
  BybitFundingSourceDeps<BybitConvertRow> & {
    fetchConvertPage: typeof fetchConvertPage;
  };

const defaultBybitConvertHistoryDeps: BybitConvertHistoryDeps = {
  ...defaultBybitRowWalkDeps,
  ...defaultBybitFundingSourceDeps,
  fetchConvertPage,
};

type ConvertContext = {
  deps: BybitConvertHistoryDeps;
  run: BybitHistoryRun;
  accountId: string;
  apiKey: string;
  secret: string;
  options: BybitReadOptions;
  write: WalkMarkWriter;
  floorMs: number;
  /** The start of the run: the time a point first owed in it is stamped with. */
  now: number;
};

/**
 * What one convert comes to: its rows with the tickers of the coins Kiko does not track, the entry
 * of a record a rule refuses for good, or nothing at all (a convert that failed).
 */
type ConvertOutcome =
  | { kind: 'rows'; rows: PlannedConvertRow[]; untracked: string[] }
  | { kind: 'refused'; entry: string }
  | { kind: 'none' };

type ConvertSide = { asset: string; amountText: string; sign: 1 | -1 };

type TrackedSide = ConvertSide & { asset: Currency };

type ConvertLeg = TrackedSide & { units: number };

/** An entry names the time of its record, and a record with none names 0. */
const refusedOutcomeOf = (row: ConvertRow): ConvertOutcome => ({
  kind: 'refused',
  entry: notImportedEntry('convert-unrecognized', row.exchangeTransactionId, row.time?.start ?? 0),
});

const walletOf = (word: string): BybitWallet | undefined =>
  match(word)
    .returnType<BybitWallet | undefined>()
    .with('eb_convert_uta', () => 'unified')
    .with(
      P.union(
        'eb_convert_funding',
        'funding',
        'funding_fiat',
        'funding_fbtc_convert',
        'funding_block_trade',
      ),
      () => 'fund',
    )
    .otherwise(() => undefined);

const isTracked = (side: ConvertSide): side is TrackedSide => isTrackedBybitAsset(side.asset);

/**
 * The leg of one tracked side, its amount rounded to the coin's units. An amount of zero or less
 * is a convert the walk cannot trust and owes; a positive one that rounds to nothing stays a leg
 * of zero units, which the convert then leaves out whole.
 */
const legOf = (side: TrackedSide): ConvertLeg => {
  const units = rowMinorUnits(side.asset, side.amountText, 'rounded-row');

  if (compareDecimal(side.amountText, '0') <= 0) {
    throw new BinanceWalkStop(CONVERT_AMOUNT_INVALID);
  }

  return { ...side, units };
};

const settledOutcomeOf = (accountId: string, row: ConvertRow): ConvertOutcome => {
  const { time, fromCoin, toCoin } = row;
  const wallet = walletOf(row.accountType);

  if (wallet === undefined || time === undefined || fromCoin === toCoin) {
    return refusedOutcomeOf(row);
  }

  const sides: ConvertSide[] = [
    { asset: fromCoin, amountText: row.fromAmount, sign: -1 },
    { asset: toCoin, amountText: row.toAmount, sign: 1 },
  ];
  const legs = sides.filter(isTracked).map(legOf);
  const untracked = sides.filter((side) => !isTracked(side)).map(({ asset }) => asset);
  const pairId = `${accountId}:convert:${row.exchangeTransactionId}:${fromCoin}:${toCoin}`;
  const keyOf = (leg: ConvertLeg): string => holdingKeyOf(leg.asset, wallet);
  const baseOf = (leg: ConvertLeg) => ({
    wallet: keyOf(leg),
    amountMinorUnits: leg.sign * leg.units,
    time: time.start,
    externalId: `${pairId}:${keyOf(leg)}`,
    description: '' as const,
    operation: 'convert' as const,
    funding: fundingSourceOf({
      wallet,
      series: 'convert',
      coin: leg.asset,
      direction: leg.sign === 1 ? 'I' : 'O',
      amount: leg.amountText,
      time,
    }),
  });
  const pairedLegOf = (leg: ConvertLeg, other: ConvertLeg): PlannedConvertRow => ({
    ...baseOf(leg),
    counterpartWallet: keyOf(other),
    exchangePairId: pairId,
  });
  const [otherTicker = ''] = untracked;

  const rows = match(legs)
    .returnType<PlannedConvertRow[]>()
    .when(
      (found) => found.some(({ units }) => units === 0),
      () => [],
    )
    .with([P._, P._], ([first, second]) => [pairedLegOf(first, second), pairedLegOf(second, first)])
    .with([P._], ([only]) => {
      const untrackedCounterpart = untrackedAssetCode(otherTicker);

      if (untrackedCounterpart === undefined) {
        throw new BinanceWalkStop(CONVERT_ROW_UNREADABLE);
      }

      return [{ ...baseOf(only), untrackedCounterpart }];
    })
    .otherwise(() => []);

  return { kind: 'rows', rows, untracked };
};

/**
 * What one item of a page comes to. A `failure` is final and nothing; a `success` is settled by
 * the wallet, the coins and the amounts; any other word waits on Bybit and owes its point, because
 * a skipped one would be a silent loss. A row the client could not read owes its point too.
 */
const outcomeOf = (accountId: string, item: ConvertItem): ConvertOutcome =>
  match(item)
    .returnType<ConvertOutcome>()
    .with({ kind: 'unreadable' }, () => {
      throw new BinanceWalkStop(CONVERT_ROW_UNREADABLE);
    })
    .with({ kind: 'row', row: { exchangeStatus: 'success' } }, ({ row }) =>
      settledOutcomeOf(accountId, row),
    )
    .with({ kind: 'row', row: { exchangeStatus: 'failure' } }, () => ({ kind: 'none' }))
    .with({ kind: 'row' }, () => {
      throw new BinanceWalkStop(CONVERT_NOT_SETTLED);
    })
    .exhaustive();

const timeOfItem = (item: ConvertItem): WalkWindow | undefined =>
  match(item)
    .returnType<WalkWindow | undefined>()
    .with({ kind: 'row' }, ({ row }) => row.time)
    .with({ kind: 'unreadable' }, ({ time }) => time)
    .exhaustive();

/**
 * The route has no time filter, so a convert older than the floor is left out whole: no row, no
 * point and no entry, as one such row would start the net-worth line years before any other.
 */
const isWithinFloor = (item: ConvertItem, floorMs: number): boolean =>
  foldMap(maybe(timeOfItem(item)), ({ start }) => start >= floorMs) ?? true;

/** What one convert adds to its page: its rows, the tickers it names, and its refusal entry. */
type OutcomeParts = { rows: PlannedConvertRow[]; untracked: string[]; notImported: string[] };

const partsOf = (outcome: ConvertOutcome): OutcomeParts =>
  match(outcome)
    .returnType<OutcomeParts>()
    .with({ kind: 'rows' }, ({ rows, untracked }) => ({ rows, untracked, notImported: [] }))
    .with({ kind: 'refused' }, ({ entry }) => ({ rows: [], untracked: [], notImported: [entry] }))
    .with({ kind: 'none' }, () => ({ rows: [], untracked: [], notImported: [] }))
    .exhaustive();

/**
 * The converts of one page, each on its own (see `settleRecords`): one the walk cannot trust owes
 * its own point and the others still import. A convert with no time owes `span`, which is all the
 * ground the walk can read, as one range.
 */
const settledPageOf = (
  accountId: string,
  span: WalkWindow,
  items: ConvertItem[],
): SettledSpan<PlannedConvertRow> => {
  const settled = settleRecords<ConvertItem, ConvertOutcome>({
    span,
    records: items,
    rowsOf: (item) => [outcomeOf(accountId, item)],
    extentOf: timeOfItem,
    seriesOf: () => CONVERT_SERIES,
  });
  const parts = settled.rows.map(partsOf);

  return joinSettled<PlannedConvertRow>([
    {
      ...settled,
      rows: parts.flatMap((part) => part.rows),
      untracked: parts.flatMap((part) => part.untracked),
      notImported: parts.flatMap((part) => part.notImported),
    },
  ]);
};

/** What the pass holds between two pages, and writes as it moves. */
type PassState = {
  pending: OwedGround[];
  passOwed: OwedGround[];
  cursor: number | null;
};

const groundKeyOf = (ground: OwedGround): string =>
  JSON.stringify([ground.start, ground.end, ground.kind, ground.series, ground.scope]);

/**
 * The ground a page owes as this pass's own: a point carries the earliest time any list already
 * held it with (a point read again keeps the run that first owed it), a range carries the series.
 */
const stampedOwed = (owed: OwedGround[], known: OwedGround[], ranAt: number): OwedGround[] => {
  const fresh = taggedWith(CONVERT_SERIES, owed).map((ground) =>
    isPoint(ground) ? { ...ground, since: ranAt } : ground,
  );
  const freshKeys = new Set(fresh.map(groundKeyOf));

  return distinctGround([...known, ...fresh]).filter((ground) =>
    freshKeys.has(groundKeyOf(ground)),
  );
};

const hullOf = (grounds: OwedGround[]): OwedGround => ({
  start: minOf(grounds.map(({ start }) => start)),
  end: maxOf(grounds.map(({ end }) => end)),
  series: CONVERT_SERIES,
});

/**
 * No window reads this ground, so its extent only has to say where a convert waits: past the bound
 * of points, or with more than one range, the whole of it is one range over its extent.
 */
const boundedOwed = (owed: OwedGround[]): OwedGround[] => {
  const points = owed.filter(isPoint);
  const ranges = owed.filter((ground) => !isPoint(ground));

  if (points.length > CONVERT_MAX_OWED_POINTS) {
    return [hullOf(owed)];
  }

  return ranges.length > 1 ? [hullOf(ranges), ...points] : owed;
};

/** A list is written only when it changed, so a page without owed ground writes no list. */
const listPatchOf = (
  field: 'pending' | 'passOwed',
  before: OwedGround[],
  after: OwedGround[],
): WalkMarkPatch[] =>
  JSON.stringify(before) === JSON.stringify(after) ? [] : [{ field, value: after }];

/**
 * The end of a pass, in one write: the owed list becomes what this pass owed, the pass's marks
 * clear, and the cursor moves to the start of the run, never back. A list that kept a point the
 * pass did not see again (one that settled) loses it only here.
 */
const endPass = (context: ConvertContext, pass: PassState, passOwed: OwedGround[]): Promise<void> =>
  context.write([
    { field: 'pending', value: passOwed },
    { field: 'passOwed', value: [] },
    { field: 'pageIndex', value: 1 },
    { field: 'cursor', value: Math.max(context.now, pass.cursor ?? context.now) },
  ]);

/**
 * The marks that follow a page's rows, in one write: the next page, and the ground the page owes,
 * added to the pass's list and to the owed list at once, so a new point shows now and an old one
 * is not dropped before the pass ends. The last page of a pass ends it in the same write.
 */
const advanceAfterPage = async (
  context: ConvertContext,
  pass: PassState,
  page: { owed: OwedGround[]; index: number; isLast: boolean },
): Promise<void> => {
  const fresh = stampedOwed(page.owed, [...pass.pending, ...pass.passOwed], context.now);
  const passOwed = boundedOwed(distinctGround([...pass.passOwed, ...fresh]));

  if (page.isLast) {
    await endPass(context, pass, passOwed);

    return;
  }

  const pending = boundedOwed(distinctGround([...pass.pending, ...fresh]));

  await context.write([
    ...listPatchOf('pending', pass.pending, pending),
    ...listPatchOf('passOwed', pass.passOwed, passOwed),
    { field: 'pageIndex', value: page.index + 1 },
  ]);

  pass.pending = pending;
  pass.passOwed = passOwed;
};

/**
 * Commit one page: place and write the rows of the converts the walk can trust, then move the
 * marks (see `commitSettledSpan`: rows first, marks second, so a crash between the two reads the
 * page again and imports nothing new). The span is all the ground the walk can read, because a
 * convert has a time and no window. The pass is `pending`, the one that owes what it cannot trust
 * and commits the rest.
 */
const commitPage = async (
  context: ConvertContext,
  pass: PassState,
  page: { items: ConvertItem[]; index: number; isLast: boolean },
): Promise<number> => {
  const { deps, accountId, floorMs, now } = context;
  const span = { start: floorMs, end: now };
  const commit = await commitSettledSpan<PlannedConvertRow, PlacedConvertRow>({
    pass: 'pending',
    span,
    settled: settledPageOf(
      accountId,
      span,
      page.items.filter((item) => isWithinFloor(item, floorMs)),
    ),
    place: (planned) => placeBybitRows(context, planned, CONVERT_HOLDING_MISSING),
    add: (placed) => addWithFundingSources(context, placed, deps.addTransactions),
    writeOversized: historyListWriterOf(deps, accountId, 'oversizedCoins'),
    writeUntracked: historyListWriterOf(deps, accountId, 'untrackedCoins'),
    writeNotImported: notImportedWriterOf(deps, accountId),
    advance: ({ owed }) => advanceAfterPage(context, pass, { ...page, owed }),
  });

  return commit?.imported ?? 0;
};

/** What a read of one index gave: the page, or the end of the list in the form of a refusal. */
type PageRead = { kind: 'rows'; items: ConvertItem[] } | { kind: 'over' };

const pageOf = (page: PageRead): SpanRead<PageRead> => ({ kind: 'page', page });

/**
 * The lowest code Bybit puts in a body; below it a code is an HTTP status. Only a refusal of the
 * class "any other" with this code or more can end a pass; a code with a class of its own does not.
 */
const FIRST_BYBIT_CODE = 10_000;

/**
 * Bybit does not say what an index past the end gives. A refusal of the class "any other" that
 * carries a Bybit code, at an index after the first, is taken for the end of the list; a refusal
 * at the first index is a real failure, and so is every refusal that names its cause. An HTTP
 * failure with no code in its body (a gateway's 502) says nothing of the list, so it rejects the
 * run and the pass resumes at its page, with the points it owes kept.
 */
const isPastTheEnd = (error: unknown, index: number): boolean =>
  index > 1 &&
  error instanceof BybitRefusalError &&
  error.refusal === 'unknown' &&
  (error.code ?? 0) >= FIRST_BYBIT_CODE;

/**
 * One page, in the convert lane, paced by the shared gate. `undefined` is a clean stop: Bybit
 * rate-limited and the account cools.
 */
const readPage = (
  context: ConvertContext,
  index: number,
): Promise<SpanRead<PageRead> | undefined> =>
  readUnderCooldown(context, async () => {
    const { deps, run, apiKey, secret, options } = context;

    try {
      await run.gate.wait();
      const { rows } = await deps
        .fetchConvertPage(apiKey, secret, { index }, options)
        .catch(rethrow(() => recordBybitFailedCall(run, 'convert')));
      run.budget.record('convert', NO_WEIGHTS);

      return pageOf({ kind: 'rows', items: rows });
    } catch (error) {
      if (isPastTheEnd(error, index)) {
        return pageOf({ kind: 'over' });
      }

      throw error;
    }
  });

/** The ids of a page, or none when a row of it names no id, so the page proves no repeat. */
const keysOf = (items: ConvertItem[]): string[] | undefined => {
  const keys = items.flatMap((item) =>
    match(item)
      .returnType<string[]>()
      .with({ kind: 'row' }, ({ row }) => [row.exchangeTransactionId])
      .with({ kind: 'unreadable' }, () => [])
      .exhaustive(),
  );

  return keys.length === items.length ? keys : undefined;
};

const isRepeat = (before: string[] | undefined, keys: string[] | undefined): boolean =>
  before !== undefined &&
  keys !== undefined &&
  before.length === keys.length &&
  before.every((key, position) => key === keys[position]);

/**
 * Read the pages of a pass from `firstIndex` until the lane has no call left (the next run
 * resumes), or an end: an empty page, a page that repeats the one before it, a refusal taken for
 * the end of the list, or the last page a pass reads. Every end moves the cursor. A run that ends
 * a pass reads no more, so a list is not read twice in one run.
 */
const runPass = async (
  context: ConvertContext,
  pass: PassState,
  firstIndex: number,
): Promise<WalkResult> => {
  let index = firstIndex;
  let before: string[] | undefined;
  let imported = 0;

  while (context.run.budget.canAfford('convert', NO_WEIGHTS)) {
    const read = await readPage(context, index);

    if (read?.kind !== 'page') {
      return { imported, complete: false };
    }

    const { page } = read;
    const keys = match(page)
      .returnType<string[] | undefined>()
      .with({ kind: 'rows' }, ({ items }) => keysOf(items))
      .with({ kind: 'over' }, () => undefined)
      .exhaustive();

    if (page.kind === 'over' || page.items.length === 0 || isRepeat(before, keys)) {
      await endPass(context, pass, pass.passOwed);

      return { imported, complete: true };
    }

    const isLast = index >= CONVERT_PASS_PAGES;

    imported += await commitPage(context, pass, { items: page.items, index, isLast });

    if (isLast) {
      return { imported, complete: true };
    }

    before = keys;
    index += 1;
  }

  return { imported, complete: false };
};

/**
 * Import the converts of the Bybit convert history as two legs each, on the wallet the convert
 * names, idempotently, committing a page's rows before the marks move past it. The route has no
 * time and no cursor, so every pass reads the whole list by `index`, and the lane's calls bound
 * a run: a list longer than a run reads resumes on the next run at the stored index. No order is
 * stated, so no early stop is safe. `complete: true` means the pass ended in this run; a failure
 * other than a rate limit rejects, so the caller can log it without failing the balance sync.
 */
export const syncBybitConvertHistory = async (
  request: { targetAccountId: string; run: BybitHistoryRun },
  overrides: Partial<BybitConvertHistoryDeps> = {},
): Promise<WalkResult> => {
  const deps = { ...defaultBybitConvertHistoryDeps, ...overrides };
  const { targetAccountId: accountId, run } = request;
  const now = deps.now();

  if (isBybitCoolingDown(accountId, now)) {
    return { imported: 0, complete: false };
  }

  const credentials = await deps.readCredentials(accountId);

  if (credentials === undefined) {
    return { imported: 0, complete: true };
  }

  const stored = await readWalkMarks(deps, accountId, 'convert');
  const write = walkMarkWriterOf(deps, accountId, 'convert');
  const floorMs = historyFloorOf(now);
  const context: ConvertContext = {
    deps,
    run,
    accountId,
    apiKey: credentials.apiKey,
    secret: credentials.secret,
    options: { fetchImpl: deps.fetchImpl, now: deps.now },
    write,
    floorMs,
    now,
  };
  const pending = await readPendingMark({
    stored: stored.pending,
    owedIfUnreadable: { start: floorMs, end: stored.cursor ?? floorMs },
    knownSeries: [CONVERT_SERIES],
    write,
  });

  return runPass(
    context,
    { pending, passOwed: stored.passOwed ?? [], cursor: stored.cursor },
    stored.pageIndex ?? 1,
  );
};
