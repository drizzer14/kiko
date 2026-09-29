import type { HoldingRow } from '@kiko/db';

import { historyCursorOf, isBinanceHistoryBehind } from './binance-history-status';

const DAY = 86_400_000;
const NOW = 1_704_326_400_000;

describe('isBinanceHistoryBehind', () => {
  it('is behind when the history has never caught up (null cursor) but the balance has synced', () => {
    expect(isBinanceHistoryBehind(null, NOW)).toBe(true);
  });

  it('is not behind when the history lags the balance sync by only a couple of hours', () => {
    expect(isBinanceHistoryBehind(NOW - 2 * 60 * 60 * 1000, NOW)).toBe(false);
  });

  it('is behind when the history lags the balance sync by more than a day', () => {
    expect(isBinanceHistoryBehind(NOW - 2 * DAY, NOW)).toBe(true);
  });

  it('is not behind (nothing to compare against) when the account has never synced at all', () => {
    expect(isBinanceHistoryBehind(null, null)).toBe(false);
    expect(isBinanceHistoryBehind(NOW - 2 * DAY, null)).toBe(false);
  });
});

describe('historyCursorOf', () => {
  const holding = (metadata: Record<string, unknown> | null): Pick<HoldingRow, 'metadata'> => ({
    metadata,
  });

  it('reads the cursor off whichever holding carries it (only the Spot holding ever does)', () => {
    const holdings = [
      holding({ binanceAsset: 'BTC:funding' }),
      holding({ binanceAsset: 'BTC', binanceHistoryCursor: NOW }),
      holding({ binanceAsset: 'BTC:earn' }),
    ];

    expect(historyCursorOf(holdings)).toBe(NOW);
  });

  it('returns null when no holding carries a cursor (a wallet account, or a never-run history walk)', () => {
    expect(historyCursorOf([holding({ walletAddress: 'bc1q' })])).toBeNull();
    expect(historyCursorOf([holding({ binanceAsset: 'BTC' })])).toBeNull();
    expect(historyCursorOf([])).toBeNull();
  });
});
