import { match } from 'ts-pattern';
import { maxOf } from '@kiko/numbers';
import {
  type BinancePendingRange,
  type BinanceSpanHint,
  type BinanceSpanHintPass,
  type BinanceSpanHints,
  type BinanceSpanResume,
  type BinanceWalkCursorField,
  type BinanceWalkNumberField,
  type BinanceWalkPendingField,
  type BinanceWalkPointCursorField,
  type BinanceWalkRangeCursorField,
  type BinanceWalkSpanHintField,
  binanceWalkPendingOf,
  binanceWalkPointCursorOf,
  binanceWalkRangeCursorOf,
  binanceWalkSpanHintsOf,
} from '@kiko/holdings/holding-metadata';
import type { HoldingRow } from '@kiko/db';
import maybe, { foldMap } from 'fnts/maybe';
import { Money } from '@kiko/currency/money';
import { logFailure } from '@kiko/diagnostics';
import type { ExchangeHolding } from '@kiko/holdings/repo';

import { BINANCE_ASSET } from './binance.client';
import type { BinanceWalkWriteDeps } from './binance.walk-write-deps';
import { type BinanceWalletKey, binanceKeyOf, WALLET_HOLDING_NAMES } from './binance.holding-keys';

/** What one walk reports: rows imported this run, and whether it reached the end of its span. */
export type WalkResult = { imported: number; complete: boolean };

export type WalkWindow = { start: number; end: number };

/**
 * A window to read, and the series to read it in: a walk that reads several series (a Transfer
 * type each) reads an owed point in the series of its record only. No `series` is every series
 * of the walk.
 */
export type OwedWindow = WalkWindow & { series?: readonly string[] };

/** Split [start, end] into contiguous windows of at most `windowMs`, oldest first. */
export const buildWalkWindows = (
  start: number,
  end: number,
  windowMs: number,
  maxWindows: number,
): WalkWindow[] => {
  const windows: WalkWindow[] = [];
  let cursor = start;

  for (let count = 0; count < maxWindows && cursor < end; count += 1) {
    const windowEnd = Math.min(cursor + windowMs, end);
    windows.push({ start: cursor, end: windowEnd });
    cursor = windowEnd;
  }

  return windows;
};

/**
 * `pending` is a stretch of ground earlier runs left owed (see `planWalkPasses`): read on its
 * own, so the other owed ground and the re-scan are read in the same run.
 */
export type WalkPass = 'forward' | 'pending' | 'rescan';

/**
 * Whether a window that does not finish (a stop in the forward pass, the budget cannot afford
 * the next read, or Binance rate-limits) ends the pass it is in. The forward pass and the
 * re-scan move a mark that only a commit moves, so they cannot read past it. An owed range is
 * not read in order, so the pass reads on to the next one. No window ends the RUN: the passes
 * after it are read on what budget is left (see `runWalkPlan`).
 */
const STOP_ENDS_PASS: Record<WalkPass, boolean> = {
  forward: true,
  pending: false,
  rescan: true,
};

/**
 * What a committed span gave: the rows it imported, whether it left ground owed (`stuck`: the
 * ground of a record it could not trust, which a later run reads again, see `settleRecords`), and
 * the point of every record its read returned, trusted or not (`returned`): the window takes a
 * point off the list only for one of those (`dropReadPoints`).
 */
export type SpanCommit = {
  imported: number;
  owed: boolean;
  returned: OwedGround[];
  stuck: OwedGround[];
};

/**
 * What one window gave: the rows imported, whether it was read to its end, whether any of its
 * spans left ground owed, and whether it was started: a read of one of its spans returned (a
 * page, or the half to read instead). `hint` is the span the window was left at when the run
 * stopped before any span of it committed and the chain had narrowed below the window, or, when
 * a span of it committed, that span with a resume (the next run begins with it, see
 * `walkSpans`); `null` when there is none, so a stored one for this window is dropped; absent
 * when the walk does not say.
 */
export type WindowOutcome = {
  imported: number;
  complete: boolean;
  owed: boolean;
  started: boolean;
  hint?: BinanceSpanHint | null;
};

/**
 * Owed ground, as a walk stores it: a range, or a point (`kind: 'point'`): the ground one record
 * the walk could not trust owes. The kind is what tells the two apart, never the length, so a
 * short range is read once and leaves, and a point is never merged into, held by or dropped
 * with a range.
 */
export type OwedGround = BinancePendingRange;

/**
 * One run of a walk, as three passes. `forward` goes from the cursor to the end and moves the
 * walk's cursor. `pending` reads the windows of the ranges earlier runs left owed, in the order
 * the run reads them (`windowsFrom`), and moves no mark; `points` holds the windows of the points
 * among them, in the order the run reads them: see `startingAfter`. `rescan` goes back over the
 * ground behind the forward start, to catch a record that settles late, and never moves that
 * cursor. `rescanEnd` is where the re-scan ends. `pendingRanges` is the list of owed ground as it
 * stands once this run's own overlap day is in it: what to store before the forward pass first
 * moves the cursor.
 */
export type WalkPlan = {
  forward: WalkWindow[];
  pending: WalkWindow[];
  points: OwedWindow[];
  rescan: WalkWindow[];
  rescanEnd: number;
  pendingRanges: OwedGround[];
};

/**
 * A walk's owed ground cannot hold more ranges than this between runs. Each costs at least one
 * call of a run's leftover budget, so a longer list could not be served in one run; past the
 * limit the two nearest ranges merge, which only has the run read the gap between them too. A
 * run's own overlap day is the one range beyond it (`planWalkPasses`): the re-scan reads that
 * day in the same run. Points are not ranges, and are never merged with one.
 */
const MAX_PENDING_RANGES = 12;

const isPoint = (ground: OwedGround): boolean => ground.kind === 'point';

const sameWindow = (left: WalkWindow, right: WalkWindow): boolean =>
  left.start === right.start && left.end === right.end;

/**
 * Whether two entries are the same ground: the same window, both a range or both a point, and a
 * point in the same series. Two stuck records of different series at one millisecond owe two
 * points, and each leaves only for a record of its own series.
 */
const sameGround = (left: OwedGround, right: OwedGround): boolean =>
  sameWindow(left, right) && left.kind === right.kind && left.series === right.series;

/** Whether two points are the same: the same window in the same series. */
const samePoint = (left: OwedGround, right: OwedGround): boolean =>
  sameWindow(left, right) && left.series === right.series;

/**
 * Whether `owed` keeps `point` from leaving the list: it is the same window, in the same series,
 * or in none, which every series answers to (the whole span a stop owes as a range).
 */
const holdsPoint = (owed: OwedGround, point: OwedGround): boolean =>
  sameWindow(owed, point) && (owed.series === undefined || owed.series === point.series);

