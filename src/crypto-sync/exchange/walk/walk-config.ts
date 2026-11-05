import type { HoldingRow } from '@kiko/db';
import type { ExchangeHolding } from '@kiko/holdings/repo';
import type { BalanceProviderId } from '@kiko/crypto-sync/provider';

/** The coin and the default name of the holding a wallet key stands for. */
type WalletHoldingDefaults = Pick<ExchangeHolding, 'currency' | 'name'>;

/**
 * What a walk and its pager read about one exchange, which each exchange brings itself: where a
 * holding keeps its wallet key and which coin and name the holding of a wallet key gets (none for
 * a key that names no coin), how a rate-limit failure is told apart, the page size of its paged
 * reads, the weights a refused call is counted with, and the `source` its history rows carry.
 * `Source` stays the exchange's own id, so a row type that names it does not widen.
 */
export type ExchangeWalkConfig<
  RateLimitError extends Error,
  Weights,
  Source extends BalanceProviderId = BalanceProviderId,
> = {
  source: Source;
  metadataField: ExchangeHolding['metadataField'];
  holdingKeyOf: (holding: Pick<HoldingRow, 'metadata'>) => string | undefined;
  walletHoldingOf: (key: string) => WalletHoldingDefaults | undefined;
  isRateLimitError: (error: unknown) => error is RateLimitError;
  totalPageSize: number;
  refusedCallWeights: Weights;
};
