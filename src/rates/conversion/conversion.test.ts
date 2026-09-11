import { Money } from '../../currency/money';

import { convert, netWorth } from './conversion';

// A fixed evaluation instant. Every holding in these cases is plain cash (no
// `type`), so `holdingValue` takes its flat branch and the instant cannot
// affect a total — it is pinned only to keep the call deterministic.
const NOW = Date.UTC(2026, 0, 1);

const rates = {
  'USD:UAH': 40,
  'EUR:UAH': 43,
  'BTC:UAH': 4_000_000,
};

describe('convert', () => {
  it('converts USD to UAH', () => {
    const result = convert(Money.of('USD', 10_000), 'UAH', rates); // 100.00 USD
    expect(result.currency).toBe('UAH');
    expect(result.minorUnits).toBe(400_000); // 4000.00 UAH
  });

  it('returns the same money when already in target currency', () => {
    const result = convert(Money.of('UAH', 500), 'UAH', rates);
    expect(result.minorUnits).toBe(500);
  });

  it('throws when the rate for the pair is missing', () => {
    expect(() => convert(Money.of('EUR', 10_000), 'USD', rates)).toThrow('Missing rate EUR->USD');
  });
});

describe('netWorth', () => {
  it('sums holdings converted to the base currency', () => {
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
    const total = netWorth(holdings, 'UAH', rates, NOW);
    expect(total.currency).toBe('UAH');
    expect(total.minorUnits).toBe(500_000); // 4000 + 1000 UAH
  });

  it('returns zero in the base currency for no holdings', () => {
    const total = netWorth([], 'UAH', rates, NOW);
    expect(total.currency).toBe('UAH');
    expect(total.minorUnits).toBe(0);
  });
});