/** The ranges of `ranges` that `read` leaves: a read in a range's middle splits it in two. */
export const withoutRead = (ranges: WalkWindow[], read: WalkWindow): WalkWindow[] =>
  ranges.flatMap((range) => [
    ...(range.start < read.start
      ? [{ start: range.start, end: Math.min(range.end, read.start) }]
      : []),
    ...(range.end > read.end ? [{ start: Math.max(range.start, read.end), end: range.end }] : []),
  ]);

const mergeTouching = (sorted: WalkWindow[]): WalkWindow[] => {
  const merged: WalkWindow[] = [];

  for (const range of sorted) {
    const last = merged.at(-1);

    if (last !== undefined && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }

  return merged;
};

/** The index of the first of the two neighbours with the smallest gap between them. */
const nearestGapIndexOf = (ranges: WalkWindow[]): number =>
  ranges.slice(1).reduce(
    (nearest, range, index) => {
      const gap = range.start - ranges[index].end;

      return gap < nearest.gap ? { index, gap } : nearest;
    },
    { index: 0, gap: Number.POSITIVE_INFINITY },
  ).index;

const byStart = (left: WalkWindow, right: WalkWindow): number => left.start - right.start;

/**
 * What the walk can still ask for of one owed range: not before the floor, not after the end.
 */
const cutToBounds = (
  range: WalkWindow,
  bounds: { floorMs: number; endTime: number },
): WalkWindow => ({
  start: Math.max(range.start, bounds.floorMs),
  end: Math.min(range.end, bounds.endTime),
});

/** The ground of a list without a repeat: the first of each entry `sameGround` tells apart. */
export const distinctGround = (ground: OwedGround[]): OwedGround[] =>
  ground.filter((entry, index) => ground.findIndex((other) => sameGround(other, entry)) === index);

/**
 * The points of a list without a repeat. Two points that start together but differ both stay:
 * a point leaves the list only by a record that owes exactly it (`dropReadPoints`), so a
 * wider one that holds the other is no reason to drop the other. Oldest first, a wider point
 * after a narrower one that starts with it.
 */
const distinctPoints = (points: OwedGround[]): OwedGround[] =>
  distinctGround(points).sort(
    (left, right) =>
      byStart(left, right) ||
      left.end - right.end ||
      (left.series ?? '').localeCompare(right.series ?? ''),
  );

/**
 * Owed ground in its stored form, oldest first. A range is cut to what the walk can still ask
 * for (`cutToBounds`) and merged with the ranges it touches; past `limit` the two nearest
 * ranges merge into their hull, which reads the gap between them too and loses no ground. A
 * point is kept exactly as its record owes it, uncut, and dropped only once the floor has passed
 * all of it: it is never merged with anything, held by a range or shortened, so it is still the
 * ground its record owes, and a read of it can be told from a read of any other ground.
 */
const normalizePending = (
  ground: OwedGround[],
  bounds: { floorMs: number; endTime: number },
  limit = MAX_PENDING_RANGES,
): OwedGround[] => {
  const merged = mergeTouching(
    ground
      .filter((range) => !isPoint(range))
      .map((range) => cutToBounds(range, bounds))
      .filter((range) => range.start < range.end && bounds.floorMs < range.end)
      .sort(byStart),
  );
  const points = distinctPoints(ground.filter(isPoint)).filter(
    (point) => bounds.floorMs < point.end,
  );

  while (merged.length > limit) {
    const index = nearestGapIndexOf(merged);
    merged.splice(index, 2, { start: merged[index].start, end: merged[index + 1].end });
  }

  return [...merged, ...points].sort(byStart);
};

/**
 * Whether a point of a stored list names a series its walk reads: one of `knownSeries`, or none
 * for a walk that reads a single series. A point of any other series could never leave the list,
 * because no record the walk reads is of that series.
 */
const hasKnownSeries = (
  ground: OwedGround,
  knownSeries: readonly string[] | undefined,
): boolean => {
  if (!isPoint(ground)) {
    return true;
  }

  return knownSeries === undefined
    ? ground.series === undefined
    : ground.series !== undefined && knownSeries.includes(ground.series);
};

/**
 * The stored pending ranges of one walk. A value that is not a well-formed list says nothing
 * about which days were owed, and reading it as empty would let the next write drop them, so
 * all the ground before the cursor (`owedIfUnreadable`) is owed instead, once: it is stored
 * at once, so the repaired list is what every later run reads and moves forward. The failure
 * is logged under one fixed code: a corrupt list must not fail a balance sync. A list with a
 * point of a series the walk does not read (`knownSeries`) is malformed too.
 */
export const readPendingMark = async (input: {
  field: BinanceWalkPendingField;
  metadata: unknown;
  owedIfUnreadable: WalkWindow;
  knownSeries?: readonly string[];
  write: (field: BinanceWalkPendingField, ranges: OwedGround[]) => Promise<void>;
}): Promise<OwedGround[]> => {
  const { field, metadata, owedIfUnreadable, knownSeries, write } = input;
  const stored = binanceWalkPendingOf(field, metadata);

  if (stored?.every((ground) => hasKnownSeries(ground, knownSeries))) {
    return stored;
  }

  logFailure(
    '[binance sync] pending overlap ranges unreadable',
    new BinanceWalkStop('pending-malformed'),
  );
  const owed = owedIfUnreadable.start < owedIfUnreadable.end ? [owedIfUnreadable] : [];
  await write(field, owed);

  return owed;
};

/**
 * A cursor before every point or range, so the next run starts at the oldest: what a malformed
 * stored cursor is repaired to. It is a number the cursor key can hold, and reads like no key.
 */
const BEFORE_EVERY_GROUND = Number.MIN_SAFE_INTEGER;

/**
 * A stored round-robin cursor of one walk, or `null` to start at the oldest (none stored). A
 * value that is no number says nothing about where the round-robin stood, and is repaired at
 * once, like the list (`readPendingMark`): `BEFORE_EVERY_GROUND` is stored in its place, so the
 * failure, logged under one fixed code and never thrown (a corrupt value must not fail a balance
 * sync), is logged by one run only.
 */
const readRoundRobinCursor = async (input: {
  stored: number | null | undefined;
  field: BinanceWalkNumberField;
  unreadable: { message: string; code: string };
  write: (field: BinanceWalkNumberField, cursorMs: number) => Promise<void>;
}): Promise<number | null> => {
  const { stored, field, unreadable, write } = input;

  if (stored !== undefined) {
    return stored;
  }

  logFailure(unreadable.message, new BinanceWalkStop(unreadable.code));
  await write(field, BEFORE_EVERY_GROUND);

  return BEFORE_EVERY_GROUND;
};

/** The stored point cursor of one walk (see `readRoundRobinCursor`). */
export const readPointCursor = (input: {
  field: BinanceWalkPointCursorField;
  metadata: unknown;
  write: (field: BinanceWalkNumberField, cursorMs: number) => Promise<void>;
}): Promise<number | null> =>
  readRoundRobinCursor({
    stored: binanceWalkPointCursorOf(input.field, input.metadata),
    field: input.field,
    unreadable: {
      message: '[binance sync] point cursor unreadable',
      code: 'point-cursor-malformed',
    },
    write: input.write,
  });

/** The stored range cursor of one walk (see `readRoundRobinCursor`). */
export const readRangeCursor = (input: {
  field: BinanceWalkRangeCursorField;
  metadata: unknown;
  write: (field: BinanceWalkNumberField, cursorMs: number) => Promise<void>;
}): Promise<number | null> =>
  readRoundRobinCursor({
    stored: binanceWalkRangeCursorOf(input.field, input.metadata),
    field: input.field,
    unreadable: {
      message: '[binance sync] range cursor unreadable',
      code: 'range-cursor-malformed',
    },
    write: input.write,
  });

/** A run with no span hint to resume from. */
export const NO_HINTS: BinanceSpanHints = { forward: [], pending: [], rescan: [], point: [] };

/**
 * The stored span hints of one walk: none when nothing is stored. A value that is not a record of
 * well-formed lists only narrows what a run reads, so it is ignored, and, like the cursors, it is
 * repaired at once: no hint is stored in its place, so the failure, logged under one fixed code
 * and never thrown (a corrupt value must not fail a balance sync), is logged by one run only.
 */
export const readSpanHints = async (input: {
  field: BinanceWalkSpanHintField;
  metadata: unknown;
  write: (field: BinanceWalkSpanHintField, hints: BinanceSpanHints) => Promise<void>;
}): Promise<BinanceSpanHints> => {
  const { field, metadata, write } = input;
  const stored = binanceWalkSpanHintsOf(field, metadata);

  if (stored !== undefined) {
    return stored;
  }

  logFailure('[binance sync] span hints unreadable', new BinanceWalkStop('span-hints-malformed'));
  await write(field, NO_HINTS);

  return NO_HINTS;
};

/**
 * `ground`, oldest first, in the order a run reads it: what starts after the cursor (the start of
 * the point the last run read), then the rest, wrapping around. The points are read last, on the
 * calls the run has left, and a run that always started at the oldest would read the same few
 * every time. Every point has a start of its own here (see `pointsToRead`), and a run reads at
 * least one point in every run whose forward pass leaves a call, so every point is read within
 * `ceil(points / reads a run)` such runs, however far apart the runs are.
 */
const startingAfter = <Ground extends WalkWindow>(
  ground: Ground[],
  cursor: number | null,
): Ground[] =>
  cursor === null
    ? ground
    : [
        ...ground.filter((entry) => entry.start > cursor),
        ...ground.filter((entry) => entry.start <= cursor),
      ];

/**
 * The windows of the owed ranges, oldest first, in the order a run reads them: the windows that
 * start at or after the cursor (the end of the window the last run read), then the rest, wrapping
 * around. Windows, not ranges: a range longer than a window whose first window is owed whole
 * every run merges back into one range that starts before the cursor, so a rotation over ranges
 * would read that first window every run and never the windows behind it. At the cursor, not
 * after it: the window that follows the one read last starts exactly at its end, and a window of a
 * range that was cut by a read is the next one to read. A run that enters the pending pass reads
 * at least one window, so each of `windows` windows is read within `ceil(windows / reads a run)`
 * such runs.
 */
const windowsFrom = (windows: WalkWindow[], cursor: number | null): WalkWindow[] =>
  cursor === null
    ? windows
    : [
        ...windows.filter((window) => window.start >= cursor),
        ...windows.filter((window) => window.start < cursor),
      ];

/**
 * The series a window of points has to be read in: those of every point, or none named (every
 * series) when one of the points has no series.
 */
const seriesOfPoints = (points: OwedGround[]): string[] | undefined => {
  const named = points.flatMap((point) => point.series ?? []);

  return named.length === points.length ? [...new Set(named)] : undefined;
};

/**
 * The windows to read for the points of a list, oldest first: one for each start, the widest
 * (a point that starts with it and ends before it lies inside it, so its read returns that
 * record too), cut at the end of the walk, with no window for a point the end has not reached.
 * A window is read in the series of every point that starts there, so a point of another series
 * that starts with it is read too. Only what is read is cut: the points stay in the list as
 * their records owe them. A point is read whether or not a range or the re-scan holds it,
 * because only a read that returns its own record takes it off the list.
 */
const pointsToRead = (points: OwedGround[], endTime: number): OwedWindow[] => {
  const reached = points.filter((point) => point.start < Math.min(point.end, endTime));

  return [...new Set(reached.map((point) => point.start))].map((start): OwedWindow => {
    const here = reached.filter((point) => point.start === start);

    return {
      start,
      end: Math.min(maxOf(here.map((point) => point.end)), endTime),
      ...foldMap(maybe(seriesOfPoints(here)), (series) => ({ series })),
    };
  });
};

/**
 * Plan a run so that new records always come first. A walk that re-scanned its last
 * window before going forward would spend a busy account's whole call budget on ground it
 * already holds, and the newest records would never import. The re-scan resumes from the
 * walk's stored re-scan cursor, so a window too big for one run's leftover budget is
 * finished over later runs. Neither pass starts before the floor, which also bounds a
 * cursor a disconnect reset to an older floor than this walk may ask for.
 *
 * The forward pass always starts AT the cursor. Starting the overlap behind it instead
 * would make a dense day there cost every run its whole budget, and the cursor, which only
 * a span ending after it moves, would never advance. The ground behind the cursor is the
 * re-scan's: from the window start, or from the overlap behind the cursor when that is
 * earlier, because a record pending at the last sync can settle up to the overlap before
 * the cursor even when the walk was away for as long as the window. A stored re-scan mark
 * is resumed while it is no older than that start; an older one is a pass the window has
 * outrun, and the run starts a new pass at the start the cursor gives. The floor itself is
 * the restart mark of a finished pass, and starts a new one.
 *
 * The overlap day behind the forward start is owed from the moment the forward pass moves
 * the cursor past it, and the re-scan of THIS run may never get to it: the run can end
 * first, and the next run, after a long absence, finds a window that stops short of that
 * day. So the day goes into `pendingRanges` before the cursor moves, and stays there until a
 * committed span has read it (`advanceWalkMarks`); only the floor passing it drops it
 * unread. Each run reads, after the forward pass and before the re-scan, the owed ground
 * the re-scan will not read, in a round-robin over the WINDOWS of the owed ranges (`windowsFrom`:
 * those that start at or after the range cursor first, then the rest, oldest first), so a
 * catch-up from a cursor of any age, a long absence, or a window that outran an unfinished pass
 * loses no day, and a window that is owed whole every run cannot keep the windows behind it, of
 * its own range or of another, from being read. The list is separate from the re-scan mark: a
 * stop inside one range leaves the other ranges and the re-scan to run.
 */
export const planWalkPasses = (input: {
  cursor: number | null;
  rescanCursor: number | null;
  pointCursor: number | null;
  rangeCursor: number | null;
  pending: OwedGround[];
  floorMs: number;
  endTime: number;
  windowMs: number;
  overlapMs: number;
  maxWindows: number;
}): WalkPlan => {
  const {
    cursor,
    rescanCursor,
    pointCursor,
    rangeCursor,
    pending,
    floorMs,
    endTime,
    windowMs,
    overlapMs,
    maxWindows,
  } = input;
  const windowStart = Math.max(floorMs, endTime - windowMs);
  const forwardStart = Math.max(floorMs, cursor ?? floorMs);
  const behindEnd = Math.min(forwardStart, endTime);
  const rescanBase = Math.max(floorMs, Math.min(windowStart, forwardStart - overlapMs));
  const resumed =
    rescanCursor !== null &&
    rescanCursor > floorMs &&
    rescanCursor >= rescanBase &&
    rescanCursor < behindEnd;
  const rescan = buildWalkWindows(
    resumed ? rescanCursor : rescanBase,
    behindEnd,
    windowMs,
    maxWindows,
  );
  const bounds = { floorMs, endTime };
  const pendingRanges = normalizePending(
    [...normalizePending(pending, bounds), { start: behindEnd - overlapMs, end: behindEnd }],
    bounds,
    MAX_PENDING_RANGES + 1,
  );
  const rescanned = {
    start: rescan.at(0)?.start ?? behindEnd,
    end: rescan.at(-1)?.end ?? behindEnd,
  };

  return {
    forward: buildWalkWindows(forwardStart, endTime, windowMs, maxWindows),
    pending: windowsFrom(
      withoutRead(
        pendingRanges.filter((ground) => !isPoint(ground)),
        rescanned,
      ).flatMap((range) => buildWalkWindows(range.start, range.end, windowMs, maxWindows)),
      rangeCursor,
    ),
    points: startingAfter(pointsToRead(pendingRanges.filter(isPoint), endTime), pointCursor),
    rescan,
    rescanEnd: behindEnd,
    pendingRanges,
  };
};

/**
 * The re-scan cursor to store once `span` of the re-scan has committed: where the span
 * ended, or `restartMs` once the re-scan has reached its end, so the next run starts a
 * new pass. `restartMs` must be the value a disconnect resets every walk cursor to, so a
 * reset and a finished pass mean the same thing.
 */
export const rescanCursorAfter = (input: {
  span: WalkWindow;
  plan: WalkPlan;
  restartMs: number;
}): number => (input.span.end >= input.plan.rescanEnd ? input.restartMs : input.span.end);

/**
 * A walk's marks, as the run found them and then as the run last wrote them: the forward
 * cursor, the re-scan mark, the list of owed ground, the cursors of its two round-robins (the
 * owed points and the owed ranges), and the span hints of its passes.
 */
export type WalkMarks = {
  cursor: number | null;
  rescanCursor: number | null;
  pointCursor: number | null;
  rangeCursor: number | null;
  hints: BinanceSpanHints;
  pending: OwedGround[];
  /** What the forward spans of this run owed, kept in the list each later forward span stores. */
  forwardOwed?: OwedGround[];
};

/** The metadata field each of a walk's marks is stored under. */
export type WalkMarkFields = Record<'cursor' | 'rescan', BinanceWalkCursorField> & {
  point: BinanceWalkPointCursorField;
  range: BinanceWalkRangeCursorField;
  hints: BinanceWalkSpanHintField;
  pending: BinanceWalkPendingField;
};

type MarkAdvance = {
  span: WalkWindow;
  /** The ground of `span` the walk could not commit, which stays owed (a point, or the span). */
  owed?: OwedGround[];
  plan: WalkPlan;
  marks: WalkMarks;
  restartMs: number;
  fields: WalkMarkFields;
  write: (field: BinanceWalkNumberField, cursorMs: number) => Promise<void>;
  writePending: (field: BinanceWalkPendingField, ranges: OwedGround[]) => Promise<void>;
};

/** Stored lists are cut to nothing and merged to no limit: only a run's plan bounds a list. */
const UNBOUNDED = { floorMs: Number.NEGATIVE_INFINITY, endTime: Number.POSITIVE_INFINITY };

const sameList = (left: OwedGround[], right: OwedGround[]): boolean =>
  left.length === right.length && left.every((ground, index) => sameGround(ground, right[index]));

const storePending = async (
  input: Pick<MarkAdvance, 'marks' | 'fields' | 'writePending'>,
  next: OwedGround[],
): Promise<void> => {
  if (!sameList(next, input.marks.pending)) {
    input.marks.pending = next;
    await input.writePending(input.fields.pending, next);
  }
};

const advanceCursor = async (input: MarkAdvance): Promise<void> => {
  const { span, plan, marks, fields, write } = input;

  // The ground a forward span owes (a record the forward pass goes past, see `commitSettledSpan`)
  // is stored with the run's own list, and kept by every later forward span of the run.
  if ((input.owed ?? []).length > 0) {
    marks.forwardOwed = distinctGround([...(marks.forwardOwed ?? []), ...(input.owed ?? [])]);
  }

  const forwardOwed = marks.forwardOwed ?? [];

  // The owed ground goes first: a crash after it only leaves a range the next run reads
  // again, while a crash after the cursor alone would leave the overlap behind the old
  // cursor owed to no run.
  await storePending(
    input,
    forwardOwed.length === 0
      ? plan.pendingRanges
      : normalizePending(
          [...plan.pendingRanges, ...forwardOwed],
          UNBOUNDED,
          Number.POSITIVE_INFINITY,
        ),
  );

  marks.cursor = Math.max(span.end, marks.cursor ?? span.end);
  await write(fields.cursor, marks.cursor);
};

/** Whether `outer` holds all of `inner`. */
const holdsAll = (outer: WalkWindow, inner: WalkWindow): boolean =>
  outer.start <= inner.start && inner.end <= outer.end;

/**
 * The list without the ground the span read. A range loses what the span reads of it. A point
 * is the ground one record owes, and no one span proves that record was read: a span that holds
 * part of it can return one record of the second it owes and miss another, so a point leaves
 * the list only when its whole window was read to its end (`dropReadPoints`).
 */
const withoutReadGround = (input: MarkAdvance): OwedGround[] =>
  input.marks.pending.flatMap((ground) =>
    isPoint(ground) ? [ground] : withoutRead([ground], input.span),
  );

/**
 * Take the points off the list that a window read to its end has settled: a point the window
 * holds all of, and that a record the window returned owes exactly (`read`, the points of the
 * returned records that no record of the window left owed again: the twin of a record that is
 * still stuck keeps the point). A window that returned no such record (none at all, or the
 * neighbours of the stuck one, because Binance filters on another field or rounds the time)
 * leaves every point as it was, and so does a window that only reaches into a point. One list
 * write. Ranges are not touched: each span took out what it read of them. The forward pass
 * reads no owed ground and stores the list as the cursor moves, so it takes nothing off.
 */
export const dropReadPoints = async (input: {
  pass: WalkPass;
  window: WalkWindow;
  read: OwedGround[];
  marks: WalkMarks;
  fields: WalkMarkFields;
  writePending: (field: BinanceWalkPendingField, ranges: OwedGround[]) => Promise<void>;
}): Promise<void> => {
  const { pass, window, read, marks } = input;

  if (pass === 'forward') {
    return;
  }

  const isSettled = (ground: OwedGround): boolean =>
    isPoint(ground) && holdsAll(window, ground) && read.some((point) => samePoint(point, ground));

  await storePending(
    input,
    marks.pending.filter((ground) => !isSettled(ground)),
  );
};

/**
 * The list without the ground the span read, and with the ground of it that stays owed: one
 * write, so a crash leaves either the list as it was or the list with the stuck records in it.
 */
const advancePending = (input: MarkAdvance): Promise<void> =>
  storePending(
    input,
    normalizePending(
      [...withoutReadGround(input), ...(input.owed ?? [])],
      UNBOUNDED,
      Number.POSITIVE_INFINITY,
    ),
  );

const advanceRescan = async (input: MarkAdvance): Promise<void> => {
  const { span, plan, marks, restartMs, fields, write } = input;
  const rescanCursor = rescanCursorAfter({ span, plan, restartMs });

  // The list goes before the mark: a crash after the mark alone would pass a stuck record
  // that no list holds, while a crash after the list only has the re-scan read the span again.
  await advancePending(input);

  // A finished pass that was never started has no mark to reset: skip the redundant write.
  if (rescanCursor !== (marks.rescanCursor ?? restartMs)) {
    marks.rescanCursor = rescanCursor;
    await write(fields.rescan, rescanCursor);
  }
};

/**
 * Move the walk's marks once a span's rows are durable. A forward span moves the cursor to
 * its end, never back: the first spans of a pass start behind it, and the mark to compare
 * with is the one this run last wrote, not the one it found. The first forward span also
 * stores the list of owed ground, which holds this run's overlap day. A re-scan span moves
 * only the re-scan mark and leaves the cursor alone, so a re-scan can never undo the
 * forward pass. A re-scan span and a pending span take the ground they read out of the
 * list, put `owed` (the part of it the walk could not commit: its stuck records) back, and an
 * entry leaves the list only by being read (a point: once its whole window was read and a record
 * that owes exactly it came back, see `dropReadPoints`). `write` gets the field of the cursor that
 * moved and its value; `writePending` the field of the list and its new content.
 */
export const advanceWalkMarks = (input: MarkAdvance & { pass: WalkPass }): Promise<void> =>
  match(input.pass)
    .returnType<Promise<void>>()
    .with('forward', () => advanceCursor(input))
    .with('pending', () => advancePending(input))
    .with('rescan', () => advanceRescan(input))
    .exhaustive();

/**
 * The first half of a span, or `undefined` for a span of one millisecond, which cannot be
 * split. A half is at least one millisecond long, so no request has `startTime` equal to
 * `endTime`.
 */
export const halfOf = (span: WalkWindow): WalkWindow | undefined => {
  const length = span.end - span.start;

  return length < 2 ? undefined : { start: span.start, end: span.start + Math.floor(length / 2) };
};

/**
 * The span that follows a committed one. It starts where the committed one ended and is
 * twice as wide, because a stretch that fit one page is likely to fit a longer one, and
 * it never reaches past the window.
 */
export const nextSpanAfter = (committed: WalkWindow, window: WalkWindow): WalkWindow => ({
  start: committed.end,
  end: Math.min(window.end, committed.end + 2 * (committed.end - committed.start)),
});

/**
 * The calls a run keeps for the window re-scan while the owed ground spends the budget. The
 * owed ground is read first so that a busy re-scan does not starve it, but a re-scan that gets
 * no call in a run would never reach the records that settle late.
 */
const RESCAN_KEEP = 1;

/**
 * The calls a run keeps for the owed points while the owed ranges and the re-scan spend the
 * budget. A run that reads at least one point reads every point within `ceil(points / reads a
 * run)` runs (`startingAfter`); with none kept, a dense re-scan pass that spans several runs
 * would leave the points nothing, run after run. The forward pass keeps none: a run whose
 * forward pass spends the whole budget reads no point, and the bound counts only the runs whose
 * forward pass leaves a call.
 */
const POINT_KEEP = 1;

/**
 * Store the start of the point just read as the walk's point cursor, unless it is already the
 * stored one. Called once the read of the point has started, after the list write of any span of
 * it, so a crash between the two only has the next run read the point again.
 */
export const storePointCursor = async (input: {
  window: WalkWindow;
  marks: WalkMarks;
  field: BinanceWalkPointCursorField;
  write: (field: BinanceWalkNumberField, cursorMs: number) => Promise<void>;
}): Promise<void> => {
  const { window, marks, field, write } = input;

  if (marks.pointCursor !== window.start) {
    marks.pointCursor = window.start;
    await write(field, window.start);
  }
};

/**
 * Store the end of the window just read as the walk's range cursor, unless it is already the
 * stored one. Called once the read of the window has started, whether or not it finished. The
 * end, not the start: the window that follows the one read starts exactly at its end and is the
 * first to read next (`windowsFrom`), where a start would read the window just read first again.
 */
export const storeRangeCursor = async (input: {
  window: WalkWindow;
  marks: WalkMarks;
  field: BinanceWalkRangeCursorField;
  write: (field: BinanceWalkNumberField, cursorMs: number) => Promise<void>;
}): Promise<void> => {
  const { window, marks, field, write } = input;

  if (marks.rangeCursor !== window.end) {
    marks.rangeCursor = window.end;
    await write(field, window.end);
  }
};

/** Store the walk's span hints, and keep them in the marks. */
export const storeSpanHints = async (input: {
  hints: BinanceSpanHints;
  marks: WalkMarks;
  field: BinanceWalkSpanHintField;
  write: (field: BinanceWalkSpanHintField, hints: BinanceSpanHints) => Promise<void>;
}): Promise<void> => {
  const { hints, marks, field, write } = input;

  marks.hints = hints;
  await write(field, hints);
};

/** How a walk writes its cursors and its span hints: its holding's writers, one for each. */
type WalkWriters = {
  writeCursor: (field: BinanceWalkNumberField, cursorMs: number) => Promise<void>;
  writeHints: (field: BinanceWalkSpanHintField, hints: BinanceSpanHints) => Promise<void>;
};

/** The writers of a walk, bound to the holding that carries its marks. */
export const walkWritersOf = (
  holdingId: string,
  deps: Pick<BinanceWalkWriteDeps, 'writeWalkCursor' | 'writeWalkHints'>,
): WalkWriters => ({
  writeCursor: (field, cursorMs) => deps.writeWalkCursor(holdingId, field, cursorMs),
  writeHints: (field, hints) => deps.writeWalkHints(holdingId, field, hints),
});

/**
 * What a walk reads of its two round-robins and its span hints from its holding's metadata, each
 * repaired when malformed (see `readRoundRobinCursor`, `readSpanHints`).
 */
export const readWalkRoundRobins = async (
  input: { fields: WalkMarkFields; metadata: unknown } & WalkWriters,
): Promise<Pick<WalkMarks, 'pointCursor' | 'rangeCursor' | 'hints'>> => {
  const { fields, metadata, writeCursor, writeHints } = input;

  return {
    pointCursor: await readPointCursor({ field: fields.point, metadata, write: writeCursor }),
    rangeCursor: await readRangeCursor({ field: fields.range, metadata, write: writeCursor }),
    hints: await readSpanHints({ field: fields.hints, metadata, write: writeHints }),
  };
};

/**
 * What `runWalkPlan` needs of a walk's round-robins and span hints, over the walk's own `marks`:
 * mark a point or a range once its read has started, and store the hints.
 */
export const roundRobinHooksOf = (
  input: { marks: WalkMarks; fields: WalkMarkFields } & WalkWriters,
) => {
  const { marks, fields, writeCursor, writeHints } = input;

  return {
    markPointRead: (window: OwedWindow) =>
      storePointCursor({ window, marks, field: fields.point, write: writeCursor }),
    markRangeRead: (window: OwedWindow) =>
      storeRangeCursor({ window, marks, field: fields.range, write: writeCursor }),
    hints: {
      stored: marks.hints,
      store: (hints: BinanceSpanHints) =>
        storeSpanHints({ hints, marks, field: fields.hints, write: writeHints }),
    },
  };
};

const byHintStart = (left: BinanceSpanHint, right: BinanceSpanHint): number =>
  left.start - right.start;

/** The hints with the one of the window that starts at `start` replaced, or dropped for `null`. */
const withHint = (
  hints: BinanceSpanHints,
  pass: BinanceSpanHintPass,
  start: number,
  hint: BinanceSpanHint | null,
): BinanceSpanHints => ({
  ...hints,
  [pass]: [
    ...hints[pass].filter((other) => other.start !== start),
    ...(foldMap(maybe(hint), (value) => [value]) ?? []),
  ].sort(byHintStart),
});

/** Whether two lists name the same series, in any order; none is none. */
const sameSeries = (left?: readonly string[], right?: readonly string[]): boolean =>
  left === undefined || right === undefined
    ? left === right
    : [...left].sort().join('|') === [...right].sort().join('|');

/**
 * Whether `hint` can be read by `window`: it starts where the window starts, and a resume was
 * made for the series the window is read in now. A resume made for other series has read the
 * ground behind it in some of these only, so a window that took it would skip ground.
 */
const isHintOf = (hint: BinanceSpanHint, window: OwedWindow): boolean =>
  hint.start === window.start &&
  (hint.resume === undefined || sameSeries(hint.resume.series, window.series));

/**
 * The hints that a window of the plan can still use (`isHintOf`). A cursor, a mark or a list that
 * moved on leaves a hint nobody reads, and it goes.
 */
const hintsOfPlan = (hints: BinanceSpanHints, plan: WalkPlan): BinanceSpanHints => {
  const kept = (pass: BinanceSpanHintPass, windows: OwedWindow[]): BinanceSpanHint[] =>
    hints[pass].filter((hint) => windows.some((window) => isHintOf(hint, window)));

  return {
    forward: kept('forward', plan.forward),
    pending: kept('pending', plan.pending),
    rescan: kept('rescan', plan.rescan),
    point: kept('point', plan.points),
  };
};

const sameResume = (left?: BinanceSpanResume, right?: BinanceSpanResume): boolean =>
  left === undefined || right === undefined
    ? left === right
    : left.from === right.from &&
      sameList(left.returned, right.returned) &&
      sameList(left.stuck, right.stuck) &&
      sameSeries(left.series, right.series);

const sameHints = (left: BinanceSpanHints, right: BinanceSpanHints): boolean =>
  (['forward', 'pending', 'rescan', 'point'] as const).every(
    (pass) =>
      left[pass].length === right[pass].length &&
      left[pass].every(
        (hint, index) =>
          hint.start === right[pass][index].start &&
          hint.end === right[pass][index].end &&
          sameResume(hint.resume, right[pass][index].resume),
      ),
  );

/**
 * Run a plan's windows: the forward pass first, then the windows of the owed ranges (a
 * round-robin from the range cursor, see `windowsFrom`), then the re-scan, then the owed points,
 * each on what budget is left. A window that does not finish ends the pass it is in where
 * `STOP_ENDS_PASS` says so, and a window the budget cannot afford ends the pass; no pass ends the
 * run, so a stop in the forward pass (whose cursor never passes the stuck record) still leaves the
 * owed ground, the re-scan and the points their reads. A later run resumes from the stored marks.
 * An owed window that does not finish stays owed and the run goes on to the next one and to the
 * re-scan.
 *
 * A read commits every record it can trust and leaves the ground of the others owed (see
 * `settleRecords`), so a stuck record never holds back the rest of a span, a range or the
 * re-scan. The owed ranges are read before the re-scan, but never into the call it needs
 * (`RESCAN_KEEP`), nor into the one the points need (`POINT_KEEP`): a range that is read whole
 * every run would otherwise leave the re-scan nothing. The owed points are read after the
 * re-scan, on the budget that is left, one call each: reading them first would let many of them
 * take the whole budget of every run from the owed days and the re-scan. One that the budget
 * skips stays owed; the plan gives them in a round-robin (`startingAfter`) that `markPointRead`
 * moves on once the read of a point has started, whether or not its window finished (a window
 * that splits and runs out of calls stays owed, and the round-robin goes on to the next point),
 * so each is among those a run reads in a bounded number of runs. `canAfford` takes the number
 * of calls to keep after the one it asks about, and must also say no once Binance has rate
 * limited the account, or the run would go on asking after a 429. The walk is reported complete
 * only when every window was read to its end and no record is left owed.
 *
 * A walk that reads several series (a Transfer type each) spends `callsOf(window)` calls on one
 * read of a window: the keeps are counted in calls (the re-scan keeps one read of its first
 * window, the points one read of the first point), and a window is entered only when all its
 * calls fit beside the keep, because a read that ran out of calls part way would have paid for
 * nothing. A walk with one call for a read leaves it out.
 */
export const runWalkPlan = async (input: {
  plan: WalkPlan;
  canAfford: (keep: number) => boolean;
  runWindow: (
    window: OwedWindow,
    pass: WalkPass,
    keep: number,
    hint?: BinanceSpanHint,
  ) => Promise<WindowOutcome>;
  markPointRead?: (window: OwedWindow) => Promise<void>;
  markRangeRead?: (window: OwedWindow) => Promise<void>;
  hints?: { stored: BinanceSpanHints; store: (next: BinanceSpanHints) => Promise<void> };
  callsOf?: (window: OwedWindow) => number;
}): Promise<WalkResult> => {
  const { plan, canAfford, runWindow, markPointRead, markRangeRead, callsOf = () => 1 } = input;
  const pointKeep = plan.points.length > 0 ? POINT_KEEP * callsOf(plan.points[0]) : 0;
  const rescanKeep = plan.rescan.length > 0 ? RESCAN_KEEP * callsOf(plan.rescan[0]) : 0;
  let imported = 0;
  let complete = true;
  let hints = input.hints?.stored ?? NO_HINTS;

  const saveHints = async (next: BinanceSpanHints): Promise<void> => {
    if (!sameHints(next, hints)) {
      hints = next;
      await input.hints?.store(next);
    }
  };

  /**
   * Run one window. It is given the hint of its own `hintPass` that starts where it starts, and
   * the hint it comes back with takes the place of that one: a window that began with a hint and
   * was cut short again leaves a narrower one. A window with a committed span leaves a resume
   * when it is a point window, and none otherwise: the other passes keep what they read in their
   * cursor, their list and their re-scan mark, which only a point window has no mark for.
   */
  const runWithHint = async (
    window: OwedWindow,
    pass: WalkPass,
    keep: number,
    hintPass: BinanceSpanHintPass,
  ): Promise<WindowOutcome> => {
    const outcome = await runWindow(
      window,
      pass,
      keep,
      hints[hintPass].find((hint) => hint.start === window.start),
    );
    const hint = hintPass === 'point' || outcome.hint?.resume === undefined ? outcome.hint : null;

    if (hint !== undefined) {
      await saveHints(withHint(hints, hintPass, window.start, hint));
    }

    return outcome;
  };

  /** Read the windows of one pass, in order, until one ends the pass or the budget does. */
  const readPass = async (
    windows: OwedWindow[],
    pass: WalkPass,
    keep: number,
    hintPass: BinanceSpanHintPass,
    afterRead?: (window: OwedWindow) => Promise<void>,
  ): Promise<void> => {
    for (const window of windows) {
      // The window is entered only when every call of it fits beside the calls kept after it, so
      // a read never pays for part of its series and then gives up.
      if (!canAfford(keep + callsOf(window) - 1)) {
        complete = false;

        return;
      }

      const outcome = await runWithHint(window, pass, keep, hintPass);
      imported += outcome.imported;
      complete = complete && outcome.complete && !outcome.owed;

      if (outcome.started) {
        await afterRead?.(window);
      }

      if (!outcome.complete && STOP_ENDS_PASS[pass]) {
        return;
      }
    }
  };

  await saveHints(hintsOfPlan(hints, plan));
  await readPass(plan.forward, 'forward', 0, 'forward');
  await readPass(plan.pending, 'pending', rescanKeep + pointKeep, 'pending', markRangeRead);
  await readPass(plan.rescan, 'rescan', pointKeep, 'rescan');
  await readPass(plan.points, 'pending', 0, 'point', markPointRead);

  return { imported, complete };
};

const isDecimalInput = (amount: unknown): amount is string | number =>
  typeof amount === 'number' || (typeof amount === 'string' && amount.trim() !== '');

/**
 * A BTC decimal string (or number) to satoshis, or `null` when it is not a finite
 * number. A blank string is no amount: `Number('')` reads as 0 and would import a
 * zero-satoshi row.
 */
export const btcSatoshis = (amount: unknown): number | null => {
  if (!isDecimalInput(amount)) {
    return null;
  }

  const value = Number(amount);

  return Number.isFinite(value) ? Money.fromMajor(BINANCE_ASSET, value).minorUnits : null;
};

/**
 * A window the walk will not commit, because a row in it cannot be placed or
 * trusted. The code is a fixed tag; a swallowed failure logs only an error's name
 * and code, so nothing of the row (an amount, an id) can reach a log through it.
 */
export class BinanceWalkStop extends Error {
  public readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'BinanceWalkStop';
    this.code = code;
    // A Babel/Hermes-transpiled `extends Error` loses the prototype link that
    // `instanceof` relies on unless it is restored explicitly.
    Object.setPrototypeOf(this, BinanceWalkStop.prototype);
  }
}

