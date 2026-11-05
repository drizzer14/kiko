import { CURATED_COIN_CODES } from '@kiko/currency/coins';

import { BYBIT_FIAT_CODES } from './bybit.tracked-coin';
import { coinHoldingName, holdingKeyOf, partsOfHoldingKey } from './bybit.holding-keys';

describe('holdingKeyOf', () => {
  it('writes <COIN>:<wallet> for each wallet, BTC too', () => {
    expect(holdingKeyOf('BTC', 'unified')).toBe('BTC:unified');
    expect(holdingKeyOf('BTC', 'fund')).toBe('BTC:fund');
    expect(holdingKeyOf('BTC', 'earn')).toBe('BTC:earn');
    expect(holdingKeyOf('USDT', 'unified')).toBe('USDT:unified');
  });
});

describe('partsOfHoldingKey', () => {
  it.each([...CURATED_COIN_CODES, ...BYBIT_FIAT_CODES])(
    'reads back the coin and the wallet of every key of %s',
    (code) => {
      for (const wallet of ['unified', 'fund', 'earn'] as const) {
        expect(partsOfHoldingKey(holdingKeyOf(code, wallet))).toEqual({ code, wallet });
      }
    },
  );

  it.each([
    ['a bare coin, which is a Binance Spot key', 'BTC'],
    ['a key with no coin', ':unified'],
    ['a wallet alone', 'unified'],
    ['a wallet Bybit does not have', 'BTC:spot'],
    ['a Binance wallet suffix', 'BTC:funding'],
    ['a key with a third part', 'BTC:unified:extra'],
    ['a coin the app does not track', 'PEPE:unified'],
    ['a fiat code outside the list', 'GBP:unified'],
    ['a lower-case coin', 'btc:unified'],
    ['the empty key', ''],
  ])('names no coin and wallet for %s', (_title, key) => {
    expect(partsOfHoldingKey(key)).toBeUndefined();
  });
});

describe('coinHoldingName', () => {
  it.each([
    ['unified', 'Bybit Unified · USDT'],
    ['fund', 'Bybit Funding · USDT'],
    ['earn', 'Bybit Earn · USDT'],
  ] as const)('names the %s holding of a coin "%s"', (wallet, name) => {
    expect(coinHoldingName('USDT', wallet)).toBe(name);
  });
});
