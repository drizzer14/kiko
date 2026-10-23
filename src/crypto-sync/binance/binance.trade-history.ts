import { match } from 'ts-pattern';
import {
  BinanceWalkStop,
  EXCHANGE_STATE_MALFORMED,
  type ExchangeStateDeps,
  exchangeStateDepsOf,
  historyListWriterOf,
  placeWalletRows,
  rowMinorUnits,
} from '@kiko/crypto-sync/exchange/walk';
import type { HoldingRow } from '@kiko/db';
import maybe, { foldMap } from 'fnts/maybe';
import { logFailure } from '@kiko/diagnostics';
import type { Currency } from '@kiko/currency/currency';
import { transactionsRepo } from '@kiko/transactions/repo';
import { readIdCursor } from '@kiko/crypto-sync/exchange/paging';
import { addDecimal, compareDecimal } from '@kiko/currency/decimal';
import { type ExchangeHolding, holdingsRepo } from '@kiko/holdings/repo';
import { untrackedAssetCode } from '@kiko/transactions/untracked-counterpart';
import { type ExchangeTrades, parseExchangeState } from '@kiko/crypto-sync/exchange/walk-state';

import {
  NO_WEIGHTS,
  planTradeSymbolReads,
  readSpotSymbols,
  runTradeSymbolReads,
  type TradeReadEnd,
  tradeCandidatesOf,
  tradesPatchesOf,
  touchedCoinsOf,
} from './binance.trade-symbols';
import {
  type BinanceMyTrade,
  type BinancePageWeights,
  BinanceHistoryParseError,
  type ExchangeSymbolsPage,
  fetchExchangeSymbols,
  fetchMyTrades,
  fetchOrderFills,
  TRADE_PAGE_LIMIT,
} from './binance.history-client';
import { BINANCE_WALK_CONFIG } from './binance.walk-config';
import { isTrackedBinanceAsset } from './binance.tracked-coin';
import type { BinanceTransactionRow } from './binance.transactions';
import { type BinanceHistoryRun, COSTS } from './binance.history-budget';
import { type BinanceCredentials, readCredentials } from './binance.credentials';
import { isBinanceCoolingDown, setBinanceCooldownUntil } from './binance.cooldown';
import { BinanceRateLimitError, type FetchAccountOptions } from './binance.client';
import { binanceKeyOf, holdingKeyOf, partsOfHoldingKey } from './binance.holding-keys';

/** The stop of an amount text that is below zero: Binance sends none, so the order is not read. */
const TRADE_AMOUNT_INVALID = 'trade-amount-invalid';

/** The stop of a coin whose ticker cannot be written as an `asset:` code. */
const TRADE_ROW_UNREADABLE = 'trade-row-unreadable';

/** The stop of rows whose holding the placement cannot find even after it creates a missing one. */
const TRADE_HOLDING_MISSING = 'trade-holding-missing';

/** The fixed tag of the one log line a symbol that failed writes. */
const SYMBOL_FAILED_TAG = '[binance sync] trade symbol failed';

const AMOUNT_FIELDS = ['qty', 'quoteQty', 'commission'] as const;

/**
 * A row mapped from an order, before its wallets are turned into holdings: `wallet` is the key of
 * the coin's Spot holding, `counterpartWallet` the other leg's. A lone leg has
 * `untrackedCounterpart` instead of a counterpart and a pair id.
 */
type PlannedTradeRow = {
  wallet: string;
  counterpartWallet?: string;
  amountMinorUnits: number;
  time: number;
  externalId: string;
  exchangePairId?: string;
  untrackedCounterpart?: string;
  description: string;
  operation: 'trade' | 'trade-fee';
};

type TrackedSide = { kind: 'tracked'; coin: Currency; units: number };

/** One coin of an order: a tracked one with its signed units, or the ticker of one that is not. */
type TradeSide = TrackedSide | { kind: 'untracked'; ticker: string };

type RowContext = { pairId: string; time: number };

/** The id the rows of one order share: every row key of the order starts with it and a colon. */
const tradePairIdOf = (accountId: string, symbol: string, orderId: number): string =>
  `${accountId}:trade:${symbol}:${orderId}`;

const unitsOf = (coin: Currency, amountText: string): number => {
  const units = rowMinorUnits(coin, amountText, 'trade-row');

  if (units < 0) {
    throw new BinanceWalkStop(TRADE_AMOUNT_INVALID);
  }

  return units;
};

