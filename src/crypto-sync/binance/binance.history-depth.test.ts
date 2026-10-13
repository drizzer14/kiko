import { DAY_MS } from '@kiko/dates';

import {
  createDepthMemory,
  DEPTH_EXTRAPOLATION_MAX_MS,
  DEPTH_MARGIN_CAP_MS,
  DEPTH_MARGIN_MS,
  DEPTH_RESOLUTION_MS,
  hasDepthLapsed,
  isDepthMarginCapped,
  knownStartOf,
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
});
