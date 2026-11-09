import { type CalendarMonth, calendarMonthOf } from '@kiko/dates';

import {
  averageOverComplete,
  firstCompleteMonthIndex,
  monthsOfPeriod,
  relativeTablePeriodsOf,
  resolveTablePeriod,
  type TablePeriod,
  tablePeriodKey,
  tablePeriodOptions,
} from '.';

const at = (year: number, monthIndex: number, day: number, hour = 12): number =>
  new Date(year, monthIndex, day, hour).getTime();

const NOW = at(2025, 5, 15);

const quarterOf = (year: number, quarter: 1 | 2 | 3 | 4): TablePeriod => ({
  kind: 'quarter',
  year,
  quarter,
});
const halfOf = (year: number, half: 1 | 2): TablePeriod => ({ kind: 'half', year, half });
const yearOf = (year: number): TablePeriod => ({ kind: 'year', year });

const monthLabels = (months: CalendarMonth[]): string[] =>
  months.map((month) => {
    const date = new Date(month.start);

    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  });

describe('tablePeriodKey', () => {
  it('gives each period its own key', () => {
    expect(tablePeriodKey(quarterOf(2025, 2))).toBe('quarter-2025-2');
    expect(tablePeriodKey(halfOf(2025, 1))).toBe('half-2025-1');
    expect(tablePeriodKey(yearOf(2025))).toBe('year-2025');
  });
});

describe('relativeTablePeriodsOf', () => {
  it('names this quarter, last quarter, this year and last year', () => {
    expect(relativeTablePeriodsOf(NOW)).toEqual({
      thisQuarter: quarterOf(2025, 2),
      lastQuarter: quarterOf(2025, 1),
      thisYear: yearOf(2025),
      lastYear: yearOf(2024),
    });
  });

  it('reads the quarter before the first one as the last one of the year before', () => {
    expect(relativeTablePeriodsOf(at(2026, 0, 1, 0)).lastQuarter).toEqual(quarterOf(2025, 4));
  });

  it('reads the local calendar on the last instant of a quarter', () => {
    const lastInstantOfMarch = new Date(2025, 2, 31, 23, 59, 59, 999).getTime();

    expect(relativeTablePeriodsOf(lastInstantOfMarch).thisQuarter).toEqual(quarterOf(2025, 1));
  });
});

describe('tablePeriodOptions', () => {
  const DATA_START = at(2023, 8, 10);

  it.each([
    [
      'the first quarter',
      at(2026, 1, 15),
      [quarterOf(2026, 1), quarterOf(2025, 4), halfOf(2026, 1), yearOf(2026), yearOf(2025)],
    ],
    [
      'the second quarter',
      at(2026, 4, 15),
      [quarterOf(2026, 2), quarterOf(2026, 1), halfOf(2026, 1), yearOf(2026), yearOf(2025)],
    ],
    [
      'the third quarter',
      at(2026, 7, 15),
      [
        quarterOf(2026, 3),
        quarterOf(2026, 2),
        quarterOf(2026, 1),
        halfOf(2026, 1),
        halfOf(2026, 2),
        yearOf(2026),
        yearOf(2025),
      ],
    ],
    [
      'the fourth quarter',
      at(2026, 10, 15),
      [
        quarterOf(2026, 4),
        quarterOf(2026, 3),
        quarterOf(2026, 2),
        quarterOf(2026, 1),
        halfOf(2026, 1),
        halfOf(2026, 2),
        yearOf(2026),
        yearOf(2025),
      ],
    ],
  ])('lists in %s the quarters, the halves, then the years', (_name, now, expected) => {
    expect(tablePeriodOptions(DATA_START, now)).toEqual(expected);
  });

  it('offers the second half from the first day of July, not before', () => {
    expect(tablePeriodOptions(DATA_START, at(2026, 5, 30, 23))).not.toContainEqual(halfOf(2026, 2));
    expect(tablePeriodOptions(DATA_START, at(2026, 6, 1, 0))).toContainEqual(halfOf(2026, 2));
  });

  it('leaves out the periods that end before the data starts, when it starts this year', () => {
    expect(tablePeriodOptions(at(2026, 4, 3), at(2026, 10, 15))).toEqual([
      quarterOf(2026, 4),
      quarterOf(2026, 3),
      quarterOf(2026, 2),
      halfOf(2026, 1),
      halfOf(2026, 2),
      yearOf(2026),
    ]);
  });

  it('leaves out last quarter and last year when the data starts in this quarter', () => {
    expect(tablePeriodOptions(at(2026, 9, 3), at(2026, 10, 15))).toEqual([
      quarterOf(2026, 4),
      halfOf(2026, 2),
      yearOf(2026),
    ]);
  });

  it('keeps a quarter that the data starts in the last month of', () => {
    expect(tablePeriodOptions(at(2026, 5, 30), at(2026, 10, 15))).toContainEqual(
      quarterOf(2026, 2),
    );
  });

  it('offers only this year when the data starts after now', () => {
    expect(tablePeriodOptions(at(2026, 11, 20), at(2026, 10, 15))).toEqual([yearOf(2026)]);
  });

  it('keys the periods off the local calendar, not UTC, on the first instant of a year', () => {
    const firstInstantOf2025 = new Date(2025, 0, 1, 0, 0, 0, 0).getTime();
    const options = tablePeriodOptions(firstInstantOf2025, at(2026, 1, 15));

    expect(options).toContainEqual(yearOf(2025));
    expect(options).toContainEqual(quarterOf(2025, 4));
  });
});

