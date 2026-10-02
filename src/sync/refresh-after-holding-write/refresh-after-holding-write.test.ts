import { right } from 'fnts/either';

import { refreshAfterHoldingWrite } from './refresh-after-holding-write';

const mockRefreshMarketData = jest.fn();
jest.mock('@kiko/sync/refresh-market-data', () => ({
  refreshMarketData: (...args: unknown[]) => mockRefreshMarketData(...args),
}));

describe('refreshAfterHoldingWrite', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRefreshMarketData.mockResolvedValue(right(undefined));
  });

  it('refreshes rates and metals, unthrottled', async () => {
    await refreshAfterHoldingWrite();

    expect(mockRefreshMarketData).toHaveBeenCalledTimes(1);
    expect(mockRefreshMarketData).toHaveBeenCalledWith({ throttled: false, metals: true });
  });
});
