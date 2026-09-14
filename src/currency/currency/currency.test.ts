import {
  applySymbolPlacement,
  currencyOptions,
  currencySymbol,
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

describe('currencySymbol', () => {
  it('maps every currency to a non-empty mark (never a generic placeholder)', () => {
    for (const code of currencyOptions) {
      expect(currencySymbol[code].length).toBeGreaterThan(0);
    }
  });
});

describe('applySymbolPlacement', () => {
  it('suffixes UAH with a space before the symbol', () => {
    expect(applySymbolPlacement('UAH', '', '2,500.00')).toBe('2,500.00 ₴');
  });

  it('prefixes a real-glyph currency tight, with no space', () => {
    expect(applySymbolPlacement('USD', '', '1,234.50')).toBe('$1,234.50');
    expect(applySymbolPlacement('BTC', '', '0.05000000')).toBe('₿0.05000000');
  });

  it('prefixes a bare-code currency (no conventional symbol) with a space', () => {
    expect(applySymbolPlacement('AED', '', '1,234.50')).toBe('AED 1,234.50');
    expect(applySymbolPlacement('BGN', '', '10.00')).toBe('BGN 10.00');
    expect(applySymbolPlacement('KES', '', '500.00')).toBe('KES 500.00');
  });

  it('keeps the sign outside the symbol on every placement path', () => {
    expect(applySymbolPlacement('USD', '-', '1,234.50')).toBe('-$1,234.50');
    expect(applySymbolPlacement('UAH', '-', '2,500.00')).toBe('-2,500.00 ₴');
    expect(applySymbolPlacement('AED', '-', '1,234.50')).toBe('-AED 1,234.50');
  });
});
