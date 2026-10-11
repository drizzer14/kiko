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
 * own, so a stop in one of them leaves the others and the re-scan to run.
 */
export type WalkPass = 'forward' | 'pending' | 'rescan';

/**
 * One run of a walk, as three passes. `forward` goes from the cursor to the end and moves the
 * walk's cursor. `pending` reads the ground earlier runs left owed (`pending` holds its
 * windows) and moves no mark. `rescan` goes back over the ground behind the forward start, to
 * catch a record that settles late, and never moves that cursor. `rescanEnd` is where the
 * re-scan ends. `pendingRanges` is the list of owed ground as it stands once this run's own
 * overlap day is in it: what to store before the forward pass first moves the cursor.
 */
export type WalkPlan = {
  forward: WalkWindow[];
  pending: WalkWindow[];
  rescan: WalkWindow[];
  rescanEnd: number;
  pendingRanges: WalkWindow[];
};

/**
 * A walk's owed ground cannot hold more ranges than this. Each range costs at least one call
 * of a run's leftover budget, so a longer list could not be served in one run; past the
 * limit the two nearest ranges merge, which only has the run read the gap between them too.
 */
const MAX_PENDING_RANGES = 12;

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

const nearestGapIndexOf = (ranges: WalkWindow[]): number =>
  ranges.slice(1).reduce(
    (nearest, range, index) => {
      const gap = range.start - ranges[index].end;

      return gap < nearest.gap ? { index, gap } : nearest;
    },
    { index: 0, gap: Number.POSITIVE_INFINITY },
  ).index;

/**
 * Owed ground in its stored form: cut to what the walk can still ask for (not before the
 * floor, not after the end), oldest first, touching ranges merged, at most
 * `MAX_PENDING_RANGES` of them.
 */
const normalizePending = (
  ranges: WalkWindow[],
  bounds: { floorMs: number; endTime: number },
): WalkWindow[] => {
  const merged = mergeTouching(
    ranges
      .map((range) => ({
        start: Math.max(range.start, bounds.floorMs),
        end: Math.min(range.end, bounds.endTime),
      }))
      .filter((range) => range.start < range.end)
      .sort((left, right) => left.start - right.start),
  );

  while (merged.length > MAX_PENDING_RANGES) {
    const index = nearestGapIndexOf(merged);
    merged.splice(index, 2, { start: merged[index].start, end: merged[index + 1].end });
  }

  return merged;
};

const logMalformedPending = (): WalkWindow[] => {
  logFailure(
    '[binance sync] pending overlap ranges unreadable',
    new BinanceWalkStop('pending-malformed'),
  );

  return [];
};

/**
 * The stored pending ranges of one walk. A value that is not a well-formed list is read as
 * an empty one under one fixed log code: a corrupt list must not fail a balance sync.
 */
export const storedPendingOf = (field: BinanceWalkPendingField, metadata: unknown): WalkWindow[] =>
  binanceWalkPendingOf(field, metadata) ?? logMalformedPending();

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
  const pendingRanges = normalizePending(
    [...pending, { start: behindEnd - overlapMs, end: behindEnd }],
    { floorMs, endTime },
  );
  const rescanned = {
    start: rescan.at(0)?.start ?? behindEnd,
    end: rescan.at(-1)?.end ?? behindEnd,
  };

  return {
    forward: buildWalkWindows(forwardStart, endTime, windowMs, maxWindows),
    pending: withoutRead(pendingRanges, rescanned).flatMap((range) =>
      buildWalkWindows(range.start, range.end, windowMs, maxWindows),
    ),
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
  plan: WalkPlan;
  marks: WalkMarks;
  restartMs: number;
  fields: WalkMarkFields;
  write: (field: BinanceWalkCursorField, cursorMs: number) => Promise<void>;
  writePending: (field: BinanceWalkPendingField, ranges: WalkWindow[]) => Promise<void>;
};

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

const advancePending = (input: MarkAdvance): Promise<void> =>
  storePending(input, withoutRead(input.marks.pending, input.span));

const advanceRescan = async (input: MarkAdvance): Promise<void> => {
  const { span, plan, marks, restartMs, fields, write } = input;
  const rescanCursor = rescanCursorAfter({ span, plan, restartMs });

  // A finished pass that was never started has no mark to reset: skip the redundant write.
  if (rescanCursor !== (marks.rescanCursor ?? restartMs)) {
    marks.rescanCursor = rescanCursor;
    await write(fields.rescan, rescanCursor);
  }

  await advancePending(input);
};