/** The `asset:` marker of a coin the account does not track. */
const assetMarkerOf = (ticker: string): string => {
  const marker = untrackedAssetCode(ticker);

  if (marker === undefined) {
    throw new BinanceWalkStop(TRADE_ROW_UNREADABLE);
  }

  return marker;
};

/**
 * The side of one coin. A tracked coin is converted here, once, from the order's summed text, with
 * `sign` giving the direction of the money (-1 spent, 1 received); an untracked coin's amount is
 * never read.
 */
const sideOf = (coin: string, amountText: string, sign: -1 | 1): TradeSide =>
  match(coin)
    .returnType<TradeSide>()
    .when(isTrackedBinanceAsset, (tracked) => ({
      kind: 'tracked',
      coin: tracked,
      units: sign * unitsOf(tracked, amountText),
    }))
    .otherwise((ticker) => ({ kind: 'untracked', ticker }));

const legOf = ({ pairId, time }: RowContext, { coin, units }: TrackedSide): PlannedTradeRow => ({
  wallet: holdingKeyOf(coin, 'spot'),
  amountMinorUnits: units,
  time,
  externalId: `${pairId}:${holdingKeyOf(coin, 'spot')}`,
  description: '',
  operation: 'trade',
});

const loneLegOf = (
  context: RowContext,
  tracked: TrackedSide,
  untrackedTicker: string,
): PlannedTradeRow[] =>
  tracked.units === 0
    ? []
    : [{ ...legOf(context, tracked), untrackedCounterpart: assetMarkerOf(untrackedTicker) }];

/** The legs of an order: a pair when both coins are tracked, else the tracked leg alone, if any. */
const legsOf = (context: RowContext, spent: TradeSide, received: TradeSide): PlannedTradeRow[] =>
  match([spent, received] as const)
    .returnType<PlannedTradeRow[]>()
    .with([{ kind: 'tracked' }, { kind: 'tracked' }], ([spentSide, receivedSide]) =>
      spentSide.units === 0 || receivedSide.units === 0
        ? []
        : [
            {
              ...legOf(context, spentSide),
              counterpartWallet: holdingKeyOf(receivedSide.coin, 'spot'),
              exchangePairId: context.pairId,
            },
            {
              ...legOf(context, receivedSide),
              counterpartWallet: holdingKeyOf(spentSide.coin, 'spot'),
              exchangePairId: context.pairId,
            },
          ],
    )
    .with([{ kind: 'tracked' }, { kind: 'untracked' }], ([tracked, other]) =>
      loneLegOf(context, tracked, other.ticker),
    )
    .with([{ kind: 'untracked' }, { kind: 'tracked' }], ([other, tracked]) =>
      loneLegOf(context, tracked, other.ticker),
    )
    .with([{ kind: 'untracked' }, { kind: 'untracked' }], () => [])
    .exhaustive();

type FeeCounterpart = Pick<PlannedTradeRow, 'counterpartWallet' | 'untrackedCounterpart'>;

/** What a fee row names as the other side: the received leg's wallet, or its `asset:` marker. */
const feeCounterpartOf = (received: TradeSide): FeeCounterpart =>
  match(received)
    .returnType<FeeCounterpart>()
    .with({ kind: 'tracked' }, ({ coin }) => ({ counterpartWallet: holdingKeyOf(coin, 'spot') }))
    .with({ kind: 'untracked' }, ({ ticker }) => ({ untrackedCounterpart: assetMarkerOf(ticker) }))
    .exhaustive();

/** A fee row, unless the fee comes to no units of its coin. It carries the pair id of the order. */
const feeRowsOf = (
  { pairId, time }: RowContext,
  received: TradeSide,
  coin: Currency,
  amountText: string,
): PlannedTradeRow[] => {
  const units = unitsOf(coin, amountText);

  return units === 0
    ? []
    : [
        {
          wallet: holdingKeyOf(coin, 'spot'),
          ...feeCounterpartOf(received),
          amountMinorUnits: -units,
          time,
          externalId: `${pairId}:fee:${holdingKeyOf(coin, 'spot')}`,
          exchangePairId: pairId,
          description: '',
          operation: 'trade-fee',
        },
      ];
};

