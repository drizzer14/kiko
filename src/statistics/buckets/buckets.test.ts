import { DAY_MS, startOfLocalDay } from '@kiko/dates';

import { bucketDaysForSpan, bucketTimes, periodStartBucketTimes } from './buckets';

describe('bucketDaysForSpan', () => {
  it('keeps daily buckets for a short span', () => {
    expect(bucketDaysForSpan(30 * DAY_MS)).toBe(1);
    expect(bucketDaysForSpan(180 * DAY_MS)).toBe(1);
  });

  it('coarsens to weekly buckets once the span passes ~180 days', () => {
    expect(bucketDaysForSpan(181 * DAY_MS)).toBe(7);
    expect(bucketDaysForSpan(3 * 365 * DAY_MS)).toBe(7);
  });
});

describe('bucketTimes', () => {
  it('steps daily from `from` and always closes on `to`', () => {
    const from = Date.UTC(2026, 0, 1);
    const to = from + 2 * DAY_MS;

    expect(bucketTimes(from, to, 1)).toEqual([from, from + DAY_MS, to]);
  });

  it('bounds the point count on a multi-year span via the coarser bucket', () => {
    const from = Date.UTC(2026, 0, 1);
    const to = from + 3 * 365 * DAY_MS;

    const times = bucketTimes(from, to, bucketDaysForSpan(to - from));

    const dayCount = (to - from) / DAY_MS; // ~1095 daily buckets
    expect(times.length).toBeLessThan(dayCount / 5);
  });

  it('always includes `to` even when the last step overshoots it', () => {
    const from = Date.UTC(2026, 0, 1);
    const to = from + 10 * DAY_MS;

    const times = bucketTimes(from, to, 7);

    expect(times[times.length - 1]).toBe(to);
    // from, from+7d, then the closing `to` (from+10d).
    expect(times).toEqual([from, from + 7 * DAY_MS, to]);
  });
});

describe('periodStartBucketTimes', () => {
  it('steps daily from `from`, stopping at the last period that starts at or before `to`', () => {
    const from = Date.UTC(2026, 0, 1);
    // `to` sits 12 hours into day 2 — not a period-start instant, unlike
    // bucketTimes' own always-append-`to` behavior.
    const to = from + 2 * DAY_MS + 12 * 60 * 60 * 1000;

    expect(periodStartBucketTimes(from, to, 1)).toEqual([from, from + DAY_MS, from + 2 * DAY_MS]);
  });

  it('never appends a trailing bucket past the last period start (no phantom point)', () => {
    const from = Date.UTC(2026, 0, 1);
    const to = from + 29 * DAY_MS + 23 * 60 * 60 * 1000 + 59 * 60 * 1000 + 59_999;

    const times = periodStartBucketTimes(from, to, 1);

    expect(times).toHaveLength(30);
    expect(times[times.length - 1]).toBe(from + 29 * DAY_MS);
  });

  it('appends `to` as a second point on a single-day range, so a Polyline still has a line to draw', () => {
    const from = Date.UTC(2026, 0, 1);
    const to = from + 23 * 60 * 60 * 1000 + 59 * 60 * 1000 + 59_999;

    expect(periodStartBucketTimes(from, to, 1)).toEqual([from, to]);
  });

  it('includes a period start that lands exactly on `to`', () => {
    const from = Date.UTC(2026, 0, 1);
    const to = from + 3 * DAY_MS;

    expect(periodStartBucketTimes(from, to, 1)).toEqual([
      from,
      from + DAY_MS,
      from + 2 * DAY_MS,
      to,
    ]);
  });
});

describe('DST correctness (Europe/Kyiv, autumn fall-back)', () => {
  // Kyiv's 2026 fall-back (last Sunday of October) falls inside this
  // 31-day, one-bucket-per-day span — a fixed-DAY_MS step used to land an
  // hour early (23:00 the previous calendar day) for every bucket after it,
  // which could duplicate a calendar day or add an extra 32nd bucket.
  it('periodStartBucketTimes never duplicates a calendar day and every bucket sits at local midnight', () => {
    const from = new Date(2026, 9, 1).getTime(); // 1 Oct 2026, local midnight
    const to = new Date(2026, 9, 31).getTime(); // 31 Oct 2026, local midnight

    const times = periodStartBucketTimes(from, to, 1);

    expect(times).toHaveLength(31);

    for (const t of times) {
      expect(t).toBe(startOfLocalDay(t));
    }
    expect(new Set(times.map((t) => new Date(t).toDateString())).size).toBe(times.length);
  });

  it('bucketTimes never duplicates a calendar day for its own period-start buckets across the same change', () => {
    const from = new Date(2026, 9, 1).getTime();
    const to = new Date(2026, 9, 31).getTime();

    const times = bucketTimes(from, to, 1);
    const periodStarts = times.slice(0, -1); // every bucket except the closing `to` marker

    for (const t of periodStarts) {
      expect(t).toBe(startOfLocalDay(t));
    }
    expect(new Set(periodStarts.map((t) => new Date(t).toDateString())).size).toBe(
      periodStarts.length,
    );
  });
});
