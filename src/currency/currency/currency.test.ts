import {
  currencyOptions,
  fiatCurrencyOptions,
  isCurrency,
  isCrypto,
  isFiat,
  currencyName,
} from './currency';

describe('currencyOptions', () => {
  it('lists the currencies in the canonical display order UAH, USD, EUR, GBP, CHF, BTC', () => {
    expect([...currencyOptions]).toEqual(['UAH', 'USD', 'EUR', 'GBP', 'CHF', 'BTC']);
  });
});

describe('isCurrency', () => {
  it('accepts each supported currency code', () => {
    for (const code of ['UAH', 'USD', 'EUR', 'GBP', 'CHF', 'BTC']) {
      expect(isCurrency(code)).toBe(true);
    }
  });

  it('rejects an unsupported code', () => {
    expect(isCurrency('JPY')).toBe(false);
    expect(isCurrency('PLN')).toBe(false);
  });
});

describe('fiat / crypto classification', () => {
  it('treats only BTC as crypto', () => {
    expect(isCrypto('BTC')).toBe(true);
    for (const code of ['UAH', 'USD', 'EUR', 'GBP', 'CHF'] as const) {
      expect(isCrypto(code)).toBe(false);
      expect(isFiat(code)).toBe(true);
    }
    expect(isFiat('BTC')).toBe(false);
  });

  it('exposes the fiat subset in canonical order, without any crypto code', () => {
    expect([...fiatCurrencyOptions]).toEqual(['UAH', 'USD', 'EUR', 'GBP', 'CHF']);
  });
});

describe('currencyName', () => {
  it('gives every currency a non-empty human-readable name', () => {
    for (const code of currencyOptions) {
      expect(currencyName[code].length).toBeGreaterThan(0);
    }
  });

  it('names the fiat and crypto codes', () => {
    expect(currencyName.USD).toBe('US Dollar');
    expect(currencyName.GBP).toBe('British Pound');
    expect(currencyName.CHF).toBe('Swiss Franc');
    expect(currencyName.BTC).toBe('Bitcoin');
  });
});
