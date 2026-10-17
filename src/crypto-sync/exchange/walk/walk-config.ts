import type { HoldingRow } from '@kiko/db';
import type { ExchangeHolding } from '@kiko/holdings/repo';

/**
 * What a walk and its pager read about one exchange, which each exchange brings itself: the coin
 * its holdings are in, where a holding keeps its wallet key and how a wallet is named, how a
 * rate-limit failure is told apart, the page size of its paged reads, and the weights a refused
 * call is counted with.
 */
export type ExchangeWalkConfig<RateLimitError extends Error, Weights> = {
  asset: ExchangeHolding['currency'];
  metadataField: ExchangeHolding['metadataField'];
  holdingKeyOf: (holding: Pick<HoldingRow, 'metadata'>) => string | undefined;
  walletHoldingNameOf: (key: string) => string;
  isRateLimitError: (error: unknown) => error is RateLimitError;
  totalPageSize: number;
  refusedCallWeights: Weights;
};
