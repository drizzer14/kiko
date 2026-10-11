import { DAY_MS } from '@kiko/dates';
import {
  BINANCE_PAY_HISTORY_CURSOR_FIELD,
  BINANCE_PAY_PENDING_OVERLAP_FIELD,
  BINANCE_PAY_RESCAN_CURSOR_FIELD,
} from '@kiko/holdings/holding-metadata';

import {
  advanceWalkMarks,
  BinanceWalkStop,
  halfOf,
  planWalkPasses,
  runWalkPlan,
  type SpanRead,
  walkSpans,
  type WalkMarkFields,
  type WalkMarks,
  type WalkWindow,
} from './binance.history-walk';
import { LANE_CALL_CAPS } from './binance.history-budget';
import { commitSettledSpan, instantAt, settleRecords } from './binance.history-records';

/**
 * The walk's own functions driven run after run, as the lanes drive them, against records that
 * can never be committed. A run reads at most `lane.reads` spans; a read returns the records
 * whose time lies in the span, both ends included, as Binance does. A stuck record owes its own
 * point and holds nothing else back, so every other record of the span commits.
 */

const HOUR_MS = 3_600_000;
const SECOND_MS = 1_000;
const FLOOR_MS = Date.UTC(2017, 6, 14);
const START_MS = Date.UTC(2026, 9, 1);
const BASE_MS = Date.UTC(2025, 6, 1);
const WINDOW_MS = 89 * DAY_MS;
const POINT_MAX_MS = SECOND_MS;
const NEVER = Number.POSITIVE_INFINITY;
const SEEDS = [11, 23, 37];
const COUNTS = Array.from({ length: 12 }, (_unused, index) => index + 1);

/**
 * `precision` is the precision of the time a lane sees: a Pay order has its millisecond, a
 * capital withdrawal only its second, so it sits somewhere in the second its time starts.
 */
type Lane = { name: string; reads: number; precision: number };

/** Pay spends one of its calls on the uid, so a run has one read fewer than the lane cap. */
const LANES: Lane[] = [
  { name: 'Pay', reads: LANE_CALL_CAPS.pay - 1, precision: 1 },
  { name: 'capital', reads: LANE_CALL_CAPS.capitalWithdraw, precision: SECOND_MS },
];

/** A seeded generator (Lehmer), so a failing run replays. */
const seededRandom = (seed: number): (() => number) => {
  let state = seed;

  return () => {
    state = (state * 48_271) % 2_147_483_647;

    return state / 2_147_483_647;
  };
};

/**
 * One record of the account. `time` is what the lane sees, `at` the millisecond Binance filters
 * by. A record is stuck (the walk cannot trust it) in every run before `stuckUntil`.
 */
type SimRecord = { id: number; time: number; at: number; stuckUntil: number };

type Scenario = { owed: WalkWindow[]; records: SimRecord[] };

type Simulation = {
  lane: Lane;
  scenario: Scenario;
  runs: number;
  /** The time between two runs. */
  gapMs?: number;
  /** A span longer than `spanMs` that overlaps `range` comes back full, so it is read in halves. */
  dense?: { range: WalkWindow; spanMs: number };
};

type RunRecord = {
  owed: WalkWindow[];
  rescanReads: number;
  rescanCommits: number;
  /** The most reads one owed point had in the run. */
  readsOfAPoint: number;
};

type Outcome = { runs: RunRecord[]; importedAt: Map<number, number> };

const holds = (range: WalkWindow, millisecond: number): boolean =>
  range.start <= millisecond && millisecond <= range.end;

const isPoint = (range: WalkWindow): boolean => range.end - range.start <= POINT_MAX_MS;

const isDense = (dense: Simulation['dense'], span: WalkWindow): boolean =>
  dense !== undefined &&
  span.end - span.start > dense.spanMs &&
  span.start < dense.range.end &&
  span.end > dense.range.start;

/** What a stuck record of `lane` owes: its millisecond and the one after, or its whole second. */
const extentOf = (lane: Lane, record: SimRecord): WalkWindow | undefined =>
  lane.precision === 1
    ? instantAt(record.time)
    : { start: record.time, end: record.time + lane.precision - 1 };

/** The point a record that was found stuck is owed as. */
const pointOf = (lane: Lane, record: SimRecord): WalkWindow => ({
  start: record.time,
  end: record.time + (lane.precision === 1 ? 1 : lane.precision - 1),
});

