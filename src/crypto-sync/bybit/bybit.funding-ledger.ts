import { match } from 'ts-pattern';
import {
  BinanceWalkStop,
  commitExchangeSpan,
  joinSettled,
  type OwedWindow,
  type SettledSpan,
  settleRecords,
  type SpanCommit,
  type SpanRead,
  type WalkPass,
  type WalkResult,
  type WalkWindow,
} from '@kiko/crypto-sync/exchange/walk';
import { type FundingMatchRow, write } from '@kiko/db';
import { compareDecimal, normalizeDecimal } from '@kiko/currency/decimal';

import {
  BYBIT_PAGE_DRIFT,
  type BybitWalkContext,
  type BybitWalkDeps,
  byTimeThenKey,
  defaultBybitRowWalkDeps,
  driftOf,
  flooredStart,
  runBybitWalk,
  taggedWith,
} from './bybit.walk-run';
import {
  type DenseMark,
  type DenseSpanRecords,
  denseMarkOf,
  readDenseSpan,
} from './bybit.dense-read';
import { BYBIT_RESTART_FLOOR_MS } from './bybit.restart-floor';
import { BYBIT_RESCAN_WINDOWS_MS } from './bybit.rescan-window';
import { bybitFundingMatchRepo } from './bybit.funding-match.repo';
import { fetchFundingLedgerPage, timeOfItem } from './bybit.history-client';
import { BYBIT_LANE_CALL_CAPS, type BybitHistoryRun } from './bybit.history-budget';

/**
 * The one series of this walk. A row that cannot be trusted owes its whole span as a range in this
 * series: the forward pass goes past a range tagged with a series, and the walk's cursor moves on.
 */
const LEDGER_SERIES = 'fundingLedger';

/** The ledger route answers a window of at most 7 days. */
const WINDOW_MS = BYBIT_RESCAN_WINDOWS_MS.fundingLedger;

/** A window costs one call at least, and the lane spends its calls on windows and pages. */
const MAX_WINDOWS = BYBIT_LANE_CALL_CAPS.fundingLedger;

const SECOND_MS = 1_000;

/**
 * The forward pass's split. The route's bounds are whole seconds, so a span of a second or less
 * reads the same one or two seconds whatever its width: a span a full lane does not hold is too
 * dense to read.
 */
const LEDGER_MIN_SPLIT_MS = SECOND_MS;

/**
 * The split of every other read. It covers ground behind the forward cursor, which held the lane
 * until it read that ground whole in spans of at most a lane's rows, so a split to the millisecond
 * reaches a span that fits. Only over a lane's rows in the seconds that a span of one millisecond
 * rounds out to, which came after the forward read, stops it.
 */
const LEDGER_REREAD_MIN_SPLIT_MS = 1;

const FUNDING_ROW_UNREADABLE = 'funding-row-unreadable';

const FUNDING_TIME_MISSING = 'funding-time-missing';

const FUNDING_AMOUNT_INVALID = 'funding-amount-invalid';

const FUNDING_KEY_CONFLICT = 'funding-key-conflict';

/**
 * The stops that owe the whole span as one range. A failed shape is met again by every run that
 * reads the span, and one range per span stays bounded where a point per row would grow with the
 * rows.
 */
const LEDGER_RANGE_STOPS: readonly string[] = [
  FUNDING_ROW_UNREADABLE,
  FUNDING_TIME_MISSING,
  FUNDING_AMOUNT_INVALID,
];

/**
 * The stops the forward pass owes and goes past: the span stays owed in its series, or the row at
 * its own point, until a read settles it or the floor drops it, and holding the cursor behind it
 * would keep every newer row from being read.
 */
const LEDGER_FORWARD_OWES: readonly string[] = [
  ...LEDGER_RANGE_STOPS,
  FUNDING_KEY_CONFLICT,
  BYBIT_PAGE_DRIFT,
];

/**
 * An amount is a plain unsigned decimal. A comma would read "1,000" as 1, a sign would turn an Out
 * row into a credit, and neither is a form this route is known to send.
 */
const PLAIN_AMOUNT = /^[0-9]+(\.[0-9]+)?$/;

type LedgerItem = Awaited<ReturnType<typeof fetchFundingLedgerPage>>['rows'][number];

/** What one item of a page is to this walk, decided once so every step reads the same answer. */
type Reading =
  | { kind: 'counted' }
  | { kind: 'keyless' }
  | { kind: 'range'; code: string }
  | { kind: 'record'; record: FundingMatchRow };

type BybitFundingLedgerDeps = BybitWalkDeps & {
  fetchFundingLedgerPage: typeof fetchFundingLedgerPage;
  /** Writes the records of a span; the name is the one the shared span commit calls. */
  addTransactions: (records: FundingMatchRow[]) => Promise<number>;
};

const defaultBybitFundingLedgerDeps: BybitFundingLedgerDeps = {
  ...defaultBybitRowWalkDeps,
  fetchFundingLedgerPage,
  addTransactions: (records) =>
    write(async (databaseTransaction) => {
      await bybitFundingMatchRepo.upsertDatabaseTransaction(databaseTransaction, records);

      return records.length;
    }),
};

