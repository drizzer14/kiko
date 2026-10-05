import type { Currency } from '@kiko/currency/currency';
import { buildPriceBook } from '@kiko/prices/price-book';
import { holdingInstrument, metalInstrument } from '@kiko/prices/instrument';

import { buildRateTable, canConvert, guardedBreakdown, guardedNetWorth } from './net-worth-view';

// A fixed evaluation instant. Every holding in these cases is plain cash (no
// `type`), so `holdingValue` takes its flat branch and the instant cannot
// affect a total — it is pinned only to keep the call deterministic.
const NOW = Date.UTC(2026, 0, 1);

// A plain cash holding — the flat-balance shape most fixtures below need;
// only its currency and balance vary per case.
const cash = (currency: Currency, balanceMinorUnits: number) => ({
  id: 'cash-1',
  currency,
  balanceMinorUnits,
  type: 'cash' as const,
  metadata: null,
});

// A plain crypto_asset holding, the same flat shape as `cash` above, for the
// BTC-conversion-guard cases.
const crypto = (currency: Currency, balanceMinorUnits: number) => ({
  id: 'crypto-1',
  currency,
  balanceMinorUnits,
  type: 'crypto_asset' as const,
  metadata: null,
});

describe('buildRateTable', () => {
  // Parse/drop behavior for the LIVE rows themselves is unit-tested in full
  // isolation (exact `toEqual` on the whole object) by
  // `rateTableFromRows` in `conversion.test.ts` — `buildRateTable` now also
  // merges the bundled fiat seed underneath every live row, so an
  // exact whole-object `toEqual` here would break on the seed's own many
  // entries. These cases instead target only the keys the passed rows touch.
  it('parses the string rate column into a numeric RateTable', () => {
    const table = buildRateTable([{ base: 'USD', quote: 'UAH', rate: '40.5' }]);
    expect(table.USD).toBe(40.5);
  });

  it('drops a row whose rate does not parse to a finite number, without corrupting the fiat seed fallback', () => {
    const table = buildRateTable([
      { base: 'USD', quote: 'UAH', rate: '40' },
      { base: 'EUR', quote: 'UAH', rate: 'not-a-number' },
    ]);
    expect(table.USD).toBe(40);
    // The invalid EUR row must not overwrite the seed's EUR:UAH with NaN —
    // EUR:UAH still resolves through the seed fallback beneath it.
    expect(Number.isFinite(table.EUR)).toBe(true);
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
    expect(table.USD).toBe(40);
    // The zero EUR row must not overwrite the seed's EUR:UAH with 0.
    expect(table.EUR).not.toBe(0);
    expect(table.EUR).toBeGreaterThan(0);
  });

  // The bundled fiat rate seed is a FALLBACK LAYER: with an EMPTY
  // `currency_rates` table (a fresh install, before any live sync ever
  // succeeded), a supported fiat currency must still convert, rather than
  // silently dropping out of net worth until the first live fetch lands.
  describe('fiat rate seed fallback', () => {
    it('falls back to the bundled fiat seed when the DB has no rows at all', () => {
      const table = buildRateTable([]);

      expect(table.USD).toBeGreaterThan(0);
    });

    it('lets a live DB row override the seed value for the same pair', () => {
      const table = buildRateTable([{ base: 'USD', quote: 'UAH', rate: '999.5' }]);

      expect(table.USD).toBe(999.5);
    });

    it('keeps every OTHER seeded pair intact when only one live row is stored', () => {
      const table = buildRateTable([{ base: 'USD', quote: 'UAH', rate: '999.5' }]);

      expect(table.EUR).toBeGreaterThan(0);
      expect(table.EUR).not.toBe(999.5);
    });

    it('does not seed a crypto pair — fiat only, crypto stays a separate live-only path', () => {
      const table = buildRateTable([]);

      expect(table.BTC).toBeUndefined();
    });
  });
});

describe('canConvert', () => {
  const rates = { USD: 40 };

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
    expect(canConvert('EUR', 'UAH', { EUR: 0 })).toBe(false);
  });
});

