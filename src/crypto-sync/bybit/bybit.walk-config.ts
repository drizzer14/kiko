import maybe, { foldMap } from 'fnts/maybe';
import type { ExchangeWalkConfig } from '@kiko/crypto-sync/exchange/walk';

import { BybitRateLimitError } from './bybit.client';
import { type BybitCallWeights, NO_WEIGHTS } from './bybit.history-budget';
import { bybitKeyOf, coinHoldingName, partsOfHoldingKey } from './bybit.holding-keys';

/**
 * The `limit` the capital, transfer and log routes are asked for. The shared pager's total-count
 * check reads it; Bybit's cursor reader never reaches that check, so it only has to hold the
 * documented size.
 */
export const BYBIT_HISTORY_PAGE_SIZE = 50;

export const BYBIT_WALK_CONFIG: ExchangeWalkConfig<BybitRateLimitError, BybitCallWeights, 'bybit'> =
  {
    source: 'bybit',
    metadataField: 'bybitAsset',
    holdingKeyOf: bybitKeyOf,
    walletHoldingOf: (key) =>
      foldMap(maybe(partsOfHoldingKey(key)), ({ code, wallet }) => ({
        currency: code,
        name: coinHoldingName(code, wallet),
      })),
    isRateLimitError: (error): error is BybitRateLimitError => error instanceof BybitRateLimitError,
    totalPageSize: BYBIT_HISTORY_PAGE_SIZE,
    refusedCallWeights: NO_WEIGHTS,
  };
