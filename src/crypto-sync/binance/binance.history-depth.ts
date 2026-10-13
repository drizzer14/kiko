import maybe, { foldMap } from 'fnts/maybe';

/**
 * How close to the start Binance serves the narrowing of a refused span gets: it stops once the
 * start it knows is refused and the start it knows is served are this close. Measured: a start 180
 * days back is served, 200 days back is refused. Assumed: the oldest start Binance serves moves
 * forward no faster than the clock. Up to this much ground that Binance still keeps therefore lies
 * below the start a read begins at, and it leaves Binance's depth at clock speed anyway.
 */
export const DEPTH_RESOLUTION_MS = 1_000;

/**
 * What a read adds to the start Binance was last seen to serve, beyond the time that passed, for
 * a request that reaches Binance later than the one that found the start. Binance's depth moves
 * with the clock, so a start found within `DEPTH_RESOLUTION_MS` of it is refused after a request
 * that takes longer. Each refusal of a read from such a start doubles it (see
 * `widenDepthMargin`). Ground within it of the depth is skipped, and leaves the depth that fast.
 */
export const DEPTH_MARGIN_MS = 1_000;

/**
 * The refused reads one span read tolerates: the fifth ends it as a clean stop, the span unread.
 * Only a read with no start known to be served is narrowed (`narrowRefusedStart`), and it is
 * narrowed once: one request for the end of the span and `ceil(log2(width / DEPTH_RESOLUTION_MS))`
 * halvings, 23 for a span of 30 days. Every other refusal is a read from a start that Binance's
 * depth passed meanwhile, and doubles the margin (1, 2, 4 and 8 seconds before the fifth), with no
 * request beyond the read again. A span read of 30 days therefore spends at most 5 + 23 = 28
 * requests on the depth.
 */
export const MAX_DEPTH_REFUSALS = 5;

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
 * The start a read begins at as of `nowMs`, or `undefined` while none is known. A served start
 * is moved forward by the time that passed since it was served (a clock that reads earlier moves
 * it by none) and by the margin.
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
  memory.marginMs *= 2;
};

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
 * Where a refused span is read from: `floor` when it ends at or before the floor of now (Binance
 * is not asked), else the start from which Binance serves it: the end of the span when it serves
 * nothing of it. Up to `DEPTH_RESOLUTION_MS` of the ground before that start is ground Binance
 * serves, which leaves its depth at clock speed (see `DEPTH_RESOLUTION_MS`).
 */
type Narrowed = { kind: 'floor' } | { kind: 'start'; startMs: number };

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
  probe: (startMs: number) => Promise<boolean | undefined>;
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

  let refusedMs = input.refusedMs;
  let servedMs = endMs;

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

  return { kind: 'start', startMs: servedMs };
};
