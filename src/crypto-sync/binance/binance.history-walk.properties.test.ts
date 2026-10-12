import { DAY_MS } from '@kiko/dates';
import {
  BINANCE_PAY_HISTORY_CURSOR_FIELD,
  BINANCE_PAY_PENDING_OVERLAP_FIELD,
  BINANCE_PAY_POINT_CURSOR_FIELD,
  BINANCE_PAY_RESCAN_CURSOR_FIELD,
} from '@kiko/holdings/holding-metadata';
import maybe, { foldMap } from 'fnts/maybe';

import {
  advanceWalkMarks,
  BinanceWalkStop,
  halfOf,
  planWalkPasses,
  runWalkPlan,
  type OwedGround,
  type SpanRead,
  storePointCursor,
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
 * whose time lies in the span, under one of three readings of which end Binance leaves out (both
 * included, the start left out, the end left out), and each property must hold under all three.
 * A stuck record owes its own point and holds nothing else back, so every other record of the
 * span commits. The properties tell a point by the window its record owes (never by a tag or a
 * length), so they hold for any list the walk stores.
 */

const HOUR_MS = 3_600_000;
const SECOND_MS = 1_000;
const FLOOR_MS = Date.UTC(2017, 6, 14);
const START_MS = Date.UTC(2026, 9, 1);
const BASE_MS = Date.UTC(2025, 6, 1);
const WINDOW_MS = 89 * DAY_MS;
const TWO_POWER_32_MS = 2 ** 32;
const NEVER = Number.POSITIVE_INFINITY;
/** The calls a forward pass must leave a run for it to read both the re-scan and a point. */
const RESCAN_AND_POINT_CALLS = 2;
/** The forward window, the re-scan and one read of a point: no call left for a half of it. */
const LEAST_READS_WITH_A_POINT = 3;
const SEEDS = [11, 23, 37];
const COUNTS = Array.from({ length: 12 }, (_unused, index) => index + 1);

/**
 * `precision` is the precision of the time a lane sees: a Pay order has its millisecond, a
 * capital withdrawal only its second, so it sits somewhere in the second its time starts, or
 * (`rounded`) in the half second on either side of it. A `mixed` lane alternates records of that
 * precision with records of a millisecond (a capital deposit).
 */
type Lane = {
  name: string;
  reads: number;
  precision: number;
  mixed?: boolean;
  rounded?: boolean;
};

/** Pay spends one of its calls on the uid, so a run has one read fewer than the lane cap. */
const LANES: Lane[] = [
  { name: 'Pay', reads: LANE_CALL_CAPS.pay - 1, precision: 1 },
  { name: 'capital withdrawals', reads: LANE_CALL_CAPS.capitalWithdraw, precision: SECOND_MS },
  {
    name: 'capital withdrawals with a rounded applyTime',
    reads: LANE_CALL_CAPS.capitalWithdraw,
    precision: SECOND_MS,
    rounded: true,
  },
  {
    name: 'capital withdrawals and deposits',
    reads: LANE_CALL_CAPS.capitalWithdraw,
    precision: SECOND_MS,
    mixed: true,
  },
];

/** Which end of a range Binance leaves out of what a read returns. */
type Reading = 'both ends included' | 'start left out' | 'end left out';

const READINGS: Reading[] = ['both ends included', 'start left out', 'end left out'];

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
 * by, `precision` the precision of `time`. A record is stuck (the walk cannot trust it) in every
 * run before `stuckUntil`. A record `inForward` is one the forward pass reads first, which the
 * cursor must never pass while it is stuck.
 */
type SimRecord = {
  id: number;
  time: number;
  at: number;
  precision: number;
  stuckUntil: number;
  inForward?: boolean;
};

type Scenario = { owed: OwedGround[]; records: SimRecord[] };

type Simulation = {
  lane: Lane;
  reading: Reading;
  scenario: Scenario;
  runs: number;
  /** The time between two runs. */
  gapMs?: number;
  /** A span longer than `spanMs` that overlaps `range` comes back full, so it is read in halves. */
  dense?: { range: WalkWindow; spanMs: number };
  /**
   * Binance filters on a field other than the one the point was derived from: a read of a point
   * returns the records near it that can be trusted, and never a record that is stuck for good.
   */
  mismatch?: boolean;
  /** The first `runs` runs come `gapMs` after the one before them: a forward pass to catch up. */
  catchUp?: { runs: number; gapMs: number };
};

type RunRecord = {
  /** The list of owed ground as the run left it. */
  owed: OwedGround[];
  cursor: number | null;
  rescanReads: number;
  rescanCommits: number;
  /** The most reads one owed point had in the run. */
  readsOfAPoint: number;
  /** The starts of the points the plan gave the run, in order, and of those whose read started. */
  plannedPoints: number[];
  pointsRead: number[];
  /** The calls the forward pass left the run: with none, no later pass reads anything. */
  callsAfterForward: number;
};

type Outcome = { runs: RunRecord[]; importedAt: Map<number, number> };

/** Whether a read of `range` returns the record that Binance filters at `millisecond`. */
const holds = (range: WalkWindow, millisecond: number, reading: Reading): boolean =>
  (reading === 'start left out' ? range.start < millisecond : range.start <= millisecond) &&
  (reading === 'end left out' ? millisecond < range.end : millisecond <= range.end);

/** Whether a read of `range` returns the record under every reading. */
const surelyHolds = (range: WalkWindow, millisecond: number): boolean =>
  range.start < millisecond && millisecond < range.end;

const sameWindow = (left: WalkWindow, right: WalkWindow): boolean =>
  left.start === right.start && left.end === right.end;

const isDense = (dense: Simulation['dense'], span: WalkWindow): boolean =>
  dense !== undefined &&
  span.end - span.start > dense.spanMs &&
  span.start < dense.range.end &&
  span.end > dense.range.start;

/**
 * What a stuck record may sit in, as far as the lane can tell: its millisecond, or for a
 * withdrawal every millisecond a second either side of its time (Binance cuts or rounds the time
 * to the second).
 */
const extentOf = (record: SimRecord): WalkWindow | undefined =>
  record.precision === 1
    ? instantAt(record.time)
    : {
        start: record.time - (record.precision - 1),
        end: record.time + (record.precision - 1),
      };

/** The point a record that was found stuck is owed as: its extent and a millisecond each side. */
const pointOf = (record: SimRecord): OwedGround => ({
  start: record.time - record.precision,
  end: record.time + record.precision,
  kind: 'point',
});

/** Whether the list holds the very ground `record` owes: the point it was found at. */
const holdsPointOf = (owed: OwedGround[], record: SimRecord): boolean =>
  owed.some((ground) => sameWindow(ground, pointOf(record)));

const MARK_FIELDS: WalkMarkFields = {
  cursor: BINANCE_PAY_HISTORY_CURSOR_FIELD,
  rescan: BINANCE_PAY_RESCAN_CURSOR_FIELD,
  point: BINANCE_PAY_POINT_CURSOR_FIELD,
  pending: BINANCE_PAY_PENDING_OVERLAP_FIELD,
};

/** The rows of a record: its id, or a stop while the record is stuck. */
const rowsOf = (entry: SimRecord, run: number): number[] => {
  if (run < entry.stuckUntil) {
    throw new BinanceWalkStop('simulated-stuck');
  }

  return [entry.id];
};

/**
 * What a read of `span` gives: the records in it, or the half to read when it is too full. A
 * read of a point, where Binance filters on another field (`mismatch`), gives the records that
 * can be trusted and lie in it (both ends included), never one that is stuck for good.
 */
const pageOf = (
  input: Simulation,
  span: WalkWindow,
  isPointRead: boolean,
): SpanRead<SimRecord[]> => {
  const half = halfOf(span);

  if (isDense(input.dense, span) && half !== undefined) {
    return { kind: 'split', half };
  }

  const returned =
    input.mismatch === true && isPointRead
      ? (entry: SimRecord) =>
          entry.stuckUntil !== NEVER && holds(span, entry.at, 'both ends included')
      : (entry: SimRecord) => holds(span, entry.at, input.reading);

  return { kind: 'page', page: input.scenario.records.filter(returned) };
};

/** When run number `run` happens: `gapMs` after the one before it, or `catchUp.gapMs` at first. */
const endTimeOf = (input: Simulation, run: number): number => {
  const { gapMs = HOUR_MS, catchUp } = input;
  const early = Math.min(run, catchUp?.runs ?? 0);

  return START_MS + early * (catchUp?.gapMs ?? 0) + (run - early) * gapMs;
};

const simulate = async (input: Simulation): Promise<Outcome> => {
  const { lane, scenario, runs } = input;
  const importedAt = new Map<number, number>();
  let marks: WalkMarks = {
    cursor: START_MS,
    rescanCursor: null,
    pointCursor: null,
    pending: scenario.owed,
  };
  const records: RunRecord[] = [];

  for (let run = 0; run < runs; run += 1) {
    const live: WalkMarks = { ...marks, pending: [...marks.pending] };
    const record: RunRecord = {
      owed: [],
      cursor: null,
      rescanReads: 0,
      rescanCommits: 0,
      readsOfAPoint: 0,
      plannedPoints: [],
      pointsRead: [],
      callsAfterForward: lane.reads,
    };
    const pointReads = new Map<string, number>();
    const plan = planWalkPasses({
      cursor: marks.cursor,
      rescanCursor: marks.rescanCursor,
      pointCursor: marks.pointCursor,
      pending: marks.pending,
      floorMs: FLOOR_MS,
      endTime: endTimeOf(input, run),
      windowMs: WINDOW_MS,
      overlapMs: DAY_MS,
      maxWindows: 80,
    });
    let reads = 0;
    let pastForward = false;
    const isPointWindow = (span: WalkWindow): boolean =>
      plan.points.some((point) => sameWindow(point, span));

    record.plannedPoints = plan.points.map((point) => point.start);

    await runWalkPlan({
      plan,
      canAfford: (keep) => reads + keep < lane.reads,
      markPointRead: (window) =>
        storePointCursor({
          window,
          marks: live,
          field: MARK_FIELDS.point,
          write: async () => undefined,
        }),
      runWindow: (window, pass, keep) => {
        if (pass !== 'forward' && !pastForward) {
          pastForward = true;
          record.callsAfterForward = lane.reads - reads;
        }

        return walkSpans<SimRecord[]>({
          window,
          keep,
          read: async (span, keepCalls) => {
            if (reads + keepCalls >= lane.reads) {
              return undefined;
            }

            reads += 1;
            record.rescanReads += pass === 'rescan' ? 1 : 0;

            if (isPointWindow(span)) {
              const key = `${span.start}:${span.end}`;
              pointReads.set(key, (pointReads.get(key) ?? 0) + 1);
              record.pointsRead.push(span.start);
            }

            return pageOf(input, span, isPointWindow(span));
          },
          commit: async (span, page) => {
            const committed = await commitSettledSpan({
              pass,
              span,
              settled: settleRecords({
                span,
                records: page,
                rowsOf: (entry) => rowsOf(entry, run),
                extentOf,
              }),
              place: async (planned) => planned,
              add: async (ids) => {
                for (const id of ids) {
                  importedAt.set(id, Math.min(importedAt.get(id) ?? run, run));
                }

                return ids.length;
              },
              advance: ({ owed, returned }) =>
                advanceWalkMarks({
                  pass,
                  span,
                  owed,
                  returned,
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
        });
      },
    });

    marks = live;
    record.owed = live.pending;
    record.cursor = live.cursor;
    record.callsAfterForward = pastForward ? record.callsAfterForward : lane.reads - reads;
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
  /** The points are read in a round-robin: see `roundRobinViolations`. */
  roundRobin?: boolean;
  /** Each stuck record is held by exactly one point (it sits where two spans meet). */
  onePoint?: boolean;
  /**
   * No record is stuck and none holds any entry: from this run on the list is empty, and no
   * point is in it in any run.
   */
  drained?: number;
};

/** The runs, from the first in which `held` is true, in which it stops being true. */
const lostAfterHeld = (runs: RunRecord[], held: (run: RunRecord) => boolean): number[] => {
  const first = firstRun(runs, held);

  return first === NEVER
    ? []
    : runs.flatMap((run, index) => (index > first && !held(run) ? [index] : []));
};

/**
 * Round-robin of the points. Every run whose forward pass leaves a call and that plans a point
 * reads at least one (`reads` is the least such a run read; a read is counted once it started,
 * whether or not its window finished), and with the points of the plan staying the same, each
 * is read within `ceil(points / reads)` of those runs: the runs read the points one after the
 * other from the point cursor, wrapping around. The bound is derived from the reads, not
 * sampled. A run whose forward pass spent every call reads nothing, and is not one of them.
 */
const roundRobinViolations = (allRuns: RunRecord[]): string[] => {
  const runs = allRuns.filter((run) => run.callsAfterForward > 0);
  const withPoints = runs.filter((run) => run.plannedPoints.length > 0);
  const reads = Math.min(...withPoints.map((run) => run.pointsRead.length));
  const points = Math.max(...runs.map((run) => run.plannedPoints.length));

  if (withPoints.length === 0 || reads < 1) {
    return [`P5: a run planned points and read none (${withPoints.length} runs with points)`];
  }

  const span = Math.ceil(points / reads);
  const unread = runs.slice(0, Math.max(0, runs.length - span + 1)).flatMap((run, index) =>
    run.plannedPoints.filter((start) => {
      const window = runs.slice(index, index + span);
      const gone = !window.at(-1)?.owed.some((ground) => ground.start === start);

      return !gone && !window.some((other) => other.pointsRead.includes(start));
    }),
  );

  return unread.length > 0
    ? [
        `P5: ${unread.length} points planned in a run not read within ${span} runs ` +
          `(${points} points, at least ${reads} read a run)`,
      ]
    : [];
};

/** What breaks each property, as text a failing run prints; empty when all hold. */
const violationsOf = (outcome: Outcome, scenario: Scenario, bounds: Bounds): string[] => {
  const { runs, importedAt } = outcome;
  const stuck = scenario.records.filter(
    (entry) => entry.stuckUntil === NEVER && entry.inForward !== true,
  );
  const stuckInForward = scenario.records.filter(
    (entry) => entry.stuckUntil === NEVER && entry.inForward === true,
  );
  const late = scenario.records
    .filter((entry) => entry.stuckUntil !== NEVER)
    .filter((entry) => (importedAt.get(entry.id) ?? NEVER) >= entry.stuckUntil + bounds.imported);
  const notPointed = stuck.filter(
    (entry) => firstRun(runs, (run) => holdsPointOf(run.owed, entry)) >= bounds.pointed,
  );
  const dropped = stuck.flatMap((entry) => [
    ...lostAfterHeld(runs, (run) => run.owed.some((range) => surelyHolds(range, entry.at))).map(
      (index) => `record ${entry.id} (at ${entry.at}) left every entry at run ${index}`,
    ),
    ...lostAfterHeld(runs, (run) => holdsPointOf(run.owed, entry)).map(
      (index) => `record ${entry.id} (time ${entry.time}) lost its own point at run ${index}`,
    ),
  ]);
  const manyPoints = bounds.onePoint
    ? stuck.filter((entry) =>
        runs.some(
          (run) => run.owed.filter((ground) => sameWindow(ground, pointOf(entry))).length > 1,
        ),
      )
    : [];
  const passed = stuckInForward.filter((entry) =>
    runs.some((run) => run.cursor !== null && run.cursor > entry.time),
  );
  const noRescanRead = runs.filter(
    (run) => run.rescanReads === 0 && run.callsAfterForward >= RESCAN_AND_POINT_CALLS,
  );
  const noRescanCommit = runs.filter(
    (run) => run.rescanCommits === 0 && run.callsAfterForward >= RESCAN_AND_POINT_CALLS,
  );
  const overReads = runs.filter((run) => run.readsOfAPoint > 1);
  const lingering =
    foldMap(maybe(bounds.drained), (drained) =>
      runs.flatMap((run, index) => (index >= drained && run.owed.length > 0 ? [index] : [])),
    ) ?? [];
  const phantoms =
    foldMap(maybe(bounds.drained), () =>
      runs.flatMap((run, index) => (run.owed.some((g) => g.kind === 'point') ? [index] : [])),
    ) ?? [];

  return [
    ...(lingering.length > 0
      ? [`SL: entries no record holds are still in the list at runs ${lingering}`]
      : []),
    ...(phantoms.length > 0 ? [`SL: a point no record owes appeared at runs ${phantoms}`] : []),
    ...(late.length > 0
      ? [`P1: ${late.length} records imported later than ${bounds.imported} runs after placeable`]
      : []),
    ...(notPointed.length > 0
      ? [`P2: ${notPointed.length} stuck records not owed as a point within ${bounds.pointed} runs`]
      : []),
    ...(dropped.length > 0
      ? [`a stuck record left the list, or lost its own point: ${dropped.join('; ')}`]
      : []),
    ...(manyPoints.length > 0
      ? [`${manyPoints.length} stuck records on a boundary are held by more than one point`]
      : []),
    ...(passed.length > 0 ? ['P6: the cursor passed a stuck record of the forward pass'] : []),
    ...(overReads.length > 0
      ? [`P3: an owed point had more than 1 read in ${overReads.length} runs`]
      : []),
    ...(noRescanRead.length > 0
      ? [`P4: the re-scan had no read in ${noRescanRead.length} runs`]
      : []),
    ...(noRescanCommit.length > 0
      ? [`P4: the re-scan committed nothing in ${noRescanCommit.length} runs`]
      : []),
    ...(bounds.roundRobin ? roundRobinViolations(runs) : []),
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

  /** The precision a record of the lane has: the odd ids of a mixed lane are deposits. */
  const precisionOf = (id: number): number =>
    lane.mixed === true && id % 2 === 1 ? 1 : lane.precision;

  const alignedTo = (millisecond: number, precision: number): number =>
    Math.floor(millisecond / precision) * precision;

  /**
   * Where in its precision a record sits: on the first millisecond, on the last, or anywhere. A
   * withdrawal on either edge of its second is the one a point that stops short would miss. With
   * a rounded time the record sits within half a second either side of `time`.
   */
  const atOf = (id: number, time: number, precision: number): number => {
    const offsets = [0, precision - 1, Math.floor(random() * precision)];
    const shift = lane.rounded === true && precision > 1 ? Math.floor(precision / 2) : 0;

    return time + offsets[id % 3] - shift;
  };

  /** A record at the time `millisecond` has for the lane, anywhere in its own precision. */
  const record = (millisecond: number, stuckUntil = 0): SimRecord => {
    lastId += 1;
    const precision = precisionOf(lastId);
    const time = alignedTo(millisecond, precision);

    return { id: lastId, time, at: atOf(lastId, time, precision), precision, stuckUntil };
  };

  /** A record of the given precision (a deposit has one millisecond), at its own `time`. */
  const typed = (precision: number, millisecond: number, stuckUntil = 0): SimRecord => {
    lastId += 1;
    const time = alignedTo(millisecond, precision);

    return { id: lastId, time, at: atOf(lastId, time, precision), precision, stuckUntil };
  };

  /**
   * A record that can be trusted, one step of the lane's precision before or after `stuck`, whose
   * own time lies inside the point `stuck` owes, on its very edge: a read of that point returns it.
   */
  const neighbourOf = (stuck: SimRecord, side: 'before' | 'after'): SimRecord => {
    lastId += 1;
    const shift =
      lane.rounded === true && stuck.precision > 1 ? Math.floor(stuck.precision / 2) : 0;
    const time = stuck.time + (side === 'after' ? stuck.precision : -stuck.precision);
    const at = side === 'after' ? time - shift : time + stuck.precision - 1 - shift;

    return { id: lastId, time, at, precision: stuck.precision, stuckUntil: 0 };
  };

  /** A record at the very time of `other`: the same millisecond, or the same second. */
  const twinOf = (other: SimRecord, stuckUntil = 0): SimRecord => {
    lastId += 1;

    return {
      id: lastId,
      time: other.time,
      at: atOf(lastId, other.time, other.precision),
      precision: other.precision,
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

  return { record, typed, twinOf, neighbourOf, interiorOf, rangeAt };
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
 * ONE owed day that comes back full above 6 hours, so it is read as spans that meet at 6, 12 and
 * 18 hours, with a stuck record exactly on each of those places and a record that can be trusted
 * beside each. A record where two spans meet is returned by both reads, and owes one point.
 */
const boundaryScenario = (lane: Lane, seed: number): Scenario => {
  const builder = builderOf(lane, seed);
  const day = dayAt(40);
  const unrelated = unrelatedDayOf(lane, seed);
  const meetings = [6, 12, 18].map((hours) => day.start + hours * HOUR_MS);

  return {
    owed: [day, unrelated.day],
    records: [
      ...meetings.flatMap((time) => {
        const stuck = builder.record(time, NEVER);

        return [stuck, builder.twinOf(stuck), builder.record(time + 2 * SECOND_MS)];
      }),
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
    owed: stuck.map(pointOf),
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

  return { owed: stuck.map(pointOf), records: stuck };
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
    owed: [...days, ...stuck.map(pointOf)],
    records: [
      ...stuck,
      ...stuck.map((entry) => builder.twinOf(entry)),
      ...days.map((day) => builder.record(builder.interiorOf(day))),
    ],
  };
};

/**
 * Fourteen owed ranges, two of them a day apart, so those two are the nearest and merge into a
 * hull; a stuck record, already found as a point, lies between them: inside the hull. The point
 * is never merged into the hull and never leaves with it: it stays as its record owes it.
 */
const insideMergedRangeScenario = (lane: Lane, seed: number): Scenario => {
  const builder = builderOf(lane, seed);
  const days = Array.from({ length: 14 }, (_unused, index) => builder.rangeAt(index));
  const near = { start: days[6].end + DAY_MS, end: days[6].end + DAY_MS + 3 * HOUR_MS };
  const ranges = days.map((day, index) => (index === 7 ? near : day));
  const stuck = builder.record(days[6].end + 12 * HOUR_MS, NEVER);

  return {
    owed: [...ranges, pointOf(stuck)],
    records: [
      stuck,
      builder.twinOf(stuck),
      ...ranges.map((range) => builder.record(builder.interiorOf(range))),
    ],
  };
};

/**
 * `count` points found long ago, and a stuck record the forward pass meets at its start, so the
 * forward pass stops in every run from the second on and the cursor stays. An owed day holds a
 * record that becomes trustworthy at run 2, after the stop began, and one that can be trusted.
 */
const forwardStopScenario = (lane: Lane, count: number): Scenario => {
  const builder = builderOf(lane, 29);
  const day = dayAt(40);
  const points = Array.from({ length: count }, (_unused, index) =>
    builder.record(BASE_MS + (60 + index * 10) * DAY_MS + HOUR_MS, NEVER),
  );

  return {
    owed: [day, ...points.map(pointOf)],
    records: [
      { ...builder.record(START_MS + 30 * 60_000, NEVER), inForward: true },
      builder.record(builder.interiorOf(day), 2),
      builder.record(builder.interiorOf(day)),
      ...points,
    ],
  };
};

/**
 * `count` points found long ago, behind the window, and a re-scan that comes back full above 3
 * days, so one pass of the window spans several runs.
 */
const denseRescanPointsScenario = (lane: Lane, count: number): Scenario => {
  const builder = builderOf(lane, 31);
  const stuck = Array.from({ length: count }, (_unused, index) =>
    builder.record(BASE_MS + index * 10 * DAY_MS + HOUR_MS, NEVER),
  );

  return { owed: stuck.map(pointOf), records: stuck };
};

/**
 * `count` stuck records ten days apart, behind the window, each with a record that can be trusted
 * a step before it and one a step after it, on the very edge of its point (and none at its own
 * time). Read with `mismatch`, a read of a point returns those neighbours and never the stuck
 * record. With `found`, the stuck records sit in an owed day each and the walk finds the points
 * itself; otherwise their points are in the list already.
 */
const neighboursScenario = (lane: Lane, count: number, found: boolean): Scenario => {
  const builder = builderOf(lane, 41);
  const days = found ? Array.from({ length: count }, (_u, index) => builder.rangeAt(index)) : [];
  const stuck = Array.from({ length: count }, (_unused, index) =>
    builder.record(
      found ? builder.interiorOf(days[index]) : BASE_MS + index * 10 * DAY_MS + HOUR_MS,
      NEVER,
    ),
  );

  return {
    owed: found ? days : stuck.map(pointOf),
    records: [
      ...stuck,
      ...stuck.flatMap((entry) => [
        builder.neighbourOf(entry, 'before'),
        builder.neighbourOf(entry, 'after'),
      ]),
    ],
  };
};

/**
 * Owed ranges that hold no record: one that starts 500 ms behind the start of the re-scan (what
 * a long range leaves once the re-scan has taken the rest of it), and ranges of 1 ms up to 5 s,
 * with lengths on either side of 1000 ms. A range is read once and leaves, whatever its length.
 */
const SLIVER_LENGTHS_MS = [1, 2, 3, 500, 1_000, 1_001, 1_002, 1_500, 2_000, 5_000];

const sliversScenario = (): Scenario => {
  const behindRescan = { start: START_MS - WINDOW_MS - 500, end: START_MS - WINDOW_MS + DAY_MS };
  const slivers = SLIVER_LENGTHS_MS.map((length, index) => {
    const start = BASE_MS + index * 10 * DAY_MS + 123_456;

    return { start, end: start + length };
  });

  return { owed: [behindRescan, ...slivers], records: [] };
};

/**
 * `count` stuck records found as points, ten days apart, behind the window; the newest becomes
 * trustworthy once the walk has caught up (see `CATCH_UP_PLACEABLE_AT`), and is the one to
 * import.
 */
const CATCH_UP_PLACEABLE_AT = 8;

const catchUpScenario = (lane: Lane, count: number): Scenario => {
  const builder = builderOf(lane, 47);
  const stuck = Array.from({ length: count }, (_unused, index) =>
    builder.record(
      BASE_MS + index * 10 * DAY_MS + HOUR_MS,
      index === count - 1 ? CATCH_UP_PLACEABLE_AT : NEVER,
    ),
  );

  return { owed: stuck.map(pointOf), records: stuck };
};

/**
 * `count` owed days that each hold two stuck records whose points start together: a withdrawal at
 * a second, and a deposit 999 ms before it (the point of a deposit is 1 ms either side of its
 * time, that of a withdrawal 1000 ms either side), beside a deposit that can be trusted at the
 * very start of the withdrawal's second. With `found` the days are owed and the walk finds the
 * points; otherwise both points are in the list already. Only a mixed lane has deposits.
 */
const sharedStartScenario = (lane: Lane, count: number, found: boolean): Scenario => {
  const builder = builderOf(lane, 61);
  const days = Array.from({ length: count }, (_unused, index) => builder.rangeAt(index));
  const withdrawals = days.map((day) => builder.typed(SECOND_MS, builder.interiorOf(day), NEVER));
  const deposits = withdrawals.map((entry) => builder.typed(1, entry.time - 999, NEVER));

  return {
    owed: found ? days : [...withdrawals, ...deposits].map(pointOf),
    records: [
      ...withdrawals,
      ...deposits,
      ...withdrawals.map((entry) => builder.typed(1, entry.time)),
    ],
  };
};

/**
 * The runs the properties allow, linear in the owed ranges: each is read once, oldest first, on
 * the reads a run has beside the forward pass and the two the re-scan and the points keep.
 * Measured worst cases over the scenarios below sit under these.
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

/** A re-scan that comes back full above 3 days needs more reads for one pass than a run has. */
const DENSE_RESCAN_MS = 3 * DAY_MS;

/**
 * The runs the round-robin of `points` allows when each run reads at least `reads` of them: the
 * forward pass and the re-scan spend one read each in a run of these scenarios, and the rest
 * go to the points.
 */
const pointRuns = (points: number, reads: number): number => Math.ceil(points / reads);

describe.each(LANES)('owed ground that never commits, $name lane', (lane) => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  describe.each(READINGS)('a read that returns the records with %s', (reading) => {
    const seeds = reading === 'both ends included' ? SEEDS : SEEDS.slice(0, 1);

    const check = async (
      input: Pick<Simulation, 'scenario' | 'gapMs' | 'dense' | 'mismatch' | 'catchUp'> & {
        /** The reads of a run, when the scenario fixes them instead of the lane. */
        reads?: number;
      },
      bounds: Bounds,
      runs: number,
    ) => {
      const { reads = lane.reads, ...rest } = input;
      const outcome = await simulate({ lane: { ...lane, reads }, reading, runs, ...rest });

      expect(violationsOf(outcome, input.scenario, bounds)).toEqual([]);

      return outcome;
    };

    const rows = (counts: number[], rowSeeds = seeds) =>
      counts.flatMap((count) =>
        rowSeeds.map((seed) => ({
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

    it.each(SEEDS.map((seed) => ({ seed })))(
      'P1-P4 and one point: three stuck records exactly where two spans of a day that comes back full above 6 hours meet (seed $seed): each is held by exactly one point, however many spans read it',
      async ({ seed }) => {
        const bound = denseDayRuns(lane);

        await check(
          {
            scenario: boundaryScenario(lane, seed),
            dense: { range: dayAt(40), spanMs: DENSE_DAY_MS },
          },
          { imported: bound, pointed: bound, onePoint: true },
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

    const TWIN_COUNTS = [...COUNTS, 14, 20];

    it.each(TWIN_COUNTS.map((count) => ({ count, bound: pointRuns(count, lane.reads - 2) })))(
      'P1-P5: a record that can be trusted at the very millisecond (a withdrawal: second) of each of $count stuck records, found already: imported within $bound runs, the points read in a round-robin, 1 read a run per point, a re-scan read and commit every run',
      async ({ count, bound }) => {
        await check(
          { scenario: twinPointsScenario(lane, count) },
          { imported: bound, pointed: 1, roundRobin: true },
          bound + 6,
        );
      },
    );

    it.each(rows(COUNTS, seeds.slice(0, 2)))(
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

    it.each(rows(COUNTS, seeds.slice(0, 2)))(
      'P1-P4: $count stuck records inside the re-scan window, none found yet, the window read whole (seed $seed): the records after them import and each stuck record is a point within 2 runs, a re-scan read and commit every run',
      async ({ count, seed }) => {
        await check(
          { scenario: rescanScenario(lane, count, seed) },
          { imported: 2, pointed: 2 },
          8,
        );
      },
    );

    const MANY_POINTS = [10, 20, 30];
    const GAPS = [HOUR_MS, DAY_MS, TWO_POWER_32_MS];

    it.each(
      MANY_POINTS.flatMap((count) =>
        GAPS.map((gapMs) => ({
          count,
          gapMs,
          bound: pointRuns(count, lane.reads - 2),
        })),
      ),
    )(
      `P1-P5: $count owed points, the newest placeable at run ${PLACEABLE_AT}, runs $gapMs ms apart (also exactly 2^32 ms): the newest imports within $bound runs of that, the points read in a round-robin, 1 read a run per point, a re-scan read and commit every run`,
      async ({ count, gapMs, bound }) => {
        await check(
          { scenario: manyPointsScenario(lane, count), gapMs },
          { imported: bound, pointed: 1, roundRobin: true },
          PLACEABLE_AT + bound + 2 * count + 5,
        );
      },
    );

    it.each(
      [10, 20, 30].flatMap((count) => [DAY_MS, TWO_POWER_32_MS].map((gapMs) => ({ count, gapMs }))),
    )(
      'P1-P5: $count owed points and a re-scan that comes back full above 3 days, so one pass of it spans several runs, runs $gapMs ms apart: every run still reads a point, and each is read within $count runs',
      async ({ count, gapMs }) => {
        await check(
          {
            scenario: denseRescanPointsScenario(lane, count),
            gapMs,
            dense: {
              range: { start: START_MS - WINDOW_MS - 10 * DAY_MS, end: START_MS },
              spanMs: DENSE_RESCAN_MS,
            },
          },
          { imported: count, pointed: 1, roundRobin: true },
          2 * count + 5,
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

    it.each(seeds.map((seed) => ({ seed, bound: rangeRuns(lane, 14) + 6 })))(
      'P1-P4: 14 owed days, two of them a day apart, and a stuck record found as a point between them, inside the hull they merge into (seed $seed): the point is never merged into the hull nor dropped with it, and every record is imported within $bound runs',
      async ({ seed, bound }) => {
        await check(
          { scenario: insideMergedRangeScenario(lane, seed) },
          { imported: bound, pointed: 1 },
          bound + 5,
        );
      },
    );

    it.each([1, 3, 12].map((count) => ({ count, bound: pointRuns(count + 1, lane.reads - 2) })))(
      'P1-P6: the forward pass stops in every run from the second on at a stuck record that the cursor must not pass, $count points and an owed day holding a record that settles at run 2: the record imports within $bound runs of that (its point is read in the round-robin), the cursor stays and the re-scan has a read and a commit every run',
      async ({ count, bound }) => {
        await check(
          { scenario: forwardStopScenario(lane, count) },
          { imported: bound, pointed: 1, roundRobin: true },
          2 * count + 8,
        );
      },
    );

    it.each(
      [1, 3, 12].flatMap((count) =>
        [true, false].map((found) => ({
          count,
          found,
          bound: found ? rangeRuns(lane, count + 1) : pointRuns(count, lane.reads - 2) + 1,
        })),
      ),
    )(
      'P1-P4 with Binance filtering on another field: $count stuck records (found in an owed day: $found) that a read of their point never returns, only the neighbours on its edges: every point stays as its record owes it, and the neighbours import within $bound runs',
      async ({ count, found, bound }) => {
        await check(
          { scenario: neighboursScenario(lane, count, found), mismatch: true },
          { imported: bound, pointed: found ? bound : 1 },
          bound + 8,
        );
      },
    );

    it('SL: ranges of 1 ms to 5 s that hold no record, one 500 ms behind the start of the re-scan: each leaves once it is read, whatever its length, and no point appears', async () => {
      const drained = rangeRuns(lane, SLIVER_LENGTHS_MS.length + 1) + 1;

      await check(
        { scenario: sliversScenario() },
        { imported: drained, pointed: drained, drained },
        drained + 4,
      );
    });

    it.each([2, 3, 5].map((count) => ({ count })))(
      'P5: $count points whose window comes back full, on a run with one call left for the points: the point cursor moves on once a read has started, so each is read within $count runs',
      async ({ count }) => {
        await check(
          {
            scenario: denseRescanPointsScenario(lane, count),
            reads: LEAST_READS_WITH_A_POINT,
            dense: {
              range: { start: BASE_MS - DAY_MS, end: BASE_MS + 10 * count * DAY_MS },
              spanMs: 1,
            },
          },
          { imported: count, pointed: 1, roundRobin: true },
          count + 4,
        );
      },
    );

    it.each([2, 5, 8].map((count) => ({ count, bound: pointRuns(count, lane.reads - 2) + 1 })))(
      'P1-P5: the forward pass spends every call of the first runs catching up on a gap of 3000 days, so those runs read no point; the runs after them read the $count points in a round-robin, and the newest imports within $bound runs of becoming placeable',
      async ({ count, bound }) => {
        const outcome = await check(
          {
            scenario: catchUpScenario(lane, count),
            catchUp: { runs: 1, gapMs: 3_000 * DAY_MS },
          },
          { imported: bound, pointed: 1, roundRobin: true },
          CATCH_UP_PLACEABLE_AT + bound + count + 5,
        );

        expect(outcome.runs.some((run) => run.callsAfterForward === 0)).toBe(true);
        expect(outcome.runs.at(-1)?.callsAfterForward).toBeGreaterThan(0);
      },
    );

    if (lane.mixed === true) {
      it.each(
        [1, 3, 6].flatMap((count) =>
          [true, false].map((found) => ({
            count,
            found,
            bound: found ? rangeRuns(lane, count + 1) : pointRuns(count, lane.reads - 2) + 1,
          })),
        ),
      )(
        'P1-P5: $count withdrawals and a deposit 999 ms before each, whose points start together, beside a deposit that can be trusted at the start of the withdrawal second (found in an owed day: $found): both points stay, as their records owe them, and every other record imports within $bound runs',
        async ({ count, found, bound }) => {
          await check(
            { scenario: sharedStartScenario(lane, count, found) },
            { imported: bound, pointed: found ? bound : 1, roundRobin: true },
            bound + 8,
          );
        },
      );
    }

    it('P4: a dense owed day that needs many reads leaves the re-scan a read and a commit every run of 30', async () => {
      const dense = dayAt(30);

      await check(
        { scenario: { owed: [dense], records: [] }, dense: { range: dense, spanMs: HOUR_MS } },
        { imported: 30, pointed: 30 },
        30,
      );
    });
  });
});
