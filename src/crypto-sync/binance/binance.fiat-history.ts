import { match } from 'ts-pattern';
import { DAY_MS } from '@kiko/dates';
import { bifoldMap } from 'fnts/either';
import {
  advanceWalkMarks,
  AMOUNT_STOP_CODES,
  BinanceWalkStop,
  commitSettledSpan,
  createDepthMemories,
  type DepthGuard,
  dropReadPoints,
  type ExchangeStateDeps,
  exchangeStateDepsOf,
  historyListWriterOf,
  instantAt,
  isPoint,
  joinSettled,
  notImportedWriterOf,
  type OwedGround,
  type OwedWindow,
  placeWalletRows,
  planWalkPasses,
  readPendingMark,
  readWalkMarks,
  readWalkRoundRobins,
  roundRobinHooksOf,
  rowMinorUnits,
  runWalkPlan,
  type SettledSpan,
  settleRecords,
  settleUnreadable,
  type SpanCommit,
  type SpanRead,
  type WalkMarkWriter,
  type WalkMarks,
  type WalkPass,
  type WalkPlan,
  type WalkResult,
  type WalkWindow,
  walkMarkWriterOf,
  walkSpans,
} from '@kiko/crypto-sync/exchange/walk';
import type { HoldingRow } from '@kiko/db';
import maybe, { foldMap } from 'fnts/maybe';
import type { Currency } from '@kiko/currency/currency';
import { transactionsRepo } from '@kiko/transactions/repo';
import { fiatTotalCode } from '@kiko/transactions/untracked-counterpart';
import { type ExchangeHolding, holdingsRepo } from '@kiko/holdings/repo';
import { notImportedEntry } from '@kiko/crypto-sync/exchange/walk-state';
import { readSeriesSpan, type SeriesSpan } from '@kiko/crypto-sync/exchange/paging';

import {
  type BinanceTransactionRow,
  HISTORY_FLOOR_MS,
  RESYNC_OVERLAP_MS,
} from './binance.transactions';
import {
  type BinanceHistoryRun,
  type CallCost,
  COSTS,
  LANE_CALL_CAPS,
} from './binance.history-budget';
import {
  type BinanceFiatOrder,
  type BinanceFiatPayment,
  fetchFiatOrders,
  fetchFiatPayments,
  type FiatTransactionType,
  type TotalPage,
} from './binance.history-client';
import { holdingKeyOf } from './binance.holding-keys';
import { BINANCE_WALK_CONFIG } from './binance.walk-config';
import { BINANCE_DEPTH_CONFIG } from './binance.depth-config';
import { isTrackedBinanceAsset } from './binance.tracked-coin';
import { type BinanceCredentials, readCredentials } from './binance.credentials';
import { isBinanceCoolingDown, setBinanceCooldownUntil } from './binance.cooldown';
import { BinanceHistoryTooOldError, type FetchAccountOptions } from './binance.client';

/**
 * The words of a fiat order that settle or wait. The Binance docs list eight statuses
 * (`Processing, Failed, Successful, Finished, Refunding, Refunded, Refund Failed, Order Partial
 * Credit Stopped`) and say nothing about what any of them did to the balance, so only `Successful`
 * makes a row and `Processing` owes its point; every other word, `Failed` and `Refunded` too, is
 * refused into `notImported` (spec "### Fiat orders ...", C-NR-E, S12-Q3, S12-Q13). The text is
 * matched exactly: no trim, no case fold. See `.superpowers/sdd/binance-set12/fiat-doc-quote.md`.
 */
const FIAT_ORDER_STATUSES = { settled: 'Successful', open: 'Processing' } as const;

/**
 * The words of a fiat payment that settle or wait. The Binance docs list no payment status at all,
 * so these two are the spec's and every other word is refused (S12-Q4), matched exactly like the
 * order words. See `.superpowers/sdd/binance-set12/fiat-doc-quote.md`.
 */
const FIAT_PAYMENT_STATUSES = { settled: 'Completed', open: 'Processing' } as const;

/** The stop of a record that waits on Binance: its point is owed until it is final. */
const FIAT_NOT_SETTLED = 'fiat-not-settled';

/** The stop of a page record the client could not place, such as one with no order number. */
const FIAT_RECORD_UNREADABLE = 'fiat-record-unreadable';

