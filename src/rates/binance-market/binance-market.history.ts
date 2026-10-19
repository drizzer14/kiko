import maybe, { foldMap } from 'fnts/maybe';
import { curatedCoins } from '@kiko/currency/coins';
import type { CryptoCurrency } from '@kiko/currency/currency';

import type { HistoryRateEntry } from '../history-entry';

import { EURO_SYMBOL } from './binance-market.prices';
import type { BinanceMarketClient, DailyClose } from './binance-market.client';

/**
 * USDT priced in USDT is its own unit; the day's price comes from the same conversion every other
 * coin's candle goes through.
 */
const USDT_IN_USDT = 1;

const NO_PRICE = (): undefined => undefined;

const closesOf = async (
  coin: CryptoCurrency,
  range: { start: number; end: number },
  client: BinanceMarketClient,
): Promise<DailyClose[] | undefined> => {
  const symbol = curatedCoins[coin].binanceSymbol;

  if (symbol === undefined) {
    return undefined;
  }

  return client.dailyCloses(symbol, range.start, range.end);
};

/**
 * The daily UAH price series of each coin CoinGecko gave no history for, from Binance's public
 * klines: each day's USDT-quoted close times USDT's price of that day (`usdtPriceAt`, from USDT's
 * own history), or, for a day it has none, EURUSDT's close and the EUR anchor of the day. The EUR
 * anchor is loaded (`loadEuroPriceAt`) only once EURUSDT has answered and a series needs it. A coin
 * the market did not answer, and a day neither source prices, have no entry, never a 1:1 price.
 */
export const fetchFallbackHistory = async (input: {
  coins: readonly CryptoCurrency[];
  start: number;
  end: number;
  usdtPriceAt: (day: number) => number | undefined;
  loadEuroPriceAt: () => Promise<(day: number) => number | undefined>;
  client: BinanceMarketClient;
}): Promise<HistoryRateEntry[]> => {
  const { coins, usdtPriceAt, client } = input;
  const range = { start: input.start, end: input.end };
  const series = new Map<CryptoCurrency, DailyClose[]>();

  for (const coin of coins) {
    const closes = await closesOf(coin, range, client);

    if (closes !== undefined) {
      series.set(coin, closes);
    }
  }
  const needsEuroRoute =
    coins.includes('USDT') ||
    [...series.values()].some((closes) =>
      closes.some((close) => usdtPriceAt(close.day) === undefined),
    );
  const euroCloses = needsEuroRoute
    ? await client.dailyCloses(EURO_SYMBOL, range.start, range.end)
    : undefined;
  const euroPriceAt = euroCloses === undefined ? NO_PRICE : await input.loadEuroPriceAt();

  if (coins.includes('USDT') && euroCloses !== undefined) {
    series.set(
      'USDT',
      euroCloses.map((close) => ({ day: close.day, close: USDT_IN_USDT })),
    );
  }
  const euroCloseOf = new Map((euroCloses ?? []).map((close) => [close.day, close.close]));

  const usdtPriceOn = (day: number): number | undefined =>
    usdtPriceAt(day) ??
    foldMap(maybe(euroPriceAt(day)), (euroPrice) =>
      foldMap(maybe(euroCloseOf.get(day)), (usdtPerEuro) => euroPrice / usdtPerEuro),
    );

  return coins.flatMap((coin) =>
    (series.get(coin) ?? []).flatMap(
      (close): HistoryRateEntry[] =>
        foldMap(maybe(usdtPriceOn(close.day)), (usdt): HistoryRateEntry[] => [
          { base: coin, quote: 'UAH', day: close.day, rate: close.close * usdt, source: 'binance' },
        ]) ?? [],
    ),
  );
};
