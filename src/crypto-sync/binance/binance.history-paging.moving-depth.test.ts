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
  readDepthWorld,
  refusedReadsOf,
  skippedMsOf,
} from './binance.depth-test-fixtures';
import { BINANCE_REQUEST_INTERVAL_MS } from './binance.history-budget';

const HOUR_MS = 3_600_000;
const REQUEST_LATENCY_MS = 150;
// The most that a read skips right after a narrowing when the depth stands still, however long
// the app was suspended: the resolution of the narrowing, the margin it starts over with, and the
// requests it made after the last one Binance served (24 at the most), each paced and answered.
const SKIPPED_AFTER_SEARCH_MS =
  DEPTH_RESOLUTION_MS + DEPTH_MARGIN_MS + 24 * (BINANCE_REQUEST_INTERVAL_MS + REQUEST_LATENCY_MS);
// The most that a read skips when the depth stands still, whatever the run did.
const SKIPPED_BOUND_MS = DEPTH_RESOLUTION_MS + DEPTH_EXTRAPOLATION_MAX_MS + DEPTH_MARGIN_CAP_MS;

const probesOf = (calls: DepthCall[]): DepthCall[] => calls.filter(({ read }) => isProbeRead(read));

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
      'reads all 20 series of a span, and skips only the ground within the resolution and the margin, when the app is suspended for %s in the middle of the read',
      async (_label, suspendedMs) => {
        const world = depthWorldOf({
          latencyMs: () => REQUEST_LATENCY_MS,
          stepMs,
          suspensions: [{ atWait: 31, ms: suspendedMs }],
        });

        const result = await readDepthWorld(world, { count: 20 });

        expect(result).toMatchObject({ kind: 'page', page: { drifted: [] } });
        expect(result?.kind === 'page' ? result.page.read : []).toHaveLength(20);
        expect(maxOf(skippedMsOf(world.calls))).toBeLessThanOrEqual(SKIPPED_BOUND_MS);
        expect(skippedMsOf(world.calls.slice(30))[0]).toBeLessThanOrEqual(SKIPPED_AFTER_SEARCH_MS);
        expect(refusedReadsOf(world.calls)).toHaveLength(1);
        expect(probesOf(world.calls.slice(30)).length).toBeLessThanOrEqual(24);
        expect(probesOf(world.calls.slice(30)).length).toBeGreaterThan(0);
      },
    );
  });

  it('finds the depth again in at most 1 + ceil(log2(elapsed / resolution)) requests, 17 for 10 hours, when it stood still', async () => {
    const world = depthWorldOf({
      latencyMs: () => 0,
      stepMs: DAY_MS,
      suspensions: [{ atWait: 31, ms: 10 * HOUR_MS }],
    });

    await readDepthWorld(world, { count: 20 });

    expect(probesOf(world.calls.slice(30))).toHaveLength(17);
  });

  it('asks again toward the end of the span, 24 requests at most, when the depth stepped past the start it would have moved on to', async () => {
    const world = depthWorldOf({
      latencyMs: () => 0,
      stepMs: DAY_MS,
      suspensions: [{ atWait: 31, ms: 20 * HOUR_MS }],
    });

    await readDepthWorld(world, { count: 20 });

    const probes = probesOf(world.calls.slice(30));
    expect(probes[0]?.refused).toBe(true);
    expect(probes.length).toBeLessThanOrEqual(24);
    expect(probes.length).toBeGreaterThan(17);
  });

  it('is a clean stop, the span unread, at the second suspension of one span read', async () => {
    const world = depthWorldOf({
      latencyMs: () => 0,
      suspensions: [
        { atWait: 31, ms: 10 * HOUR_MS },
        { atWait: 52, ms: 10 * HOUR_MS },
      ],
    });

    const result = await readDepthWorld(world, { count: 20 });

    expect(result).toBeUndefined();
    expect(world.calls).toHaveLength(50);
  });

  // The memory holds the depth as it was `servedAgoMs` ago, served at that time.
  const worldServedAgo = (servedAgoMs: number, stepMs?: number) => {
    const world = depthWorldOf({ latencyMs: () => 0, stepMs });
    const servedAtMs = world.clock.now - servedAgoMs;
    rememberServedStart(world.depth.memory, {
      startMs: world.edgeOf('T0', servedAtMs),
      servedAtMs,
    });

    return { world, edgeMs: world.edgeOf('T0', world.clock.now) };
  };

  it('moves a start on with the clock up to the time it is moved on for, with no request beyond the read', async () => {
    const { world } = worldServedAgo(DEPTH_EXTRAPOLATION_MAX_MS);

    await readDepthWorld(world);

    expect(world.calls).toHaveLength(1);
    expect(world.calls[0]).toMatchObject({ refused: false });
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

    expect(result).toEqual({ kind: 'page', page: { read: [], drifted: [] } });
    expect(world.calls).toHaveLength(1);
    expect(world.calls[0]).toMatchObject({
      read: { start: span.end, end: span.end + 1 },
      refused: true,
    });
  });

  it('reads a span above the depth from its own start, though the start would have moved on past its end', async () => {
    const { world, edgeMs } = worldServedAgo(5 * HOUR_MS, DAY_MS);
    const span: DepthRead = { start: edgeMs + HOUR_MS, end: edgeMs + 2 * HOUR_MS };

    const result = await readDepthWorld(world, { span, count: 2 });

    expect(result).toMatchObject({ kind: 'page', page: { drifted: [] } });
    expect(result?.kind === 'page' ? result.page.read : []).toHaveLength(2);
    expect(world.calls[0]).toMatchObject({
      read: { start: span.end, end: span.end + 1 },
      refused: false,
    });
    expect(
      world.calls.filter(({ read }) => !isProbeRead(read)).map(({ read }) => read.start),
    ).toEqual([span.start, span.start]);
  });
});

