import { guard } from 'fnts';

import { type HistoryRateEntry, toUtcMidnight } from './history-entry';

/**
 * CoinGecko's `market_chart` returns a full daily price series in ONE call, so
 * the whole backfill span costs a single request (unlike the per-date NBU
 * source). Quoted in USD; other BTC pairs are composed downstream from fiat.
 */
const MARKET_CHART_ENDPOINT = 'https://api.coingecko.com/api/v3/coins/bitcoin/market_chart';

// CoinGecko's free/demo tier caps `market_chart` at ~365 days of history and
// 401s on a longer span, so the request is clamped to this ceiling. A multi-year
// account simply has no BTC history before the window; the composed series
// carries the earliest available rate backward for those older days.
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
const chartUrl = (days: number): string =>
  `${MARKET_CHART_ENDPOINT}?vs_currency=usd&days=${Math.min(days, MAX_MARKET_CHART_DAYS)}`;

/**
 * Fetch the daily BTC->USD price series for the last `days` days from CoinGecko
 * in a single request (clamped to the free tier's 365-day ceiling). Each
 * `[ts, price]` point is normalized to its UTC day; a trailing intraday point
 * that lands on the same day as the last daily point overwrites it (latest price
 * wins). Non-finite prices are dropped. Entries are returned in ascending day
 * order.
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
