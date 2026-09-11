import { PRICE_ENDPOINT } from '@env';
import { guard } from 'fnts';

import type { RateEntry } from '../conversion';

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
  (response: Response): Promise<unknown> => response.json(),
);

// A 200 with an unexpected body is as real a failure as a 429 — CoinGecko's
// free tier returns `{}` (and sometimes an error object) under load. Reading
// `data.bitcoin.usd` off it threw a bare `TypeError` that told the caller
// nothing, and `refreshRates` turned that into "the whole sync failed".
const isCoinGeckoPrice = (value: unknown): value is CoinGeckoPrice => {
  if (typeof value !== 'object' || value === null || !('bitcoin' in value)) {
    return false;
  }

  const { bitcoin } = value as { bitcoin: unknown };

  return (
    typeof bitcoin === 'object' &&
    bitcoin !== null &&
    'usd' in bitcoin &&
    typeof (bitcoin as { usd: unknown }).usd === 'number' &&
    Number.isFinite((bitcoin as { usd: number }).usd)
  );
};

/**
 * Fetch the current BTC price in USD from CoinGecko's public simple-price
 * endpoint. Returns the BTC->USD pair; other BTC pairs are composed downstream
 * from the fiat cross rates.
 */
export const fetchBTCPrice = async (fetchImpl: typeof fetch = fetch): Promise<RateEntry[]> => {
  const response = await fetchImpl(PRICE_ENDPOINT);
  const data: unknown = await readPrice(response);

  if (!isCoinGeckoPrice(data)) {
    throw new Error('CoinGecko price response did not contain a finite bitcoin.usd value');
  }

  return [{ base: 'BTC', quote: 'USD', rate: data.bitcoin.usd, source: 'coingecko' }];
};
