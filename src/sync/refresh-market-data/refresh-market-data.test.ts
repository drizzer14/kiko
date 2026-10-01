import { bifold, isLeft, isRight } from 'fnts/either';
import type { RatesRefreshOutcome } from '@kiko/rates/rates-refresh';

import { type RefreshMarketDataDeps, refreshMarketData } from './refresh-market-data';

const REFRESHED: RatesRefreshOutcome = { state: 'refreshed', failedLegs: [] };

const makeDeps = (overrides: Partial<RefreshMarketDataDeps> = {}): RefreshMarketDataDeps => ({
  refreshRates: async () => REFRESHED,
  refreshMetalPrices: async () => {},
  refreshSharePrices: async () => 'ok',
  latestFetchedAt: async () => 1000,
  ...overrides,
});

describe('refreshMarketData', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('resolves a Right with no warn when both steps succeed', async () => {
    const result = await refreshMarketData(
      { throttled: true, metals: true, shares: true },
      makeDeps(),
    );

    expect(isRight(result)).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('resolves a Left with one failure and one warn when the rates outcome is failed', async () => {
    const failed: RatesRefreshOutcome = { state: 'failed', failedLegs: ['fiat'] };
    const result = await refreshMarketData(
      { throttled: true, metals: false, shares: false },
      makeDeps({ refreshRates: async () => failed }),
    );

    expect(isLeft(result)).toBe(true);
    expect(bifold(result)).toEqual([{ step: 'rates', reason: failed }]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith('[refresh-market-data] rates failed: fiat', {
      name: 'object',
      code: undefined,
    });
  });

  it('resolves a Left with one failure and one warn when the rates outcome is partial', async () => {
    const partial: RatesRefreshOutcome = { state: 'partial', failedLegs: ['crypto'] };
    const result = await refreshMarketData(
      { throttled: true, metals: false, shares: false },
      makeDeps({ refreshRates: async () => partial }),
    );

    expect(isLeft(result)).toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith('[refresh-market-data] rates partial: crypto', {
      name: 'object',
      code: undefined,
    });
  });

  it('resolves a Left with one failure and one warn when refreshMetalPrices rejects', async () => {
    const metalsError = new Error('nbu metals offline SECRET');
    const result = await refreshMarketData(
      { throttled: true, metals: true, shares: true },
      makeDeps({ refreshMetalPrices: () => Promise.reject(metalsError) }),
    );

    expect(isLeft(result)).toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith('[refresh-market-data] metals refresh failed', {
      name: 'Error',
      code: undefined,
    });
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('SECRET');
  });

  it('never calls refreshMetalPrices when metals is false', async () => {
    let metalsCalled = false;
    await refreshMarketData(
      { throttled: true, metals: false, shares: false },
      makeDeps({
        refreshMetalPrices: async () => {
          metalsCalled = true;
        },
      }),
    );

    expect(metalsCalled).toBe(false);
  });

  it('never calls refreshSharePrices when shares is false', async () => {
    const refreshSharePrices = jest.fn(async () => 'ok' as const);

    await refreshMarketData(
      { throttled: true, metals: true, shares: false },
      makeDeps({ refreshSharePrices }),
    );

    expect(refreshSharePrices).not.toHaveBeenCalled();
  });

  it('resolves a Left tagged shares, with one warn, when refreshSharePrices rejects', async () => {
    const sharesError = new Error('keychain locked SECRET');
    const result = await refreshMarketData(
      { throttled: true, metals: false, shares: true },
      makeDeps({ refreshSharePrices: () => Promise.reject(sharesError) }),
    );

    expect(bifold(result)).toEqual([{ step: 'shares', reason: sharesError }]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith('[refresh-market-data] shares refresh failed', {
      name: 'Error',
      code: undefined,
    });
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('SECRET');
  });

  it('resolves a Left tagged shares, with one warn, when the share refresh failed', async () => {
    const result = await refreshMarketData(
      { throttled: true, metals: false, shares: true },
      makeDeps({ refreshSharePrices: async () => 'failed' }),
    );

    expect(bifold(result)).toEqual([{ step: 'shares', reason: 'failed' }]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith('[refresh-market-data] shares failed', {
      name: 'string',
      code: undefined,
    });
  });

  it.each(['ok', 'noShares', 'noKey', 'quotaExhausted'] as const)(
    'resolves a Right with no warn when the share refresh ends %s',
    async (status) => {
      const result = await refreshMarketData(
        { throttled: true, metals: false, shares: true },
        makeDeps({ refreshSharePrices: async () => status }),
      );

      expect(isRight(result)).toBe(true);
      expect(warnSpy).not.toHaveBeenCalled();
    },
  );

  it('starts the share refresh before refreshRates settles', async () => {
    let resolveRates!: () => void;
    let sharesCalled = false;
    const result = refreshMarketData(
      { throttled: true, metals: false, shares: true },
      makeDeps({
        refreshRates: () =>
          new Promise((resolve) => {
            resolveRates = () => resolve(REFRESHED);
          }),
        refreshSharePrices: async () => {
          sharesCalled = true;

          return 'ok';
        },
      }),
    );

    await new Promise((resolve) => setImmediate(resolve));
    expect(sharesCalled).toBe(true);

    resolveRates();
    await result;
  });

  it('never reads latestFetchedAt when throttled is false', async () => {
    let latestFetchedAtCalled = false;
    await refreshMarketData(
      { throttled: false, metals: false, shares: false },
      makeDeps({
        latestFetchedAt: async () => {
          latestFetchedAtCalled = true;

          return 1000;
        },
      }),
    );

    expect(latestFetchedAtCalled).toBe(false);
  });

  it('passes a null lastRefreshAt through to refreshRates when throttled is false', async () => {
    let receivedLastRefreshAt: number | null | undefined;
    await refreshMarketData(
      { throttled: false, metals: false, shares: false },
      makeDeps({
        refreshRates: async (deps) => {
          receivedLastRefreshAt = deps.lastRefreshAt;

          return REFRESHED;
        },
      }),
    );

    expect(receivedLastRefreshAt).toBeNull();
  });

  it('passes the real latestFetchedAt value through to refreshRates when throttled is true', async () => {
    let receivedLastRefreshAt: number | null | undefined;
    await refreshMarketData(
      { throttled: true, metals: false, shares: false },
      makeDeps({
        latestFetchedAt: async () => 42,
        refreshRates: async (deps) => {
          receivedLastRefreshAt = deps.lastRefreshAt;

          return REFRESHED;
        },
      }),
    );

    expect(receivedLastRefreshAt).toBe(42);
  });

  it('logs and runs unthrottled when reading latestFetchedAt itself rejects', async () => {
    let receivedLastRefreshAt: number | null | undefined;
    const readError = new Error('db read failed');
    const result = await refreshMarketData(
      { throttled: true, metals: false, shares: false },
      makeDeps({
        latestFetchedAt: () => Promise.reject(readError),
        refreshRates: async (deps) => {
          receivedLastRefreshAt = deps.lastRefreshAt;

          return REFRESHED;
        },
      }),
    );

    expect(receivedLastRefreshAt).toBeNull();
    expect(isLeft(result)).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith('[refresh-market-data] rates refresh failed', {
      name: 'Error',
      code: undefined,
    });
  });

  it('resolves (never rejects) when refreshRates itself rejects', async () => {
    const runError = new Error('unexpected crash');
    await expect(
      refreshMarketData(
        { throttled: true, metals: false, shares: false },
        makeDeps({ refreshRates: () => Promise.reject(runError) }),
      ),
    ).resolves.toBeDefined();

    expect(warnSpy).toHaveBeenCalledWith('[refresh-market-data] rates refresh failed', {
      name: 'Error',
      code: undefined,
    });
  });

  // The two steps read/write disjoint tables (currency_rates vs price_points),
  // so starting both at once — rather than awaiting rates before even calling
  // refreshMetalPrices — shrinks the DB-read burst's wall-clock span. Moved
  // here from `useSyncAll`'s own suite once this module became the ONE place
  // that orchestrates both.
  it('runs refreshRates and refreshMetalPrices CONCURRENTLY — the metal call fires before rates settles', async () => {
    let resolveRates!: () => void;
    let metalsCalled = false;
    const result = refreshMarketData(
      { throttled: true, metals: true, shares: true },
      makeDeps({
        refreshRates: () =>
          new Promise((resolve) => {
            resolveRates = () => resolve(REFRESHED);
          }),
        refreshMetalPrices: async () => {
          metalsCalled = true;
        },
      }),
    );

    await new Promise((resolve) => setImmediate(resolve));
    expect(metalsCalled).toBe(true);

    resolveRates();
    await result;
  });

  // Twin of the concurrency test above: `Promise.allSettled`, not
  // `Promise.all` — the latter settles the instant EITHER promise rejects,
  // which would resolve this whole function while the OTHER promise keeps
  // running orphaned. A caller (`useSyncAll`'s single-flight lock) that reads
  // this function's own settle as "the whole refresh is done" must never see
  // that early.
  it('does not resolve until refreshRates settles, even when refreshMetalPrices rejects first', async () => {
    let resolveRates!: () => void;
    let settled = false;
    const result = refreshMarketData(
      { throttled: true, metals: true, shares: true },
      makeDeps({
        refreshRates: () =>
          new Promise((resolve) => {
            resolveRates = () => resolve(REFRESHED);
          }),
        refreshMetalPrices: () => Promise.reject(new Error('metal fetch failed')),
      }),
    ).then((outcome) => {
      settled = true;

      return outcome;
    });

    await new Promise((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);

    resolveRates();
    await result;
    expect(settled).toBe(true);
  });
});