describe('monthsOfPeriod', () => {
  it('gives the whole of a past quarter the data covers', () => {
    const months = monthsOfPeriod(quarterOf(2024, 3), at(2023, 8, 10), NOW);

    expect(monthLabels(months)).toEqual(['2024-07', '2024-08', '2024-09']);
  });

  it('ends the current quarter at the current month, with no future column', () => {
    const months = monthsOfPeriod(quarterOf(2025, 2), at(2020, 0, 1), NOW);

    expect(monthLabels(months)).toEqual(['2025-04', '2025-05', '2025-06']);
    expect(months.at(-1)).toEqual(calendarMonthOf(NOW));
  });

  it('ends a quarter that has just begun at the current month', () => {
    const months = monthsOfPeriod(quarterOf(2025, 2), at(2020, 0, 1), at(2025, 3, 20));

    expect(monthLabels(months)).toEqual(['2025-04']);
  });

  it('starts a quarter at the month of spanStart when the data starts inside it', () => {
    expect(monthLabels(monthsOfPeriod(quarterOf(2025, 1), at(2025, 1, 9), NOW))).toEqual([
      '2025-02',
      '2025-03',
    ]);
  });

  it('gives no month for a quarter before the data', () => {
    expect(monthsOfPeriod(quarterOf(2024, 2), at(2025, 2, 1), NOW)).toEqual([]);
  });

  it('gives the last quarter of the year before across the year boundary', () => {
    const months = monthsOfPeriod(quarterOf(2025, 4), at(2020, 0, 1), at(2026, 1, 10));

    expect(monthLabels(months)).toEqual(['2025-10', '2025-11', '2025-12']);
  });

  it('gives six months for the first half, and the second half only up to now', () => {
    const now = at(2025, 7, 15);

    expect(monthLabels(monthsOfPeriod(halfOf(2025, 1), at(2020, 0, 1), now))).toEqual([
      '2025-01',
      '2025-02',
      '2025-03',
      '2025-04',
      '2025-05',
      '2025-06',
    ]);
    expect(monthLabels(monthsOfPeriod(halfOf(2025, 2), at(2020, 0, 1), now))).toEqual([
      '2025-07',
      '2025-08',
    ]);
  });

  it('starts a half at the month of spanStart when the data starts inside it', () => {
    const months = monthsOfPeriod(halfOf(2024, 2), at(2024, 9, 9), NOW);

    expect(monthLabels(months)).toEqual(['2024-10', '2024-11', '2024-12']);
  });

  it('gives all twelve months of a past calendar year the data covers', () => {
    const months = monthsOfPeriod(yearOf(2024), at(2023, 8, 10), NOW);

    expect(monthLabels(months).at(0)).toBe('2024-01');
    expect(monthLabels(months).at(-1)).toBe('2024-12');
    expect(months).toHaveLength(12);
  });

  it('starts a calendar year at the month of spanStart when the data starts inside it', () => {
    const months = monthsOfPeriod(yearOf(2024), at(2024, 3, 9), NOW);

    expect(monthLabels(months).at(0)).toBe('2024-04');
    expect(months).toHaveLength(9);
  });

  it('ends the current calendar year at the current month, with no future column', () => {
    const months = monthsOfPeriod(yearOf(2025), at(2020, 0, 1), NOW);

    expect(monthLabels(months)).toEqual([
      '2025-01',
      '2025-02',
      '2025-03',
      '2025-04',
      '2025-05',
      '2025-06',
    ]);
  });

  it('gives one whole month when the data starts in the current month', () => {
    expect(monthLabels(monthsOfPeriod(yearOf(2025), at(2025, 5, 2), NOW))).toEqual(['2025-06']);
  });

  it('gives no month for a year before the data', () => {
    expect(monthsOfPeriod(yearOf(2022), at(2023, 8, 10), NOW)).toEqual([]);
  });

  it('keeps every month whole across the March and October time changes', () => {
    const months = monthsOfPeriod(yearOf(2026), at(2020, 0, 1), at(2026, 11, 20));
    const march = months[2];
    const october = months[9];

    expect(march.start).toBe(new Date(2026, 2, 1).getTime());
    expect(march.end).toBe(new Date(2026, 2, 31, 23, 59, 59, 999).getTime());
    expect(october.start).toBe(new Date(2026, 9, 1).getTime());
    expect(october.end).toBe(new Date(2026, 9, 31, 23, 59, 59, 999).getTime());
  });

  it('runs the months back to back, each starting the millisecond after the last ended', () => {
    const months = monthsOfPeriod(yearOf(2025), at(2020, 0, 1), at(2025, 11, 20));

    months.slice(1).forEach((month, index) => {
      expect(month.start).toBe(months[index].end + 1);
    });
  });
});

