// The registry imports nothing from `currency.ts`: `currencyOptions` and the crypto maps derive
// from it, so a back-edge here would make the derivation circular.

/** In curation order: market-cap rank, with the named stablecoins and the held coin slotted in. */
export const CURATED_COIN_CODES = [
  'BTC',
  'ETH',
  'USDT',
  'BNB',
  'XRP',
  'USDC',
  'SOL',
  'TRX',
  'ZEC',
  'HYPE',
  'DOGE',
  'LINK',
  'ADA',
  'NEAR',
  'XLM',
  'BCH',
  'LTC',
  'UNI',
  'DAI',
  'AVAX',
  'SUI',
  'FDUSD',
  'CGPT',
] as const;

export type CuratedCoinCode = (typeof CURATED_COIN_CODES)[number];

/** A coin whose formula gives a smaller scale is not tracked, so it never enters the registry. */
export const MIN_COIN_SCALE = 2;

const MAX_COIN_SCALE = 8;

export type CoinEntry = {
  code: CuratedCoinCode;
  /** Decimals stored, from `coinScale`. */
  scale: number;
  /** The exchange's `baseAssetPrecision` on the curation day. */
  baseAssetPrecision: number;
  /** True when `scale` is below `baseAssetPrecision`, derived, never hand-written. */
  reducedScale: boolean;
  symbol: string;
  coinGeckoId: string;
  /** The Binance spot symbol against USDT; absent for USDT, which has no USDT pair. */
  binanceSymbol?: string;
  /** A decimal string; a balance under it creates no new holding. */
  dustBelow: string;
  /** The largest plausible balance in whole coins. */
  maxUnits: number;
};

/**
 * The decimals a coin stores: its exchange precision, capped at 8 and at the most that still fits
 * `maxUnits` whole coins in a safe integer.
 */
export const coinScale = (entry: { baseAssetPrecision: number; maxUnits: number }): number =>
  Math.min(
    MAX_COIN_SCALE,
    entry.baseAssetPrecision,
    Math.floor(Math.log10(Number.MAX_SAFE_INTEGER / entry.maxUnits)),
  );

type CoinInput = Pick<CoinEntry, 'coinGeckoId' | 'dustBelow' | 'maxUnits'> &
  Partial<Pick<CoinEntry, 'binanceSymbol' | 'symbol'>> & { baseAssetPrecision: number };

