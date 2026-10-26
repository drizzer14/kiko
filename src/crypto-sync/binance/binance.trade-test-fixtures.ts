import assert from 'node:assert';
import type { HoldingRow } from '@kiko/db';
import {
  type ExchangeStatePatch,
  exchangeStatePatched,
  parseExchangeState,
} from '@kiko/crypto-sync/exchange/walk-state';

import { NO_WEIGHTS } from './binance.trade-symbols';
import { createBinanceHistoryRun } from './binance.history-budget';
import type { BinanceExchangeSymbol, BinanceMyTrade } from './binance.history-client';
import { type BinanceTradeHistoryDeps, syncBinanceTradeHistory } from './binance.trade-history';

/** When the fixture fills were made: the fill with id `n` is `n` milliseconds after this. */
export const FIRST_FILL_AT = 1_700_000_000_000;

/** A buy fill of 0.01 BTC for 600 USDT with no commission; a test overrides what it varies. */
export const fillOf = (
  id: number,
  orderId: number,
  over: Partial<BinanceMyTrade> = {},
): BinanceMyTrade => ({
  id,
  orderId,
  qty: '0.01',
  quoteQty: '600',
  commission: '0',
  commissionAsset: 'BTC',
  isBuyer: true,
  time: FIRST_FILL_AT + id,
  ...over,
});

/** The fills of one order with the ids `first` to `last`, each as `fillOf` makes it. */
export const fillsBetween = (
  orderId: number,
  first: number,
  last: number,
  over: Partial<BinanceMyTrade> = {},
): BinanceMyTrade[] =>
  Array.from({ length: last - first + 1 }, (_unused, offset) =>
    fillOf(first + offset, orderId, over),
  );

export const listed = (
  symbol: string,
  baseAsset: string,
  quoteAsset: string,
  status = 'TRADING',
): BinanceExchangeSymbol => ({ symbol, status, baseAsset, quoteAsset });

/** A stored Spot holding of one coin, with the id `holding-<coin>` the rows name it by. */
export const holdingWith = (key: string): HoldingRow =>
  ({ id: `holding-${key}`, metadata: { binanceAsset: key } }) as unknown as HoldingRow;

type Deps = BinanceTradeHistoryDeps;

type StoredRow = Parameters<Deps['addTransactions']>[0][number];

export const NOW = 1_704_326_400_000;
export const FAILURE_TAG = '[binance sync] trade symbol failed';
export const TEXTS = { BTC: '1/0', ETH: '2/0', BNB: '5/0', USDT: '1000/0' };
export const ORDER_A = 100;
export const ORDER_B = 200;
export const ORDER_X = 300;

// One fill is 0.01 BTC for 600 USDT, so an order of n fills is n times these.
export const BTC_PER_FILL = 1_000_000;
export const USDT_PER_FILL = -60_000_000_000;

const PAGE_LIMIT = 3;
const HELD_KEYS = ['BTC', 'ETH', 'BNB', 'USDT', 'XRP'];

let accountSequence = 0;

type WorldSeed = {
  listing?: BinanceExchangeSymbol[];
  fills?: Record<string, BinanceMyTrade[]>;
  /** Stored state beyond the walks, as the column holds it. */
  state?: Record<string, unknown>;
  stateText?: string;
  /** Orders that already have a row, by symbol and order id, as an earlier run left them. */
  imported?: [string, number][];
};

type Request = { symbol: string; fromId: number };

/**
 * A connected account over an in-memory exchange: a listing, the fills of each symbol, a store
 * that upserts rows by key and answers the prefix query, and the account's stored state.
 */