const FIAT_PAGE_DRIFT = 'fiat-page-drift';

const FIAT_HOLDING_MISSING = 'fiat-holding-missing';

/**
 * The stops of one record that the forward pass owes and goes past: the record stays owed at its
 * own point until it is final or the floor drops it, and holding the cursor behind it would keep
 * every newer record from importing. A stop that is no one record's (`fiat-page-drift`,
 * `fiat-holding-missing`) is not in this list.
 */
const FIAT_FORWARD_OWES: readonly string[] = [
  FIAT_NOT_SETTLED,
  FIAT_RECORD_UNREADABLE,
  ...AMOUNT_STOP_CODES,
];

/** Both fiat reads are 2 years wide at most (spec C-NR-D; probe 3 served one 2-year span). */
export const FIAT_WINDOW_MS = 730 * DAY_MS;

/** Deposit or buy (`'0'`) and withdraw or sell (`'1'`): the two series of one window. */
const FIAT_SERIES: readonly FiatTransactionType[] = ['0', '1'];

/** Safety stop on paging one series within a span of one millisecond. */
const MAX_PAGES_PER_SPAN = 50;

/**
 * A row mapped from a settled record, before its wallet is turned into a holding: `wallet` is the
 * key of the coin's Spot holding (C-NR3).
 */
type PlannedFiatRow = {
  wallet: string;
  amountMinorUnits: number;
  time: number;
  externalId: string;
  description: string;
  comment: string;
  untrackedCounterpart: string;
  operation: 'fiat' | 'card';
};

/**
 * What one record comes to: its row (`row`), the entry of a record a rule refuses for good
 * (`refused`), a record that waits on Binance (`owed`), or the ticker of a coin Kiko does not
 * track (`untracked`, counted, no row).
 */
type FiatOutcome =
  | { kind: 'row'; row: PlannedFiatRow }
  | { kind: 'refused'; entry: string }
  | { kind: 'owed' }
  | { kind: 'untracked'; ticker: string };

type FiatRecord = BinanceFiatOrder | BinanceFiatPayment;

type OutcomeInput<Item extends FiatRecord> = {
  accountId: string;
  record: Item;
  type: FiatTransactionType;
};

const refusedOutcomeOf = (record: FiatRecord): FiatOutcome => ({
  kind: 'refused',
  entry: notImportedEntry('fiat-unrecognized', record.orderNo, record.createTime),
});

/** The marker for the fiat total as Binance sent it; a total no code can carry owes the point. */
const markerOf = (kind: 'bank' | 'card', fiat: string, total: string): string =>
  bifoldMap(
    fiatTotalCode(kind, fiat, total),
    (code): string => {
      throw new BinanceWalkStop(code);
    },
    (marker) => marker,
  );

/** A blank coin cannot be told from a tracked one, so its record is refused. */
const trackedOutcomeOf = (
  record: FiatRecord,
  asset: string | undefined,
  rowOf: (tracked: Currency) => FiatOutcome,
): FiatOutcome => {
  if (asset === undefined || asset === '') {
    return refusedOutcomeOf(record);
  }

  return isTrackedBinanceAsset(asset) ? rowOf(asset) : { kind: 'untracked', ticker: asset };
};

/**
 * A fiat order settles on its fiat holding on Spot: a deposit credits `amount`, a withdraw debits
 * `amount + totalFee` (S12-Q11), and the marker keeps the gross `indicatedAmount` the bank side
 * paid. A record that lacks a text the row needs cannot be told, so it is refused.
 */
const settledOrderOutcomeOf = ({
  accountId,
  record,
  type,
}: OutcomeInput<BinanceFiatOrder>): FiatOutcome =>
  trackedOutcomeOf(record, record.fiatCurrency, (asset): FiatOutcome => {
    const { fiatCurrency, indicatedAmount, amount, totalFee } = record;

    if (
      fiatCurrency === undefined ||
      indicatedAmount === undefined ||
      amount === undefined ||
      (type === '1' && totalFee === undefined)
    ) {
      return refusedOutcomeOf(record);
    }

    const magnitude =
      rowMinorUnits(asset, amount) + (type === '1' ? rowMinorUnits(asset, totalFee ?? '0') : 0);

    if (magnitude <= 0) {
      return refusedOutcomeOf(record);
    }

    const wallet = holdingKeyOf(asset, 'spot');

    return {
      kind: 'row',
      row: {
        wallet,
        amountMinorUnits: type === '1' ? -magnitude : magnitude,
        time: record.createTime,
        externalId: `${accountId}:fiat:${record.orderNo}:${wallet}`,
        description: '',
        comment: `${indicatedAmount} ${fiatCurrency}`,
        untrackedCounterpart: markerOf('bank', fiatCurrency, indicatedAmount),
        operation: 'fiat',
      },
    };
  });

