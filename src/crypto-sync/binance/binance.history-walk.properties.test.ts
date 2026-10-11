import { DAY_MS } from '@kiko/dates';
import {
  BINANCE_PAY_HISTORY_CURSOR_FIELD,
  BINANCE_PAY_PENDING_OVERLAP_FIELD,
  BINANCE_PAY_RESCAN_CURSOR_FIELD,
} from '@kiko/holdings/holding-metadata';

import {
  advanceWalkMarks,
  halfOf,
  planWalkPasses,
  runWalkPlan,
  walkSpans,
  type WalkMarks,
  type WalkWindow,
} from './binance.history-walk';
import { LANE_CALL_CAPS } from './binance.history-budget';

/**
 * The walk's own functions driven run after run, as the lanes drive them, against records that
 * can never be committed. A run reads at most `reads` spans; a read of a span that holds a
 * stuck record stops its commit, any other read commits.
 */

const HOUR_MS = 3_600_000;
const FLOOR_MS = Date.UTC(2017, 6, 14);
const START_MS = Date.UTC(2026, 9, 1);
const BASE_MS = Date.UTC(2025, 6, 1);
const WINDOW_MS = 89 * DAY_MS;
const MAX_ISOLATED_MS = 2;
const CLUSTER_MS = 4;
const CLUSTER_READS = 3;

/** Pay spends one of its calls on the uid, so a run has one read fewer than the lane cap. */
const LANES = [
  { name: 'Pay', reads: LANE_CALL_CAPS.pay - 1 },
  { name: 'capital', reads: LANE_CALL_CAPS.capitalWithdraw },
] as const;

const COUNTS = Array.from({ length: 12 }, (_, index) => index + 1);

/** A seeded generator (Lehmer), so a failing run replays. */
const seededRandom = (seed: number): (() => number) => {
  let state = seed;

  return () => {
    state = (state * 48_271) % 2_147_483_647;

    return state / 2_147_483_647;
  };
};

type RunRecord = {
  owed: WalkWindow[];
  stuckReads: number[];
  rescanReads: number;
  rescanCommits: number;
};

const holds = (range: WalkWindow, millisecond: number): boolean =>
  range.start <= millisecond && millisecond <= range.end;

type Simulation = {
  reads: number;
  stuck: number[];
  owed: WalkWindow[];
  runs: number;
  /** A span longer than `spanMs` that overlaps `range` comes back full, so it is read in halves. */
  dense?: { range: WalkWindow; spanMs: number };
};

const isDense = (dense: Simulation['dense'], span: WalkWindow): boolean =>
  dense !== undefined &&
  span.end - span.start > dense.spanMs &&
  span.start < dense.range.end &&
  span.end > dense.range.start;

/** The owed list as the next run reads it: oldest first, with the ranges that touch merged. */
const touchingMerged = (ranges: WalkWindow[]): WalkWindow[] =>
  [...ranges]
    .sort((left, right) => left.start - right.start)
    .reduce<WalkWindow[]>((merged, range) => {
      const last = merged.at(-1);

      if (last !== undefined && range.start <= last.end) {
        merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, range.end) };
      } else {
        merged.push({ ...range });
      }

      return merged;
    }, []);

