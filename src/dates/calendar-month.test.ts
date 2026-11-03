import { type CalendarMonth, calendarMonthOf, calendarMonthsBetween } from './index';

const at = (year: number, monthIndex: number, day: number, hour = 12): number =>
  new Date(year, monthIndex, day, hour).getTime();

const startMonths = (months: CalendarMonth[]): number[] =>
  months.map((month) => new Date(month.start).getMonth());

describe('calendarMonthOf', () => {
  it.each([
    ['a 31-day month', 2026, 0, 31],
    ['a 30-day month', 2026, 3, 30],
    ['a 28-day February', 2026, 1, 28],
    ['a 29-day February', 2028, 1, 29],
  ])(
    'spans %s from local midnight of the 1st to the last ms of its last day',
    (_, year, month, lastDay) => {
      const result = calendarMonthOf(at(year, month, 15));

      expect(result.start).toBe(new Date(year, month, 1).getTime());
      expect(result.end).toBe(new Date(year, month, lastDay, 23, 59, 59, 999).getTime());
    },
  );

  it('gives the same month for its first instant, a mid instant and its last instant', () => {
    const first = new Date(2026, 5, 1).getTime();
    const last = new Date(2026, 5, 30, 23, 59, 59, 999).getTime();
    const expected = calendarMonthOf(first);

    expect(calendarMonthOf(at(2026, 5, 17))).toEqual(expected);
    expect(calendarMonthOf(last)).toEqual(expected);
  });

  it('puts the next millisecond in the next month', () => {
    const last = new Date(2026, 5, 30, 23, 59, 59, 999).getTime();

    expect(calendarMonthOf(last + 1).start).toBe(new Date(2026, 6, 1).getTime());
  });

  it('closes December on the last ms of the year', () => {
    const december = calendarMonthOf(at(2026, 11, 20));

    expect(december.start).toBe(new Date(2026, 11, 1).getTime());
    expect(december.end).toBe(new Date(2027, 0, 1).getTime() - 1);
  });

  // Europe/Kyiv springs forward on 2026-03-29 and falls back on 2026-10-25 (jest pins the zone).
  it.each([
    ['March, which has a 23-hour day', 2026, 2, 31],
    ['October, which has a 25-hour day', 2026, 9, 31],
  ])(
    'keeps %s whole: local midnight to the last ms of the local day',
    (_, year, month, lastDay) => {
      const result = calendarMonthOf(at(year, month, 29));

      expect(result.start).toBe(new Date(year, month, 1).getTime());
      expect(result.end).toBe(new Date(year, month, lastDay, 23, 59, 59, 999).getTime());
    },
  );

  it('does not measure a DST month by a fixed number of milliseconds', () => {
    const march = calendarMonthOf(at(2026, 2, 10));
    const hours = (march.end + 1 - march.start) / 3_600_000;

    expect(hours).toBe(31 * 24 - 1);
  });

  it('puts an instant after midnight of the fall-back day in its own month', () => {
    const late = new Date(2026, 9, 25, 23, 30).getTime();

    expect(calendarMonthOf(late).start).toBe(new Date(2026, 9, 1).getTime());
  });
});

describe('calendarMonthsBetween', () => {
  it('gives one month when `from` and `to` fall in the same month', () => {
    expect(calendarMonthsBetween(at(2026, 4, 3), at(2026, 4, 28))).toEqual([
      calendarMonthOf(at(2026, 4, 15)),
    ]);
  });

  it('gives one month for one instant', () => {
    const time = at(2026, 4, 3);

    expect(calendarMonthsBetween(time, time)).toEqual([calendarMonthOf(time)]);
  });

  it('gives whole months, oldest first, with no gap and no overlap', () => {
    const months = calendarMonthsBetween(at(2026, 0, 20), at(2026, 3, 2));

    expect(startMonths(months)).toEqual([0, 1, 2, 3]);
    months.slice(1).forEach((month, index) => {
      expect(month.start).toBe(months[index].end + 1);
    });
  });

  it('crosses a year edge', () => {
    const months = calendarMonthsBetween(at(2025, 10, 5), at(2026, 1, 5));

    expect(startMonths(months)).toEqual([10, 11, 0, 1]);
    expect(months.map((month) => new Date(month.start).getFullYear())).toEqual([
      2025, 2025, 2026, 2026,
    ]);
    expect(months[0].start).toBe(new Date(2025, 10, 1).getTime());
    expect(months[3].end).toBe(new Date(2026, 2, 1).getTime() - 1);
  });

  it('steps across both DST months without skipping or repeating one', () => {
    const months = calendarMonthsBetween(at(2026, 2, 1), at(2026, 10, 1));

    expect(months).toHaveLength(9);
    expect(startMonths(months)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('runs twelve months for a year', () => {
    expect(calendarMonthsBetween(at(2026, 0, 1), at(2026, 11, 31))).toHaveLength(12);
  });

  it('gives no month when `to` is before `from`', () => {
    expect(calendarMonthsBetween(at(2026, 4, 3), at(2026, 3, 28))).toEqual([]);
  });
});
