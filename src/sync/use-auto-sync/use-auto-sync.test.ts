import { renderHook, waitFor } from '@testing-library/react-native';

const mockRefreshRates = jest.fn();
const mockRefreshMetalPrices = jest.fn();
const mockLatestFetchedAt = jest.fn();
const mockSyncStateGetQuery = jest.fn();
const mockListQuery = jest.fn();
const mockMonobankHasCredentials = jest.fn();

// Controllable per-institution job runs, so a test can assert which accounts the
// app-open fan-out actually synced without exercising the real sync pipelines
// (those are covered by their own suites).
const mockMonobankRun = jest.fn();
const mockCryptoRun = jest.fn();

jest.mock('../sync-jobs', () => ({
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
jest.mock('../../bank-sync/registry', () => ({
  bankProviderRegistry: {
    monobank: { hasCredentials: (...args: unknown[]) => mockMonobankHasCredentials(...args) },
  },
}));
jest.mock('../../rates/rates-refresh', () => ({
  refreshRates: (...args: unknown[]) => mockRefreshRates(...args),
}));
jest.mock('../../prices/metal-refresh', () => ({
  refreshMetalPrices: (...args: unknown[]) => mockRefreshMetalPrices(...args),
}));
jest.mock('@kiko/rates/repo', () => ({
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
    listQuery: (...args: unknown[]) => mockListQuery(...args),
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
    mockRefreshMetalPrices.mockResolvedValue(undefined);
    mockLatestFetchedAt.mockResolvedValue(null);
    mockSyncStateGetQuery.mockResolvedValue([{ lastSyncAt: null }]);
    mockListQuery.mockResolvedValue([]);
    mockMonobankHasCredentials.mockResolvedValue(true);
  });

  it('refreshes live rates but runs no sync for a manual-only user (no connected sync account)', async () => {
    // A manual-only user has no connected sync account, so the fan-out is empty.
    // The live currencyRates table must STILL be populated, or a
    // non-base-currency holding is dropped from every net-worth aggregation
    // (`canConvert` in net-worth-view). The sync fan-out stays gated on jobs; the
    // rate refresh must not be — `refreshRates` is itself self-throttled.
    mockListQuery.mockResolvedValue([]);
    mockLatestFetchedAt.mockResolvedValue(7);

    await renderHook(() => useAutoSync());

    await waitFor(() => expect(mockRefreshRates).toHaveBeenCalledWith({ lastRefreshAt: 7 }));

    expect(mockMonobankRun).not.toHaveBeenCalled();
    expect(mockCryptoRun).not.toHaveBeenCalled();
  });

  it('refreshes metal prices next to rates, same as the fan-out flow', async () => {
    mockListQuery.mockResolvedValue([]);

    await renderHook(() => useAutoSync());

    await waitFor(() => expect(mockRefreshMetalPrices).toHaveBeenCalled());
  });

  it('does nothing when the connected Monobank account synced within the throttle window', async () => {
    mockListQuery.mockResolvedValue([monobank]);
    mockSyncStateGetQuery.mockResolvedValue([{ lastSyncAt: Date.now() }]);

    await renderHook(() => useAutoSync());

    await waitFor(() => expect(mockListQuery).toHaveBeenCalled());
    await waitFor(() => expect(mockSyncStateGetQuery).toHaveBeenCalledWith('acc-mono'));

    expect(mockMonobankRun).not.toHaveBeenCalled();
    expect(mockCryptoRun).not.toHaveBeenCalled();
    expect(mockRefreshRates).not.toHaveBeenCalled();
  });

  it('syncs the Monobank account then refreshes rates when tokened and past the throttle window', async () => {
    mockListQuery.mockResolvedValue([monobank]);
    mockLatestFetchedAt.mockResolvedValue(42);

    await renderHook(() => useAutoSync());

    await waitFor(() => expect(mockMonobankRun).toHaveBeenCalled());
    await waitFor(() => expect(mockRefreshRates).toHaveBeenCalledWith({ lastRefreshAt: 42 }));
  });

  it('skips the Monobank account but still syncs crypto when no token is stored', async () => {
    // A Monobank job needs a token; a crypto account needs none. A tokenless user
    // with both connected still gets its crypto balances + Binance history synced.
    mockListQuery.mockResolvedValue([monobank, binance]);
    mockMonobankHasCredentials.mockResolvedValue(false);

    await renderHook(() => useAutoSync());

    await waitFor(() => expect(mockCryptoRun).toHaveBeenCalled());
    expect(mockMonobankRun).not.toHaveBeenCalled();
    await waitFor(() => expect(mockRefreshRates).toHaveBeenCalled());
  });

  it('runs no sync but still refreshes rates when the only connected account is a tokenless Monobank one', async () => {
    mockListQuery.mockResolvedValue([monobank]);
    mockMonobankHasCredentials.mockResolvedValue(false);

    await renderHook(() => useAutoSync());

    // The credential gate probes the connected Monobank account's OWN item,
    // through the registry.
    await waitFor(() => expect(mockMonobankHasCredentials).toHaveBeenCalledWith('acc-mono'));

    // The tokenless account yields no job, so nothing syncs — but the live-rate
    // refresh is decoupled from the fan-out and still runs.
    await waitFor(() => expect(mockRefreshRates).toHaveBeenCalled());
    expect(mockMonobankRun).not.toHaveBeenCalled();
    expect(mockCryptoRun).not.toHaveBeenCalled();
  });

  it('drops ONLY the tokenless Monobank account and keeps the tokened one plus crypto', async () => {
    const monobankA = { id: 'acc-mono-a', name: 'Mono A', institution: 'monobank' };
    const monobankB = { id: 'acc-mono-b', name: 'Mono B', institution: 'monobank' };
    mockListQuery.mockResolvedValue([monobankA, monobankB, binance]);
    // The credential gate is now PER ACCOUNT: only account A has an item stored.
    mockMonobankHasCredentials.mockImplementation(async (id: string) => id === 'acc-mono-a');

    await renderHook(() => useAutoSync());

    // Both Monobank accounts are probed for their OWN credential independently.
    await waitFor(() => expect(mockMonobankHasCredentials).toHaveBeenCalledWith('acc-mono-a'));
    await waitFor(() => expect(mockMonobankHasCredentials).toHaveBeenCalledWith('acc-mono-b'));
    // Only the tokened Monobank account yields a job; the tokenless one is dropped.
    await waitFor(() => expect(mockMonobankRun).toHaveBeenCalledTimes(1));
    // Crypto is unaffected by the Monobank credential gate.
    await waitFor(() => expect(mockCryptoRun).toHaveBeenCalled());
  });

  it('syncs a connected crypto account on open even with no Monobank account', async () => {
    // An app-open sync must never be Monobank-only — a crypto
    // user who only OPENS the app must still trigger the Binance import.
    mockListQuery.mockResolvedValue([binance]);

    await renderHook(() => useAutoSync());

    await waitFor(() => expect(mockCryptoRun).toHaveBeenCalled());
    expect(mockMonobankRun).not.toHaveBeenCalled();
    await waitFor(() => expect(mockRefreshRates).toHaveBeenCalled());
  });

  it('fans out to BOTH the Monobank and the crypto account when both are connected', async () => {
    mockListQuery.mockResolvedValue([monobank, binance]);

    await renderHook(() => useAutoSync());

    await waitFor(() => expect(mockMonobankRun).toHaveBeenCalled());
    await waitFor(() => expect(mockCryptoRun).toHaveBeenCalled());
  });

  it('isolates a failing job (partial success) and still refreshes rates', async () => {
    mockListQuery.mockResolvedValue([monobank, binance]);
    mockMonobankRun.mockRejectedValue(new Error('sync boom'));

    await expect(renderHook(() => useAutoSync())).resolves.toBeDefined();

    await waitFor(() => expect(mockCryptoRun).toHaveBeenCalled());
    await waitFor(() => expect(mockRefreshRates).toHaveBeenCalled());
  });

  it('swallows an error thrown while reading the connected accounts', async () => {
    mockListQuery.mockRejectedValue(new Error('read boom'));

    await expect(renderHook(() => useAutoSync())).resolves.toBeDefined();

    await waitFor(() => expect(mockListQuery).toHaveBeenCalled());

    expect(mockMonobankRun).not.toHaveBeenCalled();
    expect(mockCryptoRun).not.toHaveBeenCalled();
  });

  // The cross-open throttle must never read ONLY a Monobank account's
  // cursor — a non-Monobank-only user's `lastSyncAt` would then always
  // resolve `null` and every cold open would bypass the throttle. The
  // cursor is read from ANY connected bank account (`bankAccountIdFor`),
  // proven above by the Monobank cases; Guideline 5.6 restricts the native
  // provider set to Monobank alone, so no cross-provider case remains to
  // exercise here.
});
