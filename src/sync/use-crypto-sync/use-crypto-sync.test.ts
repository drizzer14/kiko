import { act, renderHook } from '@testing-library/react-native';

const mockRunCryptoSync = jest.fn();
const mockRefreshRates = jest.fn();
const mockLatestFetchedAt = jest.fn();

jest.mock('../../crypto-sync/run-crypto-sync', () => ({
  runCryptoSync: (...args: unknown[]) => mockRunCryptoSync(...args),
}));
jest.mock('../../rates/rates-refresh', () => ({
  refreshRates: (...args: unknown[]) => mockRefreshRates(...args),
}));
jest.mock('@kiko/rates/repo', () => ({
  ratesRepo: {
    latestFetchedAt: (...args: unknown[]) => mockLatestFetchedAt(...args),
  },
}));

import { useCryptoSync } from './use-crypto-sync';

const ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

describe('useCryptoSync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRunCryptoSync.mockResolvedValue({ syncedHoldings: 1 });
    mockRefreshRates.mockResolvedValue(undefined);
    mockLatestFetchedAt.mockResolvedValue(1_700_000_000_000);
  });

  it('passes the request through to runCryptoSync, then refreshes rates with the stored latestFetchedAt', async () => {
    const { result } = await renderHook(() => useCryptoSync());

    await act(async () => {
      await result.current.sync({
        providerId: 'btc_wallet',
        targetAccountId: 'acc-1',
        address: ADDRESS,
      });
    });

    expect(mockRunCryptoSync).toHaveBeenCalledWith({
      providerId: 'btc_wallet',
      targetAccountId: 'acc-1',
      address: ADDRESS,
    });
    expect(mockRefreshRates).toHaveBeenCalledWith({ lastRefreshAt: 1_700_000_000_000 });
  });

  it('resolves true and leaves no error on success', async () => {
    const { result } = await renderHook(() => useCryptoSync());

    let outcome = false;
    await act(async () => {
      outcome = await result.current.sync({ providerId: 'binance', targetAccountId: 'acc-2' });
    });

    expect(outcome).toBe(true);
    expect(result.current.error).toBeUndefined();
    expect(result.current.isSyncing).toBe(false);
  });

  it('resolves false and surfaces the error message when the sync fails, without throwing', async () => {
    mockRunCryptoSync.mockRejectedValue(new Error('Binance request failed: 401'));
    const { result } = await renderHook(() => useCryptoSync());

    let outcome = true;
    await act(async () => {
      outcome = await result.current.sync({ providerId: 'binance', targetAccountId: 'acc-2' });
    });

    expect(outcome).toBe(false);
    expect(result.current.error).toBe('Binance request failed: 401');
    expect(mockRefreshRates).not.toHaveBeenCalled();
  });
});
