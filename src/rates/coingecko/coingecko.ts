import { guard } from 'fnts';
import { PRICE_ENDPOINT } from '@env';

import type { RateEntry } from '../conversion';
import { cryptoCoinGeckoId } from '../coingecko-ids';
import { cryptoCurrencyOptions, type CryptoCurrency } from '../../currency/currency';

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
// tier returns `{}` (and sometimes an error object) under load. Every REQUESTED
// coin id must carry a finite `usd`, else the body is rejected with a typed error
// rather than throwing a bare TypeError downstream — never the full supported
// set: a scoped request (see `currencies` below) never needed a coin outside it.
const isCoinGeckoPrices = (value: unknown, ids: readonly string[]): value is CoinGeckoPrices => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;

  for (const id of ids) {
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

const priceUrl = (ids: readonly string[]): string =>
  `${PRICE_ENDPOINT}?ids=${ids.join(',')}&vs_currencies=usd`;

/**
 * Fetch the current USD price of every HELD crypto (`currencies`, defaulting
 * to every supported one) from CoinGecko's public simple-price endpoint —
 * never a coin nobody holds (kiko-architecture: no request for data the user
 * does not have). Returns one `<crypto>->USD` entry per requested coin; other
 * crypto pairs are composed downstream from the fiat cross rates
 * (`rates-refresh.ts`). An empty `currencies` list makes no request at all
 * and resolves to `[]`.
 */
export const fetchCryptoPrices = async (
  fetchImpl: typeof fetch = fetch,
  currencies: readonly CryptoCurrency[] = cryptoCurrencyOptions,
): Promise<RateEntry[]> => {
  if (currencies.length === 0) {
    return [];
  }

  const ids = currencies.map((currency) => cryptoCoinGeckoId[currency]);
  const response = await fetchImpl(priceUrl(ids));
  const data: unknown = await readPrice(response);

  if (!isCoinGeckoPrices(data, ids)) {
    throw new Error('CoinGecko price response did not contain a finite usd value for every coin');
  }

  return currencies.map((base) => ({
    base,
    quote: 'USD',
    rate: (data as CoinGeckoPrices)[cryptoCoinGeckoId[base]].usd,
    source: 'coingecko',
  }));
};
