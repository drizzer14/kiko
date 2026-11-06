import { match } from 'ts-pattern';
import { type CalendarMonth, calendarMonthOf, calendarMonthsBetween } from '@kiko/dates';

/** The months a table covers: the last 12 up to now, or one whole calendar year. */
export type TablePeriod = { kind: 'last12' } | { kind: 'year'; year: number };

const LAST_TWELVE: TablePeriod = { kind: 'last12' };
const MONTHS_IN_LAST_TWELVE = 12;

/** A string that names the period, for a control that matches its options by value. */
export const tablePeriodKey = (period: TablePeriod): string =>
  match(period)
    .with({ kind: 'last12' }, () => 'last12')
    .with({ kind: 'year' }, ({ year }) => `year-${year}`)
    .exhaustive();

/**
 * The last 12 months, then each calendar year from the one the data starts in to the current
 * one, newest first.
 */
export const tablePeriodOptions = (spanStart: number, now: number): TablePeriod[] => {
  const firstYear = new Date(spanStart).getFullYear();
  const lastYear = new Date(now).getFullYear();
  const years = Array.from(
    { length: lastYear - firstYear + 1 },
    (_unused, offset): TablePeriod => ({ kind: 'year', year: lastYear - offset }),
  );

  return [LAST_TWELVE, ...years];
};

/** A held year that the options do not offer reads as the last 12 months. */
export const resolveTablePeriod = (
  period: TablePeriod | undefined,
  options: readonly TablePeriod[],
): TablePeriod => {
  if (period === undefined) {
    return LAST_TWELVE;
  }

  return options.some((option) => tablePeriodKey(option) === tablePeriodKey(period))
    ? period
    : LAST_TWELVE;
};

/**
 * The whole local months of the period, oldest first. The columns start at the month the data
 * starts in when the period reaches back further, and the current year stops at the current
 * month, so there is no empty leading column and no future one.
 */
export const monthsOfPeriod = (
  period: TablePeriod,
  spanStart: number,
  now: number,
): CalendarMonth[] => {
  const { from, to } = match(period)
    .with({ kind: 'last12' }, () => {
      const today = new Date(now);

      return {
        from: new Date(today.getFullYear(), today.getMonth() - (MONTHS_IN_LAST_TWELVE - 1), 1),
        to: now,
      };
    })
    .with({ kind: 'year' }, ({ year }) => ({
      from: new Date(year, 0, 1),
      to: Math.min(new Date(year, 11, 31).getTime(), now),
    }))
    .exhaustive();

  return calendarMonthsBetween(Math.max(from.getTime(), calendarMonthOf(spanStart).start), to);
};

/**
 * The index of the first complete month: the month after the one the first row falls in, or the
 * first column when the first row is before the period. Never the current month, which is still
 * running. Null with no row, or when no complete month follows the first row.
 */
export const firstCompleteMonthIndex = (
  months: readonly CalendarMonth[],
  firstRowTime: number | null,
  now: number,
): number | null => {
  if (firstRowTime === null) {
    return null;
  }

  const endOfFirstRowMonth = calendarMonthOf(firstRowTime).end;
  const index = months.findIndex((month) => month.start > endOfFirstRowMonth);

  if (index === -1 || months[index].end >= now) {
    return null;
  }

  return index;
};

/**
 * The mean of the complete months, which run from `firstCompleteIndex` to the last column, less a
 * last column that is the running month. An empty month counts as zero. Null when no month is
 * complete.
 */
export const averageOverComplete = (
  values: readonly number[],
  firstCompleteIndex: number | null,
  currentIsPartial: boolean,
): number | null => {
  if (firstCompleteIndex === null) {
    return null;
  }

  const complete = values.slice(firstCompleteIndex, currentIsPartial ? -1 : undefined);

  if (complete.length === 0) {
    return null;
  }

  return complete.reduce((sum, value) => sum + value, 0) / complete.length;
};