describe('guardedNetWorth', () => {
  const rates = { USD: 40 };

  it('sums only the holdings that can convert to the base currency', () => {
    const holdings = [
      cash('USD', 10_000), // 100.00 USD -> 4000.00 UAH
      cash('UAH', 100_000),
      cash('EUR', 5_000), // no rate, excluded
    ];
    const total = guardedNetWorth(holdings, 'UAH', rates, NOW);
    expect(total.currency).toBe('UAH');
    expect(total.minorUnits).toBe(500_000); // 4000 + 1000 UAH
  });

  it('returns zero in the base currency when nothing is convertible', () => {
    const holdings = [cash('EUR', 5_000)];
    const total = guardedNetWorth(holdings, 'UAH', rates, NOW);
    expect(total.currency).toBe('UAH');
    expect(total.minorUnits).toBe(0);
  });

  // Threading a `PriceBook` through reaches a priced (property_item)
  // holding's value, overriding its lots-cost-basis default.
  it('values a property_item holding at its priced value when a book is passed', () => {
    const holdings = [
      {
        id: 'prop',
        currency: 'UAH' as const,
        type: 'property_item' as const,
        balanceMinorUnits: 0,
        metadata: {
          category: 'real_estate',
          lots: [{ day: NOW, quantityDelta: '1', costMinorUnits: 500_000 }],
        },
      },
    ];
    const book = buildPriceBook([
      {
        instrument: holdingInstrument('prop'),
        day: NOW,
        price: '7000',
        currency: 'UAH',
        source: 'manual',
      },
    ]);

    expect(guardedNetWorth(holdings, 'UAH', rates, NOW).minorUnits).toBe(500_000);
    expect(guardedNetWorth(holdings, 'UAH', rates, NOW, book).minorUnits).toBe(700_000);
  });

  // A metal holding is priced through the SHARED `metal:<XAU|...>`
  // instrument (kiko-pricing), not a per-holding one — `guardedNetWorth`
  // reaches that value the same way it reaches property_item's above, end to
  // end from a real `PriceBook`.
  it('values a metal holding at its priced value when a book is passed, through the shared metal:XAU instrument', () => {
    const holdings = [
      {
        id: 'gold',
        currency: 'UAH' as const,
        type: 'metal' as const,
        balanceMinorUnits: 0,
        metadata: {
          metal: 'XAU',
          form: 'bar',
          unit: 'oz',
          purity: '1',
          lots: [{ day: NOW, quantityDelta: '1', costMinorUnits: 500_000 }],
        },
      },
    ];
    const book = buildPriceBook([
      {
        instrument: metalInstrument('XAU'),
        day: NOW,
        price: '9000',
        currency: 'UAH',
        source: 'nbu',
      },
    ]);

    expect(guardedNetWorth(holdings, 'UAH', rates, NOW).minorUnits).toBe(500_000);
    expect(guardedNetWorth(holdings, 'UAH', rates, NOW, book).minorUnits).toBe(900_000);
  });

  // Net worth = assets − debt outstanding. A loan holding's
  // own value is already NEGATIVE (`holding-value.ts`), so plainly summing
  // every holding — exactly what `guardedNetWorth`/`netWorth` already do —
  // subtracts the debt with no extra debt-aware logic here; a total can now
  // go negative when the debt outweighs the assets.
  it('subtracts a loan holding from the total, and goes negative when debt outweighs assets', () => {
    const loan = {
      id: 'loan-1',
      currency: 'UAH' as const,
      type: 'loan' as const,
      balanceMinorUnits: 0,
      metadata: {
        kind: 'mortgage' as const,
        principalMinorUnits: 900_000, // 9,000.00 UAH
        startDate: NOW, // no installment due yet: outstanding is the full principal
        annualRatePct: 10,
        termMonths: 120,
        schedule: 'annuity' as const,
      },
    };

    const partialOffset = guardedNetWorth([cash('UAH', 500_000), loan], 'UAH', rates, NOW);
    expect(partialOffset.minorUnits).toBe(500_000 - 900_000);
    expect(partialOffset.minorUnits).toBeLessThan(0);

    const debtOnly = guardedNetWorth([loan], 'UAH', rates, NOW);
    expect(debtOnly.minorUnits).toBe(-900_000);
  });
});

describe('guardedBreakdown', () => {
  it('omits a currency the total could not convert', () => {
    const holdings = [cash('UAH', 100_00), crypto('BTC', 50_000_000)];
    const rates = {};

    const total = guardedNetWorth(holdings, 'UAH', rates, NOW);
    const breakdown = guardedBreakdown(holdings, 'UAH', rates, NOW);

    expect(breakdown.map((money) => money.currency)).toEqual(['UAH']);
    expect(breakdown.reduce((sum, money) => sum + money.minorUnits, 0)).toBe(total.minorUnits);
  });

  it('keeps every currency once the rates are cached', () => {
    const holdings = [cash('UAH', 100_00), crypto('BTC', 50_000_000)];
    const rates = { BTC: 2_500_000 };

    expect(guardedBreakdown(holdings, 'UAH', rates, NOW)).toHaveLength(2);
  });
});