/**
 * Move the walk's marks once a span's rows are durable. A forward span moves the cursor to
 * its end, never back: the first spans of a pass start behind it, and the mark to compare
 * with is the one this run last wrote, not the one it found. The first forward span also
 * stores the list of owed ground, which holds this run's overlap day. A re-scan span moves
 * only the re-scan mark and leaves the cursor alone, so a re-scan can never undo the
 * forward pass. A re-scan span and a pending span take the ground they read out of the
 * list, and an entry leaves it only by being read. `write` gets the field of the cursor that
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
 * Run a plan's windows: the forward pass first, then the owed ground (oldest first), then the
 * re-scan, each on what budget is left. A forward or re-scan window that does not complete,
 * and any window the budget cannot afford, ends the run: a later run resumes from the stored
 * marks. A pending window that does not complete stays owed and the run goes on to the next
 * one and to the re-scan, so one stuck day starves neither. `canAfford` must also say no
 * once Binance has rate limited the account, or the run would go on asking after a 429.
 * Either way the walk is reported incomplete.
 */
export const runWalkPlan = async (input: {
  plan: WalkPlan;
  canAfford: () => boolean;
  runWindow: (window: WalkWindow, pass: WalkPass) => Promise<WalkResult>;
}): Promise<WalkResult> => {
  const { plan, canAfford, runWindow } = input;
  const steps = [
    ...plan.forward.map((window) => ({ window, pass: 'forward' as const })),
    ...plan.pending.map((window) => ({ window, pass: 'pending' as const })),
    ...plan.rescan.map((window) => ({ window, pass: 'rescan' as const })),
  ];
  let imported = 0;
  let complete = true;

  for (const { window, pass } of steps) {
    if (!canAfford()) {
      return { imported, complete: false };
    }

    const outcome = await runWindow(window, pass);
    imported += outcome.imported;

    if (!outcome.complete) {
      if (pass !== 'pending') {
        return { imported, complete: false };
      }

      complete = false;
    }
  }

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

/**
 * The answer for a span the read found too full: its first half, to read instead. A span
 * of one millisecond cannot be split, so it stops the walk (logged under `stuckCode`)
 * rather than skip records it cannot see.
 */
export const splitOrStop = (span: WalkWindow, stuckCode: string): SpanRead<never> | undefined => {
  const half = halfOf(span);

  if (half === undefined) {
    logWalkStop(stuckCode);

    return undefined;
  }

  return { kind: 'split', half };
};

type SpanStep = { next: WalkWindow; imported: number };

/**
 * Handle what one read gave. A split moves to the half and imports nothing. A page is
 * committed, and the walk goes on from where the span ended, twice as wide, because a
 * stretch that fit one page is likely to fit a longer one. `undefined` is a commit that
 * stopped the walk.
 */
const stepAfterRead = <Page>(input: {
  read: SpanRead<Page>;
  span: WalkWindow;
  window: WalkWindow;
  commit: (span: WalkWindow, page: Page) => Promise<number | undefined>;
}): Promise<SpanStep | undefined> =>
  match(input.read)
    .returnType<Promise<SpanStep | undefined>>()
    .with({ kind: 'split' }, async ({ half }) => ({ next: half, imported: 0 }))
    .with({ kind: 'page' }, async ({ page }) =>
      foldMap(maybe(await input.commit(input.span, page)), (imported) => ({
        next: nextSpanAfter(input.span, input.window),
        imported,
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
 * `commit` (the rows it imported, or `undefined` for a stop, which leaves the span
 * uncommitted). Either stop reports the window incomplete with what was committed, and the
 * walk's marks, which only a commit moves, stay where the last committed span left them.
 */
export const walkSpans = async <Page>(input: {
  window: WalkWindow;
  read: (span: WalkWindow) => Promise<SpanRead<Page> | undefined>;
  commit: (span: WalkWindow, page: Page) => Promise<number | undefined>;
}): Promise<WalkResult> => {
  const { window, read, commit } = input;
  let imported = 0;
  let span = window;

  while (span.start < window.end) {
    const spanRead = await read(span);

    if (spanRead === undefined) {
      return { imported, complete: false };
    }

    const step = await stepAfterRead({ read: spanRead, span, window, commit });

    if (step === undefined) {
      return { imported, complete: false };
    }

    imported += step.imported;
    span = step.next;
  }

  return { imported, complete: true };
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
