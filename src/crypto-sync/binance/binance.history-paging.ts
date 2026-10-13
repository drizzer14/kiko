import { match } from 'ts-pattern';
import maybe, { foldMap } from 'fnts/maybe';

import {
  DEPTH_RESOLUTION_MS,
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
 * series left owed in itself (`owed`): the band a series read began above when Binance refused it
 * or the lane could not afford it (see `readBand`), and the span of a series that could not be
 * read (the lane's calls ran out while it narrowed, or it reached its limits). Only a lane with a
 * depth owes, so a lane without one has none.
 */
export type SeriesSpan<Series, Row> = {
  read: { series: Series; rows: Row[]; unreadable: UnreadableRow[] }[];
  drifted: Series[];
  owed?: SeriesOwed<Series>[];
};

/** A refused request still counts as a call of the lane; Binance gave no weight reading for it. */
const REFUSED_CALL = { usedUidWeight1m: undefined, usedIpWeight1m: undefined };

/**
 * The run as one span read sees it: its gate, and a budget that counts the calls of the read as
 * the lane's narrowing calls from the moment a series of it narrows or reads a band
 * (`beginNarrowing`), until the read ends: the refused read, the probes, the band, and the reads
 * of every series after it.
 */
type SpanRun = {
  gate: BinanceHistoryRun['gate'];
  budget: BinanceHistoryRun['budget'] & { beginNarrowing: () => void };
};

const spanRunOf = (run: BinanceHistoryRun): SpanRun => {
  const narrowing = { begun: false };

  return {
    gate: run.gate,
    budget: {
      canAfford: (lane, cost, keep) => run.budget.canAfford(lane, cost, keep, narrowing.begun),
      record: (lane, page) => run.budget.record(lane, page, narrowing.begun),
      beginNarrowing: () => {
        narrowing.begun = true;
      },
    },
  };
};

type SeriesRequest<Series extends string, Row> = {
  run: SpanRun;
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
 * its read began above that was not read (`skipped`, owed), or a span with nothing Binance keeps
 * in it (`below`).
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
 * A request of one millisecond at a start, one request of the lane, refused ones too, and none
 * that leaves the series' own read unaffordable (`undefined`). `onServed` gets the clock of the
 * request Binance served.
 */
const probeOf =
  <Series extends string, Row>(
    input: SeriesDepth<Series, Row>,
    onServed: (sentAtMs: number) => void,
  ): DepthProbe =>
  async (startMs) => {
    const { run, lane, cost, name, keep, fetchPage, depth } = input;

    if (!run.budget.canAfford(lane, cost, keep + 1)) {
      return undefined;
    }

    await run.gate.wait();
    const sentAtMs = depth.nowMs();

    try {
      run.budget.record(lane, await fetchPage(name, { start: startMs, end: startMs + 1 }, 1));
      onServed(sentAtMs);

      return true;
    } catch (error) {
      if (!depth.isRefusal(error)) {
        throw error;
      }

      run.budget.record(lane, REFUSED_CALL);

      return false;
    }
  };

/**
 * Narrow with the requests of the lane (see `probeOf`). The start found is remembered with the
 * clock of the request that served it.
 */
const narrowDepth = async <Series extends string, Row>(
  input: SeriesDepth<Series, Row>,
  narrow: (probe: DepthProbe) => Promise<Narrowed | undefined>,
): Promise<AfterDepth<Row>> => {
  const { depth } = input;
  const lastServed: { atMs: number | undefined } = { atMs: undefined };
  const narrowed = await narrow(
    probeOf(input, (sentAtMs) => {
      lastServed.atMs = sentAtMs;
    }),
  );

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
  const { run, lane, depth, tally, refusedMs } = input;

  run.budget.beginNarrowing();
  run.budget.record(lane, REFUSED_CALL);
  tally.refusals += 1;

  if (tally.refusals >= MAX_DEPTH_REFUSALS) {
    return CLEAN_STOP;
  }

  if (depth.memory.servedAtMs !== undefined && !isDepthMarginCapped(depth.memory)) {
    widenDepthMargin(depth.memory);

    return { kind: 'retry' };
  }

  return narrowFromRefused(input, refusedMs);
};

/** Narrow from a start that is refused toward the end of the span (see `narrowRefusedStart`). */
const narrowFromRefused = <Series extends string, Row>(
  input: SeriesDepth<Series, Row>,
  refusedMs: number,
): Promise<AfterDepth<Row>> =>
  narrowDepth(input, (probe) =>
    narrowRefusedStart({
      refusedMs,
      endMs: input.span.end,
      floorMs: input.depth.floorMs(),
      hintMs: input.depth.hintMs(input.name),
      probe,
    }),
  );

/**
 * What a series does before a read that is refused, or likely to be, so the refused read is not
 * made. A series whose memory holds a start Binance refused (a bound) at or after the start of the
 * span would read from that start: it narrows from the bound at once. A series with no memory,
 * while another was refused a start at or after the end of the span, asks the end first, once: a
 * refusal settles the span as below its depth in one request, and a series that serves the end is
 * read as any other (`undefined`).
 */
const settleBeforeRead = async <Series extends string, Row>(
  input: SeriesDepth<Series, Row>,
  asked: { end: boolean },
): Promise<AfterDepth<Row> | undefined> => {
  const { run, span, depth } = input;
  const { startMs, servedAtMs } = depth.memory;

  if (startMs !== undefined && servedAtMs === undefined && startMs >= span.start) {
    run.budget.beginNarrowing();

    return narrowFromRefused(input, startMs);
  }

  if (startMs !== undefined || asked.end || depth.refusedBoundMs() < span.end) {
    return undefined;
  }

  run.budget.beginNarrowing();
  asked.end = true;
  const served = await probeOf(input, () => undefined)(span.end);

  if (served === undefined) {
    return CLEAN_STOP;
  }

  if (served) {
    return undefined;
  }

  rememberServedStart(depth.memory, { startMs: span.end, servedAtMs: undefined });

  return { kind: 'retry' };
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
  const { run, span, depth, tally, range } = input;

  run.budget.beginNarrowing();
  tally.lapses += 1;

  if (tally.lapses > MAX_DEPTH_LAPSES) {
    return CLEAN_STOP;
  }

  const after = await narrowDepth(input, (probe) =>
    narrowLapsedStart({ ...range, endMs: span.end, floorMs: depth.floorMs(), probe }),
  );

  // A search that ends against the start the memory held (the depth stood still) leaves the ground
  // from there to the start it found unknown, so the memory takes the old start back and the
  // read owes that ground with the band its read begins above.
  if (
    after.kind === 'retry' &&
    depth.memory.servedAtMs !== undefined &&
    depth.memory.startMs !== undefined &&
    depth.memory.startMs - range.lowMs <= DEPTH_RESOLUTION_MS
  ) {
    depth.memory.startMs = range.lowMs;
  }

  return after;
};

/**
 * Whether the span lies below the ground the series is not asked for: the floor of now, or the
 * ground the memory knows is refused, moved on by the time that passed (a lapsed memory is not
 * moved, see `DEPTH_EXTRAPOLATION_MAX_MS`: only the start it holds is known to be refused below).
 */
const isBelowKnownStart = (span: WalkWindow, depth: SeriesGuard | undefined): boolean => {
  const knownMs = foldMap(maybe(depth), (guard) => {
    const nowMs = guard.nowMs();

    return hasDepthLapsed(guard.memory, nowMs)
      ? guard.memory.startMs
      : knownStartOf(guard.memory, nowMs);
  });
  const floorMs = foldMap(maybe(depth), (guard) => guard.floorMs());

  return Math.max(knownMs ?? span.start, floorMs ?? span.start) >= span.end;
};

/**
 * Where a series is read from as of now: the span's start, or the floor of now, or the start known
 * to be served (see `knownStartOf`; the time that passed moves it), whichever is latest. The
 * floor is the clock's: a span planned before the clock moved on still holds ground below it that
 * Binance does not keep, and a type read in a later run is read from the floor it meets then.
 * Without a `depth` it is the span's.
 */
const readStartOf = (span: WalkWindow, depth: SeriesGuard | undefined): number =>
  Math.max(
    span.start,
    foldMap(maybe(depth), (guard) =>
      Math.max(guard.floorMs(), knownStartOf(guard.memory, guard.nowMs()) ?? guard.floorMs()),
    ) ?? span.start,
  );

/**
 * The ground of the span that lies below `toMs`, the start a series is read from (the end of the
 * span for a span read as below), and is not known to be refused: from the start the memory
 * holds, which was served, up to `toMs`, and not below the floor of now. The depth may have stood
 * still, so Binance may keep it. A start the memory holds as refused is a bound, and nothing
 * below it is owed.
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
  const floorMs = foldMap(maybe(depth), (guard) => guard.floorMs()) ?? span.start;
  const fromMs =
    foldMap(maybe(servedMs), (startMs) => Math.max(span.start, floorMs, startMs)) ?? toMs;

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
 * may have moved meanwhile. A memory that lapsed by then, and whose moved-on start reaches into the
 * span, makes no request (see `DEPTH_EXTRAPOLATION_MAX_MS` and `lapsedRangeOf`); a span that starts
 * above that start is read from its own start. The start is kept below the end of the span, since
 * no request has `startTime` at or past `endTime`.
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
            lapsedRangeOf(guard.memory, guard.nowMs(), span.start),
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

/**
 * The band a series read began above (see `skippedBandOf`), read right after the series itself as
 * calls of the narrowing kind. It is paged by `current` and never halved. The rows are the band's
 * when Binance serves it whole; `undefined` leaves the band owed: a start Binance refuses (the
 * depth moved on meanwhile), pages that drift, or a request the budget cannot afford.
 */
const readBand = async <Series extends string, Row>(
  input: SeriesRequest<Series, Row> & {
    name: Series;
    keep: number;
    depth: SeriesGuard | undefined;
  },
  band: WalkWindow,
): Promise<Extract<TotalPaged<Row>, { kind: 'rows' }> | undefined> => {
  const { run, lane, cost, name, keep, maxPages, fetchPage, depth } = input;

  run.budget.beginNarrowing();

  try {
    const paged = await fetchAllByTotal<Row>({
      run,
      lane,
      cost,
      keep,
      half: () => undefined,
      maxPages,
      fetchPage: (current) => fetchPage(name, band, current),
    });

    return paged?.kind === 'rows' ? paged : undefined;
  } catch (error) {
    if (depth === undefined || !depth.isRefusal(error)) {
      throw error;
    }

    run.budget.record(lane, REFUSED_CALL);
    depth.rememberRefusedBand(band.start);

    return undefined;
  }
};

/**
 * What a series read gave once the band it began above is read: the rows of both, and nothing owed
 * when the band was served; the rows of the read, and the band owed, when it was not. A band that
 * starts within the reach of a band Binance refused (`isBandRefused`: the depth moves with the
 * clock) is owed with no request, since Binance would refuse it too.
 */
const withBandOf = async <Series extends string, Row>(
  input: SeriesRequest<Series, Row> & {
    name: Series;
    keep: number;
    depth: SeriesGuard | undefined;
  },
  read: Extract<TotalPaged<Row>, { kind: 'rows' }>,
  skipped: WalkWindow | undefined,
): Promise<SeriesRead<Row>> => {
  const band = await foldMap(maybe(skipped), (window) =>
    foldMap(maybe(input.depth), (guard) => guard.isBandRefused(window.start)) === true
      ? undefined
      : readBand(input, window),
  );

  return band === undefined
    ? { ...read, skipped }
    : {
        kind: 'rows',
        rows: [...read.rows, ...band.rows],
        unreadable: [...read.unreadable, ...band.unreadable],
        skipped: undefined,
      };
};

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
  const asked = { end: false };

  for (;;) {
    if (isBelowKnownStart(span, depth)) {
      return { kind: 'below', skipped: skippedBandOf({ span, depth, toMs: span.end }) };
    }

    const settled = await foldMap(maybe(depth), (guard) =>
      settleBeforeRead({ ...input, depth: guard }, asked),
    );

    if (settled?.kind === 'done') {
      return settled.read;
    }

    if (settled !== undefined) {
      continue;
    }

    const attempt = await attemptSeries(input);
    const next = await match(attempt)
      .returnType<Promise<AfterDepth<Row>>>()
      .with({ kind: 'read' }, async ({ paged, startMs }) => ({
        kind: 'done',
        read:
          paged?.kind === 'rows'
            ? await withBandOf(input, paged, skippedBandOf({ span, depth, toMs: startMs }))
            : paged,
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
 * of it and the others are read. The ground a series read begins above (its band, see
 * `skippedBandOf`) is read right after the series, in the same span read, and joins its rows when
 * Binance serves it; when Binance refuses it, is expected to refuse it (see `withBandOf`) or the
 * lane cannot afford it, it is owed in that series (`owed`), not read as empty. So is the whole
 * span of a series whose read stopped (the lane's calls ran out while it narrowed, or it reached
 * `MAX_DEPTH_REFUSALS` refusals or a second lapse), never read as empty. A series costs at most
 * the requests bounded in `MAX_DEPTH_REFUSALS` and `MAX_DEPTH_LAPSES` and one for its band, each
 * spending the lane, and may spend the calls the series after it would have had: one series read
 * to its end serves more ground than a request each for all of them, and a series with no call
 * left is owed the whole span with no request. A span read in which a series is refused, lapses,
 * asks the end of the span or reads a band narrows, and its calls are the lane's narrowing calls
 * first (see `SpanRun`), so the 20 series each find their depth in one run without the cap the
 * passes after it need. A lane without a depth reads every series or none.
 */
export const readSeriesSpan = async <Series extends string, Row>(
  input: Omit<SeriesRequest<Series, Row>, 'run'> & {
    run: BinanceHistoryRun;
    keep: number;
    series: readonly Series[];
    depth?: DepthGuard;
    onRateLimit: (error: BinanceRateLimitError) => void;
  },
): Promise<SpanRead<SeriesSpan<Series, Row>> | undefined> => {
  const { run, lane, cost, span, keep, series, depth, onRateLimit } = input;
  const spanRun = spanRunOf(run);
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
        run: spanRun,
        name,
        keep: depth === undefined ? keep + series.length - 1 - index : keep,
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
