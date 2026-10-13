import { match } from 'ts-pattern';
import maybe, { foldMap } from 'fnts/maybe';

import {
  type DepthGuard,
  type DepthMemory,
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

/** Ground a series left owed in itself alone: a read of it in that series settles it. */
export type SeriesOwed<Series> = { series: Series; window: WalkWindow };

/**
 * The rows of every series of a span read whole, the series whose pages drifted, and the ground a
 * series left owed in itself (`owed`): a series whose read began above the start of the span, so
 * the ground between is not known to be refused, and a series that could not be read (the lane's
 * calls ran out while it narrowed, or it reached its limits). Only a lane with a depth owes, so a
 * lane without one has none.
 */
export type SeriesSpan<Series, Row> = {
  read: { series: Series; rows: Row[]; unreadable: UnreadableRow[] }[];
  drifted: Series[];
  owed?: SeriesOwed<Series>[];
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

/** A depth guard bound to the memory of the one series that is read. */
type SeriesGuard = Omit<DepthGuard, 'memoryOf'> & { memory: DepthMemory };

/** The refusals and lapses one series has answered so far in one span read. */
type DepthTally = { refusals: number; lapses: number };

type SeriesDepth<Series extends string, Row> = SeriesRequest<Series, Row> & {
  name: Series;
  keep: number;
  depth: SeriesGuard;
  tally: DepthTally;
};

/**
 * What one series gave for a span, as a series reads it: what a try at it gave, with the ground
 * its read began above (`skipped`, owed), or a span with nothing Binance keeps in it (`below`).
 */
type SeriesRead<Row> =
  | (Extract<TotalPaged<Row>, { kind: 'rows' }> & { skipped: WalkWindow | undefined })
  | Exclude<TotalPaged<Row>, { kind: 'rows' }>
  | { kind: 'below'; skipped: WalkWindow | undefined };

/**
 * What follows a narrowing: `retry` once `depth.memory` holds the start to read from, `done` with
 * what the series gave, or `undefined` for a clean stop (a limit of one series' read, or a request
 * the budget cannot afford).
 */
type AfterDepth<Row> = { kind: 'retry' } | { kind: 'done'; read: SeriesRead<Row> | undefined };

const CLEAN_STOP: AfterDepth<never> = { kind: 'done', read: undefined };

/**
 * Narrow with the requests of the lane: one request of the lane for each start asked, refused ones
 * too, and none that leaves the series' own read unaffordable. The start found is remembered with
 * the clock of the request that served it.
 */
const narrowDepth = async <Series extends string, Row>(
  input: SeriesDepth<Series, Row>,
  narrow: (probe: DepthProbe) => Promise<Narrowed | undefined>,
): Promise<AfterDepth<Row>> => {
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
    .returnType<AfterDepth<Row>>()
    .with(undefined, () => CLEAN_STOP)
    .with({ kind: 'floor' }, () => ({ kind: 'done', read: { kind: 'below', skipped: undefined } }))
    .with({ kind: 'start' }, ({ startMs }) => {
      rememberServedStart(depth.memory, { startMs, servedAtMs: lastServed.atMs });

      return { kind: 'retry' };
    })
    .exhaustive();
};

/**
 * What follows a start Binance refused (`refusedMs`). A read from a start known to be served
 * began at it moved on by the time that passed, and Binance's depth passed it meanwhile: a request
 * that reached Binance later than the one that found the start, or a depth that moved in a step.
 * The margin is widened and the read goes again, with no request beyond it, until the margin is at
 * its cap; a refusal at the cap, or with no start known to be served, is narrowed from the refused
 * start toward the end of the span (see `narrowRefusedStart`). The `MAX_DEPTH_REFUSALS`-th refusal
 * of one series in one span read is a clean stop.
 */
const narrowAfterRefusal = async <Series extends string, Row>(
  input: SeriesDepth<Series, Row> & { refusedMs: number },
): Promise<AfterDepth<Row>> => {
  const { run, lane, span, depth, tally, refusedMs } = input;

  run.budget.record(lane, REFUSED_CALL);
  tally.refusals += 1;

  if (tally.refusals >= MAX_DEPTH_REFUSALS) {
    return CLEAN_STOP;
  }

  if (depth.memory.servedAtMs !== undefined && !isDepthMarginCapped(depth.memory)) {
    widenDepthMargin(depth.memory);

    return { kind: 'retry' };
  }

  return narrowDepth(input, (probe) =>
    narrowRefusedStart({
      refusedMs,
      endMs: span.end,
      floorMs: depth.floorMs(),
      hintMs: depth.hintMs(),
      probe,
    }),
  );
};

/**
 * What follows a lapse: the start the memory holds was served longer ago than it is moved on with
 * the clock for. The start is found again between the one the memory holds and the one it would
 * move on to (see `narrowLapsedStart`). A second lapse of one series in one span read is a clean
 * stop.
 */
const narrowAfterLapse = async <Series extends string, Row>(
  input: SeriesDepth<Series, Row> & { range: LapsedRange },
): Promise<AfterDepth<Row>> => {
  const { span, depth, tally, range } = input;

  tally.lapses += 1;

  if (tally.lapses > MAX_DEPTH_LAPSES) {
    return CLEAN_STOP;
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
const isBelowKnownStart = (span: WalkWindow, depth: SeriesGuard | undefined): boolean => {
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
 * that is later (see `knownStartOf`; the time that passed moves it). Without a `depth` it is the
 * span's.
 */
const readStartOf = (span: WalkWindow, depth: SeriesGuard | undefined): number =>
  Math.max(
    span.start,
    foldMap(maybe(depth), (guard) => knownStartOf(guard.memory, guard.nowMs())) ?? span.start,
  );

/**
 * The ground of the span that lies below `toMs`, the start a series is read from (the end of the
 * span for a span read as below), and is not known to be refused: from the start the memory
 * holds, which was served, up to `toMs`. The depth may have stood still, so Binance may keep it.
 * A start the memory holds as refused is a bound, and nothing below it is owed.
 */
const skippedBandOf = (input: {
  span: WalkWindow;
  depth: SeriesGuard | undefined;
  toMs: number;
}): WalkWindow | undefined => {
  const { span, depth, toMs } = input;
  const servedMs = foldMap(maybe(depth), ({ memory }) =>
    foldMap(maybe(memory.servedAtMs), () => memory.startMs),
  );
  const fromMs = foldMap(maybe(servedMs), (startMs) => Math.max(span.start, startMs)) ?? toMs;

  return fromMs < toMs ? { start: fromMs, end: toMs } : undefined;
};

/** How one try at a series ended: read, or stopped by a lapse or a refused start. */
type Attempt<Row> =
  | { kind: 'read'; paged: TotalPaged<Row> | undefined; startMs: number }
  | { kind: 'lapsed'; depth: SeriesGuard; range: LapsedRange }
  | { kind: 'refused'; depth: SeriesGuard; startMs: number };

/**
 * One try at a series, from the start the memory holds. The start is fixed once the run gate has
 * let the first page go, not before: the gate may wait for hours (a cooldown), and Binance's depth
 * may have moved meanwhile. A memory that lapsed by then makes no request (see
 * `DEPTH_EXTRAPOLATION_MAX_MS`). The start is kept below the end of the span, since no request has
 * `startTime` at or past `endTime`.
 */
const attemptSeries = async <Series extends string, Row>(
  input: SeriesRequest<Series, Row> & {
    name: Series;
    keep: number;
    depth: SeriesGuard | undefined;
  },
): Promise<Attempt<Row>> => {
  const { run, lane, cost, span, name, keep, maxPages, fetchPage, depth } = input;
  const reading = { start: span.start, end: span.end };
  const lapsed: { found: LapsedRange | undefined } = { found: undefined };

  try {
    const paged = await fetchAllByTotal<Row>({
      run,
      lane,
      cost,
      keep,
      // The half starts where the span does, so it covers the ground this read began above.
      half: () => foldMap(maybe(halfOf(reading)), (half) => ({ start: span.start, end: half.end })),
      maxPages,
      fetchPage: async (current) => {
        if (current === 1) {
          lapsed.found = foldMap(maybe(depth), (guard) =>
            lapsedRangeOf(guard.memory, guard.nowMs()),
          );

          if (lapsed.found !== undefined) {
            return undefined;
          }

          reading.start = Math.min(readStartOf(span, depth), span.end - 1);
        }

        return fetchPage(name, { ...reading }, current);
      },
    });

    return paged === undefined && lapsed.found !== undefined && depth !== undefined
      ? { kind: 'lapsed', depth, range: lapsed.found }
      : { kind: 'read', paged, startMs: reading.start };
  } catch (error) {
    if (depth === undefined || !depth.isRefusal(error)) {
      throw error;
    }

    return { kind: 'refused', depth, startMs: reading.start };
  }
};

/** What a try at a series gave, with the ground its read began above. */
const readOf = <Row>(
  paged: TotalPaged<Row> | undefined,
  skipped: WalkWindow | undefined,
): SeriesRead<Row> | undefined => (paged?.kind === 'rows' ? { ...paged, skipped } : paged);

/**
 * One series of a span, from the oldest start Binance is known to serve it (`depth`, when the lane
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
    depth: SeriesGuard | undefined;
    tally: DepthTally;
  },
): Promise<SeriesRead<Row> | undefined> => {
  const { span, depth } = input;

  for (;;) {
    if (isBelowKnownStart(span, depth)) {
      return { kind: 'below', skipped: skippedBandOf({ span, depth, toMs: span.end }) };
    }

    const attempt = await attemptSeries(input);
    const next = await match(attempt)
      .returnType<Promise<AfterDepth<Row>>>()
      .with({ kind: 'read' }, async ({ paged, startMs }) => ({
        kind: 'done',
        read: readOf(paged, skippedBandOf({ span, depth, toMs: startMs })),
      }))
      .with({ kind: 'refused' }, (refusal) =>
        narrowAfterRefusal({ ...input, depth: refusal.depth, refusedMs: refusal.startMs }),
      )
      .with({ kind: 'lapsed' }, (lapse) =>
        narrowAfterLapse({ ...input, depth: lapse.depth, range: lapse.range }),
      )
      .exhaustive();

    if (next.kind === 'done') {
      return next.read;
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
 * With a `depth`, each series is read by itself: a start Binance refuses as older than it keeps
 * moves up to the start it serves for that series (see `readSeries`), and the series after it
 * start from their own, so a series that keeps less than the others narrows alone. The series
 * already read keep their rows. A span with nothing Binance keeps in it for a series reads no rows
 * of it and the others are read. The ground a series is read above is owed in that series
 * (`owed`), not read as empty, and so is the whole span of a series whose read stopped (the lane's
 * calls ran out while it narrowed, or it reached `MAX_DEPTH_REFUSALS` refusals or a second lapse),
 * never read as empty. A series costs at most the requests bounded in `MAX_DEPTH_REFUSALS` and
 * `MAX_DEPTH_LAPSES`, each spending the lane, and the series after it keep the calls reserved for
 * them. A lane without a depth reads every series or none.
 */
export const readSeriesSpan = async <Series extends string, Row>(
  input: SeriesRequest<Series, Row> & {
    keep: number;
    series: readonly Series[];
    depth?: DepthGuard;
    onRateLimit: (error: BinanceRateLimitError) => void;
  },
): Promise<SpanRead<SeriesSpan<Series, Row>> | undefined> => {
  const { run, lane, cost, span, keep, series, depth, onRateLimit } = input;
  const result: SeriesSpan<Series, Row> = { read: [], drifted: [] };
  const owed: SeriesOwed<Series>[] = [];

  if (!run.budget.canAfford(lane, cost, keep + series.length - 1)) {
    return undefined;
  }

  const oweIn = (name: Series, window: WalkWindow | undefined): void => {
    if (window !== undefined) {
      owed.push({ series: name, window });
    }
  };

  try {
    for (const [index, name] of series.entries()) {
      const paged = await readSeries<Series, Row>({
        ...input,
        name,
        keep: keep + series.length - 1 - index,
        depth: foldMap(maybe(depth), (guard) => ({ ...guard, memory: guard.memoryOf(name) })),
        tally: { refusals: 0, lapses: 0 },
      });

      const ended = match(paged)
        .returnType<{ read: SpanRead<SeriesSpan<Series, Row>> | undefined } | undefined>()
        .with(undefined, () => {
          if (depth === undefined) {
            return { read: undefined };
          }

          oweIn(name, span);

          return undefined;
        })
        .with({ kind: 'split' }, ({ half }) => ({ read: { kind: 'split', half } }))
        .with({ kind: 'below' }, ({ skipped }) => {
          oweIn(name, skipped);

          return undefined;
        })
        .with({ kind: 'drift' }, () => {
          result.drifted.push(name);

          return undefined;
        })
        .with({ kind: 'rows' }, ({ rows, unreadable, skipped }) => {
          result.read.push({ series: name, rows, unreadable });
          oweIn(name, skipped);

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

  return { kind: 'page', page: { ...result, ...foldMap(maybe(depth), () => ({ owed })) } };
};
