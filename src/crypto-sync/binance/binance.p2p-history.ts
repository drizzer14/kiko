import { DAY_MS } from '@kiko/dates';
import { match, P } from 'ts-pattern';
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
  joinSettled,
  notImportedWriterOf,
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
import { readSeriesSpan, type SeriesSpan } from '@kiko/crypto-sync/exchange/paging';
import { type NotImportedKind, notImportedEntry } from '@kiko/crypto-sync/exchange/walk-state';

import {
  type BinanceTransactionRow,
  HISTORY_FLOOR_MS,
  RESYNC_OVERLAP_MS,
} from './binance.transactions';
import { holdingKeyOf } from './binance.holding-keys';
import { BINANCE_WALK_CONFIG } from './binance.walk-config';
import { BINANCE_DEPTH_CONFIG } from './binance.depth-config';
import { isTrackedBinanceAsset } from './binance.tracked-coin';
import { type BinanceCredentials, readCredentials } from './binance.credentials';
import { isBinanceCoolingDown, setBinanceCooldownUntil } from './binance.cooldown';
import { BinanceHistoryTooOldError, type FetchAccountOptions } from './binance.client';
import { type BinanceHistoryRun, COSTS, LANE_CALL_CAPS } from './binance.history-budget';
import { type BinanceP2pOrder, fetchP2pOrders, type TotalPage } from './binance.history-client';

/**
 * The statuses of an order that waits on Binance: its point is owed until it is final, whatever
 * its side or role. The raw Binance docs list no `orderStatus` value, so the five words are the
 * spec's ("### P2P", step 1); `.superpowers/sdd/binance-set12/fiat-doc-quote.md` records that
 * no doc text was found for them.
 */
export const P2P_OPEN_STATUSES = [
  'PENDING',
  'TRADING',
  'BUYER_PAYED',
  'DISTRIBUTING',
  'IN_APPEAL',
] as const;

/** The stop of an order that waits on Binance: its point is owed until it is final. */
const P2P_NOT_SETTLED = 'p2p-not-settled';

/** The stop of a page order the client could not place, such as one with no order number. */
const P2P_ORDER_UNREADABLE = 'p2p-order-unreadable';

const P2P_PAGE_DRIFT = 'p2p-page-drift';

const P2P_HOLDING_MISSING = 'p2p-holding-missing';

/**
 * The stops of one order that the forward pass owes and goes past: the order stays owed at its own
 * point until it is final or the floor drops it, and holding the cursor behind it would keep every
 * newer order from importing. Like Convert, it applies only to an order with a usable time; a stop
 * that is no one order's (`p2p-page-drift`, `p2p-holding-missing`) is not in this list.
 */
export const P2P_FORWARD_OWES: readonly string[] = [
  P2P_NOT_SETTLED,
  P2P_ORDER_UNREADABLE,
  ...AMOUNT_STOP_CODES,
];

/**
 * A row mapped from a completed taker buy, before its wallet is turned into a holding: `wallet`
 * is the key of the coin's Funding holding.
 */
type PlannedP2pRow = {
  wallet: string;
  amountMinorUnits: number;
  time: number;
  externalId: string;
  description: string;
  comment: string;
  untrackedCounterpart: string;
  operation: 'p2p';
};

/**
 * What one order comes to: its row (`row`), the entry of an order a rule refuses for good
 * (`refused`), an order that waits on Binance (`owed`), nothing at all (`none`, an order that
 * was cancelled), or the ticker of a coin Kiko does not track (`untracked`, counted, no row).
 */
type P2pOutcome =
  | { kind: 'row'; row: PlannedP2pRow }
  | { kind: 'refused'; entry: string }
  | { kind: 'owed' }
  | { kind: 'none' }
  | { kind: 'untracked'; ticker: string };

/** The amount fields an order gives: its taker amount, or the pair that makes one. */
type AmountFields =
  | { kind: 'taker'; takerAmount: string; amount?: string; takerCommission?: string }
  | { kind: 'net'; amount: string; takerCommission: string };

const refusedOutcomeOf = (kind: NotImportedKind, order: BinanceP2pOrder): P2pOutcome => ({
  kind: 'refused',
  entry: notImportedEntry(kind, order.orderNumber, order.createTime),
});