const MARK_FIELDS: WalkMarkFields = {
  cursor: BINANCE_PAY_HISTORY_CURSOR_FIELD,
  rescan: BINANCE_PAY_RESCAN_CURSOR_FIELD,
  pending: BINANCE_PAY_PENDING_OVERLAP_FIELD,
};

/** The rows of a record: its id, or a stop while the record is stuck. */
const rowsOf = (entry: SimRecord, run: number): number[] => {
  if (run < entry.stuckUntil) {
    throw new BinanceWalkStop('simulated-stuck');
  }

  return [entry.id];
};

/** What a read of `span` gives: the records in it, or the half to read when it is too full. */
const pageOf = (input: Simulation, span: WalkWindow): SpanRead<SimRecord[]> => {
  const half = halfOf(span);

  return isDense(input.dense, span) && half !== undefined
    ? { kind: 'split', half }
    : { kind: 'page', page: input.scenario.records.filter((entry) => holds(span, entry.at)) };
};

const countPointRead = (pointReads: Map<string, number>, span: WalkWindow): void => {
  if (isPoint(span)) {
    const key = `${span.start}:${span.end}`;
    pointReads.set(key, (pointReads.get(key) ?? 0) + 1);
  }
};

const simulate = async (input: Simulation): Promise<Outcome> => {
  const { lane, scenario, runs, gapMs = HOUR_MS } = input;
  const importedAt = new Map<number, number>();
  let marks: WalkMarks = { cursor: START_MS, rescanCursor: null, pending: scenario.owed };
  const records: RunRecord[] = [];

  for (let run = 0; run < runs; run += 1) {
    const live: WalkMarks = { ...marks, pending: [...marks.pending] };
    const record: RunRecord = { owed: [], rescanReads: 0, rescanCommits: 0, readsOfAPoint: 0 };
    const pointReads = new Map<string, number>();
    const plan = planWalkPasses({
      cursor: marks.cursor,
      rescanCursor: marks.rescanCursor,
      pending: marks.pending,
      floorMs: FLOOR_MS,
      endTime: START_MS + run * gapMs,
      windowMs: WINDOW_MS,
      overlapMs: DAY_MS,
      maxWindows: 80,
    });
    let reads = 0;

    await runWalkPlan({
      plan,
      canAfford: (keep) => reads + keep < lane.reads,
      runWindow: (window, pass, keep) =>
        walkSpans<SimRecord[]>({
          window,
          keep,
          read: async (span, keepCalls) => {
            if (reads + keepCalls >= lane.reads) {
              return undefined;
            }

            reads += 1;
            record.rescanReads += pass === 'rescan' ? 1 : 0;
            countPointRead(pointReads, span);

            return pageOf(input, span);
          },
          commit: async (span, page) => {
            const committed = await commitSettledSpan({
              pass,
              span,
              settled: settleRecords({
                span,
                records: page,
                rowsOf: (entry) => rowsOf(entry, run),
                extentOf: (entry) => extentOf(lane, entry),
              }),
              place: async (planned) => planned,
              add: async (ids) => {
                for (const id of ids) {
                  importedAt.set(id, Math.min(importedAt.get(id) ?? run, run));
                }

                return ids.length;
              },
              advance: (owed) =>
                advanceWalkMarks({
                  pass,
                  span,
                  owed,
                  plan,
                  marks: live,
                  restartMs: FLOOR_MS,
                  fields: MARK_FIELDS,
                  write: async () => undefined,
                  writePending: async () => undefined,
                }),
            });

            record.rescanCommits += pass === 'rescan' && committed !== undefined ? 1 : 0;

            return committed;
          },
        }),
    });

    marks = live;
    record.owed = live.pending;
    record.readsOfAPoint = Math.max(0, ...pointReads.values());
    records.push(record);
  }

  return { runs: records, importedAt };
};

/** The run at whose end `test` first holds, or infinity when it never does. */
const firstRun = (runs: RunRecord[], test: (run: RunRecord) => boolean): number => {
  const index = runs.findIndex(test);

  return index === -1 ? NEVER : index;
};

/** What the properties state, in runs, for one scenario. */
type Bounds = {
  /** Every record that can be trusted is imported within this many runs of it being placeable. */
  imported: number;
  /** Every stuck record is owed as a point within this many runs. */
  pointed: number;
};

