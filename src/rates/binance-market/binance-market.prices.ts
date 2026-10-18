import maybe, { foldMap } from 'fnts/maybe';
import { curatedCoins } from '@kiko/currency/coins';
import type { CryptoCurrency } from '@kiko/currency/currency';

import type { BinanceMarketClient } from './binance-market.client';

/**
 * The UAH price of what a USDT-quoted price converts through. `usdt` is USDT's own price when the
 * run priced it; `euro` is the fiat anchor that prices USDT through EURUSDT when it did not.
 */
type FallbackAnchors = { usdt: number | undefined; euro: number | undefined };

/** The EUR price in USDT: the pair that prices USDT itself, which has no USDT symbol. */
export const EURO_SYMBOL = 'EURUSDT';

const usdtPriceOf = async (
  anchors: FallbackAnchors,
  client: BinanceMarketClient,
): Promise<number | undefined> => {
  if (anchors.usdt !== undefined) {
    return anchors.usdt;
  }
  const euro = anchors.euro;

  if (euro === undefined) {
    return undefined;
  }

  return foldMap(maybe(await client.tickerPrice(EURO_SYMBOL)), (usdtPerEuro) => euro / usdtPerEuro);
};

const uahPriceOf = async (
  coin: CryptoCurrency,
  usdt: number,
  client: BinanceMarketClient,
): Promise<number | undefined> => {
  if (coin === 'USDT') {
    return usdt;
  }
  const symbol = curatedCoins[coin].binanceSymbol;

  if (symbol === undefined) {
    return undefined;
  }

  return foldMap(maybe(await client.tickerPrice(symbol)), (quote) => quote * usdt);
};

/**
 * The UAH price of each coin CoinGecko did not price, from Binance's public ticker: the coin's
 * USDT price times USDT's price, a stablecoin's included, never 1:1. Only a coin the market priced
 * is in the answer, and nothing is asked when USDT has no price from either source.
 */
export const fetchFallbackPrices = async (input: {
  coins: readonly CryptoCurrency[];
  anchors: FallbackAnchors;
  client: BinanceMarketClient;
}): Promise<Partial<Record<CryptoCurrency, number>>> => {
  if (input.coins.length === 0) {
    return {};
  }
  const usdt = await usdtPriceOf(input.anchors, input.client);

  if (usdt === undefined) {
    return {};
  }
  const prices: Partial<Record<CryptoCurrency, number>> = {};

  for (const coin of input.coins) {
    const price = await uahPriceOf(coin, usdt, input.client);

    if (price !== undefined) {
      prices[coin] = price;
    }
  }

  return prices;
};
