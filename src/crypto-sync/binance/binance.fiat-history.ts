import { match } from 'ts-pattern';
import { DAY_MS } from '@kiko/dates';
import { bifoldMap } from 'fnts/either';
import {
  advanceWalkMarks,
  AMOUNT_STOP_CODES,
  BinanceWalkStop,
  buildWalkWindows,
  commitSettledSpan,
  createDepthMemories,
  type DepthGuard,
  dropReadPoints,
  type ExchangeStateDeps,
  exchangeStateDepsOf,
  halfOf,
  historyListWriterOf,
  instantAt,
  isPoint,
  joinSettled,
  logWalkStop,
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
  type WindowOutcome,
  walkMarkWriterOf,
  walkSpans,
} from '@kiko/crypto-sync/exchange/walk';
import type { HoldingRow } from '@kiko/db';
import maybe, { foldMap } from 'fnts/maybe';
import {
  type BinanceSpanHints,
  notImportedEntry,
  type WalkMarkPatch,
} from '@kiko/crypto-sync/exchange/walk-state';
import type { Currency } from '@kiko/currency/currency';
import { transactionsRepo } from '@kiko/transactions/repo';
import { fiatTotalCode } from '@kiko/transactions/untracked-counterpart';
import { type ExchangeHolding, holdingsRepo } from '@kiko/holdings/repo';
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
  BinanceHistoryParseError,
  fetchFiatOrders,
  fetchFiatPayments,
  type FiatTransactionType,
  type TotalPage,
} from './binance.history-client';
import { holdingKeyOf } from './binance.holding-keys';
import { BINANCE_DEPTH_CONFIG } from './binance.depth-config';
import { isTrackedBinanceAsset } from './binance.tracked-coin';
import { type BinanceCredentials, readCredentials } from './binance.credentials';
import { isBinanceCoolingDown, setBinanceCooldownUntil } from './binance.cooldown';
import { BINANCE_WALK_CONFIG, isUnreadableWindowError } from './binance.walk-config';
import { BinanceHistoryTooOldError, type FetchAccountOptions } from './binance.client';

/**
 * The words of a fiat order that settle or wait. The Binance docs list eight statuses
 * (`Processing, Failed, Successful, Finished, Refunding, Refunded, Refund Failed, Order Partial
 * Credit Stopped`) and say nothing about what any of them did to the balance, so only `Successful`
 * makes a row and `Processing` owes its point; every other word, `Failed` and `Refunded` too, is
 * refused into `notImported` (spec "### Fiat orders ...", C-NR-E, S12-Q3, S12-Q13). The text is
 * matched exactly: no trim, no case fold. The status list is quoted from Binance's own fiat order
 * documentation, which names the eight words and describes none of them.
 */
const FIAT_ORDER_STATUSES = { settled: 'Successful', open: 'Processing' } as const;

/**
 * The words of a fiat payment that settle or wait. The Binance docs list no payment status at all,
 * so these two are the spec's and every other word is refused (S12-Q4), matched exactly like the
 * order words: the payment documentation of Binance lists none, so no word of it is quoted.
 */
const FIAT_PAYMENT_STATUSES = { settled: 'Completed', open: 'Processing' } as const;

/** The stop of a record that waits on Binance: its point is owed until it is final. */
const FIAT_NOT_SETTLED = 'fiat-not-settled';

/** The stop of a page record the client could not place, such as one with no order number. */
const FIAT_RECORD_UNREADABLE = 'fiat-record-unreadable';

const FIAT_PAGE_DRIFT = 'fiat-page-drift';

