import { DAY_MS } from '@kiko/dates';
import { parseExchangeState } from '@kiko/crypto-sync/exchange/walk-state';
import { type WalkMarkSeed, type WalkName, withWalkMarkSeeds } from '@kiko/test-support/walk-marks';

import { historyOwesRange, isBinanceHistoryBehind, walkCursorsOf } from './binance-history-status';

const NOW = 1_704_326_400_000;
const HOUR_MS = 60 * 60 * 1000;

const stateOf = (seeds: Partial<Record<WalkName, WalkMarkSeed>>) =>
  parseExchangeState(JSON.stringify(withWalkMarkSeeds({}, 'acc-1', seeds)));

// The walks the caption compares, in the order `walkCursorsOf` lists them.
const CAPTION_WALK_NAMES: readonly WalkName[] = [
  'capital',
  'pay',
  'transfer',
  'earn',
  'convert',
  'p2p',
  'fiatOrders',
  'fiatPayments',
];

// Every caption walk at `cursor`, except where `over` seeds a walk's marks itself.
const withEveryCursor = (cursor: number, over: Partial<Record<WalkName, WalkMarkSeed>>) =>
  stateOf({
    ...Object.fromEntries(CAPTION_WALK_NAMES.map((walkName) => [walkName, { cursor }])),
    ...over,
  });

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

describe('historyOwesRange', () => {
  const owing = (walkName: WalkName, owed: unknown) =>
    stateOf({ capital: { cursor: NOW }, [walkName]: { cursor: NOW, pending: owed } });

  describe.each(CAPTION_WALK_NAMES)('the %s walk', (walkName) => {
    it.each([
      ['a range owed in every series', [{ start: 1, end: 3 }]],
      ['a range owed in one series', [{ start: 1, end: 3, series: 'MAIN_FUNDING' }]],
      [
        'a range beside a point',
        [
          { start: 1, end: 3, kind: 'point', series: 'MAIN_FUNDING' },
          { start: 5, end: 9 },
        ],
      ],
    ])('is true for %s', (_label, owed) => {
      expect(historyOwesRange(owing(walkName, owed))).toBe(true);
    });

    it.each([
      ['no list', undefined],
      ['an empty list', []],
      ['only a point', [{ start: 1, end: 3, kind: 'point', series: 'MAIN_FUNDING' }]],
      ['a list that is not well formed', 'x'],
    ])('is false for %s', (_label, owed) => {
      expect(historyOwesRange(owing(walkName, owed))).toBe(false);
    });
  });

  it('is true when one walk owes a range, whichever the others hold', () => {
    expect(
      historyOwesRange(
        stateOf({
          capital: { cursor: NOW, pending: [] },
          earn: { cursor: NOW, pending: [{ start: 1, end: 3, kind: 'point' }] },
          fiatPayments: { cursor: NOW, pending: [{ start: 1, end: 3 }] },
        }),
      ),
    ).toBe(true);
  });

  it.each([
    ['no state row', null],
    ['a state that is not readable', '{not json'],
  ])('is false for %s', (_label, text) => {
    expect(historyOwesRange(parseExchangeState(text))).toBe(false);
  });
});

describe('walkCursorsOf', () => {
  it('reads the eight forward cursors, capital, Pay, Transfer, Earn, Convert, P2P, fiat orders and fiat payments, off the state', () => {
    const state = stateOf({
      capital: { cursor: 1 },
      pay: { cursor: 2 },
      transfer: { cursor: 3 },
      earn: { cursor: 4, rescan: 99 },
      convert: { cursor: 5 },
      p2p: { cursor: 6 },
      fiatOrders: { cursor: 7 },
      fiatPayments: { cursor: 8 },
    });

    expect(walkCursorsOf(state)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('reads a cursor a walk has not written yet as null', () => {
    expect(walkCursorsOf(stateOf({ capital: { cursor: NOW } }))).toEqual([
      NOW,
      ...Array.from({ length: 7 }, () => null),
    ]);
  });

  it.each(CAPTION_WALK_NAMES.map((walkName, position) => [walkName, position] as const))(
    'reads the %s walk by its own cursor, whichever other walks have one',
    (walkName, position) => {
      expect(walkCursorsOf(stateOf({ [walkName]: { cursor: NOW } }))).toEqual(
        CAPTION_WALK_NAMES.map((_unused, index) => (index === position ? NOW : null)),
      );
    },
  );

  it.each([
    ['no state row', null],
    ['a state that is not readable', '{not json'],
  ])('is eight nulls for %s', (_label, text) => {
    expect(walkCursorsOf(parseExchangeState(text))).toEqual(Array.from({ length: 8 }, () => null));
  });

  it('does not read an owed point as a cursor: a list of ground changes nothing', () => {
    const cursors = walkCursorsOf(
      withEveryCursor(NOW, {
        transfer: {
          cursor: NOW,
          pending: [{ start: 1, end: 3, kind: 'point', series: 'MAIN_FUNDING' }],
        },
      }),
    );

    expect(cursors).toEqual(Array.from({ length: 8 }, () => NOW));
  });
});

describe('the history caption over the P2P and fiat walks', () => {
  const caughtUp = NOW - HOUR_MS;

  const behindWith = (walkName: WalkName, cursor: number | undefined): boolean =>
    isBinanceHistoryBehind({
      cursors: walkCursorsOf(withEveryCursor(caughtUp, { [walkName]: { cursor } })),
      lastBalanceSyncAt: NOW,
    });

  it('is not behind while all eight walks are within a day of the balance sync', () => {
    expect(
      isBinanceHistoryBehind({
        cursors: walkCursorsOf(withEveryCursor(caughtUp, {})),
        lastBalanceSyncAt: NOW,
      }),
    ).toBe(false);
  });

  it.each(['p2p', 'fiatOrders', 'fiatPayments'] as const)(
    'shows the caption while the %s walk is behind',
    (walkName) => {
      expect(behindWith(walkName, undefined)).toBe(true);
      expect(behindWith(walkName, NOW - 2 * DAY_MS)).toBe(true);
      expect(behindWith(walkName, NOW - HOUR_MS)).toBe(false);
    },
  );

  it('is behind while the P2P walk is held more than a day by a page it cannot read', () => {
    expect(behindWith('p2p', NOW - DAY_MS)).toBe(false);
    expect(behindWith('p2p', NOW - DAY_MS - 1)).toBe(true);
  });
});