type LedgerContext = BybitWalkContext<BybitFundingLedgerDeps>;

type SpanRecords = DenseSpanRecords<LedgerItem>;

const range = (code: string): Reading => ({ kind: 'range', code });

const recordKeyOf = (accountId: string, currcCursor: string, coin: string): string =>
  `${accountId}:funding:${currcCursor}:${coin}`;

/** A row that reads well, as the record it stores: the amount is the page's text, never signed. */
const readingOf = (accountId: string, item: LedgerItem): Reading =>
  match(item)
    .returnType<Reading>()
    .with({ kind: 'unreadable' }, () => range(FUNDING_ROW_UNREADABLE))
    .with({ kind: 'untracked' }, () => ({ kind: 'counted' }))
    .with({ kind: 'row' }, ({ row }) => {
      const amount = PLAIN_AMOUNT.test(row.amount) ? normalizeDecimal(row.amount) : null;

      if (row.time === undefined) {
        return range(FUNDING_TIME_MISSING);
      }

      if (amount === null || compareDecimal(amount, '0') <= 0) {
        return range(FUNDING_AMOUNT_INVALID);
      }

      if (row.currcCursor === undefined) {
        return { kind: 'keyless' };
      }

      return {
        kind: 'record',
        record: {
          accountId,
          side: 'ledger',
          recordKey: recordKeyOf(accountId, row.currcCursor, row.currency),
          series: null,
          coin: row.currency,
          direction: row.direction,
          amount,
          fee: null,
          tax: null,
          timeStart: row.time.start,
          timeEnd: row.time.end,
          earnPrincipal: row.earnPrincipal,
        },
      };
    })
    .exhaustive();

/** The key of an item as the cursor reader counts new keys: none for a row with no key. */
const keyOfItem = (item: LedgerItem): string | undefined =>
  item.kind === 'row' && item.row.currcCursor !== undefined
    ? `${item.row.currcCursor}:${item.row.currency}`
    : undefined;

/** Two records of one key are one record when they hold the same move. */
const isSameMove = (left: FundingMatchRow, right: FundingMatchRow): boolean =>
  left.direction === right.direction &&
  left.timeStart === right.timeStart &&
  left.earnPrincipal === right.earnPrincipal &&
  compareDecimal(left.amount, right.amount) === 0;

/**
 * The keys that rows of one span give with two moves: the page's "unique id" is the only key there
 * is, so a key with two values is a read the walk cannot trust, and both rows owe their point.
 */
const conflictedKeysOf = (readings: readonly Reading[]): Set<string> => {
  const movesByKey = readings.reduce((byKey, reading) => {
    if (reading.kind !== 'record') {
      return byKey;
    }

    const seen = byKey.get(reading.record.recordKey) ?? [];

    return byKey.set(
      reading.record.recordKey,
      seen.some((record) => isSameMove(record, reading.record)) ? seen : [...seen, reading.record],
    );
  }, new Map<string, FundingMatchRow[]>());

  return new Set([...movesByKey].filter(([, moves]) => moves.length > 1).map(([key]) => key));
};

const recordsOf = (reading: Reading, conflicted: ReadonlySet<string>): FundingMatchRow[] => {
  if (reading.kind === 'range') {
    throw new BinanceWalkStop(reading.code);
  }

  if (reading.kind !== 'record') {
    return [];
  }

  if (conflicted.has(reading.record.recordKey)) {
    throw new BinanceWalkStop(FUNDING_KEY_CONFLICT);
  }

  return [reading.record];
};

/**
 * Where the rows of a span may sit before a page counts as drifted. The route compares whole
 * seconds on both bounds, so a row just before the span's start, and one in the whole second of its
 * end rounded up, can be in it.
 */
const reachOf = (span: WalkWindow): WalkWindow => ({
  start: flooredStart(span),
  end: Math.ceil(span.end / SECOND_MS) * SECOND_MS,
});

/** The ledger lane's read of one span, with the dense mark of the walk (`readDenseSpan`). */
const readSpan = (
  context: LedgerContext,
  span: WalkWindow,
  keep: number,
  window: OwedWindow,
  dense: { mark: DenseMark['mark']; isFirstForwardRead: boolean },
): Promise<SpanRead<SpanRecords> | undefined> => {
  const { deps, apiKey, secret, options } = context;

  return readDenseSpan({
    context,
    lane: 'fundingLedger',
    span,
    keep,
    window,
    minSplitMs: { forward: LEDGER_MIN_SPLIT_MS, reread: LEDGER_REREAD_MIN_SPLIT_MS },
    readPage: (cursor) => deps.fetchFundingLedgerPage(apiKey, secret, { span, cursor }, options),
    reachOf,
    keyOf: keyOfItem,
    dense,
  });
};

const sortKeyOf = (reading: Reading): string =>
  match(reading)
    .returnType<string>()
    .with({ kind: 'record' }, ({ record }) => record.recordKey)
    .otherwise(() => '');

