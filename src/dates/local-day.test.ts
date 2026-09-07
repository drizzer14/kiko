import { endOfLocalDay, startOfLocalDay } from './local-day';

describe('startOfLocalDay', () => {
  it('returns local midnight of the calendar day `time` falls on', () => {
    const midAfternoon = new Date(2026, 5, 15, 14, 30, 0, 0).getTime();

    expect(startOfLocalDay(midAfternoon)).toBe(new Date(2026, 5, 15).getTime());
  });
});

describe('endOfLocalDay across DST', () => {
  // Node re-reads `TZ` per `Date` operation, so it is safe to flip it around a
  // single assertion rather than for the whole file — but per
  // src/holdings/interest.test.ts's existing pattern, restore the previous
  // value afterwards so later tests in the same run are unaffected.
  const withTimeZone = (zone: string, run: () => void): void => {
    const previous = process.env.TZ;
    process.env.TZ = zone;
    run();
    process.env.TZ = previous;
  };

  it('spans 25 hours on the fall-back day', () => {
    // Europe/Kyiv falls back on 2026-10-25.
    withTimeZone('Europe/Kyiv', () => {
      const midnight = new Date(2026, 9, 25).getTime();

      expect(endOfLocalDay(midnight) - midnight).toBe(25 * 60 * 60 * 1000 - 1);
    });
  });

  it('spans 23 hours on the spring-forward day', () => {
    // Europe/Kyiv springs forward on 2026-03-29.
    withTimeZone('Europe/Kyiv', () => {
      const midnight = new Date(2026, 2, 29).getTime();

      expect(endOfLocalDay(midnight) - midnight).toBe(23 * 60 * 60 * 1000 - 1);
    });
  });

  it('ends one millisecond before the next local midnight', () => {
    const midnight = new Date(2026, 5, 15).getTime();

    expect(endOfLocalDay(midnight)).toBe(new Date(2026, 5, 16).getTime() - 1);
  });

  it('keeps a 23:30 instant inside its own day on the fall-back day', () => {
    withTimeZone('Europe/Kyiv', () => {
      const at2330 = new Date(2026, 9, 25, 23, 30).getTime();

      expect(at2330).toBeLessThanOrEqual(endOfLocalDay(new Date(2026, 9, 25).getTime()));
    });
  });

  it('spans a normal (non-DST) 24-hour day', () => {
    const midnight = new Date(2026, 5, 15).getTime();

    expect(endOfLocalDay(midnight) - midnight).toBe(24 * 60 * 60 * 1000 - 1);
  });
});
