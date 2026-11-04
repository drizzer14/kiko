import type { TFunction } from 'i18next';
import type { CalendarMonth } from '@kiko/dates';

const MONTH_KEYS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
] as const;

const JANUARY = 0;

/**
 * A column header: the month's three letters, with the year in the first column and in January,
 * so a reader can place every column without a header row of years. The names are catalogue
 * strings, never `Intl`, which Hermes may lack.
 */
export const monthColumnLabel = (
  month: CalendarMonth,
  isFirstColumn: boolean,
  t: TFunction,
): string => {
  const date = new Date(month.start);
  const name = t(`calendar.monthShort.${MONTH_KEYS[date.getMonth()]}`);

  return isFirstColumn || date.getMonth() === JANUARY ? `${name} ${date.getFullYear()}` : name;
};

/** The month spelled in full with its year, for a spoken label. */
export const monthTitle = (month: CalendarMonth, t: TFunction): string => {
  const date = new Date(month.start);

  return `${t(`calendar.month.${MONTH_KEYS[date.getMonth()]}`)} ${date.getFullYear()}`;
};
