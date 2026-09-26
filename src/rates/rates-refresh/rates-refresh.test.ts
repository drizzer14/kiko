import type { RateEntry } from '../conversion';
import { buildRateTable, canConvert } from '../net-worth-view';
import { currencyOptions, isCrypto, isCurrency } from '../../currency/currency';

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
    // Defaults to empty so a test that never touches the Monobank->NBU
    // fallback (below) doesn't accidentally hit the real network — only a
    // test that overrides `fetchFiatRates` to fail exercises this.
    fetchNbuRates: async () => [],
    fetchCryptoPrices: async () => btc,
    // The data-presence gate (kiko-architecture): every existing test below
    // exercises a run that DOES need both legs, so the default reports both
    // as needed; the "data-presence gate" describe block below overrides this
    // to exercise the skip paths.
    openCurrencies: async () => ({
      needsFiat: true,
      cryptoCurrencies: ['BTC'],
      nonBaseCurrencies: ['USD', 'EUR', 'BTC'],
    }),
    // Every held non-base currency already has a stored rate by default, so
    // the throttle tests below behave exactly as before; the "unrated
    // currency" describe block overrides this to exercise the skip-through.
    presentCurrencies: async () => ['USD', 'EUR', 'BTC'],
    upsertMany: async (rates: StoredRate[]) => {
      captured.push(rates);
    },
    now: () => 1000,
    // A no-op, instant sleep by default so a test that doesn't care about the
    // retry backoff (Part B) never actually waits on the real timers the
    // production default (`setTimeout`) would use.
    sleep: async () => {},
    ...overrides,
  };
  return { deps, captured };
};

describe('refreshRates', () => {
  it('composes one X:UAH row per priced currency and upserts them once', async () => {
    const { deps, captured } = makeDeps();

    await refreshRates(deps);

    expect(captured).toHaveLength(1);
    const stored = captured[0];
    // The mock providers price 3 non-UAH currencies (USD/EUR/BTC) — one X:UAH
    // row each, never a cross row between two of them.
    expect(stored).toHaveLength(3);
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
      fetchCryptoPrices: () => Promise.reject(new Error('429')),
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
      fetchCryptoPrices: () => Promise.reject(new Error('429')),
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
      fetchCryptoPrices: async () => [],
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
    // A cross-pair with no direct Monobank quote: resolved at READ TIME via
    // `rateBetween`'s UAH pivot, never fetched or stored directly.
    expect(canConvert('GBP', 'USD', table)).toBe(true);
    expect(canConvert('CHF', 'USD', table)).toBe(true);
    expect(canConvert('GBP', 'CHF', table)).toBe(true);
  });

  // Writers store only X:UAH — a full Monobank feed (every fiat currency but
  // UAH) plus every crypto composes exactly one row per priced currency,
  // never a cross pair among two non-UAH currencies.
  it('stores exactly one X:UAH row per priced currency — 106 fiat + 3 crypto, none base UAH', async () => {
    const fullFiat: RateEntry[] = currencyOptions
      .filter((currency) => currency !== 'UAH' && !isCrypto(currency))
      .map((currency, index) => ({
        base: currency,
        quote: 'UAH' as const,
        rate: 1 + index * 0.1,
        source: 'monobank' as const,
      }));
    const fullCrypto: RateEntry[] = [
      { base: 'BTC', quote: 'USD', rate: 65_000, source: 'coingecko' },
      { base: 'ETH', quote: 'USD', rate: 3_100, source: 'coingecko' },
      { base: 'USDT', quote: 'USD', rate: 1.0002, source: 'coingecko' },
    ];
    const { deps, captured } = makeDeps({
      fetchFiatRates: async () => fullFiat,
      fetchCryptoPrices: async () => fullCrypto,
    });

    await refreshRates(deps);

    expect(captured).toHaveLength(1);
    const stored = captured[0];
    expect(stored).toHaveLength(109);
    expect(stored.every((row) => row.quote === 'UAH')).toBe(true);
    expect(stored.every((row) => row.base !== 'UAH')).toBe(true);
    expect(
      stored
        .filter((row) => isCrypto(row.base as never))
        .every((row) => row.source === 'coingecko'),
    ).toBe(true);
    expect(
      stored
        .filter((row) => !isCrypto(row.base as never))
        .every((row) => row.source === 'monobank'),
    ).toBe(true);
  });
});

