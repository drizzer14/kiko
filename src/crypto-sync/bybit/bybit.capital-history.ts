import { DAY_MS } from '@kiko/dates';
import { match, P } from 'ts-pattern';
import {
  AMOUNT_STOP_CODES,
  BinanceWalkStop,
  commitExchangeSpan,
  type ExchangeStateDeps,
  exchangeStateDepsOf,
  isPoint,
  joinSettled,
  type OwedWindow,
  placeWalletRows,
  planWalkPasses,
  readPendingMark,
  readWalkMarks,
  readWalkRoundRobins,
  rowMinorUnits,
  runExchangeWalkPlan,
  type SettledSpan,
  settleRecords,
  type SpanCommit,
  type SpanRead,
  walkMarkWriterOf,
  type WalkMarkWriter,
  type WalkMarks,
  type WalkPass,
  type WalkPlan,
  type WalkResult,
  type WalkWindow,
} from '@kiko/crypto-sync/exchange/walk';
import type { HoldingRow } from '@kiko/db';
import maybe, { foldMap } from 'fnts/maybe';
import { transactionsRepo } from '@kiko/transactions/repo';
import { type ExchangeHolding, holdingsRepo } from '@kiko/holdings/repo';
import type { ExchangeCredentials } from '@kiko/crypto-sync/exchange/credentials';

import {
  BybitHistoryParseError,
  fetchDepositPage,
  fetchInternalDepositPage,
  fetchWithdrawalPage,
} from './bybit.history-client';
import { holdingKeyOf } from './bybit.holding-keys';
import { readCursorSpan } from './bybit.cursor-span';
import { BYBIT_WALK_CONFIG } from './bybit.walk-config';
import { readBybitCredentials } from './bybit.credentials';
import { isTrackedBybitAsset } from './bybit.tracked-coin';
import { BYBIT_RESTART_FLOOR_MS } from './bybit.restart-floor';
import { BybitRateLimitError, type BybitReadOptions } from './bybit.client';
import { isBybitCoolingDown, setBybitCooldownUntil } from './bybit.cooldown';
import { BYBIT_LANE_CALL_CAPS, type BybitHistoryRun, NO_WEIGHTS } from './bybit.history-budget';

const CAPITAL_SERIES = ['deposit', 'internal', 'withdraw'] as const;

type CapitalSeries = (typeof CAPITAL_SERIES)[number];

/**
 * Bybit's deposit and internal-deposit routes take a window under 30 days, and a withdrawal's
 * accepts the same: 29 days stays under the stated limit.
 */
const WINDOW_MS = 29 * DAY_MS;

/**
 * No capital series states how far back it keeps records, and an empty answer proves nothing, so
 * the floor trails the clock by a fixed span a little under two years.
 */
const HISTORY_DAYS = 729;

/** A record that settles late can sit this far behind the cursor, so the re-scan starts there. */
const OVERLAP_MS = DAY_MS;

/** A window costs one call per series, and the lane spends its calls on windows. */
const MAX_WINDOWS = BYBIT_LANE_CALL_CAPS.capital / CAPITAL_SERIES.length;

const SECOND_MS = 1_000;

const CAPITAL_ROW_UNREADABLE = 'capital-row-unreadable';

const CAPITAL_NOT_SETTLED = 'capital-not-settled';

const CAPITAL_DEPOSIT_TYPE = 'capital-deposit-type';

const CAPITAL_TIME_MISSING = 'capital-time-missing';

const CAPITAL_PAGE_DRIFT = 'bybit-page-drift';

const CAPITAL_HOLDING_MISSING = 'capital-holding-missing';

/**
 * The stops of one record that the forward pass owes and goes past: the record stays owed at its
 * own point, or its span stays owed in its series, until a read settles it or the floor drops it,
 * and holding the cursor behind it would keep every newer record from importing. A stop that is no
 * one record's (a page that drifted, a holding that cannot be found) is not in this list.
 */
