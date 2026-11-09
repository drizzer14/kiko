import { CURATED_COIN_CODES } from '@kiko/currency/coins';
import { fiatCurrencyOptions, isCrypto, isCurrency } from '@kiko/currency/currency';

import { unifiedReadOf } from './bybit.balance-read';
import { unifiedCoin } from './bybit.balance-test-fixtures';
import { BYBIT_FIAT_CODES, isTrackedBybitAsset } from './bybit.tracked-coin';

// The app's fiat codes that are quote coins of Bybit's public spot rows, read from
// `GET /v5/market/instruments-info?category=spot` on 2026-11-05 (521 rows; quotes AED, BRL, BTC,
// ETH, EUR, PLN, RLUSD, SOL, USD, USD1, USDC, USDE, USDT, XUSD).
const MEASURED_FIAT_QUOTES = ['AED', 'BRL', 'EUR', 'PLN', 'USD'];

describe('BYBIT_FIAT_CODES', () => {
  it('is exactly the five fiat codes of the app that are quote coins of Bybit spot rows', () => {
    expect([...BYBIT_FIAT_CODES].sort()).toEqual(MEASURED_FIAT_QUOTES);
  });

  it.each([...BYBIT_FIAT_CODES])(
    '%s is a code of the app and a fiat, not a curated coin',
    (code) => {
      expect(isCurrency(code)).toBe(true);
      expect(isCrypto(code)).toBe(false);
      expect(CURATED_COIN_CODES as readonly string[]).not.toContain(code);
    },
  );
});

describe('isTrackedBybitAsset', () => {
  it.each([...CURATED_COIN_CODES, ...BYBIT_FIAT_CODES])('tracks %s', (asset) => {
    expect(isTrackedBybitAsset(asset)).toBe(true);
  });

  it.each([
    ['a ticker that is no code of the app', 'PEPE'],
    ['a Simple Earn receipt token', 'LDBTC'],
    ['a lower-case code', 'eur'],
    ['the empty ticker', ''],
  ])('does not track %s', (_title, asset) => {
    expect(isTrackedBybitAsset(asset)).toBe(false);
  });

  it('SCR, MNT and UAH are not tracked as fiat', () => {
    // SCR (Scroll) and MNT (Mantle) are Bybit base coins that only equal an app fiat code, and
    // UAH is no Bybit spot quote coin.
    for (const asset of ['SCR', 'MNT', 'UAH']) {
      expect(isCurrency(asset)).toBe(true);
      expect(isTrackedBybitAsset(asset)).toBe(false);
    }
  });

  it('a fiat code outside the list lists as not tracked with no amount', () => {
    // Binance quotes GBP, JPY and others; Bybit's list is its own, not Binance's.
    const outside = fiatCurrencyOptions.filter(
      (code) => !(BYBIT_FIAT_CODES as readonly string[]).includes(code),
    );

    expect(outside).toEqual(expect.arrayContaining(['GBP', 'JPY', 'UAH', 'SCR', 'MNT']));

    for (const code of outside) {
      expect(isTrackedBybitAsset(code)).toBe(false);
    }

    // With a balance of 5 each, the read lists the code and keeps no amount for it.
    const read = unifiedReadOf(outside.map((code) => unifiedCoin(code, '5')));

    expect(read.untracked).toEqual(outside);
    expect(read.balances.size).toBe(0);
  });
});
