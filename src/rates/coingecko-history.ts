import { guard } from 'fnts';

import { type HistoryRateEntry, toUtcMidnight } from './history-entry';

/**
 * CoinGecko's `market_chart` returns a full daily price series in ONE call, so
 * the whole backfill span costs a single request (unlike the per-date NBU
 * source). Quoted in USD; other BTC pairs are composed downstream from fiat.
 */
const MARKET_CHART_ENDPOINT = 'https://api.coingecko.com/api/v3/coins/bitcoin/market_chart';

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

const chartUrl = (days: number): string =>
  `${MARKET_CHART_ENDPOINT}?vs_currency=usd&days=${days}&interval=daily`;

/**
 * Fetch the daily BTC->USD price series for the last `days` days from CoinGecko
 * in a single request. Each `[ts, price]` point is normalized to its UTC day;
 * a trailing intraday point that lands on the same day as the last daily point
 * overwrites it (latest price wins). Non-finite prices are dropped. Entries are
 * returned in ascending day order.
 */
export const fetchBTCHistory = async (
  days: number,
  fetchImpl: typeof fetch = fetch,
): Promise<HistoryRateEntry[]> => {
  const response = await fetchImpl(chartUrl(days));
  const { prices } = await readChart(response);

  const byDay = new Map<number, number>();
  for (const [ts, price] of prices) {
    if (Number.isFinite(price)) {
      byDay.set(toUtcMidnight(ts), price);
    }
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => a - b)
    .map(([day, rate]) => ({ base: 'BTC', quote: 'USD', day, rate, source: 'coingecko' }));
};
