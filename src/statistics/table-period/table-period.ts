import { match } from 'ts-pattern';
import { sumOf } from '@kiko/numbers';
import { type CalendarMonth, calendarMonthOf, calendarMonthsBetween } from '@kiko/dates';

const QUARTERS = [1, 2, 3, 4] as const;

const HALVES = [1, 2] as const;

type Quarter = (typeof QUARTERS)[number];
type Half = (typeof HALVES)[number];

const MONTHS_IN_QUARTER = 3;
const MONTHS_IN_HALF = 6;
const MONTHS_IN_YEAR = 12;
// The second half is the one that starts in the third quarter.
const FIRST_QUARTER_OF_SECOND_HALF = 3;

/** The months a table covers: a calendar quarter, half or year, from its first month to now. */
export type TablePeriod =
  | { kind: 'quarter'; year: number; quarter: Quarter }
  | { kind: 'half'; year: number; half: Half }
  | { kind: 'year'; year: number };

type QuarterPeriod = Extract<TablePeriod, { kind: 'quarter' }>;

/** A string that names the period, for a control that matches its options by value. */
export const tablePeriodKey = (period: TablePeriod): string =>
  match(period)
    .with({ kind: 'quarter' }, ({ year, quarter }) => `quarter-${year}-${quarter}`)
    .with({ kind: 'half' }, ({ year, half }) => `half-${year}-${half}`)
    .with({ kind: 'year' }, ({ year }) => `year-${year}`)
    .exhaustive();

/**
 * The periods that a label names by their place in time: the quarter `now` is in, the quarter
 * before it (the last one of the year before, in the first quarter), this year and the one
 * before.
 */
export const relativeTablePeriodsOf = (now: number) => {
  const today = new Date(now);
  const year = today.getFullYear();
  const quarterIndex = Math.floor(today.getMonth() / MONTHS_IN_QUARTER);
  const thisQuarter: QuarterPeriod = { kind: 'quarter', year, quarter: QUARTERS[quarterIndex] };
  const lastQuarter: TablePeriod =
    quarterIndex === 0
      ? { kind: 'quarter', year: year - 1, quarter: 4 }
      : { kind: 'quarter', year, quarter: QUARTERS[quarterIndex - 1] };

  return {
    thisQuarter,
    lastQuarter,
    thisYear: { kind: 'year', year } satisfies TablePeriod,
    lastYear: { kind: 'year', year: year - 1 } satisfies TablePeriod,
  };
};

const spanOfMonths = (year: number, firstMonth: number, monthCount: number) => ({
  from: new Date(year, firstMonth, 1),
  to: new Date(year, firstMonth + monthCount, 0),
});

/**
 * The whole local months of the period, oldest first. The columns start at the month the data
 * starts in when the period reaches back further, and a period that has not ended stops at the
 * current month, so there is no empty leading column and no future one.
 */
export const monthsOfPeriod = (
  period: TablePeriod,
  spanStart: number,
  now: number,
): CalendarMonth[] => {
  const { from, to } = match(period)
    .with({ kind: 'quarter' }, ({ year, quarter }) =>
      spanOfMonths(year, (quarter - 1) * MONTHS_IN_QUARTER, MONTHS_IN_QUARTER),
    )
    .with({ kind: 'half' }, ({ year, half }) =>
      spanOfMonths(year, (half - 1) * MONTHS_IN_HALF, MONTHS_IN_HALF),
    )
    .with({ kind: 'year' }, ({ year }) => spanOfMonths(year, 0, MONTHS_IN_YEAR))
    .exhaustive();

  return calendarMonthsBetween(
    Math.max(from.getTime(), calendarMonthOf(spanStart).start),
    Math.min(to.getTime(), now),
  );
};

/**
 * This quarter, last quarter, the other quarters of this year that have started, newest first,
 * the first half, the second half from the day it starts, then this year and last year. A period
 * with no month in the data (it ends before the data starts) is left out, except this year,
 * which a ledger dated wholly ahead of now still reads as.
 */
export const tablePeriodOptions = (spanStart: number, now: number): TablePeriod[] => {
  const { thisQuarter, lastQuarter, thisYear, lastYear } = relativeTablePeriodsOf(now);
  const { year } = thisYear;
  const earlierQuarters = QUARTERS.filter((quarter) => quarter < thisQuarter.quarter - 1)
    .map((quarter): TablePeriod => ({ kind: 'quarter', year, quarter }))
    .reverse();
  const halves = HALVES.filter(
    (half) => half === 1 || thisQuarter.quarter >= FIRST_QUARTER_OF_SECOND_HALF,
  ).map((half): TablePeriod => ({ kind: 'half', year, half }));
  const hasMonths = (period: TablePeriod): boolean =>
    monthsOfPeriod(period, spanStart, now).length > 0;

  return [
    ...[thisQuarter, lastQuarter, ...earlierQuarters, ...halves].filter(hasMonths),
    thisYear,
    ...[lastYear].filter(hasMonths),
  ];
};

/** The period a table opens on, and the one a pill reads as inactive on: this year. */
export const defaultTablePeriod = (now: number): TablePeriod =>
  relativeTablePeriodsOf(now).thisYear;

/** A held period that the options do not offer, or none held, reads as the default period. */
export const resolveTablePeriod = (
  period: TablePeriod | undefined,
  options: readonly TablePeriod[],
  now: number,
): TablePeriod => {
  if (
    period !== undefined &&
    options.some((option) => tablePeriodKey(option) === tablePeriodKey(period))
  ) {
    return period;
  }

  return defaultTablePeriod(now);
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

  return sumOf(complete) / complete.length;
};
