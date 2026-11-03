import { endOfLocalDay } from './local-day';

export type CalendarMonth = {
  /** Local midnight of the month's first day. */
  start: number;
  /** The last millisecond of the month's last local day. */
  end: number;
};

/**
 * The calendar month `time` falls in, by LOCAL fields. Both edges are built from year and month,
 * never from a fixed millisecond step: a local day is 23 or 25 hours across a DST change, and a
 * device that changes time zone moves the edges with it.
 */
export const calendarMonthOf = (time: number): CalendarMonth => {
  const date = new Date(time);
  const year = date.getFullYear();
  const month = date.getMonth();

  return {
    start: new Date(year, month, 1).getTime(),
    end: endOfLocalDay(new Date(year, month + 1, 0).getTime()),
  };
};

/**
 * Every whole calendar month from the one `from` falls in to the one `to` falls in, oldest
 * first. Empty when `to` is before `from`.
 */
export const calendarMonthsBetween = (from: number, to: number): CalendarMonth[] => {
  const months: CalendarMonth[] = [];
  const first = calendarMonthOf(from);
  const last = calendarMonthOf(to);
  let month = first;

  while (month.start <= last.start) {
    months.push(month);
    month = calendarMonthOf(month.end + 1);
  }

  return months;
};
