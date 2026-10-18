import { maxOf } from '@kiko/numbers';
import maybe, { foldMap } from 'fnts/maybe';

/**
 * The measured numbers of one exchange's history depth, which an exchange measures for itself:
 * `resolutionMs`: how close a narrowing gets to the oldest start that is served. `marginMs`: what
 * a read adds to the start last seen to be served, beyond the time that passed; each refusal of a
 * read from such a start doubles it (see `widenDepthMargin`) up to `marginCapMs`.
 * `extrapolationMaxMs`: how long after it was served a start is moved forward with the clock.
 * `maxRefusals` and `maxLapses`: the refused reads and the lapses one series tolerates in one span
 * read.
 */
export type DepthConfig = {
  resolutionMs: number;
  marginMs: number;
  marginCapMs: number;
  extrapolationMaxMs: number;
  maxRefusals: number;
  maxLapses: number;
};

/**
 * The start from which the exchange is known to serve one series in this run, and when it was
 * found. Starts below `startMs` are refused. A `startMs` that was served at `servedAtMs` (the clock
 * of the request) is the oldest start served at that time; the depth has moved forward or stood
 * still since, so a read starts at `knownStartOf`, the start moved on by the time that passed,
 * rather than at `startMs`. A `startMs` with no `servedAtMs` is a start that was refused (the end
 * of a span that holds nothing it keeps): a bound, which does not move. `marginMs` is the margin
 * added to a served start, widened by every refusal of a read from it. Each series has its own
 * (`DepthGuard.memoryOf`): a series that keeps less than the others narrows by itself. The memory
 * keeps the `config` it was made with.
 */
export type DepthMemory = {
  config: DepthConfig;
  startMs: number | undefined;
  servedAtMs: number | undefined;
  marginMs: number;
};

