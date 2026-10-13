import { DAY_MS } from '@kiko/dates';
import type { HoldingRow } from '@kiko/db';

import { isBinanceHistoryBehind, walkCursorsOf } from './binance-history-status';

const NOW = 1_704_326_400_000;
const HOUR_MS = 60 * 60 * 1000;

describe('isBinanceHistoryBehind', () => {
  const caughtUp = [NOW - HOUR_MS, NOW - 2 * HOUR_MS, NOW - HOUR_MS, NOW - 3 * HOUR_MS];

  it('is behind when any walk has never caught up (a null cursor) but the balance has synced', () => {
    expect(
      isBinanceHistoryBehind({ cursors: [null, null, null, null], lastBalanceSyncAt: NOW }),
    ).toBe(true);
    expect(
      isBinanceHistoryBehind({ cursors: [...caughtUp.slice(0, 3), null], lastBalanceSyncAt: NOW }),
    ).toBe(true);
  });

  it('is not behind when every walk lags the balance sync by only a few hours', () => {
    expect(isBinanceHistoryBehind({ cursors: caughtUp, lastBalanceSyncAt: NOW })).toBe(false);
  });

  it.each([0, 1, 2, 3])(
    'is behind when only walk %i lags the balance sync by more than a day',
    (index) => {
      const cursors = caughtUp.map((cursor, position) =>
        position === index ? NOW - 2 * DAY_MS : cursor,
      );

      expect(isBinanceHistoryBehind({ cursors, lastBalanceSyncAt: NOW })).toBe(true);
    },
  );

  it('is not behind at exactly a day, and is behind a millisecond past it', () => {
    expect(
      isBinanceHistoryBehind({ cursors: [NOW - DAY_MS, NOW, NOW, NOW], lastBalanceSyncAt: NOW }),
    ).toBe(false);
    expect(
      isBinanceHistoryBehind({
        cursors: [NOW - DAY_MS - 1, NOW, NOW, NOW],
        lastBalanceSyncAt: NOW,
      }),
    ).toBe(true);
  });

  it('is not behind (nothing to compare against) when the account has never synced at all', () => {
    expect(
      isBinanceHistoryBehind({ cursors: [null, null, null, null], lastBalanceSyncAt: null }),
    ).toBe(false);
    expect(
      isBinanceHistoryBehind({
        cursors: [NOW - 2 * DAY_MS, NOW, NOW, NOW],
        lastBalanceSyncAt: null,
      }),
    ).toBe(false);
  });
});

describe('walkCursorsOf', () => {
  const holding = (metadata: Record<string, unknown> | null): Pick<HoldingRow, 'metadata'> => ({
    metadata,
  });

  it('reads the four forward cursors, capital, Pay, Transfer and Earn, off the holding that carries the capital cursor', () => {
    const holdings = [
      holding({ binanceAsset: 'BTC:funding' }),
      holding({
        binanceAsset: 'BTC',
        binanceHistoryCursor: 1,
        binancePayHistoryCursor: 2,
        binanceTransferHistoryCursor: 3,
        binanceEarnHistoryCursor: 4,
        binanceEarnRescanCursor: 99,
      }),
      holding({ binanceAsset: 'BTC:earn' }),
    ];

    expect(walkCursorsOf(holdings)).toEqual([1, 2, 3, 4]);
  });

  it('reads a cursor a walk has not written yet as null', () => {
    expect(walkCursorsOf([holding({ binanceAsset: 'BTC', binanceHistoryCursor: NOW })])).toEqual([
      NOW,
      null,
      null,
      null,
    ]);
  });

  it('is four nulls when no holding carries the capital cursor (a wallet account, or a never-run history walk)', () => {
    expect(walkCursorsOf([holding({ walletAddress: 'bc1q' })])).toEqual([null, null, null, null]);
    expect(
      walkCursorsOf([holding({ binanceAsset: 'BTC', binanceEarnHistoryCursor: NOW })]),
    ).toEqual([null, null, null, null]);
    expect(walkCursorsOf([])).toEqual([null, null, null, null]);
  });

  it('does not read an owed point as a cursor: a list of ground changes nothing', () => {
    const cursors = walkCursorsOf([
      holding({
        binanceAsset: 'BTC',
        binanceHistoryCursor: NOW,
        binancePayHistoryCursor: NOW,
        binanceTransferHistoryCursor: NOW,
        binanceEarnHistoryCursor: NOW,
        binanceTransferPendingOverlap: [
          { start: 1, end: 3, kind: 'point', series: 'MAIN_FUNDING' },
        ],
      }),
    ]);

    expect(cursors).toEqual([NOW, NOW, NOW, NOW]);
  });
});