const simulate = async (input: Simulation): Promise<RunRecord[]> => {
  const { reads: readsPerRun, stuck, owed, runs, dense } = input;
  let marks: WalkMarks = { cursor: START_MS, rescanCursor: null, pending: owed };
  const records: RunRecord[] = [];

  for (let run = 0; run < runs; run += 1) {
    const live: WalkMarks = { ...marks, pending: [...marks.pending] };
    const record: RunRecord = {
      owed: [],
      stuckReads: stuck.map(() => 0),
      rescanReads: 0,
      rescanCommits: 0,
    };
    const plan = planWalkPasses({
      cursor: marks.cursor,
      rescanCursor: marks.rescanCursor,
      pending: marks.pending,
      floorMs: FLOOR_MS,
      endTime: START_MS + run * HOUR_MS,
      windowMs: WINDOW_MS,
      overlapMs: DAY_MS,
      maxWindows: 80,
    });
    let reads = 0;

    await runWalkPlan({
      plan,
      canAfford: (keep = 0) => reads + keep < readsPerRun,
      runWindow: (window, pass, keep = 0) =>
        walkSpans({
          window,
          pass,
          keep,
          read: async (span, keepCalls = 0) => {
            if (reads + keepCalls >= readsPerRun) {
              return undefined;
            }

            reads += 1;
            record.rescanReads += pass === 'rescan' ? 1 : 0;
            stuck.forEach((millisecond, index) => {
              record.stuckReads[index] += holds(span, millisecond) ? 1 : 0;
            });
            const half = halfOf(span);

            return isDense(dense, span) && half !== undefined
              ? { kind: 'split', half }
              : { kind: 'page', page: null };
          },
          commit: async (span) => {
            if (stuck.some((millisecond) => holds(span, millisecond))) {
              return undefined;
            }

            await advanceWalkMarks({
              pass,
              span,
              plan,
              marks: live,
              restartMs: FLOOR_MS,
              fields: {
                cursor: BINANCE_PAY_HISTORY_CURSOR_FIELD,
                rescan: BINANCE_PAY_RESCAN_CURSOR_FIELD,
                pending: BINANCE_PAY_PENDING_OVERLAP_FIELD,
              },
              write: async () => undefined,
              writePending: async () => undefined,
            });
            record.rescanCommits += pass === 'rescan' ? 1 : 0;

            return 0;
          },
        }),
    });

    marks = live;
    record.owed = touchingMerged(live.pending);
    records.push(record);
  }

  return records;
};

const firstRun = (records: RunRecord[], test: (record: RunRecord) => boolean): number => {
  const index = records.findIndex(test);

  return index === -1 ? Number.POSITIVE_INFINITY : index;
};

/**
 * A span that cannot shrink further: one stuck record in 2 ms or less, or two or more within 4
 * ms of each other, where every read inside the span holds one of them.
 */
const isStuckSpan = (range: WalkWindow, stuck: number[]): boolean => {
  const held = stuck.filter((millisecond) => holds(range, millisecond)).length;
  const length = range.end - range.start;

  return (length <= MAX_ISOLATED_MS && held >= 1) || (length <= CLUSTER_MS && held >= 2);
};

/**
 * What a stuck record may cost a run once its span cannot shrink: one read, or, when another
 * stuck record lies within 4 ms of it, the span's whole read and the two reads of its ends.
 */
const readsAllowed = (stuck: number[], index: number): number =>
  stuck.some(
    (millisecond, other) => other !== index && Math.abs(millisecond - stuck[index]) <= CLUSTER_MS,
  )
    ? CLUSTER_READS
    : 1;

/** The first run at whose end every stuck record sits in an owed span that cannot shrink. */
const stuckIsolatedAt = (records: RunRecord[], stuck: number[]): number =>
  firstRun(records, (record) =>
    stuck.every((millisecond) =>
      record.owed.some((range) => holds(range, millisecond) && isStuckSpan(range, stuck)),
    ),
  );

/** The first run at whose end the only ground still owed is isolated stuck spans. */
const groundImportedAt = (records: RunRecord[], stuck: number[]): number =>
  firstRun(records, (record) => record.owed.every((range) => isStuckSpan(range, stuck)));

/** The first run at whose end no owed range overlaps `range`. */
const dayImportedAt = (records: RunRecord[], range: WalkWindow): number =>
  firstRun(records, (record) =>
    record.owed.every((owed) => owed.end <= range.start || owed.start >= range.end),
  );

type Scenario = {
  stuck: number[];
  owed: WalkWindow[];
  /** Owed days with nothing stuck in them. */
  unrelated: WalkWindow[];
};

type Placed = { range: WalkWindow; stuck: number };