// USDT has no USDT pair to read a precision from; 8 is the scale it is stored at, so the formula
// and `reducedScale` derive the same way as for every other coin.
const COIN_INPUTS: Record<CuratedCoinCode, CoinInput> = {
  BTC: {
    symbol: '₿',
    coinGeckoId: 'bitcoin',
    binanceSymbol: 'BTCUSDT',
    baseAssetPrecision: 8,
    dustBelow: '0.00001',
    maxUnits: 21_000_000,
  },
  ETH: {
    symbol: 'Ξ',
    coinGeckoId: 'ethereum',
    binanceSymbol: 'ETHUSDT',
    baseAssetPrecision: 8,
    dustBelow: '0.0004',
    maxUnits: 90_000_000,
  },
  USDT: {
    symbol: '₮',
    coinGeckoId: 'tether',
    baseAssetPrecision: 8,
    dustBelow: '1',
    maxUnits: 90_000_000,
  },
  BNB: {
    coinGeckoId: 'binancecoin',
    binanceSymbol: 'BNBUSDT',
    baseAssetPrecision: 8,
    dustBelow: '0.001',
    maxUnits: 200_000_000,
  },
  XRP: {
    coinGeckoId: 'ripple',
    binanceSymbol: 'XRPUSDT',
    baseAssetPrecision: 8,
    dustBelow: '1',
    maxUnits: 100_000_000_000,
  },
  USDC: {
    coinGeckoId: 'usd-coin',
    binanceSymbol: 'USDCUSDT',
    baseAssetPrecision: 8,
    dustBelow: '1',
    maxUnits: 90_000_000,
  },
  SOL: {
    coinGeckoId: 'solana',
    binanceSymbol: 'SOLUSDT',
    baseAssetPrecision: 8,
    dustBelow: '0.01',
    maxUnits: 1_000_000_000,
  },
  TRX: {
    coinGeckoId: 'tron',
    binanceSymbol: 'TRXUSDT',
    baseAssetPrecision: 8,
    dustBelow: '3',
    maxUnits: 100_000_000_000,
  },
  ZEC: {
    coinGeckoId: 'zcash',
    binanceSymbol: 'ZECUSDT',
    baseAssetPrecision: 8,
    dustBelow: '0.0008',
    maxUnits: 21_000_000,
  },
  HYPE: {
    coinGeckoId: 'hyperliquid',
    binanceSymbol: 'HYPEUSDT',
    baseAssetPrecision: 8,
    dustBelow: '0.01',
    maxUnits: 1_000_000_000,
  },
  DOGE: {
    coinGeckoId: 'dogecoin',
    binanceSymbol: 'DOGEUSDT',
    baseAssetPrecision: 8,
    dustBelow: '12',
    maxUnits: 200_000_000_000,
  },
  LINK: {
    coinGeckoId: 'chainlink',
    binanceSymbol: 'LINKUSDT',
    baseAssetPrecision: 8,
    dustBelow: '0.08',
    maxUnits: 1_000_000_000,
  },
  ADA: {
    coinGeckoId: 'cardano',
    binanceSymbol: 'ADAUSDT',
    baseAssetPrecision: 8,
    dustBelow: '4',
    maxUnits: 45_000_000_000,
  },
  NEAR: {
    coinGeckoId: 'near',
    binanceSymbol: 'NEARUSDT',
    baseAssetPrecision: 8,
    dustBelow: '0.2',
    maxUnits: 2_000_000_000,
  },
  XLM: {
    coinGeckoId: 'stellar',
    binanceSymbol: 'XLMUSDT',
    baseAssetPrecision: 8,
    dustBelow: '5',
    maxUnits: 100_000_000_000,
  },
  BCH: {
    coinGeckoId: 'bitcoin-cash',
    binanceSymbol: 'BCHUSDT',
    baseAssetPrecision: 8,
    dustBelow: '0.004',
    maxUnits: 21_000_000,
  },
  LTC: {
    coinGeckoId: 'litecoin',
    binanceSymbol: 'LTCUSDT',
    baseAssetPrecision: 8,
    dustBelow: '0.016',
    maxUnits: 84_000_000,
  },
  UNI: {
    coinGeckoId: 'uniswap',
    binanceSymbol: 'UNIUSDT',
    baseAssetPrecision: 8,
    dustBelow: '0.13',
    maxUnits: 1_000_000_000,
  },
  // DAIUSDT is not trading on Binance, so this symbol is an inert price fallback; the price comes
  // from CoinGecko.
  DAI: {
    coinGeckoId: 'dai',
    binanceSymbol: 'DAIUSDT',
    baseAssetPrecision: 8,
    dustBelow: '1',
    maxUnits: 90_000_000,
  },
  AVAX: {
    coinGeckoId: 'avalanche-2',
    binanceSymbol: 'AVAXUSDT',
    baseAssetPrecision: 8,
    dustBelow: '0.1',
    maxUnits: 720_000_000,
  },
  SUI: {
    coinGeckoId: 'sui',
    binanceSymbol: 'SUIUSDT',
    baseAssetPrecision: 8,
    dustBelow: '1',
    maxUnits: 10_000_000_000,
  },
  FDUSD: {
    coinGeckoId: 'first-digital-usd',
    binanceSymbol: 'FDUSDUSDT',
    baseAssetPrecision: 8,
    dustBelow: '1',
    maxUnits: 90_000_000,
  },
  CGPT: {
    coinGeckoId: 'chaingpt',
    binanceSymbol: 'CGPTUSDT',
    baseAssetPrecision: 8,
    dustBelow: '40',
    maxUnits: 1_000_000_000,
  },
};

const entryOf = (code: CuratedCoinCode): CoinEntry => {
  const input = COIN_INPUTS[code];
  const scale = coinScale(input);

  return {
    ...input,
    code,
    symbol: input.symbol ?? code,
    scale,
    reducedScale: scale < input.baseAssetPrecision,
  };
};

// `Object.fromEntries` widens its result to `Record<string, Value>`; the object built here is a
// `Record<CuratedCoinCode, Value>` because `CURATED_COIN_CODES` lists every code once.
const recordByCode = <Value>(valueForCode: (code: CuratedCoinCode) => Value) =>
  Object.fromEntries(CURATED_COIN_CODES.map((code) => [code, valueForCode(code)])) as Record<
    CuratedCoinCode,
    Value
  >;

export const curatedCoins: Readonly<Record<CuratedCoinCode, CoinEntry>> = recordByCode(entryOf);

/** One field of every registry entry, keyed by code: the shape a per-currency map spreads in. */
export const recordByCoin = <Value>(
  select: (entry: CoinEntry) => Value,
): Record<CuratedCoinCode, Value> => recordByCode((code) => select(curatedCoins[code]));
