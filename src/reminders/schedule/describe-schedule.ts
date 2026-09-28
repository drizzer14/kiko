import { match } from 'ts-pattern';
import { formatTime } from '@kiko/dates';
import type { TFunction } from 'i18next';

import type { ReminderSchedule, Weekday } from './reminder-schedule';

// Indexed by `Weekday`, so Sunday is 0.
const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

const DAYS_PER_WEEK = 7;

const MINUTES_PER_HOUR = 60;

// The time always reads on the 24-hour clock (`formatTime`), so 11 means
// 11:00-11:59 only; 23:00 is "twenty-three", not "eleven".
const ELEVEN_O_CLOCK = 11;

const atLabel = (minuteOfDay: number, t: TFunction): string =>
  Math.floor(minuteOfDay / MINUTES_PER_HOUR) === ELEVEN_O_CLOCK
    ? t('reminders.schedule.atEleven')
    : t('reminders.schedule.at');

// Any day with no DST change reads back the same wall-clock time; `Date`
// carries the minutes past 59 into the hours.
const timeLabel = (minuteOfDay: number): string => formatTime(new Date(2000, 0, 1, 0, minuteOfDay));

const positionInWeek = (weekday: Weekday, firstDay: 0 | 1): number =>
  (weekday - firstDay + DAYS_PER_WEEK) % DAYS_PER_WEEK;

const weekdaysLabel = (weekdays: readonly Weekday[], t: TFunction, firstDay: 0 | 1): string =>
  [...weekdays]
    .sort((left, right) => positionInWeek(left, firstDay) - positionInWeek(right, firstDay))
    .map((weekday) => t(`calendar.weekday.${WEEKDAY_KEYS[weekday]}`))
    .join(', ');

// `firstDay` is the region's week start (`weekStartFor(deviceRegion())`), so
// the days read in the same order as the calendar.
export const describeSchedule = (
  schedule: ReminderSchedule,
  t: TFunction,
  firstDay: 0 | 1,
): string => {
  const time = timeLabel(schedule.minuteOfDay);
  const at = atLabel(schedule.minuteOfDay, t);

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