/** One owed range of 3 to 24 hours per stuck record, ten days apart so none touches another. */
const placeStuck = (
  random: () => number,
  count: number,
  pick: (random: () => number, range: WalkWindow, index: number) => number,
): Placed[] =>
  Array.from({ length: count }, (_, index) => {
    const start = BASE_MS + index * 10 * DAY_MS + Math.floor(random() * 1_000_000);
    const range = { start, end: start + 3 * HOUR_MS + Math.floor(random() * 21 * HOUR_MS) };

    return { range, stuck: pick(random, range, index) };
  });

const interiorOf = (random: () => number, range: WalkWindow): number =>
  range.start + 1 + Math.floor(random() * (range.end - range.start - 1));

/** The midpoint of the part of `range` that `path` names: `L` the first half, `R` the second. */
const midpointAt = (range: WalkWindow, path: string): number => {
  let span = range;

  for (const side of path) {
    const half = halfOf(span);

    if (half === undefined) {
      break;
    }

    span = side === 'L' ? half : { start: half.end, end: span.end };
  }

  return span.start + Math.floor((span.end - span.start) / 2);
};

const MIDPOINT_PATHS = ['', 'L', 'R', 'LL', 'LR', 'RL', 'RR', 'LRL', 'RLR', 'LLLL'];

const dayAt = (daysAfterBase: number): WalkWindow => ({
  start: BASE_MS + daysAfterBase * DAY_MS,
  end: BASE_MS + (daysAfterBase + 1) * DAY_MS,
});

const scenarioOf = (placed: Placed[], unrelated: WalkWindow[]): Scenario => ({
  stuck: placed.map((entry) => entry.stuck),
  owed: [...placed.map((entry) => entry.range), ...unrelated],
  unrelated,
});

/** A day owed far behind every stuck range. */
const randomScenario = (count: number, seed: number): Scenario =>
  scenarioOf(
    placeStuck(seededRandom(seed), count, (random, range) => interiorOf(random, range)),
    [dayAt(250)],
  );

const midpointScenario = (count: number): Scenario =>
  scenarioOf(
    placeStuck(seededRandom(5), count, (_, range, index) =>
      midpointAt(range, MIDPOINT_PATHS[index % MIDPOINT_PATHS.length]),
    ),
    [dayAt(250)],
  );

/**
 * Thirteen owed ranges, so the two newest merge into one hull that holds the newest stuck range
 * and an unrelated day behind it.
 */
const mergedScenario = (count: number): Scenario =>
  scenarioOf(
    placeStuck(seededRandom(9), count, (random, range) => interiorOf(random, range)),
    [
      ...Array.from({ length: 12 - count }, (_, index) => dayAt(-(index + 1) * 5)),
      dayAt(count * 10 + 2),
    ],
  );

/**
 * One owed day with `count` stuck records in it: the first at a random point, the second right
 * beside it (a pair no read can split, so its span stays 3 ms), the rest at random points that
 * the halving must separate from each other and from the pair.
 */
const clusteredScenario = (count: number): Scenario => {
  const random = seededRandom(31);
  const range = dayAt(40);
  const first = interiorOf(random, range);
  const rest = Array.from({ length: Math.max(count - 2, 0) }, () => interiorOf(random, range));
  const stuck = [first, first + 1, ...rest];

  return { stuck, owed: [range, dayAt(250)], unrelated: [dayAt(250)] };
};

/** One owed day with `count` stuck records at random points in it. */
const sameDayScenario = (count: number, seed: number): Scenario => {
  const random = seededRandom(seed);
  const range = dayAt(40);

  return {
    stuck: Array.from({ length: count }, () => interiorOf(random, range)),
    owed: [range, dayAt(250)],
    unrelated: [dayAt(250)],
  };
};

const tinyScenario = (length: number, ...offsets: number[]): Scenario => {
  const range = { start: BASE_MS + 1_000, end: BASE_MS + 1_000 + length };

  return { stuck: offsets.map((offset) => range.start + offset), owed: [range], unrelated: [] };
};

