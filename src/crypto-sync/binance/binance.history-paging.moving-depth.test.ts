import { DAY_MS } from '@kiko/dates';
import { maxOf } from '@kiko/numbers';

import {
  DEPTH_EXTRAPOLATION_MAX_MS,
  DEPTH_MARGIN_CAP_MS,
  DEPTH_MARGIN_MS,
  DEPTH_RESOLUTION_MS,
  MAX_DEPTH_REFUSALS,
  rememberServedStart,
  widenDepthMargin,
} from './binance.history-depth';
import {
  crossingOf,
  type DepthCall,
  type DepthRead,
  depthWorldOf,
  isProbeRead,
  jitterMs,
  owedOf,
  readDepthWorld,
  readSeriesOf,
  refusedReadsOf,
  refusedSpanReadsOf,
  unowedSkippedMsOf,
} from './binance.depth-test-fixtures';

const HOUR_MS = 3_600_000;
const REQUEST_LATENCY_MS = 150;
// The most of the ground a read begins above that one series owes: the time since its start was
// served, which moves the start on, and the margin at its cap.
const OWED_BOUND_MS = DEPTH_EXTRAPOLATION_MAX_MS + DEPTH_MARGIN_CAP_MS;

const probesOf = (calls: DepthCall[]): DepthCall[] => calls.filter(({ read }) => isProbeRead(read));

const widthsOf = (owed: { window: DepthRead }[]): number[] =>
  owed.map(({ window }) => window.end - window.start);

/**
 * `count` series read twice over the span that crosses the depth, the app suspended for
 * `suspendedMs` inside the gate wait that opens the second read (and, with `later`, again
 * `afterWaits` waits after it), and the calls of the first read.
 */
const readAcrossSuspension = async (input: {
  count: number;
  stepMs?: number;
  suspendedMs: number;
  later?: { afterWaits: number; ms: number };
}) => {
  const suspensions: { atWait: number; ms: number }[] = [];
  const world = depthWorldOf({
    latencyMs: () => REQUEST_LATENCY_MS,
    stepMs: input.stepMs,
    suspensions,
    uncapped: true,
  });
  const span = crossingOf(world.edgeOf('T0', world.clock.now));
  const first = await readDepthWorld(world, { count: input.count, span });
  const firstCalls = world.calls.length;
  suspensions.push({ atWait: firstCalls + 1, ms: input.suspendedMs });

  if (input.later !== undefined) {
    suspensions.push({ atWait: firstCalls + 1 + input.later.afterWaits, ms: input.later.ms });
  }

  const second = await readDepthWorld(world, { count: input.count, span });

  return { world, span, first, second, firstCalls };
};

