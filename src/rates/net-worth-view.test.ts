import { buildRateTable, canConvert, guardedNetWorth } from './net-worth-view';

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
      { currency: 'USD' as const, balanceMinorUnits: 10_000 }, // 100.00 USD -> 4000.00 UAH
      { currency: 'UAH' as const, balanceMinorUnits: 100_000 },
      { currency: 'EUR' as const, balanceMinorUnits: 5_000 }, // no rate, excluded
    ];
    const total = guardedNetWorth(holdings, 'UAH', rates);
    expect(total.currency).toBe('UAH');
    expect(total.minorUnits).toBe(500_000); // 4000 + 1000 UAH
  });

  it('returns zero in the base currency when nothing is convertible', () => {
    const holdings = [{ currency: 'EUR' as const, balanceMinorUnits: 5_000 }];
    const total = guardedNetWorth(holdings, 'UAH', rates);
    expect(total.currency).toBe('UAH');
    expect(total.minorUnits).toBe(0);
  });
});