export const logWalkStop = (code: string): void => {
  logFailure('[binance sync] history window stopped', new BinanceWalkStop(code));
};

/** What one span read gave: the page that fits it, or the half to read instead. */
export type SpanRead<Page> = { kind: 'page'; page: Page } | { kind: 'split'; half: WalkWindow };

type SpanStep = { next: WalkWindow; commit: SpanCommit };

const NOTHING_COMMITTED: SpanCommit = { imported: 0, owed: false, returned: [], stuck: [] };

/**
 * Handle what one read gave. A split moves to the half and commits nothing. A page is
 * committed, and the walk goes on from where the span ended, twice as wide, because a
 * stretch that fit one page is likely to fit a longer one. `undefined` is a commit that
 * stopped the walk.
 */
const stepAfterRead = <Page>(input: {
  read: SpanRead<Page>;
  span: WalkWindow;
  window: WalkWindow;
  commit: (span: WalkWindow, page: Page) => Promise<SpanCommit | undefined>;
}): Promise<SpanStep | undefined> =>
  match(input.read)
    .returnType<Promise<SpanStep | undefined>>()
    .with({ kind: 'split' }, async ({ half }) => ({ next: half, commit: NOTHING_COMMITTED }))
    .with({ kind: 'page' }, async ({ page }) =>
      foldMap(maybe(await input.commit(input.span, page)), (committed) => ({
        next: nextSpanAfter(input.span, input.window),
        commit: committed,
      })),
    )
    .exhaustive();