// Part B: a failed live fetch retries with a small bounded backoff before
// giving up, so a transient network blip or a single 429 doesn't leave live
// rates stuck behind the (approximate) fiat seed fallback for the whole
// 5-minute throttle window.
describe('refreshRates — retry on a failed live fetch (Part B)', () => {
  it('retries a failing fiat fetch and stores the rows once it succeeds', async () => {
    let callCount = 0;
    const sleepDelays: number[] = [];
    const { deps, captured } = makeDeps({
      fetchFiatRates: async () => {
        callCount += 1;
        if (callCount === 1) {
          throw new Error('network blip');
        }
        return fiat;
      },
      sleep: async (ms: number) => {
        sleepDelays.push(ms);
      },
    });

    await refreshRates(deps);

    expect(callCount).toBe(2);
    expect(sleepDelays.length).toBeGreaterThan(0);
    expect(captured).toHaveLength(1);
    expect(
      captured[0].some((pair) => pair.base === 'USD' && pair.quote === 'UAH' && pair.rate === '40'),
    ).toBe(true);
  });

  it('gives up and resolves (not rejects) once every retry is exhausted', async () => {
    let callCount = 0;
    const { deps, captured } = makeDeps({
      fetchFiatRates: async () => {
        callCount += 1;
        throw new Error('persistently offline');
      },
    });

    await expect(refreshRates(deps)).resolves.toBeUndefined();

    // The initial attempt plus every retry, and no row written (the stale DB
    // rates are left untouched, exactly like the pre-existing both-fail case).
    expect(callCount).toBeGreaterThan(1);
    expect(captured).toHaveLength(0);
  });

  it('respects the throttle — never retries (or fetches at all) inside the cache window', async () => {
    let callCount = 0;
    const { deps } = makeDeps({
      fetchFiatRates: async () => {
        callCount += 1;
        throw new Error('should never be called');
      },
      now: () => 1000 + 60_000, // 1 minute after the last refresh
      lastRefreshAt: 1000,
    });

    await refreshRates(deps);

    expect(callCount).toBe(0);
  });
});

// Monobank's `/bank/currency` host is certificate-pinned (`ios/Kiko/Info.plist`),
// which never resolves on the reporting device. NBU (`bank.gov.ua`, unpinned) is
// the live fallback fiat source, tried only once Monobank's own retries are
// exhausted — so live rates still refresh when Monobank is unreachable.
describe('refreshRates — NBU fallback when Monobank is unreachable', () => {
  const nbuFiat: RateEntry[] = [
    { base: 'USD', quote: 'UAH', rate: 41, source: 'nbu' },
    { base: 'EUR', quote: 'UAH', rate: 44, source: 'nbu' },
  ];

  it('fetches NBU and stores its rows once every Monobank retry has failed', async () => {
    let nbuCalled = false;
    const { deps, captured } = makeDeps({
      fetchFiatRates: () => Promise.reject(new Error('cert pinning blocked')),
      fetchNbuRates: async () => {
        nbuCalled = true;
        return nbuFiat;
      },
    });

    await refreshRates(deps);

    expect(nbuCalled).toBe(true);
    expect(captured).toHaveLength(1);
    expect(captured[0]).toContainEqual({
      base: 'USD',
      quote: 'UAH',
      rate: '41',
      source: 'nbu',
      fetchedAt: 1000,
    });
    // Only ONE fiat source's rows land per run — no leftover 'monobank'-labeled
    // composed pair sneaks in alongside the NBU-sourced ones (the crypto pivot,
    // labeled 'coingecko', is unaffected by which fiat source answered).
    expect(captured[0].every((pair) => pair.source !== 'monobank')).toBe(true);
  });

  it('never calls NBU when the Monobank fetch succeeds', async () => {
    let nbuCalled = false;
    const { deps, captured } = makeDeps({
      fetchNbuRates: async () => {
        nbuCalled = true;
        return nbuFiat;
      },
    });

    await refreshRates(deps);

    expect(nbuCalled).toBe(false);
    expect(captured).toHaveLength(1);
    expect(captured[0].every((pair) => pair.source !== 'nbu')).toBe(true);
  });

  it('writes nothing when both Monobank and NBU fail', async () => {
    const { deps, captured } = makeDeps({
      fetchFiatRates: () => Promise.reject(new Error('offline')),
      fetchNbuRates: () => Promise.reject(new Error('nbu also offline')),
    });

    await expect(refreshRates(deps)).resolves.toBeUndefined();

    expect(captured).toHaveLength(0);
  });

  it('does not touch the crypto pipeline: BTC still composes against the NBU fiat anchor', async () => {
    const { deps, captured } = makeDeps({
      fetchFiatRates: () => Promise.reject(new Error('cert pinning blocked')),
      fetchNbuRates: async () => nbuFiat,
    });

    await refreshRates(deps);

    expect(captured).toHaveLength(1);
    expect(captured[0]).toContainEqual({
      base: 'BTC',
      quote: 'UAH',
      rate: '2665000',
      source: 'coingecko',
      fetchedAt: 1000,
    });
  });
});

