import {
  type ExchangeStatePatch,
  exchangeStatePatched,
  parseExchangeState,
} from '@kiko/crypto-sync/exchange/walk-state';
import { EXCHANGE_STATE_MALFORMED } from '@kiko/crypto-sync/exchange/walk';

import {
  type BinanceExchangeSymbol,
  type BinanceMyTrade,
  BinanceHistoryParseError,
} from './binance.history-client';
import { COSTS, createBinanceHistoryRun } from './binance.history-budget';
import { isBinanceCoolingDown, setBinanceCooldownUntil } from './binance.cooldown';
import { BinanceInvalidSymbolError, BinanceRateLimitError } from './binance.client';
import { fillOf, fillsBetween, holdingWith, listed } from './binance.trade-test-fixtures';
import { type BinanceTradeHistoryDeps, syncBinanceTradeHistory } from './binance.trade-history';

type Deps = BinanceTradeHistoryDeps;

type StoredRow = Parameters<Deps['addTransactions']>[0][number];

const NOW = 1_704_326_400_000;
const PAGE_LIMIT = 3;
const FAILURE_TAG = '[binance sync] trade symbol failed';
const HELD_KEYS = ['BTC', 'ETH', 'BNB', 'USDT'];
const TEXTS = { BTC: '1/0', ETH: '2/0', BNB: '5/0', USDT: '1000/0' };

// One fill is 0.01 BTC for 600 USDT, so an order of n fills is n times these.
const BTC_PER_FILL = 1_000_000;
const USDT_PER_FILL = -60_000_000_000;

const NO_WEIGHTS = {
  usedUidWeight1m: undefined,
  usedIpWeight1m: undefined,
  usedApiWeight1m: undefined,
};

