import { match } from 'ts-pattern';
import maybe, { foldMap } from 'fnts/maybe';

import {
  type DepthGuard,
  type DepthProbe,
  hasDepthLapsed,
  isDepthMarginCapped,
  knownStartOf,
  type LapsedRange,
  lapsedRangeOf,
  MAX_DEPTH_LAPSES,
  MAX_DEPTH_REFUSALS,
  type Narrowed,
  narrowLapsedStart,
  narrowRefusedStart,
  rememberServedStart,
  widenDepthMargin,
} from './binance.history-depth';
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
type TotalPaged<Row> =
  | { kind: 'rows'; rows: Row[]; unreadable: UnreadableRow[] }
  | { kind: 'split'; half: WalkWindow }
  | { kind: 'drift' };

/**
 * Read one series of one span, paged by `current` against the `total` the server reports. Every
 * page is a call of the lane, spent one at a time and refreshed from the response, after the
 * shared gate. A full page with more rows behind it in a span that can be halved (`half`, asked
 * once the first page is read) is answered with the half, never paged through, so a heavy span
 * is cut to pieces that fit one page; a span that cannot be halved (one millisecond, `half`
 * answers `undefined`) is paged by `current`, at most
 * `maxPages` pages. The rows are trusted only when the rows counted (`gathered`, every row of
 * any asset) are the total: a short page that leaves them short of it, a count above it, or
 * `maxPages` pages that did not reach it are a drift. `{ total: 5 }` with no rows is a short
 * page of none, so it is a drift too. `undefined` is a clean stop: the next page is unaffordable
 * (with `keep` calls left after it), or `fetchPage` answered `undefined` (it makes no request, once
 * the gate let it go), rather than partial rows the caller must not commit.
 */
