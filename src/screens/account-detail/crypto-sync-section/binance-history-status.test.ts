import { DAY_MS } from '@kiko/dates';
import { parseExchangeState } from '@kiko/crypto-sync/exchange/walk-state';
import { type WalkMarkSeed, type WalkName, withWalkMarkSeeds } from '@kiko/test-support/walk-marks';

import {
  historyOwesRange,
  historyOwesTrades,
  isBinanceHistoryBehind,
  p2pReadFailed,
  walkCursorsOf,
} from './binance-history-status';

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
      expect(historyOwesRange(owing(walkName, owed), NOW, 'binance')).toBe(true);
    });

    it.each([
      ['no list', undefined],
      ['an empty list', []],
      ['only a point', [{ start: 1, end: 3, kind: 'point', series: 'MAIN_FUNDING' }]],
      [
        'only a point owed since a few hours',
        [{ start: 1, end: 3, kind: 'point', series: 'MAIN_FUNDING', since: NOW - HOUR_MS }],
      ],
      [
        'only a point owed since exactly a day',
        [{ start: 1, end: 3, kind: 'point', series: 'MAIN_FUNDING', since: NOW - DAY_MS }],
      ],
      [
        'only a point stamped after the balance sync',
        [{ start: 1, end: 3, kind: 'point', series: 'MAIN_FUNDING', since: NOW + DAY_MS }],
      ],
      [
        'only a point whose `since` is not a time',
        [{ start: 1, end: 3, kind: 'point', series: 'MAIN_FUNDING', since: '0' }],
      ],
      ['a list that is not well formed', 'x'],
    ])('is false for %s', (_label, owed) => {
      expect(historyOwesRange(owing(walkName, owed), NOW, 'binance')).toBe(false);
    });

    it.each([
      ['a day and a millisecond', NOW - DAY_MS - 1],
      ['a week', NOW - 7 * DAY_MS],
      ['the start of the epoch', 0],
    ])('is true for a point owed since %s', (_label, since) => {
      const owed = [{ start: 1, end: 3, kind: 'point', series: 'MAIN_FUNDING', since }];

      expect(historyOwesRange(owing(walkName, owed), NOW, 'binance')).toBe(true);
    });

    it('is true for an old point beside fresh ones', () => {
      const owed = [
        { start: 1, end: 3, kind: 'point', since: NOW - HOUR_MS },
        { start: 5, end: 7, kind: 'point' },
        { start: 9, end: 11, kind: 'point', since: NOW - 2 * DAY_MS },
      ];

      expect(historyOwesRange(owing(walkName, owed), NOW, 'binance')).toBe(true);
    });

    it('is false for an old point while the account has never synced', () => {
      const owed = [{ start: 1, end: 3, kind: 'point', since: NOW - 2 * DAY_MS }];

      expect(historyOwesRange(owing(walkName, owed), null, 'binance')).toBe(false);
    });
  });

  describe('the overlap day a forward turn plans', () => {
    const dayEndingAt = (end: number, over: Record<string, unknown> = {}) => ({
      start: end - DAY_MS,
      end,
      ...over,
    });

    const NOT_KEPT_WALK_NAMES = CAPTION_WALK_NAMES.filter((walkName) => walkName !== 'fiatOrders');

    // The forward turn stores the day with a cursor that has moved on, so it ends before it.
    it.each([
      ['ending at the cursor', dayEndingAt(NOW)],
      ['ending before the cursor', dayEndingAt(NOW - 2 * HOUR_MS)],
    ])('is not owed by the fiat orders walk when it is the day %s', (_label, day) => {
      expect(historyOwesRange(owing('fiatOrders', [day]), NOW, 'binance')).toBe(false);
    });

    it.each([
      ['a day owed in one series', dayEndingAt(NOW, { series: 'MAIN_FUNDING' })],
      ['a day ending after the cursor', dayEndingAt(NOW + 1)],
      ['a range a millisecond wider than the day', { start: NOW - DAY_MS - 1, end: NOW }],
      ['a range a millisecond narrower than the day', { start: NOW - DAY_MS + 1, end: NOW }],
      ['a range wider than the day, ending at the cursor', { start: NOW - 3 * DAY_MS, end: NOW }],
    ])('is owed by the fiat orders walk as %s', (_label, range) => {
      expect(historyOwesRange(owing('fiatOrders', [range]), NOW, 'binance')).toBe(true);
    });

    it('is owed by the fiat orders walk beside a range that is not the day', () => {
      const owed = [dayEndingAt(NOW), { start: 1, end: 3 }];

      expect(historyOwesRange(owing('fiatOrders', owed), NOW, 'binance')).toBe(true);
    });

    it('is owed by the fiat orders walk that has no cursor', () => {
      const state = stateOf({ fiatOrders: { pending: [dayEndingAt(NOW)] } });

      expect(historyOwesRange(state, NOW, 'binance')).toBe(true);
    });

    it.each(NOT_KEPT_WALK_NAMES)(
      'is owed by the %s walk, which reads that day in the run that plans it',
      (walkName) => {
        expect(historyOwesRange(owing(walkName, [dayEndingAt(NOW)]), NOW, 'binance')).toBe(true);
        expect(
          historyOwesRange(owing(walkName, [dayEndingAt(NOW - 2 * HOUR_MS)]), NOW, 'binance'),
        ).toBe(true);
      },
    );
  });

  it('is true when one walk owes a range, whichever the others hold', () => {
    expect(
      historyOwesRange(
        stateOf({
          capital: { cursor: NOW, pending: [] },
          earn: { cursor: NOW, pending: [{ start: 1, end: 3, kind: 'point' }] },
          fiatPayments: { cursor: NOW, pending: [{ start: 1, end: 3 }] },
        }),
        NOW,
        'binance',
      ),
    ).toBe(true);
  });

  it('is true when one walk owes an old point, whichever the others hold', () => {
    expect(
      historyOwesRange(
        stateOf({
          capital: { cursor: NOW, pending: [] },
          earn: { cursor: NOW, pending: [{ start: 1, end: 3, kind: 'point' }] },
          p2p: {
            cursor: NOW,
            pending: [{ start: 1, end: 3, kind: 'point', since: NOW - 2 * DAY_MS }],
          },
        }),
        NOW,
        'binance',
      ),
    ).toBe(true);
  });

  it.each([
    ['no state row', null],
    ['a state that is not readable', '{not json'],
  ])('is false for %s', (_label, text) => {
    expect(historyOwesRange(parseExchangeState(text), NOW, 'binance')).toBe(false);
  });
});

