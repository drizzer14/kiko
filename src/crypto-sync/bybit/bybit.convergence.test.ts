import { DAY_MS } from '@kiko/dates';
import { sweep } from '@kiko/test-support/property-sweep';
import { walkStateFake } from '@kiko/test-support/walk-marks';
import { type Random, seededRandom } from '@kiko/test-support/seeded-random';

import {
  FLOOR,
  type RowSlot,
  SECOND_MS,
  type WorldSlots,
  accountOf,
  evenSlots,
  serveSlots,
} from './bybit.convergence-test-fixtures';
import { NOW } from './bybit.client-test-fixtures';
import { BYBIT_LANE_CALL_CAPS } from './bybit.history-budget';
import { withdrawalRow } from './bybit.history-test-fixtures';
import { ACCOUNT_ID, capitalWalkOf, served } from './bybit.capital-test-fixtures';

// Every row of this suite is built from the docs pages' samples: no page with a row was read live.
// The walks are the real ones, through the real `planWalkPasses` and `runWalkPlan`, over a fake
// route that serves each seed. The numbers named MEASURED were read from this repository's walker
// on 2026-11-06.
const SEEDS = sweep(Array.from({ length: 20 }, (_unused, position) => 23 + position * 13));

// Small consecutive seeds of the Lehmer generator draw the same first value, so each seed is
// spread before it is used.
const SEED_SPREAD = 1_000_003;

const HOUR_MS = 3_600_000;
const WINDOW_MS = 7 * DAY_MS;
const CLOCK_GAPS = [0, HOUR_MS, DAY_MS];
const MAX_RUNS = 300;
const KILLED = 'run killed by the test';
const COINS = ['BTC', 'ETH', 'USDT', 'EUR'];
const WALKS = ['capital', 'transfer'] as const;

// The random worlds keep the densest day of a series inside what a lane reads (8 pages), because a
// day with more rows than a lane's calls never commits, an accepted limit. The named burst seed is
// the densest world, 15 pages a day.
const MAX_ROWS_PER_SERIES = 24;
const PAGE_SIZES = [3, 5, 10, 50];
const ORDERS = ['ascending', 'descending', 'scrambled'] as const;
const EXTENTS = [DAY_MS, WINDOW_MS, 60 * DAY_MS, 700 * DAY_MS];

const pick = <Entry>(random: Random, entries: readonly Entry[]): Entry =>
  entries[Math.floor(random() * entries.length)] as Entry;

// A run killed before its first cursor is stored restarts one clock gap later, with a floor that
// trails the clock by the same gap: a row in the first day of the history has aged out of it, in
// the uninterrupted world too if it had started later. So no row is drawn in the first day.
const OLDEST_ROW_MS = FLOOR + DAY_MS + HOUR_MS;

const randomSlots = (random: Random): RowSlot[] => {
  const extent = pick(random, EXTENTS);
  const from = OLDEST_ROW_MS + Math.floor(random() * (NOW - HOUR_MS - extent - OLDEST_ROW_MS));
  const count = Math.floor(random() * (MAX_ROWS_PER_SERIES + 1));

  return Array.from({ length: count }, (_unused, id) => ({
    id,
    at: Math.floor((from + random() * extent) / SECOND_MS) * SECOND_MS,
    coin: pick(random, COINS),
    amount: String(1 + Math.floor(random() * 9)),
  }));
};

const randomWorld = (seed: number) => {
  const random = seededRandom(seed * SEED_SPREAD);
  const slots: WorldSlots = {
    deposit: randomSlots(random),
    internal: randomSlots(random),
    withdraw: randomSlots(random),
    transfer: randomSlots(random),
  };

  return { slots, fake: { pageSize: pick(random, PAGE_SIZES), order: pick(random, ORDERS) } };
};

type Account = ReturnType<typeof accountOf<ReturnType<typeof walkStateFake>>>;

const newAccount = (fake?: Parameters<typeof accountOf>[0]['fake'], beforeWrite?: () => void) =>
  accountOf({ state: walkStateFake({ accountId: ACCOUNT_ID }), fake, beforeWrite });

