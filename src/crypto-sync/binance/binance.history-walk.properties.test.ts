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
  dropReadPoints,
  halfOf,
  planWalkPasses,
  runWalkPlan,
  type OwedGround,
  type OwedWindow,
  type SpanRead,
  storePointCursor,
  walkSpans,
  type WalkMarkFields,
  type WalkMarks,
  type WalkWindow,
} from './binance.history-walk';
import {
  commitSettledSpan,
  instantAt,
  joinSettled,
  settleRecords,
  settleUnreadable,
} from './binance.history-records';
import { LANE_CALL_CAPS } from './binance.history-budget';
import { settledTransfersOf } from './binance.transfer-history';
import { type BinanceUniversalTransfer, UNIVERSAL_TRANSFER_TYPES } from './binance.history-client';

/**
 * The walk's own functions driven run after run, as the lanes drive them, against records that
 * can never be committed. A run reads at most `lane.reads` calls; a read returns the records
 * whose time lies in the span, under one of three readings of which end Binance leaves out (both
 * included, the start left out, the end left out), and each property must hold under all three.
 * A stuck record owes its own point and holds nothing else back, so every other record of the
 * span commits. The properties tell a point by the window its record owes (never by a tag or a
 * length), so they hold for any list the walk stores. A lane that reads several series (the
 * Transfer types) spends one call for each series of a span read, and the Transfer lane settles
 * its spans with the lane's own `settledTransfersOf`.
 */

const HOUR_MS = 3_600_000;
const SECOND_MS = 1_000;
const FLOOR_MS = Date.UTC(2017, 6, 14);
const START_MS = Date.UTC(2026, 9, 1);
const BASE_MS = Date.UTC(2025, 6, 1);
const WINDOW_MS = 89 * DAY_MS;
const TWO_POWER_32_MS = 2 ** 32;
const NEVER = Number.POSITIVE_INFINITY;
const SEEDS = [11, 23, 37];
const COUNTS = Array.from({ length: 12 }, (_unused, index) => index + 1);
const TRANSFER_TYPES = UNIVERSAL_TRANSFER_TYPES;

/**
 * `precision` is the precision of the time a lane sees: a Pay order has its millisecond, a
 * capital withdrawal only its second, so it sits somewhere in the second its time starts, or
 * (`rounded`) in the half second on either side of it. A `mixed` lane alternates records of that
 * precision with records of a millisecond (a capital deposit). `rangeCalls` is the calls one read
 * of a span costs, `series` the series a lane reads (each span read asks every one of them, a
 * point read only its own), and `designReads` the calls a run has in the arithmetic the bounds
 * below come from.
 */
type Lane = {
  name: string;
  reads: number;
  designReads: number;
  rangeCalls: number;
  /**
   * The calls a read that comes back too full costs. A lane that reads several series reads the
   * series likely to be dense first, so such a read stops after the first or the second.
   */
  splitCalls: number;
  precision: number;
  mixed?: boolean;
  rounded?: boolean;
  series?: readonly string[];
};

/**
 * Pay spends one of its calls on the uid, so a run has one read fewer than the lane cap. The
 * Transfer lane's design is 80 calls: a caught-up run affords the forward read, one owed range,
 * the re-scan and the points (20 + 20 + 20 + up to 20); the bounds below are written for that, so
 * a lane cap below it starves an owed range and the properties fail.
 */
const LANES: Lane[] = [
  {
    name: 'Pay',
    reads: LANE_CALL_CAPS.pay - 1,
    designReads: LANE_CALL_CAPS.pay - 1,
    rangeCalls: 1,
    splitCalls: 1,
    precision: 1,
  },
  {
    name: 'capital withdrawals',
    reads: LANE_CALL_CAPS.capitalWithdraw,
    designReads: LANE_CALL_CAPS.capitalWithdraw,
    rangeCalls: 1,
    splitCalls: 1,
    precision: SECOND_MS,
  },
  {
    name: 'capital withdrawals with a rounded applyTime',
    reads: LANE_CALL_CAPS.capitalWithdraw,
    designReads: LANE_CALL_CAPS.capitalWithdraw,
    rangeCalls: 1,
    splitCalls: 1,
    precision: SECOND_MS,
    rounded: true,
  },
  {
    name: 'capital withdrawals and deposits',
    reads: LANE_CALL_CAPS.capitalWithdraw,
    designReads: LANE_CALL_CAPS.capitalWithdraw,
    rangeCalls: 1,
    splitCalls: 1,
    precision: SECOND_MS,
    mixed: true,
  },
  {
    name: 'Transfer',
    reads: LANE_CALL_CAPS.transfer,
    designReads: 80,
    rangeCalls: TRANSFER_TYPES.length,
    splitCalls: 2,
    precision: 1,
    series: TRANSFER_TYPES,
  },
];

