import { right } from 'fnts/either';

import { refreshAfterHoldingWrite } from './refresh-after-holding-write';

const mockRefreshMarketData = jest.fn();
jest.mock('@kiko/sync/refresh-market-data', () => ({
  refreshMarketData: (...args: unknown[]) => mockRefreshMarketData(...args),
}));

const mockConfirmDailyLimit = jest.fn();
jest.mock('@kiko/prices/daily-limit', () => ({
  confirmDailyLimit: (...args: unknown[]) => mockConfirmDailyLimit(...args),
}));

describe('refreshAfterHoldingWrite', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockRefreshMarketData.mockResolvedValue(right(undefined));
    mockConfirmDailyLimit.mockResolvedValue(undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('confirms the daily limit before it refreshes share prices', async () => {
    const order: string[] = [];
    mockConfirmDailyLimit.mockImplementation(async () => {
      order.push('confirm');
    });
    mockRefreshMarketData.mockImplementation(async () => {
      order.push('refresh');

      return right(undefined);
    });

    await refreshAfterHoldingWrite(true);

    expect(order).toEqual(['confirm', 'refresh']);
    expect(mockRefreshMarketData).toHaveBeenCalledWith({
      throttled: false,
      metals: true,
      shares: true,
    });
  });

  it('still refreshes when the daily limit check fails', async () => {
    mockConfirmDailyLimit.mockRejectedValue(new Error('settings read failed'));

    await refreshAfterHoldingWrite(true);

    expect(mockRefreshMarketData).toHaveBeenCalledTimes(1);
  });

  it('refreshes rates and metals only, with no limit check, when no share changed', async () => {
    await refreshAfterHoldingWrite(false);

    expect(mockConfirmDailyLimit).not.toHaveBeenCalled();
    expect(mockRefreshMarketData).toHaveBeenCalledWith({
      throttled: false,
      metals: true,
      shares: false,
    });
  });
});