/** The runs, from the first in which `held` is true, in which it stops being true. */
const lostAfterHeld = (runs: RunRecord[], held: (run: RunRecord) => boolean): number[] => {
  const first = firstRun(runs, held);

  return first === NEVER
    ? []
    : runs.flatMap((run, index) => (index > first && !held(run) ? [index] : []));
};

/** What breaks each property, as text a failing run prints; empty when all hold. */
const violationsOf = (outcome: Outcome, scenario: Scenario, bounds: Bounds): string[] => {
  const { runs, importedAt } = outcome;
  const stuck = scenario.records.filter((entry) => entry.stuckUntil === NEVER);
  const late = scenario.records
    .filter((entry) => entry.stuckUntil !== NEVER)
    .filter((entry) => (importedAt.get(entry.id) ?? NEVER) >= entry.stuckUntil + bounds.imported);
  const notPointed = stuck.filter(
    (entry) =>
      firstRun(runs, (run) => run.owed.some((range) => isPoint(range) && holds(range, entry.at))) >=
      bounds.pointed,
  );
  const dropped = stuck.flatMap((entry) => [
    ...lostAfterHeld(runs, (run) => run.owed.some((range) => holds(range, entry.at))),
    ...lostAfterHeld(runs, (run) =>
      run.owed.some((range) => isPoint(range) && holds(range, entry.at)),
    ),
  ]);
  const noRescanRead = runs.filter((run) => run.rescanReads === 0);
  const noRescanCommit = runs.filter((run) => run.rescanCommits === 0);
  const overReads = runs.filter((run) => run.readsOfAPoint > 1);

  return [
    ...(late.length > 0
      ? [`P1: ${late.length} records imported later than ${bounds.imported} runs after placeable`]
      : []),
    ...(notPointed.length > 0
      ? [`P2: ${notPointed.length} stuck records not owed as a point within ${bounds.pointed} runs`]
      : []),
    ...(dropped.length > 0
      ? [`a stuck record left the list, or was merged out of its point, at runs ${dropped}`]
      : []),
    ...(overReads.length > 0
      ? [`P3: an owed point had more than 1 read in ${overReads.length} runs`]
      : []),
    ...(noRescanRead.length > 0
      ? [`P4: the re-scan had no read in ${noRescanRead.length} runs`]
      : []),
    ...(noRescanCommit.length > 0
      ? [`P4: the re-scan committed nothing in ${noRescanCommit.length} runs`]
      : []),
  ];
};

const dayAt = (daysAfterBase: number): WalkWindow => ({
  start: BASE_MS + daysAfterBase * DAY_MS,
  end: BASE_MS + (daysAfterBase + 1) * DAY_MS,
});

/** Records and owed ground for one scenario, from one seed. */
const builderOf = (lane: Lane, seed: number) => {
  const random = seededRandom(seed);
  let lastId = 0;

  const alignedTo = (millisecond: number): number =>
    Math.floor(millisecond / lane.precision) * lane.precision;

  /** A record at the time `millisecond` has for the lane, anywhere in its own precision. */
  const record = (millisecond: number, stuckUntil = 0): SimRecord => {
    lastId += 1;
    const time = alignedTo(millisecond);

    return { id: lastId, time, at: time + Math.floor(random() * lane.precision), stuckUntil };
  };

  /** A record at the very time of `other`: the same millisecond, or the same second. */
  const twinOf = (other: SimRecord, stuckUntil = 0): SimRecord => {
    lastId += 1;

    return {
      id: lastId,
      time: other.time,
      at: other.time + Math.floor(random() * lane.precision),
      stuckUntil,
    };
  };

  /** A time inside `range`, two seconds clear of its ends so no record leaves it. */
  const interiorOf = (range: WalkWindow): number =>
    range.start + 2 * SECOND_MS + Math.floor(random() * (range.end - range.start - 4 * SECOND_MS));

  /** An owed range of 3 to 24 hours, ten days after the one before it so none touches. */
  const rangeAt = (index: number): WalkWindow => {
    const start = BASE_MS + index * 10 * DAY_MS + Math.floor(random() * 1_000_000);

    return { start, end: start + 3 * HOUR_MS + Math.floor(random() * 21 * HOUR_MS) };
  };

  return { record, twinOf, interiorOf, rangeAt };
};

