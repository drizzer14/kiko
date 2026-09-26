import { guard } from 'fnts';
import { COINGECKO_MARKET_CHART_ENDPOINT } from '@env';

import { cryptoCoinGeckoId } from '../coingecko-ids';
import { type HistoryRateEntry, toUtcMidnight } from '../history-entry';
import { cryptoCurrencyOptions, type CryptoCurrency } from '../../currency/currency';

// CoinGecko's free/demo tier caps `market_chart` at ~365 days and 401s on a
// longer span, so the request is clamped to this ceiling. A multi-year account
// has no crypto history before the window; the composed series carries the
// earliest available rate backward for those older days.
const MAX_MARKET_CHART_DAYS = 365;

/** The `market_chart` body: `prices` is a `[epochMs, price]` pair per day. */
type MarketChart = { prices: [number, number][] };

const readChart = guard(
  [
    (response: Response) => !response.ok,
    (response: Response): never => {
      throw new Error(`CoinGecko request failed: ${response.status}`);
    },
  ],
  (response: Response): Promise<MarketChart> => response.json(),
);

// No `interval` parameter: `interval=daily` is a paid-tier feature that 401s on
// the free key. Omitted, CoinGecko auto-selects the granularity (daily past ~90
// days); any finer intraday points collapse to one entry per day downstream.
const chartUrl = (id: string, days: number): string =>
  `${COINGECKO_MARKET_CHART_ENDPOINT}/${id}/market_chart?vs_currency=usd&days=${Math.min(days, MAX_MARKET_CHART_DAYS)}`;

/** Fetch and day-normalize one coin's USD series. Throws on a non-ok response. */
const fetchOneCoinHistory = async (
  currency: CryptoCurrency,
  id: string,
  days: number,
  fetchImpl: typeof fetch,
): Promise<HistoryRateEntry[]> => {
  const response = await fetchImpl(chartUrl(id, days));
  const { prices } = await readChart(response);

  const byDay = new Map<number, number>();

  for (const [ts, price] of prices) {
    if (Number.isFinite(price)) {
      byDay.set(toUtcMidnight(ts), price);
    }
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => a - b)
    .map(([day, rate]) => ({ base: currency, quote: 'USD', day, rate, source: 'coingecko' }));
};

/**
 * Fetch the daily USD price series for the last `days` days for every HELD
 * crypto (`currencies`, defaulting to every supported one), one
 * `market_chart` request per coin (clamped to the free tier's 365-day
 * ceiling) — never a coin nobody holds (kiko-architecture: no request for
 * data the user does not have). Coins are settled independently: a single
 * coin's 401 drops only that coin's history, and the function throws only
 * when EVERY requested coin fails (so `runBackfill`'s outer `allSettled`
 * keeps the NBU fiat anchors when at least one coin survives). Each
 * `[ts, price]` point is normalized to its UTC day (latest price wins),
 * non-finite prices dropped, entries ascending per coin. An empty
 * `currencies` list makes no request at all and resolves to `[]`.
 */
export const fetchCryptoHistory = async (
  days: number,
  fetchImpl: typeof fetch = fetch,
  currencies: readonly CryptoCurrency[] = cryptoCurrencyOptions,
): Promise<HistoryRateEntry[]> => {
  if (currencies.length === 0) {
    return [];
  }

  const results = await Promise.allSettled(
    currencies.map((currency) =>
      fetchOneCoinHistory(currency, cryptoCoinGeckoId[currency], days, fetchImpl),
    ),
  );

  const fulfilled = results.filter(
    (r): r is PromiseFulfilledResult<HistoryRateEntry[]> => r.status === 'fulfilled',
  );

  if (fulfilled.length === 0) {
    throw new Error('CoinGecko history request failed for every coin');
  }

  return fulfilled.flatMap((r) => r.value);
};
