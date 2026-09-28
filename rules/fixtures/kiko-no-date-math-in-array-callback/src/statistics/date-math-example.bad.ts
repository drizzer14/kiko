// Semgrep fixture (POSITIVE, NESTED): kiko-no-date-math-in-array-callback
// carries a path-prefixed `paths.include: ["src/statistics/**"]`, which draws
// NOTHING against a fixture placed directly in rules/fixtures/ (kiko-linter's
// "Semgrep facts" gotcha) — so this fixture is nested to mirror a real
// src/statistics/ path instead. Never move it back to a flat
// rules/fixtures/kiko-no-date-math-in-array-callback.bad.ts location.
import { startOfLocalDay, endOfLocalDay } from '@kiko/dates';

type Row = { time: number; amountMinorUnits: number };

export const filteredByDay = (rows: Row[], t: number): Row[] =>
  // EXPECT-FINDING
  rows.filter((row) => startOfLocalDay(row.time) <= startOfLocalDay(t));

export const dayKeys = (rows: Row[]): number[] =>
  // EXPECT-FINDING
  rows.map((row) => endOfLocalDay(row.time));

export const anyExpired = (rows: Row[], now: number): boolean =>
  // EXPECT-FINDING
  rows.some((row) => new Date(row.time).getTime() < now);

export const totalBeforeDay = (rows: Row[], cutoff: number): number =>
  // EXPECT-FINDING
  rows.reduce((sum, row) => (startOfLocalDay(row.time) <= cutoff ? sum + row.amountMinorUnits : sum), 0);

export const everyBeforeDay = (rows: Row[], cutoff: number): boolean =>
  // EXPECT-FINDING
  rows.every((row) => startOfLocalDay(row.time) <= cutoff);
