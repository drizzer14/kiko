import { type CalendarMonth, calendarMonthOf } from '@kiko/dates';

import {
  averageOverComplete,
  firstCompleteMonthIndex,
  monthsOfPeriod,
  resolveTablePeriod,
  type TablePeriod,
  tablePeriodOptions,
} from '.';

const at = (year: number, monthIndex: number, day: number, hour = 12): number =>
  new Date(year, monthIndex, day, hour).getTime();

const NOW = at(2025, 5, 15);
const LAST_TWELVE: TablePeriod = { kind: 'last12' };

const monthLabels = (months: CalendarMonth[]): string[] =>
  months.map((month) => {
    const date = new Date(month.start);

    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  });

describe('tablePeriodOptions', () => {
  it('offers the last 12 months first, then one option per calendar year with data, newest first', () => {
    expect(tablePeriodOptions(at(2023, 8, 10), NOW)).toEqual([
      LAST_TWELVE,
      { kind: 'year', year: 2025 },
      { kind: 'year', year: 2024 },
      { kind: 'year', year: 2023 },
    ]);
  });

  it('offers only the current year when the data starts in it', () => {
    expect(tablePeriodOptions(at(2025, 1, 3), NOW)).toEqual([
      LAST_TWELVE,
      { kind: 'year', year: 2025 },
    ]);
  });

  it('keys the year off the local calendar, not UTC, on the first instant of a year', () => {
    const firstInstantOf2024 = new Date(2024, 0, 1, 0, 0, 0, 0).getTime();

    expect(tablePeriodOptions(firstInstantOf2024, NOW).map((option) => option.kind)).toEqual([
      'last12',
      'year',
      'year',
    ]);
    expect(tablePeriodOptions(firstInstantOf2024, NOW)).toContainEqual({
      kind: 'year',
      year: 2024,
    });
  });
});

describe('monthsOfPeriod', () => {
  it('ends the last 12 months at the current month', () => {
    const months = monthsOfPeriod(LAST_TWELVE, at(2020, 0, 1), NOW);

    expect(months).toHaveLength(12);
    expect(monthLabels(months).at(0)).toBe('2024-07');
    expect(monthLabels(months).at(-1)).toBe('2025-06');
    expect(months.at(-1)).toEqual(calendarMonthOf(NOW));
  });

  it('starts the last 12 months at the month of spanStart when the data is younger', () => {
    const months = monthsOfPeriod(LAST_TWELVE, at(2025, 2, 20), NOW);

    expect(monthLabels(months)).toEqual(['2025-03', '2025-04', '2025-05', '2025-06']);
  });

  it('gives one whole month when the data starts in the current month', () => {
    expect(monthLabels(monthsOfPeriod(LAST_TWELVE, at(2025, 5, 2), NOW))).toEqual(['2025-06']);
  });

  it('gives all twelve months of a past calendar year the data covers', () => {
    const months = monthsOfPeriod({ kind: 'year', year: 2024 }, at(2023, 8, 10), NOW);

    expect(monthLabels(months).at(0)).toBe('2024-01');
    expect(monthLabels(months).at(-1)).toBe('2024-12');
    expect(months).toHaveLength(12);
  });

  it('starts a calendar year at the month of spanStart when the data starts inside it', () => {
    const months = monthsOfPeriod({ kind: 'year', year: 2024 }, at(2024, 3, 9), NOW);

    expect(monthLabels(months).at(0)).toBe('2024-04');
    expect(months).toHaveLength(9);
  });

  it('ends the current calendar year at the current month, with no future column', () => {
    const months = monthsOfPeriod({ kind: 'year', year: 2025 }, at(2020, 0, 1), NOW);

    expect(monthLabels(months)).toEqual([
      '2025-01',
      '2025-02',
      '2025-03',
      '2025-04',
      '2025-05',
      '2025-06',
    ]);
  });

  it('gives no month for a year before the data', () => {
    expect(monthsOfPeriod({ kind: 'year', year: 2022 }, at(2023, 8, 10), NOW)).toEqual([]);
  });

  it('keeps every month whole across the March and October time changes', () => {
    const months = monthsOfPeriod({ kind: 'year', year: 2026 }, at(2020, 0, 1), at(2026, 11, 20));
    const march = months[2];
    const october = months[9];

    expect(march.start).toBe(new Date(2026, 2, 1).getTime());
    expect(march.end).toBe(new Date(2026, 2, 31, 23, 59, 59, 999).getTime());
    expect(october.start).toBe(new Date(2026, 9, 1).getTime());
    expect(october.end).toBe(new Date(2026, 9, 31, 23, 59, 59, 999).getTime());
  });

  it('runs the months back to back, each starting the millisecond after the last ended', () => {
    const months = monthsOfPeriod(LAST_TWELVE, at(2020, 0, 1), NOW);

    months.slice(1).forEach((month, index) => {
      expect(month.start).toBe(months[index].end + 1);
    });
  });
});