/**
 * The bounds the properties state, in runs, linear in the number of stuck records `count`. A
 * stuck span of one day halves in 27 levels of up to two reads, and what a run can spend on it
 * is the lane's reads less the forward pass, the whole reads of the owed ranges and the re-scan's
 * one. Measured worst cases over the scenarios below: Pay 82 runs to isolate and 53 to import an
 * unrelated day (12 stuck), capital 149 and 134.
 */
const isolationRuns = (reads: number, count: number): number =>
  reads >= 19 ? 8 * count + 4 : 12 * count + 8;
const importRuns = (reads: number, count: number): number =>
  reads >= 19 ? 5 * count : 12 * count + 4;

type Bounds = { isolation: number; day: number };

/** What breaks each property, as text a failing run prints; empty when all hold. */
const violationsOf = (records: RunRecord[], scenario: Scenario, bounds: Bounds): string[] => {
  const { stuck, unrelated } = scenario;
  const isolatedAt = stuckIsolatedAt(records, stuck);
  const groundAt = groundImportedAt(records, stuck);
  const droppedAt = firstRun(records, (record) =>
    stuck.some((millisecond) => !record.owed.some((range) => holds(range, millisecond))),
  );
  const noRescanRead = records.filter((record) => record.rescanReads === 0);
  const noRescanCommit = records.filter((record) => record.rescanCommits === 0);
  const lateDays = unrelated
    .map((range) => dayImportedAt(records, range))
    .filter((at) => at > bounds.day);
  const overReads = records
    .slice(isolatedAt + 1)
    .flatMap((record, index) =>
      record.stuckReads.map((count, stuckIndex) => ({ index, count, stuckIndex })),
    )
    .filter((read) => read.count > readsAllowed(stuck, read.stuckIndex));

  return [
    ...(droppedAt === Number.POSITIVE_INFINITY
      ? []
      : [`a stuck record left the list at run ${droppedAt}`]),
    ...(isolatedAt > bounds.isolation
      ? [
          `P2: stuck spans not all at their minimum within ${bounds.isolation} runs (at run ${isolatedAt})`,
        ]
      : []),
    ...(groundAt > bounds.isolation
      ? [
          `P1: owed ground other than stuck spans left after ${bounds.isolation} runs (at run ${groundAt})`,
        ]
      : []),
    ...(lateDays.length > 0
      ? [`P1: an unrelated owed day imported at run ${lateDays.join(',')}, over ${bounds.day}`]
      : []),
    ...(overReads.length > 0
      ? [
          `P3: after run ${isolatedAt} a stuck record cost more reads than it may:${overReads.length} times, first ${JSON.stringify(overReads[0])}`,
        ]
      : []),
    ...(noRescanRead.length > 0
      ? [`P4: the re-scan had no read in ${noRescanRead.length} runs`]
      : []),
    ...(noRescanCommit.length > 0
      ? [`P4: the re-scan committed nothing in ${noRescanCommit.length} runs`]
      : []),
  ];
};

