import maybe, { foldMap } from 'fnts/maybe';
import type { ExchangeWalkConfig } from '@kiko/crypto-sync/exchange/walk';

import {
  type BinancePageWeights,
  BinanceHistoryParseError,
  HISTORY_TOTAL_PAGE_SIZE,
} from './binance.history-client';
import { BinanceRateLimitError } from './binance.client';
import { binanceKeyOf, coinHoldingName, partsOfHoldingKey } from './binance.holding-keys';

/**
 * The one failure of an owed window the walk reads on past: a page of the window that does not
 * read. A rate limit, a rejected key, a clock skew or a network failure is not one, so the run
 * stops at it with no further call.
 */
export const isUnreadableWindowError = (error: unknown): boolean =>
  error instanceof BinanceHistoryParseError;

export const BINANCE_WALK_CONFIG: ExchangeWalkConfig<
  BinanceRateLimitError,
  BinancePageWeights,
  'binance'
> = {
  source: 'binance',
  metadataField: 'binanceAsset',
  holdingKeyOf: binanceKeyOf,
  walletHoldingOf: (key) =>
    foldMap(maybe(partsOfHoldingKey(key)), ({ code, wallet }) => ({
      currency: code,
      name: coinHoldingName(code, wallet),
    })),
  isRateLimitError: (error): error is BinanceRateLimitError =>
    error instanceof BinanceRateLimitError,
  totalPageSize: HISTORY_TOTAL_PAGE_SIZE,
  refusedCallWeights: { usedUidWeight1m: undefined, usedIpWeight1m: undefined },
};