const accountOfSeed = (seed: number, beforeWrite?: () => void): Account => {
  const { slots, fake } = randomWorld(seed);
  const account = newAccount(fake, beforeWrite);

  serveSlots(account, slots);

  return account;
};

type SettlingWalk = Account['capital'] | Account['transfer'];

/**
 * Run a walk, one run after another with the clock moving by `gap` between them, until a run is
 * complete. A run the test killed counts as a run and is not complete.
 */
const settle = async (walk: SettlingWalk, gap: number) => {
  let runs = 0;
  let killed = 0;
  let busiestRun = 0;
  const cursors: number[] = [];

  while (runs < MAX_RUNS) {
    const before = walk.reads.length;
    let complete = false;

    runs += 1;

    try {
      complete = (await walk.run()).complete;
    } catch (error) {
      if (!(error instanceof Error) || error.message !== KILLED) {
        throw error;
      }

      killed += 1;
    }

    busiestRun = Math.max(busiestRun, walk.reads.length - before);
    cursors.push(Number(walk.marks().cursor ?? 0));

    if (complete) {
      break;
    }

    walk.clock.now += gap;
  }

  return { runs, calls: walk.reads.length, killed, busiestRun, cursors };
};

// Two walks that moved their clocks by different numbers of runs end their cursors at different
// instants, so each is brought to one instant past both before the marks are compared.
const COMMON_END = NOW + 60 * DAY_MS;

const settleToCommonEnd = async (walk: SettlingWalk, gap: number) => {
  const first = await settle(walk, gap);

  walk.clock.now = COMMON_END;

  const second = await settle(walk, 0);

  return { killed: first.killed + second.killed };
};

const rowsOf = (walk: SettlingWalk) =>
  [...walk.rows()].sort((left, right) => left.externalId.localeCompare(right.externalId));

// Where each round-robin reads next. It moves with every read of owed ground, so a run killed and
// restarted rests at another position of the same rotation, which changes no row and no ground.
const ROTATION_MARKS = ['pointCursor', 'rangeCursor', 'backfillCursor', 'backfillTurn'];

// A restart can leave the hint lists stored empty where an uninterrupted run left none: both hold
// no span.
const holdsNoSpan = (hints: unknown): boolean =>
  typeof hints === 'object' &&
  hints !== null &&
  Object.values(hints).every((spans) => Array.isArray(spans) && spans.length === 0);

/** The marks that say what is read and what is owed, without the rotation positions. */
const groundMarksOf = (walk: SettlingWalk) =>
  Object.fromEntries(
    Object.entries(walk.marks()).filter(
      ([field, value]) =>
        !ROTATION_MARKS.includes(field) && !(field === 'spanHints' && holdsNoSpan(value)),
    ),
  );

/** The rows the walk's repository took as new, over every `addTransactions` call. */
const newRowsAdded = async (walk: SettlingWalk, fromCall = 0): Promise<number> => {
  const { results } = (walk.deps.addTransactions as jest.Mock).mock;
  const counts: number[] = await Promise.all(
    results.slice(fromCall).map((result) => result.value as Promise<number>),
  );

  return counts.reduce((total, count) => total + count, 0);
};

type WalkBound = {
  /** The convergence table's number for this seed. */
  table: { runs: number; calls: number };
  /** The table's runs is a count to stay within, or a lower bound the walker must reach. */
  tableRuns: 'ceiling' | 'floor';
  /** MEASURED, the most any clock gap needed: a regression ceiling, never a looser bound. */
  measured: { runs: number; calls: number };
};

type NamedSeed = {
  name: string;
  slots: () => WorldSlots;
  rows: Record<(typeof WALKS)[number], number>;
  bounds: Record<(typeof WALKS)[number], WalkBound>;
};

const BURST_FROM = FLOOR + 50 * WINDOW_MS;
const BURST_ROWS = 5_000;

const burstSlots = (count: number, from = BURST_FROM): RowSlot[] =>
  evenSlots(count, from + HOUR_MS, from + WINDOW_MS - HOUR_MS);

