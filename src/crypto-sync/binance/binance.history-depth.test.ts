import { DAY_MS } from '@kiko/dates';

import {
  createDepthMemories,
  createDepthMemory,
  DEPTH_EXTRAPOLATION_MAX_MS,
  DEPTH_MARGIN_CAP_MS,
  DEPTH_MARGIN_MS,
  DEPTH_RESOLUTION_MS,
  hasDepthLapsed,
  isDepthMarginCapped,
  knownStartOf,
  lapsedRangeOf,
  narrowLapsedStart,
  narrowRefusedStart,
  rememberServedStart,
  widenDepthMargin,
} from './binance.history-depth';

const START = 1_700_000_000_000;
const WIDTH = 30 * DAY_MS;
const FLOOR = START - DAY_MS;

/** Binance serving every start from `servedFrom` on, and every request asked, in order. */
const binanceServing = (servedFrom: number) => {
  const asked: number[] = [];

  return {
    asked,
    probe: jest.fn(async (startMs: number) => {
      asked.push(startMs);

      return startMs >= servedFrom;
    }),
  };
};

const narrow = (input: {
  probe: (startMs: number) => Promise<boolean | undefined>;
  hintMs?: number;
  refusedMs?: number;
  endMs?: number;
  floorMs?: number;
}) =>
  narrowRefusedStart({
    refusedMs: START,
    endMs: START + WIDTH,
    floorMs: FLOOR,
    ...input,
  });

describe('narrowRefusedStart', () => {
  it('finds the start Binance serves within the resolution above the oldest one, in at most ceil(log2(width / resolution)) + 1 requests', async () => {
    const bound = 1 + Math.ceil(Math.log2(WIDTH / DEPTH_RESOLUTION_MS));

    for (const offset of [1, 7 * DAY_MS, 12 * DAY_MS + 345, WIDTH - 1]) {
      const { probe, asked } = binanceServing(START + offset);

      const narrowed = await narrow({ probe });

      expect(narrowed).toMatchObject({ kind: 'start' });
      const found = (narrowed as { startMs: number }).startMs;
      expect(found).toBeGreaterThanOrEqual(START + offset);
      expect(found - (START + offset)).toBeLessThan(DEPTH_RESOLUTION_MS);
      expect(asked.length).toBeLessThanOrEqual(bound);
      expect(asked.length).toBeGreaterThanOrEqual(bound - 1);
    }
  });

  it('halves the part between the refused start and the served one, and stops once it is no wider than the resolution', async () => {
    const { probe, asked } = binanceServing(START + 1_500);

    const narrowed = await narrow({ probe, endMs: START + 4_000 });

    expect(asked).toEqual([START + 4_000, START + 2_000, START + 1_000]);
    expect(narrowed).toEqual({ kind: 'start', startMs: START + 2_000 });
  });

  it('asks the end of the span first, and every start it asks lies inside the refused start and the end', async () => {
    const { probe, asked } = binanceServing(START + DAY_MS);

    await narrow({ probe });

    expect(asked[0]).toBe(START + WIDTH);
    expect(asked.every((startMs) => startMs > START && startMs <= START + WIDTH)).toBe(true);
  });

  it('serves nothing of a span whose end Binance refuses: the end is where it is read from, after one request', async () => {
    const { probe, asked } = binanceServing(START + WIDTH + 1);

    expect(await narrow({ probe })).toEqual({ kind: 'start', startMs: START + WIDTH });
    expect(asked).toEqual([START + WIDTH]);
  });

  it('is the end of the span when the end is the oldest start Binance serves', async () => {
    const { probe } = binanceServing(START + WIDTH);

    const narrowed = await narrow({ probe });

    expect(narrowed).toMatchObject({ kind: 'start' });
    expect((narrowed as { startMs: number }).startMs).toBe(START + WIDTH);
  });

  it('asks nothing of a span that ends at or before the floor, and says it lies below it', async () => {
    const { probe, asked } = binanceServing(0);

    expect(await narrow({ probe, endMs: FLOOR })).toEqual({ kind: 'floor' });
    expect(await narrow({ probe, endMs: FLOOR - 1 })).toEqual({ kind: 'floor' });
    expect(asked).toEqual([]);
  });

  it('asks about a span that ends one millisecond above the floor', async () => {
    const { probe, asked } = binanceServing(0);

    expect(await narrow({ probe, endMs: FLOOR + 1 })).toMatchObject({ kind: 'start' });
    expect(asked.length).toBeGreaterThan(0);
  });

  it('asks no more once the refused start is within the resolution of the end that is served', async () => {
    const { probe, asked } = binanceServing(0);

    const narrowed = await narrow({
      probe,
      refusedMs: START + WIDTH - DEPTH_RESOLUTION_MS,
    });

    expect(narrowed).toEqual({ kind: 'start', startMs: START + WIDTH });
    expect(asked).toEqual([START + WIDTH]);
  });

  it('halves once more when the refused start is one millisecond wider than the resolution', async () => {
    const { probe, asked } = binanceServing(0);

    await narrow({
      probe,
      refusedMs: START + WIDTH - DEPTH_RESOLUTION_MS - 1,
    });

    expect(asked).toHaveLength(2);
  });

  it('is a clean stop when the budget cannot afford the request at the end, and when it runs out later', async () => {
    const stopAt = (count: number) => {
      let asked = 0;

      return async (startMs: number) => {
        asked += 1;

        return asked > count ? undefined : startMs >= START + DAY_MS;
      };
    };

    expect(await narrow({ probe: stopAt(0) })).toBeUndefined();
    expect(await narrow({ probe: stopAt(3) })).toBeUndefined();
  });
});

