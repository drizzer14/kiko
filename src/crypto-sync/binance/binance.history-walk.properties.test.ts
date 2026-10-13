import { match } from 'ts-pattern';
import { DAY_MS } from '@kiko/dates';
import {
  BINANCE_PAY_HISTORY_CURSOR_FIELD,
  BINANCE_PAY_PENDING_OVERLAP_FIELD,
  BINANCE_PAY_POINT_CURSOR_FIELD,
  BINANCE_PAY_RANGE_CURSOR_FIELD,
  BINANCE_PAY_RESCAN_CURSOR_FIELD,
  BINANCE_PAY_SPAN_HINTS_FIELD,
  type BinanceSpanHintPass,
  type BinanceSpanHints,
} from '@kiko/holdings/holding-metadata';
import maybe, { foldMap } from 'fnts/maybe';

import {
  advanceWalkMarks,
  BinanceWalkStop,
  dropReadPoints,
  halfOf,
  NO_HINTS,
  planWalkPasses,
  runWalkPlan,
  type OwedGround,
  type OwedWindow,
  type SpanRead,
  storePointCursor,
  storeRangeCursor,
  storeSpanHints,
  walkSpans,
  type WalkMarkFields,
  type WalkMarks,
  type WalkWindow,
} from './binance.history-walk';
import {
  EARN_FORWARD_OWES,
  EARN_SERIES,
  type EarnRecord,
  settledEarnOf,
} from './binance.earn-history';
import {
  type BinanceUniversalTransfer,
  type EarnRecordKind,
  UNIVERSAL_TRANSFER_TYPES,
} from './binance.history-client';
import {
  commitSettledSpan,
  instantAt,
  joinSettled,
  settleRecords,
  settleUnreadable,
} from './binance.history-records';
import { LANE_CALL_CAPS } from './binance.history-budget';
import { settledTransfersOf, TRANSFER_FORWARD_OWES } from './binance.transfer-history';

/**
 * The walk's own functions driven run after run, as the lanes drive them, against records that
 * can never be committed. A run reads at most `lane.reads` calls; a read returns the records
 * whose time lies in the span, under one of three readings of which end Binance leaves out (both
 * included, the start left out, the end left out), and each property must hold under all three.
 * A stuck record owes its own point and holds nothing else back, so every other record of the
 * span commits. The properties tell a point by the window its record owes (never by a tag or a
 * length), so they hold for any list the walk stores. A lane that reads several series (the
 * Transfer types, the six Earn kinds) spends one call for each series of a span read, and settles
 * its spans with the lane's own `settledTransfersOf` or `settledEarnOf`.
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

/**
 * The runs come this far apart, or all at one instant: the start of a re-scan pass and the floor
 * of Pay and Transfer move with the clock, so a property that hid behind frozen time must hold for
 * every gap.
 */
const RUN_GAPS = [0, HOUR_MS, DAY_MS];
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
  /**
   * The lane's floor trails the clock (Pay's and Transfer's do: so many months back), so an owed
   * range that starts below it is cut to a start that moves every run. Capital's is fixed.
   */
  movesFloor?: boolean;
  /**
   * The walk a lane that reads several series settles its spans with, and the stops of one record
   * its forward pass owes and goes past.
   */
  walk?: 'transfer' | 'earn';
  forwardOwes?: readonly string[];
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
    movesFloor: true,
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
    movesFloor: true,
    walk: 'transfer',
    forwardOwes: TRANSFER_FORWARD_OWES,
  },
  {
    name: 'Earn',
    reads: LANE_CALL_CAPS.earn,
    designReads: 30,
    rangeCalls: EARN_SERIES.length,
    splitCalls: 2,
    precision: 1,
    series: EARN_SERIES,
    walk: 'earn',
    forwardOwes: EARN_FORWARD_OWES,
  },
];

/** The calls a forward pass must leave a run for it to read both the re-scan and a point. */
const rescanAndPointCalls = (lane: Lane): number => lane.rangeCalls + 1;

/** The calls the forward window takes of a run whose time moves: it has one in every run. */
const forwardCallsOf = (lane: Lane, gapMs: number): number => (gapMs === 0 ? 0 : lane.rangeCalls);

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
  /** A transfer whose status is FAILED in every run: no row, ever, and its point stays owed. */
  failed?: boolean;
  /**
   * A confirmed transfer the walk can never trust, because of what is wrong with the row itself:
   * the type it was read under is not its own, it has no id, or its amount is no number.
   */
  defect?: 'type-mismatch' | 'id-missing' | 'amount-invalid';
};

/** The members of the reward group an Earn record stands for, of 1 to 3 (a reward is a group). */
const membersOf = (entry: SimRecord): number => 1 + (entry.id % 3);

type Scenario = { owed: OwedGround[]; records: SimRecord[] };

/** A span longer than `spanMs` that overlaps `range` comes back full, so it is read in halves. */
type DenseRange = { range: WalkWindow; spanMs: number };