describe('readSeriesSpan, against a depth that moves with the clock or in steps of a day, and an app that is suspended', () => {
  describe.each([
    ['with the clock', 1],
    ['in steps of a day', DAY_MS],
  ])('a depth that moves %s', (_name, stepMs) => {
    // The clock starts at 08:00, so a step of a day falls 16 hours into it: only 20 hours cross it.
    it.each([
      ['10 hours, inside one step', 10 * HOUR_MS],
      ['20 hours, across a step', 20 * HOUR_MS],
    ])(
      'reads each series again after %s, reading or owing the ground it read above and skipping nothing beyond the resolution',
      async (_label, suspendedMs) => {
        const { world, span, first, second, firstCalls } = await readAcrossSuspension({
          count: 3,
          stepMs,
          suspendedMs,
        });

        expect(readSeriesOf(second)).toEqual(['T0', 'T1', 'T2']);
        expect(refusedSpanReadsOf(world.calls, span)).toHaveLength(3);
        expect(
          maxOf(unowedSkippedMsOf(world.calls.slice(0, firstCalls), owedOf(first))),
        ).toBeLessThanOrEqual(DEPTH_RESOLUTION_MS);
        // A search that ends against the start the first one found reads or owes the ground from
        // there, so only the resolution of the first search is left.
        expect(
          maxOf(unowedSkippedMsOf(world.calls.slice(firstCalls), owedOf(second))),
        ).toBeLessThanOrEqual(DEPTH_RESOLUTION_MS);
        expect(maxOf(widthsOf(owedOf(second)))).toBeLessThanOrEqual(OWED_BOUND_MS);
        expect(probesOf(world.calls.slice(firstCalls)).length).toBeLessThanOrEqual(3 * 24);
        expect(probesOf(world.calls.slice(firstCalls)).length).toBeGreaterThan(0);
      },
    );
  });

  it('finds the depth of each series again in at most 1 + ceil(log2(elapsed / resolution)) requests, 17 for 10 hours, when it stood still', async () => {
    const { world, firstCalls } = await readAcrossSuspension({
      count: 2,
      stepMs: DAY_MS,
      suspendedMs: 10 * HOUR_MS,
    });

    expect(probesOf(world.calls.slice(firstCalls))).toHaveLength(2 * 17);
  });

  it('asks again toward the end of the span, 24 requests at most for each series, when the depth stepped past the start it would have moved on to', async () => {
    const { world, firstCalls } = await readAcrossSuspension({
      count: 2,
      stepMs: DAY_MS,
      suspendedMs: 20 * HOUR_MS,
    });

    const probes = probesOf(world.calls.slice(firstCalls));
    expect(probes[0]?.refused).toBe(true);
    expect(probes.length).toBeLessThanOrEqual(2 * 24);
    expect(probes.length).toBeGreaterThan(2 * 17);
  });

  it('owes the span in a series that lapses twice in one span read, and reads the others', async () => {
    // The second suspension comes in the wait of the read that follows the 17 probes of the first
    // series.
    const { world, span, second, firstCalls } = await readAcrossSuspension({
      count: 2,
      suspendedMs: 10 * HOUR_MS,
      later: { afterWaits: 18, ms: 10 * HOUR_MS },
    });

    expect(readSeriesOf(second)).toEqual(['T1']);
    expect(owedOf(second)).toContainEqual({ series: 'T0', window: span });
    expect(probesOf(world.calls.slice(firstCalls)).length).toBeLessThan(2 * 24);
  });

  // The memory holds the depth as it was `servedAgoMs` ago, served at that time.
  const worldServedAgo = (servedAgoMs: number, stepMs?: number) => {
    const world = depthWorldOf({ latencyMs: () => 0, stepMs });
    const servedAtMs = world.clock.now - servedAgoMs;
    rememberServedStart(world.depth.memoryOf('T0'), {
      startMs: world.edgeOf('T0', servedAtMs),
      servedAtMs,
    });

    return { world, edgeMs: world.edgeOf('T0', world.clock.now) };
  };

  it('moves a start on with the clock up to the time it is moved on for, with no request beyond the read and the band below it', async () => {
    const { world } = worldServedAgo(DEPTH_EXTRAPOLATION_MAX_MS);

    await readDepthWorld(world);

    expect(world.calls).toHaveLength(2);
    expect(world.calls[0]).toMatchObject({ refused: false });
    expect(world.calls[1]?.read.end).toBe(world.calls[0]?.read.start);
  });

  it('reads the band below the start a read began at right after the read, and owes none of it when the depth stood still', async () => {
    const { world, edgeMs } = worldServedAgo(5_000, DAY_MS);

    const result = await readDepthWorld(world);

    expect(world.calls.map(({ refused }) => refused)).toEqual([false, false]);
    expect(world.calls[1]?.read).toEqual({ start: edgeMs, end: world.calls[0]?.read.start });
    expect(owedOf(result)).toEqual([]);
  });

  it('owes the band below the start a read began at when the depth moved past its start meanwhile', async () => {
    const { world } = worldServedAgo(5_000);

    const result = await readDepthWorld(world);

    expect(world.calls.map(({ refused }) => refused)).toEqual([false, true]);
    expect(owedOf(result)).toEqual([{ series: 'T0', window: world.calls[1]?.read }]);
  });

  it('finds its start by narrowing once a millisecond more has passed', async () => {
    const { world } = worldServedAgo(DEPTH_EXTRAPOLATION_MAX_MS + 1);

    await readDepthWorld(world);

    expect(probesOf(world.calls).length).toBeGreaterThan(0);
  });

  it('asks the end of a span that lies below the depth, and reads it as empty after that request', async () => {
    const { world, edgeMs } = worldServedAgo(5 * HOUR_MS);
    const span: DepthRead = { start: edgeMs - 2 * HOUR_MS, end: edgeMs - HOUR_MS };

    const result = await readDepthWorld(world, { span, count: 2 });

    expect(result).toEqual({ kind: 'page', page: { read: [], drifted: [], owed: [] } });
    expect(world.calls[0]).toMatchObject({
      series: 'T0',
      read: { start: span.end, end: span.end + 1 },
      refused: true,
    });
    expect(world.calls.filter(({ series }) => series === 'T0')).toHaveLength(1);
  });

  it('owes the ground between the start a series was served from and the end of a span, with no request, when the start moved on passes the end', async () => {
    const world = depthWorldOf({ latencyMs: () => 0 });
    const span = crossingOf(world.edgeOf('T0', world.clock.now));
    rememberServedStart(world.depth.memoryOf('T0'), {
      startMs: span.end - 3_000,
      servedAtMs: world.clock.now - 5_000,
    });

    const result = await readDepthWorld(world, { span });

    expect(result).toEqual({
      kind: 'page',
      page: {
        read: [],
        drifted: [],
        owed: [{ series: 'T0', window: { start: span.end - 3_000, end: span.end } }],
      },
    });
    expect(world.calls).toEqual([]);
  });

  it('reads a span above the depth from its own start, though the start would have moved on past its end', async () => {
    const { world, edgeMs } = worldServedAgo(5 * HOUR_MS, DAY_MS);
    const span: DepthRead = { start: edgeMs + HOUR_MS, end: edgeMs + 2 * HOUR_MS };

    const result = await readDepthWorld(world, { span, count: 2 });

    expect(result).toMatchObject({ kind: 'page', page: { drifted: [] } });
    expect(readSeriesOf(result)).toEqual(['T0', 'T1']);
    expect(world.calls[0]).toMatchObject({
      read: { start: span.end, end: span.end + 1 },
      refused: false,
    });
    expect(
      world.calls.filter(({ read }) => !isProbeRead(read)).map(({ read }) => read.start),
    ).toEqual([span.start, span.start]);
  });

  it('never asks a read for a start at or past the end of the span, when a gate wait carries the clock past it without a lapse', async () => {
    const world = depthWorldOf({ latencyMs: () => 0, suspensions: [{ atWait: 1, ms: 60_000 }] });
    const span = crossingOf(world.edgeOf('T0', world.clock.now));
    rememberServedStart(world.depth.memoryOf('T0'), {
      startMs: span.end - 50_000,
      servedAtMs: world.clock.now,
    });

    const result = await readDepthWorld(world, { span });

    expect(readSeriesOf(result)).toEqual(['T0']);
    expect(world.calls).toHaveLength(2);
    expect(world.calls[0]?.read).toEqual({ start: span.end - 1, end: span.end });
    // The band is the ground from the start the memory holds up to that read.
    expect(world.calls[1]?.read).toEqual({ start: span.end - 50_000, end: span.end - 1 });
  });
});

