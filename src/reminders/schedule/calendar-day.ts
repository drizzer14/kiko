import { DAY_MS } from '@kiko/dates';

import type { LocalDay, Weekday } from './reminder-schedule';

// Day stepping and diffing run on UTC day numbers: a UTC day is always DAY_MS
// long, so the arithmetic never meets a DST transition. Only `localDayOf`
// reads the device zone, to turn an instant into its local calendar date.

export const dayNumberOf = (day: LocalDay): number =>
  Date.UTC(day.year, day.month - 1, day.day) / DAY_MS;

export const localDayFromNumber = (dayNumber: number): LocalDay => {
  const date = new Date(dayNumber * DAY_MS);

  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
};

export const addDays = (day: LocalDay, days: number): LocalDay =>
  localDayFromNumber(dayNumberOf(day) + days);

export const weekdayOf = (day: LocalDay): Weekday =>
  new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay() as Weekday;

// Day 0 of the next month is this month's last day.
export const daysInMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

export const localDayOf = (instant: number): LocalDay => {
  const date = new Date(instant);

  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
};