const amountFieldsOf = (order: BinanceP2pOrder): AmountFields | undefined =>
  match(order)
    .returnType<AmountFields | undefined>()
    .with({ takerAmount: P.string }, ({ takerAmount, amount, takerCommission }) => ({
      kind: 'taker',
      takerAmount,
      amount,
      takerCommission,
    }))
    .with({ amount: P.string, takerCommission: P.string }, ({ amount, takerCommission }) => ({
      kind: 'net',
      amount,
      takerCommission,
    }))
    .otherwise(() => undefined);

/**
 * The exact minor units of the row: the taker amount, which must equal the amount less the
 * commission when both are given (`undefined` when they differ), or that difference. Each text
 * is parsed at the coin's own scale and the two are subtracted as integers.
 */
const unitsOf = (asset: Currency, fields: AmountFields): number | undefined =>
  match(fields)
    .returnType<number | undefined>()
    .with(
      { kind: 'taker', amount: P.string, takerCommission: P.string },
      ({ takerAmount, amount, takerCommission }) => {
        const taker = rowMinorUnits(asset, takerAmount);
        const net = rowMinorUnits(asset, amount) - rowMinorUnits(asset, takerCommission);

        return net === taker ? taker : undefined;
      },
    )
    .with({ kind: 'taker' }, ({ takerAmount }) => rowMinorUnits(asset, takerAmount))
    .with(
      { kind: 'net' },
      ({ amount, takerCommission }) =>
        rowMinorUnits(asset, amount) - rowMinorUnits(asset, takerCommission),
    )
    .exhaustive();

/** The marker for the fiat total as Binance sent it; a total no code can carry owes the point. */
const markerOf = (fiat: string, totalPrice: string): string =>
  bifoldMap(
    fiatTotalCode('p2p', fiat, totalPrice),
    (code): string => {
      throw new BinanceWalkStop(code);
    },
    (marker) => marker,
  );

const rowOutcomeOf = (input: {
  accountId: string;
  order: BinanceP2pOrder;
  asset: Currency;
  fields: AmountFields;
}): P2pOutcome => {
  const { accountId, order, asset, fields } = input;
  const { fiat, totalPrice } = order;

  // No row or marker can be made without the fiat and its total, and a re-read cannot change it.
  if (fiat === undefined || totalPrice === undefined) {
    return refusedOutcomeOf('p2p-unrecognized', order);
  }

  const units = unitsOf(asset, fields);

  if (units === undefined || units <= 0) {
    return refusedOutcomeOf('p2p-amount', order);
  }

  const wallet = holdingKeyOf(asset, 'funding');

  return {
    kind: 'row',
    row: {
      wallet,
      amountMinorUnits: units,
      time: order.createTime,
      externalId: `${accountId}:p2p:${order.orderNumber}:${wallet}`,
      description: '',
      comment: `${totalPrice} ${fiat}`,
      untrackedCounterpart: markerOf(fiat, totalPrice),
      operation: 'p2p',
    },
  };
};

const assetOutcomeOf = (input: {
  accountId: string;
  order: BinanceP2pOrder;
  fields: AmountFields;
}): P2pOutcome => {
  const { order } = input;
  const { asset } = order;

  if (asset === undefined || asset === '') {
    return refusedOutcomeOf('p2p-unrecognized', order);
  }

  return isTrackedBinanceAsset(asset)
    ? rowOutcomeOf({ ...input, asset })
    : { kind: 'untracked', ticker: asset };
};

const takerOutcomeOf = (accountId: string, order: BinanceP2pOrder): P2pOutcome =>
  match(amountFieldsOf(order))
    .returnType<P2pOutcome>()
    .with(P.nullish, () => refusedOutcomeOf('p2p-amount', order))
    .otherwise((fields) => assetOutcomeOf({ accountId, order, fields }));

const completedBuyOutcomeOf = (accountId: string, order: BinanceP2pOrder): P2pOutcome =>
  match(order.advertisementRole)
    .returnType<P2pOutcome>()
    .with('MAKER', () => refusedOutcomeOf('p2p-advertiser', order))
    .with('TAKER', () => takerOutcomeOf(accountId, order))
    .otherwise(() => refusedOutcomeOf('p2p-unrecognized', order));