const CAPITAL_FORWARD_OWES: readonly string[] = [
  CAPITAL_ROW_UNREADABLE,
  CAPITAL_NOT_SETTLED,
  CAPITAL_DEPOSIT_TYPE,
  CAPITAL_TIME_MISSING,
  ...AMOUNT_STOP_CODES,
];

const SETTLED_STATUSES: Record<CapitalSeries, readonly (string | number)[]> = {
  deposit: [3, 70012],
  internal: [2],
  withdraw: ['success'],
};

const DEPOSIT_FAILED = 4;

const DEPOSIT_ROLLED_BACK = 70011;

const INTERNAL_FAILED = 3;

const WITHDRAWAL_FAILED = ['CancelByUser', 'Reject', 'Fail'];

/** The only `depositType` that is a deposit of the user's own money, as the page states it. */
const MONEY_DEPOSIT_TYPE = '0';

type DepositItem = Awaited<ReturnType<typeof fetchDepositPage>>['rows'][number];

type InternalItem = Awaited<ReturnType<typeof fetchInternalDepositPage>>['rows'][number];

type WithdrawalItem = Awaited<ReturnType<typeof fetchWithdrawalPage>>['rows'][number];

type DepositRow = Extract<DepositItem, { kind: 'row' }>['row'];

type InternalRow = Extract<InternalItem, { kind: 'row' }>['row'];

type WithdrawalRow = Extract<WithdrawalItem, { kind: 'row' }>['row'];

/** One item of a page with the series it was read in. */
type CapitalRecord =
  | { series: 'deposit'; item: DepositItem }
  | { series: 'internal'; item: InternalItem }
  | { series: 'withdraw'; item: WithdrawalItem };

/** A row mapped from a record, before its wallet is turned into a holding. */
type PlannedCapitalRow = {
  wallet: string;
  amountMinorUnits: number;
  time: number;
  externalId: string;
  description: string;
};

/**
 * The imported-transaction shape the walk hands to `transactionsRepo.addManyDedup`; the
 * `(source, external_id)` pair is what the upsert dedupes on.
 */
type BybitCapitalRow = Omit<PlannedCapitalRow, 'wallet'> & {
  holdingId: string;
  source: 'bybit';
};

/** What a record comes to: a row to write, or the key of a row to take back. */
type CapitalOutcome =
  | { kind: 'row'; row: PlannedCapitalRow }
  | { kind: 'removal'; externalId: string };

type BybitCapitalHistoryDeps = ExchangeStateDeps & {
  now: () => number;
  fetchImpl: typeof fetch;
  readCredentials: (accountId: string) => Promise<ExchangeCredentials | undefined>;
  listHoldings: (accountId: string) => Promise<HoldingRow[]>;
  /** Creates a wallet holding the walk needs at zero; never touches an existing one. */
  ensureHoldings: (holdings: ExchangeHolding[]) => Promise<void>;
  addTransactions: (rows: BybitCapitalRow[]) => Promise<number>;
  removeTransactions: (externalIds: readonly string[]) => Promise<number>;
  fetchDepositPage: typeof fetchDepositPage;
  fetchInternalDepositPage: typeof fetchInternalDepositPage;
  fetchWithdrawalPage: typeof fetchWithdrawalPage;
};

const defaultBybitCapitalHistoryDeps: BybitCapitalHistoryDeps = {
  ...exchangeStateDepsOf('bybit'),
  now: () => Date.now(),
  fetchImpl: fetch,
  readCredentials: readBybitCredentials,
  listHoldings: async (accountId) => holdingsRepo.listByAccountQuery(accountId),
  ensureHoldings: (holdings) => holdingsRepo.ensureExchangeHoldings(holdings),
  addTransactions: (rows) => transactionsRepo.addManyDedup(rows),
  removeTransactions: (externalIds) => transactionsRepo.removeSyncedRows('bybit', externalIds),
  fetchDepositPage,
  fetchInternalDepositPage,
  fetchWithdrawalPage,
};