describe('resolveTablePeriod', () => {
  const IN_AUTUMN = at(2026, 10, 15);
  const IN_SPRING = at(2026, 4, 15);
  const DATA_START = at(2023, 8, 10);
  const autumnOptions = tablePeriodOptions(DATA_START, IN_AUTUMN);
  const springOptions = tablePeriodOptions(DATA_START, IN_SPRING);

  it('reads no period as this year', () => {
    expect(resolveTablePeriod(undefined, autumnOptions, IN_AUTUMN)).toEqual(yearOf(2026));
  });

  it('keeps a held quarter, half and year that are still offered', () => {
    expect(resolveTablePeriod(quarterOf(2026, 2), autumnOptions, IN_AUTUMN)).toEqual(
      quarterOf(2026, 2),
    );
    expect(resolveTablePeriod(halfOf(2026, 1), autumnOptions, IN_AUTUMN)).toEqual(halfOf(2026, 1));
    expect(resolveTablePeriod(yearOf(2025), autumnOptions, IN_AUTUMN)).toEqual(yearOf(2025));
  });

  it('reads a held year the options do not offer as this year', () => {
    expect(resolveTablePeriod(yearOf(2024), autumnOptions, IN_AUTUMN)).toEqual(yearOf(2026));
  });

  it('reads a quarter held across a quarter boundary that is no longer offered as this year', () => {
    expect(resolveTablePeriod(quarterOf(2025, 4), springOptions, IN_SPRING)).toEqual(yearOf(2026));
    expect(resolveTablePeriod(quarterOf(2025, 4), autumnOptions, IN_AUTUMN)).toEqual(yearOf(2026));
  });

  it('reads a second half held before it is offered as this year', () => {
    expect(resolveTablePeriod(halfOf(2026, 2), springOptions, IN_SPRING)).toEqual(yearOf(2026));
  });
});

describe('firstCompleteMonthIndex', () => {
  const months = monthsOfPeriod(yearOf(2025), at(2020, 0, 1), NOW);

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
    const pastYear = monthsOfPeriod(yearOf(2024), at(2020, 0, 1), NOW);

    expect(firstCompleteMonthIndex(pastYear, at(2025, 0, 8), NOW)).toBeNull();
  });

  it('is null with no row at all', () => {
    expect(firstCompleteMonthIndex(months, null, NOW)).toBeNull();
  });

  it('is null with no month', () => {
    expect(firstCompleteMonthIndex([], at(2025, 0, 8), NOW)).toBeNull();
  });

  it('counts the last column of a past year as complete', () => {
    const pastYear = monthsOfPeriod(yearOf(2024), at(2020, 0, 1), NOW);

    expect(firstCompleteMonthIndex(pastYear, at(2024, 10, 8), NOW)).toBe(11);
  });

  it('is the month after the first row in a quarter, and null in the quarter running now', () => {
    const pastQuarter = monthsOfPeriod(quarterOf(2025, 1), at(2020, 0, 1), NOW);
    const currentQuarter = monthsOfPeriod(quarterOf(2025, 2), at(2020, 0, 1), NOW);

    expect(firstCompleteMonthIndex(pastQuarter, at(2025, 0, 17), NOW)).toBe(1);
    expect(firstCompleteMonthIndex(currentQuarter, at(2025, 4, 20), NOW)).toBeNull();
  });

  it('is the month after the first row in a half, and the first column before it', () => {
    const pastHalf = monthsOfPeriod(halfOf(2024, 2), at(2020, 0, 1), NOW);

    expect(firstCompleteMonthIndex(pastHalf, at(2024, 8, 3), NOW)).toBe(3);
    expect(firstCompleteMonthIndex(pastHalf, at(2024, 2, 3), NOW)).toBe(0);
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

  it('averages the complete months of the quarter running now, the partial month left out', () => {
    const months = monthsOfPeriod(quarterOf(2025, 2), at(2020, 0, 1), NOW);
    const first = firstCompleteMonthIndex(months, at(2025, 3, 20), NOW);

    expect(months).toHaveLength(3);
    expect(first).toBe(1);
    expect(averageOverComplete([100, 300, 900], first, true)).toBe(300);
  });

  it('averages the complete months of a half that ended, every month counting', () => {
    const months = monthsOfPeriod(halfOf(2024, 2), at(2020, 0, 1), NOW);
    const first = firstCompleteMonthIndex(months, at(2024, 6, 20), NOW);

    expect(months).toHaveLength(6);
    expect(first).toBe(1);
    expect(averageOverComplete([900, 100, 200, 300, 400, 500], first, false)).toBe(300);
  });
});