type Simulation = {
  lane: Lane;
  reading: Reading;
  scenario: Scenario;
  runs: number;
  /** The time between two runs. */
  gapMs?: number;
  /** The floor trails a run by this much, so it moves with the clock; fixed when absent. */
  floorAgeMs?: number;
  /** A span longer than `spanMs` that overlaps `range` comes back full, so it is read in halves. */
  dense?: DenseRange | DenseRange[];
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
  /** The starts of the windows of the owed ranges the plan gave the run, and of those it read. */
  plannedRanges: number[];
  rangesRead: number[];
  /** The spans that committed in the run, with the pass they were read in. */
  commits: { kind: BinanceSpanHintPass; start: number; end: number }[];
  /** The span hints as the run left them. */
  hints: BinanceSpanHints;
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
  [dense ?? []]
    .flat()
    .some(
      (entry) =>
        span.end - span.start > entry.spanMs &&
        span.start < entry.range.end &&
        span.end > entry.range.start,
    );

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
  range: BINANCE_PAY_RANGE_CURSOR_FIELD,
  hints: BINANCE_PAY_SPAN_HINTS_FIELD,
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
const statusOf = (entry: SimRecord, run: number): string => {
  if (entry.failed === true) {
    return 'FAILED';
  }

  return entry.defect === undefined && run < entry.stuckUntil ? 'PENDING' : 'CONFIRMED';
};

const transferOf = (entry: SimRecord, run: number): BinanceUniversalTransfer => ({
  asset: 'BTC',
  amount: entry.defect === 'amount-invalid' ? 'abc' : '0.001',
  type:
    entry.defect === 'type-mismatch'
      ? (TRANSFER_TYPES.find((type) => type !== entry.series) ?? '')
      : (entry.series ?? ''),
  status: statusOf(entry, run),
  tranId: entry.defect === 'id-missing' ? '' : String(entry.id),
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

/** The id of the record an Earn row was written for (the fifth part of its key). */
const idOfEarnKey = (externalId: string): number => Number(externalId.split(':')[4]);

/**
 * The records an Earn record stands for, as Binance gives them: a subscription or a redemption is
 * one, settled once it can be trusted and pending until then; a reward is a group of 1 to 3
 * members at one time, whose amounts are no number until it can be trusted. A `defect` makes the
 * record wrong for good: no id, an amount that is no number, or (a flexible reward) a type the
 * walk does not know.
 */
const earnRecordsOf = (entry: SimRecord, run: number): EarnRecord[] => {
  const identifier = entry.defect === 'id-missing' ? '' : String(entry.id);
  const settles = run >= entry.stuckUntil;
  const amount = entry.defect === 'amount-invalid' ? 'abc' : '0.001';
  const base = { asset: 'BTC', time: entry.time };
  const status = settles ? 'SUCCESS' : 'PENDING';
  const reward = settles && entry.defect !== 'amount-invalid' ? '0.00000001' : 'abc';
  const memberAmounts = Array.from({ length: membersOf(entry) }, (_unused, index) =>
    reward === 'abc' ? reward : `0.0000000${index + 1}`,
  );

  return match(entry.series)
    .returnType<EarnRecord[]>()
    .with('flexibleSubscription', (kind) => [
      {
        kind,
        record: {
          ...base,
          amount,
          purchaseId: identifier,
          productId: undefined,
          type: undefined,
          sourceAccount: 'SPOT',
          amtFromSpot: undefined,
          amtFromFunding: undefined,
          status,
        },
      },
    ])
    .with('lockedSubscription', (kind) => [
      {
        kind,
        record: {
          ...base,
          amount,
          positionId: undefined,
          purchaseId: identifier,
          type: undefined,
          sourceAccount: 'SPOT',
          amtFromSpot: undefined,
          amtFromFunding: undefined,
          status,
        },
      },
    ])
    .with('flexibleRedemption', (kind) => [
      {
        kind,
        record: {
          ...base,
          amount,
          projectId: undefined,
          redeemId: identifier,
          destAccount: 'SPOT',
          status,
        },
      },
    ])
    .with('lockedRedemption', (kind) => [
      {
        kind,
        record: {
          ...base,
          amount,
          positionId: undefined,
          redeemId: identifier,
          originalAmount: undefined,
          type: undefined,
          status,
        },
      },
    ])
    .with('flexibleRewards', (kind) =>
      memberAmounts.map((rewards) => ({
        kind,
        record: {
          ...base,
          rewards,
          projectId: identifier,
          type: entry.defect === 'type-mismatch' ? 'REWARDS' : 'REALTIME',
        },
      })),
    )
    .with('lockedRewards', (kind) =>
      memberAmounts.map((memberAmount) => ({
        kind,
        record: { ...base, amount: memberAmount, positionId: identifier, type: 'Booster' },
      })),
    )
    .otherwise(() => []);
};

/**
 * The span of an Earn read, settled by the lane's own function: every series read, with the rows
 * of its readable records and the times of the ones the client could not read; a series that
 * `drifted` is named and gives no rows. The rows are told by the id of their record.
 */
const settledEarn = (input: {
  span: WalkWindow;
  page: SimRecord[];
  run: number;
  read: readonly string[];
  drifted?: string;
}) => {
  const { span, page, run, read, drifted } = input;
  const ofSeries = (series: string) => page.filter((entry) => entry.series === series);
  const settled = settledEarnOf({
    accountId: 'sim',
    span,
    read: {
      read: read
        .filter((series) => series !== drifted)
        .map((series) => ({
          series: series as EarnRecordKind,
          rows: ofSeries(series)
            .filter((entry) => entry.unreadable === undefined)
            .flatMap((entry) => earnRecordsOf(entry, run)),
          unreadable: ofSeries(series)
            .filter((entry) => entry.unreadable !== undefined)
            .map((entry) => ({ time: entry.unreadable === 'timeless' ? undefined : entry.time })),
        })),
      drifted: foldMap(maybe(drifted), (series) => [series as EarnRecordKind]) ?? [],
    },
  });

  return { ...settled, rows: settled.rows.map((row) => idOfEarnKey(row.externalId)) };
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

  const settle = lane.walk === 'earn' ? settledEarn : settledTransfers;

  return settle({
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
  const { forwardOwes } = lane;
  const importedAt = new Map<number, number>();
  let marks: WalkMarks = {
    cursor: START_MS,
    rescanCursor: null,
    pointCursor: null,
    rangeCursor: null,
    hints: NO_HINTS,
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
      plannedRanges: [],
      rangesRead: [],
      commits: [],
      hints: NO_HINTS,
    };
    const pointReads = new Map<string, number>();
    const endTime = endTimeOf(input, run);
    const plan = planWalkPasses({
      cursor: marks.cursor,
      rescanCursor: marks.rescanCursor,
      pointCursor: marks.pointCursor,
      rangeCursor: marks.rangeCursor,
      pending: marks.pending,
      floorMs: foldMap(maybe(input.floorAgeMs), (age) => endTime - age) ?? FLOOR_MS,
      endTime,
      windowMs: WINDOW_MS,
      overlapMs: DAY_MS,
      maxWindows: 80,
    });
    let reads = 0;
    let pastForward = false;
    // By identity: an owed range can be the very window of a point, and is not a read of it.
    const isPointWindow = (window: OwedWindow): boolean => plan.points.includes(window);

    record.plannedPoints = plan.points.map((point) => point.start);
    record.plannedRanges = plan.pending.map((window) => window.start);

    /** The calls one read of a window costs: one for each series it asks. */
    const callsOf = (window: OwedWindow): number => window.series?.length ?? lane.rangeCalls;
    const noteRead = (window: WalkWindow, isRescan: boolean, isPointRead: boolean): void => {
      record.rescanReads += isRescan ? 1 : 0;

      if (isPointRead) {
        const key = `${window.start}:${window.end}`;
        pointReads.set(key, (pointReads.get(key) ?? 0) + 1);
        record.pointsRead.push(window.start);
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
      markRangeRead: async (window) => {
        record.rangesRead.push(window.start);
        await storeRangeCursor({
          window,
          marks: live,
          field: MARK_FIELDS.range,
          write: async () => undefined,
        });
      },
      hints: {
        stored: live.hints,
        store: (hints) =>
          storeSpanHints({
            hints,
            marks: live,
            field: MARK_FIELDS.hints,
            write: async () => undefined,
          }),
      },
      runWindow: (window, pass, keep, hint) => {
        if (pass !== 'forward' && !pastForward) {
          pastForward = true;
          record.callsAfterForward = lane.reads - reads;
        }

        let firstRead = true;

        return walkSpans<SimRecord[]>({
          window,
          keep,
          hint,
          read: async (span, keepCalls) => {
            // The first read of a point window is the read of the point, whether it starts with the
            // whole window or with the hint a run before left: later reads are of its halves.
            const isPointRead = firstRead && isPointWindow(window);
            const page = pageOf({ simulation: input, span, window, isPointRead });
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

            noteRead(window, pass === 'rescan', isPointRead);

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
              forwardOwes,
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

            if (committed !== undefined) {
              record.commits.push({
                kind: isPointWindow(window) ? 'point' : pass,
                start: span.start,
                end: span.end,
              });
            }

            return committed;
          },
        });
      },
    });

    marks = live;
    record.owed = live.pending;
    record.hints = live.hints;
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
      entry.inForward !== true &&
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
 * A stuck record at `time` that holds the forward pass back for good, so the cursor never passes
 * it. The Transfer lane owes the point of a record with a time and goes past it, so its record
 * has none: the client could not read its time, and it owes the whole span, which only a stop of
 * the forward pass keeps. Every other lane stops at any stuck record.
 */
const forwardStopOf = (lane: Lane, record: SimRecord): SimRecord => ({
  ...record,
  inForward: true,
  ...(lane.series === undefined ? {} : { unreadable: 'timeless' as const }),
});

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
      forwardStopOf(lane, builder.record(START_MS + 30 * 60_000, NEVER)),
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

/** The run from which the series that drifts gives its rows again. */
const DRIFT_UNTIL = 4;

/**
 * ONE owed day far behind the re-scan, holding `count` records that can be trusted, alternately
 * in the series that drifts (until `DRIFT_UNTIL`) and in another one: the other series' records
 * import in the first run, and the day stays owed until the drifted series' own can be read. The
 * re-scan does not reach the day, so only the owed range keeps the drifted records from being
 * lost. With `points`, that many points of records that stay stuck are owed beside it: they take
 * every call a run leaves after the forward read, the owed range and the re-scan, so a lane whose
 * cap leaves the range no call starves it.
 */
const driftScenario = (lane: Lane, count: number, seed: number, points = 0): Scenario => {
  const builder = builderOf(lane, seed);
  const [drifting, steady] = lane.series ?? ['', ''];
  const day = dayAt(40);
  const stuck = Array.from({ length: points }, (_unused, index) =>
    builder.record(BASE_MS + (60 + index * 3) * DAY_MS + HOUR_MS, NEVER),
  );

  return {
    owed: [day, ...stuck.map(pointOf)],
    records: [
      ...stuck,
      ...Array.from({ length: count }, (_unused, index) => {
        const isDrifting = index % 2 === 0;

        return {
          ...builder.record(builder.interiorOf(day)),
          series: isDrifting ? drifting : steady,
          ...(isDrifting ? { heldUntil: DRIFT_UNTIL } : {}),
        };
      }),
    ],
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

    it.each(RUN_GAPS.map((gapMs) => ({ gapMs })))(
      'a stop that holds the forward pass back (a stuck record on a lane that owes nothing in the forward pass, a record with no time on the Transfer lane): the cursor never passes it and nothing of its span imports, runs $gapMs ms apart',
      async ({ gapMs }) => {
        const builder = builderOf(lane, 83);
        const stuck = forwardStopOf(lane, builder.record(START_MS + 30 * 60_000, NEVER));
        const newer = builder.record(START_MS + 90 * 60_000);

        const outcome = await simulate({
          lane,
          reading,
          runs: 8,
          gapMs,
          catchUp: { runs: 1, gapMs: 2 * DAY_MS },
          scenario: { owed: [], records: [stuck, newer] },
        });

        expect(outcome.runs.every((run) => (run.cursor ?? 0) <= stuck.time)).toBe(true);
        expect(outcome.importedAt.has(newer.id)).toBe(false);
      },
    );

    if (lane.series !== undefined) {
      type Family = { family: string; mark: Partial<SimRecord> };
      const SHARED_FAMILIES: Family[] = [
        { family: 'not settled (pending)', mark: {} },
        { family: 'with no id', mark: { defect: 'id-missing' } },
        { family: 'with an amount that is no number', mark: { defect: 'amount-invalid' } },
        { family: 'whose row the client could not read', mark: { unreadable: 'timed' } },
      ];
      // A FAILED Earn record is ignored and owes nothing, so only the Transfer lane has the
      // family; a reward group of a type the walk does not know is the Earn lane's own.
      const FAMILIES: Family[] =
        lane.walk === 'earn'
          ? [
              ...SHARED_FAMILIES,
              {
                family: 'of a reward type the walk does not know',
                mark: { defect: 'type-mismatch', series: 'flexibleRewards' },
              },
            ]
          : [
              { family: 'FAILED', mark: { failed: true } },
              {
                family: 'of another type than it was read under',
                mark: { defect: 'type-mismatch' },
              },
              ...SHARED_FAMILIES,
            ];

      it.each(
        FAMILIES.flatMap(({ family, mark }) => RUN_GAPS.map((gapMs) => ({ family, mark, gapMs }))),
      )(
        'a record $family, at a time in the forward window, is owed at its point and the cursor passes it: the records after it import in the run that reads the window, its point stays owed in every run, and no run after imports anything, runs $gapMs ms apart',
        async ({ mark, gapMs }) => {
          const builder = builderOf(lane, 83);
          const stuck = { ...builder.record(START_MS + 30 * 60_000, NEVER), ...mark };
          const newer = builder.record(START_MS + 90 * 60_000);

          const outcome = await simulate({
            lane,
            reading,
            runs: 8,
            gapMs,
            catchUp: { runs: 1, gapMs: 2 * DAY_MS },
            scenario: { owed: [], records: [stuck, newer] },
          });

          // Run 0 has no forward window: the window first exists in run 1.
          expect(outcome.importedAt.get(newer.id)).toBe(1);
          expect(outcome.importedAt.has(stuck.id)).toBe(false);
          expect(outcome.runs[1].cursor).toBeGreaterThan(stuck.time);
          expect(outcome.runs.slice(1).every((run) => holdsPointOf(run.owed, stuck))).toBe(true);
          expect([...outcome.importedAt.values()].every((run) => run <= 1)).toBe(true);
        },
      );

      it('a pending record in the forward window that settles at run 4: its point stays owed until then, and it imports once it settles and its point leaves', async () => {
        const builder = builderOf(lane, 83);
        const pending = builder.record(START_MS + 30 * 60_000, 4);
        const newer = builder.record(START_MS + 90 * 60_000);

        const outcome = await simulate({
          lane,
          reading,
          runs: 16,
          gapMs: 0,
          catchUp: { runs: 1, gapMs: 2 * DAY_MS },
          scenario: { owed: [], records: [pending, newer] },
        });

        expect(outcome.importedAt.get(newer.id)).toBe(1);
        expect(outcome.runs[1].cursor).toBeGreaterThan(pending.time);
        expect(outcome.runs.slice(1, 4).every((run) => holdsPointOf(run.owed, pending))).toBe(true);
        expect(outcome.importedAt.get(pending.id) ?? NEVER).toBeLessThan(12);
        expect(holdsPointOf(outcome.runs.at(-1)?.owed ?? [], pending)).toBe(false);
      });

      it.each([2, 6].map((count) => ({ count })))(
        'P1: $count records that can be trusted in one owed day, half of them in a series that drifts until run 4: the records of the other series import in the first run, the day stays owed, and the drifted series own import once it stops drifting',
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

      // The re-scan spans of the drifting series are owed as ranges too, up to the 12 the list
      // keeps. The Earn lane reads two of them a run, rotating from the range cursor, so the day
      // is read within a round-robin of all of them, not after the first one.
      const driftRanges = lane.walk === 'earn' ? 12 : 1;

      it.each([25, 40].map((count) => ({ count, bound: rangeRuns(lane, driftRanges) })))(
        'P1-P4: one owed range outside the re-scan window that drifts until run 4, with $count points owed beside it, more than a run reads: its records import within $bound runs of the drift ending, whatever the points take',
        async ({ count, bound }) => {
          await check(
            {
              scenario: driftScenario(lane, 2, 11, count),
              drift: { series: lane.series?.[0] ?? '', until: DRIFT_UNTIL },
            },
            { imported: bound, pointed: 1 },
            DRIFT_UNTIL + bound + 3,
          );
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

/**
 * `count` owed days, each holding one unreadable record with no time: every read of a day owes the
 * whole day again, so each is owed whole in every run, however many runs there are.
 */
const stuckRangesScenario = (lane: Lane, count: number): Scenario => {
  const builder = builderOf(lane, 53);
  const days = Array.from({ length: count }, (_unused, index) => builder.rangeAt(index));

  return {
    owed: days,
    records: days.map((day) => ({
      ...builder.record(builder.interiorOf(day), NEVER),
      unreadable: 'timeless' as const,
    })),
  };
};

/**
 * Every owed range is read within `ceil(ranges / reads a run)` runs that enter the pending pass,
 * `reads` the least ranges such a run reads (at least one): the runs read the ranges one after the
 * other from the range cursor, wrapping around, so a range that is owed whole every run keeps no
 * range behind it unread.
 */
const rangeRoundRobinViolations = (allRuns: RunRecord[]): string[] => {
  const runs = allRuns.filter((run) => run.callsAfterForward > 0 && run.plannedRanges.length > 0);
  const reads = Math.min(...runs.map((run) => run.rangesRead.length));
  const ranges = Math.max(...runs.map((run) => run.plannedRanges.length));

  if (runs.length === 0 || reads < 1) {
    return [`RR: a run planned ranges and read none (${runs.length} runs with ranges)`];
  }

  const span = Math.ceil(ranges / reads);
  const unread = runs
    .slice(0, Math.max(0, runs.length - span + 1))
    .flatMap((run, index) =>
      run.plannedRanges.filter(
        (start) =>
          !runs.slice(index, index + span).some((other) => other.rangesRead.includes(start)),
      ),
    );

  return unread.length > 0
    ? [
        `RR: ${unread.length} ranges planned in a run not read within ${span} runs ` +
          `(${ranges} ranges, at least ${reads} read a run)`,
      ]
    : [];
};

describe.each(LANES)('the round-robin over the owed windows, $name lane', (lane) => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it.each([1, 2, 3, 5, 8, 12].map((count) => ({ count })))(
    '$count owed days, each owed whole again by every read: each is read within ceil(days / reads a run) runs, though the oldest is first in the plan every run',
    async ({ count }) => {
      const runs = 2 * Math.ceil(count / Math.max(1, pendingReadsOf(lane))) + 3;

      const outcome = await simulate({
        lane,
        reading: 'both ends included',
        scenario: stuckRangesScenario(lane, count),
        runs,
      });

      expect(rangeRoundRobinViolations(outcome.runs)).toEqual([]);
      expect(outcome.runs.every((run) => run.rangesRead.length >= 1)).toBe(true);
    },
  );

  it.each([3, 4].map((windows) => ({ windows })))(
    'one owed range of $windows windows whose first two windows each hold a record with no time, a point owed beside it, one range window read a run: a record that can be trusted in its third window imports within ceil(windows / reads a run) runs',
    async ({ windows }) => {
      const builder = builderOf(lane, 97);
      const range = { start: BASE_MS, end: BASE_MS + windows * WINDOW_MS };
      const windowAt = (index: number): WalkWindow => ({
        start: range.start + index * WINDOW_MS,
        end: range.start + (index + 1) * WINDOW_MS,
      });
      const withoutTime = [0, 1].map((index) => ({
        ...builder.record(builder.interiorOf(windowAt(index)), NEVER),
        unreadable: 'timeless' as const,
      }));
      const stuck = builder.record(range.end + 2 * DAY_MS, NEVER);
      const trusted = builder.record(builder.interiorOf(windowAt(2)));

      const outcome = await simulate({
        lane: { ...lane, reads: 4 * lane.rangeCalls },
        reading: 'both ends included',
        scenario: { owed: [range, pointOf(stuck)], records: [...withoutTime, stuck, trusted] },
        runs: 2 * windows + 4,
      });

      // Run 0 has no forward window, so it reads more windows than the runs after it.
      const reads = Math.min(...outcome.runs.map((run) => run.rangesRead.length));
      expect(reads).toBe(1);
      expect(outcome.importedAt.get(trusted.id) ?? NEVER).toBeLessThan(Math.ceil(windows / reads));
    },
  );

  it.each([2, 4].map((windowNumber) => ({ windowNumber })))(
    'one owed range of 5 windows whose 1st, 3rd and 5th each hold a record with no time, exactly one range window read in every run: a record that can be trusted in its window number $windowNumber imports within 5 runs, because the window after the one read starts at the cursor and is read next',
    async ({ windowNumber }) => {
      const builder = builderOf(lane, 97);
      const windows = 5;
      // Clear of the re-scan, which would otherwise cut the last window.
      const start = BASE_MS - 120 * DAY_MS;
      const range = { start, end: start + windows * WINDOW_MS };
      const windowAt = (index: number): WalkWindow => ({
        start: range.start + index * WINDOW_MS,
        end: range.start + (index + 1) * WINDOW_MS,
      });
      const withoutTime = [0, 2, 4].map((index) => ({
        ...builder.record(builder.interiorOf(windowAt(index)), NEVER),
        unreadable: 'timeless' as const,
      }));
      const trusted = builder.record(builder.interiorOf(windowAt(windowNumber - 1)));

      // At one instant there is no forward window, so every run, the first too, reads one window.
      const outcome = await simulate({
        lane: { ...lane, reads: 2 * lane.rangeCalls },
        reading: 'both ends included',
        scenario: { owed: [range], records: [...withoutTime, trusted] },
        runs: 2 * windows + 4,
        gapMs: 0,
      });

      expect(outcome.runs.map((run) => run.rangesRead.length)).toEqual(
        Array.from({ length: 2 * windows + 4 }, () => 1),
      );
      expect(outcome.importedAt.get(trusted.id) ?? NEVER).toBeLessThan(windows);
    },
  );

  it.each(RUN_GAPS.map((gapMs) => ({ gapMs })))(
    'two owed days whose reads never finish, one read of one of them a run, runs $gapMs ms apart: each is read within 2 runs, because the cursor moves on once a read has started',
    async ({ gapMs }) => {
      const days = [dayAt(40), dayAt(60)];

      const outcome = await simulate({
        lane: {
          ...lane,
          reads: 2 * lane.rangeCalls + forwardCallsOf(lane, gapMs),
          splitCalls: lane.rangeCalls,
        },
        reading: 'both ends included',
        scenario: { owed: days, records: [] },
        runs: 8,
        gapMs,
        dense: days.map((day) => ({ range: day, spanMs: 1 })),
      });

      expect(rangeRoundRobinViolations(outcome.runs)).toEqual([]);
      expect(outcome.runs.slice(1).every((run) => run.rangesRead.length === 1)).toBe(true);
    },
  );

  it('a run that reads one range moves on past it: the next run reads the range after it', async () => {
    const outcome = await simulate({
      lane: { ...lane, reads: 3 * lane.rangeCalls },
      reading: 'both ends included',
      scenario: stuckRangesScenario(lane, 4),
      runs: 8,
    });
    // Run 0 has no forward window, so it has the calls for more than one range.
    const caughtUp = outcome.runs.slice(1);
    const firstRead = caughtUp.map((run) => run.rangesRead.at(0));

    expect(caughtUp.every((run) => run.rangesRead.length === 1)).toBe(true);
    expect(new Set(firstRead.slice(0, 4)).size).toBe(4);
    expect(firstRead.slice(4)).toEqual(firstRead.slice(0, firstRead.length - 4));
  });
});

/** The length of a span of `length` after `times` halvings, as `halfOf` cuts it. */
const halvedLength = (length: number, times: number): number =>
  times === 0 ? length : halvedLength(Math.floor(length / 2), times - 1);

describe.each(LANES)('a split window resumes in the next run, $name lane', (lane) => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  /**
   * A run with the calls of `reads`, a dense window in the series the lane reads last (a split
   * read costs every series of it): a chain of halvings needs one run for each halving.
   */
  const oneRead = (reads: number) => ({
    lane: { ...lane, reads, splitCalls: lane.rangeCalls },
    reading: 'both ends included' as const,
    scenario: { owed: [], records: [] } as Scenario,
  });
  const HALVINGS = [1, 3, 6];
  const CHAINS = HALVINGS.flatMap((halvings) => RUN_GAPS.map((gapMs) => ({ halvings, gapMs })));
  const forwardCalls = (gapMs: number): number => forwardCallsOf(lane, gapMs);

  it.each(CHAINS)(
    'forward pass: a window that needs $halvings halvings, one read a run, runs $gapMs ms apart: its first span commits within halvings + 1 runs',
    async ({ halvings, gapMs }) => {
      const length = HOUR_MS * 2 ** halvings;

      const outcome = await simulate({
        ...oneRead(lane.rangeCalls),
        runs: halvings + 4,
        gapMs,
        catchUp: { runs: 1, gapMs: length },
        dense: { range: { start: START_MS, end: START_MS + length }, spanMs: HOUR_MS },
      });

      // Run 0 has no window: the forward pass starts at the cursor, which is the end.
      expect(firstRun(outcome.runs, (run) => (run.cursor ?? 0) > START_MS)).toBeLessThanOrEqual(
        halvings + 1,
      );
    },
  );

  it.each(CHAINS)(
    're-scan: a window that needs $halvings halvings, one read a run beside the forward window, runs $gapMs ms apart: its first span commits within halvings + 1 runs',
    async ({ halvings, gapMs }) => {
      const outcome = await simulate({
        ...oneRead(lane.rangeCalls + forwardCalls(gapMs)),
        runs: halvings + 3,
        gapMs,
        dense: {
          range: { start: START_MS - WINDOW_MS - DAY_MS, end: START_MS },
          spanMs: halvedLength(WINDOW_MS, halvings),
        },
      });

      expect(firstRun(outcome.runs, (run) => run.rescanCommits > 0)).toBeLessThanOrEqual(halvings);
    },
  );

  it.each(CHAINS)(
    'pending pass: an owed day that needs $halvings halvings, one read a run, runs $gapMs ms apart: its first span commits within halvings + 1 runs',
    async ({ halvings, gapMs }) => {
      const day = dayAt(40);

      const outcome = await simulate({
        ...oneRead(2 * lane.rangeCalls + forwardCalls(gapMs)),
        runs: halvings + 3,
        gapMs,
        scenario: { owed: [day], records: [] },
        dense: { range: day, spanMs: halvedLength(DAY_MS, halvings) },
      });

      expect(
        firstRun(outcome.runs, (run) =>
          run.commits.some((commit) => commit.kind === 'pending' && commit.start === day.start),
        ),
      ).toBeLessThanOrEqual(halvings);
    },
  );

  if (lane.movesFloor === true) {
    it.each(
      HALVINGS.flatMap((halvings) => [HOUR_MS, DAY_MS].map((gapMs) => ({ halvings, gapMs }))),
    )(
      'pending pass: an owed range that starts below the floor, which moves with the clock, a window of it that needs $halvings halvings, one read a run, runs $gapMs ms apart: its first span commits within halvings + 1 runs',
      async ({ halvings, gapMs }) => {
        const floorAgeMs = 540 * DAY_MS;
        const floorAtStart = START_MS - floorAgeMs;
        const owed = { start: floorAtStart - 30 * DAY_MS, end: floorAtStart + WINDOW_MS };

        const outcome = await simulate({
          ...oneRead(3 * lane.rangeCalls),
          runs: halvings + 3,
          gapMs,
          floorAgeMs,
          scenario: { owed: [owed], records: [] },
          dense: { range: owed, spanMs: halvedLength(WINDOW_MS, halvings) },
        });

        expect(
          firstRun(outcome.runs, (run) => run.commits.some((commit) => commit.kind === 'pending')),
        ).toBeLessThanOrEqual(halvings);
      },
    );
  }

  it.each(CHAINS)(
    'pending pass: two owed days that each need $halvings halvings, one read a run, runs $gapMs ms apart: each commits its first span within 2 * halvings + 2 runs, so the hint of one is not the hint of the other',
    async ({ halvings, gapMs }) => {
      const days = [dayAt(40), dayAt(60)];

      const outcome = await simulate({
        ...oneRead(2 * lane.rangeCalls + forwardCalls(gapMs)),
        runs: 2 * halvings + 4,
        gapMs,
        scenario: { owed: days, records: [] },
        dense: days.map((day) => ({ range: day, spanMs: halvedLength(DAY_MS, halvings) })),
      });

      for (const day of days) {
        expect(
          firstRun(outcome.runs, (run) =>
            run.commits.some((commit) => commit.kind === 'pending' && commit.start === day.start),
          ),
        ).toBeLessThanOrEqual(2 * halvings + 1);
      }

      // A hint of one day used by the other would give it a span that ends before it starts.
      const commits = outcome.runs
        .flatMap((run) => run.commits)
        .filter((commit) => commit.kind === 'pending');
      expect(commits.filter((commit) => commit.end <= commit.start)).toEqual([]);
      expect(
        commits.filter(
          (commit) => !days.some((day) => day.start <= commit.start && commit.end <= day.end),
        ),
      ).toEqual([]);
    },
  );

  it.each(RUN_GAPS.map((gapMs) => ({ gapMs })))(
    'points: a point window that needs its halvings, one read a run, runs $gapMs ms apart: its first span commits within halvings + 1 runs',
    async ({ gapMs }) => {
      const builder = builderOf(lane, 61);
      const stuck = builder.record(BASE_MS + 60 * DAY_MS + HOUR_MS, NEVER);
      const point = pointOf(stuck);
      const length = point.end - point.start;
      const halvings = Math.floor(Math.log2(length));

      const outcome = await simulate({
        ...oneRead(lane.rangeCalls + 1 + forwardCalls(gapMs)),
        runs: halvings + 3,
        gapMs,
        scenario: { owed: [point], records: [stuck] },
        dense: { range: point, spanMs: halvedLength(length, halvings) },
      });

      expect(
        firstRun(outcome.runs, (run) => run.commits.some((commit) => commit.kind === 'point')),
      ).toBeLessThanOrEqual(halvings);
    },
  );

  it.each(HALVINGS.flatMap((wanted) => RUN_GAPS.map((gapMs) => ({ wanted, gapMs }))))(
    'points: a point whose chain of at most $wanted halvings is longer than the one read a run its window gets, the dense type the last of the lane, runs $gapMs ms apart: its window completes and the point leaves within 2 * halvings + 1 runs',
    async ({ wanted, gapMs }) => {
      const builder = builderOf(lane, 61);
      const record = {
        ...builder.record(BASE_MS + 60 * DAY_MS + HOUR_MS),
        ...foldMap(maybe(lane.series?.at(-1)), (series) => ({ series })),
      };
      const point = pointOf(record);
      const length = point.end - point.start;
      const halvings = Math.min(wanted, Math.floor(Math.log2(length)));

      const outcome = await simulate({
        ...oneRead(lane.rangeCalls + 1 + forwardCalls(gapMs)),
        runs: 2 * halvings + 4,
        gapMs,
        scenario: { owed: [point], records: [record] },
        dense: {
          range: { start: point.start, end: point.start + 1 },
          spanMs: halvedLength(length, halvings),
        },
      });

      expect(outcome.importedAt.has(record.id)).toBe(true);
      expect(firstRun(outcome.runs, (run) => !holdsPointOf(run.owed, record))).toBeLessThanOrEqual(
        2 * halvings,
      );
    },
  );

  it.each(RUN_GAPS.map((gapMs) => ({ gapMs })))(
    'a run in which the forward pass and the re-scan both stop in the middle of a chain keeps both hints, and both go on, runs $gapMs ms apart',
    async ({ gapMs }) => {
      const forwardHalvings = 4;
      const rescanHalvings = 3;
      const length = HOUR_MS * 2 ** forwardHalvings;
      const builder = builderOf(lane, 71);
      const stuck = forwardStopOf(lane, builder.record(START_MS + 30 * 60_000, NEVER));

      const outcome = await simulate({
        ...oneRead(2 * lane.rangeCalls),
        scenario: { owed: [], records: [stuck] },
        runs: forwardHalvings + rescanHalvings + 6,
        gapMs,
        catchUp: { runs: 1, gapMs: length },
        dense: [
          { range: { start: START_MS, end: START_MS + length }, spanMs: HOUR_MS },
          {
            range: { start: START_MS - WINDOW_MS - DAY_MS, end: START_MS },
            spanMs: halvedLength(WINDOW_MS, rescanHalvings),
          },
        ],
      });

      expect(
        outcome.runs.some((run) => run.hints.forward.length > 0 && run.hints.rescan.length > 0),
      ).toBe(true);
      expect(firstRun(outcome.runs, (run) => run.rescanCommits > 0)).toBeLessThanOrEqual(
        forwardHalvings + rescanHalvings + 3,
      );
      expect(outcome.runs.every((run) => (run.cursor ?? 0) <= stuck.time)).toBe(true);
    },
  );

  it.each(RUN_GAPS.map((gapMs) => ({ gapMs })))(
    'drops every hint once the windows commit: a run that read to its ends leaves none, runs $gapMs ms apart',
    async ({ gapMs }) => {
      const outcome = await simulate({
        ...oneRead(8 * lane.rangeCalls),
        runs: 6,
        gapMs,
        dense: {
          range: { start: START_MS - WINDOW_MS - DAY_MS, end: START_MS },
          spanMs: halvedLength(WINDOW_MS, 2),
        },
      });

      expect(outcome.runs.at(-1)?.hints).toEqual(NO_HINTS);
    },
  );
});
