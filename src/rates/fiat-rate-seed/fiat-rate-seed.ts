import type { Currency } from '../../currency/currency';
import { type RateTable, rateTableFromRows } from '../conversion';

/**
 * Fallback FX snapshot captured 2026-09-22; approximate; overridden per-pair
 * by live rates. Each value is that currency's price in ONE UAH-anchored
 * unit (`buildUahPrice`'s shape in `rates-refresh.ts`), generated from a
 * single live fetch of Monobank's public `/bank/currency` feed, applying the
 * exact same bank-BUY-price rule `monobank-rates.ts`'s `deriveRate` uses (an
 * entry carrying both `rateBuy`/`rateSell` is priced at `rateBuy`; a
 * cross-rate-only entry uses `rateCross`).
 *
 * Covers the FULL fiat set in `currencyOptions` (107 currencies, UAH
 * itself included as the `1` anchor, though `rateTableFromRows` below drops
 * UAH as a key — its own price is implicit `1`) — the live feed happened to
 * quote every one of them against UAH at capture time, so there is no
 * partial-coverage gap to flag here. FIAT ONLY, by omission: BTC/ETH/USDT
 * have no entry, so `FIAT_RATE_SEED_TABLE` below has no key for them either,
 * exactly like a live run with no fetched crypto price does — crypto
 * valuation stays a separate, live-only path (see `kiko-domain`'s "Net worth").
 */
export const FIAT_UAH_PRICE_SEED: Partial<Record<Currency, number>> = {
  UAH: 1,
  USD: 44.6,
  EUR: 51.07,
  GBP: 60.326,
  CHF: 54.8909,
  AED: 12.2541,
  // biome-ignore lint/suspicious/noApproximativeNumericConstant: OVERRIDE(real snapshot data) Monobank's live AFN rateCross happened to equal 0.693 at capture time — coincidentally close to Math.LN2, not a mistyped constant.
  AFN: 0.693,
  ALL: 0.5669,
  AMD: 0.1242,
  AOA: 0.0492,
  ARS: 0.0313,
  AUD: 32.13,
  AZN: 26.4705,
  BDT: 0.3685,
  BGN: 26.2788,
  BHD: 119.3866,
  BIF: 0.0134,
  BND: 35.0906,
  BOB: 4.0895,
  BRL: 8.825,
  BWP: 3.4827,
  BYN: 14.8887,
  CAD: 32.4406,
  CDF: 0.0157,
  CLP: 0.0468,
  CNY: 6.2793,
  COP: 0.011,
  CRC: 0.089,
  CUP: 1.8583,
  CZK: 2.1451,
  DJF: 0.2508,
  DKK: 6.8511,
  DZD: 0.3369,
  EGP: 0.9391,
  ETB: 0.3193,
  GEL: 16.5219,
  GHS: 4.4235,
  GMD: 0.6221,
  GNF: 0.0052,
  HKD: 5.7382,
  HRK: 6.7783,
  HUF: 0.1327,
  IDR: 0.0027,
  ILS: 13.6926,
  INR: 0.5054,
  IQD: 0.0342,
  ISK: 0.3592,
  JOD: 62.9302,
  JPY: 0.2872,
  KES: 0.3453,
  KGS: 0.5113,
  KHR: 0.0109,
  KRW: 0.0311,
  KWD: 145.9226,
  KZT: 0.0827,
  LAK: 0.0021,
  LBP: 0.000499,
  LKR: 0.1497,
  LYD: 9.2417,
  MAD: 4.9314,
  MDL: 2.5952,
  MGA: 0.0098,
  MKD: 0.8299,
  MNT: 0.0128,
  MUR: 1.0111,
  MWK: 0.0258,
  MXN: 2.4183,
  MYR: 10.5645,
  MZN: 0.6982,
  NAD: 2.5652,
  NGN: 0.0296,
  NIO: 1.2129,
  NOK: 4.4133,
  NPR: 0.3159,
  NZD: 25.6522,
  OMR: 115.9455,
  PEN: 12.7333,
  PHP: 0.7778,
  PKR: 0.1576,
  PLN: 12.2137,
  PYG: 0.0059,
  QAR: 12.2521,
  RON: 10.055,
  RSD: 0.4353,
  SAR: 11.8926,
  SCR: 3.2727,
  SDG: 0.0742,
  SEK: 4.6997,
  SGD: 34.5215,
  SLL: 0.002,
  SOS: 0.0781,
  SRD: 1.1867,
  SZL: 2.5652,
  THB: 1.3672,
  TJS: 4.6377,
  TND: 15.2049,
  TRY: 1.0603,
  TWD: 1.4527,
  TZS: 0.0172,
  UGX: 0.0125,
  UYU: 1.0983,
  UZS: 0.00349,
  VND: 0.0017,
  XAF: 0.0778,
  XOF: 0.0778,
  YER: 0.1776,
  ZAR: 2.5652,
};

/**
 * The seed `RateTable`, built directly from the static UAH-price snapshot
 * above through the SAME `rateTableFromRows` rule a live DB read uses — so
 * `UAH` itself (implicit 1, never a stored key) and any non-finite/non-
 * positive entry drop out identically. Computed once at module load: this is
 * pure, static data, not a live fetch.
 */
export const FIAT_RATE_SEED_TABLE: RateTable = rateTableFromRows(
  Object.entries(FIAT_UAH_PRICE_SEED).map(([currency, rate]) => ({
    base: currency as Currency,
    quote: 'UAH' as const,
    rate: String(rate),
  })),
);
