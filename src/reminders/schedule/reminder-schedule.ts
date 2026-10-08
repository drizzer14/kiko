import { match } from 'ts-pattern';
import { isRecord } from '@kiko/type-guards';

import { daysInMonth } from './calendar-day';

export const reminderKinds = ['statement_import', 'add_transactions'] as const;
export type ReminderKind = (typeof reminderKinds)[number];

// `Date#getDay` numbering: 0 is Sunday.
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

// A calendar date with no time or zone. `month` is 1-12, like `LocalDateTime`.
export type LocalDay = { year: number; month: number; day: number };

// `minuteOfDay` is the local wall-clock time, 0-1439. A monthly `dayOfMonth`
// (1-31) past the month's length fires on that month's last day, so no month
// is skipped. `everyDays` is 2-365, counted in calendar days from `anchorDay`.
export type ReminderSchedule =
  | { frequency: 'daily'; minuteOfDay: number }
  | { frequency: 'weekly'; minuteOfDay: number; weekdays: readonly Weekday[] }
  | { frequency: 'monthly'; minuteOfDay: number; dayOfMonth: number }
  | { frequency: 'interval'; minuteOfDay: number; everyDays: number; anchorDay: LocalDay };

const LAST_MINUTE_OF_DAY = 24 * 60 - 1;
const LONGEST_MONTH_DAYS = 31;
export const INTERVAL_MINIMUM_DAYS = 2;
export const INTERVAL_MAXIMUM_DAYS = 365;

const isIntegerBetween = (value: unknown, minimum: number, maximum: number): value is number =>
  Number.isInteger(value) && (value as number) >= minimum && (value as number) <= maximum;

const isWeekday = (value: unknown): value is Weekday => isIntegerBetween(value, 0, 6);

// A four-digit year, because `Date.UTC` reads a year below 100 as 19xx; and a
// day within its own month, because `Date.UTC` rolls 2026-09-31 into October.
const isLocalDay = (value: unknown): value is LocalDay =>
  isRecord(value) &&
  isIntegerBetween(value.year, 1000, 9999) &&
  isIntegerBetween(value.month, 1, 12) &&
  isIntegerBetween(value.day, 1, daysInMonth(value.year, value.month));

const hasValidFrequencyFields = (candidate: Record<string, unknown>): boolean =>
  match(candidate.frequency)
    .with('daily', () => true)
    .with(
      'weekly',
      () =>
        Array.isArray(candidate.weekdays) &&
        candidate.weekdays.length > 0 &&
        candidate.weekdays.every(isWeekday),
    )
    .with('monthly', () => isIntegerBetween(candidate.dayOfMonth, 1, LONGEST_MONTH_DAYS))
    .with(
      'interval',
      () =>
        isIntegerBetween(candidate.everyDays, INTERVAL_MINIMUM_DAYS, INTERVAL_MAXIMUM_DAYS) &&
        isLocalDay(candidate.anchorDay),
    )
    .otherwise(() => false);

// A stored schedule comes back from JSON, possibly from a backup written by
// another build, so it is checked before the planner does calendar math on it.
export const isReminderSchedule = (value: unknown): value is ReminderSchedule =>
  isRecord(value) &&
  isIntegerBetween(value.minuteOfDay, 0, LAST_MINUTE_OF_DAY) &&
  hasValidFrequencyFields(value);
