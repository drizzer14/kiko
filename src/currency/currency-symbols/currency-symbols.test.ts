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

  it('assigns UAH hryvniasign, USD dollarsign, EUR eurosign, BTC bitcoinsign', () => {
    expect(currencySignSymbol.UAH).toBe('hryvniasign');
    expect(currencySignSymbol.USD).toBe('dollarsign');
    expect(currencySignSymbol.EUR).toBe('eurosign');
    expect(currencySignSymbol.BTC).toBe('bitcoinsign');
  });
});