describe('resolveTablePeriod', () => {
  const options = tablePeriodOptions(at(2023, 8, 10), NOW);

  it('reads no period as the last 12 months', () => {
    expect(resolveTablePeriod(undefined, options)).toEqual(LAST_TWELVE);
  });

  it('keeps a held year that is still offered', () => {
    expect(resolveTablePeriod({ kind: 'year', year: 2024 }, options)).toEqual({
      kind: 'year',
      year: 2024,
    });
  });

  it('reads a held year the options do not offer as the last 12 months', () => {
    expect(resolveTablePeriod({ kind: 'year', year: 2019 }, options)).toEqual(LAST_TWELVE);
  });

  it('keeps the last 12 months', () => {
    expect(resolveTablePeriod(LAST_TWELVE, options)).toEqual(LAST_TWELVE);
  });
});

describe('firstCompleteMonthIndex', () => {
  const months = monthsOfPeriod({ kind: 'year', year: 2025 }, at(2020, 0, 1), NOW);

  it('is the month after the first row', () => {
    expect(firstCompleteMonthIndex(months, at(2025, 2, 17), NOW)).toBe(3);
  });

  it('is the month after the first row when the row sits on the last millisecond of its month', () => {
    const lastMillisecondOfMarch = new Date(2025, 2, 31, 23, 59, 59, 999).getTime();

    expect(firstCompleteMonthIndex(months, lastMillisecondOfMarch, NOW)).toBe(3);
  });

  it('is the first column when the first row is before the period', () => {
    expect(firstCompleteMonthIndex(months, at(2024, 10, 4), NOW)).toBe(0);
  });

  it('is the first column when the first row is in the month before the period', () => {
    expect(firstCompleteMonthIndex(months, at(2024, 11, 31), NOW)).toBe(0);
  });

  it('is null when the first row sits in the current month', () => {
    expect(firstCompleteMonthIndex(months, at(2025, 5, 2), NOW)).toBeNull();
  });

  it('is never the current month, even right after the first row', () => {
    expect(firstCompleteMonthIndex(months, at(2025, 4, 20), NOW)).toBeNull();
  });

  it('is null when the first row is after the whole period', () => {
    const pastYear = monthsOfPeriod({ kind: 'year', year: 2024 }, at(2020, 0, 1), NOW);

    expect(firstCompleteMonthIndex(pastYear, at(2025, 0, 8), NOW)).toBeNull();
  });

  it('is null with no row at all', () => {
    expect(firstCompleteMonthIndex(months, null, NOW)).toBeNull();
  });

  it('is null with no month', () => {
    expect(firstCompleteMonthIndex([], at(2025, 0, 8), NOW)).toBeNull();
  });

  it('counts the last column of a past year as complete', () => {
    const pastYear = monthsOfPeriod({ kind: 'year', year: 2024 }, at(2020, 0, 1), NOW);

    expect(firstCompleteMonthIndex(pastYear, at(2024, 10, 8), NOW)).toBe(11);
  });
});

describe('averageOverComplete', () => {
  it('averages from the first complete month, leaving the partial last month out', () => {
    expect(averageOverComplete([100, 200, 300, 400], 1, true)).toBe(250);
  });

  it('averages to the last month when none is partial', () => {
    expect(averageOverComplete([100, 200, 300, 400], 1, false)).toBe(300);
  });

  it('counts an empty month inside the span as zero', () => {
    expect(averageOverComplete([0, 100, 0, 200], 0, false)).toBe(75);
  });

  it('leaves out the months before the first complete one, whatever they hold', () => {
    expect(averageOverComplete([999, 999, 10, 20, 30], 2, true)).toBe(15);
  });

  it('is zero, not null, when every complete month is empty', () => {
    expect(averageOverComplete([0, 0, 0], 0, false)).toBe(0);
  });

  it('is null with no first complete month', () => {
    expect(averageOverComplete([100, 200], null, false)).toBeNull();
  });

  it('is null when the only month from the first complete one is the partial month', () => {
    expect(averageOverComplete([100, 200, 300], 2, true)).toBeNull();
  });

  it('is null with no value', () => {
    expect(averageOverComplete([], 0, false)).toBeNull();
  });
});