type CapitalContext = {
  deps: BybitCapitalHistoryDeps;
  run: BybitHistoryRun;
  accountId: string;
  apiKey: string;
  secret: string;
  options: BybitReadOptions;
  marks: WalkMarks;
  plan: WalkPlan;
  write: WalkMarkWriter;
  floorMs: number;
};

const externalIdOf = (accountId: string, kind: string, id: string, coin: string): string =>
  `${accountId}:${kind}:${id}:${coin}`;

/**
 * Map one record of a tracked coin to a row on the Funding holding of its coin: the pages name no
 * wallet for a deposit or a withdrawal, and Funding is where they place them. A record the walk
 * cannot trust (an amount it cannot read exactly, no time to date the row by) stops that record
 * alone, and a skipped one would be silent loss.
 */
const rowOutcomesOf = (input: {
  accountId: string;
  kind: string;
  id: string;
  coin: string;
  amount: string;
  time: WalkWindow | undefined;
  direction: 1 | -1;
}): CapitalOutcome[] => {
  const { accountId, kind, id, coin, amount, time, direction } = input;

  if (!isTrackedBybitAsset(coin)) {
    throw new BinanceWalkStop(CAPITAL_ROW_UNREADABLE);
  }

  const minorUnits = rowMinorUnits(coin, amount);

  if (time === undefined) {
    throw new BinanceWalkStop(CAPITAL_TIME_MISSING);
  }

  return [
    {
      kind: 'row',
      row: {
        wallet: holdingKeyOf(coin, 'fund'),
        amountMinorUnits: direction * minorUnits,
        time: time.start,
        externalId: externalIdOf(accountId, kind, id, coin),
        // The stable, non-localized ticker, so the name rule matches and the category sheet
        // appears for a crypto row as it does for a card merchant.
        description: coin,
      },
    },
  ];
};

const depositOutcomesOf = (accountId: string, row: DepositRow): CapitalOutcome[] =>
  match(row.status)
    .returnType<CapitalOutcome[]>()
    .with(DEPOSIT_FAILED, () => [])
    .with(DEPOSIT_ROLLED_BACK, () => [
      { kind: 'removal', externalId: externalIdOf(accountId, 'deposit', row.id, row.coin) },
    ])
    .when(
      (status) => SETTLED_STATUSES.deposit.includes(status),
      () => {
        if (row.depositType !== MONEY_DEPOSIT_TYPE) {
          throw new BinanceWalkStop(CAPITAL_DEPOSIT_TYPE);
        }

        return rowOutcomesOf({ ...row, accountId, kind: 'deposit', direction: 1 });
      },
    )
    .otherwise(() => {
      throw new BinanceWalkStop(CAPITAL_NOT_SETTLED);
    });

const internalOutcomesOf = (accountId: string, row: InternalRow): CapitalOutcome[] =>
  match(row.status)
    .returnType<CapitalOutcome[]>()
    .with(INTERNAL_FAILED, () => [])
    .when(
      (status) => SETTLED_STATUSES.internal.includes(status),
      () => rowOutcomesOf({ ...row, accountId, kind: 'internal', direction: 1 }),
    )
    .otherwise(() => {
      throw new BinanceWalkStop(CAPITAL_NOT_SETTLED);
    });

const withdrawalOutcomesOf = (accountId: string, row: WithdrawalRow): CapitalOutcome[] =>
  match(row.status)
    .returnType<CapitalOutcome[]>()
    .when(
      (status) => WITHDRAWAL_FAILED.includes(status),
      () => [],
    )
    .when(
      (status) => SETTLED_STATUSES.withdraw.includes(status),
      () =>
        rowOutcomesOf({
          ...row,
          id: row.withdrawId,
          accountId,
          kind: 'withdraw',
          direction: -1,
        }),
    )
    .otherwise(() => {
      throw new BinanceWalkStop(CAPITAL_NOT_SETTLED);
    });