const completedOutcomeOf = (accountId: string, order: BinanceP2pOrder): P2pOutcome =>
  match(order.tradeType)
    .returnType<P2pOutcome>()
    .with('SELL', () => refusedOutcomeOf('p2p-sale', order))
    .with('BUY', () => completedBuyOutcomeOf(accountId, order))
    .otherwise(() => refusedOutcomeOf('p2p-unrecognized', order));

/**
 * What one P2P order comes to, decided in the order the status, the side, the role, the amount
 * and the coin (spec "### P2P"). Only a `COMPLETED` order goes on; a cancelled one is nothing,
 * one that waits on Binance (`P2P_OPEN_STATUSES`) is owed whatever else it says, and any other
 * word is refused for good. A sale wins over every role. A buy as a taker gives the row
 * `takerAmount` (or the amount less the commission), on the Funding holding of its coin, marked
 * with the total Binance sent; an order whose amounts cannot be told is refused, and one whose
 * text the parser refuses throws a `BinanceWalkStop` and owes its point. An order of a coin Kiko
 * does not track is counted and gives no row.
 */
export const p2pOutcomeOf = (input: { accountId: string; order: BinanceP2pOrder }): P2pOutcome => {
  const { accountId, order } = input;

  return match(order.orderStatus)
    .returnType<P2pOutcome>()
    .with('COMPLETED', () => completedOutcomeOf(accountId, order))
    .with('CANCELLED', 'CANCELLED_BY_SYSTEM', () => ({ kind: 'none' }))
    .with(P.union(...P2P_OPEN_STATUSES), () => ({ kind: 'owed' }))
    .otherwise(() => refusedOutcomeOf('p2p-unrecognized', order));
};

/** Binance rejects a P2P `startTimestamp`/`endTimestamp` gap of more than 30 days. */
export const P2P_WINDOW_MS = 30 * DAY_MS;

const P2P_SIDES = ['BUY', 'SELL'] as const;

type P2pSide = (typeof P2P_SIDES)[number];

/**
 * Safety stop on the plan of a run: the lane reads this many windows at most in a run, both
 * sides of each, so a plan holds no more than that.
 */
const P2P_MAX_WINDOWS = Math.floor(LANE_CALL_CAPS.p2p / P2P_SIDES.length);

/** Safety stop on paging one side within a span of one millisecond (100 rows x 50 pages). */
const MAX_PAGES_PER_SPAN = 50;

/** The imported-transaction shape the P2P walk hands to `transactionsRepo.addManyDedup`. */
type BinanceP2pRow = BinanceTransactionRow & {
  untrackedCounterpart: string;
  operation: 'p2p';
};

/**
 * The injectable seams of the P2P walk: the credential and holding reads, the P2P read (one page
 * of one side of one range), the insert-only holding creation, the deduping import, and the walk
 * state read and write. Pacing and the weight budget come from the run.
 */
export type BinanceP2pHistoryDeps = ExchangeStateDeps & {
  now: () => number;
  fetchImpl: typeof fetch;
  readCredentials: (accountId: string) => Promise<BinanceCredentials | undefined>;
  listHoldings: (accountId: string) => Promise<HoldingRow[]>;
  fetchP2pOrders: (
    apiKey: string,
    secret: string,
    side: P2pSide,
    span: WalkWindow,
    page: number,
    options?: FetchAccountOptions,
  ) => Promise<TotalPage<BinanceP2pOrder>>;
  ensureHoldings: (holdings: ExchangeHolding[]) => Promise<void>;
  addTransactions: (rows: BinanceP2pRow[]) => Promise<number>;
};

const defaultP2pHistoryDeps: BinanceP2pHistoryDeps = {
  ...exchangeStateDepsOf('binance'),
  now: () => Date.now(),
  fetchImpl: fetch,
  readCredentials,
  listHoldings: async (accountId) => holdingsRepo.listByAccountQuery(accountId),
  fetchP2pOrders,
  ensureHoldings: (holdings) => holdingsRepo.ensureExchangeHoldings(holdings),
  addTransactions: (rows) => transactionsRepo.addManyDedup(rows),
};