const ORDER_A = 100;
const ORDER_B = 200;
const ORDER_X = 300;

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
const worldOf = (seed: WorldSeed = {}) => {
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
    readCredentials: async () => ({ apiKey: 'api-key', secret: 'secret' }),
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

    if (parsed.kind !== 'parsed') {
      throw new Error('the stored state was not readable');
    }

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

type World = ReturnType<typeof worldOf>;

const runAfterCalls = (world: World, calls: number) => {
  const run = world.freshRun();

  for (let call = 0; call < calls; call += 1) {
    run.budget.record('trades', NO_WEIGHTS);
  }

  return run;
};

const orderFillRequestsOf = (world: World) =>
  world.mocks.fetchOrderFills.mock.calls.map(([, , , orderId, fromId]) => [orderId, fromId]);

const NOTHING = { imported: 0, callsBySymbol: {} };

describe('syncBinanceTradeHistory', () => {
  let warn: jest.SpyInstance;

  const failureLogs = () =>
    warn.mock.calls
      .filter(([tag]) => tag === FAILURE_TAG)
      .map(([, detail]) => [detail.name, detail.code]);

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  describe('importing the fills of a symbol', () => {
    it('writes a bought order as a pair on the Spot holdings, each leg naming the other', async () => {
      const world = worldOf({ fills: { BTCUSDT: [fillOf(1, ORDER_A)] } });

      const result = await world.sync();

      expect(result).toEqual({ imported: 2, callsBySymbol: { BTCUSDT: 1 } });
      expect(world.amounts()).toEqual({
        [world.keyOf('BTCUSDT', ORDER_A, 'USDT')]: USDT_PER_FILL,
        [world.keyOf('BTCUSDT', ORDER_A, 'BTC')]: BTC_PER_FILL,
      });
      expect(world.stored.get(world.keyOf('BTCUSDT', ORDER_A, 'BTC'))).toMatchObject({
        holdingId: 'holding-BTC',
        exchangeCounterpartHoldingId: 'holding-USDT',
        exchangePairId: world.pairIdOf('BTCUSDT', ORDER_A),
        source: 'binance',
        operation: 'trade',
      });
    });

    it('sends no write for a symbol that has no fill', async () => {
      const world = worldOf();

      await world.sync();

      expect(world.addTransactions).not.toHaveBeenCalled();
    });

    it('stores the cursor of a symbol that has no fill as 0, so it reads as read', async () => {
      const world = worldOf();

      await world.sync();

      expect(world.trades().symbols).toEqual({ BTCUSDT: { fromId: 0 } });
      expect(world.mocks.fetchMyTrades).toHaveBeenCalledTimes(1);
      expect(world.mocks.fetchMyTrades.mock.calls[0]?.[3]).toBe(0);
    });

    it('stores the id after the last fill as the cursor and reads on from it', async () => {
      const world = worldOf({ fills: { BTCUSDT: fillsBetween(ORDER_A, 1, 2) } });

      await world.sync();
      world.server.fills.BTCUSDT.push(fillOf(5, ORDER_B));
      await world.sync();

      expect(world.trades().symbols.BTCUSDT).toEqual({ fromId: 6 });
      expect(world.mocks.fetchMyTrades.mock.calls.map((call) => call[3])).toEqual([0, 3]);
    });

    it('pages on while a page is full and counts every page against the symbol', async () => {
      const world = worldOf({
        fills: {
          BTCUSDT: Array.from({ length: 7 }, (_unused, offset) => fillOf(offset + 1, offset)),
        },
      });

      const result = await world.sync();

      expect(result.callsBySymbol).toEqual({ BTCUSDT: 3 });
      expect(world.trades().symbols.BTCUSDT).toEqual({ fromId: 8 });
    });

    it('judges a page of fills by the myTrades weight, keeping one call back for the rotation', async () => {
      const world = worldOf({ fills: { BTCUSDT: [fillOf(1, ORDER_A)] } });
      const run = world.freshRun();
      const canAfford = jest.spyOn(run.budget, 'canAfford');

      await world.sync({}, run);

      expect(canAfford.mock.calls.filter(([lane]) => lane === 'trades')).toEqual([
        ['trades', COSTS.myTrades, 1],
        ['trades', COSTS.myTrades, 1],
      ]);
    });

    it('records the weights a page reports against the trades lane', async () => {
      const world = worldOf({ fills: { BTCUSDT: [fillOf(1, ORDER_A)] } });
      const run = world.freshRun();
      const record = jest.spyOn(run.budget, 'record');

      await world.sync(
        {
          fetchMyTrades: async () => ({
            rows: [fillOf(1, ORDER_A)],
            usedUidWeight1m: undefined,
            usedIpWeight1m: undefined,
            usedApiWeight1m: 123,
          }),
        },
        run,
      );

      expect(record).toHaveBeenCalledWith(
        'trades',
        expect.objectContaining({ usedApiWeight1m: 123 }),
      );
    });

    it('lists the coin of an order that Kiko does not track after the rows of the order', async () => {
      const world = worldOf({
        listing: [listed('PEPEUSDT', 'PEPE', 'USDT')],
        state: {
          trades: { symbols: { PEPEUSDT: { fromId: 0 } }, rotation: '', balanceSnapshot: {} },
        },
        fills: {
          PEPEUSDT: [fillOf(1, ORDER_A, { qty: '1000000', quoteQty: '10', isBuyer: false })],
        },
      });

      await world.sync();

      expect(world.untrackedHistory()).toEqual(['PEPE']);
      expect(world.events.indexOf('added')).toBeLessThan(world.events.indexOf('patch:coinList'));
    });
  });

  describe('an order filled over more than one run', () => {
    it('refreshes the amounts of a partly filled order under the same keys, as one pair', async () => {
      const world = worldOf({ fills: { BTCUSDT: [fillOf(1, ORDER_A)] } });

      const first = await world.sync();

      world.server.fills.BTCUSDT.push(fillOf(2, ORDER_A));
      const second = await world.sync();

      expect(world.amounts()).toEqual({
        [world.keyOf('BTCUSDT', ORDER_A, 'USDT')]: 2 * USDT_PER_FILL,
        [world.keyOf('BTCUSDT', ORDER_A, 'BTC')]: 2 * BTC_PER_FILL,
      });
      expect(first.imported).toBe(2);
      expect(second.imported).toBe(0);
      expect(world.mocks.fetchOrderFills).toHaveBeenCalledTimes(1);
    });

    it('re-reads the order of a later fill by its id and leaves the other orders alone', async () => {
      const world = worldOf({
        fills: { BTCUSDT: [fillOf(1, ORDER_A), fillOf(2, ORDER_B)] },
      });

      await world.sync();
      world.server.fills.BTCUSDT.push(fillOf(3, ORDER_A));
      await world.sync();

      expect(orderFillRequestsOf(world)).toEqual([[ORDER_A, 0]]);
      expect(world.amounts()).toEqual({
        [world.keyOf('BTCUSDT', ORDER_A, 'USDT')]: 2 * USDT_PER_FILL,
        [world.keyOf('BTCUSDT', ORDER_A, 'BTC')]: 2 * BTC_PER_FILL,
        [world.keyOf('BTCUSDT', ORDER_B, 'USDT')]: USDT_PER_FILL,
        [world.keyOf('BTCUSDT', ORDER_B, 'BTC')]: BTC_PER_FILL,
      });
    });

    it('does not take an order for imported because its id starts with the id of another', async () => {
      const world = worldOf({ fills: { BTCUSDT: [fillOf(1, 12)] } });

      await world.sync();
      world.server.fills.BTCUSDT.push(fillOf(2, 123));
      await world.sync();

      expect(world.mocks.fetchOrderFills).not.toHaveBeenCalled();
      expect(world.amounts()).toEqual({
        [world.keyOf('BTCUSDT', 12, 'USDT')]: USDT_PER_FILL,
        [world.keyOf('BTCUSDT', 12, 'BTC')]: BTC_PER_FILL,
        [world.keyOf('BTCUSDT', 123, 'USDT')]: USDT_PER_FILL,
        [world.keyOf('BTCUSDT', 123, 'BTC')]: BTC_PER_FILL,
      });
    });

    it('holds the cursor and the order when the re-read does not fit the lane, then finishes it', async () => {
      const world = worldOf({
        fills: { BTCUSDT: [fillOf(1, ORDER_A), fillOf(2, ORDER_B)] },
      });

      await world.sync();
      world.server.fills.BTCUSDT.push(fillOf(3, ORDER_A));

      const held = await world.sync({}, runAfterCalls(world, 99));

      expect(world.mocks.fetchOrderFills).not.toHaveBeenCalled();
      expect(world.trades().symbols.BTCUSDT).toEqual({ fromId: 3, heldOrderId: ORDER_A });
      expect(world.amounts()[world.keyOf('BTCUSDT', ORDER_A, 'BTC')]).toBe(BTC_PER_FILL);
      expect(held.callsBySymbol).toEqual({ BTCUSDT: 1 });

      const eventsBefore = world.events.length;

      await world.sync();

      const finished = world.events.slice(eventsBefore);

      expect(orderFillRequestsOf(world)).toEqual([[ORDER_A, 0]]);
      expect(world.amounts()[world.keyOf('BTCUSDT', ORDER_A, 'BTC')]).toBe(2 * BTC_PER_FILL);
      expect(world.trades().symbols.BTCUSDT).toEqual({ fromId: 4 });
      expect(finished.indexOf('added')).toBeGreaterThan(-1);
      expect(finished.indexOf('added')).toBeLessThan(finished.indexOf('patch:tradeSymbol'));
    });

    it('stops at a fill that came after the re-read and reads the order again next run', async () => {
      const world = worldOf({ fills: { BTCUSDT: fillsBetween(ORDER_A, 1, 4) } });

      world.server.pageLimit = 4;
      await world.sync();
      world.server.pageLimit = 2;
      world.server.fills.BTCUSDT.push(fillOf(5, ORDER_A), fillOf(6, ORDER_X));
      world.server.afterOrderFills = (rows) => {
        if (rows.length < 2) {
          world.server.fills.BTCUSDT.push(fillOf(7, ORDER_A));
          world.server.afterOrderFills = undefined;
        }
      };

      await world.sync();

      expect(world.mocks.fetchOrderFills).toHaveBeenCalledTimes(3);
      expect(world.amounts()[world.keyOf('BTCUSDT', ORDER_A, 'BTC')]).toBe(5 * BTC_PER_FILL);
      expect(world.amounts()[world.keyOf('BTCUSDT', ORDER_X, 'BTC')]).toBe(BTC_PER_FILL);
      expect(world.trades().symbols.BTCUSDT).toEqual({ fromId: 7 });

      await world.sync();

      expect(world.amounts()[world.keyOf('BTCUSDT', ORDER_A, 'BTC')]).toBe(6 * BTC_PER_FILL);
      expect(world.trades().symbols.BTCUSDT).toEqual({ fromId: 8 });
    });

    it('adds the later fill of a sold untracked coin to the one row of the order', async () => {
      const sold = { qty: '1000000', quoteQty: '10', isBuyer: false };
      const world = worldOf({
        listing: [listed('PEPEUSDT', 'PEPE', 'USDT')],
        state: { untrackedCoins: { balance: [], history: ['PEPE'] } },
        fills: { PEPEUSDT: [fillOf(1, ORDER_A, sold)] },
      });
      const key = world.keyOf('PEPEUSDT', ORDER_A, 'USDT');

      await world.sync();
      world.server.fills.PEPEUSDT.push(fillOf(2, ORDER_A, sold));
      await world.sync();

      expect(world.amounts()).toEqual({ [key]: 2_000_000_000 });
      expect(world.stored.get(key)).toMatchObject({
        untrackedCounterpart: 'asset:PEPE',
        operation: 'trade',
      });
      expect(world.stored.get(key)?.exchangePairId).toBeUndefined();
    });

    it('refreshes the one fee row of a sold untracked coin, and the leg keeps no pair id', async () => {
      const sold = {
        qty: '1000000',
        quoteQty: '10',
        isBuyer: false,
        commission: '0.0005',
        commissionAsset: 'BNB',
      };
      const world = worldOf({
        listing: [listed('PEPEUSDT', 'PEPE', 'USDT')],
        state: { untrackedCoins: { balance: [], history: ['PEPE'] } },
        fills: { PEPEUSDT: [fillOf(1, ORDER_A, sold)] },
      });

      await world.sync();
      world.server.fills.PEPEUSDT.push(fillOf(2, ORDER_A, sold));
      await world.sync();

      expect(world.amounts()).toEqual({
        [world.keyOf('PEPEUSDT', ORDER_A, 'USDT')]: 2_000_000_000,
        [world.feeKeyOf('PEPEUSDT', ORDER_A, 'BNB')]: -10_000,
      });
      expect(world.stored.get(world.feeKeyOf('PEPEUSDT', ORDER_A, 'BNB'))).toMatchObject({
        operation: 'trade-fee',
        exchangePairId: world.pairIdOf('PEPEUSDT', ORDER_A),
        exchangeCounterpartHoldingId: 'holding-USDT',
      });
      expect(
        world.stored.get(world.keyOf('PEPEUSDT', ORDER_A, 'USDT'))?.exchangePairId,
      ).toBeUndefined();
    });
  });

  describe('an order cut by a page boundary', () => {
    const fiveFills = () => ({ fills: { BTCUSDT: fillsBetween(ORDER_A, 1, 5) } });

    it('writes the fills seen, then re-reads the order and writes it from all of them', async () => {
      const world = worldOf(fiveFills());

      await world.sync();

      expect(
        world.addTransactions.mock.calls.map(([rows]) => rows.map((row) => row.amountMinorUnits)),
      ).toEqual([
        [3 * USDT_PER_FILL, 3 * BTC_PER_FILL],
        [5 * USDT_PER_FILL, 5 * BTC_PER_FILL],
      ]);
      expect(orderFillRequestsOf(world)).toEqual([
        [ORDER_A, 0],
        [ORDER_A, 4],
      ]);
      expect(world.trades().symbols.BTCUSDT).toEqual({ fromId: 6 });
    });

    it('waits for the rows of a page before it looks up the orders of the next one', async () => {
      const world = worldOf(fiveFills());

      await world.sync();

      expect(world.events.filter((event) => ['prefixes', 'add', 'added'].includes(event))).toEqual([
        'prefixes',
        'add',
        'added',
        'prefixes',
        'add',
        'added',
      ]);
    });

    it('re-reads an order once in a run and does not look it up again after', async () => {
      const world = worldOf({ fills: { BTCUSDT: fillsBetween(ORDER_A, 1, 8) } });

      await world.sync();

      expect(world.events.filter((event) => event === 'prefixes')).toHaveLength(2);
      expect(orderFillRequestsOf(world)).toEqual([
        [ORDER_A, 0],
        [ORDER_A, 4],
        [ORDER_A, 7],
      ]);
      expect(world.amounts()[world.keyOf('BTCUSDT', ORDER_A, 'BTC')]).toBe(8 * BTC_PER_FILL);
    });
  });

  describe('a re-read of an order', () => {
    it('takes one call per full page and one for the short page, each at the order weight', async () => {
      const world = worldOf({
        fills: { BTCUSDT: fillsBetween(ORDER_A, 1, 2500) },
        state: {
          trades: { symbols: { BTCUSDT: { fromId: 2500 } }, rotation: '', balanceSnapshot: TEXTS },
        },
        imported: [['BTCUSDT', ORDER_A]],
      });
      const run = world.freshRun();
      const canAfford = jest.spyOn(run.budget, 'canAfford');

      world.server.pageLimit = 1000;

      const result = await world.sync({ pageLimit: 1000 }, run);

      expect(orderFillRequestsOf(world)).toEqual([
        [ORDER_A, 0],
        [ORDER_A, 1001],
        [ORDER_A, 2001],
      ]);
      expect(result.callsBySymbol).toEqual({ BTCUSDT: 4 });
      expect(canAfford.mock.calls.filter(([, cost]) => cost === COSTS.orderFills)).toHaveLength(3);
      expect(world.amounts()[world.keyOf('BTCUSDT', ORDER_A, 'BTC')]).toBe(2500 * BTC_PER_FILL);
    });

    it('reads the held order of a symbol first and leaves the lane one call for the rotation', async () => {
      const world = worldOf({
        fills: { BTCUSDT: fillsBetween(ORDER_A, 1, 150) },
        state: {
          trades: {
            symbols: { BTCUSDT: { fromId: 1, heldOrderId: ORDER_A } },
            rotation: '',
            balanceSnapshot: TEXTS,
          },
        },
      });
      const run = world.freshRun();

      world.server.pageLimit = 1;

      const result = await world.sync({ pageLimit: 1 }, run);

      expect(result.callsBySymbol).toEqual({ BTCUSDT: 99 });
      expect(run.budget.canAfford('trades', COSTS.myTrades)).toBe(true);
      expect(world.trades().symbols.BTCUSDT).toEqual({ fromId: 1, heldOrderId: ORDER_A });
      expect(world.addTransactions).not.toHaveBeenCalled();
    });

    it('fails the symbol when an answer carries a fill of another order', async () => {
      const world = worldOf({
        fills: { BTCUSDT: [fillOf(1, ORDER_A), fillOf(2, ORDER_B)] },
      });

      await world.sync();
      world.server.fills.BTCUSDT.push(fillOf(3, ORDER_A));
      world.server.answerOrderFills = (rows) => [...rows, fillOf(9, ORDER_B)];

      await world.sync();

      expect(failureLogs()).toEqual([['BinanceHistoryParseError', undefined]]);
      expect(world.amounts()[world.keyOf('BTCUSDT', ORDER_A, 'BTC')]).toBe(BTC_PER_FILL);
      expect(world.trades().symbols.BTCUSDT).toEqual({ fromId: 3 });
    });
  });

  describe('a run that does not start', () => {
    const expectNoRequest = (world: World) => {
      expect(world.mocks.fetchExchangeSymbols).not.toHaveBeenCalled();
      expect(world.mocks.fetchMyTrades).not.toHaveBeenCalled();
      expect(world.mocks.fetchOrderFills).not.toHaveBeenCalled();
      expect(world.mocks.patchExchangeState).not.toHaveBeenCalled();
    };

    it('sends no request while the account is cooling down', async () => {
      const world = worldOf();

      setBinanceCooldownUntil(world.accountId, NOW + 60_000);

      expect(await world.sync()).toEqual(NOTHING);
      expectNoRequest(world);
    });

    it('sends no request without credentials', async () => {
      const world = worldOf();

      expect(await world.sync({ readCredentials: async () => undefined })).toEqual(NOTHING);
      expectNoRequest(world);
    });

    it('sends no request without the balance texts of the Spot read', async () => {
      const world = worldOf();

      world.server.spotBalanceTexts = undefined;

      expect(await world.sync()).toEqual(NOTHING);
      expectNoRequest(world);
    });

    it('sends no myTrades request when the lane refuses the symbol list', async () => {
      const world = worldOf({ fills: { BTCUSDT: [fillOf(1, ORDER_A)] } });
      const run = world.freshRun();

      run.budget.record('tradeSymbols', NO_WEIGHTS);

      expect(await world.sync({}, run)).toEqual(NOTHING);
      expectNoRequest(world);
    });

    it('rejects without a request when the stored state is one this build cannot read', async () => {
      const world = worldOf({ stateText: '{' });

      await expect(world.sync()).rejects.toMatchObject({
        name: 'BinanceWalkStop',
        code: EXCHANGE_STATE_MALFORMED,
      });
      expect(world.mocks.fetchExchangeSymbols).not.toHaveBeenCalled();
    });
  });

  describe('a rate limit', () => {
    it('sets the cooldown and sends no trade request when the symbol list is limited', async () => {
      const world = worldOf();

      const result = await world.sync({
        fetchExchangeSymbols: async () => {
          throw new BinanceRateLimitError(429, 45_000);
        },
      });

      expect(result).toEqual(NOTHING);
      expect(isBinanceCoolingDown(world.accountId, NOW + 44_999)).toBe(true);
      expect(isBinanceCoolingDown(world.accountId, NOW + 45_000)).toBe(false);
      expect(world.mocks.fetchMyTrades).not.toHaveBeenCalled();
      expect(world.mocks.patchExchangeState).not.toHaveBeenCalled();
    });

    it('rejects, with no cooldown, when the symbol list cannot be read', async () => {
      const world = worldOf();

      await expect(
        world.sync({
          fetchExchangeSymbols: async () => {
            throw new BinanceHistoryParseError();
          },
        }),
      ).rejects.toBeInstanceOf(BinanceHistoryParseError);
      expect(isBinanceCoolingDown(world.accountId, NOW)).toBe(false);
    });

    it('writes what the run read before the limit, sets the cooldown and resolves', async () => {
      const world = worldOf({
        listing: [
          listed('BNBUSDT', 'BNB', 'USDT'),
          listed('BTCUSDT', 'BTC', 'USDT'),
          listed('ETHBTC', 'ETH', 'BTC'),
        ],
        fills: { BTCUSDT: fillsBetween(ORDER_A, 1, 4) },
        state: {
          trades: {
            symbols: { BNBUSDT: { fromId: 1 }, BTCUSDT: { fromId: 1 }, ETHBTC: { fromId: 1 } },
            rotation: '',
            balanceSnapshot: { BNB: '5/0', BTC: '1/0', USDT: '1000/0' },
          },
        },
      });

      world.server.failMyTrades = ({ symbol, fromId }) =>
        symbol === 'BTCUSDT' && fromId > 3 ? new BinanceRateLimitError(429, 30_000) : undefined;

      const result = await world.sync();

      expect(result.imported).toBe(2);
      expect(world.mocks.fetchMyTrades.mock.calls.map((call) => call[2])).toEqual([
        'ETHBTC',
        'BNBUSDT',
        'BTCUSDT',
        'BTCUSDT',
      ]);
      expect(world.amounts()[world.keyOf('BTCUSDT', ORDER_A, 'BTC')]).toBe(3 * BTC_PER_FILL);
      expect(world.trades()).toEqual({
        symbols: { BNBUSDT: { fromId: 1 }, BTCUSDT: { fromId: 4 }, ETHBTC: { fromId: 1 } },
        rotation: 'BNBUSDT',
        balanceSnapshot: { BNB: '5/0', BTC: '1/0', USDT: '1000/0', ETH: '2/0' },
      });
      expect(isBinanceCoolingDown(world.accountId, NOW + 29_999)).toBe(true);
      expect(isBinanceCoolingDown(world.accountId, NOW + 30_000)).toBe(false);
    });

    it('keeps the cursor before the page and sets the cooldown when a re-read is limited', async () => {
      const world = worldOf({
        fills: { BTCUSDT: [fillOf(1, ORDER_A), fillOf(2, ORDER_B)] },
      });

      await world.sync();
      world.server.fills.BTCUSDT.push(fillOf(3, ORDER_A));
      world.server.failOrderFills = () => new BinanceRateLimitError(418, 20_000);

      const result = await world.sync();

      expect(result.imported).toBe(0);
      expect(world.trades().symbols.BTCUSDT).toEqual({ fromId: 3 });
      expect(world.amounts()[world.keyOf('BTCUSDT', ORDER_A, 'BTC')]).toBe(BTC_PER_FILL);
      expect(isBinanceCoolingDown(world.accountId, NOW + 19_999)).toBe(true);
    });
  });

  describe('a symbol that fails', () => {
    const FOUR_SYMBOLS = [
      listed('BNBBTC', 'BNB', 'BTC'),
      listed('BNBUSDT', 'BNB', 'USDT'),
      listed('BTCUSDT', 'BTC', 'USDT'),
      listed('ETHUSDT', 'ETH', 'USDT'),
    ];

    const tooLarge = () => ({ BTCUSDT: [fillOf(1, ORDER_A, { qty: '1000000000' })] });

    it('ends only that symbol, logs each failure once, and reads the symbols after it', async () => {
      const world = worldOf({
        listing: FOUR_SYMBOLS,
        fills: { ...tooLarge(), ETHUSDT: [fillOf(1, ORDER_B, { commissionAsset: 'ETH' })] },
      });

      world.server.failMyTrades = ({ symbol }) => {
        if (symbol === 'BNBBTC') {
          return new BinanceInvalidSymbolError('Invalid symbol.');
        }

        return symbol === 'BNBUSDT' ? new BinanceHistoryParseError() : undefined;
      };

      const result = await world.sync();

      expect(result.callsBySymbol).toEqual({ BNBBTC: 1, BNBUSDT: 1, BTCUSDT: 1, ETHUSDT: 1 });
      expect(failureLogs()).toEqual([
        ['BinanceInvalidSymbolError', undefined],
        ['BinanceHistoryParseError', undefined],
        ['BinanceWalkStop', 'amount-too-large'],
      ]);
      expect(Object.keys(world.amounts()).sort()).toEqual([
        world.keyOf('ETHUSDT', ORDER_B, 'ETH'),
        world.keyOf('ETHUSDT', ORDER_B, 'USDT'),
      ]);
      expect(Object.keys(world.trades().symbols)).toEqual(['ETHUSDT']);
      expect(Object.keys(world.trades().balanceSnapshot)).toEqual(['ETH']);
    });

    it('lists a coin that is too large before any row of the run is written', async () => {
      const world = worldOf({
        listing: FOUR_SYMBOLS,
        fills: { ...tooLarge(), ETHUSDT: [fillOf(1, ORDER_B)] },
      });

      await world.sync();

      expect(world.oversizedHistory()).toEqual(['BTC']);
      expect(world.events.indexOf('patch:coinList')).toBeGreaterThan(-1);
      expect(world.events.indexOf('patch:coinList')).toBeLessThan(world.events.indexOf('add'));
    });

    it('logs a symbol that throws on every run once per run and still reads the others', async () => {
      const world = worldOf({
        listing: [listed('BNBUSDT', 'BNB', 'USDT'), listed('ETHUSDT', 'ETH', 'USDT')],
        fills: { ETHUSDT: [fillOf(1, ORDER_A)] },
      });

      world.server.failMyTrades = ({ symbol }) =>
        symbol === 'BNBUSDT' ? new BinanceHistoryParseError() : undefined;

      await world.sync();
      world.server.fills.ETHUSDT.push(fillOf(2, ORDER_B));
      await world.sync();

      expect(failureLogs()).toEqual([
        ['BinanceHistoryParseError', undefined],
        ['BinanceHistoryParseError', undefined],
      ]);
      expect(Object.keys(world.amounts())).toHaveLength(4);
    });

    it('writes nothing of a page that holds an order the rules refuse', async () => {
      const world = worldOf({
        fills: { BTCUSDT: [fillOf(1, ORDER_A), fillOf(2, ORDER_B, { qty: '0.123456789' })] },
      });

      await world.sync();

      expect(failureLogs()).toEqual([['BinanceWalkStop', 'amount-precision']]);
      expect(world.addTransactions).not.toHaveBeenCalled();
      expect(world.trades().symbols).toEqual({});
    });

    it('fails the symbol for an order whose fills disagree on the side', async () => {
      const world = worldOf({
        fills: { BTCUSDT: [fillOf(1, ORDER_A), fillOf(2, ORDER_A, { isBuyer: false })] },
      });

      await world.sync();

      expect(failureLogs()).toEqual([['BinanceHistoryParseError', undefined]]);
      expect(world.addTransactions).not.toHaveBeenCalled();
    });
  });

  describe('a write that fails', () => {
    it('stores no cursor for the page, keeps the progress before it and rethrows', async () => {
      const world = worldOf({
        fills: {
          BTCUSDT: [fillOf(1, ORDER_A), fillOf(2, ORDER_B), fillOf(3, ORDER_X), fillOf(4, 400)],
        },
      });

      world.server.pageLimit = 2;
      world.server.failAdd = (call) => (call === 2 ? new Error('database unavailable') : undefined);

      await expect(world.sync({ pageLimit: 2 })).rejects.toThrow('database unavailable');

      expect(world.trades().symbols.BTCUSDT).toEqual({ fromId: 3 });
      expect(Object.keys(world.amounts())).toHaveLength(4);
    });
  });
});