/** The stop of a range the window re-scan failed to read: the re-scan reads around it. */
const FIAT_RESCAN_STUCK = 'fiat-rescan-stuck';

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
  /** The ranges the re-scan reads around, as the run last wrote the walk's `rescanStuck` mark. */
  rescanStuck: WalkWindow[];
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
const readSpanOnce = <Item extends FiatRecord>(
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

type SpanReading<Item extends FiatRecord> =
  | SpanRead<SeriesSpan<FiatTransactionType, Item>>
  | undefined;

/** The read of a span, or `failed`: a type's pages drifted, or a page could not be parsed. */
type Attempt<Item extends FiatRecord> =
  | { kind: 'read'; reading: SpanReading<Item> }
  | { kind: 'failed' };

const attemptSpan = async <Item extends FiatRecord>(
  context: FiatContext<Item>,
  window: OwedWindow,
  span: WalkWindow,
  keep: number,
): Promise<Attempt<Item>> => {
  try {
    const reading = await readSpanOnce(context, window, span, keep);

    return reading?.kind === 'page' && reading.page.drifted.length > 0
      ? { kind: 'failed' }
      : { kind: 'read', reading };
  } catch (error) {
    if (!(error instanceof BinanceHistoryParseError)) {
      throw error;
    }

    // The call that came back unreadable was made, so the lane counts it.
    context.run.budget.record(context.walk.walkId, {
      usedUidWeight1m: undefined,
      usedIpWeight1m: undefined,
    });

    return { kind: 'failed' };
  }
};

const touches = (left: WalkWindow, right: WalkWindow): boolean =>
  left.start <= right.end && left.end >= right.start;

/** Whether two ranges share more than their boundary millisecond. */
const overlaps = (left: WalkWindow, right: WalkWindow): boolean =>
  left.start < right.end && left.end > right.start;

const byStart = (left: WalkWindow, right: WalkWindow): number => left.start - right.start;

/** The span read as owed, nothing of it read: the ground a stuck range holds in `ground`. */
const owedSpan = <Item extends FiatRecord>(
  window: OwedWindow,
  ground: WalkWindow,
): SpanReading<Item> => ({
  kind: 'page',
  page: {
    read: [],
    drifted: [],
    owed:
      ground.start < ground.end
        ? typesOf(window).map((series) => ({ series, window: ground }))
        : [],
  },
});

/** Mark `range` as one the re-scan reads around, and log it: the read of it failed. */
const markStuck = async <Item extends FiatRecord>(
  context: FiatContext<Item>,
  range: WalkWindow,
): Promise<void> => {
  context.rescanStuck = [...context.rescanStuck, { start: range.start, end: range.end }];
  logWalkStop(FIAT_RESCAN_STUCK);
  await context.write([{ field: 'rescanStuck', value: context.rescanStuck }]);
};

/**
 * A span that holds a range the re-scan failed on: read what is before it, then what is after it,
 * and owe what is in it. The range stays in the list of owed ground, and its own windows are read
 * by the owed runs (`withStuckWindows`). The piece after it runs to the window end, not to the end
 * of the span: the span is a doubled hint, and ending the piece there would read the rest of the
 * window in pieces that double from the range on.
 */
const aroundStuck = <Item extends FiatRecord>(
  window: OwedWindow,
  span: WalkWindow,
  stuck: WalkWindow,
): SpanReading<Item> => {
  if (span.start < stuck.start - 1) {
    return { kind: 'split', half: { start: span.start, end: stuck.start - 1 } };
  }

  if (span.end > stuck.end + 1) {
    return { kind: 'split', half: { start: stuck.end + 1, end: window.end } };
  }

  return owedSpan(window, {
    start: Math.max(span.start, stuck.start),
    end: Math.min(span.end, stuck.end),
  });
};

/**
 * One span of the re-scan. A span that holds a range the re-scan failed on is read around it
 * (`aroundStuck`). A read that fails (a type's pages drift, or a page cannot be parsed) isolates
 * the stuck part and reads the rest of the window: it marks the first range of the owed list the
 * span holds as stuck, or halves the span when it holds none, and a span of one millisecond that
 * fails is owed and marked stuck itself.
 */
const readRescanSpan = async <Item extends FiatRecord>(
  context: FiatContext<Item>,
  window: OwedWindow,
  span: WalkWindow,
  keep: number,
): Promise<SpanReading<Item>> => {
  const stuck = context.rescanStuck
    .filter((range) => touches(range, span))
    .sort(byStart)
    .at(0);

  if (stuck !== undefined) {
    return aroundStuck(window, span, stuck);
  }

  const attempt = await attemptSpan(context, window, span, keep);

  if (attempt.kind === 'read') {
    return attempt.reading;
  }

  const owed = context.marks.pending
    .filter((ground) => !isPoint(ground) && touches(ground, span))
    .sort(byStart)
    .at(0);

  if (owed !== undefined) {
    await markStuck(context, owed);

    return readRescanSpan(context, window, span, keep);
  }

  const half = halfOf(span);

  if (half !== undefined) {
    return { kind: 'split', half };
  }

  await markStuck(context, span);

  return owedSpan(window, span);
};

const readSpan = <Item extends FiatRecord>(
  context: FiatContext<Item>,
  window: OwedWindow,
  span: WalkWindow,
  keep: number,
  pass: WalkPass,
): Promise<SpanReading<Item>> =>
  pass === 'rescan'
    ? readRescanSpan(context, window, span, keep)
    : readSpanOnce(context, window, span, keep);

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

/** Forward, or behind on the owed windows, or behind on the window re-scan. */
type FiatTurn = 'forward' | 'owed' | 'rescan';

/** The two marks of the turns: the last run read behind, and the next behind run is the re-scan. */
type StoredTurn = { behindRun: boolean; rescanTurn: boolean };

/**
 * The behind run that follows a forward run: the owed windows and the re-scan take turns, so a
 * range that no read clears cannot keep the re-scan out, and a re-scan that never ends cannot
 * keep the owed windows out. A turn with nothing to read gives way to the other one.
 */
const behindTurnOf = (plan: WalkPlan, rescanTurn: boolean): FiatTurn =>
  plan.pending.length > 0 && !(rescanTurn && plan.rescan.length > 0) ? 'owed' : 'rescan';

/**
 * A run reads behind when the list holds a range, the forward ground is under one window and the
 * last run did not read behind, or when there is no forward ground to read (the clock stands at
 * the cursor or was set back to before it); every other run reads forward. A forward read that is
 * a window or more behind goes first, so a catch-up reaches now before it looks back; the forward
 * read that stores an overlap day makes the next run a behind one, but a forward read of no ground
 * stores none, so a run with nothing to read forward would read nothing and the walk would never
 * re-scan. The run after a behind run reads forward, so a range that no read clears cannot keep
 * the newest orders out; with no forward ground there are none to keep out.
 */
const turnOf = (input: {
  pending: OwedGround[];
  plan: WalkPlan;
  endTime: number;
  stored: StoredTurn;
}): FiatTurn =>
  input.plan.forward.length === 0 ||
  (holdsRange(input.pending) &&
    !input.stored.behindRun &&
    input.endTime - (input.plan.forward.at(0)?.start ?? input.endTime) < FIAT_WINDOW_MS)
    ? behindTurnOf(input.plan, input.stored.rescanTurn)
    : 'forward';

/**
 * The plan one turn runs. The commits keep the whole plan: the forward pass stores its
 * `pendingRanges` and the re-scan ends at its `rescanEnd`.
 */
const planOfTurn = (plan: WalkPlan, turn: FiatTurn): WalkPlan =>
  match(turn)
    .returnType<WalkPlan>()
    .with('forward', () => ({ ...plan, pending: [], rescan: [] }))
    .with('owed', () => ({ ...plan, forward: [], rescan: [] }))
    .with('rescan', () => ({ ...plan, forward: [], pending: [] }))
    .exhaustive();

/**
 * Store the marks of this run's turn before it reads, so the run after it reads forward even when
 * this one fails, and the behind runs take turns even when one of them fails. The forward run
 * keeps the turn of the next behind run. A value that is already stored is not written again.
 */
const storeTurn = async (input: {
  write: WalkMarkWriter;
  turn: FiatTurn;
  stored: StoredTurn;
}): Promise<void> => {
  const { write, turn, stored } = input;
  const next: StoredTurn = {
    behindRun: turn !== 'forward',
    rescanTurn: turn === 'forward' ? stored.rescanTurn : turn === 'owed',
  };
  const patches: WalkMarkPatch[] = (['behindRun', 'rescanTurn'] as const)
    .filter((field) => next[field] !== stored[field])
    .map((field) => ({ field, value: next[field] }));

  if (patches.length > 0) {
    await write(patches);
  }
};

/**
 * Whether no range is owed and the re-scan is not part way through a pass. A forward read leaves
 * the ground behind unread, so a forward run is complete only when it started with nothing behind;
 * the overlap day it stores is the next behind run's. A behind run that starts with a range is
 * never complete, but a run with no forward ground to read (`turnOf`) has read the ground behind
 * and is complete when it ended with nothing behind.
 */
const nothingBehind = (marks: Pick<WalkMarks, 'pending' | 'rescanCursor'>): boolean =>
  !holdsRange(marks.pending) && (marks.rescanCursor ?? HISTORY_FLOOR_MS) <= HISTORY_FLOOR_MS;

/**
 * What a re-scan window that stopped after some of its spans committed hands the next run: the
 * span it wanted to read next, without the resume. The window start only moves forward with the
 * re-scan mark, which holds what was read, so the hint is found again, and the run after a failed
 * read goes on with the width the halvings reached instead of the whole rest of the window. A hint
 * that ends at or past the window's end is not a narrowing: the window end is the cursor, which
 * moves with the clock, so the next run would clip its first span to a window end that is already
 * behind it and stop one clock gap short of the pass's end for ever.
 */
const keepsWidth = (pass: WalkPass, window: WalkWindow, outcome: WindowOutcome): WindowOutcome =>
  pass === 'rescan' && outcome.hint?.resume !== undefined
    ? {
        ...outcome,
        hint:
          outcome.hint.end >= window.end
            ? null
            : { start: outcome.hint.start, end: outcome.hint.end },
      }
    : outcome;

/**
 * The stuck ranges the list of owed ground still holds: a range the list lost has been read. A
 * sliver of owed ground that shares only its boundary millisecond with the range is not the range:
 * the re-scan reads up to a millisecond short of the range and after the millisecond that ends it,
 * and the sliver left between a read and the range would hold the range for ever.
 */
const heldStuck = (stuck: WalkWindow[], pending: OwedGround[]): WalkWindow[] =>
  stuck
    .filter((range) => pending.some((ground) => !isPoint(ground) && overlaps(ground, range)))
    .map(({ start, end }) => ({ start, end }));

/**
 * The plan with the windows of the stuck ranges among the owed windows, in the round-robin order
 * of the walk's range cursor: the planner leaves out the owed ranges the re-scan covers, and the
 * re-scan reads around the stuck ones, so these are read by the owed runs alone.
 */
const withStuckWindows = (input: {
  plan: WalkPlan;
  stuck: WalkWindow[];
  rangeCursor: number | null;
  maxWindows: number;
}): WalkPlan => {
  const { plan, stuck, rangeCursor, maxWindows } = input;
  const isPlanned = (window: WalkWindow): boolean =>
    plan.pending.some(
      (planned) =>
        planned.series === undefined &&
        planned.start === window.start &&
        planned.end === window.end,
    );
  const windows = [
    ...plan.pending,
    ...stuck
      .flatMap((range) => buildWalkWindows(range.start, range.end, FIAT_WINDOW_MS, maxWindows))
      .filter((window) => !isPlanned(window)),
  ].sort(byStart);

  return {
    ...plan,
    pending:
      rangeCursor === null
        ? windows
        : [
            ...windows.filter((window) => window.start >= rangeCursor),
            ...windows.filter((window) => window.start < rangeCursor),
          ],
  };
};

/**
 * Store the stuck ranges the run still holds (a range the list lost has been read), and log that
 * it holds any, once. The re-scan runs that read around a stuck range have no failed read to log,
 * so a day that nothing reads would be silent on them.
 */
const keepStuckMark = async (input: {
  write: WalkMarkWriter;
  stored: WalkWindow[] | undefined;
  stuck: WalkWindow[];
}): Promise<void> => {
  const { write, stored = [], stuck } = input;

  if (stuck.length !== stored.length) {
    await write([{ field: 'rescanStuck', value: stuck }]);
  }

  if (stuck.length > 0) {
    logWalkStop(FIAT_RESCAN_STUCK);
  }
};

/**
 * The plan with its first re-scan window starting after the known stuck range that holds its start
 * or ends 1 ms short of it, and after any range that holds the start that gives. A window that
 * starts at a stuck range reads the day or the sliver on its own, which a read cannot clear; what
 * `aroundStuck` splits off from it on a read is the piece after the range, and a piece that is a
 * full page halves, which the stored hint (that starts past the window start) could not keep, so
 * every run started the halving again and the pass never ended. A window that would start at or
 * past its end is left as it is: it holds only owed ground, and its commit ends the pass.
 */
const startingAfterStuck = (plan: WalkPlan, stuck: WalkWindow[]): WalkPlan => {
  const [first, ...rest] = plan.rescan;

  if (first === undefined) {
    return plan;
  }

  const start = [...stuck]
    .sort(byStart)
    .reduce(
      (from, range) => (range.start - 1 <= from && from <= range.end ? range.end + 1 : from),
      first.start,
    );

  return start === first.start || start >= first.end
    ? plan
    : { ...plan, rescan: [{ ...first, start }, ...rest] };
};

/**
 * The hooks with the stored re-scan hint kept on a turn that is not the re-scan. The plan of such
 * a turn holds no re-scan window, so the walk stores its hints without a re-scan one, which drops
 * the hint the re-scan left part way through the halving of a full page, and the next re-scan
 * would start that halving again.
 */
const keepRescanHint = <
  Hooks extends {
    hints: { stored: BinanceSpanHints; store: (hints: BinanceSpanHints) => Promise<void> };
  },
>(
  hooks: Hooks,
  turn: FiatTurn | undefined,
): Hooks =>
  turn === undefined || turn === 'rescan'
    ? hooks
    : {
        ...hooks,
        hints: {
          ...hooks.hints,
          store: (hints: BinanceSpanHints) =>
            hooks.hints.store({ ...hints, rescan: hooks.hints.stored.rescan }),
        },
      };

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
  const maxWindows = Math.floor(LANE_CALL_CAPS[walk.walkId] / FIAT_SERIES.length);
  const stuck = heldStuck(stored.rescanStuck ?? [], pending);
  const plan = startingAfterStuck(
    withStuckWindows({
      plan: planWalkPasses({
        cursor,
        rescanCursor,
        pointCursor: roundRobins.pointCursor,
        rangeCursor: roundRobins.rangeCursor,
        pending,
        floorMs: HISTORY_FLOOR_MS,
        endTime,
        windowMs: FIAT_WINDOW_MS,
        overlapMs: RESYNC_OVERLAP_MS,
        maxWindows,
      }),
      stuck,
      rangeCursor: roundRobins.rangeCursor,
      maxWindows,
    }),
    stuck,
  );

  if (plan.forward.length === 0 && plan.rescan.length === 0) {
    return { imported: 0, complete: false };
  }

  await keepStuckMark({ write, stored: stored.rescanStuck, stuck });

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
    rescanStuck: stuck,
    depthMemories: createDepthMemories(deps.now, BINANCE_DEPTH_CONFIG),
  };

  const storedTurn: StoredTurn = {
    behindRun: stored.behindRun === true,
    rescanTurn: stored.rescanTurn === true,
  };
  const turn = alternatesTurns(walk.walkId)
    ? turnOf({ pending, plan, endTime, stored: storedTurn })
    : undefined;

  if (turn !== undefined) {
    await storeTurn({ write, turn, stored: storedTurn });
  }

  const result = await runWalkPlan({
    plan: turn === undefined ? plan : planOfTurn(plan, turn),
    callsOf,
    canAfford: (keep) =>
      run.budget.canAfford(walk.walkId, walk.cost, keep) &&
      !isBinanceCoolingDown(accountId, deps.now()),
    runWindow: async (window, pass, keep, hint) =>
      keepsWidth(
        pass,
        window,
        await walkSpans({
          window,
          read: (span, keepCalls) => readSpan(context, window, span, keepCalls, pass),
          commit: (span, read) => commitSpan(context, window, span, read, pass),
          keep,
          hint,
          onComplete: (read) => dropReadPoints({ pass, window, read, marks: context.marks, write }),
        }),
      ),
    isUnreadableWindowError,
    ...keepRescanHint(roundRobinHooksOf({ marks: context.marks, write }), turn),
  });
  const lastWindowEnd = plan.forward.at(-1)?.end;

  // A plan holds the lane's windows a run at most, so one that ends before now has more history
  // behind it than the windows it read.
  return {
    ...result,
    complete:
      result.complete &&
      (lastWindowEnd === undefined || lastWindowEnd >= endTime) &&
      (turn === undefined ||
        nothingBehind(plan.forward.length === 0 ? context.marks : { pending, rescanCursor })),
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
 * (`turnOf`); the run after a behind run reads forward, a run with no forward ground reads behind,
 * and the behind runs take turns on the owed windows and the re-scan. A re-scan read that fails
 * does not stop the walk: the stretch it failed on is read around (`readRescanSpan`).
 * `complete: false` means history, owed ground or the re-scan remains, and a run that read behind
 * is complete only when it had no forward ground and left nothing behind; a later run resumes from
 * the stored marks. A failure other than a rate limit or an unreadable re-scan page rejects, so the
 * caller can log it without failing the balance sync.
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
