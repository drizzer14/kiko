import {
  HISTORY_TOTAL_PAGE_SIZE,
  type TotalPage,
  type UnreadableRow,
} from './binance.history-client';
import { BinanceRateLimitError } from './binance.client';
import { halfOf, type SpanRead, type WalkWindow } from './binance.history-walk';
import type { BinanceHistoryRun, BudgetLane, CallCost } from './binance.history-budget';

/**
 * What one series gave for a span: all its rows (and the rows the client could not read), the
 * half to read instead (the span holds more rows than one page shows), or a drift (the rows the
 * server counts and the rows it showed disagree, so nothing of it can be trusted).
 */
export type TotalPaged<Row> =
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

/**
 * Read one span in every series given, one after the other: the likely dense series first, so a
 * span that is too full is halved before the other series are paid for. The span is entered only
 * when every series fits beside the `keep` calls (no request otherwise), and a page of one series
 * is spent only when the calls of the series after it still fit, so a read never pays for part of
 * the span and gives up. The first series that splits answers the whole span with the half; a
 * series that drifted is named, and the others keep their rows. A rate limit is handed to
 * `onRateLimit` (which sets the cooldown) and ends the read; `undefined` is a clean stop.
 */
export const readSeriesSpan = async <Series extends string, Row>(input: {
  run: BinanceHistoryRun;
  lane: BudgetLane;
  cost: CallCost;
  span: WalkWindow;
  keep: number;
  series: readonly Series[];
  maxPages: number;
  fetchPage: (series: Series, span: WalkWindow, current: number) => Promise<TotalPage<Row>>;
  onRateLimit: (error: BinanceRateLimitError) => void;
}): Promise<SpanRead<SeriesSpan<Series, Row>> | undefined> => {
  const { run, lane, cost, span, keep, series, maxPages, fetchPage, onRateLimit } = input;
  const half = halfOf(span);
  const result: SeriesSpan<Series, Row> = { read: [], drifted: [] };

  if (!run.budget.canAfford(lane, cost, keep + series.length - 1)) {
    return undefined;
  }

  try {
    for (const [index, name] of series.entries()) {
      const paged = await fetchAllByTotal<Row>({
        run,
        lane,
        cost,
        keep: keep + series.length - 1 - index,
        half,
        maxPages,
        fetchPage: (current) => fetchPage(name, span, current),
      });

      if (paged === undefined) {
        return undefined;
      }

      if (paged.kind === 'split') {
        return { kind: 'split', half: paged.half };
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
