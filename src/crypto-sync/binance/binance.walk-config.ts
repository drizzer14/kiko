import type { ExchangeWalkConfig } from '@kiko/crypto-sync/exchange/walk';

import { BINANCE_ASSET, BinanceRateLimitError } from './binance.client';
import { type BinancePageWeights, HISTORY_TOTAL_PAGE_SIZE } from './binance.history-client';
import { type BinanceWalletKey, binanceKeyOf, WALLET_HOLDING_NAMES } from './binance.holding-keys';

export const BINANCE_WALK_CONFIG: ExchangeWalkConfig<BinanceRateLimitError, BinancePageWeights> = {
  asset: BINANCE_ASSET,
  metadataField: 'binanceAsset',
  holdingKeyOf: binanceKeyOf,
  walletHoldingNameOf: (key) => WALLET_HOLDING_NAMES[key as BinanceWalletKey],
  isRateLimitError: (error): error is BinanceRateLimitError =>
    error instanceof BinanceRateLimitError,
  totalPageSize: HISTORY_TOTAL_PAGE_SIZE,
  refusedCallWeights: { usedUidWeight1m: undefined, usedIpWeight1m: undefined },
};