describe('narrowRefusedStart, with the start another series is served from as a hint', () => {
  const SECOND_MS = DEPTH_RESOLUTION_MS;
  const HINT = START + 10 * DAY_MS;

  const narrowHinted = (input: {
    probe: (startMs: number) => Promise<boolean | undefined>;
    hintMs?: number;
    refusedMs?: number;
    endMs?: number;
  }) => narrow({ hintMs: HINT, ...input });

  it('asks the hint and the start a second below it, and is done after those two when Binance serves from within a second below the hint', async () => {
    const { probe, asked } = binanceServing(HINT - 300);

    const narrowed = await narrowHinted({ probe });

    expect(asked).toEqual([HINT, HINT - SECOND_MS]);
    expect(narrowed).toEqual({ kind: 'start', startMs: HINT });
  });

  it('goes down by doubling steps from the hint while the starts are served, then halves what is left', async () => {
    const { probe, asked } = binanceServing(HINT - 5 * SECOND_MS);

    const narrowed = await narrowHinted({ probe });

    expect(asked).toEqual([
      HINT,
      HINT - SECOND_MS,
      HINT - 3 * SECOND_MS,
      HINT - 7 * SECOND_MS,
      HINT - 5 * SECOND_MS,
      HINT - 6 * SECOND_MS,
    ]);
    expect(narrowed).toEqual({ kind: 'start', startMs: HINT - 5 * SECOND_MS });
  });

  it('halves from the refused start once the steps down are all served: the hint was far above the start', async () => {
    const { probe, asked } = binanceServing(START + 1);

    const narrowed = await narrowHinted({ probe });

    expect(narrowed).toMatchObject({ kind: 'start' });
    const found = (narrowed as { startMs: number }).startMs;
    expect(found - (START + 1)).toBeLessThan(DEPTH_RESOLUTION_MS);
    expect(asked.slice(0, 6)).toEqual([
      HINT,
      HINT - SECOND_MS,
      HINT - 3 * SECOND_MS,
      HINT - 7 * SECOND_MS,
      HINT - 15 * SECOND_MS,
      HINT - 31 * SECOND_MS,
    ]);
    expect(asked.length).toBeLessThanOrEqual(
      1 + 5 + Math.ceil(Math.log2((10 * DAY_MS) / SECOND_MS)),
    );
  });

  it('narrows from the hint toward the end when Binance refuses the hint: the series keeps less than the one it came from', async () => {
    const { probe, asked } = binanceServing(HINT + 3 * DAY_MS);

    const narrowed = await narrowHinted({ probe });

    expect(asked.slice(0, 2)).toEqual([HINT, START + WIDTH]);
    expect(narrowed).toMatchObject({ kind: 'start' });
    const found = (narrowed as { startMs: number }).startMs;
    expect(found - (HINT + 3 * DAY_MS)).toBeGreaterThanOrEqual(0);
    expect(found - (HINT + 3 * DAY_MS)).toBeLessThan(DEPTH_RESOLUTION_MS);
  });

  it('reads a span whose end Binance refuses as below it, after the hint and the end', async () => {
    const { probe, asked } = binanceServing(START + WIDTH + 1);

    expect(await narrowHinted({ probe })).toEqual({ kind: 'start', startMs: START + WIDTH });
    expect(asked).toEqual([HINT, START + WIDTH]);
  });

  it.each([
    ['at the refused start', START],
    ['below the refused start', START - DAY_MS],
    ['at the end of the span', START + WIDTH],
    ['past the end of the span', START + WIDTH + DAY_MS],
  ])('asks the end first, with no hint, for a hint %s', async (_label, hintMs) => {
    const { probe, asked } = binanceServing(START + DAY_MS);

    await narrowHinted({ probe, hintMs });

    expect(asked[0]).toBe(START + WIDTH);
  });

  it('never asks the hint of a span that ends at or before the floor', async () => {
    const { probe, asked } = binanceServing(0);

    expect(await narrowHinted({ probe, endMs: FLOOR })).toEqual({ kind: 'floor' });
    expect(asked).toEqual([]);
  });

  it('finds the start within the resolution above the oldest one served, whatever the hint', async () => {
    for (const hintMs of [START + 1, START + DAY_MS, HINT, START + WIDTH - 1]) {
      for (const offset of [1, 700, 12 * SECOND_MS, 7 * DAY_MS + 345, WIDTH - 1]) {
        const { probe } = binanceServing(START + offset);

        const narrowed = await narrowHinted({ probe, hintMs });

        const found = (narrowed as { startMs: number }).startMs;
        expect(found).toBeGreaterThanOrEqual(START + offset);
        expect(found - (START + offset)).toBeLessThan(DEPTH_RESOLUTION_MS);
      }
    }
  });

  it('is a clean stop when the budget runs out at the hint, in the steps down, and in the halving', async () => {
    const stopAt = (count: number) => {
      let asked = 0;

      return async (startMs: number) => {
        asked += 1;

        return asked > count ? undefined : startMs >= START + 1;
      };
    };

    for (const count of [0, 2, 8]) {
      expect(await narrowHinted({ probe: stopAt(count) })).toBeUndefined();
    }
  });
});

