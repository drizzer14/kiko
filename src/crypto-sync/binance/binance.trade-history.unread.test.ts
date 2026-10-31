import {
  ORDER_A,
  ORDER_B,
  fillOf,
  listed,
  runAfterCalls,
  worldOf,
} from './binance.trade-test-fixtures';
import { BinanceRateLimitError } from './binance.client';

/** The symbols the trade read stored as never read, which the account detail caption reads. */

const CALLS_OF_A_FULL_LANE = 100;

const TWO_SYMBOLS = [listed('BTCUSDT', 'BTC', 'USDT'), listed('ETHUSDT', 'ETH', 'USDT')];

const unreadOf = (world: ReturnType<typeof worldOf>): string[] =>
  world.trades().unreadSymbols ?? [];

describe('the unread symbols of the trade read', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('lists the symbols a run had no room to read, and drops them once a later run reads them', async () => {
    const world = worldOf({
      listing: TWO_SYMBOLS,
      fills: { BTCUSDT: [fillOf(1, ORDER_A)], ETHUSDT: [fillOf(1, ORDER_B)] },
    });

    await world.sync({}, runAfterCalls(world, CALLS_OF_A_FULL_LANE));

    expect(unreadOf(world)).toEqual(['BTCUSDT', 'ETHUSDT']);

    await world.sync();

    expect(unreadOf(world)).toEqual([]);
  });

  it('lists the symbols a rate limit left unread, the one it stopped on too', async () => {
    const world = worldOf({ listing: TWO_SYMBOLS, fills: { BTCUSDT: [fillOf(1, ORDER_A)] } });

    world.server.failMyTrades = () => new BinanceRateLimitError(429, 30_000);

    await world.sync();

    expect(unreadOf(world)).toEqual(['BTCUSDT', 'ETHUSDT']);
  });

  it('lists the symbol a rate limit stopped on, and not a symbol read before it', async () => {
    const world = worldOf({
      listing: TWO_SYMBOLS,
      fills: { BTCUSDT: [fillOf(1, ORDER_A)], ETHUSDT: [fillOf(1, ORDER_B)] },
    });

    world.server.failMyTrades = ({ symbol }) =>
      symbol === 'ETHUSDT' ? new BinanceRateLimitError(429, 30_000) : undefined;

    await world.sync();

    expect(unreadOf(world)).toEqual(['ETHUSDT']);
  });

  it('does not list a symbol whose read failed, in any run, so the caption can hide', async () => {
    const world = worldOf({
      listing: [listed('ABUSDT', 'A:B', 'USDT'), listed('BTCUSDT', 'BTC', 'USDT')],
      state: { untrackedCoins: { balance: [], history: ['A:B'] } },
      fills: { ABUSDT: [fillOf(1, ORDER_A)], BTCUSDT: [fillOf(1, ORDER_B)] },
    });

    await world.sync();

    expect(world.trades().symbols.ABUSDT).toBeUndefined();
    expect(unreadOf(world)).toEqual([]);

    await world.sync();

    expect(world.trades().symbols.ABUSDT).toBeUndefined();
    expect(unreadOf(world)).toEqual([]);
  });

  it('stores no list for an account whose every symbol was read in the first run', async () => {
    const world = worldOf({ fills: { BTCUSDT: [fillOf(1, ORDER_A)] } });

    await world.sync();

    expect(unreadOf(world)).toEqual([]);
  });
});