const sumOf = (fills: BinanceMyTrade[], field: (typeof AMOUNT_FIELDS)[number]): string =>
  fills.reduce((sum, fill) => addDecimal(sum, fill[field]), '0');

const commissionIn = (fills: BinanceMyTrade[], coin: string): string =>
  sumOf(
    fills.filter((fill) => fill.commissionAsset === coin),
    'commission',
  );

/** The fill an order starts at: the one with the lowest id, whatever order the fills came in. */
const firstFillOf = (fills: BinanceMyTrade[]): BinanceMyTrade => {
  const [head, ...rest] = fills;

  if (head === undefined) {
    throw new BinanceHistoryParseError();
  }

  return rest.reduce((first, fill) => (Number(fill.id) < Number(first.id) ? fill : first), head);
};

/**
 * The rows of one spot order, from every fill of it that was read. Each amount's text is summed
 * exactly over the fills and converted to minor units once, so a coin stored at a reduced scale,
 * or a fiat coin (Binance quotes it at more decimals than it is stored at), rounds half away from
 * zero once per order, never per fill. A fill's commission in the coin the order spent is added
 * to the spent leg, in the coin it received is taken off the received leg, and in a third coin
 * becomes one fee row per coin; a third coin that is not tracked is listed in `untracked`, as is
 * an untracked coin of the order. A leg that comes to 0 units is not written, nor is its pair
 * partner. A `BinanceHistoryParseError` means the fills cannot be one order; a `BinanceWalkStop`
 * means an amount or ticker the rules refuse.
 */
export const tradeOrderRowsOf = (input: {
  accountId: string;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  orderId: number;
  fills: BinanceMyTrade[];
}): { rows: PlannedTradeRow[]; untracked: string[] } => {
  const { accountId, symbol, baseAsset, quoteAsset, orderId, fills } = input;
  const first = firstFillOf(fills);

  if (fills.some((fill) => fill.isBuyer !== first.isBuyer)) {
    throw new BinanceHistoryParseError();
  }

  if (fills.some((fill) => AMOUNT_FIELDS.some((field) => compareDecimal(fill[field], '0') < 0))) {
    throw new BinanceWalkStop(TRADE_AMOUNT_INVALID);
  }

  const context: RowContext = {
    pairId: tradePairIdOf(accountId, symbol, orderId),
    time: first.time,
  };
  const [spentCoin, receivedCoin] = first.isBuyer
    ? [quoteAsset, baseAsset]
    : [baseAsset, quoteAsset];
  const [spentGross, receivedGross] = first.isBuyer
    ? [sumOf(fills, 'quoteQty'), sumOf(fills, 'qty')]
    : [sumOf(fills, 'qty'), sumOf(fills, 'quoteQty')];
  const spent = sideOf(spentCoin, addDecimal(spentGross, commissionIn(fills, spentCoin)), -1);
  const received = sideOf(
    receivedCoin,
    addDecimal(receivedGross, `-${commissionIn(fills, receivedCoin)}`),
    1,
  );
  const thirdCoins = [...new Set(fills.map((fill) => fill.commissionAsset))]
    .filter((coin) => coin !== baseAsset && coin !== quoteAsset)
    .sort()
    .map((coin) => ({ coin, amountText: commissionIn(fills, coin) }))
    .filter(({ amountText }) => compareDecimal(amountText, '0') !== 0);
  const feeRows = thirdCoins.flatMap(({ coin, amountText }) =>
    match(coin)
      .returnType<PlannedTradeRow[]>()
      .when(isTrackedBinanceAsset, (tracked) => feeRowsOf(context, received, tracked, amountText))
      .otherwise(() => []),
  );

  return {
    rows: [...legsOf(context, spent, received), ...feeRows],
    untracked: [baseAsset, quoteAsset, ...thirdCoins.map(({ coin }) => coin)].filter(
      (coin) => !isTrackedBinanceAsset(coin),
    ),
  };
};

/** The imported-transaction shape the trade read hands to `transactionsRepo.addManyDedup`. */
type BinanceTradeRow = BinanceTransactionRow & {
  exchangeCounterpartHoldingId?: string;
  exchangePairId?: string;
  untrackedCounterpart?: string;
  operation: 'trade' | 'trade-fee';
};

type TradesPage = { rows: BinanceMyTrade[] } & BinancePageWeights;

