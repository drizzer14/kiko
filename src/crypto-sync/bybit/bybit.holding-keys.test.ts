import { CURATED_COIN_CODES } from '@kiko/currency/coins';

import {
  bybitKeyOf,
  coinHoldingName,
  holdingKeyOf,
  partsOfHoldingKey,
  walletLabelOf,
} from './bybit.holding-keys';
import { BYBIT_FIAT_CODES } from './bybit.tracked-coin';

describe('holdingKeyOf', () => {
  it('writes <COIN>:<wallet> for each wallet, BTC too', () => {
    expect(holdingKeyOf('BTC', 'unified')).toBe('BTC:unified');
    expect(holdingKeyOf('BTC', 'fund')).toBe('BTC:fund');
    expect(holdingKeyOf('USDT', 'unified')).toBe('USDT:unified');
  });
});

describe('partsOfHoldingKey', () => {
  it.each([...CURATED_COIN_CODES, ...BYBIT_FIAT_CODES])(
    'reads back the coin and the wallet of every key of %s',
    (code) => {
      for (const wallet of ['unified', 'fund'] as const) {
        expect(partsOfHoldingKey(holdingKeyOf(code, wallet))).toEqual({ code, wallet });
      }
    },
  );

  it.each([
    ['a bare coin, which is a Binance Spot key', 'BTC'],
    ['a key with no coin', ':unified'],
    ['a wallet alone', 'unified'],
    ['a wallet Bybit does not have', 'BTC:spot'],
    ['an Earn key, which no sync writes', 'BTC:earn'],
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

describe('bybitKeyOf', () => {
  it('reads the key stored under metadata.bybitAsset', () => {
    const metadata = { bybitAsset: 'BTC:unified', syncedAt: 0 };

    expect(bybitKeyOf({ metadata })).toBe('BTC:unified');
  });

  it.each([
    ['no metadata', null],
    ['a Binance key', { binanceAsset: 'BTC' }],
    ['a key that is no text', { bybitAsset: 5 }],
    ['metadata that is no record', 'BTC:unified'],
  ])('reads no key from %s', (_title, metadata) => {
    expect(bybitKeyOf({ metadata })).toBeUndefined();
  });
});

describe('walletLabelOf', () => {
  it.each([
    ['unified', 'Unified'],
    ['fund', 'Funding'],
  ])('names the wallet key "%s" as "%s", the name its holdings carry', (wallet, label) => {
    expect(walletLabelOf(wallet)).toBe(label);
  });

  it('reads a key no wallet owns as itself', () => {
    expect(walletLabelOf('margin')).toBe('margin');
    expect(walletLabelOf('earn')).toBe('earn');
  });
});

describe('coinHoldingName', () => {
  it.each([
    ['unified', 'Bybit Unified · USDT'],
    ['fund', 'Bybit Funding · USDT'],
  ] as const)('names the %s holding of a coin "%s"', (wallet, name) => {
    expect(coinHoldingName('USDT', wallet)).toBe(name);
  });
});
