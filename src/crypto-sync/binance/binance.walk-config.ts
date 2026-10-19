import maybe, { foldMap } from 'fnts/maybe';
import type { ExchangeWalkConfig } from '@kiko/crypto-sync/exchange/walk';

import { BinanceRateLimitError } from './binance.client';
import { binanceKeyOf, coinHoldingName, partsOfHoldingKey } from './binance.holding-keys';
import { type BinancePageWeights, HISTORY_TOTAL_PAGE_SIZE } from './binance.history-client';

export const BINANCE_WALK_CONFIG: ExchangeWalkConfig<BinanceRateLimitError, BinancePageWeights> = {
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
