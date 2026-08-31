jest.mock('@op-engineering/op-sqlite', () => ({
  open: () => ({ execute: () => ({ rows: [] }) }),
}));

import type { RateEntry } from './conversion';
import { type RefreshDeps, refreshRates } from './rates-refresh';

type StoredRate = { base: string; quote: string; rate: string; source: string; fetchedAt: number };

const fiat: RateEntry[] = [
  { base: 'USD', quote: 'UAH', rate: 40, source: 'monobank' },
  { base: 'EUR', quote: 'UAH', rate: 43, source: 'monobank' },
];
const btc: RateEntry[] = [{ base: 'BTC', quote: 'USD', rate: 65_000, source: 'coingecko' }];

const makeDeps = (overrides: Partial<RefreshDeps> = {}) => {
  const captured: StoredRate[][] = [];
  const deps: RefreshDeps = {
    fetchFiatRates: async () => fiat,
    fetchBTCPrice: async () => btc,
    upsertMany: async (rates: StoredRate[]) => {
      captured.push(rates);
    },
    now: () => 1000,
    ...overrides,
  };
  return { deps, captured };
};

describe('refreshRates', () => {
  it('composes every cross pair and upserts them once', async () => {
    const { deps, captured } = makeDeps();

    await refreshRates(deps);

    expect(captured).toHaveLength(1);
    const stored = captured[0];
    // 4 currencies -> 12 ordered distinct pairs.
    expect(stored).toHaveLength(12);
    expect(stored).toContainEqual({
      base: 'USD',
      quote: 'UAH',
      rate: '40',
      source: 'monobank',
      fetchedAt: 1000,
    });
    expect(stored).toContainEqual({
      base: 'EUR',
      quote: 'UAH',
      rate: '43',
      source: 'monobank',
      fetchedAt: 1000,
    });
    expect(stored).toContainEqual({
      base: 'BTC',
      quote: 'USD',
      rate: '65000',
      source: 'coingecko',
      fetchedAt: 1000,
    });
    expect(stored).toContainEqual({
      base: 'BTC',
      quote: 'UAH',
      rate: '2600000',
      source: 'coingecko',
      fetchedAt: 1000,
    });
  });

  it('stores every rate as a string, never a float', async () => {
    const { deps, captured } = makeDeps();

    await refreshRates(deps);

    for (const entry of captured[0]) {
      expect(typeof entry.rate).toBe('string');
    }
  });

  it('skips the refresh when the last one is within the Monobank cache window', async () => {
    let fiatCalled = false;
    const { deps, captured } = makeDeps({
      fetchFiatRates: async () => {
        fiatCalled = true;
        return fiat;
      },
      now: () => 1000 + 60_000, // 1 minute after the last refresh
      lastRefreshAt: 1000,
    });

    await refreshRates(deps);

    expect(fiatCalled).toBe(false);
    expect(captured).toHaveLength(0);
  });

  it('refreshes when the cache window has elapsed', async () => {
    const { deps, captured } = makeDeps({
      now: () => 1000 + 6 * 60_000, // 6 minutes after the last refresh
      lastRefreshAt: 1000,
    });

    await refreshRates(deps);

    expect(captured).toHaveLength(1);
  });
});
