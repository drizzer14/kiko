import { PRICE_ENDPOINT } from '@env';
import { guard } from 'fnts';

import type { RateEntry } from '../conversion';
import type { Currency } from '../../currency/currency';
import { coinGeckoIds, cryptoCoinGeckoId } from '../coingecko-ids';

/** The `/simple/price` body: one `{ usd }` object per requested coin id. */
type CoinGeckoPrices = Record<string, { usd: number }>;

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

// A 200 with an unexpected body is as real a failure as a 429 — CoinGecko's free
// tier returns `{}` (and sometimes an error object) under load. Every requested
// coin id must carry a finite `usd`, else the body is rejected with a typed error
// rather than throwing a bare TypeError downstream.
const isCoinGeckoPrices = (value: unknown): value is CoinGeckoPrices => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  for (const id of Object.values(cryptoCoinGeckoId)) {
    const entry = record[id];
    if (
      typeof entry !== 'object' ||
      entry === null ||
      !('usd' in entry) ||
      typeof (entry as { usd: unknown }).usd !== 'number' ||
      !Number.isFinite((entry as { usd: number }).usd)
    ) {
      return false;
    }
  }
  return true;
};

const priceUrl = (): string => `${PRICE_ENDPOINT}?ids=${coinGeckoIds()}&vs_currencies=usd`;

/**
 * Fetch the current USD price of every supported crypto from CoinGecko's public
 * simple-price endpoint. Returns one `<crypto>->USD` entry per coin; other crypto
 * pairs are composed downstream from the fiat cross rates (`rates-refresh.ts`).
 */
export const fetchCryptoPrices = async (fetchImpl: typeof fetch = fetch): Promise<RateEntry[]> => {
  const response = await fetchImpl(priceUrl());
  const data: unknown = await readPrice(response);

  if (!isCoinGeckoPrices(data)) {
    throw new Error('CoinGecko price response did not contain a finite usd value for every coin');
  }

  return (Object.entries(cryptoCoinGeckoId) as [Currency, string][]).map(([base, id]) => ({
    base,
    quote: 'USD',
    rate: (data as CoinGeckoPrices)[id].usd,
    source: 'coingecko',
  }));
};