/**
 * The injectable seams of the trade read: the credential and holding reads, the symbol list and
 * the two fill reads, the lookup of the orders imported earlier, the insert-only holding creation
 * and the deduping import. `pageLimit` is the `limit` the fill reads ask for, which a page that
 * holds fewer fills ends on. Pacing and the weight budget come from the run.
 */
export type BinanceTradeHistoryDeps = ExchangeStateDeps & {
  now: () => number;
  fetchImpl: typeof fetch;
  pageLimit: number;
  readCredentials: (accountId: string) => Promise<BinanceCredentials | undefined>;
  listHoldings: (accountId: string) => Promise<HoldingRow[]>;
  fetchExchangeSymbols: (
    options?: Pick<FetchAccountOptions, 'fetchImpl'>,
  ) => Promise<ExchangeSymbolsPage>;
  fetchMyTrades: (
    apiKey: string,
    secret: string,
    symbol: string,
    fromId: number,
    options?: FetchAccountOptions,
  ) => Promise<TradesPage>;
  fetchOrderFills: (
    apiKey: string,
    secret: string,
    symbol: string,
    orderId: number,
    fromId: number,
    options?: FetchAccountOptions,
  ) => Promise<TradesPage>;
  importedOrderPrefixes: (prefixes: string[]) => Promise<Set<string>>;
  ensureHoldings: (holdings: ExchangeHolding[]) => Promise<void>;
  addTransactions: (rows: BinanceTradeRow[]) => Promise<number>;
};

const defaultTradeHistoryDeps: BinanceTradeHistoryDeps = {
  ...exchangeStateDepsOf('binance'),
  now: () => Date.now(),
  fetchImpl: fetch,
  pageLimit: TRADE_PAGE_LIMIT,
  readCredentials,
  listHoldings: async (accountId) => holdingsRepo.listByAccountQuery(accountId),
  fetchExchangeSymbols,
  fetchMyTrades,
  fetchOrderFills,
  importedOrderPrefixes: (prefixes) =>
    transactionsRepo.importedOrderPrefixesQuery('binance', prefixes),
  ensureHoldings: (holdings) => holdingsRepo.ensureExchangeHoldings(holdings),
  addTransactions: (rows) => transactionsRepo.addManyDedup(rows),
};

type TradeCandidate = ReturnType<typeof tradeCandidatesOf>[number];

type TradeSymbolEntry = ExchangeTrades['symbols'][string];

/**
 * The order a committed page ended on that came to no row, with the fills of it seen so far, and
 * the id of its first fill. It has no stored row to show it was seen, so a later fill would be
 * written without these: the cursor stays at that first fill, and the next page starts from the
 * fills.
 */
type TrailingOrder = { orderId: number; fills: BinanceMyTrade[]; fromId: number };

/** What the read of one symbol shares between its pages, its re-reads and its writes. */
type SymbolRead = {
  deps: BinanceTradeHistoryDeps;
  run: BinanceHistoryRun;
  accountId: string;
  credentials: BinanceCredentials;
  candidate: TradeCandidate;
  /** The calls the lane keeps back after each request of this read. */
  keep: number;
  stored: TradeSymbolEntry | undefined;
  /** The last fill id of every order re-read in this run, so a later fill is skipped or stops. */
  reReads: Map<number, number>;
  /** The `fromId` the symbol's entry holds now: `null` while it has never been read. */
  storedFromId: number | null;
  /** The last committed page's trailing order that came to no row, if it had one. */
  trailing: TrailingOrder | undefined;
  /**
   * The orders that came to no row and that the cursor has passed, so they have no stored row to
   * show them seen: a later fill of one is read like a fill of an order imported earlier. Stored
   * with the cursor; an order leaves it when it writes a row.
   */
  rowlessBehind: Set<number>;
  tally: { imported: number };
};

/** What one write of orders came to: the ids that came to no row, and the ids that came to rows. */
type WrittenOrders = { rowless: ReadonlySet<number>; withRows: ReadonlySet<number> };

/**
 * What a page comes to: the orders to write, the order of the last fill it took in, and the fill
 * the read stops at, if it stops.
 */
type PageScan = {
  orders: Map<number, BinanceMyTrade[]>;
  lastOrderId?: number;
  stop?: { fillId: number; heldOrderId?: number };
};

const optionsOf = (deps: BinanceTradeHistoryDeps): FetchAccountOptions => ({
  fetchImpl: deps.fetchImpl,
  now: deps.now,
});