describe('readSeriesSpan, against a refusal of a start whose margin is at the cap', () => {
  it('narrows from the refused start toward the end of the span, and starts the margin over with the start it finds', async () => {
    const world = depthWorldOf({ latencyMs: () => 0 });
    const edgeMs = world.edgeOf('T0', world.clock.now);
    const { memory } = world.depth;
    rememberServedStart(memory, { startMs: edgeMs - 5 * DAY_MS, servedAtMs: world.clock.now });
    widenDepthMargin(memory);
    widenDepthMargin(memory);
    widenDepthMargin(memory);
    expect(memory.marginMs).toBe(DEPTH_MARGIN_CAP_MS);

    const result = await readDepthWorld(world, { count: 3 });

    expect(result).toMatchObject({ kind: 'page', page: { drifted: [] } });
    expect(result?.kind === 'page' ? result.page.read : []).toHaveLength(3);
    expect(refusedReadsOf(world.calls)).toHaveLength(1);
    expect(probesOf(world.calls).length).toBeGreaterThan(0);
    expect(memory.marginMs).toBe(DEPTH_MARGIN_MS);
    expect(memory.startMs ?? 0).toBeGreaterThanOrEqual(edgeMs);
  });

  it('widens the margin of a refusal that is not at the cap, with no request beyond the read', async () => {
    const world = depthWorldOf({ latencyMs: () => 0 });
    const edgeMs = world.edgeOf('T0', world.clock.now);
    const { memory } = world.depth;
    // The start is 5 seconds below the depth: margins of 1, 2 and 4 seconds miss it, 8 reach it.
    rememberServedStart(memory, { startMs: edgeMs - 5_000, servedAtMs: world.clock.now });

    await readDepthWorld(world, { count: 1 });

    expect(world.calls.map(({ refused }) => refused)).toEqual([true, true, true, false]);
    expect(probesOf(world.calls)).toHaveLength(0);
  });
});

