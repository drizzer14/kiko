import { DAY_MS } from '@kiko/dates';

import {
  createDepthMemory,
  DEPTH_MARGIN_MS,
  DEPTH_RESOLUTION_MS,
  knownStartOf,
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
});
