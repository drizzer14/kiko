import { DAY_MS } from '@kiko/dates';
import { match, P } from 'ts-pattern';
import {
  AMOUNT_STOP_CODES,
  BinanceWalkStop,
  commitExchangeSpan,
  joinSettled,
  type OwedWindow,
  rowMinorUnits,
  type SettledSpan,
  settleRecords,
  type SpanCommit,
  type SpanRead,
  type WalkPass,
  type WalkResult,
  type WalkWindow,
} from '@kiko/crypto-sync/exchange/walk';
import { transactionsRepo } from '@kiko/transactions/repo';

import {
  BYBIT_PAGE_DRIFT,
  type BybitRowWalkDeps,
  type BybitWalkContext,
  byTimeThenKey,
  defaultBybitRowWalkDeps,
  driftOf,
  flooredStart,
  placeBybitWindowRows,
  readUnderCooldown,
  runBybitWalk,
  taggedWith,
} from './bybit.walk-run';
import {
  fetchDepositPage,
  fetchInternalDepositPage,
  fetchWithdrawalPage,
  timeOfItem,
} from './bybit.history-client';
import { holdingKeyOf } from './bybit.holding-keys';
import { readCursorSpan } from './bybit.cursor-span';
import { isTrackedBybitAsset } from './bybit.tracked-coin';
import { BYBIT_RESTART_FLOOR_MS } from './bybit.restart-floor';
import { BYBIT_RESCAN_WINDOWS_MS } from './bybit.rescan-window';
import { BYBIT_LANE_CALL_CAPS, type BybitHistoryRun } from './bybit.history-budget';

const CAPITAL_SERIES = ['deposit', 'internal', 'withdraw'] as const;

type CapitalSeries = (typeof CAPITAL_SERIES)[number];

/**
 * Bybit's deposit and internal-deposit routes take a window under 30 days, and a withdrawal's
 * accepts the same: 29 days stays under the stated limit.
 */
const WINDOW_MS = BYBIT_RESCAN_WINDOWS_MS.capital;

/** A window costs one call per series, and the lane spends its calls on windows. */
const MAX_WINDOWS = BYBIT_LANE_CALL_CAPS.capital / CAPITAL_SERIES.length;

const CAPITAL_ROW_UNREADABLE = 'capital-row-unreadable';

const CAPITAL_NOT_SETTLED = 'capital-not-settled';

const CAPITAL_DEPOSIT_TYPE = 'capital-deposit-type';

const CAPITAL_TIME_MISSING = 'capital-time-missing';

const CAPITAL_AMOUNT_INVALID = 'capital-amount-invalid';

const CAPITAL_HOLDING_MISSING = 'capital-holding-missing';

/**
 * The stops of one record that the forward pass owes and goes past: the record stays owed at its
 * own point, or its span stays owed in its series, until a read settles it or the floor drops it,
 * and holding the cursor behind it would keep every newer record from importing. A page that
 * drifted is owed as the span in its own series alone, so it is in this list too: a deposit route
 * that repeats a cursor on every run must not hold back the other series. A holding that cannot be
 * found is no series' stop and is not in this list.
 */
const CAPITAL_FORWARD_OWES: readonly string[] = [
  CAPITAL_ROW_UNREADABLE,
  CAPITAL_NOT_SETTLED,
  CAPITAL_DEPOSIT_TYPE,
  CAPITAL_TIME_MISSING,
  CAPITAL_AMOUNT_INVALID,
  BYBIT_PAGE_DRIFT,
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

/** Bybit states that the funds of this `depositType` are not credited to the account. */
const NOT_CREDITED_DEPOSIT_TYPE = '50';

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

type BybitCapitalHistoryDeps = BybitRowWalkDeps<BybitCapitalRow> & {
  removeTransactions: (externalIds: readonly string[]) => Promise<number>;
  fetchDepositPage: typeof fetchDepositPage;
  fetchInternalDepositPage: typeof fetchInternalDepositPage;
  fetchWithdrawalPage: typeof fetchWithdrawalPage;
};

const defaultBybitCapitalHistoryDeps: BybitCapitalHistoryDeps = {
  ...defaultBybitRowWalkDeps,
  removeTransactions: (externalIds) => transactionsRepo.removeSyncedRows('bybit', externalIds),
  fetchDepositPage,
  fetchInternalDepositPage,
  fetchWithdrawalPage,
};

type CapitalContext = BybitWalkContext<BybitCapitalHistoryDeps>;

const externalIdOf = (accountId: string, kind: string, id: string, coin: string): string =>
  `${accountId}:${kind}:${id}:${coin}`;

/**
 * Map one record of a tracked coin to a row on the Funding holding of its coin: the pages name no
 * wallet for a deposit or a withdrawal, and Funding is where they place them. An amount of zero
 * moves no money, so it gives no row and owes nothing. A record the walk cannot trust (a negative
 * amount, an amount it cannot read exactly, no time to date the row by) stops that record alone,
 * and a skipped one would be silent loss.
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

  if (minorUnits === 0) {
    return [];
  }

  if (minorUnits < 0) {
    throw new BinanceWalkStop(CAPITAL_AMOUNT_INVALID);
  }

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
      () => row.depositType === NOT_CREDITED_DEPOSIT_TYPE,
      () => [],
    )
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
const timeOfRecord = (record: CapitalRecord): WalkWindow | undefined => timeOfItem(record.item);

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
    records: [...records].sort(byTimeThenKey(timeOfRecord, keyOf)),
    rowsOf: (record) => outcomesOf(accountId, record),
    extentOf: timeOfRecord,
    seriesOf: () => series,
    untrackedOf: untrackedTickerOf,
  });

  return {
    ...settled,
    rows: plannedRowsOf(settled.rows),
    removed: removalsOf(settled.rows),
    owed: taggedWith(series, settled.owed),
  };
};

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
    place: (planned) => placeBybitWindowRows(context, planned, CAPITAL_HOLDING_MISSING),
    restartMs: BYBIT_RESTART_FLOOR_MS,
    series: window.series,
    forwardOwes: CAPITAL_FORWARD_OWES,
    remove: context.deps.removeTransactions,
  });

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
  runBybitWalk({
    deps: { ...defaultBybitCapitalHistoryDeps, ...overrides },
    accountId: request.targetAccountId,
    run: request.run,
    walkId: 'capital',
    lane: 'capital',
    series: CAPITAL_SERIES,
    windowMs: WINDOW_MS,
    maxWindows: MAX_WINDOWS,
    callsOf,
    read: (context, window, span, keep) =>
      readUnderCooldown(context, () => readSeriesOf(context, seriesOf(window), span, keep)),
    commit: commitSpan,
  });
