import { act, renderHook } from '@testing-library/react-native';

const mockRunSync = jest.fn();
const mockRefreshRates = jest.fn();
const mockLatestFetchedAt = jest.fn();

jest.mock('../monobank/sync', () => ({
  runSync: (...args: unknown[]) => mockRunSync(...args),
}));
jest.mock('../rates/rates-refresh', () => ({
  refreshRates: (...args: unknown[]) => mockRefreshRates(...args),
}));
jest.mock('../repositories/rates.repo', () => ({
  ratesRepo: {
    latestFetchedAt: (...args: unknown[]) => mockLatestFetchedAt(...args),
  },
}));

import { useSync } from './use-sync';

describe('useSync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRunSync.mockResolvedValue(undefined);
    mockRefreshRates.mockResolvedValue(undefined);
    mockLatestFetchedAt.mockResolvedValue(null);
  });

  it('passes the stored latestFetchedAt to refreshRates as lastRefreshAt', async () => {
    mockLatestFetchedAt.mockResolvedValue(1_700_000_000_000);
    const { result } = await renderHook(() => useSync());

    await act(async () => {
      await result.current.sync();
    });

    expect(mockRunSync).toHaveBeenCalled();
    expect(mockRefreshRates).toHaveBeenCalledWith({ lastRefreshAt: 1_700_000_000_000 });
  });

  it('passes null when no rate has been stored yet', async () => {
    mockLatestFetchedAt.mockResolvedValue(null);
    const { result } = await renderHook(() => useSync());

    await act(async () => {
      await result.current.sync();
    });

    expect(mockRefreshRates).toHaveBeenCalledWith({ lastRefreshAt: null });
  });

  it('passes the target account id through to runSync', async () => {
    const { result } = await renderHook(() => useSync());

    await act(async () => {
      await result.current.sync('acc-42');
    });

    expect(mockRunSync).toHaveBeenCalledWith({ targetAccountId: 'acc-42' });
  });

  it('calls runSync with no target id when sync is invoked without one', async () => {
    const { result } = await renderHook(() => useSync());

    await act(async () => {
      await result.current.sync();
    });

    expect(mockRunSync).toHaveBeenCalledWith({ targetAccountId: undefined });
  });

  it('surfaces an error message when sync fails, without throwing', async () => {
    mockRunSync.mockRejectedValue(new Error('sync boom'));
    const { result } = await renderHook(() => useSync());

    await act(async () => {
      await result.current.sync();
    });

    expect(result.current.error).toMatch(/sync boom/);
  });

  it('resolves true when the sync and rate refresh succeed', async () => {
    const { result } = await renderHook(() => useSync());

    let outcome = false;
    await act(async () => {
      outcome = await result.current.sync('acc-42');
    });

    expect(outcome).toBe(true);
  });

  it('resolves false (and sets error) when the sync fails', async () => {
    mockRunSync.mockRejectedValue(new Error('sync boom'));
    const { result } = await renderHook(() => useSync());

    let outcome = true;
    await act(async () => {
      outcome = await result.current.sync();
    });

    expect(outcome).toBe(false);
    expect(result.current.error).toMatch(/sync boom/);
  });
});
