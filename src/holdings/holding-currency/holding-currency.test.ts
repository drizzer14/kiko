import { currencyOptions, fiatCurrencyOptions } from '@kiko/currency/currency';

import { holdingTypes } from '../holding-type';

import { holdingCurrencyOptions, isCurrencyAllowedForHoldingType } from './holding-currency';

describe('holdingCurrencyOptions', () => {
  it.each(['cash', 'share'] as const)('offers a %s holding fiat currencies only', (type) => {
    expect(holdingCurrencyOptions(type)).toEqual(fiatCurrencyOptions);
    expect(holdingCurrencyOptions(type)).not.toContain('BTC');
  });

  it('offers every other holding type the full currency set', () => {
    const fiatOnly: readonly string[] = ['cash', 'share'];

    for (const type of holdingTypes.filter((candidate) => !fiatOnly.includes(candidate))) {
      expect(holdingCurrencyOptions(type)).toEqual(currencyOptions);
    }
  });
});

describe('isCurrencyAllowedForHoldingType', () => {
  it('rejects a crypto currency on a cash holding', () => {
    expect(isCurrencyAllowedForHoldingType('cash', 'BTC')).toBe(false);
    expect(isCurrencyAllowedForHoldingType('cash', 'USDT')).toBe(false);
  });

  it('rejects a crypto currency on a share holding', () => {
    expect(isCurrencyAllowedForHoldingType('share', 'BTC')).toBe(false);
    expect(isCurrencyAllowedForHoldingType('share', 'USD')).toBe(true);
  });

  it('accepts a fiat cash holding and a crypto crypto_asset holding', () => {
    expect(isCurrencyAllowedForHoldingType('cash', 'EUR')).toBe(true);
    expect(isCurrencyAllowedForHoldingType('crypto_asset', 'BTC')).toBe(true);
  });
});