/**
 * The span a window starts with: its hint when that starts with the window (from the start of the
 * ground its resume has not read yet, if it has one), else the window.
 */
const firstSpanOf = (window: WalkWindow, hint: BinanceSpanHint | undefined): WalkWindow =>
  hint?.start === window.start
    ? { start: hint.resume?.from ?? window.start, end: Math.min(hint.end, window.end) }
    : window;

/**
 * The hint to leave when a window is left while at `span`. When no span of the window committed,
 * in this run or an earlier one, it is that span if it is narrower than the window, else none.
 * When some span did, it is a resume: the next span, and what the committed spans returned and
 * left owed, so a later run finishes the window where this one stopped (`walkSpans`).
 */
const leftAt = (input: {
  span: WalkWindow;
  window: OwedWindow;
  progressed: boolean;
  returned: OwedGround[];
  stuck: OwedGround[];
}): BinanceSpanHint | null => {
  const { span, window, progressed, returned, stuck } = input;

  if (!progressed) {
    return span.end >= window.end ? null : { start: span.start, end: span.end };
  }

  return {
    start: window.start,
    end: span.end,
    resume: {
      from: span.start,
      // A record a read returned names its point with no tag, and a stored list tells a point
      // from a range by its tag alone.
      returned: distinctGround(returned.map((point): OwedGround => ({ ...point, kind: 'point' }))),
      stuck: distinctGround(stuck),
      ...foldMap(maybe(window.series), (series) => ({ series: [...series] })),
    },
  };
};

