import { maxOf } from '@kiko/numbers';
import maybe, { foldMap } from 'fnts/maybe';

/**
 * How close a narrowing gets to the oldest start Binance serves: it stops once the start it knows
 * is refused and the start it knows is served are this close. Up to this much ground that Binance
 * keeps therefore lies below the start a read begins at. Measured: a start 180 days back is
 * served, 200 days back is refused. Assumed: the oldest start Binance serves moves forward, never
 * back; nothing is assumed of how fast, so it may move with the clock or in steps.
 */
export const DEPTH_RESOLUTION_MS = 1_000;

/**
 * What a read adds to the start Binance was last seen to serve, beyond the time that passed, for
 * a request that reaches Binance later than the one that found the start. Each refusal of a read
 * from such a start doubles it (see `widenDepthMargin`) up to `DEPTH_MARGIN_CAP_MS`. If the depth
 * stands still, the ground within it of the depth is the band a read begins above: it is read
 * right after the read, and owed when Binance refuses it.
 */
export const DEPTH_MARGIN_MS = 1_000;

/**
 * The most the margin grows to. A refusal of a read whose margin is at it is not answered by a
 * wider margin but by a narrowing from the refused start toward the end of the span, so the
 * margin never adds more than this to the band a read begins above.
 */
export const DEPTH_MARGIN_CAP_MS = 8_000;

/**
 * How long after it was served a start is moved forward with the clock. A read made later than
 * this (the app was suspended, the run gate waited for hours) finds its start by narrowing
 * (`narrowLapsedStart`), so the time that passed never decides how wide the band of a read is.
 * It is as long as a run takes at a request time of up to about a second (a lane's call cap,
 * each call paced by the gate's interval and a second to answer), so a run on such a network does
 * not reach it and only a suspension or a slower network does. If the depth stands still, the band
 * of a read is at most this + `DEPTH_MARGIN_CAP_MS` of the ground that Binance keeps, and the
 * `DEPTH_RESOLUTION_MS` of a narrowing is not part of it.
 */
export const DEPTH_EXTRAPOLATION_MAX_MS = 120_000;

/**
 * The refused reads one series tolerates in one span read: the sixth ends its read as a clean
 * stop, the span owed in that series. A refused read with no start known to be served, or whose
 * margin is at the cap, is answered by one narrowing; any other is answered by a wider margin and
 * the read again. A narrowing starts the margin over and it takes three refusals to reach the
 * cap, so six refusals hold the first narrowing (of the span's crossing of the depth), three
 * wider margins, and a second narrowing (of a start that lay above the first one found because
 * the depth moved meanwhile), and never a third.
 */
export const MAX_DEPTH_REFUSALS = 6;

/**
 * The lapses one series tolerates in one span read (see `DEPTH_EXTRAPOLATION_MAX_MS`): a second
 * ends its read as a clean stop, the span owed in that series. A span of 30 days therefore costs
 * a series at most `MAX_DEPTH_REFUSALS` refused reads, 23 requests of each narrowing after a
 * refusal (the end of the span and 22 halvings) and 24 of the one after a lapse (the start the
 * memory moved on to, which Binance refuses, the end of the span, and 22 halvings; when Binance
 * serves the start the memory moved on to, the halvings between it and the start the memory holds
 * are `ceil(log2(elapsed / DEPTH_RESOLUTION_MS))`, which is 22 at most for an elapsed time up to
 * 48 days): 6 + 2 * 23 + 24 = 76 requests on the depth. The 20 series of a span each have their
 * own, so a span read has no bound of its own beyond the shared lane budget: every request
 * spends it, and a series whose narrowing runs out of it is owed (see `readSeriesSpan`).
 */
export const MAX_DEPTH_LAPSES = 1;

