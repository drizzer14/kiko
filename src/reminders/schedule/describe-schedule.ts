import { match } from 'ts-pattern';
import type { TFunction } from 'i18next';
import { formatTime, hourOnClock, type TimeClock } from '@kiko/dates';

import type { ReminderSchedule, Weekday } from './reminder-schedule';

// Indexed by `Weekday`, so Sunday is 0.
const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

const DAYS_PER_WEEK = 7;

const MINUTES_PER_HOUR = 60;

// The preposition follows the hour as it reads: on the 24-hour clock 23:00 is
// "twenty-three", on the 12-hour clock 11:00 PM is "eleven" too.
const ELEVEN_O_CLOCK = 11;

const atLabel = (minuteOfDay: number, t: TFunction, clock: TimeClock): string =>
  hourOnClock(Math.floor(minuteOfDay / MINUTES_PER_HOUR), clock) === ELEVEN_O_CLOCK
    ? t('reminders.schedule.atEleven')
    : t('reminders.schedule.at');

// Any day with no DST change reads back the same wall-clock time; `Date`
// carries the minutes past 59 into the hours.
const timeLabel = (minuteOfDay: number, clock: TimeClock): string =>
  formatTime(new Date(2000, 0, 1, 0, minuteOfDay), clock);

const positionInWeek = (weekday: Weekday, firstDay: 0 | 1): number =>
  (weekday - firstDay + DAYS_PER_WEEK) % DAYS_PER_WEEK;

// The short name the calendar header shows.
export const weekdayName = (weekday: Weekday, t: TFunction): string =>
  t(`calendar.weekday.${WEEKDAY_KEYS[weekday]}`);

// The whole week, starting on the region's first day.
export const weekdaysInOrder = (firstDay: 0 | 1): Weekday[] =>
  WEEKDAY_KEYS.map((_key, offset) => ((offset + firstDay) % DAYS_PER_WEEK) as Weekday);

const weekdaysLabel = (weekdays: readonly Weekday[], t: TFunction, firstDay: 0 | 1): string =>
  [...weekdays]
    .sort((left, right) => positionInWeek(left, firstDay) - positionInWeek(right, firstDay))
    .map((weekday) => weekdayName(weekday, t))
    .join(', ');

// `firstDay` is the region's week start (`weekStartFor(deviceRegion())`), so
// the days read in the same order as the calendar.
export const describeSchedule = (
  schedule: ReminderSchedule,
  t: TFunction,
  firstDay: 0 | 1,
  clock: TimeClock,
): string => {
  const time = timeLabel(schedule.minuteOfDay, clock);
  const at = atLabel(schedule.minuteOfDay, t, clock);

  return match(schedule)
    .with({ frequency: 'daily' }, () => t('reminders.schedule.daily', { at, time }))
    .with({ frequency: 'weekly' }, ({ weekdays }) =>
      t('reminders.schedule.weekly', { days: weekdaysLabel(weekdays, t, firstDay), at, time }),
    )
    .with({ frequency: 'monthly' }, ({ dayOfMonth }) =>
      t('reminders.schedule.monthly', { day: dayOfMonth, at, time }),
    )
    .with({ frequency: 'interval' }, ({ everyDays }) =>
      t('reminders.schedule.interval', { count: everyDays, at, time }),
    )
    .exhaustive();
};
