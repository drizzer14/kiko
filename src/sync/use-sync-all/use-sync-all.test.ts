import { right } from 'fnts/either';
import type { AccountRow } from '@kiko/db';
import { act, renderHook } from '@testing-library/react-native';

const mockRunSync = jest.fn();
const mockRunCryptoSync = jest.fn();
const mockRefreshMarketData = jest.fn();
const mockRunLoanAutoLink = jest.fn();

jest.mock('@kiko/monobank/sync', () => ({
  runSync: (...args: unknown[]) => mockRunSync(...args),
}));
jest.mock('@kiko/crypto-sync/run-crypto-sync', () => ({
  runCryptoSync: (...args: unknown[]) => mockRunCryptoSync(...args),
}));
jest.mock('@kiko/sync/refresh-market-data', () => ({
  refreshMarketData: (...args: unknown[]) => mockRefreshMarketData(...args),
}));
jest.mock('@kiko/loans/use-loan-auto-link', () => ({
  runLoanAutoLink: (...args: unknown[]) => mockRunLoanAutoLink(...args),
}));

import { useSyncAll } from './use-sync-all';

const account = (overrides: Partial<AccountRow> = {}): AccountRow => ({
  id: 'a',
  name: 'Account',
  kind: 'bank',
  institution: null,
  bankId: null,
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
    mockRefreshMarketData.mockResolvedValue(right(undefined));
    mockRunLoanAutoLink.mockResolvedValue(undefined);
  });

  it('runs the loan auto-link matcher once per fan-out, after the refresh', async () => {
    const { result } = await renderHook(() => useSyncAll([MONOBANK, WALLET, BINANCE, MANUAL]));

    await act(async () => {
      await result.current.syncAll();
    });

    expect(mockRunLoanAutoLink).toHaveBeenCalledTimes(1);
  });

  it('syncs the Monobank and every connected crypto account, then refreshes rates + metals once', async () => {
    const { result } = await renderHook(() => useSyncAll([MONOBANK, WALLET, BINANCE, MANUAL]));

    await act(async () => {
      await result.current.syncAll();
    });

    expect(mockRunSync).toHaveBeenCalledTimes(1);
    expect(mockRunSync).toHaveBeenCalledWith({ targetAccountId: 'mono' });
    expect(mockRunCryptoSync).toHaveBeenCalledWith({
      providerId: 'btc_wallet',
      targetAccountId: 'w',
    });
    expect(mockRunCryptoSync).toHaveBeenCalledWith({
      providerId: 'binance',
      targetAccountId: 'bin',
    });
    expect(mockRefreshMarketData).toHaveBeenCalledTimes(1);
    expect(mockRefreshMarketData).toHaveBeenCalledWith({ throttled: true, metals: true });
    expect(result.current.failures).toEqual([]);
  });

  // Production bug precedent (fixed alongside the original concurrent-refresh
  // change): the single-flight lock in `runSyncAllOnce` must not release until
  // the WHOLE fan-out — including the refresh step — has settled, or a second
  // pull that arrives mid-refresh sees the lock already free and starts a
  // SECOND fan-out. `refreshMarketData` itself never rejects, so this is now a
  // property of simply awaiting its call before returning, not of a
  // `Promise.allSettled` this hook orchestrates directly.
  it('does not settle the fan-out until refreshMarketData itself settles', async () => {
    let resolveRefresh!: () => void;
    mockRefreshMarketData.mockReturnValue(
      new Promise((resolve) => {
        resolveRefresh = () => resolve(right(undefined));
      }),
    );

    const { result } = await renderHook(() => useSyncAll([MANUAL]));

    let settled = false;
    await act(async () => {
      const syncAllPromise = result.current.syncAll().then(() => {
        settled = true;
      });

      await new Promise((resolve) => setImmediate(resolve));
      expect(settled).toBe(false);

      resolveRefresh();
      await syncAllPromise;
      expect(settled).toBe(true);
    });
  });

  it('fans out over EVERY connected Monobank account, each with its own targeted run', async () => {
    const monoA = account({ id: 'mono-a', name: 'Mono A', kind: 'bank', institution: 'monobank' });
    const monoB = account({ id: 'mono-b', name: 'Mono B', kind: 'bank', institution: 'monobank' });

    const { result } = await renderHook(() => useSyncAll([monoA, monoB, BINANCE]));

    await act(async () => {
      await result.current.syncAll();
    });

    // Multi-connection: each connected Monobank account gets its OWN targeted run
    // (its own token + cursor + single-flight), alongside the crypto account.
    expect(mockRunSync).toHaveBeenCalledTimes(2);
    expect(mockRunSync).toHaveBeenCalledWith({ targetAccountId: 'mono-a' });
    expect(mockRunSync).toHaveBeenCalledWith({ targetAccountId: 'mono-b' });
    expect(mockRunCryptoSync).toHaveBeenCalledWith({
      providerId: 'binance',
      targetAccountId: 'bin',
    });
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
    expect(mockRefreshMarketData).toHaveBeenCalledTimes(1);
  });

  it('syncs only the crypto accounts when no Monobank account is connected', async () => {
    const { result } = await renderHook(() => useSyncAll([WALLET, BINANCE]));

    await act(async () => {
      await result.current.syncAll();
    });

    expect(mockRunSync).not.toHaveBeenCalled();
    expect(mockRunCryptoSync).toHaveBeenCalledTimes(2);
    expect(mockRefreshMarketData).toHaveBeenCalledTimes(1);
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
    expect(mockRefreshMarketData).toHaveBeenCalledTimes(1);
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

  it('skips the sync fan-out but still refreshes when nothing is syncable', async () => {
    const { result } = await renderHook(() => useSyncAll([MANUAL]));

    await act(async () => {
      await result.current.syncAll();
    });

    expect(mockRunSync).not.toHaveBeenCalled();
    expect(mockRunCryptoSync).not.toHaveBeenCalled();
    // Regression: a manual-only account list has no sync jobs, but rates must
    // still refresh so a non-UAH manual holding still converts to the base
    // currency — see `useAutoSync`'s identical fix.
    expect(mockRefreshMarketData).toHaveBeenCalledTimes(1);
    expect(mockRefreshMarketData).toHaveBeenCalledWith({ throttled: true, metals: true });
    expect(result.current.failures).toEqual([]);
  });
});
