import { BinanceRateLimitError } from './binance.client';
import { BINANCE_WALK_CONFIG } from './binance.walk-config';
import { HISTORY_TOTAL_PAGE_SIZE } from './binance.history-client';
import { binanceKeyOf, EARN_KEY, FUNDING_KEY, SPOT_KEY } from './binance.holding-keys';

describe('the Binance walk config', () => {
  it('carries the asset, metadata field, key reader, page size, refused weights and rate-limit check', () => {
    expect(BINANCE_WALK_CONFIG.asset).toBe('BTC');
    expect(BINANCE_WALK_CONFIG.metadataField).toBe('binanceAsset');
    expect(BINANCE_WALK_CONFIG.totalPageSize).toBe(HISTORY_TOTAL_PAGE_SIZE);
    expect(BINANCE_WALK_CONFIG.holdingKeyOf).toBe(binanceKeyOf);
    expect(BINANCE_WALK_CONFIG.refusedCallWeights).toEqual({
      usedUidWeight1m: undefined,
      usedIpWeight1m: undefined,
    });
    expect(BINANCE_WALK_CONFIG.isRateLimitError(new BinanceRateLimitError(429, 1_000))).toBe(true);
    expect(BINANCE_WALK_CONFIG.isRateLimitError(new Error('rate limit'))).toBe(false);
  });

  it.each([
    [SPOT_KEY, 'Binance Spot · BTC'],
    [FUNDING_KEY, 'Binance Funding · BTC'],
    [EARN_KEY, 'Binance Earn · BTC'],
  ] as const)('names the holding of %s %s', (key, name) => {
    expect(BINANCE_WALK_CONFIG.walletHoldingNameOf(key)).toBe(name);
  });
});
