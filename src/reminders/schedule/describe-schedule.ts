import { match } from 'ts-pattern';
import { formatTime } from '@kiko/dates';
import type { TFunction } from 'i18next';

import type { ReminderSchedule, Weekday } from './reminder-schedule';

// Indexed by `Weekday`, so Sunday is 0.
const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

const DAYS_PER_WEEK = 7;

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

  return match(schedule)
    .with({ frequency: 'daily' }, () => t('reminders.schedule.daily', { time }))
    .with({ frequency: 'weekly' }, ({ weekdays }) =>
      t('reminders.schedule.weekly', { days: weekdaysLabel(weekdays, t, firstDay), time }),
    )
    .with({ frequency: 'monthly' }, ({ dayOfMonth }) =>
      t('reminders.schedule.monthly', { day: dayOfMonth, time }),
    )
    .with({ frequency: 'interval' }, ({ everyDays }) =>
      t('reminders.schedule.interval', { count: everyDays, time }),
    )
    .exhaustive();
};
