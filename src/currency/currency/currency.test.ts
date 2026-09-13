import {
  currencyName,
  currencyOptions,
  fiatCurrencyOptions,
  isCrypto,
  isCurrency,
  isFiat,
} from './currency';

describe('currencyOptions', () => {
  it('opens with the originally shipped fiat set in canonical order and ends with BTC', () => {
    expect(currencyOptions.slice(0, 5)).toEqual(['UAH', 'USD', 'EUR', 'GBP', 'CHF']);
    expect(currencyOptions.at(-1)).toBe('BTC');
  });

  it('includes the additional Monobank-priced fiats', () => {
    for (const code of ['JPY', 'PLN', 'CAD', 'AUD', 'TRY', 'INR', 'GEL'] as const) {
      expect(currencyOptions).toContain(code);
    }
  });

  it('has no duplicate codes', () => {
    expect(new Set(currencyOptions).size).toBe(currencyOptions.length);
  });
});

describe('isCurrency', () => {
  it('accepts every supported currency code', () => {
    for (const code of currencyOptions) {
      expect(isCurrency(code)).toBe(true);
    }
  });

  it('rejects a code the app does not support', () => {
    // RUB is not in Monobank's UAH-priced fiat set, so it stays unsupported.
    expect(isCurrency('RUB')).toBe(false);
    expect(isCurrency('XYZ')).toBe(false);
  });
});

describe('fiat / crypto classification', () => {
  it('treats only BTC as crypto', () => {
    expect(isCrypto('BTC')).toBe(true);
    for (const code of fiatCurrencyOptions) {
      expect(isCrypto(code)).toBe(false);
      expect(isFiat(code)).toBe(true);
    }
    expect(isFiat('BTC')).toBe(false);
  });

  it('exposes the fiat subset (every option except BTC), order-preserving', () => {
    expect([...fiatCurrencyOptions]).toEqual(currencyOptions.filter((code) => code !== 'BTC'));
    expect(fiatCurrencyOptions).not.toContain('BTC');
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
    expect(currencyName.JPY).toBe('Japanese Yen');
    expect(currencyName.PLN).toBe('Polish Zloty');
    expect(currencyName.BTC).toBe('Bitcoin');
  });
});
