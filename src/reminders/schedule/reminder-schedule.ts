export const reminderKinds = ['statement_import', 'add_transactions'] as const;
export type ReminderKind = (typeof reminderKinds)[number];

// `Date#getDay` numbering: 0 is Sunday.
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

// A calendar date with no time or zone. `month` is 1-12, like `LocalDateTime`.
export type LocalDay = { year: number; month: number; day: number };

// `minuteOfDay` is the local wall-clock time, 0-1439. A monthly `dayOfMonth`
// past the month's length fires on that month's last day, so no month is
// skipped.
export type ReminderSchedule =
  | { frequency: 'daily'; minuteOfDay: number }
  | { frequency: 'weekly'; minuteOfDay: number; weekdays: readonly Weekday[] }
  | { frequency: 'monthly'; minuteOfDay: number; dayOfMonth: number }
  | { frequency: 'interval'; minuteOfDay: number; everyDays: number; anchorDay: LocalDay };