/**
 * A fiat payment settles on the Spot holding of its coin: a buy (`'0'`) credits `obtainAmount` and
 * marks the `sourceAmount` of fiat paid, a sell (`'1'`) debits `sourceAmount` of the coin and marks
 * the `obtainAmount` of fiat received. The fiat is only a label and a marker, so any code the
 * marker builder takes is kept.
 */
const settledPaymentOutcomeOf = ({
  accountId,
  record,
  type,
}: OutcomeInput<BinanceFiatPayment>): FiatOutcome =>
  trackedOutcomeOf(record, record.cryptoCurrency, (asset): FiatOutcome => {
    const { fiatCurrency, sourceAmount, obtainAmount } = record;
    const [coinAmount, fiatAmount] =
      type === '0' ? [obtainAmount, sourceAmount] : [sourceAmount, obtainAmount];

    if (fiatCurrency === undefined || coinAmount === undefined || fiatAmount === undefined) {
      return refusedOutcomeOf(record);
    }

    const magnitude = rowMinorUnits(asset, coinAmount);

    if (magnitude <= 0) {
      return refusedOutcomeOf(record);
    }

    const wallet = holdingKeyOf(asset, 'spot');

    return {
      kind: 'row',
      row: {
        wallet,
        amountMinorUnits: type === '0' ? magnitude : -magnitude,
        time: record.createTime,
        externalId: `${accountId}:fiatpay:${record.orderNo}:${wallet}`,
        description: '',
        comment: `${fiatAmount} ${fiatCurrency}`,
        untrackedCounterpart: markerOf('card', fiatCurrency, fiatAmount),
        operation: 'card',
      },
    };
  });

/**
 * What one fiat order comes to, decided by its status first and by the status text exactly as
 * Binance sent it (`FIAT_ORDER_STATUSES`): only a settled order makes a row, one that waits owes
 * its point, and every other word is refused for good.
 */
const fiatOrderOutcomeOf = (input: OutcomeInput<BinanceFiatOrder>): FiatOutcome =>
  match(input.record.status)
    .returnType<FiatOutcome>()
    .with(FIAT_ORDER_STATUSES.settled, () => settledOrderOutcomeOf(input))
    .with(FIAT_ORDER_STATUSES.open, () => ({ kind: 'owed' }))
    .otherwise(() => refusedOutcomeOf(input.record));

/** What one fiat payment comes to, as `fiatOrderOutcomeOf` with `FIAT_PAYMENT_STATUSES`. */
const fiatPaymentOutcomeOf = (input: OutcomeInput<BinanceFiatPayment>): FiatOutcome =>
  match(input.record.status)
    .returnType<FiatOutcome>()
    .with(FIAT_PAYMENT_STATUSES.settled, () => settledPaymentOutcomeOf(input))
    .with(FIAT_PAYMENT_STATUSES.open, () => ({ kind: 'owed' }))
    .otherwise(() => refusedOutcomeOf(input.record));

/** The imported-transaction shape the fiat walks hand to `transactionsRepo.addManyDedup`. */
type BinanceFiatRow = BinanceTransactionRow & {
  untrackedCounterpart: string;
  operation: 'fiat' | 'card';
};

type FiatRead<Item> = (
  apiKey: string,
  secret: string,
  type: FiatTransactionType,
  span: WalkWindow,
  page: number,
  options?: FetchAccountOptions,
) => Promise<TotalPage<Item>>;

/**
 * The seams the two fiat walks share: the credential and holding reads, the insert-only holding
 * creation, the deduping import, and the walk state read and write. Pacing and the weight budget
 * come from the run.
 */
