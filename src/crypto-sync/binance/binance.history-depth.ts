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
 * stands still, the ground within it of the depth is skipped.
 */
export const DEPTH_MARGIN_MS = 1_000;

/**
 * The most the margin grows to. A refusal of a read whose margin is at it is not answered by a
 * wider margin but by a narrowing from the refused start toward the end of the span, so the
 * margin never adds more than this to the ground a read skips.
 */
export const DEPTH_MARGIN_CAP_MS = 8_000;

/**
 * How long after it was served a start is moved forward with the clock. A read made later than
 * this (the app was suspended, the run gate waited for hours) finds its start by narrowing
 * (`narrowLapsedStart`), so the time that passed never decides how much ground a read skips.
 * It is as long as a run takes at a request time of a second and more (a lane's call cap, each
 * call paced by the gate's interval and a second to answer), so a run on a slow network does not
 * reach it and only a suspension does. If the depth stands still, a read skips at most
 * `DEPTH_RESOLUTION_MS` + this + `DEPTH_MARGIN_CAP_MS` of the ground that Binance keeps.
 */
export const DEPTH_EXTRAPOLATION_MAX_MS = 120_000;

/**
 * The refused reads one span read tolerates: the sixth ends it as a clean stop, the span unread.
 * A refused read with no start known to be served, or whose margin is at the cap, is answered by
 * one narrowing; any other is answered by a wider margin and the read again. A narrowing starts
 * the margin over and it takes three refusals to reach the cap, so six refusals hold the first
 * narrowing (of the span's crossing of the depth), three wider margins, and a second narrowing
 * (of a type whose depth lies above the start the first found), and never a third.
 */
export const MAX_DEPTH_REFUSALS = 6;

/**
 * The lapses one span read tolerates (see `DEPTH_EXTRAPOLATION_MAX_MS`): a second ends it as a
 * clean stop, the span unread. A span read of 30 days therefore spends at most
 * `MAX_DEPTH_REFUSALS` refused reads, 23 requests of each narrowing after a refusal (the end of
 * the span and 22 halvings) and 24 of the one after a lapse (the start the memory moved on to,
 * the end of the span, and 22 halvings): 6 + 2 * 23 + 24 = 76 requests on the depth. A run's
 * lane budget still ends it earlier.
 */
export const MAX_DEPTH_LAPSES = 1;

/**
 * The start from which Binance is known to serve in this run, and when it was found. Starts below
 * `startMs` are refused. A `startMs` that was served at `servedAtMs` (the clock of the request) is
 * the oldest start Binance served at that time; the depth moves with the clock since, so a read
 * starts at `knownStartOf` rather than at `startMs`. A `startMs` with no `servedAtMs` is a start
 * Binance refused (the end of a span that holds nothing it keeps): a bound, which does not move.
 * `marginMs` is the margin added to a served start, widened by every refusal of a read from it.
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
 * before it lies below the floor, and Binance is not asked again), and the start known to be
 * served.
 */
export type DepthGuard = {
  isRefusal: (error: unknown) => boolean;
  nowMs: () => number;
  floorMs: () => number;
  memory: DepthMemory;
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

/**
 * Find where a span whose start Binance refused (`refusedMs`) is served from. A start at the end
 * of the span is asked first (refused: nothing of the span is served), then the span between the
 * refused start and the end is halved until it is `DEPTH_RESOLUTION_MS` wide: one request for the
 * end and `ceil(log2(width / DEPTH_RESOLUTION_MS))` for the halvings. `probe` answers whether
 * Binance serves a start (`undefined`: the budget cannot afford the request, a clean stop).
 */
export const narrowRefusedStart = async (input: {
  refusedMs: number;
  endMs: number;
  floorMs: number;
  probe: DepthProbe;
}): Promise<Narrowed | undefined> => {
  const { endMs, floorMs, probe } = input;

  if (endMs <= floorMs) {
    return { kind: 'floor' };
  }

  const servedAtEnd = await probe(endMs);

  if (servedAtEnd === undefined) {
    return undefined;
  }

  if (!servedAtEnd) {
    return { kind: 'start', startMs: endMs };
  }

  const servedMs = await halveToServed({ refusedMs: input.refusedMs, servedMs: endMs, probe });

  return foldMap(maybe(servedMs), (startMs) => ({ kind: 'start' as const, startMs }));
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
    const servedMs = await halveToServed({ refusedMs: lowMs, servedMs: highMs, probe });

    return foldMap(maybe(servedMs), (startMs) => ({ kind: 'start' as const, startMs }));
  }

  if (highMs >= endMs) {
    return { kind: 'start', startMs: endMs };
  }

  return narrowRefusedStart({ refusedMs: highMs, endMs, floorMs, probe });
};
