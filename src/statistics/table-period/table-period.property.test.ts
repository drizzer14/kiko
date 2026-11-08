import { match } from 'ts-pattern';
import { calendarMonthOf } from '@kiko/dates';

import {
  monthsOfPeriod,
  relativeTablePeriodsOf,
  type TablePeriod,
  tablePeriodKey,
  tablePeriodOptions,
} from '.';

const at = (year: number, monthIndex: number, day: number, hour = 12): number =>
  new Date(year, monthIndex, day, hour).getTime();

const MONTHS_IN_YEAR = 12;
const SPAN_STARTS = [at(2023, 8, 10), at(2025, 0, 1, 0), at(2025, 8, 30), at(2026, 3, 1, 0)];

// The first, a middle and the last instant of every month of two years, so a quarter or half
// boundary is hit from both sides.
const NOWS = [2025, 2026].flatMap((year) =>
  Array.from({ length: MONTHS_IN_YEAR }, (_unused, month) => month).flatMap((month) => [
    new Date(year, month, 1, 0).getTime(),
    new Date(year, month, 15, 12).getTime(),
    new Date(year, month + 1, 0, 23, 59, 59, 999).getTime(),
  ]),
);

const WORLDS = SPAN_STARTS.flatMap((spanStart) =>
  NOWS.filter((now) => now >= spanStart).map((now) => ({ spanStart, now })),
);

// Months counted from year 0, so a range reads the same across a year boundary. Written out
// again here, apart from the code under test.
const monthNumber = (time: number): number =>
  new Date(time).getFullYear() * MONTHS_IN_YEAR + new Date(time).getMonth();

const rangeOf = (period: TablePeriod): [number, number] =>
  match(period)
    .with({ kind: 'quarter' }, ({ year, quarter }): [number, number] => [
      year * MONTHS_IN_YEAR + (quarter - 1) * 3,
      year * MONTHS_IN_YEAR + quarter * 3 - 1,
    ])
    .with({ kind: 'half' }, ({ year, half }): [number, number] => [
      year * MONTHS_IN_YEAR + (half - 1) * 6,
      year * MONTHS_IN_YEAR + half * 6 - 1,
    ])
    .with({ kind: 'year' }, ({ year }): [number, number] => [
      year * MONTHS_IN_YEAR,
      year * MONTHS_IN_YEAR + MONTHS_IN_YEAR - 1,
    ])
    .exhaustive();

describe('the period options over every month of two years', () => {
  it('sweeps a world for every data start and every month', () => {
    expect(WORLDS.length).toBeGreaterThan(100);
  });

  it('never lists a key twice', () => {
    for (const { spanStart, now } of WORLDS) {
      const keys = tablePeriodOptions(spanStart, now).map(tablePeriodKey);

      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('gives every option at least one month', () => {
    for (const { spanStart, now } of WORLDS) {
      for (const option of tablePeriodOptions(spanStart, now)) {
        expect(monthsOfPeriod(option, spanStart, now).length).toBeGreaterThan(0);
      }
    }
  });

  it('keeps the months of an option inside its range, from the data start, never past now', () => {
    for (const { spanStart, now } of WORLDS) {
      for (const option of tablePeriodOptions(spanStart, now)) {
        const [first, last] = rangeOf(option);

        for (const month of monthsOfPeriod(option, spanStart, now)) {
          expect(monthNumber(month.start)).toBeGreaterThanOrEqual(first);
          expect(monthNumber(month.start)).toBeLessThanOrEqual(last);
          expect(monthNumber(month.start)).toBeGreaterThanOrEqual(monthNumber(spanStart));
          expect(month.start).toBeLessThanOrEqual(now);
        }
      }
    }
  });

  it('reaches the current month in every option that has not ended', () => {
    for (const { spanStart, now } of WORLDS) {
      for (const option of tablePeriodOptions(spanStart, now)) {
        const [, last] = rangeOf(option);

        if (last >= monthNumber(now)) {
          expect(monthsOfPeriod(option, spanStart, now).at(-1)).toEqual(calendarMonthOf(now));
        }
      }
    }
  });

  it('starts every list with this quarter and always lists this year', () => {
    for (const { spanStart, now } of WORLDS) {
      const options = tablePeriodOptions(spanStart, now);

      expect(options[0]).toEqual(relativeTablePeriodsOf(now).thisQuarter);
      expect(options).toContainEqual(relativeTablePeriodsOf(now).thisYear);
    }
  });
});
