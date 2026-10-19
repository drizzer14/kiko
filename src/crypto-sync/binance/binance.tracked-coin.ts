import { type Currency, isCrypto, isCurrency } from '@kiko/currency/currency';

/**
 * The Kiko fiat codes that are quote assets of GET https://api.binance.com/api/v3/exchangeInfo.
 * A Binance ticker that only equals some other fiat code of the app (SCR is Scroll there, the
 * Seychelles rupee here) is a different asset, so it is not a fiat balance.
 */
export const BINANCE_FIAT_CODES = [
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
] as const satisfies readonly Currency[];

/** A history record's ticker, upper-cased once where it is read; blank when Binance sent none. */
export const binanceTickerOf = (coin: string): string => coin.trim().toUpperCase();

/** Whether a Binance ticker is a curated coin or one of the fiat codes Binance quotes. */
export const isTrackedBinanceAsset = (asset: string): asset is Currency =>
  isCurrency(asset) &&
  (isCrypto(asset) || (BINANCE_FIAT_CODES as readonly string[]).includes(asset));
