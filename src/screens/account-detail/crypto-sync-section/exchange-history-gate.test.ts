import { isTrackedBybitAsset } from '@kiko/crypto-sync/bybit';
import { fiatCurrencyOptions } from '@kiko/currency/currency';
import { balanceProviderIds } from '@kiko/crypto-sync/provider';
import { isTrackedBinanceAsset } from '@kiko/crypto-sync/binance';

import { hasExchangeHistory, hasKeyLines, isTrackedAssetOf } from './binance-history-status';

describe('hasKeyLines', () => {
  it('every balance provider has a gate decision', () => {
    for (const provider of balanceProviderIds) {
      expect(typeof hasKeyLines(provider)).toBe('boolean');
    }
  });

  it.each([
    ['btc_wallet', false],
    ['binance', false],
    ['bybit', true],
  ] as const)('%s: %s', (provider, expected) => {
    expect(hasKeyLines(provider)).toBe(expected);
  });
});

describe('hasExchangeHistory', () => {
  it('every balance provider has a gate decision', () => {
    for (const provider of balanceProviderIds) {
      expect(typeof hasExchangeHistory(provider)).toBe('boolean');
    }
  });

  it.each([
    ['btc_wallet', false],
    ['binance', true],
    ['bybit', true],
  ] as const)('%s: %s', (provider, expected) => {
    expect(hasExchangeHistory(provider)).toBe(expected);
  });
});

describe('isTrackedAssetOf', () => {
  it('every balance provider has a predicate', () => {
    for (const provider of balanceProviderIds) {
      expect(typeof isTrackedAssetOf(provider)).toBe('function');
    }
  });

  it('gives Binance and Bybit each its own rule', () => {
    expect(isTrackedAssetOf('binance')).toBe(isTrackedBinanceAsset);
    expect(isTrackedAssetOf('bybit')).toBe(isTrackedBybitAsset);
  });

  it('tracks a fiat code only Binance quotes for Binance alone', () => {
    for (const code of ['UAH', 'GBP', 'JPY']) {
      expect(isTrackedAssetOf('binance')(code)).toBe(true);
      expect(isTrackedAssetOf('bybit')(code)).toBe(false);
    }
  });

  it.each(['binance', 'bybit'] as const)('%s tracks BTC and USD, and not PEPE', (provider) => {
    expect(isTrackedAssetOf(provider)('BTC')).toBe(true);
    expect(isTrackedAssetOf(provider)('USD')).toBe(true);
    expect(isTrackedAssetOf(provider)('PEPE')).toBe(false);
  });

  it('lists every fiat code of the app outside the five as not tracked for Bybit', () => {
    const outside = fiatCurrencyOptions.filter((code) => !isTrackedBybitAsset(code));

    expect(outside).toEqual(expect.arrayContaining(['GBP', 'JPY', 'UAH', 'SCR', 'MNT']));
    expect(fiatCurrencyOptions.length - outside.length).toBe(5);
  });

  it('lists no coin of a wallet as not tracked, since a wallet holds one address and no list', () => {
    expect(isTrackedAssetOf('btc_wallet')('PEPE')).toBe(true);
  });
});