describe('narrowLapsedStart', () => {
  const HOURS_10_MS = 10 * 3_600_000;

  const narrowLapsed = (input: {
    probe: (startMs: number) => Promise<boolean | undefined>;
    highMs?: number;
    endMs?: number;
    floorMs?: number;
  }) =>
    narrowLapsedStart({
      lowMs: START,
      highMs: START + HOURS_10_MS,
      endMs: START + WIDTH,
      floorMs: FLOOR,
      ...input,
    });

  it('asks the start the memory moved on to first, then halves the part between the start it holds and that one', async () => {
    const { probe, asked } = binanceServing(START + 1_500);

    const narrowed = await narrowLapsed({ probe, highMs: START + 4_000 });

    expect(asked).toEqual([START + 4_000, START + 2_000, START + 1_000]);
    expect(narrowed).toEqual({ kind: 'start', startMs: START + 2_000 });
  });

  it('finds the start within the resolution above the oldest one served, in at most 1 + ceil(log2(elapsed / resolution)) requests: 17 for 10 hours', async () => {
    const bound = 1 + Math.ceil(Math.log2(HOURS_10_MS / DEPTH_RESOLUTION_MS));

    for (const offset of [1, 3_600_000, HOURS_10_MS - 1]) {
      const { probe, asked } = binanceServing(START + offset);

      const narrowed = await narrowLapsed({ probe });

      const found = (narrowed as { startMs: number }).startMs;
      expect(found).toBeGreaterThanOrEqual(START + offset);
      expect(found - (START + offset)).toBeLessThan(DEPTH_RESOLUTION_MS);
      expect(asked.length).toBeLessThanOrEqual(bound);
    }
    expect(bound).toBe(17);
  });

  it('reads from within the resolution of the start it holds when the depth has not moved: no ground is skipped by the time that passed', async () => {
    const { probe } = binanceServing(0);

    const narrowed = await narrowLapsed({ probe });

    expect((narrowed as { startMs: number }).startMs - START).toBeLessThan(DEPTH_RESOLUTION_MS);
  });

  it('goes on toward the end of the span, as a refused start does, when the depth moved past the start it was asked for', async () => {
    const { probe, asked } = binanceServing(START + HOURS_10_MS + 7_000);

    const narrowed = await narrowLapsed({ probe });

    expect(asked.slice(0, 3)).toEqual([START + HOURS_10_MS, START + WIDTH, expect.any(Number)]);
    const found = (narrowed as { startMs: number }).startMs;
    expect(found).toBeGreaterThanOrEqual(START + HOURS_10_MS + 7_000);
    expect(found - (START + HOURS_10_MS + 7_000)).toBeLessThan(DEPTH_RESOLUTION_MS);
    expect(asked.length).toBeLessThanOrEqual(2 + Math.ceil(Math.log2(WIDTH / DEPTH_RESOLUTION_MS)));
  });

  it('is the end of the span when Binance serves nothing of it', async () => {
    const { probe, asked } = binanceServing(START + WIDTH + 1);

    expect(await narrowLapsed({ probe })).toEqual({ kind: 'start', startMs: START + WIDTH });
    expect(asked).toEqual([START + HOURS_10_MS, START + WIDTH]);
  });

  it('asks the end once, and stops there, when the start the memory moved on to lies at or past it and Binance refuses it', async () => {
    const { probe, asked } = binanceServing(START + WIDTH + 1);

    const narrowed = await narrowLapsed({ probe, highMs: START + WIDTH + HOURS_10_MS });

    expect(narrowed).toEqual({ kind: 'start', startMs: START + WIDTH });
    expect(asked).toEqual([START + WIDTH]);
  });

  it('never asks for a start past the end of the span: a start the memory moved on beyond it is asked at the end', async () => {
    const { probe, asked } = binanceServing(START + 2_000);

    const narrowed = await narrowLapsed({ probe, endMs: START + 3_000, highMs: START + DAY_MS });

    expect(asked[0]).toBe(START + 3_000);
    expect(asked.every((startMs) => startMs <= START + 3_000)).toBe(true);
    expect(narrowed).toEqual({ kind: 'start', startMs: START + 2_250 });
  });

  it('asks nothing of a span that ends at or before the floor, and says it lies below it', async () => {
    const { probe, asked } = binanceServing(0);

    expect(await narrowLapsed({ probe, endMs: FLOOR })).toEqual({ kind: 'floor' });
    expect(asked).toEqual([]);
  });

  it('is a clean stop when the budget cannot afford a request, at the first one, in the halving, and past the end', async () => {
    const stopAt = (count: number, servedFrom: number) => {
      let asked = 0;

      return async (startMs: number) => {
        asked += 1;

        return asked > count ? undefined : startMs >= servedFrom;
      };
    };

    expect(await narrowLapsed({ probe: stopAt(0, START) })).toBeUndefined();
    expect(await narrowLapsed({ probe: stopAt(3, START + 5_000) })).toBeUndefined();
    expect(await narrowLapsed({ probe: stopAt(1, START + HOURS_10_MS + 7_000) })).toBeUndefined();
    expect(await narrowLapsed({ probe: stopAt(5, START + HOURS_10_MS + 7_000) })).toBeUndefined();
  });
});

