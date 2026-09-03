import { currencyOptions, isCurrency } from './currency';

describe('currencyOptions', () => {
  it('lists the currencies in the canonical display order UAH, USD, EUR, BTC', () => {
    expect([...currencyOptions]).toEqual(['UAH', 'USD', 'EUR', 'BTC']);
  });
});

describe('isCurrency', () => {
  it('accepts each of the four supported currency codes', () => {
    expect(isCurrency('BTC')).toBe(true);
    expect(isCurrency('USD')).toBe(true);
    expect(isCurrency('EUR')).toBe(true);
    expect(isCurrency('UAH')).toBe(true);
  });

  it('rejects an unsupported code', () => {
    expect(isCurrency('GBP')).toBe(false);
  });
});