type FiatCommonDeps = ExchangeStateDeps & {
  now: () => number;
  fetchImpl: typeof fetch;
  readCredentials: (accountId: string) => Promise<BinanceCredentials | undefined>;
  listHoldings: (accountId: string) => Promise<HoldingRow[]>;
  ensureHoldings: (holdings: ExchangeHolding[]) => Promise<void>;
  addTransactions: (rows: BinanceFiatRow[]) => Promise<number>;
};

/** The seams of the fiat order walk: the common ones and the read of one page of one type. */
export type BinanceFiatOrderHistoryDeps = FiatCommonDeps & {
  fetchFiatOrders: FiatRead<BinanceFiatOrder>;
};

/** The seams of the fiat payment walk: the common ones and the read of one page of one type. */
export type BinanceFiatPaymentHistoryDeps = FiatCommonDeps & {
  fetchFiatPayments: FiatRead<BinanceFiatPayment>;
};

const defaultCommonDeps: FiatCommonDeps = {
  ...exchangeStateDepsOf('binance'),
  now: () => Date.now(),
  fetchImpl: fetch,
  readCredentials,
  listHoldings: async (accountId) => holdingsRepo.listByAccountQuery(accountId),
  ensureHoldings: (holdings) => holdingsRepo.ensureExchangeHoldings(holdings),
  addTransactions: (rows) => transactionsRepo.addManyDedup(rows),
};

/** What tells the two walks apart: the walk (and lane), its cost, its read and its decision. */
type FiatWalk<Item extends FiatRecord> = {
  walkId: 'fiatOrders' | 'fiatPayments';
  cost: CallCost;
  read: FiatRead<Item>;
  outcomeOf: (input: OutcomeInput<Item>) => FiatOutcome;
};

type FiatContext<Item extends FiatRecord> = {
  deps: FiatCommonDeps;
  walk: FiatWalk<Item>;
  run: BinanceHistoryRun;
  accountId: string;
  apiKey: string;
  secret: string;
  options: FetchAccountOptions;
  marks: WalkMarks;
  plan: WalkPlan;
  write: WalkMarkWriter;
  depthMemories: Pick<DepthGuard, 'config' | 'memoryOf' | 'hintMs' | 'refusedBoundMs'>;
};

/** The types a window is read in: both, or the one its owed points name. */
const typesOf = (window: OwedWindow): readonly FiatTransactionType[] =>
  window.series === undefined
    ? FIAT_SERIES
    : FIAT_SERIES.filter((type) => window.series?.includes(type));

/** The calls one read of a window costs: one for each type it asks. */
const callsOf = (window: OwedWindow): number => typesOf(window).length;

/**
 * One span read on every type of `window`. A type whose first page is full with more records
 * behind it halves the span (every type is read again in the half). `undefined` is a clean stop:
 * the budget cannot afford every type, or Binance rate-limited (which also sets the account's
 * cooldown). `keep` calls stay unspent for the passes that come later in the run.
 *
 * A start Binance refuses as older than it keeps (-5026) is not read as empty: each type is read
 * from the oldest start Binance serves it (see `readSeriesSpan`). Probe 5 saw no such refusal, so
 * this is a safety net.
 */
const readSpan = <Item extends FiatRecord>(
  context: FiatContext<Item>,
  window: OwedWindow,
  span: WalkWindow,
  keep: number,
): Promise<SpanRead<SeriesSpan<FiatTransactionType, Item>> | undefined> => {
  const { deps, walk, run, accountId, apiKey, secret, options } = context;

  return readSeriesSpan({
    run,
    config: BINANCE_WALK_CONFIG,
    lane: walk.walkId,
    cost: walk.cost,
    span,
    keep,
    series: typesOf(window),
    maxPages: MAX_PAGES_PER_SPAN,
    fetchPage: (type, read, page) => walk.read(apiKey, secret, type, read, page, options),
    onRateLimit: (error) => setBinanceCooldownUntil(accountId, deps.now() + error.retryAfterMs),
    depth: {
      isRefusal: (error) => error instanceof BinanceHistoryTooOldError,
      nowMs: deps.now,
      floorMs: () => HISTORY_FLOOR_MS,
      ...context.depthMemories,
    },
  });
};

type SettledOutcome = Exclude<FiatOutcome, { kind: 'owed' }>;