/**
 * The start from which Binance is known to serve one series in this run, and when it was found.
 * Starts below `startMs` are refused. A `startMs` that was served at `servedAtMs` (the clock of
 * the request) is the oldest start Binance served at that time; the depth has moved forward or
 * stood still since, so a read starts at `knownStartOf`, the start moved on by the time that
 * passed, rather than at `startMs`. A `startMs` with no `servedAtMs` is a start Binance refused
 * (the end of a span that holds nothing it keeps): a bound, which does not move. `marginMs` is the
 * margin added to a served start, widened by every refusal of a read from it. Each series has its
 * own (`DepthGuard.memoryOf`): a series that keeps less than the others narrows by itself.
 */
export type DepthMemory = {
  startMs: number | undefined;
  servedAtMs: number | undefined;
  marginMs: number;
};

export const createDepthMemory = (): DepthMemory => ({
  startMs: undefined,
  servedAtMs: undefined,
  marginMs: DEPTH_MARGIN_MS,
});

/**
 * The memory of each series of a run, made when it is first asked for, and what the series tell
 * each other. `hintMs`: the start another series served most recently is served from, moved on to
 * now (`narrowRefusedStart` asks it first); a hint is only where a search begins and never what it
 * finds, and a start that is refused (a bound) or served longer ago than it is moved on for gives
 * none; `exceptSeries` leaves out the series that asks. `refusedBoundMs`: the furthest start any
 * series was refused (negative infinity while none), which only suggests that another series is
 * refused the span below it too, and is asked before that series reads.
 */
export const createDepthMemories = (nowMs: () => number) => {
  const memories = new Map<string, DepthMemory>();

  return {
    memoryOf: (series: string): DepthMemory => {
      const memory = memories.get(series) ?? createDepthMemory();
      memories.set(series, memory);

      return memory;
    },
    hintMs: (exceptSeries?: string): number | undefined => {
      const now = nowMs();
      const freshest = [...memories.entries()]
        .filter(
          ([series, memory]) =>
            series !== exceptSeries &&
            memory.servedAtMs !== undefined &&
            !hasDepthLapsed(memory, now),
        )
        .map(([, memory]) => memory)
        .sort((left, right) => (right.servedAtMs ?? 0) - (left.servedAtMs ?? 0))
        .at(0);

      return foldMap(maybe(freshest), (memory) => knownStartOf(memory, now));
    },
    refusedBoundMs: (): number =>
      maxOf(
        [...memories.values()].flatMap(({ startMs, servedAtMs }) =>
          servedAtMs === undefined && startMs !== undefined ? [startMs] : [],
        ),
      ),
  };
};

/**
 * The start a served start is moved to as of `nowMs`, or `undefined` while none is known: forward
 * by the time that passed since it was served (a clock that reads earlier moves it by none) and
 * by the margin. A read begins at it only until `hasDepthLapsed`; after that it is the furthest
 * start `narrowLapsedStart` asks about.
 */
export const knownStartOf = (memory: DepthMemory, nowMs: number): number | undefined =>
  foldMap(
    maybe(memory.startMs),
    (startMs) =>
      startMs +
      (foldMap(
        maybe(memory.servedAtMs),
        (servedAtMs) => Math.max(0, nowMs - servedAtMs) + memory.marginMs,
      ) ?? 0),
  );

/** Whether a served start was served longer ago than it is moved forward with the clock for. */
export const hasDepthLapsed = (memory: DepthMemory, nowMs: number): boolean =>
  foldMap(
    maybe(memory.servedAtMs),
    (servedAtMs) => nowMs - servedAtMs > DEPTH_EXTRAPOLATION_MAX_MS,
  ) ?? false;

/**
 * The ground a lapsed memory leaves open: from the start it holds (`lowMs`) to the start it would
 * move on to by now (`highMs`).
 */
export type LapsedRange = { lowMs: number; highMs: number };

/** The ground a lapsed memory leaves open, or `undefined` while the memory has not lapsed. */
export const lapsedRangeOf = (memory: DepthMemory, nowMs: number): LapsedRange | undefined => {
  const lowMs = memory.startMs;
  const highMs = knownStartOf(memory, nowMs);

  return hasDepthLapsed(memory, nowMs) && lowMs !== undefined && highMs !== undefined
    ? { lowMs, highMs }
    : undefined;
};

