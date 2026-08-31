import { PRICE_ENDPOINT } from '@env';
import { guard } from 'fnts';

import type { RateEntry } from './conversion';

/** The `/simple/price` payload shape for a single id/vs-currency pair. */
type CoinGeckoPrice = { bitcoin: { usd: number } };

/**
 * Read a CoinGecko simple-price body, or throw on a non-ok response. The
 * ok-check is a `guard` validator/executor pair rather than an imperative
 * `if (!ok) throw`, matching the Monobank client for consistency.
 */
const readPrice = guard(
  [
    (response: Response) => !response.ok,
    (response: Response): never => {
      throw new Error(`CoinGecko request failed: ${response.status}`);
    },
  ],
  (response: Response): Promise<CoinGeckoPrice> => response.json(),
);

/**
 * Fetch the current BTC price in USD from CoinGecko's public simple-price
 * endpoint. Returns the BTC->USD pair; other BTC pairs are composed downstream
 * from the fiat cross rates.
 */
export const fetchBTCPrice = async (fetchImpl: typeof fetch = fetch): Promise<RateEntry[]> => {
  const response = await fetchImpl(PRICE_ENDPOINT);
  const data = await readPrice(response);

  return [{ base: 'BTC', quote: 'USD', rate: data.bitcoin.usd, source: 'coingecko' }];
};