export const worldOf = (seed: WorldSeed = {}) => {
  accountSequence += 1;

  const accountId = `acc-trade-${accountSequence}`;
  const events: string[] = [];
  const stored = new Map<string, StoredRow>();
  let stateText: string | null =
    seed.stateText ?? JSON.stringify({ version: 1, walks: {}, ...seed.state });
  const server = {
    listing: seed.listing ?? [listed('BTCUSDT', 'BTC', 'USDT')],
    fills: { ...seed.fills },
    pageLimit: PAGE_LIMIT,
    /** What the balance read of the run gave, `undefined` when it gave none. */
    spotBalanceTexts: TEXTS as Record<string, string> | undefined,
    failMyTrades: undefined as ((request: Request) => Error | undefined) | undefined,
    failOrderFills: undefined as ((request: Request) => Error | undefined) | undefined,
    failAdd: undefined as ((call: number) => Error | undefined) | undefined,
    afterOrderFills: undefined as ((rows: BinanceMyTrade[]) => void) | undefined,
    answerOrderFills: undefined as ((rows: BinanceMyTrade[]) => BinanceMyTrade[]) | undefined,
  };

  const pairIdOf = (symbol: string, orderId: number): string =>
    `${accountId}:trade:${symbol}:${orderId}`;

  for (const [symbol, orderId] of seed.imported ?? []) {
    const externalId = `${pairIdOf(symbol, orderId)}:USDT`;

    stored.set(externalId, { externalId } as StoredRow);
  }

  const fillsOf = (symbol: string): BinanceMyTrade[] => server.fills[symbol] ?? [];

  const pageOf = (rows: BinanceMyTrade[]) => ({ rows, ...NO_WEIGHTS });

  const fetchExchangeSymbols = jest.fn<ReturnType<Deps['fetchExchangeSymbols']>, []>(async () => {
    events.push('symbols');

    return { symbols: server.listing, unreadable: 0, usedApiWeight1m: undefined };
  });

  const fetchMyTrades = jest.fn<
    ReturnType<Deps['fetchMyTrades']>,
    Parameters<Deps['fetchMyTrades']>
  >(async (_apiKey, _secret, symbol, fromId) => {
    events.push(`trades:${symbol}:${fromId}`);

    const failure = server.failMyTrades?.({ symbol, fromId });

    if (failure !== undefined) {
      throw failure;
    }

    return pageOf(
      fillsOf(symbol)
        .filter((fill) => Number(fill.id) >= fromId)
        .slice(0, server.pageLimit),
    );
  });

  const fetchOrderFills = jest.fn<
    ReturnType<Deps['fetchOrderFills']>,
    Parameters<Deps['fetchOrderFills']>
  >(async (_apiKey, _secret, symbol, orderId, fromId) => {
    events.push(`orderFills:${symbol}:${orderId}:${fromId}`);

    const failure = server.failOrderFills?.({ symbol, fromId });

    if (failure !== undefined) {
      throw failure;
    }

    const rows = fillsOf(symbol)
      .filter((fill) => fill.orderId === orderId && Number(fill.id) >= fromId)
      .slice(0, server.pageLimit);

    server.afterOrderFills?.(rows);

    return pageOf(server.answerOrderFills?.(rows) ?? rows);
  });

  const importedOrderPrefixes = jest.fn<
    ReturnType<Deps['importedOrderPrefixes']>,
    Parameters<Deps['importedOrderPrefixes']>
  >(async (prefixes) => {
    events.push('prefixes');

    return new Set(
      prefixes.filter((prefix) => [...stored.keys()].some((key) => key.startsWith(prefix))),
    );
  });

  // A write that lands only after every pending promise has run, so a walk that does not wait
  // for it reads a stale store.
  const addTransactions = jest.fn<
    ReturnType<Deps['addTransactions']>,
    Parameters<Deps['addTransactions']>
  >(async (rows) => {
    events.push('add');
    await new Promise((resolve) => setImmediate(resolve));

    const failure = server.failAdd?.(addTransactions.mock.calls.length);

    if (failure !== undefined) {
      throw failure;
    }

    const created = rows.filter(({ externalId }) => !stored.has(externalId)).length;

    for (const row of rows) {
      stored.set(row.externalId, row);
    }

    events.push('added');

    return created;
  });

  const patchExchangeState = jest.fn(
    async (_accountId: string, patches: readonly ExchangeStatePatch[]) => {
      events.push(`patch:${patches.map(({ kind }) => kind).join(',')}`);
      stateText = exchangeStatePatched(stateText, patches) ?? stateText;
    },
  );

  const depsOf = (over: Partial<Deps> = {}): Deps => ({
    now: () => NOW,
    fetchImpl: (async () => ({})) as unknown as typeof fetch,
    pageLimit: server.pageLimit,
    readCredentials: async () => ({ apiKey: 'test-key', secret: 'test-secret' }),
    listHoldings: async () => HELD_KEYS.map(holdingWith),
    ensureHoldings: async () => undefined,
    readExchangeState: async () => stateText,
    patchExchangeState,
    fetchExchangeSymbols,
    fetchMyTrades,
    fetchOrderFills,
    importedOrderPrefixes,
    addTransactions,
    ...over,
  });

  const freshRun = () => createBinanceHistoryRun({ now: () => NOW, sleep: async () => undefined });

  const sync = (over: Partial<Deps> = {}, run = freshRun()) =>
    syncBinanceTradeHistory(
      { targetAccountId: accountId, run, spotBalanceTexts: server.spotBalanceTexts },
      depsOf(over),
    );

  const parsedState = () => {
    const parsed = parseExchangeState(stateText);

    assert(parsed.kind === 'parsed');

    return parsed;
  };

  return {
    accountId,
    server,
    events,
    stored,
    freshRun,
    sync,
    mocks: { fetchExchangeSymbols, fetchMyTrades, fetchOrderFills, patchExchangeState },
    addTransactions,
    pairIdOf,
    keyOf: (symbol: string, orderId: number, wallet: string) =>
      `${pairIdOf(symbol, orderId)}:${wallet}`,
    feeKeyOf: (symbol: string, orderId: number, wallet: string) =>
      `${pairIdOf(symbol, orderId)}:fee:${wallet}`,
    amounts: () => Object.fromEntries([...stored].map(([key, row]) => [key, row.amountMinorUnits])),
    trades: () => parsedState().trades,
    oversizedHistory: () => parsedState().oversizedCoins.history,
    untrackedHistory: () => parsedState().untrackedCoins.history,
  };
};

