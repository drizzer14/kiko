import { buildRateTable, canConvert, guardedBreakdown, guardedNetWorth } from './net-worth-view';

// A fixed evaluation instant. Every holding in these cases is plain cash (no
// `type`), so `holdingValue` takes its flat branch and the instant cannot
// affect a total — it is pinned only to keep the call deterministic.
const NOW = Date.UTC(2026, 0, 1);

describe('buildRateTable', () => {
  // Parse/drop behavior for the LIVE rows themselves is unit-tested in full
  // isolation (exact `toEqual` on the whole object) by
  // `rateTableFromRows` in `conversion.test.ts` — `buildRateTable` now also
  // merges the bundled fiat seed underneath every live row (Part A), so an
  // exact whole-object `toEqual` here would break on the seed's own many
  // entries. These cases instead target only the keys the passed rows touch.
  it('parses the string rate column into a numeric RateTable', () => {
    const table = buildRateTable([{ base: 'USD', quote: 'UAH', rate: '40.5' }]);
    expect(table['USD:UAH']).toBe(40.5);
  });

  it('drops a row whose rate does not parse to a finite number, without corrupting the fiat seed fallback', () => {
    const table = buildRateTable([
      { base: 'USD', quote: 'UAH', rate: '40' },
      { base: 'EUR', quote: 'UAH', rate: 'not-a-number' },
    ]);
    expect(table['USD:UAH']).toBe(40);
    // The invalid EUR row must not overwrite the seed's EUR:UAH with NaN —
    // EUR:UAH still resolves through the seed fallback beneath it.
    expect(Number.isFinite(table['EUR:UAH'])).toBe(true);
  });

  // P1: a stored rate of "0" is not a usable rate — admitting it into the
  // table would let `canConvert` treat it as present (0 !== undefined) and
  // convert a holding to 0, while the breakdown still shows it at full
  // own-currency value. Drop it at the single source instead.
  it('drops a row whose rate parses to zero, without corrupting the fiat seed fallback', () => {
    const table = buildRateTable([
      { base: 'USD', quote: 'UAH', rate: '40' },
      { base: 'EUR', quote: 'UAH', rate: '0' },
    ]);
    expect(table['USD:UAH']).toBe(40);
    // The zero EUR row must not overwrite the seed's EUR:UAH with 0.
    expect(table['EUR:UAH']).not.toBe(0);
    expect(table['EUR:UAH']).toBeGreaterThan(0);
  });

  // Part A — the bundled fiat rate seed is a FALLBACK LAYER: with an EMPTY
  // `currency_rates` table (a fresh install, before any live sync ever
  // succeeded), a supported fiat currency must still convert, rather than
  // silently dropping out of net worth until the first live fetch lands.
  describe('fiat rate seed fallback', () => {
    it('falls back to the bundled fiat seed when the DB has no rows at all', () => {
      const table = buildRateTable([]);

      expect(table['USD:UAH']).toBeGreaterThan(0);
    });

    it('lets a live DB row override the seed value for the same pair', () => {
      const table = buildRateTable([{ base: 'USD', quote: 'UAH', rate: '999.5' }]);

      expect(table['USD:UAH']).toBe(999.5);
    });

    it('keeps every OTHER seeded pair intact when only one live row is stored', () => {
      const table = buildRateTable([{ base: 'USD', quote: 'UAH', rate: '999.5' }]);

      expect(table['EUR:UAH']).toBeGreaterThan(0);
      expect(table['EUR:UAH']).not.toBe(999.5);
    });

    it('does not seed a crypto pair — fiat only, crypto stays a separate live-only path', () => {
      const table = buildRateTable([]);

      expect(table['BTC:UAH']).toBeUndefined();
    });
  });
});

describe('canConvert', () => {
  const rates = { 'USD:UAH': 40 };

  it('is true when the holding is already in the base currency', () => {
    expect(canConvert('UAH', 'UAH', rates)).toBe(true);
  });

  it('is true when a direct rate to the base currency exists', () => {
    expect(canConvert('USD', 'UAH', rates)).toBe(true);
  });

  it('is false when no rate to the base currency exists', () => {
    expect(canConvert('EUR', 'UAH', rates)).toBe(false);
  });

  // P1: a rate of 0 is not a usable rate — treating it as present (0 !==
  // undefined) let `guardedNetWorth` convert a holding to 0 while
  // `guardedBreakdown` still showed it at full own-currency value.
  it('is false when the stored rate to the base currency is zero', () => {
    expect(canConvert('EUR', 'UAH', { 'EUR:UAH': 0 })).toBe(false);
  });
});