const outcomesOf = (accountId: string, record: CapitalRecord): CapitalOutcome[] =>
  match(record)
    .returnType<CapitalOutcome[]>()
    .with({ item: { kind: 'unreadable' } }, () => {
      throw new BinanceWalkStop(CAPITAL_ROW_UNREADABLE);
    })
    .with({ item: { kind: 'untracked' } }, () => [])
    .with({ series: 'deposit', item: { kind: 'row' } }, ({ item }) =>
      depositOutcomesOf(accountId, item.row),
    )
    .with({ series: 'internal', item: { kind: 'row' } }, ({ item }) =>
      internalOutcomesOf(accountId, item.row),
    )
    .with({ series: 'withdraw', item: { kind: 'row' } }, ({ item }) =>
      withdrawalOutcomesOf(accountId, item.row),
    )
    .exhaustive();

/**
 * The time a record shows. A withdrawal's is its `createTime`, which never changes, so the row
 * keeps its day when it settles and its point does not move when `updateTime` does.
 */
const timeOfRecord = (record: CapitalRecord): WalkWindow | undefined =>
  match(record.item)
    .returnType<WalkWindow | undefined>()
    .with({ kind: 'row' }, ({ row }) => row.time)
    .with({ kind: P.union('unreadable', 'untracked') }, ({ time }) => time)
    .exhaustive();

/**
 * The ticker of a record of a coin the walk does not track, once the record is settled: the walk
 * counts it, imports no row for it and lists its ticker. A record not settled yet is counted and
 * not listed.
 */
const untrackedTickerOf = (record: CapitalRecord): string | undefined =>
  match(record.item)
    .returnType<string | undefined>()
    .with({ kind: 'untracked' }, ({ ticker, status }) =>
      status !== undefined && SETTLED_STATUSES[record.series].includes(status) ? ticker : undefined,
    )
    .otherwise(() => undefined);

const keyOf = (record: CapitalRecord): string =>
  match(record)
    .returnType<string>()
    .with({ series: 'withdraw', item: { kind: 'row' } }, ({ item }) => item.row.withdrawId)
    .with(
      { series: P.union('deposit', 'internal'), item: { kind: 'row' } },
      ({ item }) => item.row.id,
    )
    .otherwise(() => '');

const startOf = (record: CapitalRecord): number =>
  timeOfRecord(record)?.start ?? Number.POSITIVE_INFINITY;

/**
 * Oldest first, a record with no time last, ties by key: Bybit documents no order for these
 * routes, so the span is sorted before it is settled and the rows it commits do not depend on the
 * order of its pages.
 */
const byTimeThenKey = (left: CapitalRecord, right: CapitalRecord): number =>
  startOf(left) - startOf(right) || keyOf(left).localeCompare(keyOf(right));

/**
 * Bybit compares these windows at the second, so a record just before a span's start can be in it:
 * the reach of a read starts at the whole second the span starts in.
 */
const flooredStart = (span: WalkWindow): number => Math.floor(span.start / SECOND_MS) * SECOND_MS;

/**
 * Where the records of a span may sit before a page counts as drifted. A deposit's `successAt`
 * is its own time, which can be past the span end when the route filters on creation, so its reach
 * has no end.
 */
const DRIFT_REACH: Record<CapitalSeries, (span: WalkWindow) => WalkWindow> = {
  deposit: (span) => ({ start: flooredStart(span), end: Number.POSITIVE_INFINITY }),
  internal: (span) => ({ start: flooredStart(span), end: span.end }),
  withdraw: (span) => ({ start: flooredStart(span), end: span.end }),
};

/**
 * The ground a read of a span returns records from, which decides whether a record has a point.
 * A withdrawal pending since before the span is returned by a window on `updateTime`, so its reach
 * starts at the floor and its point still stands on its `createTime`.
 */
