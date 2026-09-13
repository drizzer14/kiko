import { isCurrency } from '../../currency/currency';
import type { RateEntry } from '../conversion';
import { buildRateTable, canConvert } from '../net-worth-view';

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
    // The mock providers price only 4 currencies (UAH anchor + USD/EUR/BTC), so
    // buildPairs skips the unpriced GBP/CHF and emits 4 -> 12 ordered distinct pairs.
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

  it('still stores fiat pairs when the BTC provider rejects', async () => {
    const { deps, captured } = makeDeps({
      fetchBTCPrice: () => Promise.reject(new Error('429')),
    });

    await refreshRates(deps);

    expect(captured).toHaveLength(1);
    const pairs = captured[0];

    expect(pairs.some((pair) => pair.base === 'USD' && pair.quote === 'UAH')).toBe(true);
    expect(pairs.some((pair) => pair.base === 'BTC')).toBe(false);
  });

  it('does not reject when both providers fail', async () => {
    const { deps, captured } = makeDeps({
      fetchFiatRates: () => Promise.reject(new Error('offline')),
      fetchBTCPrice: () => Promise.reject(new Error('429')),
    });

    await expect(refreshRates(deps)).resolves.toBeUndefined();

    expect(captured).toHaveLength(0);
  });

  // BTC is anchored through the fiat USD/UAH rate (see `buildUahPrice`): a
  // surviving BTC provider alone cannot support any pair without that
  // anchor, and fabricating one (e.g. assuming USD:UAH = 1) would silently
  // store a false exchange rate. "the pairs the surviving anchors support"
  // is correctly zero pairs here, exactly like the both-fail case above —
  // the previously stored (stale) rates are left untouched rather than
  // being overwritten with an invented one.
  it('composes no pairs when only the BTC provider survives (no USD anchor)', async () => {
    const { deps, captured } = makeDeps({
      fetchFiatRates: () => Promise.reject(new Error('offline')),
    });

    await refreshRates(deps);

    expect(captured).toHaveLength(0);
  });

  // Locks in the build-6 failure class: a pickable currency with no rate path
  // silently drops out of every net-worth sum (`canConvert`,
  // `src/rates/net-worth-view`). GBP and CHF are the two fiat codes this track
  // added; this feeds a real Monobank-shaped response including both through
  // the REAL `refreshRates` composition and proves the stored table actually
  // supports converting them, not just that some row got written.
  it('composes a convertible rate path for GBP and CHF (no silent net-worth drop)', async () => {
    const gbpChfFiat: RateEntry[] = [
      { base: 'USD', quote: 'UAH', rate: 41, source: 'monobank' },
      { base: 'GBP', quote: 'UAH', rate: 52, source: 'monobank' },
      { base: 'CHF', quote: 'UAH', rate: 46, source: 'monobank' },
    ];
    const { deps, captured } = makeDeps({
      fetchFiatRates: async () => gbpChfFiat,
      fetchBTCPrice: async () => [],
    });

    await refreshRates(deps);

    expect(captured).toHaveLength(1);
    // `captured[0]`'s local `StoredRate` type declares `base`/`quote` as plain
    // `string` (this file's shared test helper shape), but `buildRateTable`
    // requires the real `Currency` union. Narrow with the app's own
    // `isCurrency` predicate rather than casting past the type.
    const table = buildRateTable(
      captured[0].map((row) => {
        if (!isCurrency(row.base) || !isCurrency(row.quote)) {
          throw new Error(`expected a known currency pair, got ${row.base}:${row.quote}`);
        }
        return { base: row.base, quote: row.quote, rate: row.rate };
      }),
    );

    expect(canConvert('GBP', 'UAH', table)).toBe(true);
    expect(canConvert('CHF', 'UAH', table)).toBe(true);
    // A cross-pair with no direct Monobank quote: composed via the UAH pivot
    // inside `buildUahPrice`/`buildPairs`, not fetched directly.
    expect(canConvert('GBP', 'USD', table)).toBe(true);
    expect(canConvert('CHF', 'USD', table)).toBe(true);
    expect(canConvert('GBP', 'CHF', table)).toBe(true);
  });
});