/**
 * Walk one window with no cursor and no order to rely on: read the whole window, and when
 * the read finds it too full (it may hold more than it shows) read its first half instead,
 * so a span that is not too full is the whole of itself whatever order Binance sorts in. A
 * span that fits is committed and the walk goes on from where it ended; the 1-millisecond
 * boundary two spans share is read twice and removed by the row key. The walk supplies
 * what differs: `read` (`undefined` is a clean stop, such as an unaffordable call) and
 * `commit` (what it imported and whether it left ground owed, or `undefined` for a stop, which
 * leaves the span uncommitted: only the forward pass stops, see `commitSettledSpan`). Either
 * stop reports the window incomplete with what was committed, and the walk's marks, which
 * only a commit moves, stay where the last committed span left them. `keep` is the number of
 * calls the run holds back for later passes, which every `read` of the window leaves
 * unspent: a dense window must not read its way into them. A window read to its end hands
 * `onComplete` the points of the records its spans returned, less the points any record of it
 * left owed (see `dropReadPoints`); an incomplete one hands nothing, however much it read.
 *
 * A window that splits commits nothing until a span fits, and a run that ends before that leaves
 * the next run to start the whole chain of halvings again, which may be longer than a run has
 * calls for. So the window starts with `hint`, the span an earlier run was left at, when it
 * starts where the window starts (never wider than the window: a hint can only narrow a read, so
 * it never skips ground), and a run that stops before any span committed reports the span it was
 * at as `hint` in the outcome (`null` when that is the whole window: nothing was narrowed).
 *
 * A window that stops after some of its spans committed, in this run or an earlier one, reports a
 * resume as `hint` (see `BinanceSpanResume`): the span to read next, and the points the spans
 * read so far returned and the ground they left owed, which a run that finishes the window folds
 * into its own, so the window hands `onComplete` what one read of all of it would have. Only a
 * point window keeps the resume (`runWalkPlan`): a point leaves the list only by a window read to
 * its end, and a window longer than a run's calls for it would never be.
 */
