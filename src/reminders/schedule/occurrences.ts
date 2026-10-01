import { match } from 'ts-pattern';
import { minOf } from '@kiko/numbers';
import type { LocalDateTime } from '@kiko/reminders/native';

import {
  addDays,
  daysInMonth,
  dayNumberOf,
  localDayFromNumber,
  localDayOf,
  weekdayOf,
} from './calendar-day';
import type { LocalDay, ReminderSchedule } from './reminder-schedule';

// Every function here takes a schedule that passed `isReminderSchedule`.
// Occurrences are local wall-clock components, never instants: a reminder
// keeps its chosen local time across a DST change or a time-zone move. An
// instant is derived only to compare against "now", through `toInstant`.

const MINUTES_PER_HOUR = 60;
const WEEK_DAYS = 7;

type YearMonth = { year: number; month: number };

export const toInstant = (local: LocalDateTime): number =>
  new Date(local.year, local.month - 1, local.day, local.hour, local.minute).getTime();

const atMinuteOfDay = (day: LocalDay, minuteOfDay: number): LocalDateTime => ({
  year: day.year,
  month: day.month,
  day: day.day,
  hour: Math.floor(minuteOfDay / MINUTES_PER_HOUR),
  minute: minuteOfDay % MINUTES_PER_HOUR,
});

// Clamped to the month's length, so day 31 fires on every month's last day.
const monthlyDay = ({ year, month }: YearMonth, dayOfMonth: number): LocalDay => ({
  year,
  month,
  day: Math.min(dayOfMonth, daysInMonth(year, month)),
});

const shiftMonth = ({ year, month }: YearMonth, months: number): YearMonth => {
  const monthIndex = year * 12 + (month - 1) + months;

  return { year: Math.floor(monthIndex / 12), month: (monthIndex % 12) + 1 };
};

const firstDayOnOrAfter = (schedule: ReminderSchedule, from: LocalDay): LocalDay =>
  match(schedule)
    .with({ frequency: 'daily' }, () => from)
    .with({ frequency: 'weekly' }, ({ weekdays }) => {
      const daysAhead = weekdays.map(
        (weekday) => (weekday - weekdayOf(from) + WEEK_DAYS) % WEEK_DAYS,
      );

      return addDays(from, minOf(daysAhead));
    })
    .with({ frequency: 'monthly' }, ({ dayOfMonth }) => {
      const thisMonth = monthlyDay(from, dayOfMonth);

      return thisMonth.day >= from.day ? thisMonth : monthlyDay(shiftMonth(from, 1), dayOfMonth);
    })
    .with({ frequency: 'interval' }, ({ everyDays, anchorDay }) => {
      const anchor = dayNumberOf(anchorDay);
      const steps = Math.max(0, Math.ceil((dayNumberOf(from) - anchor) / everyDays));

      return localDayFromNumber(anchor + steps * everyDays);
    })
    .exhaustive();

// A later calendar day is always a later instant, so one step past a candidate
// that is not after `instant` is enough. On a fall-back day the repeated hour
// resolves to its first pass, so that day's occurrence fires once.
export const occurrenceAfter = (schedule: ReminderSchedule, instant: number): LocalDateTime => {
  const candidate = atMinuteOfDay(
    firstDayOnOrAfter(schedule, localDayOf(instant)),
    schedule.minuteOfDay,
  );

  if (toInstant(candidate) > instant) {
    return candidate;
  }

  return atMinuteOfDay(firstDayOnOrAfter(schedule, addDays(candidate, 1)), schedule.minuteOfDay);
};

// Whole local calendar days from the instant's date to `to`'s date, whatever
// the clock times and however long the days in between were.
export const calendarDaysBetween = (fromInstant: number, to: LocalDateTime): number =>
  dayNumberOf(to) - dayNumberOf(localDayOf(fromInstant));
