import maybe, { foldMap } from 'fnts/maybe';

import {
  HISTORY_TOTAL_PAGE_SIZE,
  type TotalPage,
  type UnreadableRow,
} from './binance.history-client';
import { BinanceRateLimitError } from './binance.client';
import { halfOf, type SpanRead, type WalkWindow } from './binance.history-walk';
import type { BinanceHistoryRun, BudgetLane, CallCost } from './binance.history-budget';
import { type DepthGuard, MAX_DEPTH_REFUSALS, narrowRefusedStart } from './binance.history-depth';

/**
 * What one series gave for a span: all its rows (and the rows the client could not read), the
 * half to read instead (the span holds more rows than one page shows), or a drift (the rows the
 * server counts and the rows it showed disagree, so nothing of it can be trusted).
 */
type TotalPaged<Row> =
  | { kind: 'rows'; rows: Row[]; unreadable: UnreadableRow[] }
  | { kind: 'split'; half: WalkWindow }
  | { kind: 'drift' };

/**
 * Read one series of one span, paged by `current` against the `total` the server reports. Every
 * page is a call of the lane, spent one at a time and refreshed from the response, after the
 * shared gate. A full page with more rows behind it in a span that can be halved (`half`) is
 * answered with the half, never paged through, so a heavy span is cut to pieces that fit one
 * page; a span that cannot be halved (one millisecond) is paged by `current`, at most
 * `maxPages` pages. The rows are trusted only when the rows counted (`gathered`, every row of
 * any asset) are the total: a short page that leaves them short of it, a count above it, or
 * `maxPages` pages that did not reach it are a drift. `{ total: 5 }` with no rows is a short
 * page of none, so it is a drift too. `undefined` is a clean stop: the next page is unaffordable
 * (with `keep` calls left after it), rather than partial rows the caller must not commit.
 */
export const fetchAllByTotal = async <Row>(input: {
  run: BinanceHistoryRun;
  lane: BudgetLane;
  cost: CallCost;
  keep: number;
  half: WalkWindow | undefined;
  maxPages: number;
  fetchPage: (current: number) => Promise<TotalPage<Row>>;
}): Promise<TotalPaged<Row> | undefined> => {
  const { run, lane, cost, keep, half, maxPages, fetchPage } = input;
  const rows: Row[] = [];
  const unreadable: UnreadableRow[] = [];
  let counted = 0;

  for (let current = 1; current <= maxPages; current += 1) {
    if (!run.budget.canAfford(lane, cost, keep)) {
      return undefined;
    }

    await run.gate.wait();
    const page = await fetchPage(current);
    run.budget.record(lane, page);
    rows.push(...page.rows);
    unreadable.push(...page.unreadable);
    counted += page.gathered;

    if (counted > page.total) {
      return { kind: 'drift' };
    }

    if (counted === page.total) {
      return { kind: 'rows', rows, unreadable };
    }

    if (page.gathered < HISTORY_TOTAL_PAGE_SIZE) {
      return { kind: 'drift' };
    }

    if (half !== undefined) {
      return { kind: 'split', half };
    }
  }

  return { kind: 'drift' };
};

/** The rows of every series of a span read whole, and the series whose pages drifted. */
export type SeriesSpan<Series, Row> = {
  read: { series: Series; rows: Row[]; unreadable: UnreadableRow[] }[];
  drifted: Series[];
};

/** A refused request still counts as a call of the lane; Binance gave no weight reading for it. */
const REFUSED_CALL = { usedUidWeight1m: undefined, usedIpWeight1m: undefined };

type SeriesRequest<Series extends string, Row> = {
  run: BinanceHistoryRun;
  lane: BudgetLane;
  cost: CallCost;
  span: WalkWindow;
  maxPages: number;
  fetchPage: (series: Series, span: WalkWindow, current: number) => Promise<TotalPage<Row>>;
};

type SeriesDepth<Series extends string, Row> = SeriesRequest<Series, Row> & {
  name: Series;
  keep: number;
  depth: DepthGuard;
  refusals: { count: number };
};

/**
 * What follows a start Binance refused: `retry` once the start the series is read from is in
 * `depth.memory`, `below` when the span holds nothing Binance keeps, `undefined` for a clean stop.
 * One request of the lane is spent for each start asked (see `narrowRefusedStart`), refused ones
 * too, none past `MAX_DEPTH_REFUSALS` refusals of one span read, and none that leaves the series'
 * own read unaffordable.
 */