/** Remember the start found, with the clock of the request it was served at (none if refused). */
export const rememberServedStart = (
  memory: DepthMemory,
  found: { startMs: number; servedAtMs: number | undefined },
): void => {
  memory.startMs = found.startMs;
  memory.servedAtMs = found.servedAtMs;
  memory.marginMs = DEPTH_MARGIN_MS;
};

export const widenDepthMargin = (memory: DepthMemory): void => {
  memory.marginMs = Math.min(memory.marginMs * 2, DEPTH_MARGIN_CAP_MS);
};

export const isDepthMarginCapped = (memory: DepthMemory): boolean =>
  memory.marginMs >= DEPTH_MARGIN_CAP_MS;

/**
 * What a read knows of Binance's depth: which failure is Binance refusing a start as older than it
 * keeps, the clock, the earliest start the walk asks for as of now (a refused span that ends at or
 * before it lies below the floor, and Binance is not asked again), for each series the start known
 * to be served, and the start another series is served from, where a search for one begins.
 */
export type DepthGuard = {
  isRefusal: (error: unknown) => boolean;
  nowMs: () => number;
  floorMs: () => number;
  memoryOf: (series: string) => DepthMemory;
  hintMs: (exceptSeries?: string) => number | undefined;
  refusedBoundMs: () => number;
};

/**
 * Where a span is read from after a narrowing: `floor` when it ends at or before the floor of now
 * (Binance is not asked), else the start from which Binance serves it: the end of the span when it
 * serves nothing of it. Up to `DEPTH_RESOLUTION_MS` of the ground before that start is ground
 * Binance may serve (see `DEPTH_RESOLUTION_MS`).
 */
export type Narrowed = { kind: 'floor' } | { kind: 'start'; startMs: number };

/** Whether Binance serves a start (`undefined`: the budget cannot afford the request). */
export type DepthProbe = (startMs: number) => Promise<boolean | undefined>;

/**
 * Halve the part between a start that is refused and one that is served until it is
 * `DEPTH_RESOLUTION_MS` wide, and answer the served one. `ceil(log2(width / DEPTH_RESOLUTION_MS))`
 * requests. `undefined` is a clean stop: the budget cannot afford a request.
 */
const halveToServed = async (input: {
  refusedMs: number;
  servedMs: number;
  probe: DepthProbe;
}): Promise<number | undefined> => {
  const { probe } = input;
  let { refusedMs, servedMs } = input;

  while (servedMs - refusedMs > DEPTH_RESOLUTION_MS) {
    const middleMs = refusedMs + Math.floor((servedMs - refusedMs) / 2);
    const served = await probe(middleMs);

    if (served === undefined) {
      return undefined;
    }

    if (served) {
      servedMs = middleMs;
    } else {
      refusedMs = middleMs;
    }
  }

  return servedMs;
};

/** The steps down from a hint, each twice the one before: 1, 2, 4, 8 and 16 seconds. */
const HINT_STEPS_MS = [1, 2, 4, 8, 16].map((seconds) => seconds * DEPTH_RESOLUTION_MS);

const startFound = (startMs: number | undefined): Narrowed | undefined =>
  foldMap(maybe(startMs), (found) => ({ kind: 'start' as const, startMs: found }));

/**
 * Find where a span whose start Binance refused (`refusedMs`) is served from. A start at the end
 * of the span is asked first (refused: nothing of the span is served), then the span between the
 * refused start and the end is halved until it is `DEPTH_RESOLUTION_MS` wide: one request for the
 * end and `ceil(log2(width / DEPTH_RESOLUTION_MS))` for the halvings. With a `hintMs` between the
 * refused start and the end the search begins there instead (see `narrowFromHint`). `probe`
 * answers whether Binance serves a start (`undefined`: the budget cannot afford the request, a
 * clean stop).
 */
