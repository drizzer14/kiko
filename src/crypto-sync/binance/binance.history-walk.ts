import { match } from 'ts-pattern';
import {
  type BinanceWalkCursorField,
  type BinanceWalkPendingField,
  binanceWalkPendingOf,
} from '@kiko/holdings/holding-metadata';
import type { HoldingRow } from '@kiko/db';
import maybe, { foldMap } from 'fnts/maybe';
import { Money } from '@kiko/currency/money';
import { logFailure } from '@kiko/diagnostics';
import type { ExchangeHolding } from '@kiko/holdings/repo';

import { BINANCE_ASSET } from './binance.client';
import { type BinanceWalletKey, binanceKeyOf, WALLET_HOLDING_NAMES } from './binance.holding-keys';

/** What one walk reports: rows imported this run, and whether it reached the end of its span. */
export type WalkResult = { imported: number; complete: boolean };

export type WalkWindow = { start: number; end: number };

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
 * Whether a window that does not finish (the budget cannot afford the next read, or Binance
 * rate-limits) ends the run in that pass. The forward pass and the re-scan move a mark that
 * only a commit moves, so they cannot read past it. An owed range is not read in order, so the
 * run reads on to the next one.
 */
const STOP_ENDS_RUN: Record<WalkPass, boolean> = {
  forward: true,
  pending: false,
  rescan: true,
};

/**
 * What a committed span gave: the rows it imported, and whether it left ground owed: a record
 * it could not trust, which a later run reads again (see `settleRecords`).
 */
export type SpanCommit = { imported: number; owed: boolean };

/**
 * What one window gave: the rows imported, whether it was read to its end, and whether any of
 * its spans left ground owed.
 */
export type WindowOutcome = { imported: number; complete: boolean; owed: boolean };

/**
 * One run of a walk, as three passes. `forward` goes from the cursor to the end and moves the
 * walk's cursor. `pending` reads the ground earlier runs left owed (`pending` holds the
 * windows of its ranges, `points` those of its points) and moves no mark. `rescan` goes back
 * over the ground behind the forward start, to catch a record that settles late, and never
 * moves that cursor. `rescanEnd` is where the re-scan ends. `pendingRanges` is the list of owed
 * ground as it stands once this run's own overlap day is in it: what to store before the
 * forward pass first moves the cursor.
 */
export type WalkPlan = {
  forward: WalkWindow[];
  pending: WalkWindow[];
  points: WalkWindow[];
  rescan: WalkWindow[];
  rescanEnd: number;
  pendingRanges: WalkWindow[];
};

/**
 * A walk's owed ground cannot hold more ranges than this between runs. Each costs at least one
 * call of a run's leftover budget, so a longer list could not be served in one run; past the
 * limit the two nearest ranges merge, which only has the run read the gap between them too. A
 * run's own overlap day is the one range beyond it (`planWalkPasses`): the re-scan reads that
 * day in the same run. Points (`POINT_MAX_MS`) are not ranges, and are never merged.
 */
const MAX_PENDING_RANGES = 12;

/**
 * The longest owed range that is a point, in milliseconds: the ground one record the walk
 * could not trust owes (one second for a withdrawal, whose time has a precision of one
 * second). A point is read on its own, last in a run, one call each, and starts a run at a
 * place that changes with the run's time (`planWalkPasses`).
 */
const POINT_MAX_MS = 1_000;

const isPoint = (window: WalkWindow): boolean => window.end - window.start <= POINT_MAX_MS;

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

/** The points of `ranges` once, and none that a range already holds. */
const pointsOutside = (points: WalkWindow[], ranges: WalkWindow[]): WalkWindow[] =>
  points.filter(
    (point, index) =>
      points.findIndex((other) => other.start === point.start && other.end === point.end) ===
        index && !ranges.some((range) => range.start <= point.start && point.end <= range.end),
  );

/**
 * Owed ground in its stored form: cut to what the walk can still ask for (not before the
 * floor, not after the end), oldest first. Ranges that touch are merged, and past `limit` the
 * two nearest merge into their hull, which reads the gap between them too and loses no
 * ground. A point (`POINT_MAX_MS`) is a record already found: it is never merged with
 * anything, so it is read alone and last. It is dropped only where a range already holds it
 * (before the merge past `limit`, so a hull that two ranges merged into never takes one in), or
 * where it repeats one.
 */
const normalizePending = (
  ranges: WalkWindow[],
  bounds: { floorMs: number; endTime: number },
  limit = MAX_PENDING_RANGES,
): WalkWindow[] => {
  const cut = ranges
    .map((range) => ({
      start: Math.max(range.start, bounds.floorMs),
      end: Math.min(range.end, bounds.endTime),
    }))
    .filter((range) => range.start < range.end)
    .sort(byStart);
  const merged = mergeTouching(cut.filter((range) => !isPoint(range)));
  const points = pointsOutside(cut.filter(isPoint), merged);

  while (merged.length > limit) {
    const index = nearestGapIndexOf(merged);
    merged.splice(index, 2, { start: merged[index].start, end: merged[index + 1].end });
  }

  return [...merged, ...points].sort(byStart);
};