/** The pager input a page of fills and a page of one order's fills have in common. */
const pagerOf = (read: SymbolRead) => ({
  run: read.run,
  lane: 'trades' as const,
  keep: read.keep,
  limit: read.deps.pageLimit,
  failedCallWeights: NO_WEIGHTS,
  idOf: (fill: BinanceMyTrade) => fill.id,
});

/**
 * Every fill of one order, from the first page on, or `undefined` when the lane has no room for
 * all of its pages: a part of an order is never written as the whole. An answer with a fill of
 * another order, or with none, is not an order's fills.
 */
const readOrderFills = async (
  read: SymbolRead,
  orderId: number,
): Promise<{ fills: BinanceMyTrade[]; lastFillId: number } | undefined> => {
  const { deps, credentials, candidate } = read;
  const fills: BinanceMyTrade[] = [];
  const { end } = await readIdCursor({
    ...pagerOf(read),
    cost: COSTS.orderFills,
    fromId: 0,
    fetchPage: (fromId) =>
      deps.fetchOrderFills(
        credentials.apiKey,
        credentials.secret,
        candidate.symbol,
        orderId,
        fromId,
        optionsOf(deps),
      ),
    onPage: async ({ rows }) => {
      if (rows.some((row) => row.orderId !== orderId)) {
        throw new BinanceHistoryParseError();
      }

      fills.push(...rows);

      return 'next';
    },
  });
  const lastFill = fills.at(-1);

  if (end !== 'short-page') {
    return undefined;
  }

  if (lastFill === undefined) {
    throw new BinanceHistoryParseError();
  }

  return { fills, lastFillId: Number(lastFill.id) };
};

const orderPrefixOf = ({ accountId, candidate }: SymbolRead, orderId: number): string =>
  `${tradePairIdOf(accountId, candidate.symbol, orderId)}:`;

/**
 * The orders of a page, not yet re-read in this run, that were imported earlier: those with a
 * stored row under their prefix, and those the cursor passed without a row.
 */
const importedOrdersOf = async (read: SymbolRead, rows: BinanceMyTrade[]): Promise<Set<number>> => {
  const orderIds = [...new Set(rows.map(({ orderId }) => orderId))].filter(
    (orderId) => !read.reReads.has(orderId),
  );
  const behind = orderIds.filter((orderId) => read.rowlessBehind.has(orderId));
  const others = orderIds.filter((orderId) => !read.rowlessBehind.has(orderId));

  if (others.length === 0) {
    return new Set(behind);
  }

  const found = await read.deps.importedOrderPrefixes(
    others.map((orderId) => orderPrefixOf(read, orderId)),
  );

  return new Set([
    ...behind,
    ...others.filter((orderId) => found.has(orderPrefixOf(read, orderId))),
  ]);
};

/**
 * Sorts the fills of a page, in id order, into the orders to write. An order with rows from an
 * earlier run, or one the cursor passed without a row (`rowlessBehind`), is read whole, once per
 * run, because its new fill changes every amount of it; a re-read the lane has no room for stops
 * the read at that order's first fill here, holding the order. A fill of an order already read
 * whole is skipped when that read has it, and stops the read at that fill when the order filled
 * again since. Nothing at or after the stop fill is written, and the cursor stays on it, so the
 * next read finds it again. The fills of the order the last page ended on without a row
 * (`TrailingOrder`) start the orders, so a fill of it on this page is added to them.
 */
const scanPage = async (read: SymbolRead, rows: BinanceMyTrade[]): Promise<PageScan> => {
  const imported = await importedOrdersOf(read, rows);
  const orders = new Map<number, BinanceMyTrade[]>();
  let lastOrderId: number | undefined;

  if (read.trailing !== undefined) {
    orders.set(read.trailing.orderId, read.trailing.fills);
  }

  for (const fill of rows) {
    const { orderId } = fill;

    if (!read.reReads.has(orderId) && imported.has(orderId)) {
      const whole = await readOrderFills(read, orderId);

      if (whole === undefined) {
        return {
          orders,
          lastOrderId,
          stop: { fillId: Number(fill.id), heldOrderId: orderId },
        };
      }

      read.reReads.set(orderId, whole.lastFillId);
      orders.set(orderId, whole.fills);
    }

    const lastRead = read.reReads.get(orderId);

    if (lastRead === undefined) {
      orders.set(orderId, [...(orders.get(orderId) ?? []), fill]);
    } else if (Number(fill.id) > lastRead) {
      return { orders, lastOrderId, stop: { fillId: Number(fill.id) } };
    }

    lastOrderId = orderId;
  }

  return { orders, lastOrderId };
};

