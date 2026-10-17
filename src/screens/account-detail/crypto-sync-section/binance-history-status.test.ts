import { DAY_MS } from '@kiko/dates';
import type { HoldingRow } from '@kiko/db';
import { type WalkId, type WalkMarks, withWalkMarks } from '@kiko/test-support/walk-marks';

import { isBinanceHistoryBehind, transferOwesRange, walkCursorsOf } from './binance-history-status';

const NOW = 1_704_326_400_000;
const HOUR_MS = 60 * 60 * 1000;

/** What a Spot holding stores once each walk named has run, on top of what else it carries. */
const spotCarrying = (
  marks: Partial<Record<WalkId, WalkMarks>>,
  base: Record<string, unknown> = { binanceAsset: 'BTC' },
): Record<string, unknown> =>
  Object.entries(marks).reduce(
    (metadata, [walkId, walkMarks]) =>
      withWalkMarks(metadata, 'acc-1', walkId as WalkId, walkMarks),
    base,
  );

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
    expect(
      isBinanceHistoryBehind({ cursors: caughtUp, lastBalanceSyncAt: null, owesRange: true }),
    ).toBe(false);
  });

  it('is behind when the Transfer walk owes a range, though every cursor is current', () => {
    expect(
      isBinanceHistoryBehind({ cursors: caughtUp, lastBalanceSyncAt: NOW, owesRange: true }),
    ).toBe(true);
    expect(
      isBinanceHistoryBehind({ cursors: caughtUp, lastBalanceSyncAt: NOW, owesRange: false }),
    ).toBe(false);
  });
});

describe('transferOwesRange', () => {
  const holding = (metadata: Record<string, unknown> | null): Pick<HoldingRow, 'metadata'> => ({
    metadata,
  });
  const carrying = (owed: unknown) =>
    holding(spotCarrying({ capital: { cursor: NOW }, transfer: { pending: owed } }));

  it.each([
    ['a range owed in every type', [{ start: 1, end: 3 }]],
    ['a range owed in one type', [{ start: 1, end: 3, series: 'MAIN_FUNDING' }]],
    [
      'a range beside a point',
      [
        { start: 1, end: 3, kind: 'point', series: 'MAIN_FUNDING' },
        { start: 5, end: 9 },
      ],
    ],
  ])('is true for %s', (_label, owed) => {
    expect(transferOwesRange([carrying(owed)])).toBe(true);
  });

  it.each([
    ['no list', undefined],
    ['an empty list', []],
    ['only a point', [{ start: 1, end: 3, kind: 'point', series: 'MAIN_FUNDING' }]],
    ['a list that is not well formed', 'x'],
  ])('is false for %s', (_label, owed) => {
    expect(transferOwesRange([carrying(owed)])).toBe(false);
  });

  it('is false when no holding carries the capital cursor', () => {
    expect(
      transferOwesRange([
        holding(spotCarrying({ transfer: { pending: [{ start: 1, end: 3 }] } }, {})),
      ]),
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
      holding(
        spotCarrying({
          capital: { cursor: 1 },
          pay: { cursor: 2 },
          transfer: { cursor: 3 },
          earn: { cursor: 4, rescan: 99 },
        }),
      ),
      holding({ binanceAsset: 'BTC:earn' }),
    ];

    expect(walkCursorsOf(holdings)).toEqual([1, 2, 3, 4]);
  });

  it('reads a cursor a walk has not written yet as null', () => {
    expect(walkCursorsOf([holding(spotCarrying({ capital: { cursor: NOW } }))])).toEqual([
      NOW,
      null,
      null,
      null,
    ]);
  });

  it('is four nulls when no holding carries the capital cursor (a wallet account, or a never-run history walk)', () => {
    expect(walkCursorsOf([holding({ walletAddress: 'bc1q' })])).toEqual([null, null, null, null]);
    expect(walkCursorsOf([holding(spotCarrying({ earn: { cursor: NOW } }))])).toEqual([
      null,
      null,
      null,
      null,
    ]);
    expect(walkCursorsOf([])).toEqual([null, null, null, null]);
  });

  it('does not read an owed point as a cursor: a list of ground changes nothing', () => {
    const cursors = walkCursorsOf([
      holding(
        spotCarrying({
          capital: { cursor: NOW },
          pay: { cursor: NOW },
          transfer: {
            cursor: NOW,
            pending: [{ start: 1, end: 3, kind: 'point', series: 'MAIN_FUNDING' }],
          },
          earn: { cursor: NOW },
        }),
      ),
    ]);

    expect(cursors).toEqual([NOW, NOW, NOW, NOW]);
  });
});
