import { clampToToday, endOfLocalDay, startOfLocalDay } from './local-day';

describe('startOfLocalDay', () => {
  it('returns local midnight of the calendar day `time` falls on', () => {
    const midAfternoon = new Date(2026, 5, 15, 14, 30, 0, 0).getTime();

    expect(startOfLocalDay(midAfternoon)).toBe(new Date(2026, 5, 15).getTime());
  });
});

describe('endOfLocalDay across DST', () => {
  it('spans 25 hours on the fall-back day', () => {
    // Europe/Kyiv falls back on 2026-10-25.
    const midnight = new Date(2026, 9, 25).getTime();

    expect(endOfLocalDay(midnight) - midnight).toBe(25 * 60 * 60 * 1000 - 1);
  });

  it('spans 23 hours on the spring-forward day', () => {
    // Europe/Kyiv springs forward on 2026-03-29.
    const midnight = new Date(2026, 2, 29).getTime();

    expect(endOfLocalDay(midnight) - midnight).toBe(23 * 60 * 60 * 1000 - 1);
  });

  it('ends one millisecond before the next local midnight', () => {
    const midnight = new Date(2026, 5, 15).getTime();

    expect(endOfLocalDay(midnight)).toBe(new Date(2026, 5, 16).getTime() - 1);
  });

  it('keeps a 23:30 instant inside its own day on the fall-back day', () => {
    const at2330 = new Date(2026, 9, 25, 23, 30).getTime();

    expect(at2330).toBeLessThanOrEqual(endOfLocalDay(new Date(2026, 9, 25).getTime()));
  });

  it('spans a normal (non-DST) 24-hour day', () => {
    const midnight = new Date(2026, 5, 15).getTime();

    expect(endOfLocalDay(midnight) - midnight).toBe(24 * 60 * 60 * 1000 - 1);
  });
});

describe('clampToToday', () => {
  const now = new Date(2026, 9, 5, 10, 30).getTime();

  it('keeps a past instant', () => {
    const past = new Date(2026, 9, 1, 8, 0).getTime();

    expect(clampToToday(past, now)).toBe(past);
  });

  it('keeps a later time of today, because only the day is capped', () => {
    const laterToday = new Date(2026, 9, 5, 23, 59).getTime();

    expect(clampToToday(laterToday, now)).toBe(laterToday);
  });

  it('keeps the very last millisecond of today', () => {
    expect(clampToToday(endOfLocalDay(now), now)).toBe(endOfLocalDay(now));
  });

  it('pulls a time on a later day back to now', () => {
    const tomorrow = new Date(2026, 9, 6, 0, 0).getTime();

    expect(clampToToday(tomorrow, now)).toBe(now);
  });

  it('keeps the last millisecond of the 25-hour fall-back day', () => {
    const fallBackNow = new Date(2026, 9, 25, 12, 0).getTime();
    const nextMidnight = new Date(2026, 9, 26).getTime();

    expect(clampToToday(nextMidnight - 1, fallBackNow)).toBe(nextMidnight - 1);
    expect(clampToToday(nextMidnight, fallBackNow)).toBe(fallBackNow);
  });
});