describe('guardedNetWorth', () => {
  const rates = { 'USD:UAH': 40 };

  it('sums only the holdings that can convert to the base currency', () => {
    const holdings = [
      // 100.00 USD -> 4000.00 UAH
      {
        currency: 'USD' as const,
        balanceMinorUnits: 10_000,
        type: 'cash' as const,
        metadata: null,
      },
      {
        currency: 'UAH' as const,
        balanceMinorUnits: 100_000,
        type: 'cash' as const,
        metadata: null,
      },
      // no rate, excluded
      { currency: 'EUR' as const, balanceMinorUnits: 5_000, type: 'cash' as const, metadata: null },
    ];
    const total = guardedNetWorth(holdings, 'UAH', rates, NOW);
    expect(total.currency).toBe('UAH');
    expect(total.minorUnits).toBe(500_000); // 4000 + 1000 UAH
  });

  it('returns zero in the base currency when nothing is convertible', () => {
    const holdings = [
      { currency: 'EUR' as const, balanceMinorUnits: 5_000, type: 'cash' as const, metadata: null },
    ];
    const total = guardedNetWorth(holdings, 'UAH', rates, NOW);
    expect(total.currency).toBe('UAH');
    expect(total.minorUnits).toBe(0);
  });
});

describe('guardedBreakdown', () => {
  it('omits a currency the total could not convert', () => {
    const holdings = [
      {
        currency: 'UAH' as const,
        balanceMinorUnits: 100_00,
        type: 'cash' as const,
        metadata: null,
      },
      {
        currency: 'BTC' as const,
        balanceMinorUnits: 50_000_000,
        type: 'crypto_asset' as const,
        metadata: null,
      },
    ];
    const rates = {};

    const total = guardedNetWorth(holdings, 'UAH', rates, NOW);
    const breakdown = guardedBreakdown(holdings, 'UAH', rates, NOW);

    expect(breakdown.map((money) => money.currency)).toEqual(['UAH']);
    expect(breakdown.reduce((sum, money) => sum + money.minorUnits, 0)).toBe(total.minorUnits);
  });

  it('keeps every currency once the rates are cached', () => {
    const holdings = [
      {
        currency: 'UAH' as const,
        balanceMinorUnits: 100_00,
        type: 'cash' as const,
        metadata: null,
      },
      {
        currency: 'BTC' as const,
        balanceMinorUnits: 50_000_000,
        type: 'crypto_asset' as const,
        metadata: null,
      },
    ];
    const rates = { 'BTC:UAH': 2_500_000 };

    expect(guardedBreakdown(holdings, 'UAH', rates, NOW)).toHaveLength(2);
  });
});

