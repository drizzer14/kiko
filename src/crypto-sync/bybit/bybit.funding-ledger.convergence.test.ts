import { DAY_MS } from '@kiko/dates';
import { walkStateFake } from '@kiko/test-support/walk-marks';

import { NOW } from './bybit.client-test-fixtures';
import { ACCOUNT_ID } from './bybit.capital-test-fixtures';
import { fundingLedgerWalkOf, ledgerAt } from './bybit.funding-ledger-test-fixtures';

// The walk is the real one, through the real `planWalkPasses` and `runWalkPlan`, over a fake route
// that serves 5 rows a page, so a lane of 20 pages holds 100 rows. Every row is built from the
// field words of the page's one sample: no page with a real row was read live.
const SECOND_MS = 1_000;
const HOUR_MS = 3_600_000;
const GAPS = [0, HOUR_MS, DAY_MS];
const PAGE_SIZE = 5;
const LANE_ROWS = 20 * PAGE_SIZE;
const MAX_RUNS = 200;

const newWalk = (cursor: number) =>
  fundingLedgerWalkOf({
    state: walkStateFake({ accountId: ACCOUNT_ID, marks: { fundingLedger: { cursor } } }),
    fake: { pageSize: PAGE_SIZE },
  });

type Walk = ReturnType<typeof newWalk>;

/** `count` rows at one instant, each on its own key, so a burst is the lane's rows in a second. */
const burstAt = (count: number, at: number, name = 'burst') =>
  Array.from({ length: count }, (_unused, index) =>
    ledgerAt(at, { currcCursor: `${name}-${index}` }),
  );

/** Runs one after another, the clock moving by `gap` between them, until one is complete. */
const settle = async (walk: Walk, gap: number) => {
  let runs = 0;
  let isFinished = false;

  while (runs < MAX_RUNS && !isFinished) {
    runs += 1;
    isFinished = (await walk.run()).complete;

    if (!isFinished) {
      walk.clock.now += gap;
    }
  }

  return { runs, isFinished };
};

const denseMarkOf = async (walk: Walk) =>
  (JSON.parse((await walk.readState()) ?? '{}') as { denseSpans?: { fundingLedger?: number } })
    .denseSpans?.fundingLedger;

const denseWritesOf = (walk: Walk): number =>
  (walk.deps.patchExchangeState as jest.Mock).mock.calls
    .flatMap(([, patches]) => patches as { kind: string }[])
    .filter(({ kind }) => kind === 'denseSpans').length;

describe.each(GAPS)('the Funding ledger walk over bursts, at a clock gap of %i ms', (gap) => {
  // The edge between two forward spans lies in the second of the burst, and the route reads whole
  // seconds, so both spans read the burst: a row read twice is harmless by its key, and the burst
  // that a lane holds is stored whole. The reads outside the forward pass lie behind the cursor,
  // which read this ground whole, so a split to a millisecond ends them.
  it('a burst that a forward span edge splits ends its owed ground with every row stored, and no mark', async () => {
    const edge = NOW - 3 * DAY_MS;
    const walk = newWalk(NOW - 10 * DAY_MS);

    walk.world.fundingLedger = burstAt(90, edge + 300);

    const outcome = await settle(walk, gap);

    expect(outcome.isFinished).toBe(true);
    expect(walk.ledgerKeys()).toHaveLength(90);
    expect(walk.marks().pending).toEqual([]);
    expect(await denseMarkOf(walk)).toBeUndefined();
  }, 120_000);

  it('the same burst 3 days old and fresh, in the middle of a window, ends its owed ground too', async () => {
    const walk = newWalk(NOW - 10 * DAY_MS);

    walk.world.fundingLedger = [
      ...burstAt(60, NOW - 3 * DAY_MS - 400, 'old'),
      ...burstAt(60, NOW - 2 * SECOND_MS - 400, 'fresh'),
    ];

    const outcome = await settle(walk, gap);

    expect(outcome.isFinished).toBe(true);
    expect(walk.ledgerKeys()).toHaveLength(120);
    expect(await denseMarkOf(walk)).toBeUndefined();
  }, 120_000);

  it('a burst over the lane in one second stops with its mark, written once, and spends its lane on every run', async () => {
    const walk = newWalk(NOW - 10 * DAY_MS);

    walk.world.fundingLedger = burstAt(LANE_ROWS + 20, NOW - 5 * DAY_MS + 300);

    const outcome = await settle(walk, gap);
    const mark = await denseMarkOf(walk);

    expect(outcome.isFinished).toBe(false);
    expect(mark).toBeGreaterThanOrEqual(NOW - 10 * DAY_MS);
    expect(mark).toBeLessThanOrEqual(NOW - 5 * DAY_MS + 300);
    expect(denseWritesOf(walk)).toBe(1);
    expect(walk.ledgerKeys().length).toBeLessThan(LANE_ROWS + 20);
  }, 120_000);

  it('a burst in two seconds that no span can split apart holds the lane the same way, with its mark', async () => {
    const walk = newWalk(NOW - 10 * DAY_MS);
    const second = NOW - 5 * DAY_MS;

    walk.world.fundingLedger = [
      ...burstAt(70, second + 100, 'first'),
      ...burstAt(70, second + SECOND_MS + 100, 'second'),
    ];

    const outcome = await settle(walk, gap);
    const mark = await denseMarkOf(walk);

    expect(outcome.isFinished).toBe(false);
    // A span of a second or less holds both burst seconds only when its whole seconds reach both,
    // so its start lies within a second of the first.
    expect(mark).toBeGreaterThan(second - SECOND_MS);
    expect(mark).toBeLessThan(second + SECOND_MS);
    expect(denseWritesOf(walk)).toBe(1);
  }, 120_000);

  it('an even history of 40 rows is read whole and ends', async () => {
    const walk = newWalk(NOW - 30 * DAY_MS);

    walk.world.fundingLedger = Array.from({ length: 40 }, (_unused, index) =>
      ledgerAt(NOW - 29 * DAY_MS + index * 17 * HOUR_MS, { currcCursor: `even-${index}` }),
    );

    const outcome = await settle(walk, gap);

    expect(outcome.isFinished).toBe(true);
    expect(walk.ledgerKeys()).toHaveLength(40);
    expect(await denseMarkOf(walk)).toBeUndefined();
  }, 120_000);
});

