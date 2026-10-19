import { CURATED_COIN_CODES } from '@kiko/currency/coins';
import { isCrypto, isCurrency } from '@kiko/currency/currency';

import { BINANCE_FIAT_CODES, isTrackedBinanceAsset } from './binance.tracked-coin';

describe('BINANCE_FIAT_CODES', () => {
  it('is exactly the twenty fiat codes that are quote assets of Binance', () => {
    expect([...BINANCE_FIAT_CODES].sort()).toEqual(
      [
        'UAH',
        'USD',
        'EUR',
        'GBP',
        'AED',
        'ARS',
        'AUD',
        'BRL',
        'COP',
        'CZK',
        'IDR',
        'JPY',
        'KZT',
        'MXN',
        'NGN',
        'PLN',
        'RON',
        'THB',
        'TRY',
        'ZAR',
      ].sort(),
    );
  });

  it.each([...BINANCE_FIAT_CODES])(
    '%s is a code of the app and a fiat, not a curated coin',
    (code) => {
      expect(isCurrency(code)).toBe(true);
      expect(isCrypto(code)).toBe(false);
      expect(CURATED_COIN_CODES as readonly string[]).not.toContain(code);
    },
  );
});

describe('isTrackedBinanceAsset', () => {
  it.each([...CURATED_COIN_CODES, ...BINANCE_FIAT_CODES])('tracks %s', (asset) => {
    expect(isTrackedBinanceAsset(asset)).toBe(true);
  });

  it.each([
    ['a fiat code of the app that Binance does not quote, SCR (Scroll)', 'SCR'],
    ['a fiat code of the app that Binance does not quote, MNT (Mantle)', 'MNT'],
    ['a ticker that is no code of the app', 'PEPE'],
    ['a Simple Earn receipt token', 'LDBTC'],
    ['a lower-case code', 'eur'],
    ['the empty ticker', ''],
  ])('does not track %s', (_, asset) => {
    expect(isTrackedBinanceAsset(asset)).toBe(false);
  });
});