// Regression coverage for the manual-only-user bug: `useAutoSync` used to skip
// `refreshRates` whenever the sync fan-out had no jobs, so a user with no
// connected Monobank/crypto account never got a live cross-rate cached. That
// left `canConvert` permanently false for every non-base-currency holding,
// which silently dropped it from BOTH `guardedNetWorth` and `guardedBreakdown`
// — the actual user-visible symptom, reproduced here at the aggregation level
// rather than through the hook. `use-auto-sync.test.ts` already covers the fix
// at the sync-fan-out level; these lock in the currency-guard behavior itself,
// in BOTH base-currency directions, so the guard is proven symmetric rather
// than only verified for one hardcoded base.
describe('guardedNetWorth / guardedBreakdown — base-currency flip regression', () => {
  it('drops a UAH holding from the USD-base total and breakdown when no UAH:USD rate is cached (base-currency flip)', () => {
    const holdings = [
      // 100.00 USD
      {
        currency: 'USD' as const,
        balanceMinorUnits: 10_000,
        type: 'cash' as const,
        metadata: null,
      },
      // 1000.00 UAH, unconvertible without a rate
      {
        currency: 'UAH' as const,
        balanceMinorUnits: 100_000,
        type: 'cash' as const,
        metadata: null,
      },
    ];
    const rates: Record<string, number> = {};

    const total = guardedNetWorth(holdings, 'USD', rates, NOW);
    const breakdown = guardedBreakdown(holdings, 'USD', rates, NOW);

    expect(total.currency).toBe('USD');
    expect(total.minorUnits).toBe(10_000);
    expect(breakdown.map((money) => money.currency)).toEqual(['USD']);
  });

  it('includes a UAH holding in the USD-base total and breakdown once UAH:USD is cached (base-currency flip)', () => {
    const holdings = [
      {
        currency: 'USD' as const,
        balanceMinorUnits: 10_000,
        type: 'cash' as const,
        metadata: null,
      },
      {
        currency: 'UAH' as const,
        balanceMinorUnits: 100_000,
        type: 'cash' as const,
        metadata: null,
      },
    ];
    const rates = { 'UAH:USD': 0.025 };

    const total = guardedNetWorth(holdings, 'USD', rates, NOW);
    const breakdown = guardedBreakdown(holdings, 'USD', rates, NOW);

    expect(total.currency).toBe('USD');
    // 100.00 USD + (1000.00 UAH * 0.025) = 125.00 USD
    expect(total.minorUnits).toBe(12_500);
    // `guardedBreakdown` reports each row in its OWN currency (unconverted), so
    // the UAH row must survive as 1000.00 UAH, not be dropped or converted.
    expect(breakdown.map((money) => money.currency).sort()).toEqual(['UAH', 'USD']);
    expect(breakdown.find((money) => money.currency === 'UAH')?.minorUnits).toBe(100_000);
    expect(breakdown.find((money) => money.currency === 'USD')?.minorUnits).toBe(10_000);
  });

  // P1: a stored rate of 0 (e.g. a bad provider tick) must exclude the
  // holding from BOTH the total and the breakdown, exactly like a MISSING
  // rate — never convert it to 0 in the total while the breakdown still
  // shows it at full own-currency value.
  it('drops a holding from both the total and the breakdown when its rate to the base currency is zero', () => {
    const holdings = [
      {
        currency: 'UAH' as const,
        balanceMinorUnits: 100_00,
        type: 'cash' as const,
        metadata: null,
      },
      {
        currency: 'EUR' as const,
        balanceMinorUnits: 5_000,
        type: 'cash' as const,
        metadata: null,
      },
    ];
    const rates = { 'EUR:UAH': 0 };

    const total = guardedNetWorth(holdings, 'UAH', rates, NOW);
    const breakdown = guardedBreakdown(holdings, 'UAH', rates, NOW);

    expect(breakdown.map((money) => money.currency)).toEqual(['UAH']);
    expect(breakdown.reduce((sum, money) => sum + money.minorUnits, 0)).toBe(total.minorUnits);
  });
});

// Part A end-to-end proof: the root-cause bug was that `currency_rates` is
// EMPTY until the first live Monobank fetch succeeds, so `refreshRates` never
// writes a row on a fresh, offline install and a non-UAH holding silently
// dropped out of net worth (`canConvert`) with no live rate ever cached. The
// bundled fiat seed fixes this offline, before any sync — going through the
// REAL `buildRateTable` (not a hand-built `rates` object) is what proves the
// fallback layer, not just the guard functions in isolation.
describe('offline-first-run regression — empty currency_rates DB (Part A)', () => {
  it('counts a USD holding in the headline total with a completely empty rates table', () => {
    const table = buildRateTable([]); // simulates an empty `currency_rates` table
    const holdings = [
      {
        currency: 'USD' as const,
        balanceMinorUnits: 10_000,
        type: 'cash' as const,
        metadata: null,
      },
    ];

    const total = guardedNetWorth(holdings, 'UAH', table, NOW);

    expect(total.currency).toBe('UAH');
    expect(total.minorUnits).toBeGreaterThan(0);
  });

  it('counts a USD holding in the per-currency breakdown with a completely empty rates table', () => {
    const table = buildRateTable([]);
    const holdings = [
      {
        currency: 'USD' as const,
        balanceMinorUnits: 10_000,
        type: 'cash' as const,
        metadata: null,
      },
    ];

    const breakdown = guardedBreakdown(holdings, 'UAH', table, NOW);

    expect(breakdown.map((money) => money.currency)).toEqual(['USD']);
    expect(breakdown[0].minorUnits).toBeGreaterThan(0);
  });

  it('prefers a live USD:UAH rate over the seed once one is stored', () => {
    const seeded = buildRateTable([]);
    const live = buildRateTable([{ base: 'USD', quote: 'UAH', rate: '41.23' }]);
    const holdings = [
      {
        currency: 'USD' as const,
        balanceMinorUnits: 10_000,
        type: 'cash' as const,
        metadata: null,
      },
    ];

    const seededTotal = guardedNetWorth(holdings, 'UAH', seeded, NOW);
    const liveTotal = guardedNetWorth(holdings, 'UAH', live, NOW);

    // 100.00 USD * 41.23 = 4,123.00 UAH exactly — proves the LIVE rate, not
    // the approximate seed, drove this total.
    expect(liveTotal.minorUnits).toBe(412_300);
    expect(liveTotal.minorUnits).not.toBe(seededTotal.minorUnits);
  });
});
