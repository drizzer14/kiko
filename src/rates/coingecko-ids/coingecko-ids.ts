import { recordByCoin } from '@kiko/currency/coins';
import type { CryptoCurrency } from '@kiko/currency/currency';

/**
 * The single source of truth mapping each crypto `Currency` to its CoinGecko
 * coin id. Both the live price fetch (`coingecko.ts`) and the history fetch
 * (`coingecko-history.ts`) build their request ids from this map, so the coin
 * set can never drift between the two. Derived from the curated registry
 * (`src/currency/coins/coins.ts`), keyed exhaustively over the crypto codes;
 * `coingecko-ids.test.ts` asserts the keys equal `currencyOptions.filter(isCrypto)`.
 */
export const cryptoCoinGeckoId: Record<CryptoCurrency, string> = recordByCoin(
  (entry) => entry.coinGeckoId,
);
