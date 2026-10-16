import type { Currency } from '@kiko/currency/currency';

import { type HoldingType, holdingTypes } from '../holding-type';

import {
  isCryptoHoldingType,
  isCurrencyAllowedForHoldingType,
  isCurrencyExpectedForHoldingType,
} from './holding-currency';

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

describe('isCryptoHoldingType', () => {
  it('is true for a crypto asset alone', () => {
    expect(holdingTypes.filter(isCryptoHoldingType)).toEqual(['crypto_asset']);
  });

  it('is the type whose expected currency is never a fiat one', () => {
    for (const type of holdingTypes) {
      expect(isCryptoHoldingType(type)).toBe(!isCurrencyExpectedForHoldingType(type, 'UAH'));
    }
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

  it.each(
    holdingTypes.flatMap((type): [HoldingType, Currency, boolean][] => [
      [type, 'UAH', type !== 'crypto_asset'],
      [type, 'BTC', type === 'crypto_asset'],
    ]),
  )('%s in %s is expected: %s', (type, currency, expected) => {
    expect(isCurrencyExpectedForHoldingType(type, currency)).toBe(expected);
  });

  it.each(holdingTypes.filter((type) => type !== 'cash'))(
    'still lets a write put %s in either kind of currency',
    (type) => {
      expect(isCurrencyAllowedForHoldingType(type, 'UAH')).toBe(true);
      expect(isCurrencyAllowedForHoldingType(type, 'BTC')).toBe(true);
    },
  );
});