describe('the depth memory', () => {
  const SERVED_AT = START + 5_000;
  const SERVED_START = START + 40 * DAY_MS;

  it('knows no start before anything was asked', () => {
    expect(knownStartOf(createDepthMemory(), SERVED_AT)).toBeUndefined();
  });

  it('moves a served start forward with the clock, and adds the margin for the time a request takes', () => {
    const memory = createDepthMemory();
    rememberServedStart(memory, { startMs: SERVED_START, servedAtMs: SERVED_AT });

    expect(knownStartOf(memory, SERVED_AT)).toBe(SERVED_START + DEPTH_MARGIN_MS);
    expect(knownStartOf(memory, SERVED_AT + 8_400)).toBe(SERVED_START + 8_400 + DEPTH_MARGIN_MS);
    expect(knownStartOf(memory, SERVED_AT + DAY_MS)).toBe(SERVED_START + DAY_MS + DEPTH_MARGIN_MS);
  });

  it('never moves a start back when the clock reads earlier than it did when the start was served', () => {
    const memory = createDepthMemory();
    rememberServedStart(memory, { startMs: SERVED_START, servedAtMs: SERVED_AT });

    expect(knownStartOf(memory, SERVED_AT - 3_600_000)).toBe(SERVED_START + DEPTH_MARGIN_MS);
  });

  it('keeps a refused start where it is: it is a bound below the ground, with no time it was served at', () => {
    const memory = createDepthMemory();
    rememberServedStart(memory, { startMs: SERVED_START, servedAtMs: undefined });

    expect(knownStartOf(memory, SERVED_AT)).toBe(SERVED_START);
    expect(knownStartOf(memory, SERVED_AT + DAY_MS)).toBe(SERVED_START);
  });

  it('doubles the margin each time it is widened, and starts it over with the next served start', () => {
    const memory = createDepthMemory();
    rememberServedStart(memory, { startMs: SERVED_START, servedAtMs: SERVED_AT });

    widenDepthMargin(memory);
    expect(knownStartOf(memory, SERVED_AT)).toBe(SERVED_START + 2 * DEPTH_MARGIN_MS);
    widenDepthMargin(memory);
    expect(knownStartOf(memory, SERVED_AT)).toBe(SERVED_START + 4 * DEPTH_MARGIN_MS);

    rememberServedStart(memory, { startMs: SERVED_START, servedAtMs: SERVED_AT });
    expect(knownStartOf(memory, SERVED_AT)).toBe(SERVED_START + DEPTH_MARGIN_MS);
  });

  it('stops doubling the margin at the cap, which is a refusal the margin cannot answer', () => {
    const memory = createDepthMemory();
    rememberServedStart(memory, { startMs: SERVED_START, servedAtMs: SERVED_AT });

    const margins = [1, 2, 3, 4, 5].map(() => {
      const before = isDepthMarginCapped(memory);
      widenDepthMargin(memory);

      return [before, memory.marginMs];
    });

    expect(margins).toEqual([
      [false, 2 * DEPTH_MARGIN_MS],
      [false, 4 * DEPTH_MARGIN_MS],
      [false, DEPTH_MARGIN_CAP_MS],
      [true, DEPTH_MARGIN_CAP_MS],
      [true, DEPTH_MARGIN_CAP_MS],
    ]);
    expect(knownStartOf(memory, SERVED_AT)).toBe(SERVED_START + DEPTH_MARGIN_CAP_MS);
  });

  it('starts the capped margin over with the next served start', () => {
    const memory = createDepthMemory();
    rememberServedStart(memory, { startMs: SERVED_START, servedAtMs: SERVED_AT });
    widenDepthMargin(memory);
    widenDepthMargin(memory);
    widenDepthMargin(memory);
    expect(isDepthMarginCapped(memory)).toBe(true);

    rememberServedStart(memory, { startMs: SERVED_START + DAY_MS, servedAtMs: SERVED_AT });

    expect(isDepthMarginCapped(memory)).toBe(false);
    expect(memory.marginMs).toBe(DEPTH_MARGIN_MS);
  });

  describe('the time a served start is moved forward by', () => {
    it('has not lapsed for a memory that holds no start, or a start that was refused', () => {
      const refused = createDepthMemory();
      rememberServedStart(refused, { startMs: SERVED_START, servedAtMs: undefined });

      expect(hasDepthLapsed(createDepthMemory(), SERVED_AT + DAY_MS)).toBe(false);
      expect(hasDepthLapsed(refused, SERVED_AT + DAY_MS)).toBe(false);
    });

    it('lapses once the time since the start was served is over the bound, and not at it', () => {
      const memory = createDepthMemory();
      rememberServedStart(memory, { startMs: SERVED_START, servedAtMs: SERVED_AT });

      expect(hasDepthLapsed(memory, SERVED_AT + DEPTH_EXTRAPOLATION_MAX_MS)).toBe(false);
      expect(hasDepthLapsed(memory, SERVED_AT + DEPTH_EXTRAPOLATION_MAX_MS + 1)).toBe(true);
    });

    it('has not lapsed when the clock reads earlier than it did when the start was served', () => {
      const memory = createDepthMemory();
      rememberServedStart(memory, { startMs: SERVED_START, servedAtMs: SERVED_AT });

      expect(hasDepthLapsed(memory, SERVED_AT - DAY_MS)).toBe(false);
    });
  });

  describe('the ground a lapsed memory leaves open', () => {
    const LAPSED_AT = SERVED_AT + DEPTH_EXTRAPOLATION_MAX_MS + 1;
    const movedOnMs = SERVED_START + DEPTH_EXTRAPOLATION_MAX_MS + 1 + DEPTH_MARGIN_MS;
    const lapsedMemory = () => {
      const memory = createDepthMemory();
      rememberServedStart(memory, { startMs: SERVED_START, servedAtMs: SERVED_AT });

      return memory;
    };

    it('reaches from the start the memory holds to the start it would move on to, for a span that starts below it', () => {
      expect(lapsedRangeOf(lapsedMemory(), LAPSED_AT, movedOnMs - 1)).toEqual({
        lowMs: SERVED_START,
        highMs: movedOnMs,
      });
      expect(lapsedRangeOf(lapsedMemory(), LAPSED_AT, SERVED_START - DAY_MS)).toEqual({
        lowMs: SERVED_START,
        highMs: movedOnMs,
      });
    });

    it('leaves none open for a span that starts at or above the start the memory would move on to', () => {
      expect(lapsedRangeOf(lapsedMemory(), LAPSED_AT, movedOnMs)).toBeUndefined();
      expect(lapsedRangeOf(lapsedMemory(), LAPSED_AT, movedOnMs + DAY_MS)).toBeUndefined();
    });

    it('leaves none open while the memory has not lapsed, or holds a refused start or none', () => {
      const refused = createDepthMemory();
      rememberServedStart(refused, { startMs: SERVED_START, servedAtMs: undefined });

      expect(
        lapsedRangeOf(lapsedMemory(), SERVED_AT + DEPTH_EXTRAPOLATION_MAX_MS, START),
      ).toBeUndefined();
      expect(lapsedRangeOf(refused, LAPSED_AT, START)).toBeUndefined();
      expect(lapsedRangeOf(createDepthMemory(), LAPSED_AT, START)).toBeUndefined();
    });
  });
});