/** One record's outcome; a record that waits on Binance owes its point (a `BinanceWalkStop`). */
const settledOutcomeOf = <Item extends FiatRecord>(
  walk: FiatWalk<Item>,
  input: OutcomeInput<Item>,
): SettledOutcome => {
  const outcome = walk.outcomeOf(input);

  if (outcome.kind === 'owed') {
    throw new BinanceWalkStop(FIAT_NOT_SETTLED);
  }

  return outcome;
};

/** What one record adds to its span: its rows, the tickers it names, and its refusal entry. */
type RecordParts = { rows: PlannedFiatRow[]; untracked: string[]; notImported: string[] };

const partsOf = (outcome: SettledOutcome): RecordParts =>
  match(outcome)
    .returnType<RecordParts>()
    .with({ kind: 'row' }, ({ row }) => ({ rows: [row], untracked: [], notImported: [] }))
    .with({ kind: 'refused' }, ({ entry }) => ({ rows: [], untracked: [], notImported: [entry] }))
    .with({ kind: 'untracked' }, ({ ticker }) => ({
      rows: [],
      untracked: [ticker],
      notImported: [],
    }))
    .exhaustive();

type TypedRecord<Item> = { type: FiatTransactionType; record: Item };

/**
 * The records of one span, each on its own (see `settleRecords`): a record that waits, or one the
 * walk cannot trust, or a row the client could not read, owes its own point on the type it was
 * read under and the others still import. A record a rule refuses for good is listed once, and the
 * tickers of the coins the walk does not track are named. A type whose pages drifted is no one
 * record's stop: the span is owed, as a range, on that type alone. The ground a type left owed in
 * itself is owed as a range on that type alone, and holds nothing back.
 */
const settledRecordsOf = <Item extends FiatRecord>(input: {
  walk: FiatWalk<Item>;
  accountId: string;
  span: WalkWindow;
  read: SeriesSpan<FiatTransactionType, Item>;
}): SettledSpan<PlannedFiatRow> => {
  const { walk, accountId, span, read } = input;
  const settled = settleRecords<TypedRecord<Item>, SettledOutcome>({
    span,
    records: read.read.flatMap(({ series, rows }) =>
      rows.map((record) => ({ type: series, record })),
    ),
    rowsOf: ({ type, record }) => [settledOutcomeOf(walk, { accountId, record, type })],
    extentOf: ({ record }) => instantAt(record.createTime),
    seriesOf: ({ type }) => type,
  });
  const parts = settled.rows.map(partsOf);

  return joinSettled<PlannedFiatRow>([
    {
      rows: [],
      codes: [],
      owed: (read.owed ?? []).map(({ series, window }) => ({ ...window, series })),
      returned: [],
    },
    ...(read.drifted.length > 0
      ? [
          {
            rows: [],
            codes: [FIAT_PAGE_DRIFT],
            owed: read.drifted.map((series) => ({ ...span, series })),
            returned: [],
          },
        ]
      : []),
    {
      ...settled,
      rows: parts.flatMap((part) => part.rows),
      untracked: parts.flatMap((part) => part.untracked),
      notImported: parts.flatMap((part) => part.notImported),
    },
    settleUnreadable({
      span,
      unreadable: read.read.flatMap(({ series, unreadable }) =>
        unreadable.map((row) => ({ ...row, type: series })),
      ),
      code: FIAT_RECORD_UNREADABLE,
      extentOf: (row) => foldMap(maybe(row.time), (time) => instantAt(Number(time))),
      seriesOf: (row) => row.type,
    }),
  ]);
};

/**
 * Commit one span's read: place and write the rows of the records the walk can trust, then move
 * the walk's marks (see `commitSettledSpan`: rows first, marks second, so a crash between the two
 * just re-imports idempotently). One row per key: a record on the boundary of two spans is read
 * twice.
 */