export const narrowRefusedStart = async (input: {
  refusedMs: number;
  endMs: number;
  floorMs: number;
  hintMs?: number;
  probe: DepthProbe;
}): Promise<Narrowed | undefined> => {
  const { refusedMs, endMs, floorMs, hintMs, probe } = input;

  if (endMs <= floorMs) {
    return { kind: 'floor' };
  }

  if (hintMs !== undefined && hintMs > refusedMs && hintMs < endMs) {
    return narrowFromHint({ refusedMs, endMs, floorMs, hintMs, probe });
  }

  const servedAtEnd = await probe(endMs);

  if (servedAtEnd === undefined) {
    return undefined;
  }

  if (!servedAtEnd) {
    return { kind: 'start', startMs: endMs };
  }

  const servedMs = await halveToServed({ refusedMs, servedMs: endMs, probe });

  return startFound(servedMs);
};

/**
 * Find where a span is served from, asking first the start another series is served from
 * (`hintMs`, strictly between the refused start and the end). A series that keeps what the other
 * does is found in a request or two more: refused at the hint, it keeps less, and the span is
 * narrowed from the hint toward its end as a refused start is; served, the starts below the hint
 * are asked in doubling steps (`HINT_STEPS_MS`) until one is refused, and the part between that
 * one and the last served is halved. Past the last step the part down to the refused start is
 * halved. The hint decides only which starts are asked first: what is found is what Binance
 * answered for this series, and the ground below it is ground it refused, within the resolution.
 */
const narrowFromHint = async (input: {
  refusedMs: number;
  endMs: number;
  floorMs: number;
  hintMs: number;
  probe: DepthProbe;
}): Promise<Narrowed | undefined> => {
  const { refusedMs, endMs, floorMs, hintMs, probe } = input;
  const servedAtHint = await probe(hintMs);

  if (servedAtHint === undefined) {
    return undefined;
  }

  if (!servedAtHint) {
    return narrowRefusedStart({ refusedMs: hintMs, endMs, floorMs, probe });
  }

  let servedMs = hintMs;

  for (const stepMs of HINT_STEPS_MS) {
    const belowMs = servedMs - stepMs;

    if (belowMs <= refusedMs) {
      break;
    }

    const served = await probe(belowMs);

    if (served === undefined) {
      return undefined;
    }

    if (!served) {
      return startFound(await halveToServed({ refusedMs: belowMs, servedMs, probe }));
    }

    servedMs = belowMs;
  }

  return startFound(await halveToServed({ refusedMs, servedMs, probe }));
};

/**
 * Find where a span is served from after a lapse. The start the memory holds (`lowMs`) was served
 * long ago, and the start it would move on to by now (`highMs`, kept at or below the end of the
 * span) is asked first. Served: the part between them is halved, `1 + ceil(log2(elapsed /
 * DEPTH_RESOLUTION_MS))` requests, and the depth that stood still leaves the answer within the
 * resolution of `lowMs`. Refused: the depth moved past it, and the span is narrowed from it
 * toward the end, as a refused start is (`narrowRefusedStart`). The ground below the answer is
 * ground Binance refused when it was asked, within the resolution.
 */
export const narrowLapsedStart = async (input: {
  lowMs: number;
  highMs: number;
  endMs: number;
  floorMs: number;
  probe: DepthProbe;
}): Promise<Narrowed | undefined> => {
  const { lowMs, endMs, floorMs, probe } = input;
  const highMs = Math.min(input.highMs, endMs);

  if (endMs <= floorMs) {
    return { kind: 'floor' };
  }

  const servedAtHigh = await probe(highMs);

  if (servedAtHigh === undefined) {
    return undefined;
  }

  if (servedAtHigh) {
    return startFound(await halveToServed({ refusedMs: lowMs, servedMs: highMs, probe }));
  }

  if (highMs >= endMs) {
    return { kind: 'start', startMs: endMs };
  }

  return narrowRefusedStart({ refusedMs: highMs, endMs, floorMs, probe });
};
