// Semgrep fixture (NEGATIVE, NESTED): mirrors bucket-example.bad.ts's own
// path (see that fixture's header). A Date built once per row in a one-off
// pass, or once per bucket, is linear work; neither nests one inside the
// other, so the rule stays silent here. A nested traversal whose inner pass
// runs over the outer item's OWN rows (a member, or a chain off a lookup) is
// linear too: each row is visited once, so it stays silent as well.
import { startOfLocalDay } from '@kiko/dates';

type Row = { time: number; amount: number };

type Holding = { id: string; currency: string; rows: Row[] };

export const rowDays = (rows: Row[]): number[] => rows.map((row) => startOfLocalDay(row.time));

export const rowLabels = (rows: Row[]): string[] =>
  rows.map((row) => {
    const day = new Date(startOfLocalDay(row.time));

    return day.toISOString();
  });

export const bucketDates = (buckets: number[]): Date[] => buckets.map((bucket) => new Date(bucket));

export const rowsOnDay = (rows: Row[], time: number): Row[] => {
  const targetDay = startOfLocalDay(time);

  return rows.filter((row) => row.time >= targetDay);
};

export const countByBucket = (buckets: number[], rows: Row[]): number[] => {
  const days = rowDays(rows);

  return buckets.map((bucket) => days.filter((day) => day <= bucket).length);
};

export const holdingRowDays = (holdings: Holding[]): number[] =>
  holdings.flatMap((holding) => holding.rows.map((row) => startOfLocalDay(row.time)));

export const holdingRowDaysByLoop = (holdings: Holding[]): number[][] => {
  const days: number[][] = [];

  for (const holding of holdings) {
    days.push(holding.rows.map((row) => startOfLocalDay(row.time)));
  }

  return days;
};

export const holdingRowLabels = (holdings: Holding[]): string[] =>
  holdings.flatMap((holding) => {
    const labels = holding.rows.map((row) => new Date(row.time).toISOString());

    return labels;
  });

export const lookedUpDays = (holdings: Holding[], rowsById: Map<string, Row[]>): number[] =>
  holdings.flatMap((holding) => (rowsById.get(holding.id) ?? []).map((row) => startOfLocalDay(row.time)));

export const lookedUpSpendDays = (holdings: Holding[], rowsById: Map<string, Row[]>): number[] =>
  holdings.flatMap((holding) =>
    (rowsById.get(holding.id) ?? [])
      .filter((row) => row.amount < 0)
      .map((row) => startOfLocalDay(row.time)),
  );

export const fundingCandidates = (
  holdings: Holding[],
  rowsById: Map<string, Row[]>,
  currency: string,
): { day: number; key: string }[] =>
  holdings.flatMap((holding) =>
    holding.currency === currency
      ? (rowsById.get(holding.id) ?? [])
          .map((row, index) => ({ row, key: `${holding.id}:${index}` }))
          .filter(({ row }) => row.amount < 0)
          .map(({ row, key }) => ({ day: startOfLocalDay(row.time), key }))
      : [],
  );