describe('the depth memories of the series of a run', () => {
  const NOW_MS = START + 5_000;
  const memoriesAt = (nowMs: () => number = () => NOW_MS) => createDepthMemories(nowMs);

  it('gives each series a memory of its own, the same one every time', () => {
    const { memoryOf } = memoriesAt();

    expect(memoryOf('MAIN_FUNDING')).toBe(memoryOf('MAIN_FUNDING'));
    expect(memoryOf('MAIN_FUNDING')).not.toBe(memoryOf('FUNDING_MAIN'));
  });

  it('writes the start one series is served from into its memory alone', () => {
    const { memoryOf } = memoriesAt();

    rememberServedStart(memoryOf('MAIN_FUNDING'), { startMs: START, servedAtMs: NOW_MS });

    expect(memoryOf('FUNDING_MAIN').startMs).toBeUndefined();
  });

  it('hints nothing while no series is known to be served from a start', () => {
    const { memoryOf, hintMs } = memoriesAt();
    rememberServedStart(memoryOf('MAIN_FUNDING'), { startMs: START, servedAtMs: undefined });

    expect(hintMs()).toBeUndefined();
  });

  it('hints the start the series served most recently is served from, moved on to now', () => {
    const clock = { now: NOW_MS };
    const { memoryOf, hintMs } = memoriesAt(() => clock.now);
    rememberServedStart(memoryOf('MAIN_FUNDING'), { startMs: START, servedAtMs: NOW_MS - 2_000 });
    rememberServedStart(memoryOf('FUNDING_MAIN'), { startMs: START + 700, servedAtMs: NOW_MS });
    clock.now = NOW_MS + 3_000;

    expect(hintMs()).toBe(START + 700 + 3_000 + DEPTH_MARGIN_MS);
  });

  it('hints nothing from a start that was served longer ago than it is moved on for', () => {
    const clock = { now: NOW_MS };
    const { memoryOf, hintMs } = memoriesAt(() => clock.now);
    rememberServedStart(memoryOf('MAIN_FUNDING'), { startMs: START, servedAtMs: NOW_MS });
    clock.now = NOW_MS + DEPTH_EXTRAPOLATION_MAX_MS + 1;

    expect(hintMs()).toBeUndefined();
  });

  it('leaves the series that asks out of its own hint', () => {
    const { memoryOf, hintMs } = memoriesAt();
    rememberServedStart(memoryOf('MAIN_FUNDING'), { startMs: START, servedAtMs: NOW_MS });
    rememberServedStart(memoryOf('FUNDING_MAIN'), { startMs: START + 700, servedAtMs: NOW_MS - 1 });

    expect(hintMs('MAIN_FUNDING')).toBe(START + 700 + DEPTH_MARGIN_MS + 1);
    expect(hintMs('FUNDING_MAIN')).toBe(START + DEPTH_MARGIN_MS);
    expect(hintMs('OPTION_FUNDING')).toBe(START + DEPTH_MARGIN_MS);

    memoryOf('FUNDING_MAIN').servedAtMs = undefined;
    expect(hintMs('MAIN_FUNDING')).toBeUndefined();
  });

  it('reports the furthest start any series was refused, and negative infinity while none was', () => {
    const { memoryOf, refusedBoundMs } = memoriesAt();
    expect(refusedBoundMs()).toBe(Number.NEGATIVE_INFINITY);

    rememberServedStart(memoryOf('MAIN_FUNDING'), { startMs: START, servedAtMs: NOW_MS });
    expect(refusedBoundMs()).toBe(Number.NEGATIVE_INFINITY);

    rememberServedStart(memoryOf('FUNDING_MAIN'), { startMs: START + 5, servedAtMs: undefined });
    rememberServedStart(memoryOf('MAIN_MARGIN'), { startMs: START + 9, servedAtMs: undefined });
    rememberServedStart(memoryOf('MARGIN_MAIN'), { startMs: START + 2, servedAtMs: undefined });
    expect(refusedBoundMs()).toBe(START + 9);
  });

  describe('the bands of the series, once a band was refused', () => {
    it('expects no band to be refused while none was', () => {
      const { isBandRefused } = memoriesAt();

      expect(isBandRefused(START)).toBe(false);
    });

    it('expects a band that starts at or below the refused one, moved on by the time since, to be refused', () => {
      const clock = { now: NOW_MS };
      const { rememberRefusedBand, isBandRefused } = memoriesAt(() => clock.now);
      rememberRefusedBand(START);

      expect(isBandRefused(START)).toBe(true);
      expect(isBandRefused(START - DAY_MS)).toBe(true);
      expect(isBandRefused(START + 1)).toBe(false);

      clock.now = NOW_MS + 5_000;
      expect(isBandRefused(START + 5_000)).toBe(true);
      expect(isBandRefused(START + 5_001)).toBe(false);
    });

    it('does not move the refused band back when the clock reads earlier than it did', () => {
      const clock = { now: NOW_MS };
      const { rememberRefusedBand, isBandRefused } = memoriesAt(() => clock.now);
      rememberRefusedBand(START);

      clock.now = NOW_MS - 5_000;

      expect(isBandRefused(START)).toBe(true);
      expect(isBandRefused(START + 1)).toBe(false);
    });

    it('moves on with the band refused last', () => {
      const clock = { now: NOW_MS };
      const { rememberRefusedBand, isBandRefused } = memoriesAt(() => clock.now);
      rememberRefusedBand(START);
      clock.now = NOW_MS + 2_000;
      rememberRefusedBand(START + 2_000);
      clock.now = NOW_MS + 3_000;

      expect(isBandRefused(START + 3_000)).toBe(true);
      expect(isBandRefused(START + 3_001)).toBe(false);
    });
  });
});