describe('readSeriesSpan, against a type whose depth lies above the depth of the others', () => {
  const KEPT_SHORT_MS = 90 * DAY_MS;
  const keptMsOf = (series: string): number => (series === 'T19' ? KEPT_SHORT_MS : 100 * DAY_MS);

  it('reads all 20 series: the type narrows from the start the others share, in the refusals it has left', async () => {
    const world = depthWorldOf({ latencyMs: () => 150, keptMsOf });

    const result = await readDepthWorld(world, { count: 20 });

    expect(result).toMatchObject({ kind: 'page', page: { drifted: [] } });
    expect(result?.kind === 'page' ? result.page.read : []).toHaveLength(20);
    const refusedByLast = refusedReadsOf(world.calls).filter(({ series }) => series === 'T19');
    expect(refusedByLast).toHaveLength(4);
    expect(refusedReadsOf(world.calls)).toHaveLength(5);
    expect(world.depth.memory.marginMs).toBe(DEPTH_MARGIN_MS);
  });

  it('skips only the ground within the resolution and the margin of each type, the short one too', async () => {
    const world = depthWorldOf({ latencyMs: () => 150, keptMsOf });

    await readDepthWorld(world, { count: 20 });

    const served = world.calls.filter(({ read, refused }) => !refused && !isProbeRead(read));
    expect(served).toHaveLength(20);
    expect(maxOf(skippedMsOf(world.calls))).toBeLessThanOrEqual(SKIPPED_AFTER_SEARCH_MS);
    expect(served[19]?.series).toBe('T19');
    expect(served[19]?.read.start).toBeGreaterThanOrEqual(served[19]?.edgeMs ?? 0);
  });
});

describe('readSeriesSpan, against reads that reach Binance later than the probe that found the start', () => {
  const lagOf = (readMs: number) => (read: DepthRead) => (isProbeRead(read) ? 50 : readMs);

  it('reaches a page with a lag of 5 seconds: the margin grows to cover it', async () => {
    const world = depthWorldOf({ latencyMs: lagOf(5_000) });

    const result = await readDepthWorld(world, { count: 20 });

    expect(result).toMatchObject({ kind: 'page', page: { drifted: [] } });
    expect(refusedReadsOf(world.calls).length).toBeLessThan(MAX_DEPTH_REFUSALS);
    expect(maxOf(skippedMsOf(world.calls))).toBeLessThanOrEqual(DEPTH_MARGIN_CAP_MS + 5_000);
  });

  it('is a clean stop, the span unread, with a lag of 10 seconds: the margin is capped at 8 seconds, and a clean stop spends 52 requests at most', async () => {
    const world = depthWorldOf({ latencyMs: lagOf(10_000) });

    const result = await readDepthWorld(world, { count: 20 });

    expect(result).toBeUndefined();
    expect(refusedReadsOf(world.calls)).toHaveLength(MAX_DEPTH_REFUSALS);
    expect(world.calls.length).toBeLessThanOrEqual(MAX_DEPTH_REFUSALS + 2 * 23);
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
    'reaches a page of all 20 series with %s, skipping within the bound',
    async (_name, latencyOf, stepMs) => {
      const latencyMs = latencyOf();
      const world = depthWorldOf({ latencyMs: () => latencyMs(), stepMs });

      const result = await readDepthWorld(world, { count: 20 });

      expect(result).toMatchObject({ kind: 'page', page: { drifted: [] } });
      expect(result?.kind === 'page' ? result.page.read : []).toHaveLength(20);
      expect(maxOf(skippedMsOf(world.calls))).toBeLessThanOrEqual(SKIPPED_BOUND_MS);
    },
  );
});

describe('readSeriesSpan, against the worst case of a span of 30 days', () => {
  it('spends 6 refused reads, 2 narrowings of 23 requests after a refusal and 1 of 24 after a suspension: 76 requests', async () => {
    // Every read is refused and every probe is served, but the first one after the suspension.
    const world = depthWorldOf({
      latencyMs: () => 0,
      suspensions: [{ atWait: 25, ms: 10 * HOUR_MS }],
      refuseWhen: (read, callNumber) => !isProbeRead(read) || callNumber === 25,
    });

    const result = await readDepthWorld(world, { span: crossingOf(world.clock.now) });

    expect(result).toBeUndefined();
    expect(refusedReadsOf(world.calls)).toHaveLength(MAX_DEPTH_REFUSALS);
    expect(world.calls).toHaveLength(MAX_DEPTH_REFUSALS + 2 * 23 + 24);
    expect(world.calls).toHaveLength(76);
  });

  it('spends 6 refused reads and 2 narrowings of 23 requests when no suspension comes: 52 requests', async () => {
    const world = depthWorldOf({ latencyMs: () => 0, refuseWhen: (read) => !isProbeRead(read) });

    const result = await readDepthWorld(world, { span: crossingOf(world.clock.now) });

    expect(result).toBeUndefined();
    expect(world.calls).toHaveLength(MAX_DEPTH_REFUSALS + 2 * 23);
  });
});
