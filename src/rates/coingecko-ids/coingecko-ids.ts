/**
 * The single source of truth mapping each crypto `Currency` to its CoinGecko
 * coin id. Both the live price fetch (`coingecko.ts`) and the history fetch
 * (`coingecko-history.ts`) build their request ids from this map, so the coin
 * set can never drift between the two. Keyed exhaustively over the crypto codes;
 * `coingecko-ids.test.ts` asserts the keys equal `currencyOptions.filter(isCrypto)`,
 * so adding a crypto without a CoinGecko id is a test failure, not a silent gap.
 */
export const cryptoCoinGeckoId: Record<'BTC' | 'ETH' | 'USDT', string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  USDT: 'tether',
};

/** The comma-joined CoinGecko id list for a `simple/price`/`market_chart` request. */
export const coinGeckoIds = (): string => Object.values(cryptoCoinGeckoId).join(',');
