import {
  FAILURE_TAG,
  ORDER_A,
  ORDER_B,
  fillOf,
  holdingWith,
  listed,
  worldOf,
} from './binance.trade-test-fixtures';
import { BinanceRateLimitError } from './binance.client';

/** What the trade read does with a symbol or a run that fails, and what it logs for it. */

describe('the failures of the trade read', () => {
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

  it('stops the symbol with an unreadable row for an untracked ticker with a colon', async () => {
    const world = worldOf({
      listing: [listed('ABUSDT', 'A:B', 'USDT')],
      state: { untrackedCoins: { balance: [], history: ['A:B'] } },
      fills: { ABUSDT: [fillOf(1, ORDER_A)] },
    });

    await world.sync();

    expect(failureLogs()).toEqual([['BinanceWalkStop', 'trade-row-unreadable']]);
    expect(world.addTransactions).not.toHaveBeenCalled();
  });

  it('stops with the holding-missing code when no Spot holding can be found', async () => {
    const world = worldOf({
      state: {
        trades: { symbols: { BTCUSDT: { fromId: 0 } }, rotation: '', balanceSnapshot: {} },
      },
      fills: { BTCUSDT: [fillOf(1, ORDER_A)] },
    });

    await world.sync({ listHoldings: async () => ['USDT'].map(holdingWith) });

    expect(failureLogs()).toEqual([['BinanceWalkStop', 'trade-holding-missing']]);
    expect(world.addTransactions).not.toHaveBeenCalled();
  });

  it('fails only the symbol whose re-read answers no fill and reads the symbols after it', async () => {
    const world = worldOf({
      listing: [listed('BTCUSDT', 'BTC', 'USDT'), listed('ETHUSDT', 'ETH', 'USDT')],
      fills: { BTCUSDT: [fillOf(1, ORDER_A)], ETHUSDT: [fillOf(1, ORDER_B)] },
    });

    await world.sync();
    world.server.fills.BTCUSDT.push(fillOf(2, ORDER_A));
    world.server.fills.ETHUSDT.push(fillOf(2, 400));
    world.server.answerOrderFills = () => [];

    await world.sync();

    expect(failureLogs()).toEqual([['BinanceHistoryParseError', undefined]]);
    expect(world.amounts()[world.keyOf('ETHUSDT', 400, 'ETH')]).toBeDefined();
    expect(world.trades().symbols.ETHUSDT).toEqual({ fromId: 3 });
    expect(world.trades().symbols.BTCUSDT).toEqual({ fromId: 2 });
  });

  it('keeps the oversized history list through a rate limit and a stop with no ticker', async () => {
    const seed = {
      state: { oversizedCoins: { balance: [], history: ['DOGE'] } },
      fills: { BTCUSDT: [fillOf(1, ORDER_A)] },
    };
    const limited = worldOf(seed);

    limited.server.failMyTrades = () => new BinanceRateLimitError(429, 30_000);
    await limited.sync();

    expect(limited.oversizedHistory()).toEqual(['DOGE']);

    const refused = worldOf({
      ...seed,
      fills: { BTCUSDT: [fillOf(1, ORDER_A, { qty: '-1' })] },
    });

    await refused.sync();

    expect(failureLogs()).toEqual([['BinanceWalkStop', 'trade-amount-invalid']]);
    expect(refused.oversizedHistory()).toEqual(['DOGE']);
  });
});