/** The calls a forward pass must leave a run for it to read both the re-scan and a point. */
const rescanAndPointCalls = (lane: Lane): number => lane.rangeCalls + 1;

/** The forward window, the re-scan and one read of a point: no call left for a half of it. */
const leastReadsWithAPoint = (lane: Lane): number => 2 * lane.rangeCalls + 1;

/**
 * The owed ranges one run reads beside the forward read, and beside the calls the re-scan and a
 * point keep.
 */
const pendingReadsOf = (lane: Lane): number =>
  Math.floor((lane.designReads - 2 * lane.rangeCalls - 1) / lane.rangeCalls);

/** The re-scan reads a run has beside the forward read and the call a point keeps. */
const rescanReadsOf = (lane: Lane): number =>
  Math.floor((lane.designReads - lane.rangeCalls - 1) / lane.rangeCalls);

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
 * cursor must never pass while it is stuck. An `unreadable` record is one the client could not
 * read: the lane gets it in the page's `unreadable` list, with its time (`timed`) or without one
 * (`timeless`), and never as a record: it owes its point, or its whole span. A record of a lane
 * that reads several series has the `series` it is read under, and is `heldUntil` the run from
 * which it can be placed when that is later than `stuckUntil` (its series drifts until then).
 */
type SimRecord = {
  id: number;
  time: number;
  at: number;
  precision: number;
  stuckUntil: number;
  inForward?: boolean;
  unreadable?: 'timed' | 'timeless';
  series?: string;
  heldUntil?: number;
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
  /**
   * One series whose pages do not add up to their total in every run before `until`, for a span
   * that starts behind the forward cursor: its records are not read, and the span is owed.
   */
  drift?: { series: string; until: number };
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
  /** The reads that spent some of their calls and then gave up: calls paid for nothing. */
  partialReads: number;
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

/** Whether the series that drifts gives no rows for a read of `span` in run `run`. */
const isDrifting = (drift: Simulation['drift'], span: WalkWindow, run: number): boolean =>
  drift !== undefined && run < drift.until && span.start < START_MS;

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

/**
 * The point a record that was found stuck is owed as: its extent and a millisecond each side, in
 * the series it was read under when its lane reads several.
 */
const pointOf = (record: SimRecord): OwedGround => ({
  start: record.time - record.precision,
  end: record.time + record.precision,
  kind: 'point',
  ...foldMap(maybe(record.series), (series) => ({ series })),
});

/** Whether the list holds the very ground `record` owes: the point it was found at. */
const holdsPointOf = (owed: OwedGround[], record: SimRecord): boolean =>
  owed.some((ground) => sameWindow(ground, pointOf(record)) && ground.series === record.series);

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

type TransferType = (typeof TRANSFER_TYPES)[number];

/** The transfer a record stands for: settled once it can be trusted, pending until then. */
const transferOf = (entry: SimRecord, run: number): BinanceUniversalTransfer => ({
  asset: 'BTC',
  amount: '0.001',
  type: entry.series ?? '',
  status: run < entry.stuckUntil ? 'PENDING' : 'CONFIRMED',
  tranId: String(entry.id),
  timestamp: entry.time,
});

/** The id of the record a Transfer row was written for (the fourth part of its key). */
const idOfKey = (externalId: string): number => Number(externalId.split(':')[3]);

/**
 * The span of a Transfer read, settled by the lane's own function: every series read, with the
 * rows of its readable records and the times of the ones the client could not read; a series
 * that `drifted` is named and gives no rows. The rows are told by the id of their record.
 */
const settledTransfers = (input: {
  span: WalkWindow;
  page: SimRecord[];
  run: number;
  read: readonly string[];
  drifted?: string;
}) => {
  const { span, page, run, read, drifted } = input;
  const ofSeries = (series: string) => page.filter((entry) => entry.series === series);
  const settled = settledTransfersOf({
    accountId: 'sim',
    span,
    read: {
      read: read
        .filter((series) => series !== drifted)
        .map((series) => ({
          series: series as TransferType,
          rows: ofSeries(series)
            .filter((entry) => entry.unreadable === undefined)
            .map((entry) => transferOf(entry, run)),
          unreadable: ofSeries(series)
            .filter((entry) => entry.unreadable !== undefined)
            .map((entry) => ({ time: entry.unreadable === 'timeless' ? undefined : entry.time })),
        })),
      drifted: foldMap(maybe(drifted), (series) => [series as TransferType]) ?? [],
    },
  });

  return { ...settled, rows: settled.rows.map((row) => idOfKey(row.externalId)) };
};

/**
 * The settled span of one page: its readable records, and the records the client could not read,
 * which the lane takes from the page's `unreadable` list (with a time, or with none).
 */
const settledOfOneSeries = (span: WalkWindow, page: SimRecord[], run: number) => {
  const unreadable = page.filter((entry) => entry.unreadable !== undefined);

  return joinSettled([
    settleRecords({
      span,
      records: page.filter((entry) => entry.unreadable === undefined),
      rowsOf: (entry) => rowsOf(entry, run),
      extentOf,
    }),
    settleUnreadable({
      span,
      unreadable: unreadable.map((entry) => ({
        time: entry.unreadable === 'timeless' ? undefined : entry.time,
        record: entry,
      })),
      code: 'simulated-unreadable',
      extentOf: (row) => foldMap(maybe(row.time), () => extentOf(row.record)),
    }),
  ]);
};

/** The span of a page settled by the lane's own function (one series or several). */
const settledOf = (input: {
  lane: Lane;
  span: WalkWindow;
  page: SimRecord[];
  run: number;
  window: OwedWindow;
  drift: Simulation['drift'];
}) => {
  const { lane, span, page, run, window, drift } = input;

  if (lane.series === undefined) {
    return settledOfOneSeries(span, page, run);
  }

  return settledTransfers({
    span,
    page,
    run,
    read: window.series ?? lane.series,
    drifted: isDrifting(drift, span, run) ? drift?.series : undefined,
  });
};

/**
 * What a read of `span` gives: the records in it, or the half to read when it is too full. A
 * read of a point, where Binance filters on another field (`mismatch`), gives the records that
 * can be trusted and lie in it (both ends included), never one that is stuck for good. A read of
 * a window with series gives the records of those series only.
 */
const pageOf = (input: {
  simulation: Simulation;
  span: WalkWindow;
  window: OwedWindow;
  isPointRead: boolean;
}): SpanRead<SimRecord[]> => {
  const { simulation, span, window, isPointRead } = input;
  // Binance's mismatch does not depend on what the walk stored: a record whose point the scenario
  // starts with is never returned by a read of a range or the re-scan either.
  const listed = simulation.scenario.owed;
  const half = halfOf(span);

  if (isDense(simulation.dense, span) && half !== undefined) {
    return { kind: 'split', half };
  }

  const mismatched = (entry: SimRecord): boolean =>
    simulation.mismatch === true &&
    entry.stuckUntil === NEVER &&
    (isPointRead || holdsPointOf(listed, entry));
  const reading =
    simulation.mismatch === true && isPointRead ? 'both ends included' : simulation.reading;

  const readInWindow = (entry: SimRecord): boolean =>
    window.series === undefined ||
    (entry.series !== undefined && window.series.includes(entry.series));

  return {
    kind: 'page',
    page: simulation.scenario.records.filter(
      (entry) => readInWindow(entry) && !mismatched(entry) && holds(span, entry.at, reading),
    ),
  };
};

/**
 * The calls one read of a window spends of the `cap` calls of a run, with `spent` already spent
 * and `keepCalls` held back for the passes after it, one call at a time. The first read of a
 * window is gated by the walk alone (`runWalkPlan` enters a window only when every call of it
 * fits); a later read is gated by the lane's own read, which keeps the calls of every series
 * (`gate`) beside what is kept, because it cannot know the read will split. A read that has paid
 * for some of its calls (`cost`: fewer than the gate when the dense series splits it) and cannot
 * pay for all of them gives up: the calls it paid are lost.
 */
const payForRead = (input: {
  spent: number;
  cost: number;
  gate: number;
  keepCalls: number;
  cap: number;
  isFirst: boolean;
}): { paid: number; made: boolean } => {
  const { spent, cost, gate, keepCalls, cap, isFirst } = input;

  if (!isFirst && spent + keepCalls + gate - 1 >= cap) {
    return { paid: 0, made: false };
  }

  const paid = Math.max(0, Math.min(cost, cap - keepCalls - spent));

  return { paid, made: paid === cost };
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
      partialReads: 0,
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

    /** The calls one read of a window costs: one for each series it asks. */
    const callsOf = (window: OwedWindow): number => window.series?.length ?? lane.rangeCalls;
    const noteRead = (span: WalkWindow, isRescan: boolean): void => {
      record.rescanReads += isRescan ? 1 : 0;

      if (isPointWindow(span)) {
        const key = `${span.start}:${span.end}`;
        pointReads.set(key, (pointReads.get(key) ?? 0) + 1);
        record.pointsRead.push(span.start);
      }
    };

    await runWalkPlan({
      plan,
      callsOf,
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

        let firstRead = true;

        return walkSpans<SimRecord[]>({
          window,
          keep,
          read: async (span, keepCalls) => {
            const page = pageOf({
              simulation: input,
              span,
              window,
              isPointRead: isPointWindow(span),
            });
            const { paid, made } = payForRead({
              spent: reads,
              cost:
                page.kind === 'split'
                  ? Math.min(lane.splitCalls, callsOf(window))
                  : callsOf(window),
              gate: callsOf(window),
              keepCalls,
              cap: lane.reads,
              isFirst: firstRead,
            });

            firstRead = false;
            reads += paid;

            if (!made) {
              record.partialReads += paid > 0 ? 1 : 0;

              return undefined;
            }

            noteRead(span, pass === 'rescan');

            return page;
          },
          onComplete: (read) =>
            dropReadPoints({
              pass,
              window,
              read,
              marks: live,
              fields: MARK_FIELDS,
              writePending: async () => undefined,
            }),
          commit: async (span, page) => {
            const committed = await commitSettledSpan({
              pass,
              span,
              settled: settledOf({ lane, span, page, run, window, drift: input.drift }),
              place: async (planned) => planned,
              add: async (ids) => {
                for (const id of ids) {
                  importedAt.set(id, Math.min(importedAt.get(id) ?? run, run));
                }

                return ids.length;
              },
              advance: ({ owed }) =>
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
  /**
   * Every record that can be trusted is imported within this many runs of it being placeable.
   * Absent when the scenario cuts the reads on purpose, so no record is certain to be read.
   */
  imported?: number;
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
  /**
   * The points are those of records that settle: from this run on the list is empty, each point
   * having left once its window was read to its end.
   */
  emptied?: number;
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

/** The records that can be trusted and were not imported within `bound` runs of it (if any). */
const lateRecords = (
  importedAt: Map<number, number>,
  records: SimRecord[],
  bound: number | undefined,
): SimRecord[] =>
  records.filter(
    (entry) =>
      entry.stuckUntil !== NEVER &&
      bound !== undefined &&
      (importedAt.get(entry.id) ?? NEVER) >= (entry.heldUntil ?? entry.stuckUntil) + bound,
  );

/** P7: a read that spent some of its calls and gave up paid for nothing; no run has one. */
const partialReadViolations = (runs: RunRecord[]): string[] => {
  const partial = runs.filter((run) => run.partialReads > 0);

  return partial.length > 0
    ? [`P7: a read paid for part of its calls and gave up in ${partial.length} runs`]
    : [];
};

/** SL: the entries still in the list once no record holds one, and the points no record owes. */
const leftoverViolations = (runs: RunRecord[], bounds: Bounds): string[] => {
  const lingering =
    foldMap(maybe(bounds.drained ?? bounds.emptied), (emptied) =>
      runs.flatMap((run, index) => (index >= emptied && run.owed.length > 0 ? [index] : [])),
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
  ];
};

/** A record the walk can never trust and owes a point for: not one of the forward pass's. */
const isStuckWithPoint = (entry: SimRecord): boolean =>
  entry.stuckUntil === NEVER && entry.inForward !== true && entry.unreadable !== 'timeless';

/** The unreadable records with no time whose span the last run does not owe any more. */
const timelessLeftOf = (runs: RunRecord[], records: SimRecord[]): SimRecord[] =>
  records.filter(
    (entry) =>
      entry.unreadable === 'timeless' &&
      !runs.at(-1)?.owed.some((range) => range.kind !== 'point' && surelyHolds(range, entry.at)),
  );

/** What breaks each property, as text a failing run prints; empty when all hold. */
const violationsOf = (
  lane: Lane,
  reading: Reading,
  outcome: Outcome,
  scenario: Scenario,
  bounds: Bounds,
): string[] => {
  const { runs, importedAt } = outcome;
  const stuck = scenario.records.filter(isStuckWithPoint);
  const timelessLeft = timelessLeftOf(runs, scenario.records);
  const stuckInForward = scenario.records.filter(
    (entry) => entry.stuckUntil === NEVER && entry.inForward === true,
  );
  const late = lateRecords(importedAt, scenario.records, bounds.imported);
  const notPointed = stuck.filter(
    (entry) => firstRun(runs, (run) => holdsPointOf(run.owed, entry)) >= bounds.pointed,
  );
  const dropped = stuck.flatMap((entry) => [
    // A range that starts where the record sits returns it under the readings that include the
    // start; under the others the span before it did, and the record has its point by then.
    ...lostAfterHeld(runs, (run) => run.owed.some((range) => holds(range, entry.at, reading))).map(
      (index) => `record ${entry.id} (at ${entry.at}) left every entry at run ${index}`,
    ),
    ...lostAfterHeld(runs, (run) => holdsPointOf(run.owed, entry)).map(
      (index) => `record ${entry.id} (time ${entry.time}) lost its own point at run ${index}`,
    ),
  ]);
  const holdersOf = (run: RunRecord, entry: SimRecord): number =>
    run.owed.filter((ground) => holdsPointOf([ground], entry)).length;
  const manyPoints = bounds.onePoint
    ? stuck.filter((entry) => runs.some((run) => holdersOf(run, entry) > 1))
    : [];
  const passed = stuckInForward.filter((entry) =>
    runs.some((run) => run.cursor !== null && run.cursor > entry.time),
  );
  const noRescanRead = runs.filter(
    (run) => run.rescanReads === 0 && run.callsAfterForward >= rescanAndPointCalls(lane),
  );
  const noRescanCommit = runs.filter(
    (run) => run.rescanCommits === 0 && run.callsAfterForward >= rescanAndPointCalls(lane),
  );
  const overReads = runs.filter((run) => run.readsOfAPoint > 1);

  return [
    ...partialReadViolations(runs),
    ...leftoverViolations(runs, bounds),
    ...(late.length > 0
      ? [
          `P1: ${late.length} records imported later than ${bounds.imported} runs after placeable: ` +
            late.map((entry) => `${entry.id}@${entry.series ?? ''}`).join(', '),
        ]
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
    ...(timelessLeft.length > 0
      ? [`${timelessLeft.length} unreadable records with no time are no longer owed as a span`]
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

  /**
   * The series a record of the lane is read under: spread over all of them, so a scenario holds
   * records of many (at least three) series. A lane that reads one series has none.
   */
  const seriesOf = (id: number): { series?: string } =>
    foldMap(maybe(lane.series), (series) => ({
      series: series[(id * 7 + seed) % series.length],
    })) ?? {};

  /** A record at the time `millisecond` has for the lane, anywhere in its own precision. */
  const record = (millisecond: number, stuckUntil = 0): SimRecord => {
    lastId += 1;
    const precision = precisionOf(lastId);
    const time = alignedTo(millisecond, precision);

    return {
      id: lastId,
      time,
      at: atOf(lastId, time, precision),
      precision,
      stuckUntil,
      ...seriesOf(lastId),
    };
  };

  /** A record of the given precision (a deposit has one millisecond), at its own `time`. */
  const typed = (precision: number, millisecond: number, stuckUntil = 0): SimRecord => {
    lastId += 1;
    const time = alignedTo(millisecond, precision);

    return {
      id: lastId,
      time,
      at: atOf(lastId, time, precision),
      precision,
      stuckUntil,
      ...seriesOf(lastId),
    };
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

    return {
      id: lastId,
      time,
      at,
      precision: stuck.precision,
      stuckUntil: 0,
      ...foldMap(maybe(stuck.series), (series) => ({ series })),
    };
  };

  /**
   * A record at the very time of `other`: the same millisecond, or the same second, in the same
   * series (the point of `other` is read in its series only).
   */
  const twinOf = (other: SimRecord, stuckUntil = 0): SimRecord => {
    lastId += 1;

    return {
      id: lastId,
      time: other.time,
      at: atOf(lastId, other.time, other.precision),
      precision: other.precision,
      stuckUntil,
      ...foldMap(maybe(other.series), (series) => ({ series })),
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
const insideMergedRangeScenario = (lane: Lane, seed: number, withTwin = true): Scenario => {
  const builder = builderOf(lane, seed);
  const days = Array.from({ length: 14 }, (_unused, index) => builder.rangeAt(index));
  const near = { start: days[6].end + DAY_MS, end: days[6].end + DAY_MS + 3 * HOUR_MS };
  const ranges = days.map((day, index) => (index === 7 ? near : day));
  const stuck = builder.record(days[6].end + 12 * HOUR_MS, NEVER);

  return {
    owed: [...ranges, pointOf(stuck)],
    records: [
      stuck,
      ...(withTwin ? [builder.twinOf(stuck)] : []),
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
 * `count` points already found, each of a record that settles at run 1, with that record and
 * the points' windows reading as a full page above one precision of the lane, so each point is
 * read in halves: its read comes back full, then each half is read, and the record sits in one
 * of the halves (or on the meeting place of both). A point leaves the list once its whole window
 * was read and a record that owes exactly it came back.
 */
const splitPointsScenario = (lane: Lane, count: number): Scenario => {
  const builder = builderOf(lane, 71);
  const records = Array.from({ length: count }, (_unused, index) =>
    builder.record(BASE_MS + index * 10 * DAY_MS + HOUR_MS, 1),
  );

  return { owed: records.map(pointOf), records };
};

/**
 * `count` points already found, each of a stuck record and of a record that can be trusted in
 * the very same second: the stuck one sits in the last millisecond of it, the other in the first.
 * A read of the point comes back full and is read in halves, and the run has the calls for the
 * first half only: the trusted record comes back alone, and the point is still the stuck one's.
 */
const splitTwinScenario = (lane: Lane, count: number): Scenario => {
  const builder = builderOf(lane, 83);
  const stuck = Array.from({ length: count }, (_unused, index) => {
    const entry = builder.record(BASE_MS + index * 10 * DAY_MS + HOUR_MS, NEVER);

    return { ...entry, at: entry.time + entry.precision - 1 };
  });

  return {
    owed: stuck.map(pointOf),
    records: [...stuck, ...stuck.map((entry) => ({ ...builder.twinOf(entry), at: entry.time }))],
  };
};

/**
 * `count` stuck records inside the window of the re-scan, each with a record that can be trusted
 * a step before it and one a step after it (on the very edge of its point, none at its own time),
 * and each point already found. Read with `mismatch`, a read of the re-scan holds every point
 * whole and returns those neighbours, never the stuck record.
 */
const rescanNeighboursScenario = (lane: Lane, count: number): Scenario => {
  const builder = builderOf(lane, 97);
  const window = { start: START_MS - 85 * DAY_MS, end: START_MS - 5 * DAY_MS };
  const stuck = Array.from({ length: count }, (_unused, index) =>
    builder.record(window.start + (index + 1) * 10 * DAY_MS, NEVER),
  );

  return {
    owed: stuck.map(pointOf),
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
 * A stuck record whose point is already found and reaches past the end of the second run: that
 * run's plan holds the point whole, and a list the forward pass stores from it must still hold it.
 */
const aheadPointScenario = (lane: Lane): Scenario => {
  const builder = builderOf(lane, 91);
  const stuck = builder.record(START_MS + HOUR_MS + 30 * SECOND_MS, NEVER);

  return { owed: [pointOf(stuck)], records: [stuck] };
};

/**
 * `count` owed days, each with a record the client could not read and two records that can be
 * trusted. The first day's has no time: it owes its whole day. The others have one: each owes
 * its own point.
 */
const unreadableScenario = (lane: Lane, count: number, seed: number): Scenario => {
  const builder = builderOf(lane, seed);
  const days = Array.from({ length: count }, (_unused, index) => builder.rangeAt(index));
  const unrelated = unrelatedDayOf(lane, seed);

  return {
    owed: [...days, unrelated.day],
    records: [
      ...days.flatMap((day, index) => [
        {
          ...builder.record(builder.interiorOf(day), NEVER),
          unreadable: index === 0 ? ('timeless' as const) : ('timed' as const),
        },
        builder.record(builder.interiorOf(day)),
        builder.record(builder.interiorOf(day)),
      ]),
      ...unrelated.records,
    ],
  };
};

/**
 * ONE owed range far behind every other, with two records that can be trusted in it, while
 * `count` points of records that stay stuck are owed beside it: the points take every call a run
 * leaves after the owed range and the re-scan, so a lane whose cap leaves the range no call
 * starves it.
 */
const rangeAmongPointsScenario = (lane: Lane, count: number): Scenario => {
  const builder = builderOf(lane, 53);
  const day = dayAt(40);
  const stuck = Array.from({ length: count }, (_unused, index) =>
    builder.record(BASE_MS + (60 + index * 3) * DAY_MS + HOUR_MS, NEVER),
  );

  return {
    owed: [day, ...stuck.map(pointOf)],
    records: [
      ...stuck,
      builder.record(builder.interiorOf(day)),
      builder.record(builder.interiorOf(day)),
    ],
  };
};

/** The run from which the series that drifts gives its rows again. */
const DRIFT_UNTIL = 4;

/**
 * `count` records that can be trusted inside the window of the re-scan, alternately in the series
 * that drifts (until `DRIFT_UNTIL`) and in another one: the other series' records import in the
 * first run, the drifted series' own only once it stops drifting.
 */
const driftScenario = (lane: Lane, count: number, seed: number): Scenario => {
  const builder = builderOf(lane, seed);
  const [drifting, steady] = lane.series ?? ['', ''];
  const window = { start: START_MS - 85 * DAY_MS, end: START_MS - 5 * DAY_MS };

  return {
    owed: [],
    records: Array.from({ length: count }, (_unused, index) => {
      const isDrifting = index % 2 === 0;

      return {
        ...builder.record(builder.interiorOf(window)),
        series: isDrifting ? drifting : steady,
        ...(isDrifting ? { heldUntil: DRIFT_UNTIL } : {}),
      };
    }),
  };
};

/**
 * `count` owed days that each hold two stuck records at one millisecond, in two series: the first
 * settles at run 2, the second stays stuck. With `found` the days are owed and the walk finds the
 * two points; otherwise both points are in the list already, so they start together and are read
 * as one window in both series. Each point leaves only for a record of its own series.
 */
const SETTLES_AT = 2;

const sameInstantScenario = (lane: Lane, count: number, found: boolean) => {
  const builder = builderOf(lane, 67);
  // The stuck record's series sorts before the settling one's, so a read that kept only the series
  // of the first point of a window would miss the settling record.
  const series = [...(lane.series ?? ['', ''])].sort();
  const days = Array.from({ length: count }, (_unused, index) => builder.rangeAt(index));
  const settling = days.map((day, index) => ({
    ...builder.record(builder.interiorOf(day), SETTLES_AT),
    series: series[(2 * index + 1) % series.length],
  }));
  const stuck = settling.map((entry, index) => ({
    ...builder.twinOf(entry, NEVER),
    series: series[(2 * index) % series.length],
  }));
  const scenario: Scenario = {
    owed: found ? days : [...stuck, ...settling].map(pointOf),
    records: [...settling, ...stuck],
  };

  return { scenario, settling, stuck };
};

/**
 * The runs the properties allow, linear in the owed ranges: each is read once, oldest first, on
 * the reads a run has beside the forward pass and the two the re-scan and the points keep.
 * Measured worst cases over the scenarios below sit under these.
 */
const rangeRuns = (lane: Lane, ranges: number): number =>
  Math.ceil((ranges + 1) / pendingReadsOf(lane)) + 1;

/**
 * A day of up to 24 hours that comes back full above 6 hours is read in halves: 2 reads to get
 * down to 6 hours, then 2 reads (a read that is too full, and the half) for each of its commits.
 */
const DENSE_DAY_MS = 6 * HOUR_MS;
const denseDayRuns = (lane: Lane): number => Math.ceil(16 / pendingReadsOf(lane)) + 2;

/**
 * The 89-day window of the re-scan, coming back full above 30 days: 2 reads to get down to 22
 * days, then 2 reads for each of its commits.
 */
const DENSE_WINDOW_MS = 30 * DAY_MS;
const denseWindowRuns = (lane: Lane): number => Math.ceil(12 / rescanReadsOf(lane)) + 2;

/** A re-scan that comes back full above 3 days needs more reads for one pass than a run has. */
const DENSE_RESCAN_MS = 3 * DAY_MS;

/**
 * The runs the round-robin of `points` allows when each run reads at least `reads` of them: the
 * forward pass and the re-scan spend one read each in a run of these scenarios, and the rest
 * go to the points.
 */
const pointRuns = (points: number, reads: number): number => Math.ceil(points / reads);

/** The points one run reads beside the forward read and the re-scan: a call each. */
const pointReadsOf = (lane: Lane): number => lane.designReads - 2 * lane.rangeCalls;

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
      input: Pick<Simulation, 'scenario' | 'gapMs' | 'dense' | 'mismatch' | 'catchUp' | 'drift'> & {
        /** The reads of a run, when the scenario fixes them instead of the lane. */
        reads?: number;
      },
      bounds: Bounds,
      runs: number,
    ) => {
      const { reads = lane.reads, ...rest } = input;
      const outcome = await simulate({ lane: { ...lane, reads }, reading, runs, ...rest });

      expect(violationsOf(lane, reading, outcome, input.scenario, bounds)).toEqual([]);

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

    it.each(TWIN_COUNTS.map((count) => ({ count, bound: pointRuns(count, pointReadsOf(lane)) })))(
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
          bound: pointRuns(count, pointReadsOf(lane)),
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

    it.each(
      [1, 3, 12].map((count) => ({ count, bound: pointRuns(count + 1, pointReadsOf(lane)) })),
    )(
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
          bound: found ? rangeRuns(lane, count + 1) : pointRuns(count, pointReadsOf(lane)) + 1,
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
            reads: leastReadsWithAPoint(lane),
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

    it.each([2, 5, 8].map((count) => ({ count, bound: pointRuns(count, pointReadsOf(lane)) + 1 })))(
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
            bound: found ? rangeRuns(lane, count + 1) : pointRuns(count, pointReadsOf(lane)) + 1,
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

    const splitRangeOf = (count: number): WalkWindow => ({
      start: BASE_MS - DAY_MS,
      end: BASE_MS + 10 * count * DAY_MS,
    });

    it.each(
      [1, 3, 6].map((count) => ({
        count,
        bound: Math.ceil((3 * count) / pendingReadsOf(lane)) + 3,
      })),
    )(
      'SL: $count points whose window comes back full, so each is read in halves, and whose records settle at run 1: each leaves once its whole window was read to its end, within $bound runs',
      async ({ count, bound }) => {
        await check(
          {
            scenario: splitPointsScenario(lane, count),
            dense: { range: splitRangeOf(count), spanMs: lane.precision },
          },
          { imported: bound, pointed: 1, emptied: bound },
          bound + 4,
        );
      },
    );

    it.each([1, 3, 5].map((count) => ({ count })))(
      'P1-P3: $count stuck records, each with a record that can be trusted in the same second, whose point comes back full and is cut after its first half: the stuck record keeps its point, and the other imports',
      async ({ count }) => {
        await check(
          {
            scenario: splitTwinScenario(lane, count),
            dense: { range: splitRangeOf(count), spanMs: lane.precision },
            reads: leastReadsWithAPoint(lane) + lane.rangeCalls,
          },
          { pointed: 1 },
          count + 6,
        );
      },
    );

    it('P1-P2 with Binance filtering on another field: a stuck record whose point reaches past the end of the run that plans it stays in the list', async () => {
      await check(
        { scenario: aheadPointScenario(lane), mismatch: true },
        { imported: 1, pointed: 1 },
        6,
      );
    });

    it.each(seeds.map((seed) => ({ seed, bound: rangeRuns(lane, 14) + 6 })))(
      'P1-P4 with Binance filtering on another field: 14 owed days and a stuck record found as a point inside the hull of two of them (seed $seed): no read of the hull returns the record, and its point stays',
      async ({ seed, bound }) => {
        await check(
          { scenario: insideMergedRangeScenario(lane, seed, false), mismatch: true },
          { imported: bound, pointed: 1 },
          bound + 5,
        );
      },
    );

    it.each([1, 3, 6].map((count) => ({ count, bound: pointRuns(count, pointReadsOf(lane)) + 1 })))(
      'P1-P4 with Binance filtering on another field: $count points found already inside the window of the re-scan, each with the records beside it that can be trusted: a read of the re-scan holds each point whole and returns only those, so every point stays',
      async ({ count, bound }) => {
        await check(
          { scenario: rescanNeighboursScenario(lane, count), mismatch: true },
          { imported: bound, pointed: 1 },
          bound + 6,
        );
      },
    );

    it.each([1, 3, 6].map((count) => ({ count, bound: rangeRuns(lane, 2 * count + 2) })))(
      'P1-P4 with unreadable rows, reported in the page and never thrown: $count owed days each with an unreadable record (the first with no time, the others with one) beside two that can be trusted: every other record imports within $bound runs, each timed one is a point, and the first day stays owed whole',
      async ({ count, bound }) => {
        await check(
          { scenario: unreadableScenario(lane, count, 11) },
          { imported: bound, pointed: bound },
          bound + 5,
        );
      },
    );

    it.each([25, 40].map((count) => ({ count, bound: rangeRuns(lane, 1) })))(
      'P1-P4: one owed range outside the re-scan window with $count points owed beside it, more than a run reads: the records of the range import within $bound runs, whatever the points take',
      async ({ count, bound }) => {
        await check(
          { scenario: rangeAmongPointsScenario(lane, count) },
          { imported: bound, pointed: 1 },
          bound + 5,
        );
      },
    );

    if (lane.series !== undefined) {
      it.each([2, 6].map((count) => ({ count })))(
        'P1: $count records that can be trusted in a re-scan window, half of them in a series that drifts until run 4: the records of the other series import in the first run, the drifted series own only once it stops drifting',
        async ({ count }) => {
          const scenario = driftScenario(lane, count, 11);
          const bound = 2;

          const outcome = await check(
            { scenario, drift: { series: lane.series?.[0] ?? '', until: DRIFT_UNTIL } },
            { imported: bound, pointed: bound },
            DRIFT_UNTIL + bound + 3,
          );

          const runOf = (entry: SimRecord): number => outcome.importedAt.get(entry.id) ?? NEVER;
          const drifting = scenario.records.filter((entry) => entry.heldUntil !== undefined);
          const steady = scenario.records.filter((entry) => entry.heldUntil === undefined);
          expect(steady.map(runOf).every((run) => run <= 1)).toBe(true);
          expect(drifting.map(runOf).every((run) => run >= DRIFT_UNTIL)).toBe(true);
        },
      );

      it.each(
        [1, 3, 6].flatMap((count) =>
          [true, false].map((found) => ({
            count,
            found,
            bound: found ? rangeRuns(lane, count + 1) : pointRuns(count, pointReadsOf(lane)) + 1,
          })),
        ),
      )(
        'P1-P5: $count days with two stuck records at one millisecond in two series, the first settling at run 2 (found in an owed day: $found): each point leaves only for a record of its own series, so the settled one is imported and its point gone, the stuck one is still owed as its point, within $bound runs',
        async ({ count, found, bound }) => {
          const { scenario, settling, stuck } = sameInstantScenario(lane, count, found);

          const outcome = await check(
            { scenario },
            { imported: bound, pointed: found ? bound : 1, roundRobin: true },
            SETTLES_AT + bound + 8,
          );

          const owed = outcome.runs.at(-1)?.owed ?? [];
          expect(settling.every((entry) => outcome.importedAt.has(entry.id))).toBe(true);
          expect(settling.filter((entry) => holdsPointOf(owed, entry))).toEqual([]);
          expect(stuck.filter((entry) => !holdsPointOf(owed, entry))).toEqual([]);
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