// A manual-only user (no connected Monobank/crypto account) must still get a
// live cross-rate cached; without one `canConvert` is false for every
// non-base-currency holding, which silently drops it from BOTH
// `guardedNetWorth` and `guardedBreakdown` — the user-visible symptom, pinned
// here at the aggregation level rather than through the hook.
// `use-auto-sync.test.ts` covers the rate refresh at the sync-fan-out level;
// these lock in the currency-guard behavior itself, in BOTH base-currency
// directions, so the guard is proven symmetric rather than only verified for
// one hardcoded base.
describe('guardedNetWorth / guardedBreakdown — base-currency flip regression', () => {
  it('drops a UAH holding from the USD-base total and breakdown when no UAH:USD rate is cached (base-currency flip)', () => {
    const holdings = [
      cash('USD', 10_000), // 100.00 USD
      cash('UAH', 100_000), // 1000.00 UAH, unconvertible without a rate
    ];
    const rates = {};

    const total = guardedNetWorth(holdings, 'USD', rates, NOW);
    const breakdown = guardedBreakdown(holdings, 'USD', rates, NOW);

    expect(total.currency).toBe('USD');
    expect(total.minorUnits).toBe(10_000);
    expect(breakdown.map((money) => money.currency)).toEqual(['USD']);
  });

  it('includes a UAH holding in the USD-base total and breakdown once UAH:USD is cached (base-currency flip)', () => {
    const holdings = [cash('USD', 10_000), cash('UAH', 100_000)];
    // uahPer(USD) = 40 -> rateBetween(UAH, USD) = 1 / 40 = 0.025.
    const rates = { USD: 40 };

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
    const holdings = [cash('UAH', 100_00), cash('EUR', 5_000)];
    const rates = { EUR: 0 };

    const total = guardedNetWorth(holdings, 'UAH', rates, NOW);
    const breakdown = guardedBreakdown(holdings, 'UAH', rates, NOW);

    expect(breakdown.map((money) => money.currency)).toEqual(['UAH']);
    expect(breakdown.reduce((sum, money) => sum + money.minorUnits, 0)).toBe(total.minorUnits);
  });
});

// End-to-end proof: `currency_rates` is EMPTY until the first live Monobank
// fetch succeeds, so `refreshRates` never writes a row on a fresh, offline
// install, and without the bundled fiat seed a non-UAH holding would silently
// drop out of net worth (`canConvert`) with no live rate ever cached. The seed
// covers this offline, before any sync — going through the REAL
// `buildRateTable` (not a hand-built `rates` object) is what proves the
// fallback layer, not just the guard functions in isolation.
describe('offline-first-run — empty currency_rates DB', () => {
  it('counts a USD holding in the headline total with a completely empty rates table', () => {
    const table = buildRateTable([]); // simulates an empty `currency_rates` table
    const holdings = [cash('USD', 10_000)];

    const total = guardedNetWorth(holdings, 'UAH', table, NOW);

    expect(total.currency).toBe('UAH');
    expect(total.minorUnits).toBeGreaterThan(0);
  });

  it('counts a USD holding in the per-currency breakdown with a completely empty rates table', () => {
    const table = buildRateTable([]);
    const holdings = [cash('USD', 10_000)];

    const breakdown = guardedBreakdown(holdings, 'UAH', table, NOW);

    expect(breakdown.map((money) => money.currency)).toEqual(['USD']);
    expect(breakdown[0].minorUnits).toBeGreaterThan(0);
  });

  it('prefers a live USD:UAH rate over the seed once one is stored', () => {
    const seeded = buildRateTable([]);
    const live = buildRateTable([{ base: 'USD', quote: 'UAH', rate: '41.23' }]);
    const holdings = [cash('USD', 10_000)];

    const seededTotal = guardedNetWorth(holdings, 'UAH', seeded, NOW);
    const liveTotal = guardedNetWorth(holdings, 'UAH', live, NOW);

    // 100.00 USD * 41.23 = 4,123.00 UAH exactly — proves the LIVE rate, not
    // the approximate seed, drove this total.
    expect(liveTotal.minorUnits).toBe(412_300);
    expect(liveTotal.minorUnits).not.toBe(seededTotal.minorUnits);
  });
});