export type World = ReturnType<typeof worldOf>;

export const runAfterCalls = (world: World, calls: number) => {
  const run = world.freshRun();

  for (let call = 0; call < calls; call += 1) {
    run.budget.record('trades', NO_WEIGHTS);
  }

  return run;
};

export const orderFillRequestsOf = (world: World) =>
  world.mocks.fetchOrderFills.mock.calls.map(([, , , orderId, fromId]) => [orderId, fromId]);

/** The fills of each symbol in id order, and the most fills one answer holds. */
export type FillServer = { fills: Record<string, BinanceMyTrade[]>; pageLimit: number };

/**
 * The two fill reads over `server`, read at each call, so a test can add fills and change the
 * page limit between runs and while a run is reading.
 */
export const fillReadsOf = (
  server: FillServer,
): Pick<BinanceTradeHistoryDeps, 'fetchMyTrades' | 'fetchOrderFills'> => {
  const fillsOf = (symbol: string): BinanceMyTrade[] => server.fills[symbol] ?? [];

  return {
    fetchMyTrades: async (_apiKey, _secret, symbol, fromId) => ({
      rows: fillsOf(symbol)
        .filter((fill) => Number(fill.id) >= fromId)
        .slice(0, server.pageLimit),
      ...NO_WEIGHTS,
    }),
    fetchOrderFills: async (_apiKey, _secret, symbol, orderId, fromId) => ({
      rows: fillsOf(symbol)
        .filter((fill) => fill.orderId === orderId && Number(fill.id) >= fromId)
        .slice(0, server.pageLimit),
      ...NO_WEIGHTS,
    }),
  };
};