const POINT_REACH: Record<CapitalSeries, (span: WalkWindow, floorMs: number) => WalkWindow> = {
  deposit: DRIFT_REACH.deposit,
  internal: DRIFT_REACH.internal,
  withdraw: (span, floorMs) => ({ start: floorMs, end: span.end }),
};

type SpanRecords = {
  bySeries: Record<CapitalSeries, CapitalRecord[]>;
  drifted: CapitalSeries[];
};

type PageRead = { span: WalkWindow; cursor: string | undefined };

type TaggedPage = { rows: CapitalRecord[]; nextPageCursor: string | undefined };

const PAGE_OF: Record<
  CapitalSeries,
  (context: CapitalContext, read: PageRead) => Promise<TaggedPage>
> = {
  deposit: async ({ deps, apiKey, secret, options }, read) => {
    const page = await deps.fetchDepositPage(apiKey, secret, read, options);

    return {
      ...page,
      rows: page.rows.map((item): CapitalRecord => ({ series: 'deposit', item })),
    };
  },
  internal: async ({ deps, apiKey, secret, options }, read) => {
    const page = await deps.fetchInternalDepositPage(apiKey, secret, read, options);

    return {
      ...page,
      rows: page.rows.map((item): CapitalRecord => ({ series: 'internal', item })),
    };
  },
  withdraw: async ({ deps, apiKey, secret, options }, read) => {
    const page = await deps.fetchWithdrawalPage(apiKey, secret, read, options);

    return {
      ...page,
      rows: page.rows.map((item): CapitalRecord => ({ series: 'withdraw', item })),
    };
  },
};

/** The series a window is read in: every one, or the ones its owed ground names. */
const seriesOf = (window: OwedWindow): readonly CapitalSeries[] =>
  window.series === undefined
    ? CAPITAL_SERIES
    : CAPITAL_SERIES.filter((series) => window.series?.includes(series));

/** The calls one read of a window costs: one for each series it asks. */
const callsOf = (window: OwedWindow): number => seriesOf(window).length;

/**
 * One span read in each series of `window`, one after another. A series that cannot be read in
 * the lane's calls (or has to be halved) gives up the whole span, so the hint stays and no series
 * commits alone. A series whose pages drifted is no one record's stop: it is left out and owed.
 * Each series keeps one call for every series after it.
 */
const readSeriesOf = async (
  context: CapitalContext,
  series: readonly CapitalSeries[],
  span: WalkWindow,
  keep: number,
): Promise<SpanRead<SpanRecords> | undefined> => {
  const bySeries: SpanRecords['bySeries'] = { deposit: [], internal: [], withdraw: [] };
  const drifted: CapitalSeries[] = [];

  for (const [index, name] of series.entries()) {
    const read = await readCursorSpan<CapitalRecord>({
      run: context.run,
      lane: 'capital',
      span,
      keep: keep + series.length - 1 - index,
      minSplitMs: DAY_MS,
      readPage: (cursor) => PAGE_OF[name](context, { span, cursor }),
      timesOf: (record) => record.item.times,
      reachOf: DRIFT_REACH[name],
    });

    if (read === undefined || read.kind === 'split') {
      return read;
    }

    if (read.page.kind === 'drift') {
      drifted.push(name);
    } else {
      bySeries[name] = read.page.rows;
    }
  }

  return { kind: 'page', page: { bySeries, drifted } };
};

/**
 * Fetch one span of a window. `undefined` is a clean stop: the budget ran out, or Bybit
 * rate-limited (which also sets the account's cooldown). Any other error rethrows, leaving every
 * earlier span's commit in place.
 */
const readSpan = async (
  context: CapitalContext,
  window: OwedWindow,
  span: WalkWindow,
  keep: number,
): Promise<SpanRead<SpanRecords> | undefined> => {
  try {
    return await readSeriesOf(context, seriesOf(window), span, keep);
  } catch (error) {
    if (error instanceof BybitRateLimitError) {
      setBybitCooldownUntil(context.accountId, context.deps.now() + error.retryAfterMs);

      return undefined;
    }

    throw error;
  }
};