const commitSpan = <Item extends FiatRecord>(
  context: FiatContext<Item>,
  window: OwedWindow,
  span: WalkWindow,
  read: SeriesSpan<FiatTransactionType, Item>,
  pass: WalkPass,
): Promise<SpanCommit | undefined> => {
  const { deps, walk, accountId, plan, marks, write } = context;

  return commitSettledSpan({
    pass,
    span,
    settled: settledRecordsOf({ walk, accountId, span, read }),
    forwardOwes: FIAT_FORWARD_OWES,
    place: (planned) =>
      placeWalletRows({
        accountId,
        planned,
        config: BINANCE_WALK_CONFIG,
        listHoldings: deps.listHoldings,
        ensureHoldings: deps.ensureHoldings,
        missingCode: FIAT_HOLDING_MISSING,
      }),
    add: deps.addTransactions,
    writeOversized: historyListWriterOf(deps, accountId, 'oversizedCoins'),
    writeUntracked: historyListWriterOf(deps, accountId, 'untrackedCoins'),
    writeNotImported: notImportedWriterOf(deps, accountId),
    advance: ({ owed }) =>
      advanceWalkMarks({
        pass,
        span,
        series: window.series,
        owed,
        plan,
        marks,
        restartMs: HISTORY_FLOOR_MS,
        write,
      }),
  });
};

/**
 * A lane that cannot afford a forward read and a re-scan read in one run (both series of a window
 * each) alternates the two across runs: the re-scan is the walk's window re-scan, and a lane that
 * never read it would lose every record Binance writes late (S12-Q18).
 */
const alternatesTurns = (walkId: FiatWalk<FiatRecord>['walkId']): boolean =>
  LANE_CALL_CAPS[walkId] < 2 * FIAT_SERIES.length;

const holdsRange = (pending: OwedGround[]): boolean => pending.some((ground) => !isPoint(ground));

type FiatTurn = 'forward' | 'behind';

/**
 * A run reads behind (owed ranges first, the re-scan once none is left, which also takes the
 * overlap day out of the list) when the list holds a range and the forward ground is under one
 * window; every other run reads forward. A forward read that is a window or more behind goes first,
 * so a catch-up reaches now before it looks back; the forward read that stores an overlap day makes
 * the next run a behind one.
 */
const turnOf = (pending: OwedGround[], plan: WalkPlan, endTime: number): FiatTurn =>
  holdsRange(pending) && endTime - (plan.forward.at(0)?.start ?? endTime) < FIAT_WINDOW_MS
    ? 'behind'
    : 'forward';

/**
 * The plan one turn runs. The commits keep the whole plan: the forward pass stores its
 * `pendingRanges` and the re-scan ends at its `rescanEnd`.
 */
const planOfTurn = (plan: WalkPlan, turn: FiatTurn): WalkPlan =>
  turn === 'behind'
    ? { ...plan, forward: [], rescan: plan.pending.length > 0 ? [] : plan.rescan }
    : { ...plan, pending: [], rescan: [] };

/**
 * Whether a run of an alternating lane started with no range owed and the re-scan not part way
 * through a pass: a forward read leaves the ground behind unread, so only one that started with
 * none owed is complete, and a behind run, which starts with a range, never is. The overlap day
 * the forward read stores is the next behind run's.
 */
const startedWithNothingBehind = (pending: OwedGround[], rescanCursor: number | null): boolean =>
  !holdsRange(pending) && (rescanCursor ?? HISTORY_FLOOR_MS) <= HISTORY_FLOOR_MS;