export const walkSpans = async <Page>(input: {
  window: OwedWindow;
  read: (span: WalkWindow, keep: number) => Promise<SpanRead<Page> | undefined>;
  commit: (span: WalkWindow, page: Page) => Promise<SpanCommit | undefined>;
  keep?: number;
  hint?: BinanceSpanHint;
  onComplete?: (read: OwedGround[]) => Promise<void>;
}): Promise<WindowOutcome> => {
  const { window, read, commit, keep = 0, hint, onComplete } = input;
  const outcome: WindowOutcome = {
    imported: 0,
    complete: false,
    owed: false,
    started: false,
    hint: null,
  };
  const resume = hint?.start === window.start ? hint.resume : undefined;
  const returned: OwedGround[] = [...(resume?.returned ?? [])];
  const stuck: OwedGround[] = [...(resume?.stuck ?? [])];
  let span = firstSpanOf(window, hint);
  let progressed = resume !== undefined;

  while (span.start < window.end) {
    const spanRead = await read(span, keep);

    if (spanRead === undefined) {
      return { ...outcome, hint: leftAt({ span, window, progressed, returned, stuck }) };
    }

    outcome.started = true;

    const step = await stepAfterRead({ read: spanRead, span, window, commit });

    if (step === undefined) {
      return { ...outcome, hint: leftAt({ span, window, progressed, returned, stuck }) };
    }

    progressed = progressed || spanRead.kind === 'page';
    outcome.imported += step.commit.imported;
    outcome.owed = outcome.owed || step.commit.owed;
    returned.push(...step.commit.returned);
    stuck.push(...step.commit.stuck);
    span = step.next;
  }

  await onComplete?.(
    returned.filter(
      (point, index) =>
        returned.findIndex((other) => samePoint(other, point)) === index &&
        !stuck.some((owed) => holdsPoint(owed, point)),
    ),
  );

  return { ...outcome, complete: true };
};