// Seeds of an account from its first read: the route serves 100 rows a page, as the walk asks for,
// and the floor trails the clock by 729 days. A window of 7 days less a second costs one call and
// one more per page past the first, so each floor comes from the windows and the pages of the
// short last window: 104 windows of 7 days less a second and a last window of 1 day and 104
// seconds.
const FLOOR_MS = NOW - 729 * DAY_MS;
const REAL_PAGE_SIZE = 100;
const WINDOWS = 105;

const freshWalk = (beforeWrite?: () => void) =>
  fundingLedgerWalkOf({
    state: walkStateFake({ accountId: ACCOUNT_ID }),
    fake: { pageSize: REAL_PAGE_SIZE },
    beforeWrite,
  });

/** `count` rows spread evenly from the start of the history to a day before the clock. */
const evenRows = (count: number, coins: readonly string[] = ['USDT']) => {
  const step = Math.floor((728 * DAY_MS - DAY_MS) / count);

  return Array.from({ length: count }, (_unused, index) =>
    ledgerAt(Math.floor((FLOOR_MS + DAY_MS + index * step) / SECOND_MS) * SECOND_MS, {
      currcCursor: `even-${index}`,
      currency: coins[index % coins.length],
    }),
  );
};

const SEEDS_BY_ROWS = [
  {
    name: 'a small account, under 100 rows a window',
    rows: () => evenRows(300),
    floor: WINDOWS,
    measured: [
      [0, 6, 105],
      [DAY_MS, 6, 105],
    ],
  },
  {
    name: 'a day of 150 rows, over 100 in a day, in a small account',
    rows: () => [
      ...evenRows(300),
      ...Array.from({ length: 150 }, (_unused, index) =>
        ledgerAt(NOW - 10 * DAY_MS + index * SECOND_MS, { currcCursor: `day-${index}` }),
      ),
    ],
    floor: WINDOWS + 1,
    measured: [
      [0, 6, 106],
      [DAY_MS, 6, 106],
    ],
  },
  {
    name: 'hourly yield on 1 coin, 168 rows a window',
    rows: () => evenRows(729 * 24 - 48),
    floor: WINDOWS + 104,
    measured: [
      [0, 11, 209],
      [DAY_MS, 11, 210],
    ],
  },
  {
    name: 'hourly yield on 5 coins, 840 rows a window',
    rows: () => evenRows(5 * (729 * 24 - 48), ['USDT', 'BTC', 'ETH', 'EUR', 'USD']),
    floor: WINDOWS + 104 * 8 + 1,
    // Over the floor: a window of 9 pages does not fit the calls a run has left, so it splits.
    measured: [
      [0, 52, 1040],
      [DAY_MS, 53, 1047],
    ],
  },
];

// `measured` is each run count and call count the walk reached, by clock gap (fake route).
describe.each(SEEDS_BY_ROWS)(
  'the Funding ledger over the seed: $name',
  ({ rows, floor, measured }) => {
    it.each(measured)(
      'reaches the end at a clock gap of %i ms in %i runs and %i calls, with every row stored',
      async (gap, runs, calls) => {
        const walk = freshWalk();

        walk.world.fundingLedger = rows();

        const outcome = await settle(walk, gap);

        expect({
          isFinished: outcome.isFinished,
          isWithinFloor: walk.reads.length >= floor,
          runs: outcome.runs,
          calls: walk.reads.length,
          stored: walk.ledgerKeys().length,
        }).toEqual({
          isFinished: true,
          isWithinFloor: true,
          runs,
          calls,
          stored: rows().length,
        });
      },
      600_000,
    );
  },
);

describe('the Funding ledger walk, killed and started again', () => {
  it('stores the same rows after a run is killed before each of its first writes', async () => {
    for (const killWrite of [1, 2, 3, 4]) {
      let writes = 0;
      const walk = freshWalk(() => {
        writes += 1;

        if (writes === killWrite) {
          throw new Error('run killed by the test');
        }
      });

      walk.world.fundingLedger = evenRows(300);

      await expect(walk.run()).rejects.toThrow('run killed by the test');

      const outcome = await settle(walk, 0);

      expect({
        killWrite,
        isFinished: outcome.isFinished,
        stored: walk.ledgerKeys().length,
      }).toEqual({ killWrite, isFinished: true, stored: 300 });
    }
  }, 600_000);
});