describe('readSeriesSpan, against a refusal of a start whose margin is at the cap', () => {
  it('narrows from the refused start toward the end of the span, and starts the margin over with the start it finds', async () => {
    const world = depthWorldOf({ latencyMs: () => 0 });
    const edgeMs = world.edgeOf('T0', world.clock.now);
    const memory = world.depth.memoryOf('T0');
    rememberServedStart(memory, { startMs: edgeMs - 5 * DAY_MS, servedAtMs: world.clock.now });
    widenDepthMargin(memory);
    widenDepthMargin(memory);
    widenDepthMargin(memory);
    expect(memory.marginMs).toBe(DEPTH_MARGIN_CAP_MS);

    const result = await readDepthWorld(world, { count: 3 });

    expect(result).toMatchObject({ kind: 'page', page: { drifted: [] } });
    expect(readSeriesOf(result)).toEqual(['T0', 'T1', 'T2']);
    expect(
      refusedSpanReadsOf(world.calls, crossingOf(edgeMs)).filter(({ series }) => series === 'T0'),
    ).toHaveLength(1);
    expect(probesOf(world.calls.filter(({ series }) => series === 'T0')).length).toBeGreaterThan(0);
    expect(memory.marginMs).toBe(DEPTH_MARGIN_MS);
    expect(memory.startMs ?? 0).toBeGreaterThanOrEqual(edgeMs);
  });

  it('widens the margin of a refusal that is not at the cap, with no request beyond the read and the band below it, which the depth has passed', async () => {
    const world = depthWorldOf({ latencyMs: () => 0 });
    const edgeMs = world.edgeOf('T0', world.clock.now);
    // The start is 5 seconds below the depth: margins of 1, 2 and 4 seconds miss it, 8 reach it.
    rememberServedStart(world.depth.memoryOf('T0'), {
      startMs: edgeMs - 5_000,
      servedAtMs: world.clock.now,
    });

    await readDepthWorld(world, { count: 1 });

    expect(world.calls.map(({ refused }) => refused)).toEqual([true, true, true, false, true]);
    expect(probesOf(world.calls)).toHaveLength(0);
  });
});