/**
 * Write the rows of orders: place them on the Spot holdings, import them, then list the coins of
 * the orders that Kiko does not track. A crash before the cursor moves reads the page again, and
 * the keys dedupe it. Resolves with the ids of the orders that came to no row and of those that
 * came to rows.
 */
const writeOrders = async (
  read: SymbolRead,
  orders: ReadonlyMap<number, BinanceMyTrade[]>,
): Promise<WrittenOrders> => {
  const { deps, accountId, candidate } = read;
  const built = [...orders].map(([orderId, fills]) => ({
    orderId,
    ...tradeOrderRowsOf({ accountId, ...candidate, orderId, fills }),
  }));
  const placed = await placeWalletRows({
    accountId,
    planned: built.flatMap(({ rows }) => rows),
    config: BINANCE_WALK_CONFIG,
    listHoldings: deps.listHoldings,
    ensureHoldings: deps.ensureHoldings,
    missingCode: TRADE_HOLDING_MISSING,
  });

  if (placed.length > 0) {
    read.tally.imported += await deps.addTransactions(placed);
  }

  const untracked = [...new Set(built.flatMap((order) => order.untracked))];

  if (untracked.length > 0) {
    await historyListWriterOf(deps, accountId, 'untrackedCoins')(untracked);
  }

  return {
    rowless: new Set(built.filter(({ rows }) => rows.length === 0).map(({ orderId }) => orderId)),
    withRows: new Set(built.filter(({ rows }) => rows.length > 0).map(({ orderId }) => orderId)),
  };
};

/**
 * Write the cursor of the symbol with the orders the cursor has passed without a row, in one
 * patch, so the set is never behind the cursor that passed them.
 */
const writeCursor = async (
  read: SymbolRead,
  cursor: Pick<TradeSymbolEntry, 'fromId' | 'heldOrderId'>,
): Promise<void> => {
  const entry: TradeSymbolEntry = {
    ...cursor,
    ...(read.rowlessBehind.size === 0
      ? {}
      : { rowlessOrderIds: [...read.rowlessBehind].sort((left, right) => left - right) }),
  };

  await read.deps.patchExchangeState(read.accountId, [
    { kind: 'tradeSymbol', symbol: read.candidate.symbol, entry },
  ]);
  read.storedFromId = entry.fromId;
};

/**
 * The order the page ended on, if it came to no row. An order this run read whole is not held: its
 * first fill can be behind the cursor, which must not move back.
 */
const trailingOf = (
  read: SymbolRead,
  { orders, lastOrderId }: PageScan,
  rowless: ReadonlySet<number>,
): TrailingOrder | undefined => {
  if (lastOrderId === undefined || !rowless.has(lastOrderId) || read.reReads.has(lastOrderId)) {
    return undefined;
  }

  return foldMap(maybe(orders.get(lastOrderId)), (fills) => ({
    orderId: lastOrderId,
    fills,
    fromId: Number(firstFillOf(fills).id),
  }));
};

/**
 * Update the orders passed without a row after a write: an order that came to a row leaves, one
 * that came to none joins unless the cursor holds it at its first fill (`read.trailing`).
 */
const passRowlessOrders = (read: SymbolRead, written: WrittenOrders): void => {
  for (const orderId of written.withRows) {
    read.rowlessBehind.delete(orderId);
  }

  for (const orderId of written.rowless) {
    if (orderId !== read.trailing?.orderId) {
      read.rowlessBehind.add(orderId);
    }
  }
};

/**
 * One page of fills, committed: its rows first, then the cursor, so a crash between the two reads
 * the page again. The cursor is the first fill of the order the page ended on without a row, else
 * the stop fill when the page stops the read (with the order it holds, if one), else the id after
 * the page.
 */
const commitPage = async (
  read: SymbolRead,
  page: { rows: BinanceMyTrade[]; nextFromId: number },
): Promise<'next' | { stopAt: number }> => {
  const scan = await scanPage(read, page.rows);
  const { stop } = scan;

  const written = await writeOrders(read, scan.orders);

  read.trailing = trailingOf(read, scan, written.rowless);
  passRowlessOrders(read, written);
  await writeCursor(read, {
    fromId: read.trailing?.fromId ?? stop?.fillId ?? page.nextFromId,
    ...foldMap(maybe(stop?.heldOrderId), (heldOrderId) => ({ heldOrderId })),
  });

  return stop === undefined ? 'next' : { stopAt: stop.fillId };
};