/** An owed day far behind every other range, with two records that can be trusted in it. */
const unrelatedDayOf = (lane: Lane, seed: number) => {
  const builder = builderOf(lane, seed + 1_000);
  const day = dayAt(250);

  return {
    day,
    records: [builder.record(builder.interiorOf(day)), builder.record(builder.interiorOf(day))].map(
      (entry, index) => ({ ...entry, id: 900_000 + index }),
    ),
  };
};

/** One owed range per stuck record, each with two records that can be trusted beside it. */
const spreadScenario = (lane: Lane, count: number, seed: number): Scenario => {
  const builder = builderOf(lane, seed);
  const days = Array.from({ length: count }, (_unused, index) => builder.rangeAt(index));
  const unrelated = unrelatedDayOf(lane, seed);

  return {
    owed: [...days, unrelated.day],
    records: [
      ...days.flatMap((day) => [
        builder.record(builder.interiorOf(day), NEVER),
        builder.record(builder.interiorOf(day)),
        builder.record(builder.interiorOf(day)),
      ]),
      ...unrelated.records,
    ],
  };
};

/** ONE owed day with `count` stuck records in it, and as many that can be trusted. */
const oneDayScenario = (lane: Lane, count: number, seed: number): Scenario => {
  const builder = builderOf(lane, seed);
  const day = dayAt(40);
  const unrelated = unrelatedDayOf(lane, seed);

  return {
    owed: [day, unrelated.day],
    records: [
      ...Array.from({ length: count }, () => builder.record(builder.interiorOf(day), NEVER)),
      ...Array.from({ length: count }, () => builder.record(builder.interiorOf(day))),
      ...unrelated.records,
    ],
  };
};

/**
 * One owed range per close pair of stuck records: 1 and 2 ms apart on Pay, in the same second
 * and in the next one for a withdrawal, with a record that can be trusted just before, just
 * after and at the time of the first.
 */
const pairsScenario = (lane: Lane, count: number): Scenario => {
  const builder = builderOf(lane, 5);
  const days = Array.from({ length: count }, (_unused, index) => builder.rangeAt(index));
  const unrelated = unrelatedDayOf(lane, 5);
  const gaps = lane.precision === 1 ? [1, 2] : [0, SECOND_MS];

  return {
    owed: [...days, unrelated.day],
    records: [
      ...days.flatMap((day, index) => {
        const first = builder.record(builder.interiorOf(day), NEVER);
        const gap = gaps[index % gaps.length];
        const second = builder.record(first.time + gap, NEVER);

        return [
          first,
          second,
          builder.twinOf(first),
          builder.record(first.time - lane.precision),
          builder.record(second.time + lane.precision),
        ];
      }),
      ...unrelated.records,
    ],
  };
};

/**
 * `count` points already found, each with a record that can be trusted at its own time. The
 * first `count` of them are in the list, the rest are not owed at all.
 */
const twinPointsScenario = (lane: Lane, count: number): Scenario => {
  const builder = builderOf(lane, 7);
  const stuck = Array.from({ length: count }, (_unused, index) =>
    builder.record(BASE_MS + index * 10 * DAY_MS + HOUR_MS, NEVER),
  );

  return {
    owed: stuck.map((entry) => pointOf(lane, entry)),
    records: [...stuck, ...stuck.map((entry) => builder.twinOf(entry))],
  };
};

/**
 * `count` stuck records inside the 89-day window the re-scan reads, none of them owed yet, each
 * with a record that can be trusted a moment after it and one at its own time.
 */
const rescanScenario = (lane: Lane, count: number, seed: number): Scenario => {
  const builder = builderOf(lane, seed);
  const window = { start: START_MS - 85 * DAY_MS, end: START_MS - 5 * DAY_MS };
  const stuck = Array.from({ length: count }, () =>
    builder.record(builder.interiorOf(window), NEVER),
  );

  return {
    owed: [],
    records: [
      ...stuck,
      ...stuck.map((entry) => builder.twinOf(entry)),
      ...stuck.map((entry) => builder.record(entry.time + 3 * lane.precision)),
      ...stuck.map((entry) => builder.record(entry.time + DAY_MS)),
    ],
  };
};