const narrowAfterRefusal = async <Series extends string, Row>(
  input: SeriesDepth<Series, Row> & { refusedMs: number },
): Promise<{ kind: 'retry' } | { kind: 'below' } | undefined> => {
  const { run, lane, cost, span, name, keep, fetchPage, depth, refusals } = input;

  run.budget.record(lane, REFUSED_CALL);
  refusals.count += 1;

  if (refusals.count > MAX_DEPTH_REFUSALS) {
    return undefined;
  }

  const narrowed = await narrowRefusedStart({
    refusedMs: input.refusedMs,
    endMs: span.end,
    floorMs: depth.floorMs(),
    probe: async (startMs) => {
      if (!run.budget.canAfford(lane, cost, keep + 1)) {
        return undefined;
      }

      await run.gate.wait();

      try {
        run.budget.record(lane, await fetchPage(name, { start: startMs, end: startMs + 1 }, 1));

        return true;
      } catch (error) {
        if (!depth.isRefusal(error)) {
          throw error;
        }

        run.budget.record(lane, REFUSED_CALL);

        return false;
      }
    },
  });

  if (narrowed === undefined) {
    return undefined;
  }

  if (narrowed.kind === 'floor') {
    return { kind: 'below' };
  }

  depth.memory.startMs = Math.max(depth.memory.startMs ?? narrowed.startMs, narrowed.startMs);

  return { kind: 'retry' };
};

/**
 * One series of a span, from the oldest start Binance is known to serve (`depth`, when the lane
 * has a depth to be refused at). A start Binance refuses as older than it keeps is narrowed to
 * the start it serves and the series is read again from it; the ground before that start is read
 * as empty, and `depth.memory` holds the start for the series and the spans that follow. A series
 * is trusted only once read whole, so a refused one starts again at the narrowed start and keeps
 * no page of its first try. `below` is a span with nothing Binance keeps in it; `undefined` is a
 * clean stop, such as an unaffordable request.
 */
const readSeries = async <Series extends string, Row>(
  input: SeriesRequest<Series, Row> & {
    name: Series;
    keep: number;
    depth: DepthGuard | undefined;
    refusals: { count: number };
  },
): Promise<TotalPaged<Row> | { kind: 'below' } | undefined> => {
  const { run, lane, cost, span, name, keep, maxPages, fetchPage, depth } = input;

  for (;;) {
    const startMs = Math.max(span.start, depth?.memory.startMs ?? span.start);

    if (startMs >= span.end) {
      return { kind: 'below' };
    }

    const reading = { start: startMs, end: span.end };

    try {
      return await fetchAllByTotal<Row>({
        run,
        lane,
        cost,
        keep,
        // The half starts where the span does: the ground the read skipped is committed with it.
        half: foldMap(maybe(halfOf(reading)), (half) => ({ start: span.start, end: half.end })),
        maxPages,
        fetchPage: (current) => fetchPage(name, reading, current),
      });
    } catch (error) {
      if (depth === undefined || !depth.isRefusal(error)) {
        throw error;
      }

      const next = await narrowAfterRefusal({ ...input, depth, refusedMs: startMs });

      if (next === undefined || next.kind === 'below') {
        return next;
      }
    }
  }
};

/**
 * Read one span in every series given, one after the other: the likely dense series first, so a
 * span that is too full is halved before the other series are paid for. The span is entered only
 * when every series fits beside the `keep` calls (no request otherwise), and a page of one series
 * is spent only when the calls of the series after it still fit, so a read never pays for part of
 * the span and gives up. The first series that splits answers the whole span with the half; a
 * series that drifted is named, and the others keep their rows. A rate limit is handed to
 * `onRateLimit` (which sets the cooldown) and ends the read; `undefined` is a clean stop.
 *
 * With a `depth`, a start Binance refuses as older than it keeps moves up to the start it serves
 * (see `readSeries`): the series already read keep their rows, and the series after them start
 * where it does. A span with nothing Binance keeps in it reads no series after the one that
 * found it, so the page holds the rows read before it. A read refused more than
 * `MAX_DEPTH_REFUSALS` times is a clean stop: the span stays unread, never read as empty.
 */
export const readSeriesSpan = async <Series extends string, Row>(
  input: SeriesRequest<Series, Row> & {
    keep: number;
    series: readonly Series[];
    depth?: DepthGuard;
    onRateLimit: (error: BinanceRateLimitError) => void;
  },
): Promise<SpanRead<SeriesSpan<Series, Row>> | undefined> => {
  const { run, lane, cost, keep, series, depth, onRateLimit } = input;
  const result: SeriesSpan<Series, Row> = { read: [], drifted: [] };
  const refusals = { count: 0 };

  if (!run.budget.canAfford(lane, cost, keep + series.length - 1)) {
    return undefined;
  }

  try {
    for (const [index, name] of series.entries()) {
      const paged = await readSeries<Series, Row>({
        ...input,
        name,
        keep: keep + series.length - 1 - index,
        depth,
        refusals,
      });

      if (paged === undefined) {
        return undefined;
      }

      if (paged.kind === 'split') {
        return { kind: 'split', half: paged.half };
      }

      if (paged.kind === 'below') {
        break;
      }

      if (paged.kind === 'drift') {
        result.drifted.push(name);
      } else {
        result.read.push({ series: name, rows: paged.rows, unreadable: paged.unreadable });
      }
    }
  } catch (error) {
    if (error instanceof BinanceRateLimitError) {
      onRateLimit(error);

      return undefined;
    }

    throw error;
  }

  return { kind: 'page', page: result };
};