/**
 * Write the order a symbol was left holding, from a re-read that fits the lane this time, and
 * drop the hold with the cursor patch after its rows. `false`: it does not fit, the symbol stays
 * held.
 */
const releaseHeldOrder = async (
  read: SymbolRead,
  heldOrderId: number,
  fromId: number,
): Promise<boolean> => {
  const whole = await readOrderFills(read, heldOrderId);

  if (whole === undefined) {
    return false;
  }

  read.reReads.set(heldOrderId, whole.lastFillId);
  passRowlessOrders(read, await writeOrders(read, new Map([[heldOrderId, whole.fills]])));
  await writeCursor(read, { fromId });

  return true;
};

const readSymbolFills = async (read: SymbolRead): Promise<{ ended: TradeReadEnd }> => {
  const { deps, credentials, candidate, stored } = read;
  const startFromId = stored?.fromId ?? 0;

  if (stored?.heldOrderId !== undefined) {
    const released = await releaseHeldOrder(read, stored.heldOrderId, startFromId);

    if (!released) {
      return { ended: 'budget' };
    }
  }

  const result = await readIdCursor({
    ...pagerOf(read),
    cost: COSTS.myTrades,
    fromId: startFromId,
    fetchPage: (fromId) =>
      deps.fetchMyTrades(
        credentials.apiKey,
        credentials.secret,
        candidate.symbol,
        fromId,
        optionsOf(deps),
      ),
    onPage: (page) => commitPage(read, page),
  });

  // A symbol with no fill stores 0, so it reads as read; a read that ended any other way has
  // stored its cursor with the last page it committed, or must stay unread. A caught-up symbol
  // whose last order came to no row keeps its cursor on that order, so the next run reads it again.
  const settledFromId = read.trailing?.fromId ?? result.nextFromId;

  if (result.end === 'short-page' && read.storedFromId !== settledFromId) {
    await writeCursor(read, { fromId: settledFromId });
  }

  return { ended: result.end };
};

/**
 * Read one symbol. A coin whose amount is past the safe integer is listed before the error ends
 * the symbol, because the order holding it is met again on every run.
 */
const readSymbol = (read: SymbolRead): Promise<{ ended: TradeReadEnd }> =>
  readSymbolFills(read).catch(async (error: unknown) => {
    if (error instanceof BinanceWalkStop && error.oversizedTicker !== undefined) {
      const listOversized = historyListWriterOf(read.deps, read.accountId, 'oversizedCoins');

      await listOversized([error.oversizedTicker]);
    }

    throw error;
  });

/** Sets the account's cooldown when `error` is a rate limit, and says whether it was one. */
const coolDownOnRateLimit = (
  deps: BinanceTradeHistoryDeps,
  accountId: string,
  error: unknown,
): boolean => {
  if (!(error instanceof BinanceRateLimitError)) {
    return false;
  }

  setBinanceCooldownUntil(accountId, deps.now() + error.retryAfterMs);

  return true;
};

/**
 * The one symbol list of the run, or `undefined` when the lane refuses it or Binance rate-limits
 * it (the cooldown is set then). Any other failure rejects.
 */
const readListing = (
  deps: BinanceTradeHistoryDeps,
  run: BinanceHistoryRun,
  accountId: string,
): Promise<ExchangeSymbolsPage | undefined> =>
  readSpotSymbols(run, () => deps.fetchExchangeSymbols({ fetchImpl: deps.fetchImpl })).catch(
    (error: unknown) => {
      if (!coolDownOnRateLimit(deps, accountId, error)) {
        throw error;
      }

      return undefined;
    },
  );

/** The stored state, or a stop: a state this build cannot read keeps nothing a walk writes. */
const parsedStateOf = async (deps: BinanceTradeHistoryDeps, accountId: string) =>
  match(parseExchangeState(await deps.readExchangeState(accountId)))
    .with({ kind: 'parsed' }, (parsed) => parsed)
    .with({ kind: 'malformed' }, () => {
      throw new BinanceWalkStop(EXCHANGE_STATE_MALFORMED);
    })
    .exhaustive();