const runSync = async <Item extends FiatRecord>(
  deps: FiatCommonDeps,
  walk: FiatWalk<Item>,
  accountId: string,
  run: BinanceHistoryRun,
): Promise<WalkResult> => {
  if (isBinanceCoolingDown(accountId, deps.now())) {
    return { imported: 0, complete: false };
  }

  const credentials = await deps.readCredentials(accountId);

  if (credentials === undefined) {
    return { imported: 0, complete: true };
  }

  const stored = await readWalkMarks(deps, accountId, walk.walkId);
  const { cursor, rescan: rescanCursor } = stored;
  const write = walkMarkWriterOf(deps, accountId, walk.walkId);
  const roundRobins = await readWalkRoundRobins({ stored, write });
  const pending = await readPendingMark({
    stored: stored.pending,
    owedIfUnreadable: { start: HISTORY_FLOOR_MS, end: cursor ?? HISTORY_FLOOR_MS },
    knownSeries: FIAT_SERIES,
    write,
  });
  const endTime = deps.now();
  const plan = planWalkPasses({
    cursor,
    rescanCursor,
    pointCursor: roundRobins.pointCursor,
    rangeCursor: roundRobins.rangeCursor,
    pending,
    floorMs: HISTORY_FLOOR_MS,
    endTime,
    windowMs: FIAT_WINDOW_MS,
    overlapMs: RESYNC_OVERLAP_MS,
    maxWindows: Math.floor(LANE_CALL_CAPS[walk.walkId] / FIAT_SERIES.length),
  });

  if (plan.forward.length === 0 && plan.rescan.length === 0) {
    return { imported: 0, complete: false };
  }

  const context: FiatContext<Item> = {
    deps,
    walk,
    run,
    accountId,
    ...credentials,
    options: { fetchImpl: deps.fetchImpl, now: deps.now },
    marks: { cursor, rescanCursor, ...roundRobins, pending },
    plan,
    write,
    depthMemories: createDepthMemories(deps.now, BINANCE_DEPTH_CONFIG),
  };

  const turn = alternatesTurns(walk.walkId) ? turnOf(pending, plan, endTime) : undefined;
  const result = await runWalkPlan({
    plan: turn === undefined ? plan : planOfTurn(plan, turn),
    callsOf,
    canAfford: (keep) =>
      run.budget.canAfford(walk.walkId, walk.cost, keep) &&
      !isBinanceCoolingDown(accountId, deps.now()),
    runWindow: (window, pass, keep, hint) =>
      walkSpans({
        window,
        read: (span, keepCalls) => readSpan(context, window, span, keepCalls),
        commit: (span, read) => commitSpan(context, window, span, read, pass),
        keep,
        hint,
        onComplete: (read) => dropReadPoints({ pass, window, read, marks: context.marks, write }),
      }),
    ...roundRobinHooksOf({ marks: context.marks, write }),
  });
  const lastWindowEnd = plan.forward.at(-1)?.end;

  // A plan holds the lane's windows a run at most, so one that ends before now has more history
  // behind it than the windows it read.
  return {
    ...result,
    complete:
      result.complete &&
      (lastWindowEnd === undefined || lastWindowEnd >= endTime) &&
      (turn === undefined || startedWithNothingBehind(pending, rescanCursor)),
  };
};

const defaultOrderDeps: BinanceFiatOrderHistoryDeps = { ...defaultCommonDeps, fetchFiatOrders };

const defaultPaymentDeps: BinanceFiatPaymentHistoryDeps = {
  ...defaultCommonDeps,
  fetchFiatPayments,
};

type FiatRequest = { targetAccountId: string; run: BinanceHistoryRun };

/**
 * Import the user's successful fiat deposits and withdrawals as transactions on the Spot holding
 * of their fiat, marked with the bank total (C-NR1), and list every record whose status is not
 * `Successful` or `Processing` as not recognized. The walk reads 2-year windows forward from the
 * history floor, a deposit and a withdraw series in each, empty ones too; the lane holds a window
 * a run, so the first walk takes several runs, and a run reads forward or behind, not both
 * (`turnOf`). `complete: false` means history, owed ground or the re-scan remains, and a run that
 * read behind is never complete; a later run resumes from the stored marks. A failure other than a
 * rate limit rejects, so the caller can log it without failing the balance sync.
 */
export const syncBinanceFiatOrderHistory = (
  request: FiatRequest,
  overrides: Partial<BinanceFiatOrderHistoryDeps> = {},
): Promise<WalkResult> => {
  const deps = { ...defaultOrderDeps, ...overrides };

  return runSync(
    deps,
    {
      walkId: 'fiatOrders',
      cost: COSTS.fiatOrders,
      read: deps.fetchFiatOrders,
      outcomeOf: fiatOrderOutcomeOf,
    },
    request.targetAccountId,
    request.run,
  );
};

/**
 * Import the user's completed card buys and sells as transactions on the Spot holding of their
 * coin, marked with the fiat total (C-NR1), and list every record whose status is not `Completed`
 * or `Processing` as not recognized. Windows and failures are those of
 * `syncBinanceFiatOrderHistory`; the lane is wide enough to read forward and re-scan in one run.
 */
export const syncBinanceFiatPaymentHistory = (
  request: FiatRequest,
  overrides: Partial<BinanceFiatPaymentHistoryDeps> = {},
): Promise<WalkResult> => {
  const deps = { ...defaultPaymentDeps, ...overrides };

  return runSync(
    deps,
    {
      walkId: 'fiatPayments',
      cost: COSTS.fiatPayments,
      read: deps.fetchFiatPayments,
      outcomeOf: fiatPaymentOutcomeOf,
    },
    request.targetAccountId,
    request.run,
  );
};
