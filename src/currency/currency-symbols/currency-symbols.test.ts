import { currencyOptions } from '../currency';

import { currencySignSymbol } from './currency-symbols';

// A real SF Symbol name: lowercase letters/digits, dot-separated segments
// (e.g. "hryvniasign"). Mirrors the guard in src/holdings/entity-symbols.test.ts.
const SF_SYMBOL = /^[a-z0-9]+(\.[a-z0-9]+)*$/;

describe('currencySignSymbol', () => {
  it('maps every currency to a non-empty SF Symbol name', () => {
    for (const code of currencyOptions) {
      const symbol = currencySignSymbol[code];
      expect(symbol.length).toBeGreaterThan(0);
      expect(symbol).toMatch(SF_SYMBOL);
    }
  });

  it('assigns each originally shipped currency its dedicated SF Symbol currency-sign glyph', () => {
    expect(currencySignSymbol.UAH).toBe('hryvniasign');
    expect(currencySignSymbol.USD).toBe('dollarsign');
    expect(currencySignSymbol.EUR).toBe('eurosign');
    expect(currencySignSymbol.GBP).toBe('sterlingsign');
    expect(currencySignSymbol.CHF).toBe('francsign');
    expect(currencySignSymbol.BTC).toBe('bitcoinsign');
  });

  it('falls back to the generic banknote glyph for an additional Monobank fiat', () => {
    // SF Symbols ships a dedicated sign for only a handful of currencies; a code
    // without a verified, on-device-proven sign uses the generic `banknote`
    // glyph (iOS 15, below the app's iOS 16 floor) rather than a guessed,
    // possibly-blank one.
    for (const code of ['JPY', 'PLN', 'CAD', 'TRY', 'INR'] as const) {
      expect(currencySignSymbol[code]).toBe('banknote');
    }
  });
});