const holdingCodesOf = (holdings: HoldingRow[]): string[] =>
  holdings.flatMap((holding) => {
    const parts = foldMap(maybe(binanceKeyOf(holding)), partsOfHoldingKey);

    return foldMap(maybe(parts), ({ code }) => [code]) ?? [];
  });

type TradeHistoryResult = { imported: number };

const nothingRead = (): TradeHistoryResult => ({ imported: 0 });

const runSync = async (
  deps: BinanceTradeHistoryDeps,
  request: {
    targetAccountId: string;
    run: BinanceHistoryRun;
    spotBalanceTexts: Readonly<Record<string, string>> | undefined;
  },
): Promise<TradeHistoryResult> => {
  const { targetAccountId: accountId, run, spotBalanceTexts } = request;

  if (isBinanceCoolingDown(accountId, deps.now())) {
    return nothingRead();
  }

  const credentials = await deps.readCredentials(accountId);

  if (credentials === undefined || spotBalanceTexts === undefined) {
    return nothingRead();
  }

  const state = await parsedStateOf(deps, accountId);
  const listing = await readListing(deps, run, accountId);

  if (listing === undefined) {
    return nothingRead();
  }

  const { trades } = state;
  const touched = touchedCoinsOf({
    holdingAssets: holdingCodesOf(await deps.listHoldings(accountId)),
    trades,
    untrackedCoins: state.untrackedCoins,
    oversizedCoins: state.oversizedCoins,
    listing: listing.symbols,
  });
  const candidates = tradeCandidatesOf({ listing: listing.symbols, touched, trades });
  const candidateBySymbol = Object.fromEntries(
    candidates.map((candidate) => [candidate.symbol, candidate]),
  );
  const tally = { imported: 0 };
  const reads = await runTradeSymbolReads({
    plan: planTradeSymbolReads({ candidates, trades, balanceTexts: spotBalanceTexts }),
    canAfford: (keep) => run.budget.canAfford('trades', COSTS.myTrades, keep),
    readSymbol: (symbol, keep) =>
      readSymbol({
        deps,
        run,
        accountId,
        credentials,
        candidate: candidateBySymbol[symbol],
        keep,
        stored: trades.symbols[symbol],
        reReads: new Map(),
        storedFromId: trades.symbols[symbol]?.fromId ?? null,
        trailing: undefined,
        rowlessBehind: new Set(trades.symbols[symbol]?.rowlessOrderIds ?? []),
        tally,
      }),
  });
  const patches = tradesPatchesOf({
    candidates,
    trades,
    balanceTexts: spotBalanceTexts,
    result: reads,
  });

  if (patches.length > 0) {
    await deps.patchExchangeState(accountId, patches);
  }

  for (const { error } of reads.symbolFailures) {
    logFailure(SYMBOL_FAILED_TAG, error);
  }

  if (reads.failure !== undefined && !coolDownOnRateLimit(deps, accountId, reads.failure.error)) {
    throw reads.failure.error;
  }

  return { imported: tally.imported };
};

/**
 * Import the user's Binance spot trades as transactions on the Spot holdings, one order at a
 * time: the symbols come from the exchange list and the user's coins (`tradeCandidatesOf`), are
 * read in the order `planTradeSymbolReads` gives, and each symbol pages by the id of its fills
 * from the cursor it stored. A page is written (rows, then cursor) before the next is asked, so
 * no fill sits unwritten behind a stored cursor. An order that gets a later fill is read whole
 * again, once per run, and its rows are rewritten under the same keys. A symbol whose answer or
 * amounts cannot be trusted ends alone and is logged by a fixed tag; a rate limit writes what
 * was read, sets the account's cooldown and ends the read cleanly, and any other failure writes
 * the progress and rejects, so the caller can log it without failing the balance sync. It
 * resolves with the rows imported, and reads nothing without the Spot balance texts of the run's
 * balance read.
 */
export const syncBinanceTradeHistory = (
  request: {
    targetAccountId: string;
    run: BinanceHistoryRun;
    spotBalanceTexts: Readonly<Record<string, string>> | undefined;
  },
  overrides: Partial<BinanceTradeHistoryDeps> = {},
): Promise<TradeHistoryResult> => runSync({ ...defaultTradeHistoryDeps, ...overrides }, request);
