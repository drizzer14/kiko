import { MONOBANK_API_ENDPOINT } from '@env';
import type { Currency } from '@kiko/currency/currency';
import { fiatCurrencyOptions } from '@kiko/currency/currency';
import { currencyFromCode } from '@kiko/monobank/currency-code';

import type { RateEntry } from '../conversion';

// The public, tokenless fiat cross-rate path on the same host
// `MONOBANK_API_ENDPOINT` names for client-info/statement requests.
const CURRENCY_ENDPOINT = `${MONOBANK_API_ENDPOINT}/bank/currency`;

/** The public `/bank/currency` payload shape. Codes are ISO 4217 numeric. */
type MonobankCurrencyRate = {
  currencyCodeA: number;
  currencyCodeB: number;
  date: number;
  rateSell?: number;
  rateBuy?: number;
  rateCross?: number;
};

// Our fiat set is DERIVED from currency.ts so it can never drift from the app's
// supported currencies. BTC is excluded automatically (it is crypto, priced via
// CoinGecko, not present in fiatCurrencyOptions).
const fiatCurrencies = new Set<Currency>(fiatCurrencyOptions);

const isFiat = (currency: Currency | undefined): currency is Currency =>
  currency !== undefined && fiatCurrencies.has(currency);

/**
 * Derive a single A->B rate from one Monobank entry.
 *
 * A foreign-currency holding is a bank ASSET, so it is valued at the bank's
 * BUY price — the rate the bank pays to buy that currency from you, i.e. your
 * realistic liquidation value. This reproduces the figure monobank shows in
 * its own app (e.g. USD->UAH at rateBuy 44.46, not the buy/sell midpoint
 * 44.6455, which would overvalue the holding). So when both sides are present
 * (USD/UAH, EUR/UAH) we take `rateBuy`; the cross rate is used only when it is
 * the sole rate the entry provides (exotic pairs with no buy/sell quote).
 */
const deriveRate = (entry: MonobankCurrencyRate): number | undefined => {
  if (entry.rateBuy !== undefined && entry.rateSell !== undefined) {
    return entry.rateBuy;
  }

  if (entry.rateCross !== undefined) {
    return entry.rateCross;
  }

  return entry.rateSell ?? entry.rateBuy;
};

const toRateEntry = (entry: MonobankCurrencyRate): RateEntry[] => {
  const base = currencyFromCode(entry.currencyCodeA);
  const quote = currencyFromCode(entry.currencyCodeB);

  if (!isFiat(base) || !isFiat(quote)) {
    return [];
  }
  const rate = deriveRate(entry);

  if (rate === undefined) {
    return [];
  }

  return [{ base, quote, rate, source: 'monobank' }];
};

/**
 * Fetch fiat cross rates from Monobank's public, tokenless `/bank/currency`
 * endpoint (cached upstream ~5 minutes). Keeps only pairs where both sides
 * map into our fiat set (derived from currency.ts's `fiatCurrencyOptions`).
 */
export const fetchFiatRates = async (fetchImpl: typeof fetch = fetch): Promise<RateEntry[]> => {
  const response = await fetchImpl(CURRENCY_ENDPOINT);

  if (!response.ok) {
    throw new Error(`Monobank currency request failed: ${response.status}`);
  }
  const raw = (await response.json()) as MonobankCurrencyRate[];

  return raw.flatMap(toRateEntry);
};
