import { guard } from 'fnts';
import { COINGECKO_MARKET_CHART_ENDPOINT } from '@env';
import { cryptoCurrencyOptions, type CryptoCurrency } from '@kiko/currency/currency';

import { cryptoCoinGeckoId } from '../coingecko-ids';
import { type HistoryRateEntry, toUtcMidnight } from '../history-entry';

// CoinGecko's free/demo tier caps `market_chart` at ~365 days and 401s on a
// longer span, so the request is clamped to this ceiling. A multi-year account
// has no crypto history before the window; the composed series carries the
// earliest available rate backward for those older days.
const MAX_MARKET_CHART_DAYS = 365;

/**
 * One `fetchCryptoHistory` answer: every answering coin's series, plus the
 * coins whose OWN request failed — so a caller never mistakes a failed coin
 * for one CoinGecko answered with no data. `rateLimitedCurrencies` is the
 * subset of the failed coins CoinGecko answered with HTTP 429: the burst
 * limit, which the next run has to route around, unlike a coin that fails by
 * itself every time.
 */
export type CryptoHistory = {
  entries: HistoryRateEntry[];
  failedCurrencies: CryptoCurrency[];
  rateLimitedCurrencies: CryptoCurrency[];
};

/** The `market_chart` body: `prices` is a `[epochMs, price]` pair per day. */
type MarketChart = { prices: [number, number][] };

const RATE_LIMITED_STATUS = 429;

export class CoinGeckoRequestError extends Error {
  public readonly status: number;

  constructor(status: number) {
    super(`CoinGecko request failed: ${status}`);
    this.name = 'CoinGeckoRequestError';
    this.status = status;
    // A Babel/Hermes-transpiled `extends Error` loses the prototype link that `instanceof`
    // relies on unless it is restored explicitly.
    Object.setPrototypeOf(this, CoinGeckoRequestError.prototype);
  }
}

/**
 * Thrown when every requested coin failed. It still names the coins that were rate-limited,
 * because a run where the first coin fails by itself and every other one is rate-limited
 * answers nothing, and the next run has to know where the limit began.
 */
export class CryptoHistoryFailure extends Error {
  public readonly rateLimitedCurrencies: CryptoCurrency[];

  constructor(rateLimitedCurrencies: CryptoCurrency[]) {
    super('CoinGecko history request failed for every coin');
    this.name = 'CryptoHistoryFailure';
    this.rateLimitedCurrencies = rateLimitedCurrencies;
    Object.setPrototypeOf(this, CryptoHistoryFailure.prototype);
  }
}

const isRateLimited = (reason: unknown): boolean =>
  reason instanceof CoinGeckoRequestError && reason.status === RATE_LIMITED_STATUS;

const readChart = guard(
  [
    (response: Response) => !response.ok,
    (response: Response): never => {
      throw new CoinGeckoRequestError(response.status);
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
 * The most `market_chart` requests in flight at once. The free tier rate-limits a burst, and a
 * holder of many coins would otherwise open one request per coin together.
 */
export const CRYPTO_HISTORY_CONCURRENCY = 2;

/**
 * Runs the tasks through a small pool and settles each on its own, in task order, so a failed
 * task never stops the others and the result lines up with the input by index.
 */
const settleWithConcurrencyCap = async <Result>(
  tasks: readonly (() => Promise<Result>)[],
  cap: number,
): Promise<PromiseSettledResult<Result>[]> => {
  const results: PromiseSettledResult<Result>[] = [];
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (nextIndex < tasks.length) {
      const index = nextIndex;
      nextIndex += 1;

      try {
        results[index] = { status: 'fulfilled', value: await tasks[index]() };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(cap, tasks.length) }, worker));

  return results;
};

/**
 * Fetch the daily USD price series for the last `days` days for every HELD
 * crypto (`currencies`, defaulting to every supported one), one
 * `market_chart` request per coin (clamped to the free tier's 365-day
 * ceiling) — never a coin nobody holds (kiko-architecture: no request for
 * data the user does not have). Coins are settled independently: a single
 * coin's 401 drops only that coin's history, and the function throws only
 * when EVERY requested coin fails (so `runBackfill`'s outer `allSettled`
 * keeps the NBU fiat anchors when at least one coin survives); every other
 * failed coin is listed in `failedCurrencies`. Each `[ts, price]` point is
 * normalized to its UTC day (latest price wins), non-finite prices dropped,
 * entries ascending per coin. An empty `currencies` list makes no request at
 * all and resolves to no entries and no failures.
 */
export const fetchCryptoHistory = async (
  days: number,
  fetchImpl: typeof fetch = fetch,
  currencies: readonly CryptoCurrency[] = cryptoCurrencyOptions,
): Promise<CryptoHistory> => {
  if (currencies.length === 0) {
    return { entries: [], failedCurrencies: [], rateLimitedCurrencies: [] };
  }

  const results = await settleWithConcurrencyCap(
    currencies.map(
      (currency) => () =>
        fetchOneCoinHistory(currency, cryptoCoinGeckoId[currency], days, fetchImpl),
    ),
    CRYPTO_HISTORY_CONCURRENCY,
  );

  const fulfilled = results.filter(
    (r): r is PromiseFulfilledResult<HistoryRateEntry[]> => r.status === 'fulfilled',
  );

  const rateLimitedCurrencies = currencies.filter((_, index) => {
    const result = results[index];

    return result.status === 'rejected' && isRateLimited(result.reason);
  });

  if (fulfilled.length === 0) {
    throw new CryptoHistoryFailure(rateLimitedCurrencies);
  }

  return {
    entries: fulfilled.flatMap((r) => r.value),
    failedCurrencies: currencies.filter((_, index) => results[index].status === 'rejected'),
    rateLimitedCurrencies,
  };
};
