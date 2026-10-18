import { guard } from 'fnts';
import { PRICE_ENDPOINT } from '@env';
import maybe, { foldMap } from 'fnts/maybe';
import { isRecord } from '@kiko/type-guards';
import { cryptoCurrencyOptions, type CryptoCurrency } from '@kiko/currency/currency';

import type { RateEntry } from '../conversion';
import { cryptoCoinGeckoId } from '../coingecko-ids';

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
// tier returns `{}` (and sometimes an error object) under load. A coin's own
// missing or non-finite `usd` leaves only that coin unpriced, so one delisted or
// renamed id never blocks the coins CoinGecko did answer.
const finiteUsdOf = (body: Record<string, unknown>, id: string): number | undefined => {
  const entry = body[id];

  return isRecord(entry) && typeof entry.usd === 'number' && Number.isFinite(entry.usd)
    ? entry.usd
    : undefined;
};

const priceUrl = (ids: readonly string[]): string =>
  `${PRICE_ENDPOINT}?ids=${ids.join(',')}&vs_currencies=usd`;

/**
 * Fetch the current USD price of every HELD crypto (`currencies`, defaulting
 * to every supported one) from CoinGecko's public simple-price endpoint —
 * never a coin nobody holds (kiko-architecture: no request for data the user
 * does not have). Returns one `<crypto>->USD` entry per requested coin
 * CoinGecko priced, and rejects only when none was; other
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

  const body = isRecord(data) ? data : {};
  const priced = currencies.flatMap(
    (base): RateEntry[] =>
      foldMap(maybe(finiteUsdOf(body, cryptoCoinGeckoId[base])), (rate) => [
        { base, quote: 'USD', rate, source: 'coingecko' },
      ]) ?? [],
  );

  if (priced.length === 0) {
    throw new Error('CoinGecko price response did not contain a finite usd value for any coin');
  }

  const pricedBases = new Set(priced.map((entry) => entry.base));
  const unpriced = currencies.filter((base) => !pricedBases.has(base));

  if (unpriced.length > 0) {
    // Codes only, no amounts: the one trace of a coin CoinGecko dropped, since the caller sees a
    // shorter list and nothing else.
    // biome-ignore lint/suspicious/noConsole: OVERRIDE(diagnostic) coins CoinGecko left unpriced
    console.warn('[coingecko] coins left unpriced', { currencies: unpriced });
  }

  return priced;
};
