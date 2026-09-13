import { buildRateTable, canConvert, guardedBreakdown, guardedNetWorth } from './net-worth-view';

// A fixed evaluation instant. Every holding in these cases is plain cash (no
// `type`), so `holdingValue` takes its flat branch and the instant cannot
// affect a total — it is pinned only to keep the call deterministic.
const NOW = Date.UTC(2026, 0, 1);

describe('buildRateTable', () => {
  it('parses the string rate column into a numeric RateTable', () => {
    const table = buildRateTable([{ base: 'USD', quote: 'UAH', rate: '40.5' }]);
    expect(table).toEqual({ 'USD:UAH': 40.5 });
  });

  it('drops rows whose rate does not parse to a finite number', () => {
    const table = buildRateTable([
      { base: 'USD', quote: 'UAH', rate: '40' },
      { base: 'EUR', quote: 'UAH', rate: 'not-a-number' },
    ]);
    expect(table).toEqual({ 'USD:UAH': 40 });
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
});