export const createDepthMemory = (config: DepthConfig): DepthMemory => ({
  config,
  startMs: undefined,
  servedAtMs: undefined,
  marginMs: config.marginMs,
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
export const createDepthMemories = (nowMs: () => number, config: DepthConfig) => {
  const memories = new Map<string, DepthMemory>();

  return {
    config,
    memoryOf: (series: string): DepthMemory => {
      const memory = memories.get(series) ?? createDepthMemory(config);
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
    (servedAtMs) => nowMs - servedAtMs > memory.config.extrapolationMaxMs,
  ) ?? false;

/**
 * The ground a lapsed memory leaves open: from the start it holds (`lowMs`) to the start it would
 * move on to by now (`highMs`).
 */
export type LapsedRange = { lowMs: number; highMs: number };

/**
 * The ground a lapsed memory leaves open when it reaches into a span that starts at `spanStartMs`,
 * or `undefined` while the memory has not lapsed or the start it would move on to lies at or below
 * the start of the span. A read of such a span begins at its own start, whatever the memory holds
 * (`readStartOf`), so it skips none of the ground the lapse left open, and a depth that moved past
 * that start is a refusal, narrowed as any other.
 */
export const lapsedRangeOf = (
  memory: DepthMemory,
  nowMs: number,
  spanStartMs: number,
): LapsedRange | undefined => {
  const lowMs = memory.startMs;
  const highMs = knownStartOf(memory, nowMs);

  return hasDepthLapsed(memory, nowMs) &&
    lowMs !== undefined &&
    highMs !== undefined &&
    highMs > spanStartMs
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
  memory.marginMs = memory.config.marginMs;
};

export const widenDepthMargin = (memory: DepthMemory): void => {
  memory.marginMs = Math.min(memory.marginMs * 2, memory.config.marginCapMs);
};

export const isDepthMarginCapped = (memory: DepthMemory): boolean =>
  memory.marginMs >= memory.config.marginCapMs;

/**
 * What a read knows of the exchange's depth: its `config`, which failure is the exchange refusing a
 * start as older than it keeps, the clock, the earliest start the walk asks for as of now (a
 * refused span that ends at or before it lies below the floor, and the exchange is not asked
 * again), for each series the start known to be served, and the start another series is served
 * from, where a search for one begins.
 */
export type DepthGuard = {
  config: DepthConfig;
  isRefusal: (error: unknown) => boolean;
  nowMs: () => number;
  floorMs: () => number;
  memoryOf: (series: string) => DepthMemory;
  hintMs: (exceptSeries?: string) => number | undefined;
  refusedBoundMs: () => number;
};

/**
 * Where a span is read from after a narrowing: `floor` when it ends at or before the floor of now
 * (the exchange is not asked), else the start from which it serves the span: the end of the span
 * when it serves nothing of it. Up to `resolutionMs` of the ground before that start is ground the
 * exchange may serve (see `DepthConfig`).
 */
export type Narrowed = { kind: 'floor' } | { kind: 'start'; startMs: number };

/** Whether the exchange serves a start (`undefined`: the budget cannot afford the request). */
export type DepthProbe = (startMs: number) => Promise<boolean | undefined>;

/**
 * Halve the part between a start that is refused and one that is served until it is
 * `resolutionMs` wide, and answer the served one. `ceil(log2(width / resolutionMs))`
 * requests. `undefined` is a clean stop: the budget cannot afford a request.
 */
const halveToServed = async (input: {
  refusedMs: number;
  servedMs: number;
  resolutionMs: number;
  probe: DepthProbe;
}): Promise<number | undefined> => {
  const { probe, resolutionMs } = input;
  let { refusedMs, servedMs } = input;

  while (servedMs - refusedMs > resolutionMs) {
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

/** The steps down from a hint, each twice the one before: 1, 2, 4, 8 and 16 resolutions. */
const hintStepsOf = (resolutionMs: number): number[] =>
  [1, 2, 4, 8, 16].map((multiple) => multiple * resolutionMs);

const startFound = (startMs: number | undefined): Narrowed | undefined =>
  foldMap(maybe(startMs), (found) => ({ kind: 'start' as const, startMs: found }));

/**
 * Find where a span whose start the exchange refused (`refusedMs`) is served from. A start at the
 * end of the span is asked first (refused: nothing of the span is served), then the span between
 * the refused start and the end is halved until it is `resolutionMs` wide: one request for the
 * end and `ceil(log2(width / resolutionMs))` for the halvings. With a `hintMs` between the
 * refused start and the end the search begins there instead (see `narrowFromHint`). `probe`
 * answers whether the exchange serves a start (`undefined`: the budget cannot afford the request,
 * a clean stop).
 */
export const narrowRefusedStart = async (input: {
  refusedMs: number;
  endMs: number;
  floorMs: number;
  hintMs?: number;
  config: DepthConfig;
  probe: DepthProbe;
}): Promise<Narrowed | undefined> => {
  const { refusedMs, endMs, floorMs, hintMs, config, probe } = input;

  if (endMs <= floorMs) {
    return { kind: 'floor' };
  }

  if (hintMs !== undefined && hintMs > refusedMs && hintMs < endMs) {
    return narrowFromHint({ refusedMs, endMs, floorMs, hintMs, config, probe });
  }

  const servedAtEnd = await probe(endMs);

  if (servedAtEnd === undefined) {
    return undefined;
  }

  if (!servedAtEnd) {
    return { kind: 'start', startMs: endMs };
  }

  const servedMs = await halveToServed({
    refusedMs,
    servedMs: endMs,
    resolutionMs: config.resolutionMs,
    probe,
  });

  return startFound(servedMs);
};

/**
 * Find where a span is served from, asking first the start another series is served from
 * (`hintMs`, strictly between the refused start and the end). A series that keeps what the other
 * does is found in a request or two more: refused at the hint, it keeps less, and the span is
 * narrowed from the hint toward its end as a refused start is; served, the starts below the hint
 * are asked in doubling steps (`hintStepsOf`) until one is refused, and the part between that
 * one and the last served is halved. Past the last step the part down to the refused start is
 * halved. The hint decides only which starts are asked first: what is found is what the exchange
 * answered for this series, and the ground below it is ground it refused, within the resolution.
 */
const narrowFromHint = async (input: {
  refusedMs: number;
  endMs: number;
  floorMs: number;
  hintMs: number;
  config: DepthConfig;
  probe: DepthProbe;
}): Promise<Narrowed | undefined> => {
  const { refusedMs, endMs, floorMs, hintMs, config, probe } = input;
  const { resolutionMs } = config;
  const servedAtHint = await probe(hintMs);

  if (servedAtHint === undefined) {
    return undefined;
  }

  if (!servedAtHint) {
    return narrowRefusedStart({ refusedMs: hintMs, endMs, floorMs, config, probe });
  }

  let servedMs = hintMs;

  for (const stepMs of hintStepsOf(resolutionMs)) {
    const belowMs = servedMs - stepMs;

    if (belowMs <= refusedMs) {
      break;
    }

    const served = await probe(belowMs);

    if (served === undefined) {
      return undefined;
    }

    if (!served) {
      return startFound(await halveToServed({ refusedMs: belowMs, servedMs, resolutionMs, probe }));
    }

    servedMs = belowMs;
  }

  return startFound(await halveToServed({ refusedMs, servedMs, resolutionMs, probe }));
};

/**
 * Find where a span is served from after a lapse. The start the memory holds (`lowMs`) was served
 * long ago, and the start it would move on to by now (`highMs`, kept at or below the end of the
 * span) is asked first. Served: the part between them is halved, `1 + ceil(log2(elapsed /
 * resolutionMs))` requests, and the depth that stood still leaves the answer within the
 * resolution of `lowMs`. Refused: the depth moved past it, and the span is narrowed from it
 * toward the end, as a refused start is (`narrowRefusedStart`). The ground below the answer is
 * ground the exchange refused when it was asked, within the resolution.
 */
export const narrowLapsedStart = async (input: {
  lowMs: number;
  highMs: number;
  endMs: number;
  floorMs: number;
  config: DepthConfig;
  probe: DepthProbe;
}): Promise<Narrowed | undefined> => {
  const { lowMs, endMs, floorMs, config, probe } = input;
  const highMs = Math.min(input.highMs, endMs);

  if (endMs <= floorMs) {
    return { kind: 'floor' };
  }

  const servedAtHigh = await probe(highMs);

  if (servedAtHigh === undefined) {
    return undefined;
  }

  if (servedAtHigh) {
    return startFound(
      await halveToServed({
        refusedMs: lowMs,
        servedMs: highMs,
        resolutionMs: config.resolutionMs,
        probe,
      }),
    );
  }

  if (highMs >= endMs) {
    return { kind: 'start', startMs: endMs };
  }

  return narrowRefusedStart({ refusedMs: highMs, endMs, floorMs, config, probe });
};