describe('the history caption while a backfill range is owed', () => {
  const caughtUp = NOW - HOUR_MS;
  const backfillRange = { start: 1, end: 3, scope: 'backfill' };

  const behindOwing = (walkName: WalkName, owed: unknown[]): boolean => {
    const state = withEveryCursor(caughtUp, { [walkName]: { cursor: caughtUp, pending: owed } });

    return isBinanceHistoryBehind({
      cursors: walkCursorsOf(state, 'binance'),
      lastBalanceSyncAt: NOW,
      owesRange: historyOwesRange(state, NOW, 'binance'),
    });
  };

  it.each(['capital', 'pay', 'transfer', 'earn'] as const)(
    'is behind while the %s walk owes a backfill range, though every cursor is current',
    (walkName) => {
      expect(behindOwing(walkName, [backfillRange])).toBe(true);
      expect(behindOwing(walkName, [])).toBe(false);
    },
  );
});

describe('the history caption over the trade symbols', () => {
  const caughtUp = NOW - HOUR_MS;

  const everyCursor = Object.fromEntries(
    CAPTION_WALK_NAMES.map((walkName) => [walkName, { cursor: caughtUp }]),
  );

  const stateWithTrades = (trades: unknown) =>
    parseExchangeState(JSON.stringify({ ...withWalkMarkSeeds({}, 'acc-1', everyCursor), trades }));

  const behindWith = (state: ReturnType<typeof parseExchangeState>, syncedAt: number | null) =>
    isBinanceHistoryBehind({
      cursors: walkCursorsOf(state, 'binance'),
      lastBalanceSyncAt: syncedAt,
      tradesUnread: historyOwesTrades(state),
    });

  it('is behind while a candidate trade symbol was never read', () => {
    const state = stateWithTrades({
      symbols: { ETHUSDT: { fromId: 7 } },
      unreadSymbols: ['BTCUSDT'],
    });

    expect(behindWith(state, NOW)).toBe(true);
  });

  it('is not behind once every candidate trade symbol was read, an empty read too', () => {
    const state = stateWithTrades({
      symbols: { BTCUSDT: { fromId: 0 }, ETHUSDT: { fromId: 7 } },
      unreadSymbols: [],
    });

    expect(behindWith(state, NOW)).toBe(false);
  });

  it('is not behind for a state with no trades at all, or no list of unread symbols', () => {
    expect(behindWith(stateWithTrades(undefined), NOW)).toBe(false);
    expect(behindWith(stateWithTrades({ symbols: { ETHUSDT: { fromId: null } } }), NOW)).toBe(
      false,
    );
  });

  it('is not behind for a list of unread symbols that is not a list of texts', () => {
    expect(behindWith(stateWithTrades({ unreadSymbols: [1, 'BTCUSDT'] }), NOW)).toBe(false);
    expect(behindWith(stateWithTrades({ unreadSymbols: 'BTCUSDT' }), NOW)).toBe(false);
  });

  it('is not behind before the account has ever synced', () => {
    expect(behindWith(stateWithTrades({ unreadSymbols: ['BTCUSDT'] }), null)).toBe(false);
  });

  it('owes no trades for a state that is not readable', () => {
    expect(historyOwesTrades(parseExchangeState('{not json'))).toBe(false);
    expect(historyOwesTrades(parseExchangeState(null))).toBe(false);
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

    expect(walkCursorsOf(state, 'binance')).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('reads a cursor a walk has not written yet as null', () => {
    expect(walkCursorsOf(stateOf({ capital: { cursor: NOW } }), 'binance')).toEqual([
      NOW,
      ...Array.from({ length: 7 }, () => null),
    ]);
  });

  it.each(CAPTION_WALK_NAMES.map((walkName, position) => [walkName, position] as const))(
    'reads the %s walk by its own cursor, whichever other walks have one',
    (walkName, position) => {
      expect(walkCursorsOf(stateOf({ [walkName]: { cursor: NOW } }), 'binance')).toEqual(
        CAPTION_WALK_NAMES.map((_unused, index) => (index === position ? NOW : null)),
      );
    },
  );

  it.each([
    ['no state row', null],
    ['a state that is not readable', '{not json'],
  ])('is eight nulls for %s', (_label, text) => {
    expect(walkCursorsOf(parseExchangeState(text), 'binance')).toEqual(
      Array.from({ length: 8 }, () => null),
    );
  });

  it('does not read an owed point as a cursor: a list of ground changes nothing', () => {
    const cursors = walkCursorsOf(
      withEveryCursor(NOW, {
        transfer: {
          cursor: NOW,
          pending: [{ start: 1, end: 3, kind: 'point', series: 'MAIN_FUNDING' }],
        },
      }),
      'binance',
    );

    expect(cursors).toEqual(Array.from({ length: 8 }, () => NOW));
  });
});

describe('the history caption over the P2P and fiat walks', () => {
  const caughtUp = NOW - HOUR_MS;

  const behindWith = (walkName: WalkName, cursor: number | undefined): boolean =>
    isBinanceHistoryBehind({
      cursors: walkCursorsOf(withEveryCursor(caughtUp, { [walkName]: { cursor } }), 'binance'),
      lastBalanceSyncAt: NOW,
    });

  it('is not behind while all eight walks are within a day of the balance sync', () => {
    expect(
      isBinanceHistoryBehind({
        cursors: walkCursorsOf(withEveryCursor(caughtUp, {}), 'binance'),
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

describe('the caption walks of each provider', () => {
  const owedCapital = () => stateOf({ capital: { cursor: NOW, pending: [{ start: 1, end: 3 }] } });

  it('Binance compares its 8 walks and Bybit compares only its own', () => {
    const state = withEveryCursor(NOW, {});

    expect(walkCursorsOf(state, 'binance')).toHaveLength(8);
    expect(walkCursorsOf(state, 'bybit')).toEqual([NOW]);
  });

  it('Bybit compares the capital walk alone, and no cursor of a state it cannot read', () => {
    const state = stateOf({
      capital: { cursor: NOW - HOUR_MS },
      pay: { cursor: NOW - 9 * DAY_MS },
    });

    expect(walkCursorsOf(state, 'bybit')).toEqual([NOW - HOUR_MS]);
    expect(walkCursorsOf(parseExchangeState('{not json'), 'bybit')).toEqual([null]);
    expect(walkCursorsOf(stateOf({}), 'bybit')).toEqual([null]);
  });

  it('Bybit owes a range of its capital walk, and no range of a walk it does not read', () => {
    const owedPay = stateOf({ pay: { cursor: NOW, pending: [{ start: 1, end: 3 }] } });

    expect(historyOwesRange(owedCapital(), NOW, 'bybit')).toBe(true);
    expect(historyOwesRange(owedPay, NOW, 'bybit')).toBe(false);
    expect(historyOwesRange(owedPay, NOW, 'binance')).toBe(true);
  });

  it('Bybit shows the caption for a range tagged with a series, as it does for any owed range', () => {
    const owedDeposit = stateOf({
      capital: { cursor: NOW, pending: [{ start: 1, end: 3, series: 'deposit' }] },
    });

    expect(historyOwesRange(owedDeposit, NOW, 'bybit')).toBe(true);
  });

  const WITHOUT_WALKS = ['btc_wallet'] as const;

  it.each(WITHOUT_WALKS)('compares no walk for %s, a state it cannot read too', (provider) => {
    expect(walkCursorsOf(withEveryCursor(NOW, {}), provider)).toEqual([]);
    expect(walkCursorsOf(parseExchangeState('{not json'), provider)).toEqual([]);
  });

  it.each(WITHOUT_WALKS)('is never behind for %s, whatever the Binance walks hold', (provider) => {
    const state = owedCapital();

    expect(historyOwesRange(state, NOW, 'binance')).toBe(true);
    expect(historyOwesRange(state, NOW, provider)).toBe(false);
    expect(
      isBinanceHistoryBehind({
        cursors: walkCursorsOf(stateOf({}), provider),
        lastBalanceSyncAt: NOW,
        owesRange: historyOwesRange(state, NOW, provider),
      }),
    ).toBe(false);
  });
});

describe('p2pReadFailed', () => {
  it('is true when the P2P walk entry holds a read-failed time', () => {
    expect(p2pReadFailed(stateOf({ p2p: { cursor: NOW, readFailedAt: NOW } }))).toBe(true);
  });

  it.each([
    ['holds no read-failed time', { cursor: NOW }],
    ['holds a null read-failed time', { cursor: NOW, readFailedAt: null }],
  ])('is false when the P2P walk entry %s', (_label, entry) => {
    expect(p2pReadFailed(stateOf({ p2p: entry }))).toBe(false);
  });

  it('is false when the state holds no P2P walk entry', () => {
    expect(p2pReadFailed(stateOf({ capital: { cursor: NOW, readFailedAt: NOW } }))).toBe(false);
  });
});
