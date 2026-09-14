import {
  currencyOptions,
  currencyScale,
  currencySymbol,
  fiatCurrencyOptions,
  isCrypto,
  isCurrency,
  isFiat,
} from './currency';

describe('currencyOptions', () => {
  it('opens with the originally shipped fiat set in canonical order', () => {
    expect(currencyOptions.slice(0, 5)).toEqual(['UAH', 'USD', 'EUR', 'GBP', 'CHF']);
  });

  it('ends with the crypto block: BTC, ETH, USDT', () => {
    expect(currencyOptions.slice(-3)).toEqual(['BTC', 'ETH', 'USDT']);
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
  it('treats BTC, ETH, and USDT as crypto and everything else as fiat', () => {
    for (const code of ['BTC', 'ETH', 'USDT'] as const) {
      expect(isCrypto(code)).toBe(true);
      expect(isFiat(code)).toBe(false);
    }
    for (const code of fiatCurrencyOptions) {
      expect(isCrypto(code)).toBe(false);
      expect(isFiat(code)).toBe(true);
    }
  });

  it('exposes the fiat subset (every option except the crypto block), order-preserving', () => {
    const cryptoBlock = new Set(['BTC', 'ETH', 'USDT']);
    expect([...fiatCurrencyOptions]).toEqual(
      currencyOptions.filter((code) => !cryptoBlock.has(code)),
    );
    for (const code of ['BTC', 'ETH', 'USDT'] as const) {
      expect(fiatCurrencyOptions).not.toContain(code);
    }
  });

  it('assigns a defined scale and mark to each new crypto', () => {
    expect(currencyScale.ETH).toBe(8);
    expect(currencyScale.USDT).toBe(2);
    expect(currencySymbol.ETH).toBe('Ξ');
    expect(currencySymbol.USDT).toBe('₮');
  });
});