const plannedRowsOf = (outcomes: CapitalOutcome[]): PlannedCapitalRow[] =>
  outcomes.flatMap((outcome) =>
    match(outcome)
      .returnType<PlannedCapitalRow[]>()
      .with({ kind: 'row' }, ({ row }) => [row])
      .with({ kind: 'removal' }, () => [])
      .exhaustive(),
  );

const removalsOf = (outcomes: CapitalOutcome[]): string[] =>
  outcomes.flatMap((outcome) =>
    match(outcome)
      .returnType<string[]>()
      .with({ kind: 'row' }, () => [])
      .with({ kind: 'removal' }, ({ externalId }) => [externalId])
      .exhaustive(),
  );

/**
 * The records of one series of a span, each on its own (see `settleRecords`): one the walk cannot
 * trust owes its own point in the series, and the others still import. A record with no time to
 * give a point owes the whole span, tagged with the series, so the forward pass goes past it and
 * the other series are not held back; the tagged range is read again by every run.
 */
const settledSeriesOf = (input: {
  accountId: string;
  span: WalkWindow;
  floorMs: number;
  series: CapitalSeries;
  records: CapitalRecord[];
}): SettledSpan<PlannedCapitalRow> => {
  const { accountId, span, floorMs, series, records } = input;
  const settled = settleRecords<CapitalRecord, CapitalOutcome>({
    span,
    reach: POINT_REACH[series](span, floorMs),
    records: [...records].sort(byTimeThenKey),
    rowsOf: (record) => outcomesOf(accountId, record),
    extentOf: timeOfRecord,
    seriesOf: () => series,
    untrackedOf: untrackedTickerOf,
  });

  return {
    ...settled,
    rows: plannedRowsOf(settled.rows),
    removed: removalsOf(settled.rows),
    owed: settled.owed.map((ground) => (isPoint(ground) ? ground : { ...ground, series })),
  };
};

/** The ground a series left owed because its pages drifted: the span, in that series alone. */
const driftOf = (span: WalkWindow, drifted: CapitalSeries[]): SettledSpan<never> => ({
  rows: [],
  codes: drifted.length > 0 ? [CAPITAL_PAGE_DRIFT] : [],
  owed: drifted.map((series) => ({ ...span, series })),
  returned: [],
});

const settledSpanOf = (
  context: CapitalContext,
  span: WalkWindow,
  records: SpanRecords,
): SettledSpan<PlannedCapitalRow> =>
  joinSettled<PlannedCapitalRow>([
    driftOf(span, records.drifted),
    ...CAPITAL_SERIES.map((series) =>
      settledSeriesOf({
        accountId: context.accountId,
        span,
        floorMs: context.floorMs,
        series,
        records: records.bySeries[series],
      }),
    ),
  ]);

/**
 * Commit one span: place and write the rows of the records the walk can trust, take back the rows
 * of the deposits Bybit rolled back, then move the walk's marks (see `commitSettledSpan`: rows
 * first, marks second, so a crash between the two re-imports idempotently).
 */
const commitSpan = (
  context: CapitalContext,
  window: OwedWindow,
  span: WalkWindow,
  records: SpanRecords,
  pass: WalkPass,
): Promise<SpanCommit | undefined> =>
  commitExchangeSpan<PlannedCapitalRow, BybitCapitalRow>({
    context,
    pass,
    span,
    settled: settledSpanOf(context, span, records),
    place: (planned) =>
      placeWalletRows({
        accountId: context.accountId,
        planned,
        config: BYBIT_WALK_CONFIG,
        listHoldings: context.deps.listHoldings,
        ensureHoldings: context.deps.ensureHoldings,
        missingCode: CAPITAL_HOLDING_MISSING,
      }),
    restartMs: BYBIT_RESTART_FLOOR_MS,
    series: window.series,
    forwardOwes: CAPITAL_FORWARD_OWES,
    remove: context.deps.removeTransactions,
  });

