import {
  coinHoldingName,
  EARN_KEY,
  FUNDING_KEY,
  holdingKeyOf,
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

describe('coinHoldingName', () => {
  it('names a holding "Binance <Wallet> · <CODE>"', () => {
    expect(coinHoldingName('USDT', 'spot')).toBe('Binance Spot · USDT');
    expect(coinHoldingName('EUR', 'funding')).toBe('Binance Funding · EUR');
    expect(coinHoldingName('ETH', 'earn')).toBe('Binance Earn · ETH');
  });
});
