// Semgrep fixture (NEGATIVE, NESTED): mirrors date-math-example.bad.ts's own
// path (kiko-linter's "Semgrep facts" — see that fixture's own header). Every
// Date-derived value below is computed ONCE, outside the array callback, so
// the callback itself does only plain numeric comparison.
import { startOfLocalDay, endOfLocalDay } from '@kiko/dates';

type Row = { time: number; amountMinorUnits: number };

export const filteredByDay = (rows: Row[], t: number): Row[] => {
  const targetDay = startOfLocalDay(t);

  return rows.filter((row) => row.time <= targetDay);
};

export const dayKeys = (rows: Row[]): number[] => {
  const dayKeyByRow = new Map<Row, number>();

  for (const row of rows) {
    dayKeyByRow.set(row, endOfLocalDay(row.time));
  }

  return rows.map((row) => dayKeyByRow.get(row) ?? 0);
};

export const anyExpired = (rows: Row[], now: number): boolean => rows.some((row) => row.time < now);

export const totalBeforeDay = (rows: Row[], cutoff: number): number =>
  rows.reduce((sum, row) => (row.time <= cutoff ? sum + row.amountMinorUnits : sum), 0);

export const everyBeforeDay = (rows: Row[], cutoff: number): boolean =>
  rows.every((row) => row.time <= cutoff);