describe('readSeriesSpan, against types that keep a different part of the history', () => {
  const KEPT_MS = 100 * DAY_MS;

  const readKeeping = async (keptMsOf: (series: string) => number) => {
    const world = depthWorldOf({
      latencyMs: () => REQUEST_LATENCY_MS,
      keptMsOf,
      uncapped: true,
    });
    const span = crossingOf(world.edgeOf('T0', world.clock.now));
    const result = await readDepthWorld(world, { count: 20, span });

    return { world, span, result };
  };

  // The last read of the span itself, not the read of the band below its start.
  const lastReadOf = (calls: DepthCall[], series: string, span: DepthRead): DepthCall | undefined =>
    calls
      .filter((call) => call.series === series && !isProbeRead(call.read))
      .filter((call) => call.read.end === span.end)
      .at(-1);

  it.each([
    [
      'a middle type that keeps 90 days',
      (series: string) => (series === 'T10' ? 90 * DAY_MS : KEPT_MS),
    ],
    [
      'the first type, that keeps 90 days',
      (series: string) => (series === 'T0' ? 90 * DAY_MS : KEPT_MS),
    ],
    [
      'the first type, that keeps 110 days',
      (series: string) => (series === 'T0' ? 110 * DAY_MS : KEPT_MS),
    ],
  ])(
    'reads every type from the start it is served from by itself, narrowing alone, when %s',
    async (_label, keptMsOf) => {
      const { world, span, result } = await readKeeping(keptMsOf);

      expect(readSeriesOf(result)).toHaveLength(20);
      expect(refusedReadsOf(world.calls).length).toBeGreaterThanOrEqual(19);
      expect(maxOf(unowedSkippedMsOf(world.calls, owedOf(result)))).toBeLessThanOrEqual(
        DEPTH_RESOLUTION_MS,
      );
      expect(
        readSeriesOf(result).every((series) => {
          const lastRead = lastReadOf(world.calls, series, span);

          return lastRead?.refused === false && lastRead.read.start >= lastRead.edgeMs;
        }),
      ).toBe(true);
    },
  );

  it('does not move the start of a type that keeps more up to the start of one that keeps less', async () => {
    const { world, span } = await readKeeping((series) =>
      series === 'T10' ? 90 * DAY_MS : KEPT_MS,
    );

    const startOf = (series: string): number =>
      lastReadOf(world.calls, series, span)?.read.start ?? Number.NaN;
    expect(startOf('T10') - startOf('T9')).toBeGreaterThan(9 * DAY_MS);
    expect(Math.abs(startOf('T11') - startOf('T9'))).toBeLessThan(DAY_MS);
  });

  it('reads as empty the span of the one type whose depth lies above its end, and reads the others', async () => {
    const { world, result } = await readKeeping((series) =>
      series === 'T10' ? 75 * DAY_MS : KEPT_MS,
    );

    expect(readSeriesOf(result)).not.toContain('T10');
    expect(readSeriesOf(result)).toHaveLength(19);
    expect(owedOf(result).map(({ series }) => series)).not.toContain('T10');
    // The refused read, the start the types before it are served from, and the end of the span.
    expect(world.calls.filter(({ series }) => series === 'T10')).toHaveLength(3);
    expect(maxOf(unowedSkippedMsOf(world.calls, owedOf(result)))).toBeLessThanOrEqual(
      DEPTH_RESOLUTION_MS,
    );
  });
});

