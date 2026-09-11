import { renderHook, waitFor } from '@testing-library/react-native';

const mockRefreshRates = jest.fn();
const mockLatestFetchedAt = jest.fn();
const mockSyncStateGetQuery = jest.fn();
const mockConnectedQuery = jest.fn();
const mockHasToken = jest.fn();

// Controllable per-institution job runs, so a test can assert which accounts the
// app-open fan-out actually synced without exercising the real sync pipelines
// (those are covered by their own suites).
const mockMonobankRun = jest.fn();
const mockCryptoRun = jest.fn();

jest.mock('./sync-jobs', () => ({
  syncJobsFor: (account: { name: string; institution: string | null }) => {
    if (account.institution === 'monobank') {
      return [{ name: account.name, run: mockMonobankRun }];
    }
    if (account.institution === 'binance' || account.institution === 'btc_wallet') {
      return [{ name: account.name, run: mockCryptoRun }];
    }
    return [];
  },
}));
jest.mock('../monobank/token', () => ({
  hasToken: (...args: unknown[]) => mockHasToken(...args),
}));
jest.mock('../rates/rates-refresh', () => ({
  refreshRates: (...args: unknown[]) => mockRefreshRates(...args),
}));
jest.mock('@kiko/rates/rates.repo', () => ({
  ratesRepo: {
    latestFetchedAt: (...args: unknown[]) => mockLatestFetchedAt(...args),
  },
}));
jest.mock('@kiko/sync-state/sync-state.repo', () => ({
  syncStateRepo: {
    getQuery: (...args: unknown[]) => mockSyncStateGetQuery(...args),
  },
}));
jest.mock('@kiko/accounts/accounts.repo', () => ({
  accountsRepo: {
    connectedQuery: (...args: unknown[]) => mockConnectedQuery(...args),
  },
}));

import { AUTO_SYNC_INTERVAL_MS, throttleElapsed, useAutoSync } from './use-auto-sync';

const monobank = { id: 'acc-mono', name: 'Monobank', institution: 'monobank' };
const binance = { id: 'acc-binance', name: 'Binance', institution: 'binance' };

describe('throttleElapsed', () => {
  const now = 1_700_000_000_000;

  it.each([
    ['never synced', null, true],
    ['synced within the window', now - AUTO_SYNC_INTERVAL_MS + 1, false],
    ['synced exactly at the boundary', now - AUTO_SYNC_INTERVAL_MS, true],
    ['synced long ago', now - AUTO_SYNC_INTERVAL_MS - 1, true],
  ] as const)('%s', (_description, lastSyncAt, expected) => {
    expect(throttleElapsed(lastSyncAt, now)).toBe(expected);
  });
});

