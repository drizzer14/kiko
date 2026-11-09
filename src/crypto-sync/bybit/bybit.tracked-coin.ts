import { type Currency, isCrypto, isCurrency } from '@kiko/currency/currency';

/**
 * The Kiko fiat codes that are quote coins of GET https://api.bybit.com/v5/market/instruments-info
 * with `category=spot`, read again on 2026-11-05 (521 rows). A Bybit ticker that only equals some
 * other fiat code of the app is a different asset (SCR is Scroll there, the Seychelles rupee here;
 * MNT is Mantle, the Mongolian tugrik here), so it is not a fiat balance. UAH is no Bybit quote
 * coin. Whether a wallet can hold another fiat is unverified: such a coin lists as not tracked,
 * which is a short total with a visible line, where a list of the fiat codes to leave out could
 * price a new coin as fiat.
 */
export const BYBIT_FIAT_CODES = [
  'USD',
  'EUR',
  'AED',
  'BRL',
  'PLN',
] as const satisfies readonly Currency[];

/** Whether a Bybit ticker is a curated coin or one of the fiat codes Bybit quotes. */
export const isTrackedBybitAsset = (asset: string): asset is Currency =>
  isCurrency(asset) && (isCrypto(asset) || (BYBIT_FIAT_CODES as readonly string[]).includes(asset));