type P2pContext = {
  deps: BinanceP2pHistoryDeps;
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

/** The sides a window is read in: both, or the one its owed points name. */
const sidesOf = (window: OwedWindow): readonly P2pSide[] =>
  window.series === undefined
    ? P2P_SIDES
    : P2P_SIDES.filter((side) => window.series?.includes(side));

/** The calls one read of a window costs: one for each side it asks. */
const callsOf = (window: OwedWindow): number => sidesOf(window).length;

/**
 * One span read on every side of `window`. A side whose first page is full with more orders behind
 * it halves the span (every side is read again in the half). `undefined` is a clean stop: the
 * budget cannot afford every side, or Binance rate-limited (which also sets the account's
 * cooldown). `keep` calls stay unspent for the passes that come later in the run.
 *
 * A start Binance refuses as older than it keeps (-5026) is not read as empty: each side is read
 * from the oldest start Binance serves it (see `readSeriesSpan`), and only the ground it refuses
 * is read as empty. Probe 5 saw no such refusal, so this is a safety net.
 */
const readSpan = (
  context: P2pContext,
  window: OwedWindow,
  span: WalkWindow,
  keep: number,
): Promise<SpanRead<SeriesSpan<P2pSide, BinanceP2pOrder>> | undefined> => {
  const { deps, run, accountId, apiKey, secret, options } = context;

  return readSeriesSpan({
    run,
    config: BINANCE_WALK_CONFIG,
    lane: 'p2p',
    cost: COSTS.p2p,
    span,
    keep,
    series: sidesOf(window),
    maxPages: MAX_PAGES_PER_SPAN,
    fetchPage: (side, read, page) => deps.fetchP2pOrders(apiKey, secret, side, read, page, options),
    onRateLimit: (error) => setBinanceCooldownUntil(accountId, deps.now() + error.retryAfterMs),
    depth: {
      isRefusal: (error) => error instanceof BinanceHistoryTooOldError,
      nowMs: deps.now,
      floorMs: () => HISTORY_FLOOR_MS,
      ...context.depthMemories,
    },
  });
};

type SettledOutcome = Exclude<P2pOutcome, { kind: 'owed' }>;

/** One order's outcome; an order that waits on Binance owes its point (a `BinanceWalkStop`). */
const settledOutcomeOf = (accountId: string, order: BinanceP2pOrder): SettledOutcome => {
  const outcome = p2pOutcomeOf({ accountId, order });

  if (outcome.kind === 'owed') {
    throw new BinanceWalkStop(P2P_NOT_SETTLED);
  }

  return outcome;
};

/** What one order adds to its span: its rows, the tickers it names, and its refusal entry. */
type OrderParts = { rows: PlannedP2pRow[]; untracked: string[]; notImported: string[] };

const partsOf = (outcome: SettledOutcome): OrderParts =>
  match(outcome)
    .returnType<OrderParts>()
    .with({ kind: 'row' }, ({ row }) => ({ rows: [row], untracked: [], notImported: [] }))
    .with({ kind: 'refused' }, ({ entry }) => ({ rows: [], untracked: [], notImported: [entry] }))
    .with({ kind: 'untracked' }, ({ ticker }) => ({
      rows: [],
      untracked: [ticker],
      notImported: [],
    }))
    .with({ kind: 'none' }, () => ({ rows: [], untracked: [], notImported: [] }))
    .exhaustive();

type SidedOrder = { side: P2pSide; order: BinanceP2pOrder };

/**
 * The orders of one span, each on its own (see `settleRecords`): an order that waits, or one the
 * walk cannot trust, or a row the client could not read, owes its own point on the side it was
 * read under and the others still import. An order a rule refuses for good is listed once it is
 * settled, and the tickers of the coins the walk does not track are named. A side whose pages
 * drifted is no one order's stop: the span is owed, as a range, on that side alone, and the side
 * that did not drift still commits. The ground a side left owed in itself (the edge band its read
 * began above, when Binance refused it, or the whole span of a side whose read stopped) is owed
 * as a range on that side alone, and holds nothing back.
 */
const settledOrdersOf = (input: {
  accountId: string;
  span: WalkWindow;
  read: SeriesSpan<P2pSide, BinanceP2pOrder>;
}): SettledSpan<PlannedP2pRow> => {
  const { accountId, span, read } = input;
  const settled = settleRecords<SidedOrder, SettledOutcome>({
    span,
    records: read.read.flatMap(({ series, rows }) =>
      rows.map((order) => ({ side: series, order })),
    ),
    rowsOf: ({ order }) => [settledOutcomeOf(accountId, order)],
    extentOf: ({ order }) => instantAt(order.createTime),
    seriesOf: ({ side }) => side,
  });
  const parts = settled.rows.map(partsOf);

  return joinSettled<PlannedP2pRow>([
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
            codes: [P2P_PAGE_DRIFT],
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
        unreadable.map((row) => ({ ...row, side: series })),
      ),
      code: P2P_ORDER_UNREADABLE,
      extentOf: (row) => foldMap(maybe(row.time), (time) => instantAt(Number(time))),
      seriesOf: (row) => row.side,
    }),
  ]);
};

