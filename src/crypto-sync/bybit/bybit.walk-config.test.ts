import { NO_WEIGHTS } from './bybit.history-budget';
import { BybitRateLimitError } from './bybit.client';
import { bybitKeyOf, holdingKeyOf } from './bybit.holding-keys';
import { BYBIT_HISTORY_PAGE_SIZE, BYBIT_WALK_CONFIG } from './bybit.walk-config';

describe('the Bybit walk config', () => {
  it('carries the source, metadata field, key reader, page size and refused weights', () => {
    expect(BYBIT_WALK_CONFIG.source).toBe('bybit');
    expect(BYBIT_WALK_CONFIG.metadataField).toBe('bybitAsset');
    expect(BYBIT_WALK_CONFIG.holdingKeyOf).toBe(bybitKeyOf);
    expect(BYBIT_WALK_CONFIG.totalPageSize).toBe(BYBIT_HISTORY_PAGE_SIZE);
    expect(BYBIT_HISTORY_PAGE_SIZE).toBe(50);
    expect(BYBIT_WALK_CONFIG.refusedCallWeights).toBe(NO_WEIGHTS);
  });

  it('tells a Bybit rate refusal from any other failure', () => {
    expect(BYBIT_WALK_CONFIG.isRateLimitError(new BybitRateLimitError(10_006, 1_000))).toBe(true);
    expect(BYBIT_WALK_CONFIG.isRateLimitError(new Error('rate limit'))).toBe(false);
    expect(BYBIT_WALK_CONFIG.isRateLimitError(undefined)).toBe(false);
  });

  it.each([
    [holdingKeyOf('BTC', 'unified'), 'BTC', 'Bybit Unified · BTC'],
    [holdingKeyOf('BTC', 'fund'), 'BTC', 'Bybit Funding · BTC'],
    [holdingKeyOf('USDT', 'fund'), 'USDT', 'Bybit Funding · USDT'],
  ] as const)('names the holding of %s: %s, %s', (key, currency, name) => {
    expect(BYBIT_WALK_CONFIG.walletHoldingOf(key)).toEqual({ currency, name });
  });

  it.each(['BTC', 'PEPE:fund', 'BTC:earn', 'BTC:flexible', 'LDBTC:unified', ''])(
    'names no holding for %p',
    (key) => {
      expect(BYBIT_WALK_CONFIG.walletHoldingOf(key)).toBeUndefined();
    },
  );

  it('reads the key stored under bybitAsset, and none under another field', () => {
    expect(BYBIT_WALK_CONFIG.holdingKeyOf({ metadata: { bybitAsset: 'BTC:fund' } })).toBe(
      'BTC:fund',
    );
    expect(BYBIT_WALK_CONFIG.holdingKeyOf({ metadata: { binanceAsset: 'BTC' } })).toBeUndefined();
  });
});
