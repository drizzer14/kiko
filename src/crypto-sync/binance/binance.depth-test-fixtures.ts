import { DAY_MS } from '@kiko/dates';

import { readSeriesSpan } from './binance.history-paging';
import { BinanceHistoryTooOldError } from './binance.client';
import { createDepthMemories, type DepthGuard } from './binance.history-depth';
import { type BinanceHistoryRun, COSTS, createBinanceHistoryRun } from './binance.history-budget';

/**
 * A clock that every wait of a run gate advances (and the test, by the latency of each request it
 * answers), with a fresh run on it for each call.
 */
export const movingClockOf = (startMs: number) => {
  const clock = { now: startMs };
  const newRun = () =>
    createBinanceHistoryRun({
      now: () => clock.now,
      sleep: async (milliseconds) => {
        clock.now += milliseconds;
      },
    });

  return { clock, newRun };
};

/**
 * Latencies that differ from request to request, 0 to `maxMs` (300 ms by default), the same on
 * every test run.
 */
export const jitterMs = (maxMs = 300): (() => number) => {
  let seed = 7;

  return () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;

    return seed % (maxMs + 1);
  };
};

const DEPTH_CLOCK_START = 1_800_000_000_000;
const DEPTH_KEPT_MS = 100 * DAY_MS;

export type DepthRead = { start: number; end: number };

/** One request a world answered, and the depth it met on arrival. */
export type DepthCall = {
  series: string;
  read: DepthRead;
  refused: boolean;
  sentAtMs: number;
  arrivalMs: number;
  edgeMs: number;
};

type Row = { id: number };

/**
 * A span of 30 days that the depth `edgeMs` crosses: ten days of refused ground, twenty of kept.
 */
export const crossingOf = (edgeMs: number): DepthRead => ({
  start: edgeMs - 10 * DAY_MS,
  end: edgeMs + 20 * DAY_MS,
});

/** A request is a probe when it asks for one millisecond. */
export const isProbeRead = (read: DepthRead): boolean => read.end - read.start === 1;

/**
 * The run with its gate suspended: the clock jumps by `ms` inside the wait number `atWait` of the
 * gate (each request is preceded by one wait), as it does when the app is suspended in a wait.
 */
export const suspendableRun = (input: {
  run: BinanceHistoryRun;
  clock: { now: number };
  suspensions: { atWait: number; ms: number }[];
}): BinanceHistoryRun => {
  const { run, clock, suspensions } = input;
  const waits = { count: 0 };

  return {
    budget: run.budget,
    gate: {
      wait: async () => {
        await run.gate.wait();
        waits.count += 1;
        clock.now += suspensions.find((suspension) => suspension.atWait === waits.count)?.ms ?? 0;
      },
    },
  };
};

/**
 * A Binance that keeps `keptMsOf(series)` of a clock that every request moves on by its latency
 * and every wait of the run gate by its sleep. Its depth moves in steps of `stepMs` (1: with the
 * clock). The app is suspended for `ms` inside the wait number `atWait` of the run gate (each
 * request is preceded by one wait). `refuseWhen` replaces the depth as the judge of a request.
 * A run without a call cap (`uncapped`) lets every series narrow in full.
 */
export const depthWorldOf = (input: {
  latencyMs: (read: DepthRead) => number;
  stepMs?: number;
  keptMsOf?: (series: string) => number;
  suspensions?: { atWait: number; ms: number }[];
  refuseWhen?: (read: DepthRead, callNumber: number) => boolean;
  uncapped?: boolean;
}) => {
  const { latencyMs, stepMs = 1, keptMsOf = () => DEPTH_KEPT_MS, suspensions = [] } = input;
  const { clock, newRun } = movingClockOf(DEPTH_CLOCK_START);
  const capped = newRun();
  const run = suspendableRun({
    run: input.uncapped
      ? { gate: capped.gate, budget: { canAfford: () => true, record: () => undefined } }
      : capped,
    clock,
    suspensions,
  });
  const depth: DepthGuard = {
    isRefusal: (error) => error instanceof BinanceHistoryTooOldError,
    nowMs: () => clock.now,
    floorMs: () => clock.now - 179 * DAY_MS,
    ...createDepthMemories(() => clock.now),
  };
  const calls: DepthCall[] = [];
  const edgeOf = (series: string, atMs: number): number =>
    Math.floor((atMs - keptMsOf(series)) / stepMs) * stepMs;

  const fetchPage = async (series: string, read: DepthRead, _current: number) => {
    const sentAtMs = clock.now;
    clock.now += latencyMs(read);
    const edgeMs = edgeOf(series, clock.now);
    const refused = input.refuseWhen?.(read, calls.length + 1) ?? read.start < edgeMs;
    calls.push({ series, read: { ...read }, refused, sentAtMs, arrivalMs: clock.now, edgeMs });

    if (refused) {
      throw new BinanceHistoryTooOldError('too old');
    }

    return {
      rows: [],
      unreadable: [],
      gathered: 0,
      total: 0,
      usedUidWeight1m: undefined,
      usedIpWeight1m: undefined,
    };
  };

  return { clock, run, depth, calls, fetchPage, edgeOf };
};

