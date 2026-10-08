import { currencyOptions, fiatCurrencyOptions } from '@kiko/currency/currency';

import { holdingTypes } from '../holding-type';

import {
  holdingCurrencyOptions,
  isCurrencyAllowedForHoldingType,
  isCurrencyExpectedForHoldingType,
} from './holding-currency';

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

describe('isCurrencyExpectedForHoldingType', () => {
  it('expects a cash holding in a fiat currency only', () => {
    expect(isCurrencyExpectedForHoldingType('cash', 'UAH')).toBe(true);
    expect(isCurrencyExpectedForHoldingType('cash', 'BTC')).toBe(false);
  });

  it('expects a crypto asset in a cryptocurrency only, although a write accepts a fiat one', () => {
    expect(isCurrencyExpectedForHoldingType('crypto_asset', 'BTC')).toBe(true);
    expect(isCurrencyExpectedForHoldingType('crypto_asset', 'UAH')).toBe(false);
    expect(isCurrencyAllowedForHoldingType('crypto_asset', 'UAH')).toBe(true);
  });

  it('expects every other type in either kind of currency', () => {
    const otherTypes = holdingTypes.filter(
      (candidate) => !['cash', 'crypto_asset'].includes(candidate),
    );

    for (const type of otherTypes) {
      expect(isCurrencyExpectedForHoldingType(type, 'UAH')).toBe(true);
      expect(isCurrencyExpectedForHoldingType(type, 'BTC')).toBe(true);
    }
  });
});