const SMALL_CAPITAL: WalkBound = {
  table: { runs: 3, calls: 81 },
  tableRuns: 'ceiling',
  measured: { runs: 3, calls: 84 },
};

const ONE_PAGE_TRANSFER: WalkBound = {
  table: { runs: 6, calls: 106 },
  tableRuns: 'ceiling',
  measured: { runs: 6, calls: 110 },
};

const NAMED_SEEDS: NamedSeed[] = [
  {
    name: 'small account',
    slots: () => ({
      deposit: evenSlots(40),
      internal: evenSlots(40),
      withdraw: evenSlots(40),
      transfer: evenSlots(40),
    }),
    rows: { capital: 120, transfer: 80 },
    bounds: { capital: SMALL_CAPITAL, transfer: ONE_PAGE_TRANSFER },
  },
  {
    name: 'busy',
    slots: () => ({
      deposit: evenSlots(1_000),
      internal: evenSlots(1_000),
      withdraw: evenSlots(1_000),
      transfer: evenSlots(1_000),
    }),
    rows: { capital: 3_000, transfer: 2_000 },
    bounds: { capital: SMALL_CAPITAL, transfer: ONE_PAGE_TRANSFER },
  },
  {
    name: 'heavy',
    slots: () => ({
      deposit: evenSlots(5_000),
      internal: evenSlots(5_000),
      withdraw: evenSlots(5_000),
      transfer: evenSlots(5_000),
    }),
    rows: { capital: 15_000, transfer: 10_000 },
    bounds: {
      capital: {
        table: { runs: 13, calls: 315 },
        tableRuns: 'floor',
        measured: { runs: 15, calls: 422 },
      },
      transfer: ONE_PAGE_TRANSFER,
    },
  },
  {
    name: 'burst',
    slots: () => ({
      deposit: evenSlots(40),
      internal: evenSlots(40),
      withdraw: evenSlots(40),
      transfer: burstSlots(BURST_ROWS),
    }),
    rows: { capital: 120, transfer: 2 * BURST_ROWS },
    bounds: {
      capital: SMALL_CAPITAL,
      transfer: {
        table: { runs: 8, calls: 106 },
        tableRuns: 'floor',
        measured: { runs: 34, calls: 676 },
      },
    },
  },
];

const BURST_SEED = NAMED_SEEDS[3];

/** The runs between one commit of the forward cursor and the next, to the end of that pass. */
const spacingsOf = (cursors: number[]): number[] => {
  const forwardRuns = cursors.slice(0, cursors.findIndex((cursor) => cursor >= NOW) + 1);
  const commits = forwardRuns.flatMap((cursor, run) =>
    cursor > (forwardRuns[run - 1] ?? 0) ? [run] : [],
  );

  return commits.slice(1).map((run, position) => run - commits[position]);
};

