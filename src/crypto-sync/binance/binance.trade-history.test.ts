import { EXCHANGE_STATE_MALFORMED } from '@kiko/crypto-sync/exchange/walk';

import {
  BTC_PER_FILL,
  FAILURE_TAG,
  NOW,
  ORDER_A,
  ORDER_B,
  ORDER_X,
  TEXTS,
  USDT_PER_FILL,
  type World,
  fillOf,
  fillsBetween,
  listed,
  orderFillRequestsOf,
  runAfterCalls,
  worldOf,
} from './binance.trade-test-fixtures';
import { COSTS } from './binance.history-budget';
import { NO_WEIGHTS } from './binance.trade-symbols';
import { isBinanceCoolingDown, setBinanceCooldownUntil } from './binance.cooldown';
import { BinanceInvalidSymbolError, BinanceRateLimitError } from './binance.client';
import { type BinanceMyTrade, BinanceHistoryParseError } from './binance.history-client';

const NOTHING = { imported: 0 };

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

      expect(result).toEqual({ imported: 2 });
      expect(world.mocks.fetchMyTrades).toHaveBeenCalledTimes(1);
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

      await world.sync();

      expect(world.mocks.fetchMyTrades).toHaveBeenCalledTimes(3);
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

      await world.sync({}, runAfterCalls(world, 99));

      expect(world.mocks.fetchOrderFills).not.toHaveBeenCalled();
      expect(world.trades().symbols.BTCUSDT).toEqual({ fromId: 3, heldOrderId: ORDER_A });
      expect(world.amounts()[world.keyOf('BTCUSDT', ORDER_A, 'BTC')]).toBe(BTC_PER_FILL);
      expect(world.mocks.fetchMyTrades).toHaveBeenCalledTimes(2);

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
      expect(failureLogs()).toEqual([]);

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

  describe('an order that comes to no row at the end of a page', () => {
    // An XRP fill of 0.00004 is 0.4 of a stored unit (XRP keeps 4 decimals), so one fill alone
    // rounds to nothing and four of them come to 2 units.
    const FOUR_FILLS = { xrp: 2, usdt: -400_000_000 };
    const dustFill = (id: number, orderId: number) =>
      fillOf(id, orderId, { qty: '0.00004', quoteQty: '1' });
    const wholeFill = (id: number, orderId: number) =>
      fillOf(id, orderId, { qty: '1', quoteQty: '10' });
    const xrpWorld = (fills: BinanceMyTrade[]) =>
      worldOf({ listing: [listed('XRPUSDT', 'XRP', 'USDT')], fills: { XRPUSDT: fills } });
    const totalsOf = (world: World, orderId: number) => ({
      xrp: world.amounts()[world.keyOf('XRPUSDT', orderId, 'XRP')],
      usdt: world.amounts()[world.keyOf('XRPUSDT', orderId, 'USDT')],
    });

    it('reads the order whole on the next page, so its total counts every fill', async () => {
      const world = xrpWorld([
        wholeFill(1, ORDER_B),
        wholeFill(2, ORDER_B),
        dustFill(3, ORDER_A),
        dustFill(4, ORDER_A),
        dustFill(5, ORDER_A),
        dustFill(6, ORDER_A),
      ]);

      await world.sync();

      expect(totalsOf(world, ORDER_A)).toEqual(FOUR_FILLS);
      expect(world.trades().symbols.XRPUSDT).toEqual({ fromId: 7 });
      expect(world.mocks.fetchOrderFills).not.toHaveBeenCalled();
    });

    it('keeps the cursor at the first fill of the order until the next page settles it', async () => {
      const world = xrpWorld([
        wholeFill(1, ORDER_B),
        wholeFill(2, ORDER_B),
        dustFill(3, ORDER_A),
        dustFill(4, ORDER_A),
      ]);
      const cursors: unknown[] = [];

      world.mocks.patchExchangeState.mockImplementation(async (_accountId, patches) => {
        cursors.push(...patches.filter(({ kind }) => kind === 'tradeSymbol'));
      });

      await world.sync();

      expect(cursors).toEqual([
        { kind: 'tradeSymbol', symbol: 'XRPUSDT', entry: { fromId: 3 } },
        { kind: 'tradeSymbol', symbol: 'XRPUSDT', entry: { fromId: 5 } },
      ]);
    });

    it('carries the fills over more than one page', async () => {
      // 0.00001 XRP is a tenth of a stored unit: no single page of it comes to a unit, seven do.
      const tenth = (id: number) => fillOf(id, ORDER_A, { qty: '0.00001', quoteQty: '1' });
      const world = xrpWorld([1, 2, 3, 4, 5, 6, 7].map(tenth));

      await world.sync();

      expect(totalsOf(world, ORDER_A)).toEqual({ xrp: 1, usdt: -700_000_000 });
      expect(world.trades().symbols.XRPUSDT).toEqual({ fromId: 8 });
    });

    it('reads the order from its first fill in the next run, so nothing is lost', async () => {
      const world = xrpWorld([wholeFill(1, ORDER_B), wholeFill(2, ORDER_B), dustFill(3, ORDER_A)]);

      await world.sync();

      expect(world.trades().symbols.XRPUSDT).toEqual({ fromId: 3 });
      expect(totalsOf(world, ORDER_A)).toEqual({ xrp: undefined, usdt: undefined });

      world.server.fills.XRPUSDT.push(
        dustFill(4, ORDER_A),
        dustFill(5, ORDER_A),
        dustFill(6, ORDER_A),
      );
      await world.sync();

      expect(totalsOf(world, ORDER_A)).toEqual(FOUR_FILLS);
      expect(world.trades().symbols.XRPUSDT).toEqual({ fromId: 7 });
      expect(world.amounts()[world.keyOf('XRPUSDT', ORDER_B, 'XRP')]).toBe(20_000);
    });

    it('makes the one caught-up call per run when the last order still comes to no row', async () => {
      const world = xrpWorld([wholeFill(1, ORDER_B), dustFill(2, ORDER_A)]);

      await world.sync();
      await world.sync();
      await world.sync();

      expect(world.mocks.fetchMyTrades.mock.calls.map((call) => call[3])).toEqual([0, 2, 2]);
      expect(world.mocks.fetchOrderFills).not.toHaveBeenCalled();
      expect(world.trades().symbols.XRPUSDT).toEqual({ fromId: 2 });
      expect(Object.keys(world.trades().balanceSnapshot)).toContain('XRP');
      expect(world.addTransactions).toHaveBeenCalledTimes(1);
    });

    it('settles the order when a later fill of it arrives', async () => {
      const world = xrpWorld([wholeFill(1, ORDER_B), dustFill(2, ORDER_A)]);

      await world.sync();
      await world.sync();
      world.server.fills.XRPUSDT.push(dustFill(3, ORDER_A));
      await world.sync();

      expect(totalsOf(world, ORDER_A)).toEqual({ xrp: 1, usdt: -200_000_000 });
      expect(world.trades().symbols.XRPUSDT).toEqual({ fromId: 4 });
      expect(world.mocks.fetchMyTrades.mock.calls.map((call) => call[3])).toEqual([0, 2, 2]);
    });

    it('lets the cursor pass the order when a fill of another order follows it', async () => {
      const world = xrpWorld([wholeFill(1, ORDER_B), dustFill(2, ORDER_A)]);

      await world.sync();
      world.server.fills.XRPUSDT.push(wholeFill(3, ORDER_X));
      await world.sync();

      expect(totalsOf(world, ORDER_A)).toEqual({ xrp: undefined, usdt: undefined });
      expect(world.trades().symbols.XRPUSDT).toEqual({ fromId: 4, rowlessOrderIds: [ORDER_A] });
    });

    it('also holds an order of two untracked coins whose BNB fee rounds to nothing', async () => {
      const dustFee = (id: number, orderId: number) =>
        fillOf(id, orderId, {
          qty: '1000',
          quoteQty: '10',
          commission: '0.00000004',
          commissionAsset: 'BNB',
        });
      const world = worldOf({
        listing: [listed('PEPESHIB', 'PEPE', 'SHIB')],
        state: { untrackedCoins: { balance: [], history: ['PEPE', 'SHIB'] } },
        fills: {
          PEPESHIB: [
            fillOf(1, ORDER_B, {
              qty: '1000',
              quoteQty: '10',
              commission: '0.0000005',
              commissionAsset: 'BNB',
            }),
            fillOf(2, ORDER_B, {
              qty: '1000',
              quoteQty: '10',
              commission: '0.0000005',
              commissionAsset: 'BNB',
            }),
            dustFee(3, ORDER_A),
            dustFee(4, ORDER_A),
            dustFee(5, ORDER_A),
            dustFee(6, ORDER_A),
          ],
        },
      });

      await world.sync();

      expect(world.amounts()[world.feeKeyOf('PEPESHIB', ORDER_A, 'BNB')]).toBe(-2);
      expect(world.amounts()[world.feeKeyOf('PEPESHIB', ORDER_B, 'BNB')]).toBe(-10);
      expect(world.trades().symbols.PEPESHIB).toEqual({ fromId: 7 });
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

      await world.sync({ pageLimit: 1000 }, run);

      expect(orderFillRequestsOf(world)).toEqual([
        [ORDER_A, 0],
        [ORDER_A, 1001],
        [ORDER_A, 2001],
      ]);
      expect(world.mocks.fetchMyTrades).toHaveBeenCalledTimes(1);
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

      await world.sync({ pageLimit: 1 }, run);

      expect(world.mocks.fetchOrderFills).toHaveBeenCalledTimes(99);
      expect(world.mocks.fetchMyTrades).not.toHaveBeenCalled();
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

      await world.sync();

      expect(world.mocks.fetchMyTrades.mock.calls.map((call) => call[2]).sort()).toEqual([
        'BNBBTC',
        'BNBUSDT',
        'BTCUSDT',
        'ETHUSDT',
      ]);
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
