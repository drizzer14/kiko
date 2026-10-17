import {
  binanceKeyOf,
  EARN_KEY,
  FUNDING_KEY,
  SPOT_KEY,
  WALLET_HOLDING_NAMES,
} from './binance.holding-keys';
import { BinanceRateLimitError } from './binance.client';
import { BINANCE_WALK_CONFIG } from './binance.walk-config';
import { BINANCE_DEPTH_CONFIG } from './binance.depth-config';
import { HISTORY_TOTAL_PAGE_SIZE } from './binance.history-client';

describe('the Binance walk config', () => {
  it('carries today asset, metadata field, names, page size and rate-limit check', () => {
    expect(BINANCE_WALK_CONFIG.asset).toBe('BTC');
    expect(BINANCE_WALK_CONFIG.metadataField).toBe('binanceAsset');
    expect(BINANCE_WALK_CONFIG.totalPageSize).toBe(HISTORY_TOTAL_PAGE_SIZE);
    expect(BINANCE_WALK_CONFIG.holdingKeyOf).toBe(binanceKeyOf);
    expect(BINANCE_WALK_CONFIG.depth).toBe(BINANCE_DEPTH_CONFIG);
    expect(BINANCE_WALK_CONFIG.refusedCallWeights).toEqual({
      usedUidWeight1m: undefined,
      usedIpWeight1m: undefined,
    });
    expect(BINANCE_WALK_CONFIG.isRateLimitError(new BinanceRateLimitError(429, 1_000))).toBe(true);
    expect(BINANCE_WALK_CONFIG.isRateLimitError(new Error('rate limit'))).toBe(false);
  });

  it.each([SPOT_KEY, FUNDING_KEY, EARN_KEY] as const)(
    'names the wallet of %s as the holding names do',
    (key) => {
      expect(BINANCE_WALK_CONFIG.walletHoldingNameOf(key)).toBe(WALLET_HOLDING_NAMES[key]);
    },
  );
});