/**
 * `count` points of stuck records, ten days apart, behind the window; the newest becomes
 * trustworthy at run 5 (its record is then placeable), and is the one to import.
 */
const PLACEABLE_AT = 5;

const manyPointsScenario = (lane: Lane, count: number): Scenario => {
  const builder = builderOf(lane, 13);
  const stuck = Array.from({ length: count }, (_unused, index) =>
    builder.record(
      BASE_MS + index * 10 * DAY_MS + HOUR_MS,
      index === count - 1 ? PLACEABLE_AT : NEVER,
    ),
  );

  return { owed: stuck.map((entry) => pointOf(lane, entry)), records: stuck };
};

/**
 * Thirteen or more owed ranges, so that two of the nearest merge into a hull, and `count` points
 * already found between them, each with a record that can be trusted at its own time.
 */
const beyondTwelveScenario = (lane: Lane, count: number): Scenario => {
  const builder = builderOf(lane, 17);
  const days = Array.from({ length: 14 }, (_unused, index) => builder.rangeAt(index));
  const stuck = days
    .slice(0, count)
    .map((day) => builder.record(day.end + 3 * HOUR_MS + SECOND_MS, NEVER));

  return {
    owed: [...days, ...stuck.map((entry) => pointOf(lane, entry))],
    records: [
      ...stuck,
      ...stuck.map((entry) => builder.twinOf(entry)),
      ...days.map((day) => builder.record(builder.interiorOf(day))),
    ],
  };
};

/**
 * The runs the properties allow, linear in the owed ranges: each is read once, oldest first, on
 * the reads a run has beside the forward pass and the one the re-scan keeps. Measured worst
 * cases over the scenarios below sit under these.
 */
const rangeRuns = (lane: Lane, ranges: number): number =>
  Math.ceil((ranges + 1) / (lane.reads - 3)) + 1;

/**
 * A day of up to 24 hours that comes back full above 6 hours is read in halves: 2 reads to get
 * down to 6 hours, then 2 reads (a read that is too full, and the half) for each of its commits.
 */
const DENSE_DAY_MS = 6 * HOUR_MS;
const denseDayRuns = (lane: Lane): number => Math.ceil(16 / (lane.reads - 3)) + 2;

/**
 * The 89-day window of the re-scan, coming back full above 30 days: 2 reads to get down to 22
 * days, then 2 reads for each of its commits.
 */
const DENSE_WINDOW_MS = 30 * DAY_MS;
const denseWindowRuns = (lane: Lane): number => Math.ceil(12 / (lane.reads - 1)) + 2;

/** The runs one of many points waits for a read: each run reads a share of them at random. */
const ROTATION_RUNS = 10;