describe('useAutoSync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMonobankRun.mockResolvedValue(undefined);
    mockCryptoRun.mockResolvedValue(undefined);
    mockRefreshRates.mockResolvedValue(undefined);
    mockLatestFetchedAt.mockResolvedValue(null);
    mockSyncStateGetQuery.mockResolvedValue([{ lastSyncAt: null }]);
    mockConnectedQuery.mockResolvedValue([]);
    mockHasToken.mockResolvedValue(true);
  });

  it('does nothing when no account is connected', async () => {
    mockConnectedQuery.mockResolvedValue([]);

    await renderHook(() => useAutoSync());

    await waitFor(() => expect(mockConnectedQuery).toHaveBeenCalled());

    expect(mockMonobankRun).not.toHaveBeenCalled();
    expect(mockCryptoRun).not.toHaveBeenCalled();
    expect(mockRefreshRates).not.toHaveBeenCalled();
  });

  it('does nothing when the connected Monobank account synced within the throttle window', async () => {
    mockConnectedQuery.mockResolvedValue([monobank]);
    mockSyncStateGetQuery.mockResolvedValue([{ lastSyncAt: Date.now() }]);

    await renderHook(() => useAutoSync());

    await waitFor(() => expect(mockConnectedQuery).toHaveBeenCalled());
    await waitFor(() => expect(mockSyncStateGetQuery).toHaveBeenCalledWith('acc-mono'));

    expect(mockMonobankRun).not.toHaveBeenCalled();
    expect(mockCryptoRun).not.toHaveBeenCalled();
    expect(mockRefreshRates).not.toHaveBeenCalled();
  });

  it('syncs the Monobank account then refreshes rates when tokened and past the throttle window', async () => {
    mockConnectedQuery.mockResolvedValue([monobank]);
    mockLatestFetchedAt.mockResolvedValue(42);

    await renderHook(() => useAutoSync());

    await waitFor(() => expect(mockMonobankRun).toHaveBeenCalled());
    await waitFor(() => expect(mockRefreshRates).toHaveBeenCalledWith({ lastRefreshAt: 42 }));
  });

  it('skips the Monobank account but still syncs crypto when no token is stored', async () => {
    // A Monobank job needs a token; a crypto account needs none. A tokenless user
    // with both connected still gets its crypto balances + Binance history synced.
    mockConnectedQuery.mockResolvedValue([monobank, binance]);
    mockHasToken.mockResolvedValue(false);

    await renderHook(() => useAutoSync());

    await waitFor(() => expect(mockCryptoRun).toHaveBeenCalled());
    expect(mockMonobankRun).not.toHaveBeenCalled();
    await waitFor(() => expect(mockRefreshRates).toHaveBeenCalled());
  });

  it('does nothing when the only connected account is a tokenless Monobank one', async () => {
    mockConnectedQuery.mockResolvedValue([monobank]);
    mockHasToken.mockResolvedValue(false);

    await renderHook(() => useAutoSync());

    // The token gate probes the connected Monobank account's OWN per-account item.
    await waitFor(() => expect(mockHasToken).toHaveBeenCalledWith('acc-mono'));

    expect(mockMonobankRun).not.toHaveBeenCalled();
    expect(mockCryptoRun).not.toHaveBeenCalled();
    expect(mockRefreshRates).not.toHaveBeenCalled();
  });

  it('drops ONLY the tokenless Monobank account and keeps the tokened one plus crypto', async () => {
    const monobankA = { id: 'acc-mono-a', name: 'Mono A', institution: 'monobank' };
    const monobankB = { id: 'acc-mono-b', name: 'Mono B', institution: 'monobank' };
    mockConnectedQuery.mockResolvedValue([monobankA, monobankB, binance]);
    // The token gate is now PER ACCOUNT: only account A has an item stored.
    mockHasToken.mockImplementation(async (id: string) => id === 'acc-mono-a');

    await renderHook(() => useAutoSync());

    // Both Monobank accounts are probed for their OWN token independently.
    await waitFor(() => expect(mockHasToken).toHaveBeenCalledWith('acc-mono-a'));
    await waitFor(() => expect(mockHasToken).toHaveBeenCalledWith('acc-mono-b'));
    // Only the tokened Monobank account yields a job; the tokenless one is dropped.
    await waitFor(() => expect(mockMonobankRun).toHaveBeenCalledTimes(1));
    // Crypto is unaffected by the Monobank token gate.
    await waitFor(() => expect(mockCryptoRun).toHaveBeenCalled());
  });

  it('syncs a connected crypto account on open even with no Monobank account', async () => {
    // The reported gap: an app-open sync used to be Monobank-only, so a crypto
    // user who only OPENED the app never triggered the Binance import.
    mockConnectedQuery.mockResolvedValue([binance]);

    await renderHook(() => useAutoSync());

    await waitFor(() => expect(mockCryptoRun).toHaveBeenCalled());
    expect(mockMonobankRun).not.toHaveBeenCalled();
    await waitFor(() => expect(mockRefreshRates).toHaveBeenCalled());
  });

  it('fans out to BOTH the Monobank and the crypto account when both are connected', async () => {
    mockConnectedQuery.mockResolvedValue([monobank, binance]);

    await renderHook(() => useAutoSync());

    await waitFor(() => expect(mockMonobankRun).toHaveBeenCalled());
    await waitFor(() => expect(mockCryptoRun).toHaveBeenCalled());
  });

  it('isolates a failing job (partial success) and still refreshes rates', async () => {
    mockConnectedQuery.mockResolvedValue([monobank, binance]);
    mockMonobankRun.mockRejectedValue(new Error('sync boom'));

    await expect(renderHook(() => useAutoSync())).resolves.toBeDefined();

    await waitFor(() => expect(mockCryptoRun).toHaveBeenCalled());
    await waitFor(() => expect(mockRefreshRates).toHaveBeenCalled());
  });

  it('swallows an error thrown while reading the connected accounts', async () => {
    mockConnectedQuery.mockRejectedValue(new Error('read boom'));

    await expect(renderHook(() => useAutoSync())).resolves.toBeDefined();

    await waitFor(() => expect(mockConnectedQuery).toHaveBeenCalled());

    expect(mockMonobankRun).not.toHaveBeenCalled();
    expect(mockCryptoRun).not.toHaveBeenCalled();
  });
});
