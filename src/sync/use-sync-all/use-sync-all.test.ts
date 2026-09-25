import { act, renderHook, waitFor } from '@testing-library/react-native';

import type { AccountRow } from '../../db/schema';

const mockRunSync = jest.fn();
const mockRunCryptoSync = jest.fn();
const mockRefreshRates = jest.fn();
const mockRefreshMetalPrices = jest.fn();
const mockLatestFetchedAt = jest.fn();

jest.mock('../../monobank/sync', () => ({
  runSync: (...args: unknown[]) => mockRunSync(...args),
}));
jest.mock('../../crypto-sync/run-crypto-sync', () => ({
  runCryptoSync: (...args: unknown[]) => mockRunCryptoSync(...args),
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
    mockRefreshRates.mockResolvedValue(undefined);
    mockRefreshMetalPrices.mockResolvedValue(undefined);
    mockLatestFetchedAt.mockResolvedValue(1_700_000_000_000);
  });

  it('syncs the Monobank and every connected crypto account, then refreshes rates once', async () => {
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
    expect(mockRefreshRates).toHaveBeenCalledTimes(1);
    expect(mockRefreshRates).toHaveBeenCalledWith({ lastRefreshAt: 1_700_000_000_000 });
    expect(mockRefreshMetalPrices).toHaveBeenCalledTimes(1);
    expect(result.current.failures).toEqual([]);
  });

  it('runs refreshRates and refreshMetalPrices CONCURRENTLY — the metal call fires before rates settles', async () => {
    // Twin of useAutoSync's identical concurrency fix: the two share no data
    // dependency (refreshMetalPrices reads/writes price_points only,
    // refreshRates reads/writes currency_rates only), so starting both at
    // once — rather than awaiting rates before even CALLING
    // refreshMetalPrices — shrinks the pull-to-refresh DB-read burst's
    // wall-clock span the same way the app-open one shrinks.
    let resolveRates!: () => void;
    mockRefreshRates.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveRates = resolve;
      }),
    );
    const { result } = await renderHook(() => useSyncAll([MANUAL]));

    await act(async () => {
      const syncAllPromise = result.current.syncAll();

      await waitFor(() => expect(mockRefreshMetalPrices).toHaveBeenCalled());
      resolveRates();
      await syncAllPromise;
    });
  });

  it('does not settle the fan-out until refreshRates settles, even when refreshMetalPrices rejects first', async () => {
    // Production bug: Promise.all rejects (and the wrapping `either` resolves
    // `fanOutAndRefresh`) the instant EITHER promise rejects, releasing the
    // single-flight lock while the OTHER one — refreshRates, here still
    // retrying — keeps running orphaned. A second pull then sees the lock
    // already free and starts a SECOND fan-out. Promise.allSettled must wait
    // for BOTH to settle before `syncAll()`'s own returned promise resolves.
    let resolveRates!: () => void;
    mockRefreshRates.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveRates = resolve;
      }),
    );
    mockRefreshMetalPrices.mockRejectedValue(new Error('metal fetch failed'));

    const { result } = await renderHook(() => useSyncAll([MONOBANK]));

    let settled = false;
    await act(async () => {
      const firstCall = result.current.syncAll().then(() => {
        settled = true;
      });

      await waitFor(() => expect(mockRefreshMetalPrices).toHaveBeenCalled());
      // Flush every already-queued microtask (regardless of how many hops the
      // rejection takes through `either`/`Promise.all`) without resolving
      // `resolveRates`, so an early-release bug gets every chance to fire.
      await new Promise((resolve) => setImmediate(resolve));
      expect(settled).toBe(false);

      resolveRates();
      await firstCall;
      expect(settled).toBe(true);
    });
  });

  it('now runs refreshMetalPrices even when refreshRates rejects (the old sequential code awaited refreshRates before even CALLING refreshMetalPrices, so it never ran)', async () => {
    mockRefreshRates.mockRejectedValue(new Error('rates fetch failed'));

    const { result } = await renderHook(() => useSyncAll([MANUAL]));

    await act(async () => {
      await result.current.syncAll();
    });

    expect(mockRefreshMetalPrices).toHaveBeenCalledTimes(1);
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

  it('skips the sync fan-out but still refreshes rates when nothing is syncable', async () => {
    const { result } = await renderHook(() => useSyncAll([MANUAL]));

    await act(async () => {
      await result.current.syncAll();
    });

    expect(mockRunSync).not.toHaveBeenCalled();
    expect(mockRunCryptoSync).not.toHaveBeenCalled();
    // Regression: a manual-only account list has no sync jobs, but rates must
    // still refresh so a non-UAH manual holding still converts to the base
    // currency — see `useAutoSync`'s identical fix.
    expect(mockRefreshRates).toHaveBeenCalledTimes(1);
    expect(mockRefreshRates).toHaveBeenCalledWith({ lastRefreshAt: 1_700_000_000_000 });
    expect(result.current.failures).toEqual([]);
  });
});
