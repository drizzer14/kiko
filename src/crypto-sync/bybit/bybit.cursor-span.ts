import { rethrow } from 'fnts';
import {
  halfOf,
  type SpanRead,
  type WalkPass,
  type WalkWindow,
  type WindowOutcome,
} from '@kiko/crypto-sync/exchange/walk';
import maybe, { foldMap } from 'fnts/maybe';

import {
  type BybitHistoryRun,
  type BybitLane,
  NO_WEIGHTS,
  recordBybitFailedCall,
} from './bybit.history-budget';

type CursorPage<Row> = { rows: Row[]; nextPageCursor: string | undefined };

/**
 * What a span gave: all its rows, or a drift (a repeated cursor, or a row the span cannot hold),
 * after which none of the rows read can be trusted.
 */
type CursorSpanPage<Row> = { kind: 'rows'; rows: Row[] } | { kind: 'drift' };

/**
 * What a forward or re-scan window that stopped after some of its spans committed hands the next
 * run: the span it wanted to read next, without the resume. The shared walk drops a resume on
 * those passes because their cursor keeps what they read, so with the resume the next run would
 * start again from the whole window and halve again, one halving per run. The cursor moves forward
 * only, so the plain hint is found again, and it only narrows a read, so it skips no ground. A hint
 * that ends at or past the window's end is no narrowing: the window end moves with the clock, so
 * the next run would clip its first span to an end already behind it.
 */
export const plainHintOf = (
  pass: WalkPass,
  window: WalkWindow,
  outcome: WindowOutcome,
): WindowOutcome => {
  const { hint } = outcome;

  if ((pass !== 'forward' && pass !== 'rescan') || hint?.resume === undefined) {
    return outcome;
  }

  return {
    ...outcome,
    hint: hint.end >= window.end ? null : { start: hint.resume.from, end: hint.end },
  };
};

/**
 * Every reading of a row's window field lies outside the reach. A row with no reading (a pending
 * row with no time) is in no window, so it never shows a drift.
 */
const isOutsideReach = (times: readonly number[], reach: WalkWindow): boolean =>
  times.length > 0 && times.every((time) => time < reach.start || time > reach.end);

/**
 * The keys of the pages of one span, for a series that keys its rows. It is given each page in
 * turn and says whether the page holds only keys an earlier page held: false for a series with no
 * keys, and for a page with a key it has not seen. A row with no key is never a new one.
 */
const heldKeysOf = <Row>(keyOf: ((row: Row) => string | undefined) | undefined) => {
  const held = new Set<string>();

  return (rows: readonly Row[]): boolean => {
    const keys = rows.flatMap((row) => foldMap(maybe(keyOf?.(row)), (key) => [key]) ?? []);
    const hasNewKey = keys.some((key) => !held.has(key));

    for (const key of keys) {
      held.add(key);
    }

    return keyOf !== undefined && !hasNewKey;
  };
};

/**
 * Read one span of one series by following `nextPageCursor` to its end, at the `walkSpans` read
 * seam. The cursor lives only inside this read and is never stored. Every page is one call of the
 * lane, asked of the budget first (with `keep` calls left after it) and paced by the shared gate.
 *
 * A span ends at a page with no row (whatever its cursor says), or at an absent or empty cursor.
 * A cursor already asked, or a row outside the `reach` of the span by all its readings, is a
 * drift. `reachOf` is the caller's because the window field differs by series: a deposit's has no
 * end, and a withdrawal's has two readings. A series with a key per row (`keyOf`) ends the span at
 * a repeated cursor when the page holds no new key, because every key was on an earlier page (a
 * page past the end answers with the last rows again), and keeps the drift for a page that has one.
 *
 * When the budget is short before the end of the span, the rows read so far are dropped:
 * - before the first page: `undefined`, so a run with no calls left never narrows a hint;
 * - after a page, a span wider than `minSplitMs`: its first half, for `walkSpans` to keep as a
 *   hint;
 * - after a page, a span of `minSplitMs` or less: `undefined`. A caller that asks for it is told
 *   (`onFirstReadStuck`, given only for the span that is the pass's first read), because a full
 *   lane did not hold that span, so it is too dense to commit.
 */
export const readCursorSpan = async <Row>(input: {
  run: BybitHistoryRun;
  lane: BybitLane;
  span: WalkWindow;
  keep: number;
  minSplitMs: number;
  readPage: (cursor: string | undefined) => Promise<CursorPage<Row>>;
  timesOf: (row: Row) => readonly number[];
  reachOf: (span: WalkWindow) => WalkWindow;
  keyOf?: (row: Row) => string | undefined;
  onFirstReadStuck?: (span: WalkWindow) => void;
}): Promise<SpanRead<CursorSpanPage<Row>> | undefined> => {
  const { run, lane, span, keep, minSplitMs, readPage, timesOf, reachOf, onFirstReadStuck } = input;
  const reach = reachOf(span);
  const asked = new Set<string>();
  const keysOfPages = heldKeysOf(input.keyOf);
  const rows: Row[] = [];
  let cursor: string | undefined;
  let hasReadPage = false;

  const readShort = (): SpanRead<CursorSpanPage<Row>> | undefined => {
    if (!hasReadPage) {
      return undefined;
    }

    const half = span.end - span.start > minSplitMs ? halfOf(span) : undefined;

    if (half !== undefined) {
      return { kind: 'split', half };
    }

    onFirstReadStuck?.(span);

    return undefined;
  };

  while (true) {
    if (!run.budget.canAfford(lane, NO_WEIGHTS, keep)) {
      return readShort();
    }

    await run.gate.wait();
    const page = await readPage(cursor).catch(rethrow(() => recordBybitFailedCall(run, lane)));
    run.budget.record(lane, NO_WEIGHTS);
    hasReadPage = true;

    if (page.rows.some((row) => isOutsideReach(timesOf(row), reach))) {
      return { kind: 'page', page: { kind: 'drift' } };
    }

    const isOnlyHeldKeys = keysOfPages(page.rows);

    rows.push(...page.rows);

    const next = page.nextPageCursor;

    if (page.rows.length === 0 || next === undefined || next === '') {
      return { kind: 'page', page: { kind: 'rows', rows } };
    }

    if (asked.has(next)) {
      return isOnlyHeldKeys
        ? { kind: 'page', page: { kind: 'rows', rows } }
        : { kind: 'page', page: { kind: 'drift' } };
    }

    asked.add(next);
    cursor = next;
  }
};
