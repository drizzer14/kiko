// Semgrep fixture (POSITIVE, NESTED): kiko-no-per-bucket-date-in-statistics
// carries a path-prefixed `paths.include` (`src/statistics/**`), which draws
// NOTHING against a fixture placed directly in rules/fixtures/ (kiko-linter's
// "Semgrep facts" gotcha), so this fixture mirrors a real src/statistics/
// path instead. Every pinned line builds a Date once per row AND once per
// bucket. A nested-callback finding reports the OUTER call's line, so its pin
// sits above the outer `buckets.map(`, whether that callback has an
// expression body or a block body.
import { startOfLocalDay } from '@kiko/dates';

type Row = { time: number; amount: number };

export const cumulativeByBucket = (buckets: number[], rows: Row[]): number[] =>
  // EXPECT-FINDING
  buckets.map((bucket) =>
    rows
      .filter((row) => startOfLocalDay(row.time) <= startOfLocalDay(bucket))
      .reduce((sum, row) => sum + row.amount, 0),
  );

export const countByBucket = (buckets: number[], rows: Row[]): number[] => {
  const counts: number[] = [];

  for (const bucket of buckets) {
    // EXPECT-FINDING
    counts.push(rows.filter((row) => new Date(row.time).getTime() <= bucket).length);
  }

  return counts;
};

export const totalByBucket = (buckets: number[], rows: Row[]): number[] =>
  // EXPECT-FINDING
  buckets.map((bucket) =>
    rows.reduce((sum, row) => (new Date(row.time).getTime() <= bucket ? sum + row.amount : sum), 0),
  );

export const averageByBucket = (buckets: number[], rows: Row[]): number[] =>
  // EXPECT-FINDING
  buckets.map((bucket) => {
    const inBucket = rows.filter((row) => startOfLocalDay(row.time) === bucket);

    return inBucket.length === 0 ? 0 : inBucket.reduce((sum, row) => sum + row.amount, 0) / inBucket.length;
  });