describe.each(LANES)('owed ground that never commits, $name lane', (lane) => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  const check = async (
    input: Pick<Simulation, 'scenario' | 'gapMs' | 'dense'>,
    bounds: Bounds,
    runs: number,
  ) => {
    const outcome = await simulate({ lane, runs, ...input });

    expect(violationsOf(outcome, input.scenario, bounds)).toEqual([]);
  };

  const rows = (counts: number[], seeds = SEEDS) =>
    counts.flatMap((count) =>
      seeds.map((seed) => ({
        count,
        seed,
        bound: rangeRuns(lane, count + 1),
      })),
    );

  it.each(rows(COUNTS))(
    'P1-P4: $count stuck records at random points, one owed day each (seed $seed): every other record of the days imported and every stuck record a point within $bound runs, 1 read a run per point after that, a re-scan read and commit every run',
    async ({ count, seed, bound }) => {
      await check(
        { scenario: spreadScenario(lane, count, seed) },
        { imported: bound, pointed: bound },
        bound + 5,
      );
    },
  );

  const NEAR_ONE_RUN = 1;

  it.each(rows(COUNTS))(
    'P1-P4: $count stuck records at random points inside ONE owed day (seed $seed): every other record imported and every stuck record a point within 1 run, 1 read a run per point after that, a re-scan read and commit every run',
    async ({ count, seed }) => {
      await check(
        { scenario: oneDayScenario(lane, count, seed) },
        { imported: NEAR_ONE_RUN + 1, pointed: NEAR_ONE_RUN + 1 },
        6,
      );
    },
  );

  it.each(rows(COUNTS, [11]))(
    'P1-P4: $count stuck records inside ONE owed day that comes back full above 6 hours (seed $seed): every other record imported and every stuck record a point within the runs its reads need, 1 read a run per point after that, a re-scan read and commit every run',
    async ({ count, seed }) => {
      const scenario = oneDayScenario(lane, count, seed);
      const bound = denseDayRuns(lane);

      await check(
        { scenario, dense: { range: dayAt(40), spanMs: DENSE_DAY_MS } },
        { imported: bound, pointed: bound },
        bound + 5,
      );
    },
  );

  it.each(rows(COUNTS, [0]))(
    'P1-P4: $count close pairs of stuck records, 1 and 2 ms apart (a withdrawal: the same and the next second), one owed day each: every other record imported and every stuck record a point within $bound runs, 1 read a run per point after that, a re-scan read and commit every run',
    async ({ count, bound }) => {
      await check(
        { scenario: pairsScenario(lane, count) },
        { imported: bound, pointed: bound },
        bound + 5,
      );
    },
  );

  const POINTS_PER_RUN = lane.reads - 2;

  it.each(COUNTS.filter((count) => count <= POINTS_PER_RUN).map((count) => ({ count })))(
    'P1-P4: a record that can be trusted at the very millisecond (a withdrawal: second) of each of $count stuck records, found already: imported within 1 run, 1 read a run per point, a re-scan read and commit every run',
    async ({ count }) => {
      await check({ scenario: twinPointsScenario(lane, count) }, { imported: 1, pointed: 1 }, 6);
    },
  );

  it.each(rows(COUNTS, [11, 23]))(
    'P1-P4: $count stuck records inside the re-scan window, which comes back full above 30 days, none found yet, runs a day apart (seed $seed): the records after them import and each stuck record is a point within the runs a re-scan of the window needs, a re-scan read and commit every run',
    async ({ count, seed }) => {
      const bound = denseWindowRuns(lane);

      await check(
        {
          scenario: rescanScenario(lane, count, seed),
          gapMs: DAY_MS,
          dense: {
            range: { start: START_MS - WINDOW_MS - 10 * DAY_MS, end: START_MS },
            spanMs: DENSE_WINDOW_MS,
          },
        },
        { imported: bound, pointed: bound },
        bound + 5,
      );
    },
  );

  it.each(rows(COUNTS, [11, 23]))(
    'P1-P4: $count stuck records inside the re-scan window, none found yet, the window read whole (seed $seed): the records after them import and each stuck record is a point within 2 runs, a re-scan read and commit every run',
    async ({ count, seed }) => {
      await check({ scenario: rescanScenario(lane, count, seed) }, { imported: 2, pointed: 2 }, 8);
    },
  );

  const MANY_POINTS = lane.reads >= 19 ? [20, 24, 30] : [10, 12, 14];

  it.each(MANY_POINTS.flatMap((count) => [HOUR_MS, DAY_MS].map((gapMs) => ({ count, gapMs }))))(
    `P1-P4: $count owed points, the newest placeable at run ${PLACEABLE_AT}, runs $gapMs ms apart: the newest imports within ${ROTATION_RUNS} runs of that, 1 read a run per point, a re-scan read and commit every run`,
    async ({ count, gapMs }) => {
      await check(
        { scenario: manyPointsScenario(lane, count), gapMs },
        { imported: ROTATION_RUNS, pointed: 1 },
        PLACEABLE_AT + ROTATION_RUNS + 5,
      );
    },
  );

  it.each(COUNTS.slice(0, 6).map((count) => ({ count, bound: rangeRuns(lane, 14) + 6 })))(
    'P1-P4: 14 owed days and $count points already found between them, so a list past 12 ranges merges two of them: no point is merged, every record imported within $bound runs, 1 read a run per point, a re-scan read and commit every run',
    async ({ count, bound }) => {
      await check(
        { scenario: beyondTwelveScenario(lane, count) },
        { imported: bound, pointed: 1 },
        bound + 5,
      );
    },
  );

  it('P4: a dense owed day that needs many reads leaves the re-scan a read and a commit every run of 30', async () => {
    const dense = dayAt(30);

    await check(
      { scenario: { owed: [dense], records: [] }, dense: { range: dense, spanMs: HOUR_MS } },
      { imported: 30, pointed: 30 },
      30,
    );
  });
});