/**
 * The stored pending ranges of one walk. A value that is not a well-formed list says nothing
 * about which days were owed, and reading it as empty would let the next write drop them, so
 * all the ground before the cursor (`owedIfUnreadable`) is owed instead, once: it is stored
 * at once, so the repaired list is what every later run reads and moves forward. The failure
 * is logged under one fixed code: a corrupt list must not fail a balance sync.
 */
export const readPendingMark = async (input: {
  field: BinanceWalkPendingField;
  metadata: unknown;
  owedIfUnreadable: WalkWindow;
  write: (field: BinanceWalkPendingField, ranges: WalkWindow[]) => Promise<void>;
}): Promise<WalkWindow[]> => {
  const { field, metadata, owedIfUnreadable, write } = input;
  const stored = binanceWalkPendingOf(field, metadata);

  if (stored !== undefined) {
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

const TWO_POWER_32 = 2 ** 32;

const MIX_MULTIPLIER = 0x45d9f3b;

/**
 * A 32-bit mix of a time, so that runs spaced at a regular interval (every hour, every day)
 * still land on unrelated numbers: a plain remainder of the time would repeat itself for a
 * count that divides the interval.
 */
const mixedFrom = (time: number): number => {
  const folded = time % TWO_POWER_32;
  const once = Math.imul(folded ^ (folded >>> 16), MIX_MULTIPLIER);
  const twice = Math.imul(once ^ (once >>> 16), MIX_MULTIPLIER);

  return (twice ^ (twice >>> 16)) >>> 0;
};

/**
 * `windows` starting at a place that depends on `time` alone, in the same order from there and
 * wrapping around. The points are read last, on the calls the run has left, and a run that
 * always started at the oldest would read the same few every time and never reach a newer one.
 * No state is stored: each run's own end time picks the place, so every point has the same
 * chance of being among the ones a run reads.
 */
const rotatedAt = (windows: WalkWindow[], time: number): WalkWindow[] => {
  const offset = windows.length === 0 ? 0 : mixedFrom(time) % windows.length;

  return [...windows.slice(offset), ...windows.slice(0, offset)];
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
 * the re-scan will not read (oldest first), so a catch-up from a cursor of any age, a long
 * absence, or a window that outran an unfinished pass loses no day. The list is separate
 * from the re-scan mark: a stop inside one range leaves the other ranges and the re-scan to
 * run.
 */
export const planWalkPasses = (input: {
  cursor: number | null;
  rescanCursor: number | null;
  pending: WalkWindow[];
  floorMs: number;
  endTime: number;
  windowMs: number;
  overlapMs: number;
  maxWindows: number;
}): WalkPlan => {
  const { cursor, rescanCursor, pending, floorMs, endTime, windowMs, overlapMs, maxWindows } =
    input;
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
  const stored = normalizePending(pending, bounds);
  const withDay = normalizePending(
    [
      ...stored.filter((range) => !isPoint(range)),
      { start: behindEnd - overlapMs, end: behindEnd },
    ],
    bounds,
    MAX_PENDING_RANGES + 1,
  );
  const pendingRanges = [...withDay, ...stored.filter(isPoint)].sort(byStart);
  const rescanned = {
    start: rescan.at(0)?.start ?? behindEnd,
    end: rescan.at(-1)?.end ?? behindEnd,
  };
  const owed = withoutRead(pendingRanges, rescanned).flatMap((range) =>
    buildWalkWindows(range.start, range.end, windowMs, maxWindows),
  );

  return {
    forward: buildWalkWindows(forwardStart, endTime, windowMs, maxWindows),
    pending: owed.filter((window) => !isPoint(window)),
    points: rotatedAt(owed.filter(isPoint), endTime),
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
 * cursor, the re-scan mark, and the list of owed ground.
 */
export type WalkMarks = {
  cursor: number | null;
  rescanCursor: number | null;
  pending: WalkWindow[];
};

/** The metadata field each of a walk's marks is stored under. */
export type WalkMarkFields = Record<'cursor' | 'rescan', BinanceWalkCursorField> & {
  pending: BinanceWalkPendingField;
};

type MarkAdvance = {
  span: WalkWindow;
  /** The ground of `span` the walk could not commit, which stays owed (a point, or the span). */
  owed?: WalkWindow[];
  plan: WalkPlan;
  marks: WalkMarks;
  restartMs: number;
  fields: WalkMarkFields;
  write: (field: BinanceWalkCursorField, cursorMs: number) => Promise<void>;
  writePending: (field: BinanceWalkPendingField, ranges: WalkWindow[]) => Promise<void>;
};

/** Stored lists are cut to nothing and merged to no limit: only a run's plan bounds a list. */
const UNBOUNDED = { floorMs: Number.NEGATIVE_INFINITY, endTime: Number.POSITIVE_INFINITY };

const sameRanges = (left: WalkWindow[], right: WalkWindow[]): boolean =>
  left.length === right.length &&
  left.every(
    (range, index) => range.start === right[index].start && range.end === right[index].end,
  );

const storePending = async (input: MarkAdvance, next: WalkWindow[]): Promise<void> => {
  if (!sameRanges(next, input.marks.pending)) {
    input.marks.pending = next;
    await input.writePending(input.fields.pending, next);
  }
};

const advanceCursor = async (input: MarkAdvance): Promise<void> => {
  const { span, plan, marks, fields, write } = input;

  // The owed ground goes first: a crash after it only leaves a range the next run reads
  // again, while a crash after the cursor alone would leave the overlap behind the old
  // cursor owed to no run.
  await storePending(input, plan.pendingRanges);

  marks.cursor = Math.max(span.end, marks.cursor ?? span.end);
  await write(fields.cursor, marks.cursor);
};

/**
 * The list without the ground the span read, and with the ground of it that stays owed: one
 * write, so a crash leaves either the list as it was or the list with the stuck records in it.
 */
const advancePending = (input: MarkAdvance): Promise<void> =>
  storePending(
    input,
    normalizePending(
      [...withoutRead(input.marks.pending, input.span), ...(input.owed ?? [])],
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
 * entry leaves the list only by being read. `write` gets the field of the cursor that moved
 * and its value; `writePending` the field of the list and its new content.
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
 * Run a plan's windows: the forward pass first, then the owed ranges (oldest first), then the
 * re-scan, then the owed points, each on what budget is left. A forward or re-scan window that
 * does not finish, and any window the budget cannot afford, ends the run: a later run resumes
 * from the stored marks. An owed window that does not finish stays owed and the run goes on to
 * the next one and to the re-scan.
 *
 * A read commits every record it can trust and leaves the ground of the others owed (see
 * `settleRecords`), so a stuck record never holds back the rest of a span, a range or the
 * re-scan. The owed ranges are read before the re-scan, but never into the call it needs
 * (`RESCAN_KEEP`): a range that is read whole every run would otherwise leave the re-scan
 * nothing. The owed points are read after the re-scan, on the budget that is left, one call
 * each: reading them first would let many of them take the whole budget of every run from the
 * owed days and the re-scan. One that the budget skips stays owed; the plan puts them in an
 * order that changes with the run's time, so each is among those a run reads (see
 * `planWalkPasses`). `canAfford` takes the number of calls to keep after the one it asks about,
 * and must also say no once Binance has rate limited the account, or the run would go on asking
 * after a 429. The walk is reported complete only when every window was read to its end and no
 * record is left owed.
 */
export const runWalkPlan = async (input: {
  plan: WalkPlan;
  canAfford: (keep: number) => boolean;
  runWindow: (window: WalkWindow, pass: WalkPass, keep: number) => Promise<WindowOutcome>;
}): Promise<WalkResult> => {
  const { plan, canAfford, runWindow } = input;
  const rescanKeep = plan.rescan.length > 0 ? RESCAN_KEEP : 0;
  let imported = 0;
  let complete = true;

  /** Whether the pass ends early: a window the budget cannot afford, or one that ends it. */
  const readPass = async (
    windows: WalkWindow[],
    pass: WalkPass,
    keep: number,
  ): Promise<boolean> => {
    for (const window of windows) {
      if (!canAfford(keep)) {
        complete = false;

        return true;
      }

      const outcome = await runWindow(window, pass, keep);
      imported += outcome.imported;
      complete = complete && outcome.complete && !outcome.owed;

      if (!outcome.complete && STOP_ENDS_RUN[pass]) {
        return true;
      }
    }

    return false;
  };

  if (await readPass(plan.forward, 'forward', 0)) {
    return { imported, complete: false };
  }

  await readPass(plan.pending, 'pending', rescanKeep);
  await readPass(plan.rescan, 'rescan', 0);
  await readPass(plan.points, 'pending', 0);

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

const NOTHING_COMMITTED: SpanCommit = { imported: 0, owed: false };

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
 * unspent: a dense window must not read its way into them.
 */
export const walkSpans = async <Page>(input: {
  window: WalkWindow;
  read: (span: WalkWindow, keep: number) => Promise<SpanRead<Page> | undefined>;
  commit: (span: WalkWindow, page: Page) => Promise<SpanCommit | undefined>;
  keep?: number;
}): Promise<WindowOutcome> => {
  const { window, read, commit, keep = 0 } = input;
  const outcome: WindowOutcome = { imported: 0, complete: false, owed: false };
  let span = window;

  while (span.start < window.end) {
    const spanRead = await read(span, keep);

    if (spanRead === undefined) {
      return outcome;
    }

    const step = await stepAfterRead({ read: spanRead, span, window, commit });

    if (step === undefined) {
      return outcome;
    }

    outcome.imported += step.commit.imported;
    outcome.owed = outcome.owed || step.commit.owed;
    span = step.next;
  }

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
