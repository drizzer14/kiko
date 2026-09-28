import { DAY_MS } from '@kiko/dates';

// Past this line-window span the daily bucket count would grow unbounded, so
// the series coarsens to a weekly bucket to keep the point count sane.
const COARSE_BUCKET_THRESHOLD_DAYS = 180;
const WEEKLY_BUCKET_DAYS = 7;
const DAILY_BUCKET_DAYS = 1;

// The bucket width (in days) for a line window of `spanMs`: daily for short
// ranges, weekly once the span passes the coarsening threshold so a multi-year
// window renders a bounded number of buckets instead of ~one per day.
export const bucketDaysForSpan = (spanMs: number): number =>
  spanMs > COARSE_BUCKET_THRESHOLD_DAYS * DAY_MS ? WEEKLY_BUCKET_DAYS : DAILY_BUCKET_DAYS;

// The bucket instants across the range: `from`, then one per `bucketDays` step,
// always closing on `to` so the window's start and end are both represented.
export const bucketTimes = (from: number, to: number, bucketDays: number): number[] => {
  const step = bucketDays * DAY_MS;
  const times: number[] = [];

  for (let t = from; t < to; t += step) {
    times.push(t);
  }
  times.push(to);

  return times;
};

/**
 * The PERIOD-START instants only — `from`, then one per `bucketDays` step, up
 * to and including the last period that starts at or before `to` — with no
 * separate closing marker at `to` itself. A per-period series (the category
 * trend) folds every value into the period-start bucket that contains it
 * (`bucketIndexFor`), so `to` is virtually never a period-start instant itself
 * (production always passes an `endOfLocalDay` — the last MILLISECOND of a
 * day, not its start): `bucketTimes`' own trailing `push(to)` therefore added
 * an extra bucket instant that could never receive a real value, a permanent
 * phantom zero point at the end of every per-period line. The net-worth line
 * keeps `bucketTimes`' closing `to` point on purpose (a "now" snapshot at the
 * exact range end); a per-period series uses this instead.
 *
 * A range short enough to fit ONE period (a single-day range with daily
 * buckets) is the one exception: it produces exactly one point, which a
 * `Polyline` cannot draw a visible line from (kiko-charts: a line needs >= 2
 * points), so `to` is appended as a second point there — the same two-point
 * shape a single-day range always had, before the trailing marker was
 * dropped for every OTHER range. A multi-bucket range is unaffected: every
 * real value already lands in its own period-start bucket, so no phantom
 * point is reintroduced there.
 */
export const periodStartBucketTimes = (from: number, to: number, bucketDays: number): number[] => {
  const step = bucketDays * DAY_MS;
  const times: number[] = [];

  for (let t = from; t <= to; t += step) {
    times.push(t);
  }

  if (times.length === 1 && times[0] !== to) {
    times.push(to);
  }

  return times;
};