describe('readSeriesSpan, against reads that reach Binance later than the probe that found the start', () => {
  const lagOf = (readMs: number) => (read: DepthRead) => (isProbeRead(read) ? 50 : readMs);

  it('reaches a page with a lag of 5 seconds: the margin of each series grows to cover it', async () => {
    const world = depthWorldOf({ latencyMs: lagOf(5_000), uncapped: true });

    const result = await readDepthWorld(world, { count: 20 });

    expect(result).toMatchObject({ kind: 'page', page: { drifted: [] } });
    expect(readSeriesOf(result)).toHaveLength(20);
    expect(refusedReadsOf(world.calls).length).toBeLessThan(20 * MAX_DEPTH_REFUSALS);
    expect(maxOf(unowedSkippedMsOf(world.calls, owedOf(result)))).toBeLessThanOrEqual(
      DEPTH_RESOLUTION_MS,
    );
    expect(maxOf(widthsOf(owedOf(result)))).toBeLessThanOrEqual(OWED_BOUND_MS);
  });

  it('owes the span in each series, with a lag of 10 seconds: the margin is capped at 8 seconds, and a series spends 52 requests at most', async () => {
    const world = depthWorldOf({ latencyMs: lagOf(10_000), uncapped: true });
    const span = crossingOf(world.edgeOf('T0', world.clock.now));

    const result = await readDepthWorld(world, { count: 2, span });

    expect(readSeriesOf(result)).toEqual([]);
    expect(owedOf(result)).toEqual([
      { series: 'T0', window: span },
      { series: 'T1', window: span },
    ]);
    expect(refusedReadsOf(world.calls)).toHaveLength(2 * MAX_DEPTH_REFUSALS);
    expect(world.calls.length).toBeLessThanOrEqual(2 * (MAX_DEPTH_REFUSALS + 2 * 23));
  });
});

describe('readSeriesSpan, against the latencies of a run', () => {
  const spikeEverySeventh = () => {
    let count = 0;

    return () => {
      count += 1;

      return count % 7 === 0 ? 9_000 : 100;
    };
  };

  it.each([
    ['no latency', () => () => 0, 1],
    ['150 ms of latency', () => () => 150, 1],
    ['0 to 300 ms of latency', () => jitterMs(), 1],
    ['0 to 3 seconds of latency', () => jitterMs(3_000), 1],
    ['a spike of 9 seconds on every seventh request', spikeEverySeventh, 1],
    ['150 ms of latency, in steps of a day', () => () => 150, DAY_MS],
    ['a spike of 9 seconds on every seventh request, in steps of a day', spikeEverySeventh, DAY_MS],
  ])(
    'reaches a page of all 20 series with %s, reading or owing the ground each read began above',
    async (_name, latencyOf, stepMs) => {
      const latencyMs = latencyOf();
      const world = depthWorldOf({ latencyMs: () => latencyMs(), stepMs, uncapped: true });

      const result = await readDepthWorld(world, { count: 20 });

      expect(result).toMatchObject({ kind: 'page', page: { drifted: [] } });
      expect(readSeriesOf(result)).toHaveLength(20);
      expect(maxOf(unowedSkippedMsOf(world.calls, owedOf(result)))).toBeLessThanOrEqual(
        DEPTH_RESOLUTION_MS,
      );
      expect(maxOf(widthsOf(owedOf(result)))).toBeLessThanOrEqual(OWED_BOUND_MS);
    },
  );
});

describe('readSeriesSpan, against the worst case of a span of 30 days', () => {
  it('spends 6 refused reads, 2 narrowings of 23 requests after a refusal and 1 of 24 after a suspension: 76 requests, and owes the span', async () => {
    // Every read is refused and every probe is served, but the first one after the suspension.
    const world = depthWorldOf({
      latencyMs: () => 0,
      suspensions: [{ atWait: 25, ms: 10 * HOUR_MS }],
      refuseWhen: (read, callNumber) => !isProbeRead(read) || callNumber === 25,
    });
    const span = crossingOf(world.clock.now);

    const result = await readDepthWorld(world, { span });

    expect(owedOf(result)).toEqual([{ series: 'T0', window: span }]);
    expect(refusedReadsOf(world.calls)).toHaveLength(MAX_DEPTH_REFUSALS);
    expect(world.calls).toHaveLength(MAX_DEPTH_REFUSALS + 2 * 23 + 24);
    expect(world.calls).toHaveLength(76);
  });

  it('spends 6 refused reads and 2 narrowings of 23 requests when no suspension comes: 52 requests', async () => {
    const world = depthWorldOf({ latencyMs: () => 0, refuseWhen: (read) => !isProbeRead(read) });
    const span = crossingOf(world.clock.now);

    const result = await readDepthWorld(world, { span });

    expect(owedOf(result)).toEqual([{ series: 'T0', window: span }]);
    expect(world.calls).toHaveLength(MAX_DEPTH_REFUSALS + 2 * 23);
  });
});
