// Semgrep fixture (NEGATIVE, NESTED): mirrors bucket-example.bad.ts's own
// path (see that fixture's header). A Date built once per row in a one-off
// pass, or once per bucket, is linear work; neither nests one inside the
// other, so the rule stays silent here.
import { startOfLocalDay } from '@kiko/dates';

type Row = { time: number; amount: number };

export const rowDays = (rows: Row[]): number[] => rows.map((row) => startOfLocalDay(row.time));

export const rowLabels = (rows: Row[]): string[] =>
  rows.map((row) => {
    const day = new Date(startOfLocalDay(row.time));

    return day.toISOString();
  });

export const bucketDates =(buckets: number[]): Date[] => buckets.map((bucket) => new Date(bucket));

export const rowsOnDay = (rows: Row[], time: number): Row[] => {
  const targetDay = startOfLocalDay(time);

  return rows.filter((row) => row.time >= targetDay);
};

export const countByBucket = (buckets: number[], rows: Row[]): number[] => {
  const days = rowDays(rows);

  return buckets.map((bucket) => days.filter((day) => day <= bucket).length);
};
