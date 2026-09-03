import { bucketDaysForSpan, bucketTimes } from './buckets';

const DAY = 86_400_000;

describe('bucketDaysForSpan', () => {
  it('keeps daily buckets for a short span', () => {
    expect(bucketDaysForSpan(30 * DAY)).toBe(1);
    expect(bucketDaysForSpan(180 * DAY)).toBe(1);
  });

  it('coarsens to weekly buckets once the span passes ~180 days', () => {
    expect(bucketDaysForSpan(181 * DAY)).toBe(7);
    expect(bucketDaysForSpan(3 * 365 * DAY)).toBe(7);
  });
});

describe('bucketTimes', () => {
  it('steps daily from `from` and always closes on `to`', () => {
    const from = Date.UTC(2026, 0, 1);
    const to = from + 2 * DAY;

    expect(bucketTimes(from, to, 1)).toEqual([from, from + DAY, to]);
  });

  it('bounds the point count on a multi-year span via the coarser bucket', () => {
    const from = Date.UTC(2026, 0, 1);
    const to = from + 3 * 365 * DAY;

    const times = bucketTimes(from, to, bucketDaysForSpan(to - from));

    const dayCount = (to - from) / DAY; // ~1095 daily buckets
    expect(times.length).toBeLessThan(dayCount / 5);
  });

  it('always includes `to` even when the last step overshoots it', () => {
    const from = Date.UTC(2026, 0, 1);
    const to = from + 10 * DAY;

    const times = bucketTimes(from, to, 7);

    expect(times[times.length - 1]).toBe(to);
    // from, from+7d, then the closing `to` (from+10d).
    expect(times).toEqual([from, from + 7 * DAY, to]);
  });
});
