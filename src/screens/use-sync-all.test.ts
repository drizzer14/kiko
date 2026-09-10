import { act, renderHook } from '@testing-library/react-native';

import type { AccountRow } from '../db/schema';

const mockRunSync = jest.fn();
const mockRunCryptoSync = jest.fn();
const mockRefreshRates = jest.fn();
const mockLatestFetchedAt = jest.fn();

jest.mock('../monobank/sync', () => ({
  runSync: (...args: unknown[]) => mockRunSync(...args),
}));
jest.mock('../crypto-sync/run-crypto-sync', () => ({
  runCryptoSync: (...args: unknown[]) => mockRunCryptoSync(...args),
}));
jest.mock('../rates/rates-refresh', () => ({
  refreshRates: (...args: unknown[]) => mockRefreshRates(...args),
}));
jest.mock('../repositories/rates.repo', () => ({
  ratesRepo: {
    latestFetchedAt: (...args: unknown[]) => mockLatestFetchedAt(...args),
  },
}));

import { useSyncAll } from './use-sync-all';

const account = (overrides: Partial<AccountRow> = {}): AccountRow => ({
  id: 'a',
  name: 'Account',
  kind: 'bank',
  institution: null,
  icon: null,
  color: null,
  sortOrder: 0,
  archivedAt: null,
  createdAt: 0,
  ...overrides,
});

const MONOBANK = account({ id: 'mono', name: 'Monobank', kind: 'bank', institution: 'monobank' });
const WALLET = account({
  id: 'w',
  name: 'Cold storage',
  kind: 'crypto',
  institution: 'btc_wallet',
});
const BINANCE = account({ id: 'bin', name: 'Binance', kind: 'crypto', institution: 'binance' });
const MANUAL = account({ id: 'm', name: 'Cash', kind: 'cash', institution: null });

describe('useSyncAll', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRunSync.mockResolvedValue({ importedTransactions: 0 });
    mockRunCryptoSync.mockResolvedValue({ syncedHoldings: 1 });
    mockRefreshRates.mockResolvedValue(undefined);
    mockLatestFetchedAt.mockResolvedValue(1_700_000_000_000);
  });

  it('syncs the Monobank and every connected crypto account, then refreshes rates once', async () => {
    const { result } = await renderHook(() => useSyncAll([MONOBANK, WALLET, BINANCE, MANUAL]));

    await act(async () => {
      await result.current.syncAll();
    });

    expect(mockRunSync).toHaveBeenCalledTimes(1);
    expect(mockRunSync).toHaveBeenCalledWith({});
    expect(mockRunCryptoSync).toHaveBeenCalledWith({
      providerId: 'btc_wallet',
      targetAccountId: 'w',
    });
    expect(mockRunCryptoSync).toHaveBeenCalledWith({
      providerId: 'binance',
      targetAccountId: 'bin',
    });
    expect(mockRefreshRates).toHaveBeenCalledTimes(1);
    expect(mockRefreshRates).toHaveBeenCalledWith({ lastRefreshAt: 1_700_000_000_000 });
    expect(result.current.failures).toEqual([]);
  });

  it('reports a failed account by name while the others still complete (partial success)', async () => {
    mockRunCryptoSync.mockImplementation((request: { providerId: string }) =>
      request.providerId === 'binance'
        ? Promise.reject(new Error('Binance request failed: 401'))
        : Promise.resolve({ syncedHoldings: 1 }),
    );

    const { result } = await renderHook(() => useSyncAll([MONOBANK, WALLET, BINANCE]));

    await act(async () => {
      await result.current.syncAll();
    });

    expect(mockRunSync).toHaveBeenCalledTimes(1);
    expect(mockRunCryptoSync).toHaveBeenCalledWith({
      providerId: 'btc_wallet',
      targetAccountId: 'w',
    });
    expect(result.current.failures).toEqual(['Binance']);
    expect(mockRefreshRates).toHaveBeenCalledTimes(1);
  });

  it('syncs only the crypto accounts when no Monobank account is connected', async () => {
    const { result } = await renderHook(() => useSyncAll([WALLET, BINANCE]));

    await act(async () => {
      await result.current.syncAll();
    });

    expect(mockRunSync).not.toHaveBeenCalled();
    expect(mockRunCryptoSync).toHaveBeenCalledTimes(2);
    expect(mockRefreshRates).toHaveBeenCalledTimes(1);
    expect(result.current.failures).toEqual([]);
  });

  it('joins an in-flight fan-out instead of re-running the jobs (single-flight)', async () => {
    // Hold the Monobank run open so the first fan-out is still in flight when the
    // second pull arrives — the real symptom is a pull during a multi-minute
    // Monobank loop, which re-fanned-out and re-registered the crypto work,
    // growing the progress total by the crypto holding count on every pull.
    const releaseMono: Array<() => void> = [];
    mockRunSync.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseMono.push(() => resolve({ importedTransactions: 0 }));
        }),
    );

    const { result } = await renderHook(() => useSyncAll([MONOBANK, WALLET, BINANCE]));

    await act(async () => {
      const firstCall = result.current.syncAll();
      const secondCall = result.current.syncAll();
      // Resolve every Monobank run that was actually started, so this test never
      // hangs regardless of whether the fan-out was single-flighted.
      for (const resolve of releaseMono) {
        resolve();
      }
      await Promise.all([firstCall, secondCall]);
    });

    // The second pull JOINED the first run: each job ran exactly once, so the
    // crypto work is registered once, not twice.
    expect(mockRunSync).toHaveBeenCalledTimes(1);
    expect(mockRunCryptoSync).toHaveBeenCalledTimes(2); // wallet + binance, once each
    expect(mockRefreshRates).toHaveBeenCalledTimes(1);
  });

  it('starts a fresh fan-out once the previous run has completed', async () => {
    const { result } = await renderHook(() => useSyncAll([MONOBANK, WALLET, BINANCE]));

    await act(async () => {
      await result.current.syncAll();
    });
    await act(async () => {
      await result.current.syncAll();
    });

    // Two non-overlapping pulls each fan out fully — the lock only joins an
    // in-flight run, it never throttles a later, separate one.
    expect(mockRunSync).toHaveBeenCalledTimes(2);
    expect(mockRunCryptoSync).toHaveBeenCalledTimes(4);
  });

  it('is a no-op when nothing is syncable', async () => {
    const { result } = await renderHook(() => useSyncAll([MANUAL]));

    await act(async () => {
      await result.current.syncAll();
    });

    expect(mockRunSync).not.toHaveBeenCalled();
    expect(mockRunCryptoSync).not.toHaveBeenCalled();
    expect(mockRefreshRates).not.toHaveBeenCalled();
    expect(result.current.failures).toEqual([]);
  });
});