/**
 * Commit one span's read: place and write the rows of the orders the walk can trust, then move the
 * walk's marks (see `commitSettledSpan`: rows first, marks second, so a crash between the two
 * just re-imports idempotently, and an order the walk cannot trust stays owed at its own point or
 * stops the forward pass). One row per key: an order on the boundary of two spans is read twice.
 */
const commitSpan = (
  context: P2pContext,
  window: OwedWindow,
  span: WalkWindow,
  read: SeriesSpan<P2pSide, BinanceP2pOrder>,
  pass: WalkPass,
): Promise<SpanCommit | undefined> => {
  const { deps, accountId, plan, marks, write } = context;

  return commitSettledSpan({
    pass,
    span,
    settled: settledOrdersOf({ accountId, span, read }),
    forwardOwes: P2P_FORWARD_OWES,
    place: (planned) =>
      placeWalletRows({
        accountId,
        planned,
        config: BINANCE_WALK_CONFIG,
        listHoldings: deps.listHoldings,
        ensureHoldings: deps.ensureHoldings,
        missingCode: P2P_HOLDING_MISSING,
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

const runSync = async (
  deps: BinanceP2pHistoryDeps,
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

  const stored = await readWalkMarks(deps, accountId, 'p2p');
  const { cursor, rescan: rescanCursor } = stored;
  const write = walkMarkWriterOf(deps, accountId, 'p2p');
  const roundRobins = await readWalkRoundRobins({ stored, write });
  const pending = await readPendingMark({
    stored: stored.pending,
    owedIfUnreadable: { start: HISTORY_FLOOR_MS, end: cursor ?? HISTORY_FLOOR_MS },
    knownSeries: P2P_SIDES,
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
    windowMs: P2P_WINDOW_MS,
    overlapMs: RESYNC_OVERLAP_MS,
    maxWindows: P2P_MAX_WINDOWS,
  });

  if (plan.forward.length === 0 && plan.rescan.length === 0) {
    return { imported: 0, complete: false };
  }

  const context: P2pContext = {
    deps,
    run,
    accountId,
    ...credentials,
    options: { fetchImpl: deps.fetchImpl, now: deps.now },
    marks: { cursor, rescanCursor, ...roundRobins, pending },
    plan,
    write,
    depthMemories: createDepthMemories(deps.now, BINANCE_DEPTH_CONFIG),
  };

  const result = await runWalkPlan({
    plan,
    callsOf,
    canAfford: (keep) =>
      run.budget.canAfford('p2p', COSTS.p2p, keep) && !isBinanceCoolingDown(accountId, deps.now()),
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

  // A plan holds `P2P_MAX_WINDOWS` windows at most, so one that ends before now has more history
  // behind it than the windows it read.
  return {
    ...result,
    complete: result.complete && (lastWindowEnd === undefined || lastWindowEnd >= endTime),
  };
};

/**
 * Import the user's completed P2P buys as a taker as transactions on the Funding holding of their
 * coin, list the sales, the orders placed as an advertiser and the ones it cannot tell, and
 * commit a window's rows before advancing the mark past it. The walk reads 30-day windows forward
 * from the history floor, both sides of each, empty ones too, because Binance has no refusal to
 * the floor to stop at; a run reads as many windows as the lane's calls allow, so the first walk
 * takes several runs. `complete: false` means history, owed ground or the re-scan remains and a
 * later run resumes from the stored marks; a failure other than a rate limit rejects, so the
 * caller can log it without failing the balance sync, and the run that fails reads the same window
 * again.
 */
export const syncBinanceP2pHistory = (
  request: { targetAccountId: string; run: BinanceHistoryRun },
  overrides: Partial<BinanceP2pHistoryDeps> = {},
): Promise<WalkResult> =>
  runSync({ ...defaultP2pHistoryDeps, ...overrides }, request.targetAccountId, request.run);