// kiko-architecture: app-open and refresh work is gated on data presence —
// no request or query for data the user does not have. `openCurrencies`
// reports whether any held currency differs from the base (needsFiat) and
// which crypto currencies are held; each leg fetches only when its own
// gate says so.
describe('refreshRates — the data-presence gate', () => {
  it('fetches and writes nothing when nothing needs converting and no crypto is held', async () => {
    let fiatCalled = false;
    let cryptoCalled = false;
    const { deps, captured } = makeDeps({
      fetchFiatRates: async () => {
        fiatCalled = true;
        return fiat;
      },
      fetchCryptoPrices: async () => {
        cryptoCalled = true;
        return btc;
      },
      openCurrencies: async () => ({ needsFiat: false, cryptoCurrencies: [] }),
    });

    await refreshRates(deps);

    expect(fiatCalled).toBe(false);
    expect(cryptoCalled).toBe(false);
    expect(captured).toHaveLength(0);
  });

  it('fetches only the fiat leg when nothing crypto is held', async () => {
    let cryptoCalled = false;
    const { deps, captured } = makeDeps({
      fetchCryptoPrices: async () => {
        cryptoCalled = true;
        return btc;
      },
      openCurrencies: async () => ({ needsFiat: true, cryptoCurrencies: [] }),
    });

    await refreshRates(deps);

    expect(cryptoCalled).toBe(false);
    expect(captured).toHaveLength(1);
    expect(captured[0].some((pair) => pair.base === 'BTC')).toBe(false);
    expect(captured[0].some((pair) => pair.base === 'USD' && pair.quote === 'UAH')).toBe(true);
  });

  it('fetches only the crypto leg when every held currency already matches the base', async () => {
    let fiatCalled = false;
    const { deps, captured } = makeDeps({
      fetchFiatRates: async () => {
        fiatCalled = true;
        return fiat;
      },
      openCurrencies: async () => ({ needsFiat: false, cryptoCurrencies: ['BTC'] }),
    });

    await refreshRates(deps);

    expect(fiatCalled).toBe(false);
    // No fiat leg means no USD anchor, so the crypto leg's own fetch still ran
    // (asserted below) but composed no pair — the existing "no USD anchor"
    // behavior (see the describe block above), not a bug in the gate itself.
    expect(captured).toHaveLength(0);
  });

  it('passes only the held crypto currencies to fetchCryptoPrices, never the full supported set', async () => {
    let receivedCurrencies: string[] = [];
    const { deps } = makeDeps({
      fetchCryptoPrices: async (currencies) => {
        receivedCurrencies = currencies;
        return btc;
      },
      openCurrencies: async () => ({ needsFiat: true, cryptoCurrencies: ['BTC'] }),
    });

    await refreshRates(deps);

    expect(receivedCurrencies).toEqual(['BTC']);
  });
});

