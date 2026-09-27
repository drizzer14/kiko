import { Money } from '@kiko/currency/money';
import { buildPriceBook } from '@kiko/prices/price-book';
import { holdingInstrument } from '@kiko/prices/instrument';

import { convert, netWorth, rateBetween, rateTableFromRows } from './conversion';

// A fixed evaluation instant. Every holding in these cases is plain cash (no
// `type`), so `holdingValue` takes its flat branch and the instant cannot
// affect a total — it is pinned only to keep the call deterministic.
const NOW = Date.UTC(2026, 0, 1);

// A `RateTable` is now a currency -> its price in ONE UAH map; `UAH` itself
// is never a key (implicit 1, read through `rateBetween`).
const rates = {
  USD: 40,
  EUR: 43,
  BTC: 4_000_000,
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

  it('throws when the target currency has no stored UAH price at all', () => {
    expect(() => convert(Money.of('EUR', 10_000), 'GBP', rates)).toThrow('Missing rate EUR->GBP');
  });
});

describe('netWorth', () => {
  it('sums holdings converted to the base currency', () => {
    const holdings = [
      {
        id: 'usd-cash',
        currency: 'USD' as const,
        balanceMinorUnits: 10_000,
        type: 'cash' as const,
        metadata: null,
      },
      {
        id: 'uah-cash',
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

  // With no `book` argument, a priced holding (property_item) falls back
  // to its lots cost basis rather than reading 0.
  it('values a property_item holding at its cost basis when no book is passed', () => {
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
    const total = netWorth(holdings, 'UAH', rates, NOW);
    expect(total.minorUnits).toBe(500_000);
  });

  // Threading a real `PriceBook` overrides the cost-basis fallback.
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
    const total = netWorth(holdings, 'UAH', rates, NOW, book);
    expect(total.minorUnits).toBe(700_000);
  });
});

describe('rateTableFromRows', () => {
  it('parses the string rate column into a numeric RateTable, keyed by base', () => {
    const table = rateTableFromRows([{ base: 'USD', quote: 'UAH', rate: '40.5' }]);
    expect(table).toEqual({ USD: 40.5 });
  });

  it('drops a row whose rate does not parse to a finite number', () => {
    const table = rateTableFromRows([
      { base: 'USD', quote: 'UAH', rate: '40' },
      { base: 'EUR', quote: 'UAH', rate: 'not-a-number' },
    ]);
    expect(table).toEqual({ USD: 40 });
  });

  it('drops a row whose rate parses to zero', () => {
    const table = rateTableFromRows([
      { base: 'USD', quote: 'UAH', rate: '40' },
      { base: 'EUR', quote: 'UAH', rate: '0' },
    ]);
    expect(table).toEqual({ USD: 40 });
  });

  it('ignores a stray cross row (quote other than UAH), it is never read', () => {
    const table = rateTableFromRows([
      { base: 'USD', quote: 'UAH', rate: '40' },
      { base: 'USD', quote: 'EUR', rate: '0.93' },
    ]);
    expect(table).toEqual({ USD: 40 });
  });

  it('ignores a row with base UAH — UAH is never a key, its price is implicit 1', () => {
    const table = rateTableFromRows([{ base: 'UAH', quote: 'USD', rate: '0.025' }]);
    expect(table).toEqual({});
  });
});

describe('rateBetween', () => {
  it('resolves A->B as the ratio of each currency’s UAH price', () => {
    expect(rateBetween({ USD: 40, EUR: 44 }, 'USD', 'EUR')).toBe(40 / 44);
  });

  it('treats UAH as an implicit 1, never a stored key', () => {
    expect(rateBetween({ USD: 40 }, 'UAH', 'USD')).toBe(1 / 40);
    expect(rateBetween({ USD: 40 }, 'USD', 'UAH')).toBe(40);
  });

  it('is 1 for the same currency, even with no stored price at all', () => {
    expect(rateBetween({}, 'USD', 'USD')).toBe(1);
    expect(rateBetween({}, 'UAH', 'UAH')).toBe(1);
  });

  it('is undefined when a leg is missing', () => {
    expect(rateBetween({ USD: 40 }, 'USD', 'EUR')).toBeUndefined();
    expect(rateBetween({ USD: 40 }, 'EUR', 'USD')).toBeUndefined();
  });

  it('is undefined when a leg is zero, negative, or NaN', () => {
    expect(rateBetween({ USD: 40, EUR: 0 }, 'USD', 'EUR')).toBeUndefined();
    expect(rateBetween({ USD: 40, EUR: -1 }, 'USD', 'EUR')).toBeUndefined();
    expect(rateBetween({ USD: 40, EUR: Number.NaN }, 'USD', 'EUR')).toBeUndefined();
  });
});
