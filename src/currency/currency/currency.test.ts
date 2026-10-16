import { Money } from '../money';
import { CURATED_COIN_CODES, curatedCoins } from '../coins';

import {
  isFiat,
  isCrypto,
  isCurrency,
  currencyScale,
  currencySymbol,
  currencyOptions,
  fiatCurrencyOptions,
  applySymbolPlacement,
  cryptoCurrencyOptions,
} from './currency';

describe('currencyOptions', () => {
  it('opens with the originally shipped fiat set in canonical order', () => {
    expect(currencyOptions.slice(0, 5)).toEqual(['UAH', 'USD', 'EUR', 'GBP', 'CHF']);
  });

  it('lists every curated code after the fiat block', () => {
    expect(currencyOptions.slice(-CURATED_COIN_CODES.length)).toEqual([...CURATED_COIN_CODES]);
    expect(currencyOptions.slice(0, -CURATED_COIN_CODES.length).some(isCrypto)).toBe(false);
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
  it('treats every curated coin as crypto and everything else as fiat', () => {
    for (const code of CURATED_COIN_CODES) {
      expect(isCrypto(code)).toBe(true);
      expect(isFiat(code)).toBe(false);
    }

    for (const code of fiatCurrencyOptions) {
      expect(isCrypto(code)).toBe(false);
      expect(isFiat(code)).toBe(true);
    }
  });

  it('exposes the fiat subset (every option except the crypto block), order-preserving', () => {
    const cryptoBlock = new Set<string>(CURATED_COIN_CODES);
    expect([...fiatCurrencyOptions]).toEqual(
      currencyOptions.filter((code) => !cryptoBlock.has(code)),
    );

    for (const code of CURATED_COIN_CODES) {
      expect(fiatCurrencyOptions).not.toContain(code);
    }
  });

  it('exposes the crypto subset (the curated coins), order-preserving', () => {
    expect([...cryptoCurrencyOptions]).toEqual([...CURATED_COIN_CODES]);

    for (const code of cryptoCurrencyOptions) {
      expect(isCrypto(code)).toBe(true);
    }
  });

  it('assigns a defined scale and mark to each new crypto', () => {
    expect(currencyScale.ETH).toBe(8);
    expect(currencyScale.USDT).toBe(8);
    expect(currencySymbol.ETH).toBe('Ξ');
    expect(currencySymbol.USDT).toBe('₮');
  });

  it('derives scale and symbol from the registry', () => {
    for (const entry of Object.values(curatedCoins)) {
      expect(currencyScale[entry.code]).toBe(entry.scale);
      expect(currencySymbol[entry.code]).toBe(entry.symbol);
    }
  });

  it('parses 0.00012345 USDT to its minor units', () => {
    expect(Money.fromMajor('USDT', 0.00012345).minorUnits).toBe(12345);
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
