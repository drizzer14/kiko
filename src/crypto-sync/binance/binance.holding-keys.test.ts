import {
  coinHoldingName,
  EARN_KEY,
  FUNDING_KEY,
  holdingKeyOf,
  partsOfHoldingKey,
  SPOT_KEY,
} from './binance.holding-keys';

describe('holdingKeyOf', () => {
  it('keeps the three BTC keys byte for byte', () => {
    expect(holdingKeyOf('BTC', 'spot')).toBe(SPOT_KEY);
    expect(holdingKeyOf('BTC', 'funding')).toBe(FUNDING_KEY);
    expect(holdingKeyOf('BTC', 'earn')).toBe(EARN_KEY);
    expect([SPOT_KEY, FUNDING_KEY, EARN_KEY]).toEqual(['BTC', 'BTC:funding', 'BTC:earn']);
  });

  it('keys any other coin or fiat as <CODE>, <CODE>:funding and <CODE>:earn', () => {
    expect(holdingKeyOf('USDT', 'spot')).toBe('USDT');
    expect(holdingKeyOf('USDT', 'funding')).toBe('USDT:funding');
    expect(holdingKeyOf('EUR', 'earn')).toBe('EUR:earn');
  });

  it('never gives two (coin, wallet) pairs one key', () => {
    const coins = ['BTC', 'ETH', 'USDT', 'EUR'] as const;
    const wallets = ['spot', 'funding', 'earn'] as const;
    const keys = coins.flatMap((coin) => wallets.map((wallet) => holdingKeyOf(coin, wallet)));

    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('partsOfHoldingKey', () => {
  it.each([
    ['BTC', { code: 'BTC', wallet: 'spot' }],
    ['BTC:funding', { code: 'BTC', wallet: 'funding' }],
    ['BTC:earn', { code: 'BTC', wallet: 'earn' }],
    ['USDT', { code: 'USDT', wallet: 'spot' }],
    ['USDT:earn', { code: 'USDT', wallet: 'earn' }],
    ['EUR:funding', { code: 'EUR', wallet: 'funding' }],
  ])('reads the coin and the wallet of %s', (key, parts) => {
    expect(partsOfHoldingKey(key)).toEqual(parts);
  });

  it('reads back every key holdingKeyOf makes', () => {
    const wallets = ['spot', 'funding', 'earn'] as const;

    for (const code of ['BTC', 'ETH', 'USDT', 'EUR'] as const) {
      for (const wallet of wallets) {
        expect(partsOfHoldingKey(holdingKeyOf(code, wallet))).toEqual({ code, wallet });
      }
    }
  });

  it.each([
    ['a ticker that is no coin of the app', 'PEPE'],
    ['a wallet suffix on such a ticker', 'PEPE:funding'],
    ['a fiat code of the app that Binance does not quote', 'SCR:funding'],
    ['a Simple Earn receipt token', 'LDBTC'],
    ['a suffix that names no wallet', 'BTC:flexible'],
    ['an extra part', 'BTC:funding:x'],
    ['the empty key', ''],
  ])('reads nothing from %s', (_, key) => {
    expect(partsOfHoldingKey(key)).toBeUndefined();
  });
});

describe('coinHoldingName', () => {
  it('names a holding "Binance <Wallet> · <CODE>"', () => {
    expect(coinHoldingName('USDT', 'spot')).toBe('Binance Spot · USDT');
    expect(coinHoldingName('EUR', 'funding')).toBe('Binance Funding · EUR');
    expect(coinHoldingName('ETH', 'earn')).toBe('Binance Earn · ETH');
  });
});