describe.each(LANES)('owed ranges that never commit, $name lane', ({ reads }) => {
  const check = async (scenario: Scenario, bounds: Bounds, runs: number) => {
    const records = await simulate({ reads, stuck: scenario.stuck, owed: scenario.owed, runs });

    expect(violationsOf(records, scenario, bounds)).toEqual([]);
  };
  const boundsOf = (count: number): Bounds => ({
    isolation: isolationRuns(reads, count),
    day: importRuns(reads, count),
  });
  const rowOf = (count: number, seed = 0) => ({
    count,
    seed,
    isolation: boundsOf(count).isolation,
    day: boundsOf(count).day,
  });

  it.each(COUNTS.flatMap((count) => [11, 23, 37].map((seed) => rowOf(count, seed))))(
    'P1-P4: $count stuck records at random interior points (seed $seed): every stuck span 2 ms or less within $isolation runs, an unrelated owed day imported within $day runs, 1 read a run per stuck record after that, a re-scan read and commit every run',
    async ({ count, seed, isolation }) => {
      await check(randomScenario(count, seed), boundsOf(count), isolation + 5);
    },
  );

  it.each(COUNTS.map((count) => rowOf(count)))(
    'P1-P4: $count stuck records at exact midpoints of a range and of its halves: every stuck span 2 ms or less within $isolation runs, an unrelated owed day imported within $day runs, 1 read a run per stuck record after that, a re-scan read and commit every run',
    async ({ count, isolation }) => {
      await check(midpointScenario(count), boundsOf(count), isolation + 5);
    },
  );

  it.each(COUNTS.map((count) => rowOf(count)))(
    'P1-P4: with $count stuck, a list past 12 ranges merges a stuck record with an unrelated day: every stuck span 2 ms or less within $isolation runs, the day imported within $day runs, 1 read a run per stuck record after that, a re-scan read and commit every run',
    async ({ count, isolation }) => {
      await check(mergedScenario(count), boundsOf(count), isolation + 5);
    },
  );

  // A halving in which every part holds a stuck record commits nothing, so the next run starts
  // again from the top: records packed in ONE span need more reads in one run than the 9-call
  // lane has once more than 3 of them lie in it. Not pinned there (see the spec, "Bound").
  const inOneSpan = COUNTS.filter((count) => reads >= LANE_CALL_CAPS.pay - 1 || count <= 3);

  it.each(inOneSpan.flatMap((count) => [11, 23, 37].map((seed) => rowOf(count, seed))))(
    'P1-P4: $count stuck records at random points inside one owed day (seed $seed): every stuck span 2 ms or less within $isolation runs, an unrelated owed day imported within $day runs, 1 read a run per stuck record after that, a re-scan read and commit every run',
    async ({ count, seed, isolation }) => {
      await check(sameDayScenario(count, seed), boundsOf(count), isolation + 5);
    },
  );

  it.each(inOneSpan.slice(1).map((count) => rowOf(count)))(
    'P1-P4: $count stuck records inside one owed day, two of them 1 ms apart (a span of 3 ms no read can split): every stuck span at its minimum within $isolation runs, at most 3 reads a run for the pair and 1 for each other record after that, a re-scan read and commit every run',
    async ({ count, isolation }) => {
      await check(clusteredScenario(count), boundsOf(count), isolation + 5);
    },
  );

  const TINY = Array.from({ length: 8 }, (_, index) => index + 3).flatMap((length) =>
    Array.from({ length: length + 1 }, (_, offset) => ({ length, offset })),
  );

  it.each(TINY)(
    'P2-P3: an owed range of $length ms with its stuck record $offset ms in is 2 ms or less within 8 runs, then costs 1 read a run',
    async ({ length, offset }) => {
      await check(tinyScenario(length, offset), { isolation: 8, day: 8 }, 12);
    },
  );

  const TINY_PAIRS = Array.from({ length: 7 }, (_, index) => index + 3).flatMap((length) =>
    COUNTS.slice(0, length).flatMap((second) =>
      Array.from({ length: second }, (_, first) => ({ length, first, second })),
    ),
  );

  it.each(TINY_PAIRS)(
    'P1-P3: an owed range of $length ms with stuck records at $first and $second ms in: neither leaves the list, every stuck span at its minimum within 8 runs, then 3 reads a run at most',
    async ({ length, first, second }) => {
      await check(tinyScenario(length, first, second), { isolation: 8, day: 8 }, 12);
    },
  );

  it('P4: a dense owed day that needs many reads leaves the re-scan a read and a commit every run of 30', async () => {
    const dense = dayAt(30);

    const records = await simulate({
      reads,
      stuck: [],
      owed: [dense],
      runs: 30,
      dense: { range: dense, spanMs: HOUR_MS },
    });

    expect(
      violationsOf(
        records,
        { stuck: [], owed: [dense], unrelated: [dense] },
        { isolation: 30, day: 30 },
      ),
    ).toEqual([]);
  });
});
