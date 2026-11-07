import { DAY_MS } from '@kiko/dates';
import { sweep } from '@kiko/test-support/property-sweep';
import { walkStateFake } from '@kiko/test-support/walk-marks';
import { denseSpansOf } from '@kiko/crypto-sync/exchange/history-status';
import { parseExchangeState } from '@kiko/crypto-sync/exchange/walk-state';
import { type Random, seededRandom } from '@kiko/test-support/seeded-random';

import {
  FLOOR,
  type RowSlot,
  SECOND_MS,
  type WorldSlots,
  accountOf,
  burstOfRows,
  convertPagesOf,
  evenSlots,
  logAndConvertAccountOf,
  logRowOf,
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

type LogAndConvertAccount = ReturnType<
  typeof logAndConvertAccountOf<ReturnType<typeof walkStateFake>>
>;

type SettlingWalk =
  | Account['capital']
  | Account['transfer']
  | LogAndConvertAccount['log']
  | LogAndConvertAccount['convert'];

// The convert walk reads its list through its own route, which records the page index of each
// call; every other walk reads through the fake Bybit, which records each call.
const callsOf = (walk: SettlingWalk): number =>
  'indexes' in walk ? walk.indexes.length : walk.reads.length;

/**
 * Run a walk, one run after another with the clock moving by `gap` between them, until a run is
 * complete or `maxRuns` have run. A run the test killed counts as a run and is not complete.
 */
const settle = async (walk: SettlingWalk, gap: number, maxRuns = MAX_RUNS) => {
  let runs = 0;
  let killed = 0;
  let busiestRun = 0;
  let isFinished = false;
  const cursors: number[] = [];
  const callTotals: number[] = [];
  // The most any run left in the owed lists: a bound on what the state holds, run by run.
  const peaks = { pending: 0, points: 0, passOwed: 0 };

  while (runs < maxRuns && !isFinished) {
    const before = callsOf(walk);

    runs += 1;

    try {
      isFinished = (await walk.run()).complete;
    } catch (error) {
      if (!(error instanceof Error) || error.message !== KILLED) {
        throw error;
      }

      killed += 1;
    }

    busiestRun = Math.max(busiestRun, callsOf(walk) - before);
    cursors.push(Number(walk.marks().cursor ?? 0));
    callTotals.push(callsOf(walk));

    const { pending = [], passOwed = [] } = walk.marks() as {
      pending?: { kind?: string }[];
      passOwed?: unknown[];
    };

    peaks.pending = Math.max(peaks.pending, pending.length);
    peaks.points = Math.max(peaks.points, pending.filter(({ kind }) => kind === 'point').length);
    peaks.passOwed = Math.max(peaks.passOwed, passOwed.length);

    if (!isFinished) {
      walk.clock.now += gap;
    }
  }

  return { runs, calls: callsOf(walk), killed, busiestRun, cursors, callTotals, isFinished, peaks };
};

/** The runs and calls it took the forward cursor to reach the clock of the first run. */
const untilForwardEnd = ({ cursors, callTotals }: Awaited<ReturnType<typeof settle>>) => {
  const run = cursors.findIndex((cursor) => cursor >= NOW);

  return { runs: run + 1, calls: callTotals[run] };
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

// The log walk and the convert walk. Each log row is one spot leg built on the docs page's TRADE
// sample, and each convert is one convert of the page's UTA sample, listed newest first.
const CONVERT_PAGE_SIZE = 100;

type LogAndConvertWorld = {
  log: RowSlot[];
  converts: RowSlot[];
  convertPageSize?: number;
  /** Fields of every convert row, such as a status that is not settled. */
  convertOverrides?: Record<string, unknown>;
};

const newLogAndConvertAccount = (
  fake?: Parameters<typeof logAndConvertAccountOf>[0]['fake'],
  beforeWrite?: () => void,
) => logAndConvertAccountOf({ state: walkStateFake({ accountId: ACCOUNT_ID }), fake, beforeWrite });

const serveLogAndConvert = (account: LogAndConvertAccount, world: LogAndConvertWorld): void => {
  const { converts, convertPageSize = CONVERT_PAGE_SIZE, convertOverrides } = world;

  account.log.world.log = world.log.map((slot) => logRowOf(slot));
  account.convert.serve(convertPagesOf(converts, convertPageSize, convertOverrides));
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
      expect(last).toBeGreaterThan(first);
      expect(inBurst.slice(1).every((cursor, run) => cursor > inBurst[run])).toBe(true);
    });

    it('a burst of 5,000 transfers halves three times, then commits a span every run', async () => {
      const account = newAccount();

      serveSlots(account, BURST_SEED.slots());

      const spacings = spacingsOf((await settle(account.transfer, gap)).cursors);

      expect(spacings).toEqual([1, 1, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    });

    it.each(SEEDS)(
      'a burst commits a span within its halvings and one run of the last one, and the cursor never moves back, and re-halves at most once more, in at most 3 runs: seed %i',
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

        const [firstSlow = 1, ...laterSlow] = spacings.filter((spacing) => spacing > 1);

        expect(rowsOf(account.transfer)).toHaveLength(2 * count);
        expect(cursors).toEqual([...cursors].sort((left, right) => left - right));
        expect(spacings.length).toBeGreaterThan(0);
        // MEASURED, full sweep, 60 runs, fake route, 2026-11-06: the first slow gap is at most 4
        // runs, a later one at most once and then at most 3 runs. Wider limits hide a slower pager.
        expect(firstSlow).toBeLessThanOrEqual(4);
        expect(laterSlow.length).toBeLessThanOrEqual(1);
        expect(Math.max(1, ...laterSlow)).toBeLessThanOrEqual(3);
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

type LogAndConvertSeed = {
  name: string;
  world: () => LogAndConvertWorld;
  rows: { log: number; convert: number };
  log: WalkBound;
  /** The runs and calls of a whole pass, and the calls of a pass that starts over. */
  convert: { runs: number; calls: number; steadyCalls: number };
};

const ONE_PAGE_LOG: WalkBound = {
  table: { runs: 6, calls: 106 },
  tableRuns: 'ceiling',
  measured: { runs: 6, calls: 110 },
};

const LOG_AND_CONVERT_SEEDS: LogAndConvertSeed[] = [
  {
    name: 'small account',
    world: () => ({ log: evenSlots(40), converts: [] }),
    rows: { log: 40, convert: 0 },
    log: ONE_PAGE_LOG,
    convert: { runs: 1, calls: 1, steadyCalls: 1 },
  },
  {
    name: 'spot user',
    world: () => ({ log: evenSlots(1_000), converts: evenSlots(100) }),
    rows: { log: 1_000, convert: 200 },
    log: ONE_PAGE_LOG,
    convert: { runs: 1, calls: 2, steadyCalls: 2 },
  },
  {
    name: 'busy',
    world: () => ({ log: evenSlots(5_000), converts: evenSlots(1_000) }),
    rows: { log: 5_000, convert: 2_000 },
    log: ONE_PAGE_LOG,
    convert: { runs: 2, calls: 11, steadyCalls: 10 },
  },
  {
    name: 'perps bot',
    world: () => ({ log: evenSlots(50_000), converts: [] }),
    rows: { log: 50_000, convert: 0 },
    // MEASURED: 129 runs and 2,570 calls at gap 0, 217 and 4,333 at 1 hour, 166 and 3,313 at 1 day.
    log: {
      table: { runs: 53, calls: 1_050 },
      tableRuns: 'floor',
      measured: { runs: 217, calls: 4_333 },
    },
    convert: { runs: 1, calls: 1, steadyCalls: 1 },
  },
];

/** A burst of rows in one span, 10 days old: its commit by the forward cursor, at every gap. */
type BurstSeed = {
  name: string;
  count: number;
  span: number;
  table: { runs: number; calls: number };
  measured: { runs: number; calls: number };
  /**
   * MEASURED, fake route, 2026-11-07: the runs until the burst's owed ground ends, at a clock gap
   * of 0, 1 hour and 1 day, in the order of `CLOCK_GAPS`.
   */
  ends: [number, number, number];
};

const BURST_START = NOW - 10 * DAY_MS;

type RunsAndCalls = [runs: number, calls: number];

// MEASURED at every gap: the runs of the table, and 2 calls under its calls.
const burstSeed = (
  name: string,
  count: number,
  span: number,
  [runs, calls]: RunsAndCalls,
  [measuredRuns, measuredCalls]: RunsAndCalls,
  ends: BurstSeed['ends'],
): BurstSeed => ({
  name,
  count,
  span,
  table: { runs, calls },
  measured: { runs: measuredRuns, calls: measuredCalls },
  ends,
});

const COMMITTING_BURSTS: BurstSeed[] = [
  burstSeed('a day of 1,001 rows', 1_001, DAY_MS, [9, 182], [9, 180], [10, 10, 10]),
  burstSeed('1,001 rows in 1 hour', 1_001, HOUR_MS, [14, 282], [14, 280], [15, 15, 15]),
  burstSeed('1,001 rows in 2 minutes', 1_001, 120_000, [25, 502], [25, 500], [39, 39, 39]),
  burstSeed('1,001 rows in 30 s', 1_001, 30_000, [30, 602], [30, 600], [54, 54, 54]),
  burstSeed('1,001 rows in 5 s', 1_001, 5_000, [35, 702], [35, 700], [66, 66, 66]),
  burstSeed('1,001 rows in 2 s', 1_001, 2_000, [35, 702], [35, 700], [62, 62, 67]),
  burstSeed('1,001 rows in 1.2 s', 1_001, 1_200, [35, 702], [35, 700], [58, 58, 93]),
  burstSeed('1,001 rows in 1 s', 1_001, 1_000, [35, 702], [35, 700], [106, 106, 106]),
  burstSeed('1,001 rows in 400 ms', 1_001, 400, [40, 802], [40, 800], [88, 88, 88]),
  burstSeed('1,001 rows in 300 ms', 1_001, 300, [40, 802], [40, 800], [88, 88, 88]),
  burstSeed('2,001 rows in 5 s', 2_001, 5_000, [37, 742], [37, 740], [75, 81, 81]),
  burstSeed('2,001 rows in 2 s', 2_001, 2_000, [39, 782], [39, 780], [86, 86, 86]),
  burstSeed('5,000 rows in a day', 5_000, DAY_MS, [23, 462], [23, 460], [43, 47, 47]),
];

const STUCK_BURSTS = [
  { name: '1,001 rows in 50 ms', count: 1_001, span: 50 },
  { name: '1,001 rows in one ms', count: 1_001, span: 1 },
  { name: '2,001 rows in 1 s', count: 2_001, span: 1_000 },
];

const STUCK_RUNS = 50;

// A run killed on the way loses the halvings it made, and the next run halves again from the whole
// window, so a killed world needs up to 20 more runs to reach the same stop.
const KILLED_STUCK_RUNS = 80;

const SPANS_OF_A_BURST = [1, 20, 50, 300, 700, 1_000, 5_000, 60_000];

// A burst of 1,001 to 2,500 rows in a span from one ms to a minute, at any millisecond of the
// history, so every placement of a span edge against the burst comes up across the seeds.
const randomBurst = (seed: number) => {
  const random = seededRandom(seed * SEED_SPREAD);
  const from = OLDEST_ROW_MS + Math.floor(random() * (NOW - 8 * DAY_MS - OLDEST_ROW_MS));
  const count = 1_001 + Math.floor(random() * 1_500);

  // The seeds step through the spans in turn: the draws of this generator for seeds this close
  // fall on a few of them.
  return { count, span: SPANS_OF_A_BURST[seed % SPANS_OF_A_BURST.length], from };
};

const burstWorldOf = ({
  count,
  span,
  from,
}: ReturnType<typeof randomBurst>): LogAndConvertWorld => ({
  log: burstOfRows(count, from, span),
  converts: [],
});

const randomLogAndConvertWorld = (seed: number) => {
  const random = seededRandom(seed * SEED_SPREAD);
  const world: LogAndConvertWorld = {
    log: randomSlots(random),
    converts: randomSlots(random),
    convertPageSize: pick(random, [1, 2, 3, 5]),
  };

  return { world, fake: { pageSize: pick(random, PAGE_SIZES), order: pick(random, ORDERS) } };
};

const expectWithinBound = (outcome: Awaited<ReturnType<typeof settle>>, bound: WalkBound) => {
  const { table, tableRuns, measured } = bound;

  expect(outcome.runs).toBeLessThan(MAX_RUNS);
  expect(outcome.busiestRun).toBeLessThanOrEqual(BYBIT_LANE_CALL_CAPS.log);
  expect(outcome.calls).toBeGreaterThanOrEqual(table.calls);
  expect(outcome.calls).toBeLessThanOrEqual(measured.calls);
  expect(outcome.runs).toBeLessThanOrEqual(measured.runs);

  if (tableRuns === 'ceiling') {
    expect(outcome.runs).toBeLessThanOrEqual(table.runs);
  } else {
    expect(outcome.runs).toBeGreaterThanOrEqual(table.runs);
  }
};

const denseMarkOf = async (walk: LogAndConvertAccount['log'] | LogAndConvertAccount['convert']) =>
  denseSpansOf(parseExchangeState(await walk.readState())).log;

const denseMarkWritesOf = (walk: LogAndConvertAccount['log']): number =>
  (walk.deps.patchExchangeState as jest.Mock).mock.calls.filter(([, patches]) =>
    patches.some((patch: { kind: string }) => patch.kind === 'denseSpans'),
  ).length;

/**
 * Kill the walk of a fresh account just before each write that outlives a restart, one cut at a
 * time, and the walk must end with the rows, the ground marks and the dense mark of the run that
 * was never killed. `finish` settles a walk and says how many of its runs were killed.
 */
const expectKilledRunsConverge = async (
  walkWith: (
    beforeWrite: () => void,
  ) => Promise<SettlingWalk & { readState: () => Promise<string | null> }>,
  finish: (walk: SettlingWalk) => Promise<number>,
  label: unknown,
) => {
  let writes = 0;
  const reference = await walkWith(() => {
    writes += 1;
  });

  await finish(reference);

  expect(writes).toBeGreaterThan(0);

  for (let cut = 1; cut <= writes; cut += 1) {
    let seen = 0;
    const walk = await walkWith(() => {
      seen += 1;

      if (seen === cut) {
        throw new Error(KILLED);
      }
    });

    expect({ label, cut, killed: await finish(walk) }).toEqual({ label, cut, killed: 1 });
    expect({ label, cut, rows: rowsOf(walk) }).toEqual({ label, cut, rows: rowsOf(reference) });
    expect({ label, cut, marks: groundMarksOf(walk) }).toEqual({
      label,
      cut,
      marks: groundMarksOf(reference),
    });
    expect({ label, cut, dense: denseSpansOf(parseExchangeState(await walk.readState())) }).toEqual(
      {
        label,
        cut,
        dense: denseSpansOf(parseExchangeState(await reference.readState())),
      },
    );
  }
};

describe('Bybit convergence of the log and the convert walk', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('draws worlds that differ from seed to seed, with rows in both walks, every page shape and every span', () => {
    const worlds = SEEDS.map((seed) => randomLogAndConvertWorld(seed));
    const bursts = SEEDS.map((seed) => randomBurst(seed));

    expect(new Set(worlds.map((world) => JSON.stringify(world))).size).toBe(SEEDS.length);
    expect(new Set(bursts.map((burst) => JSON.stringify(burst))).size).toBe(SEEDS.length);
    expect(worlds.every(({ world }) => world.log.length + world.converts.length > 0)).toBe(true);
    expect(new Set(worlds.map(({ fake }) => fake.order)).size).toBeGreaterThan(1);
    expect(new Set(worlds.map(({ world }) => world.convertPageSize)).size).toBeGreaterThan(1);
    expect(new Set(bursts.map(({ span }) => span)).size).toBeGreaterThan(1);
  });

  // The floor of a run moves on by a day when the runs are a day apart, so a burst 50 days from
  // the oldest end of the history is stuck for a while and then passed by the floor, and the commit
  // past it takes its mark with it.
  it('the mark of a burst no span can hold goes when the floor passes it', async () => {
    const account = newLogAndConvertAccount();

    serveLogAndConvert(account, {
      log: burstOfRows(1_001, FLOOR + 50 * DAY_MS, 50),
      converts: [],
    });

    await settle(account.log, DAY_MS, 30);

    expect(await denseMarkOf(account.log)).toBeDefined();

    const later = await settle(account.log, DAY_MS, 80);

    expect(await denseMarkOf(account.log)).toBeUndefined();
    expect(untilForwardEnd(later).runs).toBeGreaterThan(0);
  }, 120_000);

  describe.each(CLOCK_GAPS)('at a clock gap of %i ms', (gap) => {
    it.each(LOG_AND_CONVERT_SEEDS)(
      "log and convert reach the end within the table's runs: the $name seed",
      async ({ world, rows, log, convert }) => {
        const account = newLogAndConvertAccount();

        serveLogAndConvert(account, world());

        const logOutcome = await settle(account.log, gap);
        const convertOutcome = await settle(account.convert, gap);

        expect(rowsOf(account.log)).toHaveLength(rows.log);
        expectWithinBound(logOutcome, log);
        expect(rowsOf(account.convert)).toHaveLength(rows.convert);
        expect(convertOutcome.runs).toBeLessThanOrEqual(convert.runs);
        expect(convertOutcome.calls).toBe(convert.calls);
        expect(convertOutcome.busiestRun).toBeLessThanOrEqual(BYBIT_LANE_CALL_CAPS.convert);

        const callsBefore = callsOf(account.convert);

        account.convert.clock.now += gap;
        await account.convert.run();

        expect(callsOf(account.convert) - callsBefore).toBe(convert.steadyCalls);
      },
      120_000,
    );

    it.each(COMMITTING_BURSTS)(
      "a burst commits within the table's runs and leaves no mark: $name",
      async ({ count, span, table, measured }) => {
        const account = newLogAndConvertAccount();

        serveLogAndConvert(account, { log: burstOfRows(count, BURST_START, span), converts: [] });

        const forward = untilForwardEnd(await settle(account.log, gap, 60));

        expect(forward.runs).toBeGreaterThan(0);
        expect(forward.runs).toBeLessThanOrEqual(measured.runs);
        expect(forward.runs).toBeLessThanOrEqual(table.runs);
        expect(forward.calls).toBeLessThanOrEqual(measured.calls);
        expect(forward.calls).toBeLessThanOrEqual(table.calls);
        expect(rowsOf(account.log)).toHaveLength(count);
        expect(await denseMarkOf(account.log)).toBeUndefined();
      },
      120_000,
    );

    it.each(STUCK_BURSTS)(
      'a burst no span can hold stops with its mark, written once, and spends its lane on every run: $name',
      async ({ count, span }) => {
        const account = newLogAndConvertAccount();

        serveLogAndConvert(account, { log: burstOfRows(count, BURST_START, span), converts: [] });

        const outcome = await settle(account.log, gap, STUCK_RUNS);
        const mark = await denseMarkOf(account.log);

        expect(outcome.isFinished).toBe(false);
        expect(untilForwardEnd(outcome).runs).toBe(0);
        expect(outcome.calls).toBe(STUCK_RUNS * BYBIT_LANE_CALL_CAPS.log);
        expect(mark).toBeGreaterThanOrEqual(BURST_START - SECOND_MS);
        expect(mark).toBeLessThanOrEqual(BURST_START + span);
        expect(denseMarkWritesOf(account.log)).toBe(1);
        expect(rowsOf(account.log).length).toBeLessThan(count);
      },
      120_000,
    );

    it.each(SEEDS)(
      'a forward cursor that stops at a burst stops with its mark, and one that passes it leaves none: seed %i',
      async (seed) => {
        const account = newLogAndConvertAccount();

        serveLogAndConvert(account, burstWorldOf(randomBurst(seed)));

        const outcome = await settle(account.log, gap, 90);
        const mark = await denseMarkOf(account.log);

        expect(mark === undefined).toBe(untilForwardEnd(outcome).runs > 0);
      },
      120_000,
    );

    // The forward pass imports a burst that a span edge splits, and the ground it then leaves owed
    // behind the cursor is read again outside the forward pass, which splits a span down to 1 ms:
    // the split reaches a span that fits, so the owed ground ends with no mark.
    it('a burst of 1,001 rows in 300 ms ends its owed ground, or its mark stands', async () => {
      const account = newLogAndConvertAccount();

      serveLogAndConvert(account, { log: burstOfRows(1_001, BURST_START, 300), converts: [] });

      const outcome = await settle(account.log, gap, 200);

      expect(outcome.isFinished || (await denseMarkOf(account.log)) !== undefined).toBe(true);
    }, 120_000);

    // The same burst 3 days old lies inside the 7-day re-scan, whatever the overlap day owes, so
    // this one needs the 1 ms split outside the forward pass on its own.
    it('a burst of 1,001 rows in 300 ms, 3 days old, ends its owed ground, or its mark stands', async () => {
      const account = newLogAndConvertAccount();

      serveLogAndConvert(account, {
        log: burstOfRows(1_001, NOW - 3 * DAY_MS, 300),
        converts: [],
      });

      const outcome = await settle(account.log, gap, 200);

      expect(outcome.isFinished || (await denseMarkOf(account.log)) !== undefined).toBe(true);
    }, 120_000);

    it.each(COMMITTING_BURSTS)(
      'a burst the forward pass commits ends its owed ground, with no mark: $name',
      async ({ count, span, ends }) => {
        const account = newLogAndConvertAccount();

        serveLogAndConvert(account, { log: burstOfRows(count, BURST_START, span), converts: [] });

        const outcome = await settle(account.log, gap, 200);

        expect(outcome.isFinished).toBe(true);
        expect(outcome.runs).toBeLessThanOrEqual(ends[CLOCK_GAPS.indexOf(gap)]);
        expect(rowsOf(account.log)).toHaveLength(count);
        expect(await denseMarkOf(account.log)).toBeUndefined();
      },
      120_000,
    );

    it('a spot row that fails its check leaves at most 12 ranges and no point, on every run', async () => {
      const account = newLogAndConvertAccount();

      account.log.world.log = evenSlots(5_000).map((slot) => logRowOf(slot, '999'));

      const outcome = await settle(account.log, gap, 60);

      expect(untilForwardEnd(outcome).runs).toBeGreaterThan(0);
      expect(rowsOf(account.log)).toEqual([]);
      expect(outcome.peaks.pending).toBeGreaterThan(0);
      expect(outcome.peaks.pending).toBeLessThanOrEqual(12);
      expect(outcome.peaks.points).toBe(0);
    }, 120_000);

    it('30 converts that wait leave at most 12 points in the pass and in the state, on every run', async () => {
      const account = newLogAndConvertAccount();

      serveLogAndConvert(account, {
        log: [],
        converts: evenSlots(30),
        convertPageSize: 1,
        convertOverrides: { exchangeStatus: 'init' },
      });

      const outcome = await settle(account.convert, gap, 20);

      expect(rowsOf(account.convert)).toEqual([]);
      expect(outcome.peaks.pending).toBeGreaterThan(0);
      expect(outcome.peaks.pending).toBeLessThanOrEqual(12);
      expect(outcome.peaks.passOwed).toBeGreaterThan(0);
      expect(outcome.peaks.passOwed).toBeLessThanOrEqual(12);
    });

    // The rows start after the first day of the history, as in the random worlds: a run killed
    // before its first cursor restarts one clock gap later, with a floor that has moved on.
    it.each([
      ['small account', 40, 0],
      ['spot user', 1_000, 100],
    ])(
      'a killed run converges to the rows of an uninterrupted one at every commit: the %s seed',
      async (name, logRows, converts) => {
        for (const walkName of ['log', 'convert'] as const) {
          await expectKilledRunsConverge(
            async (beforeWrite) => {
              const account = newLogAndConvertAccount(undefined, beforeWrite);

              serveLogAndConvert(account, {
                log: evenSlots(logRows, OLDEST_ROW_MS),
                converts: evenSlots(converts, OLDEST_ROW_MS),
              });

              return account[walkName];
            },
            async (walk) => (await settleToCommonEnd(walk, gap)).killed,
            { name, walkName },
          );
        }
      },
      300_000,
    );

    it.each(SEEDS)(
      'a killed run converges to the rows of an uninterrupted one at every commit, log and convert: seed %i',
      async (seed) => {
        const { world, fake } = randomLogAndConvertWorld(seed);

        for (const walkName of ['log', 'convert'] as const) {
          await expectKilledRunsConverge(
            async (beforeWrite) => {
              const account = newLogAndConvertAccount(fake, beforeWrite);

              serveLogAndConvert(account, world);

              return account[walkName];
            },
            async (walk) => (await settleToCommonEnd(walk, gap)).killed,
            { seed, walkName },
          );
        }
      },
      300_000,
    );

    // Where the stop sits depends on the clock of each run, and the ground a stuck forward pass
    // leaves owed never drains, so the law is the stop and its mark, not the rest of the state.
    it('a killed run on the way to a burst no span can hold still stops with its mark', async () => {
      const runWith = async (beforeWrite: () => void) => {
        const account = newLogAndConvertAccount(undefined, beforeWrite);

        serveLogAndConvert(account, { log: burstOfRows(1_001, BURST_START, 50), converts: [] });

        return { account, outcome: await settle(account.log, gap, KILLED_STUCK_RUNS) };
      };
      let writes = 0;

      await runWith(() => {
        writes += 1;
      });

      expect(writes).toBeGreaterThan(0);

      for (let cut = 1; cut <= writes; cut += 1) {
        let seen = 0;
        const { account, outcome } = await runWith(() => {
          seen += 1;

          if (seen === cut) {
            throw new Error(KILLED);
          }
        });
        const mark = await denseMarkOf(account.log);

        expect({ cut, killed: outcome.killed }).toEqual({ cut, killed: 1 });
        expect({ cut, isFinished: outcome.isFinished }).toEqual({ cut, isFinished: false });
        expect({ cut, forward: untilForwardEnd(outcome).runs }).toEqual({ cut, forward: 0 });
        expect({ cut, stands: mark !== undefined }).toEqual({ cut, stands: true });
        expect(mark).toBeGreaterThanOrEqual(BURST_START - SECOND_MS);
        expect(mark).toBeLessThanOrEqual(BURST_START + 50);
      }
    }, 300_000);
  });
});
