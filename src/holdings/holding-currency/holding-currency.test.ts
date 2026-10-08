import { currencyOptions, fiatCurrencyOptions } from '@kiko/currency/currency';

import { holdingTypes } from '../holding-type';

import { holdingCurrencyOptions, isCurrencyAllowedForHoldingType } from './holding-currency';

describe('holdingCurrencyOptions', () => {
  it('offers a cash holding fiat currencies only', () => {
    expect(holdingCurrencyOptions('cash')).toEqual(fiatCurrencyOptions);
    expect(holdingCurrencyOptions('cash')).not.toContain('BTC');
  });

  it('offers every other holding type the full currency set', () => {
    for (const type of holdingTypes.filter((candidate) => candidate !== 'cash')) {
      expect(holdingCurrencyOptions(type)).toEqual(currencyOptions);
    }
  });
});

describe('isCurrencyAllowedForHoldingType', () => {
  it('rejects a crypto currency on a cash holding', () => {
    expect(isCurrencyAllowedForHoldingType('cash', 'BTC')).toBe(false);
    expect(isCurrencyAllowedForHoldingType('cash', 'USDT')).toBe(false);
  });

  it('accepts a fiat cash holding and a crypto crypto_asset holding', () => {
    expect(isCurrencyAllowedForHoldingType('cash', 'EUR')).toBe(true);
    expect(isCurrencyAllowedForHoldingType('crypto_asset', 'BTC')).toBe(true);
  });
});
