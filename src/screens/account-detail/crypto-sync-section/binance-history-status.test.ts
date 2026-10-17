import { DAY_MS } from '@kiko/dates';
import { parseExchangeState } from '@kiko/crypto-sync/exchange/walk-state';
import { type WalkMarkSeed, type WalkName, withWalkMarkSeeds } from '@kiko/test-support/walk-marks';

import { isBinanceHistoryBehind, transferOwesRange, walkCursorsOf } from './binance-history-status';

const NOW = 1_704_326_400_000;
const HOUR_MS = 60 * 60 * 1000;

const stateOf = (seeds: Partial<Record<WalkName, WalkMarkSeed>>) =>
  parseExchangeState(JSON.stringify(withWalkMarkSeeds({}, 'acc-1', seeds)));

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
  const owing = (owed: unknown) =>
    stateOf({ capital: { cursor: NOW }, transfer: { pending: owed } });

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
    expect(transferOwesRange(owing(owed))).toBe(true);
  });

  it.each([
    ['no list', undefined],
    ['an empty list', []],
    ['only a point', [{ start: 1, end: 3, kind: 'point', series: 'MAIN_FUNDING' }]],
    ['a list that is not well formed', 'x'],
  ])('is false for %s', (_label, owed) => {
    expect(transferOwesRange(owing(owed))).toBe(false);
  });

  it.each([
    ['no state row', null],
    ['a state that is not readable', '{not json'],
  ])('is false for %s', (_label, text) => {
    expect(transferOwesRange(parseExchangeState(text))).toBe(false);
  });
});

describe('walkCursorsOf', () => {
  it('reads the four forward cursors, capital, Pay, Transfer and Earn, off the state', () => {
    const state = stateOf({
      capital: { cursor: 1 },
      pay: { cursor: 2 },
      transfer: { cursor: 3 },
      earn: { cursor: 4, rescan: 99 },
    });

    expect(walkCursorsOf(state)).toEqual([1, 2, 3, 4]);
  });

  it('reads a cursor a walk has not written yet as null', () => {
    expect(walkCursorsOf(stateOf({ capital: { cursor: NOW } }))).toEqual([NOW, null, null, null]);
  });

  it('reads each walk by its own cursor, whichever other walks have one', () => {
    expect(walkCursorsOf(stateOf({ earn: { cursor: NOW } }))).toEqual([null, null, null, NOW]);
  });

  it.each([
    ['no state row', null],
    ['a state that is not readable', '{not json'],
  ])('is four nulls for %s', (_label, text) => {
    expect(walkCursorsOf(parseExchangeState(text))).toEqual([null, null, null, null]);
  });

  it('does not read an owed point as a cursor: a list of ground changes nothing', () => {
    const cursors = walkCursorsOf(
      stateOf({
        capital: { cursor: NOW },
        pay: { cursor: NOW },
        transfer: {
          cursor: NOW,
          pending: [{ start: 1, end: 3, kind: 'point', series: 'MAIN_FUNDING' }],
        },
        earn: { cursor: NOW },
      }),
    );

    expect(cursors).toEqual([NOW, NOW, NOW, NOW]);
  });
});
