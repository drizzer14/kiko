import { bifoldMap } from 'fnts/either';

import { decimalToMinorUnits } from '../decimal';

import { type CoinEntry, MIN_COIN_SCALE, CURATED_COIN_CODES, coinScale, curatedCoins } from '.';

const entries = Object.values(curatedCoins).map((entry: CoinEntry) => [entry.code, entry] as const);

const STABLECOINS = ['USDT', 'USDC', 'FDUSD', 'DAI'] as const;

const CURATED_SCALES = [
  ['BTC', 8],
  ['ETH', 8],
  ['USDT', 8],
  ['BNB', 7],
  ['XRP', 4],
  ['USDC', 8],
  ['SOL', 6],
  ['TRX', 4],
  ['ZEC', 8],
  ['HYPE', 6],
  ['DOGE', 4],
  ['LINK', 6],
  ['ADA', 5],
  ['NEAR', 6],
  ['XLM', 4],
  ['BCH', 8],
  ['LTC', 8],
  ['UNI', 6],
  ['DAI', 8],
  ['AVAX', 7],
  ['SUI', 5],
  ['FDUSD', 8],
  ['CGPT', 6],
] as const;

const COINGECKO_IDS = [
  ['BTC', 'bitcoin'],
  ['ETH', 'ethereum'],
  ['USDT', 'tether'],
  ['BNB', 'binancecoin'],
  ['XRP', 'ripple'],
  ['USDC', 'usd-coin'],
  ['SOL', 'solana'],
  ['TRX', 'tron'],
  ['ZEC', 'zcash'],
  ['HYPE', 'hyperliquid'],
  ['DOGE', 'dogecoin'],
  ['LINK', 'chainlink'],
  ['ADA', 'cardano'],
  ['NEAR', 'near'],
  ['XLM', 'stellar'],
  ['BCH', 'bitcoin-cash'],
  ['LTC', 'litecoin'],
  ['UNI', 'uniswap'],
  ['DAI', 'dai'],
  ['AVAX', 'avalanche-2'],
  ['SUI', 'sui'],
  ['FDUSD', 'first-digital-usd'],
  ['CGPT', 'chaingpt'],
] as const;

describe('coinScale', () => {
  it('derives scale 8 for a stablecoin', () => {
    expect(coinScale({ baseAssetPrecision: 8, maxUnits: 90_000_000 })).toBe(8);
  });

  it('reduces scale for a huge supply', () => {
    const scale = coinScale({ baseAssetPrecision: 8, maxUnits: 10 ** 12 });

    expect(scale).toBe(3);
    expect(scale).toBeLessThan(8);
    expect(
      bifoldMap(
        decimalToMinorUnits('1.23456789', scale, 'half-away-from-zero'),
        () => undefined,
        (units) => units,
      ),
    ).toBe(1235);
  });

  it('keeps a coin under the minimum scale off the registry', () => {
    expect(coinScale({ baseAssetPrecision: 8, maxUnits: 10 ** 15 })).toBe(0);
    expect(coinScale({ baseAssetPrecision: 8, maxUnits: 10 ** 15 })).toBeLessThan(MIN_COIN_SCALE);
    expect(Object.keys(curatedCoins)).not.toContain('SHIB');
  });

  it('keeps the exchange precision when smaller', () => {
    const scale = coinScale({ baseAssetPrecision: 6, maxUnits: 10 ** 6 });

    expect(scale).toBe(6);
    expect(
      bifoldMap(
        decimalToMinorUnits('0.1234567', scale, 'exact'),
        (error) => error,
        () => undefined,
      ),
    ).toBe('amount-precision');
  });

  it('keeps BTC and ETH at scale 8', () => {
    expect(curatedCoins.BTC).toMatchObject({ scale: 8, maxUnits: 21_000_000, reducedScale: false });
    expect(curatedCoins.ETH).toMatchObject({ scale: 8, maxUnits: 90_000_000, reducedScale: false });
  });

  it('marks a coin whose supply cuts its scale as reduced', () => {
    expect(curatedCoins.XRP).toMatchObject({ scale: 4, baseAssetPrecision: 8, reducedScale: true });
  });
});

describe('curatedCoins', () => {
  it('is keyed by the curated codes, in order', () => {
    expect(Object.keys(curatedCoins)).toEqual([...CURATED_COIN_CODES]);
  });

  it('gives every coin a unique CoinGecko id', () => {
    const ids = Object.values(curatedCoins).map((entry) => entry.coinGeckoId);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(COINGECKO_IDS)('maps %s to the CoinGecko id %s', (code, coinGeckoId) => {
    expect(curatedCoins[code].coinGeckoId).toBe(coinGeckoId);
  });

  it('puts the four stablecoins at 90,000,000 units', () => {
    for (const code of STABLECOINS) {
      expect(curatedCoins[code].maxUnits).toBe(90_000_000);
    }
  });

  it.each(CURATED_SCALES)('stores %s at scale %i', (code, scale) => {
    expect(curatedCoins[code].scale).toBe(scale);
  });

  it.each(entries)('%s sits under its own key', (code, entry) => {
    expect(curatedCoins[code]).toBe(entry);
  });

  it.each(entries)('%s has the scale its formula gives', (_code, entry) => {
    expect(entry.scale).toBe(coinScale(entry));
  });

  it.each(entries)('%s has at least the minimum scale', (_code, entry) => {
    expect(entry.scale).toBeGreaterThanOrEqual(MIN_COIN_SCALE);
  });

  it.each(entries)('%s fits its largest balance in a safe integer', (_code, entry) => {
    expect(entry.maxUnits * 10 ** entry.scale).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
  });

  it.each(entries)('%s is reduced only below the exchange precision', (_code, entry) => {
    expect(entry.reducedScale).toBe(entry.scale < entry.baseAssetPrecision);
  });

  it.each(entries)('%s has a USDT spot symbol, except USDT itself', (code, entry) => {
    expect(entry.binanceSymbol).toBe(code === 'USDT' ? undefined : `${code}USDT`);
  });

  it.each(entries)('%s has a dust threshold that is positive at its scale', (_code, entry) => {
    expect(
      bifoldMap(
        decimalToMinorUnits(entry.dustBelow, entry.scale, 'exact'),
        () => 0,
        (units) => units,
      ),
    ).toBeGreaterThan(0);
  });
});
