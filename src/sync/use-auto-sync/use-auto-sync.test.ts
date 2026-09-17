import { renderHook, waitFor } from '@testing-library/react-native';

const mockRefreshRates = jest.fn();
const mockLatestFetchedAt = jest.fn();
const mockSyncStateGetQuery = jest.fn();
const mockListQuery = jest.fn();
const mockMonobankHasCredentials = jest.fn();
const mockPrivatbankHasCredentials = jest.fn();
const mockBunqHasCredentials = jest.fn();
const mockStarlingHasCredentials = jest.fn();

// Controllable per-institution job runs, so a test can assert which accounts the
// app-open fan-out actually synced without exercising the real sync pipelines
// (those are covered by their own suites).
const mockMonobankRun = jest.fn();
const mockPrivatbankRun = jest.fn();
const mockBunqRun = jest.fn();
const mockStarlingRun = jest.fn();
const mockCryptoRun = jest.fn();

jest.mock('../sync-jobs', () => ({
  syncJobsFor: (account: { name: string; institution: string | null }) => {
    if (account.institution === 'monobank') {
      return [{ name: account.name, run: mockMonobankRun }];
    }
    if (account.institution === 'privatbank') {
      return [{ name: account.name, run: mockPrivatbankRun }];
    }
    if (account.institution === 'bunq') {
      return [{ name: account.name, run: mockBunqRun }];
    }
    if (account.institution === 'starling') {
      return [{ name: account.name, run: mockStarlingRun }];
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
    privatbank: { hasCredentials: (...args: unknown[]) => mockPrivatbankHasCredentials(...args) },
    bunq: { hasCredentials: (...args: unknown[]) => mockBunqHasCredentials(...args) },
    starling: { hasCredentials: (...args: unknown[]) => mockStarlingHasCredentials(...args) },
  },
}));
jest.mock('../../rates/rates-refresh', () => ({
  refreshRates: (...args: unknown[]) => mockRefreshRates(...args),
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
const starling = { id: 'acc-starling', name: 'Starling', institution: 'starling' };
const privatbank = { id: 'acc-privat', name: 'PrivatBank', institution: 'privatbank' };
const bunq = { id: 'acc-bunq', name: 'bunq', institution: 'bunq' };

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
    mockPrivatbankRun.mockResolvedValue(undefined);
    mockBunqRun.mockResolvedValue(undefined);
    mockStarlingRun.mockResolvedValue(undefined);
    mockCryptoRun.mockResolvedValue(undefined);
    mockRefreshRates.mockResolvedValue(undefined);
    mockLatestFetchedAt.mockResolvedValue(null);
    mockSyncStateGetQuery.mockResolvedValue([{ lastSyncAt: null }]);
    mockListQuery.mockResolvedValue([]);
    mockMonobankHasCredentials.mockResolvedValue(true);
    mockPrivatbankHasCredentials.mockResolvedValue(true);
    mockBunqHasCredentials.mockResolvedValue(true);
    mockStarlingHasCredentials.mockResolvedValue(true);
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
    // The reported gap: an app-open sync used to be Monobank-only, so a crypto
    // user who only OPENED the app never triggered the Binance import.
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

  // Item A (whole-branch review): the cross-open throttle used to read ONLY a
  // Monobank account's cursor, so a Starling/PrivatBank/bunq-only user's
  // `lastSyncAt` always resolved `null` and every cold open bypassed the
  // throttle — burning a provider's request budget (Starling's is a hard
  // 1000/day). The cursor is now read from ANY connected bank account.
  it('throttles a Starling-only user using the Starling account’s own cursor (no Monobank account)', async () => {
    mockListQuery.mockResolvedValue([starling]);
    mockSyncStateGetQuery.mockResolvedValue([{ lastSyncAt: Date.now() }]);

    await renderHook(() => useAutoSync());

    await waitFor(() => expect(mockSyncStateGetQuery).toHaveBeenCalledWith('acc-starling'));
    expect(mockStarlingRun).not.toHaveBeenCalled();
    expect(mockRefreshRates).not.toHaveBeenCalled();
  });

  it('syncs a Starling-only user past the throttle window using its own cursor', async () => {
    mockListQuery.mockResolvedValue([starling]);
    mockSyncStateGetQuery.mockResolvedValue([{ lastSyncAt: null }]);

    await renderHook(() => useAutoSync());

    await waitFor(() => expect(mockSyncStateGetQuery).toHaveBeenCalledWith('acc-starling'));
    await waitFor(() => expect(mockStarlingRun).toHaveBeenCalled());
  });

  it('throttles a PrivatBank-only user using the PrivatBank account’s own cursor (no Monobank account)', async () => {
    mockListQuery.mockResolvedValue([privatbank]);
    mockSyncStateGetQuery.mockResolvedValue([{ lastSyncAt: Date.now() }]);

    await renderHook(() => useAutoSync());

    await waitFor(() => expect(mockSyncStateGetQuery).toHaveBeenCalledWith('acc-privat'));
    expect(mockPrivatbankRun).not.toHaveBeenCalled();
  });

  // Item A: the credential pre-gate used to be Monobank `hasToken`-only, so a
  // connected non-Monobank account whose credential was cleared made a
  // throwing job every open. Each bank account's job is now gated on its OWN
  // registry-resolved `hasCredentials`.
  it('drops a credential-cleared bunq account and keeps a connected crypto account', async () => {
    mockListQuery.mockResolvedValue([bunq, binance]);
    mockBunqHasCredentials.mockResolvedValue(false);

    await renderHook(() => useAutoSync());

    await waitFor(() => expect(mockBunqHasCredentials).toHaveBeenCalledWith('acc-bunq'));
    await waitFor(() => expect(mockCryptoRun).toHaveBeenCalled());
    expect(mockBunqRun).not.toHaveBeenCalled();
  });

  it('drops a credential-cleared PrivatBank account, leaving no job for it', async () => {
    mockListQuery.mockResolvedValue([privatbank]);
    mockPrivatbankHasCredentials.mockResolvedValue(false);

    await renderHook(() => useAutoSync());

    await waitFor(() => expect(mockPrivatbankHasCredentials).toHaveBeenCalledWith('acc-privat'));
    await waitFor(() => expect(mockRefreshRates).toHaveBeenCalled());
    expect(mockPrivatbankRun).not.toHaveBeenCalled();
  });
});
