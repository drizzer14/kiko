import type { RateEntry } from './conversion';

const PRICE_ENDPOINT =
  'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd';

/** The `/simple/price` payload shape for a single id/vs-currency pair. */
type CoinGeckoPrice = { bitcoin: { usd: number } };

/**
 * Fetch the current BTC price in USD from CoinGecko's public simple-price
 * endpoint. Returns the BTC->USD pair; other BTC pairs are composed downstream
 * from the fiat cross rates.
 */
export const fetchBtcPrice = async (fetchImpl: typeof fetch = fetch): Promise<RateEntry[]> => {
  const response = await fetchImpl(PRICE_ENDPOINT);
  if (!response.ok) {
    throw new Error(`CoinGecko request failed: ${response.status}`);
  }
  const data = (await response.json()) as CoinGeckoPrice;
  return [{ base: 'BTC', quote: 'USD', rate: data.bitcoin.usd, source: 'coingecko' }];
};