const runSync = async (
  deps: BybitCapitalHistoryDeps,
  accountId: string,
  run: BybitHistoryRun,
): Promise<WalkResult> => {
  const now = deps.now();

  if (isBybitCoolingDown(accountId, now)) {
    return { imported: 0, complete: false };
  }

  const credentials = await deps.readCredentials(accountId);

  if (credentials === undefined) {
    return { imported: 0, complete: true };
  }

  const stored = await readWalkMarks(deps, accountId, 'capital');
  const { cursor, rescan: rescanCursor } = stored;
  const write = walkMarkWriterOf(deps, accountId, 'capital');
  const roundRobins = await readWalkRoundRobins({ stored, write });
  const floorMs = now - HISTORY_DAYS * DAY_MS;
  const pending = await readPendingMark({
    stored: stored.pending,
    owedIfUnreadable: { start: floorMs, end: cursor ?? floorMs },
    knownSeries: CAPITAL_SERIES,
    write,
  });
  const plan = planWalkPasses({
    cursor,
    rescanCursor,
    pointCursor: roundRobins.pointCursor,
    rangeCursor: roundRobins.rangeCursor,
    backfillCursor: roundRobins.backfillCursor,
    pending,
    floorMs,
    endTime: now,
    windowMs: WINDOW_MS,
    overlapMs: OVERLAP_MS,
    maxWindows: MAX_WINDOWS,
  });

  // Owed ground and owed points count: a clock that stepped back can leave nothing to read forward
  // or behind while ground is still owed.
  if ([plan.forward, plan.rescan, plan.pending, plan.points].every((list) => list.length === 0)) {
    return { imported: 0, complete: false };
  }

  const context: CapitalContext = {
    deps,
    run,
    accountId,
    apiKey: credentials.apiKey,
    secret: credentials.secret,
    options: { fetchImpl: deps.fetchImpl, now: deps.now },
    marks: { cursor, rescanCursor, ...roundRobins, pending },
    plan,
    write,
    floorMs,
  };

  const result = await runExchangeWalkPlan({
    context,
    lane: 'capital',
    cost: NO_WEIGHTS,
    isCoolingDown: isBybitCoolingDown,
    isUnreadableWindowError: (error) => error instanceof BybitHistoryParseError,
    callsOf,
    read: (window, span, keepCalls) => readSpan(context, window, span, keepCalls),
    commit: (window, span, records, pass) => commitSpan(context, window, span, records, pass),
  });
  const lastForwardEnd = foldMap(maybe(plan.forward.at(-1)), (window) => window.end);

  // A plan holds a capped number of windows: a forward pass that ends before now leaves history
  // behind the windows it read.
  return {
    ...result,
    complete: result.complete && (lastForwardEnd === undefined || lastForwardEnd >= now),
  };
};

/**
 * Import the deposits, internal deposits and withdrawals of every tracked coin as rows on the
 * Funding holding of the coin, idempotently, committing a span's rows before the walk's marks move
 * past it. A run goes forward from the cursor first, then reads the ground earlier runs left owed,
 * then re-scans the last window behind the cursor, then the owed points, each on what the lane has
 * left (see `planWalkPasses`). Missing credentials give a no-op, and so does an active cooldown.
 * `complete: false` means history, owed ground or the re-scan remains; a failure other than a rate
 * limit rejects, so the caller can log it without failing the balance sync.
 */
export const syncBybitCapitalHistory = (
  request: { targetAccountId: string; run: BybitHistoryRun },
  overrides: Partial<BybitCapitalHistoryDeps> = {},
): Promise<WalkResult> =>
  runSync(
    { ...defaultBybitCapitalHistoryDeps, ...overrides },
    request.targetAccountId,
    request.run,
  );
