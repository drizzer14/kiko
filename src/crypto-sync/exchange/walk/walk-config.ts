import type { HoldingRow } from '@kiko/db';
import type { ExchangeHolding } from '@kiko/holdings/repo';

/** The coin and the default name of the holding a wallet key stands for. */
type WalletHoldingDefaults = Pick<ExchangeHolding, 'currency' | 'name'>;

/**
 * What a walk and its pager read about one exchange, which each exchange brings itself: where a
 * holding keeps its wallet key and which coin and name the holding of a wallet key gets (none for
 * a key that names no coin), how a rate-limit failure is told apart, the page size of its paged
 * reads, and the weights a refused call is counted with.
 */
export type ExchangeWalkConfig<RateLimitError extends Error, Weights> = {
  metadataField: ExchangeHolding['metadataField'];
  holdingKeyOf: (holding: Pick<HoldingRow, 'metadata'>) => string | undefined;
  walletHoldingOf: (key: string) => WalletHoldingDefaults | undefined;
  isRateLimitError: (error: unknown) => error is RateLimitError;
  totalPageSize: number;
  refusedCallWeights: Weights;
};