type DepthWorld = ReturnType<typeof depthWorldOf>;

const seriesNamesOf = (count: number): string[] =>
  Array.from({ length: count }, (_unused, index) => `T${index}`);

/** A read of `count` series of `span` (a span that crosses the depth of the start by default). */
export const readDepthWorld = (
  world: DepthWorld,
  over: { count?: number; span?: DepthRead; fetchPage?: DepthWorld['fetchPage'] } = {},
) =>
  readSeriesSpan<string, Row>({
    run: world.run,
    lane: 'transfer',
    cost: COSTS.transfer,
    span: over.span ?? crossingOf(world.edgeOf('T0', world.clock.now)),
    keep: 0,
    series: seriesNamesOf(over.count ?? 1),
    maxPages: 50,
    fetchPage: over.fetchPage ?? world.fetchPage,
    onRateLimit: () => undefined,
    depth: world.depth,
  });

export const refusedReadsOf = (calls: DepthCall[]): DepthCall[] =>
  calls.filter(({ read, refused }) => refused && !isProbeRead(read));

/** The refused reads of a span: those that end where it does, not those of a band below a read. */
export const refusedSpanReadsOf = (calls: DepthCall[], span: DepthRead): DepthCall[] =>
  refusedReadsOf(calls).filter(({ read }) => read.end === span.end);

/**
 * The ground a served read skipped: how far its start lay above the depth it met on arrival, for
 * the reads of more than a millisecond.
 */
export const skippedMsOf = (calls: DepthCall[]): number[] =>
  calls
    .filter(({ read, refused }) => !refused && !isProbeRead(read))
    .map(({ read, edgeMs }) => read.start - edgeMs);

/** The ground a span read left owed, each piece in the one series that owes it. */
type DepthOwed = { series: string; window: DepthRead }[];

/**
 * The ground a series left neither read nor owed: how far the start its series holds ground from
 * (the lowest start of its served reads, a band included; the start of the ground it owes, when it
 * owes some) lay above the depth that read met on arrival. A narrowing leaves up to its
 * resolution, ground that lies within it of a start Binance refused.
 */
export const unowedSkippedMsOf = (calls: DepthCall[], owed: DepthOwed): number[] => {
  const lowestBySeries = new Map<string, DepthCall>();

  for (const call of calls.filter(({ read, refused }) => !refused && !isProbeRead(read))) {
    const lowest = lowestBySeries.get(call.series);

    if (lowest === undefined || call.read.start < lowest.read.start) {
      lowestBySeries.set(call.series, call);
    }
  }

  return [...lowestBySeries.values()].map(
    ({ series, read, edgeMs }) =>
      (owed.find((entry) => entry.series === series)?.window.start ?? read.start) - edgeMs,
  );
};

/** The ground of a span read that was left owed (none for a span that was not read as a page). */
export const owedOf = (result: Awaited<ReturnType<typeof readDepthWorld>>): DepthOwed =>
  result?.kind === 'page' ? (result.page.owed ?? []) : [];

/** The series of a span read that were read whole. */
export const readSeriesOf = (result: Awaited<ReturnType<typeof readDepthWorld>>): string[] =>
  result?.kind === 'page' ? result.page.read.map(({ series }) => series) : [];
