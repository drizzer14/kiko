import { left, right } from 'fnts/either';
import { renderHook, waitFor } from '@testing-library/react-native';

const mockRefreshMarketData = jest.fn();
const mockSyncStateGetQuery = jest.fn();
const mockListQuery = jest.fn();
const mockMonobankHasCredentials = jest.fn();
const mockRunLoanAutoLink = jest.fn();
const mockConfirmDailyLimit = jest.fn();

// Controllable per-institution job runs, so a test can assert which accounts the
// app-open fan-out actually synced without exercising the real sync pipelines
// (those are covered by their own suites).
const mockMonobankRun = jest.fn();
const mockCryptoRun = jest.fn();

jest.mock('@kiko/sync/sync-jobs', () => ({
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
jest.mock('@kiko/bank-sync/registry', () => ({
  bankProviderRegistry: {
    monobank: { hasCredentials: (...args: unknown[]) => mockMonobankHasCredentials(...args) },
  },
}));
jest.mock('@kiko/sync/refresh-market-data', () => {
  const actual = jest.requireActual('@kiko/sync/refresh-market-data');

  return {
    ...actual,
    refreshMarketData: (...args: unknown[]) => mockRefreshMarketData(...args),
  };
});
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
jest.mock('@kiko/loans/use-loan-auto-link', () => ({
  runLoanAutoLink: (...args: unknown[]) => mockRunLoanAutoLink(...args),
}));
jest.mock('@kiko/prices/daily-limit', () => ({
  confirmDailyLimit: (...args: unknown[]) => mockConfirmDailyLimit(...args),
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
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockMonobankRun.mockResolvedValue(undefined);
    mockCryptoRun.mockResolvedValue(undefined);
    mockRefreshMarketData.mockResolvedValue(right(undefined));
    mockSyncStateGetQuery.mockResolvedValue([{ lastSyncAt: null }]);
    mockListQuery.mockResolvedValue([]);
    mockMonobankHasCredentials.mockResolvedValue(true);
    mockRunLoanAutoLink.mockResolvedValue(undefined);
    mockConfirmDailyLimit.mockResolvedValue(undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('confirms an unconfirmed EODHD daily limit before the on-open refresh', async () => {
    const order: string[] = [];
    mockConfirmDailyLimit.mockImplementation(async () => {
      order.push('confirm');
    });
    mockRefreshMarketData.mockImplementation(async () => {
      order.push('refresh');

      return right(undefined);
    });

    await renderHook(() => useAutoSync());

    await waitFor(() => expect(order).toEqual(['confirm', 'refresh']));
  });

  it('still refreshes when the daily limit check fails', async () => {
    mockConfirmDailyLimit.mockRejectedValue(new Error('settings read failed'));

    await renderHook(() => useAutoSync());

    await waitFor(() => expect(mockRefreshMarketData).toHaveBeenCalledTimes(1));
  });

  it('runs the loan auto-link matcher once after the on-open refresh', async () => {
    await renderHook(() => useAutoSync());

    await waitFor(() => expect(mockRunLoanAutoLink).toHaveBeenCalledTimes(1));
  });

  it('refreshes rates and metals but runs no sync for a manual-only user (no connected sync account)', async () => {
    // A manual-only user has no connected sync account, so the fan-out is empty.
    // The live currencyRates table must STILL be populated, or a
    // non-base-currency holding is dropped from every net-worth aggregation
    // (`canConvert` in net-worth-view). The sync fan-out stays gated on jobs; the
    // refresh must not be — `refreshMarketData` is itself self-throttled.
    mockListQuery.mockResolvedValue([]);

    await renderHook(() => useAutoSync());

    await waitFor(() =>
      expect(mockRefreshMarketData).toHaveBeenCalledWith({
        throttled: true,
        metals: true,
        shares: true,
      }),
    );

    expect(mockMonobankRun).not.toHaveBeenCalled();
    expect(mockCryptoRun).not.toHaveBeenCalled();
  });

  it('does not double-log a refreshMarketData Left — it already logged its own rates/metals failure', async () => {
    mockRefreshMarketData.mockResolvedValue(left([{ step: 'rates', reason: 'boom' }]));

    await renderHook(() => useAutoSync());

    await waitFor(() => expect(mockRefreshMarketData).toHaveBeenCalled());
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does nothing when the connected Monobank account synced within the throttle window', async () => {
    mockListQuery.mockResolvedValue([monobank]);
    mockSyncStateGetQuery.mockResolvedValue([{ lastSyncAt: Date.now() }]);

    await renderHook(() => useAutoSync());

    await waitFor(() => expect(mockListQuery).toHaveBeenCalled());
    await waitFor(() => expect(mockSyncStateGetQuery).toHaveBeenCalledWith('acc-mono'));

    expect(mockMonobankRun).not.toHaveBeenCalled();
    expect(mockCryptoRun).not.toHaveBeenCalled();
    expect(mockRefreshMarketData).not.toHaveBeenCalled();
  });

  it('syncs the Monobank account then refreshes rates + metals when tokened and past the throttle window', async () => {
    mockListQuery.mockResolvedValue([monobank]);

    await renderHook(() => useAutoSync());

    await waitFor(() => expect(mockMonobankRun).toHaveBeenCalled());
    await waitFor(() =>
      expect(mockRefreshMarketData).toHaveBeenCalledWith({
        throttled: true,
        metals: true,
        shares: true,
      }),
    );
  });

  it('skips the Monobank account but still syncs crypto when no token is stored', async () => {
    // A Monobank job needs a token; a crypto account needs none. A tokenless user
    // with both connected still gets its crypto balances + Binance history synced.
    mockListQuery.mockResolvedValue([monobank, binance]);
    mockMonobankHasCredentials.mockResolvedValue(false);

    await renderHook(() => useAutoSync());

    await waitFor(() => expect(mockCryptoRun).toHaveBeenCalled());
    expect(mockMonobankRun).not.toHaveBeenCalled();
    await waitFor(() => expect(mockRefreshMarketData).toHaveBeenCalled());
  });

  it('runs no sync but still refreshes when the only connected account is a tokenless Monobank one', async () => {
    mockListQuery.mockResolvedValue([monobank]);
    mockMonobankHasCredentials.mockResolvedValue(false);

    await renderHook(() => useAutoSync());

    // The credential gate probes the connected Monobank account's OWN item,
    // through the registry.
    await waitFor(() => expect(mockMonobankHasCredentials).toHaveBeenCalledWith('acc-mono'));

    // The tokenless account yields no job, so nothing syncs — but the refresh
    // is decoupled from the fan-out and still runs.
    await waitFor(() => expect(mockRefreshMarketData).toHaveBeenCalled());
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
    await waitFor(() => expect(mockRefreshMarketData).toHaveBeenCalled());
  });

  it('fans out to BOTH the Monobank and the crypto account when both are connected', async () => {
    mockListQuery.mockResolvedValue([monobank, binance]);

    await renderHook(() => useAutoSync());

    await waitFor(() => expect(mockMonobankRun).toHaveBeenCalled());
    await waitFor(() => expect(mockCryptoRun).toHaveBeenCalled());
  });

  it('isolates a failing job (partial success) and still refreshes', async () => {
    mockListQuery.mockResolvedValue([monobank, binance]);
    mockMonobankRun.mockRejectedValue(new Error('sync boom'));

    await expect(renderHook(() => useAutoSync())).resolves.toBeDefined();

    await waitFor(() => expect(mockCryptoRun).toHaveBeenCalled());
    await waitFor(() => expect(mockRefreshMarketData).toHaveBeenCalled());
  });

  it('swallows an error thrown while reading the connected accounts (but still logs it)', async () => {
    mockListQuery.mockRejectedValue(new Error('read boom SECRET'));

    await expect(renderHook(() => useAutoSync())).resolves.toBeDefined();

    await waitFor(() => expect(mockListQuery).toHaveBeenCalled());
    await waitFor(() =>
      expect(warnSpy).toHaveBeenCalledWith('[refresh-market-data] auto-sync refresh failed', {
        name: 'Error',
        code: undefined,
      }),
    );
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('SECRET');

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
