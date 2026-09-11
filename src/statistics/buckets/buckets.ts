import { DAY_MS } from '../../dates/duration';

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
