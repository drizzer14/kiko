import { renderHook, waitFor } from '@testing-library/react-native';

const mockRunSync = jest.fn();
const mockRefreshRates = jest.fn();
const mockLatestFetchedAt = jest.fn();
const mockSettingsGetQuery = jest.fn();
const mockConnectedQuery = jest.fn();

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
jest.mock('../repositories/settings.repo', () => ({
  settingsRepo: {
    getQuery: (...args: unknown[]) => mockSettingsGetQuery(...args),
  },
}));
jest.mock('../repositories/accounts.repo', () => ({
  accountsRepo: {
    connectedQuery: (...args: unknown[]) => mockConnectedQuery(...args),
  },
}));

import { AUTO_SYNC_INTERVAL_MS, shouldAutoSync, useAutoSync } from './use-auto-sync';

describe('shouldAutoSync', () => {
  const now = 1_700_000_000_000;

  it.each([
    ['not connected, no prior sync', { connected: false, lastSyncAt: null, now }, false],
    ['connected, never synced', { connected: true, lastSyncAt: null, now }, true],
    [
      'connected, synced recently (within throttle window)',
      { connected: true, lastSyncAt: now - AUTO_SYNC_INTERVAL_MS + 1, now },
      false,
    ],
    [
      'connected, synced exactly at the throttle boundary',
      { connected: true, lastSyncAt: now - AUTO_SYNC_INTERVAL_MS, now },
      true,
    ],
    [
      'connected, synced long ago (outside throttle window)',
      { connected: true, lastSyncAt: now - AUTO_SYNC_INTERVAL_MS - 1, now },
      true,
    ],
    ['not connected, synced long ago', { connected: false, lastSyncAt: 0, now }, false],
  ] as const)('%s', (_description, input, expected) => {
    expect(shouldAutoSync(input)).toBe(expected);
  });
});

describe('useAutoSync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRunSync.mockResolvedValue(undefined);
    mockRefreshRates.mockResolvedValue(undefined);
    mockLatestFetchedAt.mockResolvedValue(null);
    mockSettingsGetQuery.mockResolvedValue([]);
    mockConnectedQuery.mockResolvedValue([]);
  });

  it('does nothing when no account is connected', async () => {
    mockConnectedQuery.mockResolvedValue([]);
    mockSettingsGetQuery.mockResolvedValue([{ lastSyncAt: null }]);

    await renderHook(() => useAutoSync());

    // Both gating reads are always awaited (via Promise.all) on every path,
    // including this bail path, so waiting on either deterministically
    // flushes the whole one-shot read regardless of the hook's internal
    // await depth — `waitFor` yields via a macrotask (`setImmediate`) after
    // its check passes, which drains every pending microtask, so the "not
    // called" assertions below are not coupled to how many `await` hops
    // `useAutoSync` takes internally.
    await waitFor(() => expect(mockConnectedQuery).toHaveBeenCalled());
    await waitFor(() => expect(mockSettingsGetQuery).toHaveBeenCalled());

    expect(mockRunSync).not.toHaveBeenCalled();
    expect(mockRefreshRates).not.toHaveBeenCalled();
  });

  it('does nothing when the last sync is within the throttle window', async () => {
    mockConnectedQuery.mockResolvedValue([{ id: 'acc-1' }]);
    mockSettingsGetQuery.mockResolvedValue([{ lastSyncAt: Date.now() }]);

    await renderHook(() => useAutoSync());

    await waitFor(() => expect(mockConnectedQuery).toHaveBeenCalled());
    await waitFor(() => expect(mockSettingsGetQuery).toHaveBeenCalled());

    expect(mockRunSync).not.toHaveBeenCalled();
    expect(mockRefreshRates).not.toHaveBeenCalled();
  });

  it('runs sync then refreshes rates when connected and past the throttle window', async () => {
    mockConnectedQuery.mockResolvedValue([{ id: 'acc-1' }]);
    mockSettingsGetQuery.mockResolvedValue([{ lastSyncAt: null }]);
    mockLatestFetchedAt.mockResolvedValue(42);

    await renderHook(() => useAutoSync());

    await waitFor(() => expect(mockRunSync).toHaveBeenCalledWith({ targetAccountId: 'acc-1' }));
    await waitFor(() => expect(mockRefreshRates).toHaveBeenCalledWith({ lastRefreshAt: 42 }));
  });

  it('swallows an error thrown by runSync without throwing out of the effect', async () => {
    mockConnectedQuery.mockResolvedValue([{ id: 'acc-1' }]);
    mockSettingsGetQuery.mockResolvedValue([{ lastSyncAt: null }]);
    mockRunSync.mockRejectedValue(new Error('sync boom'));

    await expect(renderHook(() => useAutoSync())).resolves.toBeDefined();

    await waitFor(() => expect(mockRunSync).toHaveBeenCalledWith({ targetAccountId: 'acc-1' }));

    expect(mockRefreshRates).not.toHaveBeenCalled();
  });

  it('swallows an error thrown while reading the connected account', async () => {
    mockConnectedQuery.mockRejectedValue(new Error('read boom'));

    await expect(renderHook(() => useAutoSync())).resolves.toBeDefined();

    await waitFor(() => expect(mockConnectedQuery).toHaveBeenCalled());

    expect(mockRunSync).not.toHaveBeenCalled();
  });
});
