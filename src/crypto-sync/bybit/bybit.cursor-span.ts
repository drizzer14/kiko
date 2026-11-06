import { rethrow } from 'fnts';
import { halfOf, type SpanRead, type WalkWindow } from '@kiko/crypto-sync/exchange/walk';

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
 * Every reading of a row's window field lies outside the reach. A row with no reading (a pending
 * row with no time) is in no window, so it never shows a drift.
 */
const isOutsideReach = (times: readonly number[], reach: WalkWindow): boolean =>
  times.length > 0 && times.every((time) => time < reach.start || time > reach.end);

/**
 * Read one span of one series by following `nextPageCursor` to its end, at the `walkSpans` read
 * seam. The cursor lives only inside this read and is never stored. Every page is one call of the
 * lane, asked of the budget first (with `keep` calls left after it) and paced by the shared gate.
 *
 * A span ends at a page with no row (whatever its cursor says), or at an absent or empty cursor.
 * A cursor already asked, or a row outside the `reach` of the span by all its readings, is a
 * drift. `reachOf` is the caller's because the window field differs by series: a deposit's has no
 * end, and a withdrawal's has two readings.
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
  onFirstReadStuck?: (span: WalkWindow) => void;
}): Promise<SpanRead<CursorSpanPage<Row>> | undefined> => {
  const { run, lane, span, keep, minSplitMs, readPage, timesOf, reachOf, onFirstReadStuck } = input;
  const reach = reachOf(span);
  const asked = new Set<string>();
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

    rows.push(...page.rows);

    const next = page.nextPageCursor;

    if (page.rows.length === 0 || next === undefined || next === '') {
      return { kind: 'page', page: { kind: 'rows', rows } };
    }

    if (asked.has(next)) {
      return { kind: 'page', page: { kind: 'drift' } };
    }

    asked.add(next);
    cursor = next;
  }
};