/**
 * The records of a span, each on its own (see `settleRecords`). A row the walk cannot trust owes
 * the whole span, tagged with the series, so the forward pass goes past it and every run reads the
 * range again: it has no extent, so it gives no point. A key with two moves owes its rows' point.
 * The other rows of the span still commit.
 */
const settledSpanOf = (
  accountId: string,
  span: WalkWindow,
  { items, drifted }: SpanRecords,
): SettledSpan<FundingMatchRow> => {
  const readings = new Map(items.map((item) => [item, readingOf(accountId, item)] as const));
  const reading = (item: LedgerItem): Reading => readings.get(item) ?? { kind: 'counted' };
  const conflicted = conflictedKeysOf([...readings.values()]);
  const settled = settleRecords<LedgerItem, FundingMatchRow>({
    span,
    reach: reachOf(span),
    records: [...items].sort(
      byTimeThenKey<LedgerItem>(timeOfItem, (item) => sortKeyOf(reading(item))),
    ),
    rowsOf: (item) => recordsOf(reading(item), conflicted),
    extentOf: (item) =>
      match(reading(item))
        .returnType<WalkWindow | undefined>()
        .with({ kind: 'range' }, () => undefined)
        .otherwise(() => timeOfItem(item)),
    seriesOf: () => LEDGER_SERIES,
    untrackedOf: (item) =>
      match(item)
        .returnType<string | undefined>()
        .with({ kind: 'untracked' }, ({ ticker }) => ticker)
        .otherwise(() => undefined),
  });

  return joinSettled<FundingMatchRow>([
    driftOf(span, drifted ? [LEDGER_SERIES] : []),
    { ...settled, owed: taggedWith(LEDGER_SERIES, settled.owed) },
  ]);
};

/** One record per key: a row read twice in one span, with the same move, is written once. */
const onePerKey = (records: FundingMatchRow[]): FundingMatchRow[] => [
  ...new Map(records.map((record) => [record.recordKey, record])).values(),
];

/**
 * Commit one span: mark the line when a row had no key, and drop the dense mark the span passed,
 * then write the records of the rows the walk can trust, then move the walk's marks (see
 * `commitSettledSpan`: rows first, marks second, so a crash between the two writes the same
 * records again). The mark goes before the cursor moves: a crash between the two reads the span
 * again and writes the mark again, where a mark kept past its cursor would show for good.
 */
const commitSpan = async (
  context: LedgerContext,
  window: OwedWindow,
  span: WalkWindow,
  records: SpanRecords,
  pass: WalkPass,
  dense: DenseMark,
  leftOut: { isMarked: boolean },
): Promise<SpanCommit | undefined> => {
  const { accountId, deps } = context;
  const hasKeyless = records.items.some((item) => readingOf(accountId, item).kind === 'keyless');

  if (hasKeyless && !leftOut.isMarked) {
    await deps.patchExchangeState(accountId, [{ kind: 'fundingLeftOut' }]);
    leftOut.isMarked = true;
  }

  await dense.dropPast(context, span.end);

  return commitExchangeSpan<FundingMatchRow, FundingMatchRow>({
    context,
    pass,
    span,
    settled: settledSpanOf(accountId, span, records),
    place: async (planned) => onePerKey(planned),
    restartMs: BYBIT_RESTART_FLOOR_MS,
    series: window.series,
    forwardOwes: LEDGER_FORWARD_OWES,
  });
};

/**
 * Read the Funding wallet's ledger and write each row it can trust as a record of the stored set
 * (`funding_match_rows`), idempotently, committing a span's records before the walk's marks move
 * past it. It writes no transaction row: the reconcile decides which rows list. A run goes forward
 * from the cursor first, then reads the ground earlier runs left owed, then re-scans the last
 * window behind the cursor, then the owed points, each on what the lane has left (see
 * `planWalkPasses`). Missing credentials give a no-op, and so does an active cooldown.
 * `complete: false` means history, owed ground or the re-scan remains; a failure other than a rate
 * limit rejects, so the caller can log it without failing the balance sync.
 */
export const syncBybitFundingLedger = (
  request: { targetAccountId: string; run: BybitHistoryRun },
  overrides: Partial<BybitFundingLedgerDeps> = {},
): Promise<WalkResult> => {
  const dense = denseMarkOf(LEDGER_SERIES);
  const leftOut = { isMarked: false };

  return runBybitWalk({
    deps: { ...defaultBybitFundingLedgerDeps, ...overrides },
    accountId: request.targetAccountId,
    run: request.run,
    walkId: 'fundingLedger',
    lane: 'fundingLedger',
    series: [LEDGER_SERIES],
    windowMs: WINDOW_MS,
    maxWindows: MAX_WINDOWS,
    callsOf: () => 1,
    read: (context, window, span, keep) =>
      readSpan(context, span, keep, window, {
        mark: dense.mark,
        isFirstForwardRead: dense.isFirstForwardRead(context, window),
      }),
    commit: (context, window, span, records, pass) =>
      commitSpan(context, window, span, records, pass, dense, leftOut),
  });
};
