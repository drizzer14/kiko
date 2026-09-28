import {
  calendarDaysBetween,
  isReminderSchedule,
  occurrenceAfter,
  occurrenceAtOrBefore,
  type ReminderKind,
  type ReminderSchedule,
  toInstant,
} from '@kiko/reminders/schedule';
import maybe, { foldMap } from 'fnts/maybe';
import { type LocalDateTime, REMINDER_IDENTIFIER_PREFIX } from '@kiko/reminders/native';

// The planning rules:
// - The anchor is the latest of `activeSince`, `lastEngagedAt` and
//   `lastDataAt`: a tap or new data starts the ignored count again.
// - An occurrence is SKIPPED when `lastDataAt` is at or after both the
//   previous occurrence and `activeSince`: new data arrived since the last
//   fire. Data from before the reminder existed never skips.
// - The non-skipped occurrences after the anchor take ordinals 1, 2, 3, ….
//   Those at or before `now` fired and were ignored. Ordinals up to
//   `IGNORED_LIMIT` are reminders; the next one is the single paused notice,
//   and nothing is planned after it. When that notice slot is already past,
//   nothing is planned and the reminder is paused at that slot.
// - A pending "Tomorrow" snooze fires the next day at the reminder's time. A
//   regular occurrence at that same minute is not requested, so the two never
//   fire together; the snooze stands in for it and keeps its ordinal.
// - Requests carry floating local components, never instants, so they keep
//   firing at the chosen local time after a time-zone move.

export const IGNORED_LIMIT = 3;

const MINUTE_MS = 60_000;
const MINUTES_PER_HOUR = 60;

export type ReminderPlanInput = {
  reminderId: string;
  accountId: string;
  kind: ReminderKind;
  schedule: ReminderSchedule;
  activeSince: number;
  lastEngagedAt: number | null;
  lastDataAt: number | null;
  // When the user last chose "Tomorrow" on this reminder's notification.
  lastSnoozedAt: number | null;
  now: number;
};

export type PlannedRequest = {
  identifier: string;
  reminderId: string;
  accountId: string;
  kind: ReminderKind;
  fireAt: LocalDateTime;
  variant: 'reminder' | 'pausedNotice';
  daysSinceData: number | null;
};

type ReminderPlan = { requests: PlannedRequest[]; backoffPausedAt: number | null };

type Slot = { fireAt: LocalDateTime; instant: number };

const NOTHING_PLANNED: ReminderPlan = { requests: [], backoffPausedAt: null };

const twoDigits = (value: number): string => String(value).padStart(2, '0');

const fireStamp = ({ year, month, day, hour, minute }: LocalDateTime): string =>
  String(year).concat(twoDigits(month), twoDigits(day), twoDigits(hour), twoDigits(minute));

const isSameMinute = (left: LocalDateTime, right: LocalDateTime): boolean =>
  fireStamp(left) === fireStamp(right);

// Mirrors the native snooze: tomorrow's local date, at the reminder's time.
const snoozeFireAt = (snoozedAt: number, minuteOfDay: number): LocalDateTime => {
  const snoozedDay = new Date(snoozedAt);
  const tomorrow = new Date(
    snoozedDay.getFullYear(),
    snoozedDay.getMonth(),
    snoozedDay.getDate() + 1,
  );

  return {
    year: tomorrow.getFullYear(),
    month: tomorrow.getMonth() + 1,
    day: tomorrow.getDate(),
    hour: Math.floor(minuteOfDay / MINUTES_PER_HOUR),
    minute: minuteOfDay % MINUTES_PER_HOUR,
  };
};

// The native snooze fires once, so a stored snooze time means nothing after
// that minute.
export const isSnoozePending = ({
  schedule,
  lastSnoozedAt,
  now,
}: Pick<ReminderPlanInput, 'schedule' | 'lastSnoozedAt' | 'now'>): boolean => {
  if (!isReminderSchedule(schedule)) {
    return false;
  }

  return (
    foldMap(
      maybe(lastSnoozedAt),
      (snoozedAt) => toInstant(snoozeFireAt(snoozedAt, schedule.minuteOfDay)) > now,
    ) ?? false
  );
};

const previousOccurrenceInstant = (schedule: ReminderSchedule, instant: number): number =>
  foldMap(maybe(occurrenceAtOrBefore(schedule, instant - MINUTE_MS)), toInstant) ??
  Number.NEGATIVE_INFINITY;

const isSkipped = (input: ReminderPlanInput, instant: number): boolean =>
  foldMap(
    maybe(input.lastDataAt),
    (lastDataAt) =>
      lastDataAt >= Math.max(previousOccurrenceInstant(input.schedule, instant), input.activeSince),
  ) ?? false;

// At most one occurrence after the anchor can be skipped (the next one's
// previous occurrence is already after the data), so this loop is short.
const ordinalSlots = (input: ReminderPlanInput): Slot[] => {
  const slots: Slot[] = [];
  let cursor = Math.max(
    input.activeSince,
    input.lastEngagedAt ?? Number.NEGATIVE_INFINITY,
    input.lastDataAt ?? Number.NEGATIVE_INFINITY,
  );

  while (slots.length <= IGNORED_LIMIT) {
    const fireAt = occurrenceAfter(input.schedule, cursor);

    cursor = toInstant(fireAt);

    if (!isSkipped(input, cursor)) {
      slots.push({ fireAt, instant: cursor });
    }
  }

  return slots;
};

const toRequest = (
  input: ReminderPlanInput,
  fireAt: LocalDateTime,
  variant: PlannedRequest['variant'],
): PlannedRequest => ({
  identifier: REMINDER_IDENTIFIER_PREFIX.concat(
    input.reminderId,
    '.',
    variant === 'pausedNotice' ? 'paused' : fireStamp(fireAt),
  ),
  reminderId: input.reminderId,
  accountId: input.accountId,
  kind: input.kind,
  fireAt,
  variant,
  daysSinceData:
    foldMap(maybe(input.lastDataAt), (lastDataAt) => calendarDaysBetween(lastDataAt, fireAt)) ??
    null,
});

// A stored schedule that fails the guard (a broken backup, another build's
// shape) would give NaN dates, so it plans nothing instead.
export const planReminder = (input: ReminderPlanInput): ReminderPlan => {
  if (!isReminderSchedule(input.schedule)) {
    return NOTHING_PLANNED;
  }

  const slots = ordinalSlots(input);
  const notice = slots[IGNORED_LIMIT] as Slot;

  if (notice.instant <= input.now) {
    return { requests: [], backoffPausedAt: notice.instant };
  }

  const snoozeSlot = foldMap(maybe(input.lastSnoozedAt), (snoozedAt) =>
    snoozeFireAt(snoozedAt, input.schedule.minuteOfDay),
  );
  const isTakenBySnooze = (fireAt: LocalDateTime): boolean =>
    foldMap(maybe(snoozeSlot), (snooze) => isSameMinute(snooze, fireAt)) ?? false;
  const reminders = slots
    .slice(0, IGNORED_LIMIT)
    .filter(({ fireAt, instant }) => instant > input.now && !isTakenBySnooze(fireAt))
    .map(({ fireAt }) => toRequest(input, fireAt, 'reminder'));

  return {
    requests: [...reminders, toRequest(input, notice.fireAt, 'pausedNotice')],
    backoffPausedAt: null,
  };
};