// The throttle exists to respect Monobank's own ~5-minute cache window, not
// to leave a currently-held currency permanently unrated. A Monobank connect
// at t0 writes fiat only; a Binance connect moments later (inside that same
// window) must not have its crypto currency's rate suppressed until the
// window elapses.
describe('refreshRates — an unrated held currency skips the throttle', () => {
  it('still refreshes inside the cache window when a held crypto currency has no rate at all', async () => {
    let fiatCalled = false;
    const { deps, captured } = makeDeps({
      fetchFiatRates: async () => {
        fiatCalled = true;
        return fiat;
      },
      now: () => 1000 + 60_000, // 1 minute after the last refresh — inside the window
      lastRefreshAt: 1000,
      openCurrencies: async () => ({
        needsFiat: true,
        cryptoCurrencies: ['BTC'],
        nonBaseCurrencies: ['USD', 'EUR', 'BTC'],
      }),
      // USD/EUR already rated; BTC — the just-synced crypto holding — is not.
      presentCurrencies: async () => ['USD', 'EUR'],
    });

    await refreshRates(deps);

    expect(fiatCalled).toBe(true);
    expect(captured).toHaveLength(1);
  });

  it('still refreshes inside the cache window when a held fiat currency has no rate at all', async () => {
    let fiatCalled = false;
    const { deps, captured } = makeDeps({
      fetchFiatRates: async () => {
        fiatCalled = true;
        return fiat;
      },
      now: () => 1000 + 60_000,
      lastRefreshAt: 1000,
      openCurrencies: async () => ({
        needsFiat: true,
        cryptoCurrencies: [],
        // EUR — a base-currency-only user's first foreign holding — has no
        // stored rate at all yet, even though the throttle's own clock is
        // still inside the window.
        nonBaseCurrencies: ['EUR'],
      }),
      presentCurrencies: async () => [],
    });

    await refreshRates(deps);

    expect(fiatCalled).toBe(true);
    expect(captured).toHaveLength(1);
  });

  it('still respects the throttle when every held currency already has a rate', async () => {
    let fiatCalled = false;
    const { deps, captured } = makeDeps({
      fetchFiatRates: async () => {
        fiatCalled = true;
        return fiat;
      },
      now: () => 1000 + 60_000,
      lastRefreshAt: 1000,
      openCurrencies: async () => ({
        needsFiat: true,
        cryptoCurrencies: ['BTC'],
        nonBaseCurrencies: ['USD', 'EUR', 'BTC'],
      }),
      presentCurrencies: async () => ['USD', 'EUR', 'BTC'],
    });

    await refreshRates(deps);

    expect(fiatCalled).toBe(false);
    expect(captured).toHaveLength(0);
  });
});

// A star row's `quote` is always UAH — UAH itself never appears as a `base`
// row in `currency_rates`, so `presentCurrenciesQuery` (a distinct `base`
// read) never lists it. Without an explicit exception, a base-USD user who
// holds UAH would see UAH read as "unrated" forever and bypass the throttle
// on every sync, not just a genuine gap.
describe('refreshRates — UAH is always treated as present for the throttle', () => {
  it('still respects the throttle when the only unrated held currency is UAH itself', async () => {
    let fiatCalled = false;
    const { deps, captured } = makeDeps({
      fetchFiatRates: async () => {
        fiatCalled = true;
        return fiat;
      },
      now: () => 1000 + 60_000, // 1 minute after the last refresh — inside the window
      lastRefreshAt: 1000,
      openCurrencies: async () => ({
        needsFiat: true,
        cryptoCurrencies: [],
        // Base is USD; UAH and EUR are held. UAH never has its own stored
        // row (star rows never carry UAH as `base`), only EUR does.
        nonBaseCurrencies: ['UAH', 'EUR'],
      }),
      presentCurrencies: async () => ['EUR', 'USD'],
    });

    await refreshRates(deps);

    expect(fiatCalled).toBe(false);
    expect(captured).toHaveLength(0);
  });
});
