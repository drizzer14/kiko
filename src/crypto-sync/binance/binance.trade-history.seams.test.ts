import { setBinanceCooldownUntil } from './binance.cooldown';
import { syncBinanceTradeHistory } from './binance.trade-history';
import { createBinanceHistoryRun } from './binance.history-budget';
import { NOW, ORDER_A, TEXTS, fillOf, fillsBetween, worldOf } from './binance.trade-test-fixtures';

/** The defaults and the seams the trade read hands to the reads it calls. */

describe('the seams of the trade read', () => {
  describe('the clock', () => {
    const readWithoutNow = async (accountId: string) => {
      const fetchExchangeSymbols = jest.fn(async () => ({
        symbols: [],
        unreadable: 0,
        usedApiWeight1m: undefined,
      }));

      await syncBinanceTradeHistory(
        {
          targetAccountId: accountId,
          run: createBinanceHistoryRun({ now: () => NOW, sleep: async () => undefined }),
          spotBalanceTexts: TEXTS,
        },
        {
          readCredentials: async () => ({ apiKey: 'api-key', secret: 'secret' }),
          readExchangeState: async () => JSON.stringify({ version: 1, walks: {} }),
          patchExchangeState: async () => undefined,
          listHoldings: async () => [],
          fetchExchangeSymbols,
        },
      );

      return fetchExchangeSymbols;
    };

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('reads the clock when no now is passed', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(NOW);
      setBinanceCooldownUntil('acc-seam-clock', NOW + 60_000);

      expect(await readWithoutNow('acc-seam-clock')).not.toHaveBeenCalled();
    });

    it('reads the symbol list when the cooldown the clock shows has ended', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(NOW + 60_001);
      setBinanceCooldownUntil('acc-seam-clock-ended', NOW + 60_000);

      expect(await readWithoutNow('acc-seam-clock-ended')).toHaveBeenCalledTimes(1);
    });
  });

  it('passes the options and the fetch seam through to every read', async () => {
    const fetchImpl = (async () => ({})) as unknown as typeof fetch;
    const now = () => NOW;
    const world = worldOf({ fills: { BTCUSDT: fillsBetween(ORDER_A, 1, 2) } });

    await world.sync({ fetchImpl, now });
    world.server.fills.BTCUSDT.push(fillOf(3, ORDER_A));
    world.server.pageLimit = 4;
    await world.sync({ fetchImpl, now });

    expect(world.mocks.fetchExchangeSymbols).toHaveBeenCalledWith({ fetchImpl });
    expect(world.mocks.fetchMyTrades.mock.calls.map((call) => call[4])).toEqual([
      { fetchImpl, now },
      { fetchImpl, now },
    ]);
    expect(world.mocks.fetchOrderFills.mock.calls.map((call) => call[5])).toEqual([
      { fetchImpl, now },
    ]);
  });
});
