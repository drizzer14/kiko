import maybe, { foldMap } from 'fnts/maybe';
import either, { bifoldr } from 'fnts/either';
import type { CryptoCurrency, Currency } from '@kiko/currency/currency';

import {
  type BinanceMarketClient,
  createBinanceMarketClient,
  fetchFallbackHistory,
} from '../binance-market';
import type { NbuHistory } from '../nbu-history';
import { type CryptoHistory, CryptoHistoryFailure } from '../coingecko-history';
import { type HistoryRateEntry, groupTimelines, nearestAtOrBefore } from '../history-entry';

/** The coins CoinGecko gave nothing for: a failed request, or an answer with no entry. */
const unansweredCoins = (
  requested: CryptoCurrency[],
  cryptoResult: PromiseSettledResult<CryptoHistory>,
): CryptoCurrency[] => {
  if (cryptoResult.status === 'rejected') {
    return requested;
  }
  const { entries, failedCurrencies } = cryptoResult.value;

  return requested.filter(
    (coin) => failedCurrencies.includes(coin) || !entries.some((entry) => entry.base === coin),
  );
};

/** The leg's own answer with the coins Binance priced added, and taken out of its failures. */
const withPricedCoins = (
  cryptoResult: PromiseSettledResult<CryptoHistory>,
  requested: CryptoCurrency[],
  fallbackEntries: HistoryRateEntry[],
  requestedStart: number,
): PromiseSettledResult<CryptoHistory> => {
  const priced = new Set(fallbackEntries.map((entry) => entry.base));
  const before: CryptoHistory =
    cryptoResult.status === 'fulfilled'
      ? cryptoResult.value
      : {
          entries: [],
          failedCurrencies: requested,
          rateLimitedCurrencies:
            cryptoResult.reason instanceof CryptoHistoryFailure
              ? cryptoResult.reason.rateLimitedCurrencies
              : [],
        };

  const reachesStart = new Set(
    fallbackEntries.filter((entry) => entry.day <= requestedStart).map((entry) => entry.base),
  );

  return {
    status: 'fulfilled',
    value: {
      entries: [...before.entries, ...fallbackEntries],
      failedCurrencies: before.failedCurrencies.filter((coin) => !priced.has(coin)),
      // Only Binance's days from the requested start leave nothing for CoinGecko to add. A coin
      // priced from a later day keeps its turn: dropping it would let the coins ahead of it use
      // the rate limit on every run, and the days before Binance's first one would stay flat.
      rateLimitedCurrencies: before.rateLimitedCurrencies.filter((coin) => !reachesStart.has(coin)),
    },
  };
};

/**
 * The crypto leg of a backfill run with Binance's public klines standing in for each coin CoinGecko
 * gave no history for. The leg's own result is returned untouched when nothing is missing, when
 * NBU gave no fiat anchor to price USDT through, or when Binance priced no coin; otherwise the
 * coins it priced join the leg's entries and leave its failures, as if the provider had answered.
 * EUR history is read from NBU only when a coin needs the EURUSDT route and no answer carried it.
 */
export const withBinanceFallback = async (input: {
  requested: CryptoCurrency[];
  nbuResult: PromiseSettledResult<NbuHistory>;
  cryptoResult: PromiseSettledResult<CryptoHistory>;
  range: { start: number; end: number };
  loadNbu: (currencies: Currency[], start: number, end: number) => Promise<NbuHistory>;
  client: BinanceMarketClient | undefined;
}): Promise<PromiseSettledResult<CryptoHistory>> => {
  const { requested, nbuResult, cryptoResult, range } = input;
  const missing = unansweredCoins(requested, cryptoResult);

  if (missing.length === 0 || nbuResult.status === 'rejected') {
    return cryptoResult;
  }
  const answered = [
    ...nbuResult.value.entries,
    ...(cryptoResult.status === 'fulfilled' ? cryptoResult.value.entries : []),
  ];
  const answeredTimelines = groupTimelines(answered);
  const rateAt = (timelines: Map<string, HistoryRateEntry[]>, pair: string, day: number) =>
    nearestAtOrBefore(timelines.get(pair) ?? [], day);

  // NBU is asked for EUR only when a series reaches the EURUSDT route and no answer carried it.
  const loadEuroPriceAt = async (): Promise<(day: number) => number | undefined> => {
    const euroHistory = answeredTimelines.has('EUR:UAH')
      ? undefined
      : bifoldr(await either(() => input.loadNbu(['EUR'], range.start, range.end)));
    const timelines = groupTimelines([...answered, ...(euroHistory?.entries ?? [])]);

    return (day) => rateAt(timelines, 'EUR:UAH', day);
  };

  const entries = await fetchFallbackHistory({
    coins: missing,
    ...range,
    usdtPriceAt: (day) =>
      foldMap(maybe(rateAt(answeredTimelines, 'USDT:USD', day)), (usdtInDollars) =>
        foldMap(
          maybe(rateAt(answeredTimelines, 'USD:UAH', day)),
          (dollarInUah) => usdtInDollars * dollarInUah,
        ),
      ),
    loadEuroPriceAt,
    client: input.client ?? createBinanceMarketClient(),
  });

  return entries.length === 0
    ? cryptoResult
    : withPricedCoins(cryptoResult, requested, entries, range.start);
};