/**
 * The holding of each wanted wallet key, creating a missing one at zero balance
 * first. A missing wallet holding is a wallet that was empty at the last balance
 * sync (a never-used wallet creates none). An absent and a zero holding both add 0
 * to net worth, and the next good balance read overwrites the zero. The write is
 * insert-only, so a holding that appeared since the read is never overwritten.
 * `createKeys` (default: every key) limits which missing keys are created: a wallet
 * that receives only rows already stored elsewhere must not appear as an empty holding.
 */
export const resolveWalletHoldings = async (input: {
  accountId: string;
  keys: BinanceWalletKey[];
  createKeys?: BinanceWalletKey[];
  listHoldings: (accountId: string) => Promise<HoldingRow[]>;
  ensureHoldings: (holdings: ExchangeHolding[]) => Promise<void>;
}): Promise<Map<BinanceWalletKey, HoldingRow>> => {
  const { accountId, keys, createKeys = keys, listHoldings, ensureHoldings } = input;
  let current = await listHoldings(accountId);
  const missing = keys.filter(
    (key) => createKeys.includes(key) && !current.some((holding) => binanceKeyOf(holding) === key),
  );

  if (missing.length > 0) {
    await ensureHoldings(
      missing.map(
        (key): ExchangeHolding => ({
          accountId,
          name: WALLET_HOLDING_NAMES[key],
          type: 'crypto_asset',
          currency: BINANCE_ASSET,
          balanceMinorUnits: 0,
          metadataField: 'binanceAsset',
          metadataKey: key,
        }),
      ),
    );
    current = await listHoldings(accountId);
  }

  return new Map(
    keys.flatMap((key) => {
      const found = current.find((holding) => binanceKeyOf(holding) === key);

      return foldMap(maybe(found), (holding) => [[key, holding] as const]) ?? [];
    }),
  );
};
