import {
  BTC_PER_FILL,
  ORDER_A,
  ORDER_B,
  TEXTS,
  fillOf,
  listed,
  runAfterCalls,
  worldOf,
} from './binance.trade-test-fixtures';

/**
 * What the trade read stores in the account's state: the cursor of a symbol with the order it
 * holds and the orders it passed without a row, the coin lists, and the patches a run does not
 * send when it changed nothing.
 */

// A run that used 98 calls of its lane keeps room for one order's re-read but not for a page; one
// that used 100 has no room for either.
const CALLS_LEAVING_ROOM_FOR_A_RELEASE = 98;
const CALLS_OF_A_FULL_LANE = 100;

// The symbol is held on order A, whose fills 1 and 3 sandwich a fill of order B.
const heldWorld = (extra: Record<string, unknown> = {}) =>
  worldOf({
    fills: { BTCUSDT: [fillOf(1, ORDER_A), fillOf(2, ORDER_B), fillOf(3, ORDER_A)] },
    state: {
      trades: {
        symbols: { BTCUSDT: { fromId: 3, heldOrderId: ORDER_A, ...extra } },
        rotation: '',
        balanceSnapshot: TEXTS,
      },
    },
  });

describe('the state of the trade read', () => {
  describe('a held order', () => {
    it('stores the cursor with the release of a held order when the lane has no room left for a page of fills', async () => {
      const world = heldWorld();

      await world.sync({}, runAfterCalls(world, CALLS_LEAVING_ROOM_FOR_A_RELEASE));

      expect(world.mocks.fetchMyTrades).not.toHaveBeenCalled();
      expect(world.mocks.fetchOrderFills).toHaveBeenCalledTimes(1);
      expect(world.amounts()[world.keyOf('BTCUSDT', ORDER_A, 'BTC')]).toBe(2 * BTC_PER_FILL);
      expect(world.trades().symbols.BTCUSDT).toEqual({ fromId: 3 });
    });

    it('drops a held order from the rowless set when its release writes rows', async () => {
      const world = heldWorld({ rowlessOrderIds: [ORDER_A] });

      await world.sync({}, runAfterCalls(world, CALLS_LEAVING_ROOM_FOR_A_RELEASE));

      expect(world.amounts()[world.keyOf('BTCUSDT', ORDER_A, 'BTC')]).toBe(2 * BTC_PER_FILL);
      expect(world.trades().symbols.BTCUSDT).toEqual({ fromId: 3 });
    });
  });

  describe('an order the cursor passed without a row', () => {
    it('takes an order the cursor passed as imported without a prefix lookup', async () => {
      const world = worldOf({
        fills: { BTCUSDT: [fillOf(1, ORDER_A), fillOf(2, ORDER_A), fillOf(3, ORDER_A)] },
        state: {
          trades: {
            symbols: { BTCUSDT: { fromId: 3, rowlessOrderIds: [ORDER_A] } },
            rotation: '',
            balanceSnapshot: TEXTS,
          },
        },
      });

      world.server.pageLimit = 4;
      await world.sync();

      expect(world.mocks.fetchOrderFills).toHaveBeenCalledTimes(1);
      expect(world.amounts()[world.keyOf('BTCUSDT', ORDER_A, 'BTC')]).toBe(3 * BTC_PER_FILL);
      expect(world.events).not.toContain('prefixes');
    });
  });

  describe('the patches of a run', () => {
    it('writes no coin list patch for a page whose coins are all tracked', async () => {
      const world = worldOf({ fills: { BTCUSDT: [fillOf(1, ORDER_A)] } });

      await world.sync();

      expect(world.events).toContain('added');
      expect(world.events).not.toContain('patch:coinList');
    });

    it('lists the coin of a page that holds one Kiko does not track', async () => {
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

      expect(world.events).toContain('patch:coinList');
    });

    it('writes no cursor patch for a caught-up symbol that reads an empty page', async () => {
      const world = worldOf({
        fills: { BTCUSDT: [fillOf(1, ORDER_A), fillOf(2, ORDER_B)] },
        state: {
          trades: {
            symbols: { BTCUSDT: { fromId: 3 } },
            rotation: '',
            balanceSnapshot: TEXTS,
          },
        },
      });

      await world.sync();

      expect(world.mocks.fetchMyTrades).toHaveBeenCalledTimes(1);
      expect(world.events.filter((event) => event.startsWith('patch:tradeSymbol'))).toEqual([]);
    });

    it('writes no state patch when the run changed no rotation or snapshot', async () => {
      const world = heldWorld();

      const result = await world.sync({}, runAfterCalls(world, CALLS_OF_A_FULL_LANE));

      expect(result).toEqual({ imported: 0 });
      expect(world.mocks.fetchOrderFills).not.toHaveBeenCalled();
      expect(world.mocks.fetchMyTrades).not.toHaveBeenCalled();
      expect(world.mocks.patchExchangeState).not.toHaveBeenCalled();
    });

    it('writes the rotation patch of a run that read a symbol in rotation order', async () => {
      const world = worldOf({
        state: {
          trades: {
            symbols: { BTCUSDT: { fromId: 3 } },
            rotation: '',
            balanceSnapshot: TEXTS,
          },
        },
      });

      await world.sync();

      expect(world.mocks.patchExchangeState).toHaveBeenCalledWith(world.accountId, [
        { kind: 'tradesRotation', value: 'BTCUSDT' },
      ]);
    });
  });
});