describe('Bybit convergence', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('draws worlds that differ from seed to seed, with rows in both walks, every page shape and every coin', () => {
    const worlds = SEEDS.map((seed) => randomWorld(seed));
    const rows = worlds.map(({ slots }) => slots);

    expect(new Set(worlds.map((world) => JSON.stringify(world))).size).toBe(SEEDS.length);
    expect(rows.every((slots) => slots.transfer.length + slots.deposit.length > 0)).toBe(true);
    expect(new Set(worlds.map(({ fake }) => fake.order)).size).toBeGreaterThan(1);
    expect(new Set(worlds.map(({ fake }) => fake.pageSize)).size).toBeGreaterThan(1);
    expect(new Set(rows.flatMap((slots) => slots.transfer.map(({ coin }) => coin))).size).toBe(
      COINS.length,
    );
  });

  describe.each(CLOCK_GAPS)('at a clock gap of %i ms', (gap) => {
    it.each(NAMED_SEEDS)(
      "reaches the floor within the table's runs: the $name seed",
      async ({ slots, rows, bounds }) => {
        const account = newAccount();

        serveSlots(account, slots());

        for (const name of WALKS) {
          const { table, tableRuns, measured } = bounds[name];
          const outcome = await settle(account[name], gap);

          expect(rowsOf(account[name])).toHaveLength(rows[name]);
          expect(outcome.runs).toBeLessThan(MAX_RUNS);
          expect(outcome.busiestRun).toBeLessThanOrEqual(BYBIT_LANE_CALL_CAPS[name]);
          expect(outcome.calls).toBeGreaterThanOrEqual(table.calls);
          expect(outcome.calls).toBeLessThanOrEqual(measured.calls);
          expect(outcome.runs).toBeLessThanOrEqual(measured.runs);

          if (tableRuns === 'ceiling') {
            expect(outcome.runs).toBeLessThanOrEqual(table.runs);
          } else {
            expect(outcome.runs).toBeGreaterThanOrEqual(table.runs);
          }
        }
      },
    );

    it('a burst commits at least one span per run after its halvings', async () => {
      const account = newAccount();

      serveSlots(account, BURST_SEED.slots());

      const { cursors } = await settle(account.transfer, gap);
      const first = cursors.findIndex((cursor) => cursor > BURST_FROM);
      const last = cursors.findIndex((cursor) => cursor >= BURST_FROM + WINDOW_MS);
      const inBurst = cursors.slice(first, last + 1);

      expect(first).toBeGreaterThan(0);
      expect(inBurst.slice(1).every((cursor, run) => cursor > inBurst[run])).toBe(true);
    });

    it('a burst of 5,000 transfers halves three times, then commits a span every run', async () => {
      const account = newAccount();

      serveSlots(account, BURST_SEED.slots());

      const spacings = spacingsOf((await settle(account.transfer, gap)).cursors);

      expect(spacings).toEqual([1, 1, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    });

    it.each(SEEDS)(
      'a burst commits a span within its halvings and one run of the last one, and the cursor never moves back: seed %i',
      async (seed) => {
        const random = seededRandom(seed * SEED_SPREAD);
        const count = 1_200 + Math.floor(random() * 3_600);
        const account = newAccount();

        serveSlots(account, {
          deposit: [],
          internal: [],
          withdraw: [],
          transfer: burstSlots(count, FLOOR + Math.floor(random() * 100) * WINDOW_MS),
        });

        const { cursors } = await settle(account.transfer, gap);
        const spacings = spacingsOf(cursors);

        expect(rowsOf(account.transfer)).toHaveLength(2 * count);
        expect(cursors).toEqual([...cursors].sort((left, right) => left - right));
        expect(spacings.length).toBeGreaterThan(0);
        expect(Math.max(...spacings)).toBeLessThanOrEqual(4);
      },
    );

    it.each(SEEDS)(
      'a killed run converges to the rows of an uninterrupted one: seed %i',
      async (seed) => {
        for (const name of WALKS) {
          let writes = 0;
          const reference = accountOfSeed(seed, () => {
            writes += 1;
          });

          await settleToCommonEnd(reference[name], gap);

          const referenceRows = rowsOf(reference[name]);

          expect(writes).toBeGreaterThan(0);

          for (let cut = 1; cut <= writes; cut += 1) {
            let seen = 0;
            const account = accountOfSeed(seed, () => {
              seen += 1;

              if (seen === cut) {
                throw new Error(KILLED);
              }
            });
            const outcome = await settleToCommonEnd(account[name], gap);

            expect({ name, cut, killed: outcome.killed }).toEqual({ name, cut, killed: 1 });
            expect({ name, cut, rows: rowsOf(account[name]) }).toEqual({
              name,
              cut,
              rows: referenceRows,
            });
            expect({ name, cut, marks: groundMarksOf(account[name]) }).toEqual({
              name,
              cut,
              marks: groundMarksOf(reference[name]),
            });
          }
        }
      },
      120_000,
    );

    it.each(SEEDS)('reading every window twice adds no row: seed %i', async (seed) => {
      const account = accountOfSeed(seed);

      for (const name of WALKS) {
        const walk = account[name];

        await settle(walk, gap);

        const rows = rowsOf(walk);
        const callsBefore = (walk.deps.addTransactions as jest.Mock).mock.calls.length;
        const readsBefore = walk.reads.length;

        account.state.seed(name, { cursor: walk.clock.now - 729 * DAY_MS });
        await settle(walk, gap);

        const calls = (walk.deps.addTransactions as jest.Mock).mock.calls.length - callsBefore;

        expect(walk.reads.length).toBeGreaterThan(readsBefore);
        expect(calls > 0).toBe(rows.length > 0);
        expect(await newRowsAdded(walk, callsBefore)).toBe(0);
        expect(rowsOf(walk)).toEqual(rows);
      }
    });

    it.each(SEEDS)('a Bybit walk writes no multi-coin mark: seed %i', async (seed) => {
      const account = accountOfSeed(seed);

      await settle(account.capital, gap);
      await settle(account.transfer, gap);

      const fields = account.state.writes().map(({ field }) => field);

      expect(fields).toContain('cursor');
      expect(fields).not.toContain('multiCoinSince');
      expect(fields).not.toContain('multiCoinSeen');

      for (const name of WALKS) {
        expect(account[name].marks()).not.toHaveProperty('multiCoinSince');
        expect(account[name].marks()).not.toHaveProperty('multiCoinSeen');
      }
    });
  });

  /**
   * A withdrawal pending at the first read, whose `createTime` is `pendingDays` old and in an
   * earlier window than its `updateTime` when it settles. The fake route filters on one of the two
   * fields, as the docs name neither.
   */
  const withdrawalSettledLater = async (
    windowField: 'createTime' | 'updateTime',
    pendingDays: number,
  ) => {
    const created = NOW - pendingDays * DAY_MS;
    const walk = capitalWalkOf({
      state: walkStateFake({
        accountId: ACCOUNT_ID,
        marks: { capital: { cursor: created - 10 * DAY_MS } },
      }),
    });
    const withdrawal = (status: string, updated: number) =>
      served(
        windowField === 'createTime' ? created : updated,
        withdrawalRow({
          withdrawId: 'late',
          status,
          coin: 'BTC',
          amount: '0.125',
          createTime: String(created),
          updateTime: String(updated),
        }),
      );

    walk.world.withdraw = [withdrawal('Pending', created + SECOND_MS)];
    await walk.run();

    expect(walk.keys()).toEqual([]);
    expect(walk.marks().pending).toEqual([
      { start: created - 1, end: created + 1, kind: 'point', series: 'withdraw', since: NOW },
    ]);

    walk.world.withdraw = [withdrawal('success', NOW + 2 * DAY_MS)];
    walk.clock.now = NOW + 3 * DAY_MS;
    await settle(walk, DAY_MS);

    // A window on `updateTime` returns the row on the forward pass; the next run's re-scan holds
    // both of its times, and clears the point.
    walk.clock.now += DAY_MS;
    await settle(walk, DAY_MS);

    return { keys: walk.keys(), added: await newRowsAdded(walk), pending: walk.marks().pending };
  };

  it('a withdrawal that settles later imports once and leaves no point, whichever time the window filters on', async () => {
    for (const windowField of ['createTime', 'updateTime'] as const) {
      expect({ windowField, ...(await withdrawalSettledLater(windowField, 12)) }).toEqual({
        windowField,
        keys: ['acc-1:withdraw:late:BTC'],
        added: 1,
        pending: [],
      });
    }
  });

  it('a withdrawal pending over 29 days keeps its point when the window filters on updateTime, and clears it on createTime', async () => {
    const point = {
      start: NOW - 90 * DAY_MS - 1,
      end: NOW - 90 * DAY_MS + 1,
      kind: 'point',
      series: 'withdraw',
      since: NOW,
    };

    expect(await withdrawalSettledLater('createTime', 90)).toEqual({
      keys: ['acc-1:withdraw:late:BTC'],
      added: 1,
      pending: [],
    });
    expect(await withdrawalSettledLater('updateTime', 90)).toEqual({
      keys: ['acc-1:withdraw:late:BTC'],
      added: 1,
      pending: [point],
    });
  });
});