export const fetchAllByTotal = async <Row>(input: {
  run: BinanceHistoryRun;
  lane: BudgetLane;
  cost: CallCost;
  keep: number;
  half: () => WalkWindow | undefined;
  maxPages: number;
  fetchPage: (current: number) => Promise<TotalPage<Row> | undefined>;
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

    if (page === undefined) {
      return undefined;
    }

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

    const halved = half();

    if (halved !== undefined) {
      return { kind: 'split', half: halved };
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
  tally: DepthTally;
};

/** The refusals and lapses one span read has answered so far, across its series. */
type DepthTally = { refusals: number; lapses: number };

/**
 * What follows a narrowing: `retry` once `depth.memory` holds the start to read from, `below` when
 * the span holds nothing Binance keeps, `undefined` for a clean stop (a limit of one span read,
 * or a request the budget cannot afford).
 */
type AfterDepth = { kind: 'retry' } | { kind: 'below' } | undefined;

/**
 * Narrow with the requests of the lane: one request of the lane for each start asked, refused ones
 * too, and none that leaves the series' own read unaffordable. The start found is remembered with
 * the clock of the request that served it.
 */
const narrowDepth = async <Series extends string, Row>(
  input: SeriesDepth<Series, Row>,
  narrow: (probe: DepthProbe) => Promise<Narrowed | undefined>,
): Promise<AfterDepth> => {
  const { run, lane, cost, name, keep, fetchPage, depth } = input;
  const lastServed: { atMs: number | undefined } = { atMs: undefined };
  const narrowed = await narrow(async (startMs) => {
    if (!run.budget.canAfford(lane, cost, keep + 1)) {
      return undefined;
    }

    await run.gate.wait();
    const sentAtMs = depth.nowMs();

    try {
      run.budget.record(lane, await fetchPage(name, { start: startMs, end: startMs + 1 }, 1));
      lastServed.atMs = sentAtMs;

      return true;
    } catch (error) {
      if (!depth.isRefusal(error)) {
        throw error;
      }

      run.budget.record(lane, REFUSED_CALL);

      return false;
    }
  });

  return match(narrowed)
    .returnType<AfterDepth>()
    .with(undefined, () => undefined)
    .with({ kind: 'floor' }, () => ({ kind: 'below' }))
    .with({ kind: 'start' }, ({ startMs }) => {
      rememberServedStart(depth.memory, { startMs, servedAtMs: lastServed.atMs });

      return { kind: 'retry' };
    })
    .exhaustive();
};

/**
 * What follows a start Binance refused (`refusedMs`). A read from a start known to be served
 * began at it moved on with the clock, and Binance's depth passed it meanwhile: a request that
 * reached Binance later than the one that found the start, or a type that keeps less. The margin
 * is widened and the read goes again, with no request beyond it, until the margin is at its cap;
 * a refusal at the cap, or with no start known to be served, is narrowed from the refused start
 * toward the end of the span (see `narrowRefusedStart`). The `MAX_DEPTH_REFUSALS`-th refusal of
 * one span read is a clean stop.
 */
const narrowAfterRefusal = async <Series extends string, Row>(
  input: SeriesDepth<Series, Row> & { refusedMs: number },
): Promise<AfterDepth> => {
  const { run, lane, span, depth, tally, refusedMs } = input;

  run.budget.record(lane, REFUSED_CALL);
  tally.refusals += 1;

  if (tally.refusals >= MAX_DEPTH_REFUSALS) {
    return undefined;
  }

  if (depth.memory.servedAtMs !== undefined && !isDepthMarginCapped(depth.memory)) {
    widenDepthMargin(depth.memory);

    return { kind: 'retry' };
  }

  return narrowDepth(input, (probe) =>
    narrowRefusedStart({ refusedMs, endMs: span.end, floorMs: depth.floorMs(), probe }),
  );
};

/**
 * What follows a lapse: the start the memory holds was served longer ago than it is moved on with
 * the clock for. The start is found again between the one the memory holds and the one it would
 * move on to (see `narrowLapsedStart`). A second lapse of one span read is a clean stop.
 */
const narrowAfterLapse = async <Series extends string, Row>(
  input: SeriesDepth<Series, Row> & { range: LapsedRange },
): Promise<AfterDepth> => {
  const { span, depth, tally, range } = input;

  tally.lapses += 1;

  if (tally.lapses > MAX_DEPTH_LAPSES) {
    return undefined;
  }

  return narrowDepth(input, (probe) =>
    narrowLapsedStart({ ...range, endMs: span.end, floorMs: depth.floorMs(), probe }),
  );
};

/**
 * Whether the span lies below the ground the memory knows is refused: the memory moved on by the
 * time that passed (a lapsed memory is not moved, see `DEPTH_EXTRAPOLATION_MAX_MS`: only the
 * start it holds is known to be refused below).
 */
const isBelowKnownStart = (span: WalkWindow, depth: DepthGuard | undefined): boolean => {
  const knownMs = foldMap(maybe(depth), (guard) => {
    const nowMs = guard.nowMs();

    return hasDepthLapsed(guard.memory, nowMs)
      ? guard.memory.startMs
      : knownStartOf(guard.memory, nowMs);
  });

  return knownMs !== undefined && knownMs >= span.end;
};

/**
 * Where a series is read from as of now: the span's start, or the start known to be served when
 * that is later (see `knownStartOf`; the clock moves it on). Without a `depth` it is the span's.
 */
const readStartOf = (span: WalkWindow, depth: DepthGuard | undefined): number =>
  Math.max(
    span.start,
    foldMap(maybe(depth), (guard) => knownStartOf(guard.memory, guard.nowMs())) ?? span.start,
  );

/** A memory that lapsed, and the ground it leaves open. */
type Lapse = { depth: DepthGuard; range: LapsedRange };

const lapseOf = (depth: DepthGuard | undefined): Lapse | undefined =>
  foldMap(maybe(depth), (guard) =>
    foldMap(maybe(lapsedRangeOf(guard.memory, guard.nowMs())), (range) => ({
      depth: guard,
      range,
    })),
  );

/** How one try at a series ended: read, or stopped by a lapse or a refused start. */
type Attempt<Row> =
  | { kind: 'read'; paged: TotalPaged<Row> | undefined }
  | { kind: 'lapsed'; lapse: Lapse }
  | { kind: 'refused'; depth: DepthGuard; startMs: number };

/**
 * One try at a series, from the start the memory holds. The start is fixed once the run gate has
 * let the first page go, not before: the gate may wait for hours (a cooldown), and Binance's depth
 * moves with the clock meanwhile. A memory that lapsed by then makes no request (see
 * `DEPTH_EXTRAPOLATION_MAX_MS`). The start is kept below the end of the span, since no request has
 * `startTime` at or past `endTime`.
 */
const attemptSeries = async <Series extends string, Row>(
  input: SeriesRequest<Series, Row> & {
    name: Series;
    keep: number;
    depth: DepthGuard | undefined;
  },
): Promise<Attempt<Row>> => {
  const { run, lane, cost, span, name, keep, maxPages, fetchPage, depth } = input;
  const reading = { start: span.start, end: span.end };
  const lapsed: { found: Lapse | undefined } = { found: undefined };

  try {
    const paged = await fetchAllByTotal<Row>({
      run,
      lane,
      cost,
      keep,
      // The half starts where the span does: the ground the read skipped is committed with it.
      half: () => foldMap(maybe(halfOf(reading)), (half) => ({ start: span.start, end: half.end })),
      maxPages,
      fetchPage: async (current) => {
        if (current === 1) {
          lapsed.found = lapseOf(depth);

          if (lapsed.found !== undefined) {
            return undefined;
          }

          reading.start = Math.min(readStartOf(span, depth), span.end - 1);
        }

        return fetchPage(name, { ...reading }, current);
      },
    });

    return paged === undefined && lapsed.found !== undefined
      ? { kind: 'lapsed', lapse: lapsed.found }
      : { kind: 'read', paged };
  } catch (error) {
    if (depth === undefined || !depth.isRefusal(error)) {
      throw error;
    }

    return { kind: 'refused', depth, startMs: reading.start };
  }
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
    tally: DepthTally;
  },
): Promise<TotalPaged<Row> | { kind: 'below' } | undefined> => {
  for (;;) {
    if (isBelowKnownStart(input.span, input.depth)) {
      return { kind: 'below' };
    }

    const attempt = await attemptSeries(input);

    if (attempt.kind === 'read') {
      return attempt.paged;
    }

    const next =
      attempt.kind === 'refused'
        ? await narrowAfterRefusal({ ...input, depth: attempt.depth, refusedMs: attempt.startMs })
        : await narrowAfterLapse({ ...input, ...attempt.lapse });

    if (next?.kind !== 'retry') {
      return next;
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
 * where it does, moved on with the clock until it has lapsed. A span with nothing Binance keeps
 * in it reads no series after the one that found it, so the page holds the rows read before it.
 * The `MAX_DEPTH_REFUSALS`-th refusal and the second lapse of one span read are a clean stop: the
 * span stays unread, never read as empty. The requests of a span read on the depth are bounded
 * in `MAX_DEPTH_LAPSES`.
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
  const tally: DepthTally = { refusals: 0, lapses: 0 };

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
        tally,
      });

      const ended = match(paged)
        .returnType<{ read: SpanRead<SeriesSpan<Series, Row>> | undefined } | undefined>()
        .with(undefined, () => ({ read: undefined }))
        .with({ kind: 'split' }, ({ half }) => ({ read: { kind: 'split', half } }))
        .with({ kind: 'below' }, () => ({ read: { kind: 'page', page: result } }))
        .with({ kind: 'drift' }, () => {
          result.drifted.push(name);

          return undefined;
        })
        .with({ kind: 'rows' }, ({ rows, unreadable }) => {
          result.read.push({ series: name, rows, unreadable });

          return undefined;
        })
        .exhaustive();

      if (ended !== undefined) {
        return ended.read;
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
