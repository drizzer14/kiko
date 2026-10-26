import { BinanceRateLimitError } from './binance.client';
import { BINANCE_WALK_CONFIG, isUnreadableWindowError } from './binance.walk-config';
import { binanceKeyOf, EARN_KEY, FUNDING_KEY, SPOT_KEY } from './binance.holding-keys';
import { BinanceHistoryParseError, HISTORY_TOTAL_PAGE_SIZE } from './binance.history-client';

describe('isUnreadableWindowError', () => {
  it('is true for the unreadable page of a window', () => {
    expect(isUnreadableWindowError(new BinanceHistoryParseError())).toBe(true);
  });

  it.each([
    ['a 429 rate limit', new BinanceRateLimitError(429, 1_000)],
    ['a 418 ban', new BinanceRateLimitError(418, 1_000)],
    ['a rejected key', new Error('Binance request failed: -2015 Invalid API-key')],
    ['a clock skew (-1021)', new Error('Binance request failed: -1021 Timestamp ahead')],
    ['a network failure', new TypeError('Network request failed')],
  ])('is false for %s', (_label, error) => {
    expect(isUnreadableWindowError(error)).toBe(false);
  });

  it.each([undefined, null, 'unreadable', { name: 'BinanceHistoryParseError' }])(
    'is false for the non-error %p',
    (value) => {
      expect(isUnreadableWindowError(value)).toBe(false);
    },
  );
});

describe('the Binance walk config', () => {
  it('carries the metadata field, key reader, page size, refused weights and rate-limit check', () => {
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
    [SPOT_KEY, 'BTC', 'Binance Spot · BTC'],
    [FUNDING_KEY, 'BTC', 'Binance Funding · BTC'],
    [EARN_KEY, 'BTC', 'Binance Earn · BTC'],
    ['USDT:funding', 'USDT', 'Binance Funding · USDT'],
  ] as const)('names the holding of %s: %s, %s', (key, currency, name) => {
    expect(BINANCE_WALK_CONFIG.walletHoldingOf(key)).toEqual({ currency, name });
  });

  it.each(['PEPE:funding', 'LDBTC', 'BTC:flexible', ''])('names no holding for %p', (key) => {
    expect(BINANCE_WALK_CONFIG.walletHoldingOf(key)).toBeUndefined();
  });
});
