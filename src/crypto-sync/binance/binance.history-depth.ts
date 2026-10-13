/**
 * How close to the start Binance serves the narrowing of a refused span gets: ground within a
 * second below that start is read as refused. The depth moves with the clock a second at a time,
 * so a start found this close to it is served only until the clock moves on.
 */
export const DEPTH_RESOLUTION_MS = 1_000;

/**
 * The refused reads of one span read the narrowing tolerates before it leaves the span unread:
 * one refusal narrows to a start Binance serves, and a second only follows when the clock moved
 * past that start while the narrowing ran. A refusal costs at most 24 requests (the refused
 * read, the probe at the end of the span, and 22 halvings of a window of 30 days, see
 * `narrowRefusedStart`), so a span read spends at most 48 on its depth.
 */
export const MAX_DEPTH_REFUSALS = 2;

/**
 * The start from which Binance is known to serve in this run (a start older than it was refused,
 * or lies within `DEPTH_RESOLUTION_MS` below one that was served), so a read starts at it rather
 * than ask again. The clock only moves forward, so the start stays valid for the run.
 */
export type DepthMemory = { startMs: number | undefined };

/**
 * What a read knows of Binance's depth: which failure is Binance refusing a start as older than it
 * keeps, the earliest start the walk asks for as of now (a refused span that ends at or before it
 * lies below the floor, and Binance is not asked again), and the start known to be served.
 */
export type DepthGuard = {
  isRefusal: (error: unknown) => boolean;
  floorMs: () => number;
  memory: DepthMemory;
};

/**
 * Where a refused span is read from: `floor` when it ends at or before the floor of now (Binance
 * is not asked), else the start from which Binance serves it: the end of the span when it serves
 * nothing of it. The ground before that start is refused, so it holds nothing Binance keeps.
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
