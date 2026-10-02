import {
  type LocalDateTime,
  type NotificationResponse,
  REMINDER_IDENTIFIER_PREFIX,
} from '@kiko/reminders/native';
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

// The planning rules:
// - The anchor is the latest of `activeSince`, `deliverableSince`,
//   `lastEngagedAt` and `lastDataAt`: a tap, new data, or iOS starting to
//   show the app's notifications starts the ignored count again.
// - An occurrence is SKIPPED when `lastDataAt` is on a local calendar day
//   after the schedule's previous occurrence's day AND is either on the
//   occurrence's own local day or at or after the midpoint, in absolute time,
//   between the previous occurrence and this one: the user already did what
//   it asks, close enough to this occurrence that it is not an answer to the
//   previous one. Data on the previous occurrence's day never skips, so a
//   daily reminder skips only for data on its own day, and a user who answers
//   every daily reminder, even that evening, is still reminded every time.
//   Data early in a longer gap does not skip either, so a monthly reminder
//   answered the next morning still fires next month. An every-N-days
//   schedule's first occurrence has no previous one, so only data on its own
//   day skips it. A reminder created or edited after the data skips too,
//   since `activeSince` plays no part.
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
  // From when iOS could show the app's notifications. Only the anchor reads
  // it: data from before it still skips an occurrence.
  deliverableSince: number;
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

// The previous occurrence is the schedule's own, skipped or not, and also from
// before the reminder existed.
const previousOccurrence = (
  schedule: ReminderSchedule,
  fireAt: LocalDateTime,
): LocalDateTime | undefined => occurrenceAtOrBefore(schedule, toInstant(fireAt) - MINUTE_MS);

const isAfterGapMidpoint = (
  lastDataAt: number,
  previous: LocalDateTime,
  fireAt: LocalDateTime,
): boolean => lastDataAt >= (toInstant(previous) + toInstant(fireAt)) / 2;

// Every slot comes after the anchor, which is never before `lastDataAt`, so
// the data is always from before the slot fires.
const isSkipped = (input: ReminderPlanInput, fireAt: LocalDateTime): boolean =>
  foldMap(maybe(input.lastDataAt), (lastDataAt) => {
    const isOnFireDay = calendarDaysBetween(lastDataAt, fireAt) === 0;

    return (
      foldMap(
        maybe(previousOccurrence(input.schedule, fireAt)),
        (previous) =>
          calendarDaysBetween(lastDataAt, previous) < 0 &&
          (isOnFireDay || isAfterGapMidpoint(lastDataAt, previous, fireAt)),
      ) ?? isOnFireDay
    );
  }) ?? false;

// At most one occurrence after the anchor can be skipped (every later one's
// previous occurrence is on or after the first one's day, so not before the
// data's), so this loop is short.
const ordinalSlots = (input: ReminderPlanInput): Slot[] => {
  const slots: Slot[] = [];
  let cursor = Math.max(
    input.activeSince,
    input.deliverableSince,
    input.lastEngagedAt ?? Number.NEGATIVE_INFINITY,
    input.lastDataAt ?? Number.NEGATIVE_INFINITY,
  );

  while (slots.length <= IGNORED_LIMIT) {
    const fireAt = occurrenceAfter(input.schedule, cursor);

    cursor = toInstant(fireAt);

    if (!isSkipped(input, fireAt)) {
      slots.push({ fireAt, instant: cursor });
    }
  }

  return slots;
};

const requestIdentifier = (reminderId: string, suffix: string): string =>
  REMINDER_IDENTIFIER_PREFIX.concat(reminderId, '.', suffix);

const pausedNoticeIdentifier = (reminderId: string): string =>
  requestIdentifier(reminderId, 'paused');

export const isPausedNoticeResponse = (
  response: Pick<NotificationResponse, 'reminderId' | 'requestIdentifier'>,
): boolean => response.requestIdentifier === pausedNoticeIdentifier(response.reminderId);

const toRequest = (
  input: ReminderPlanInput,
  fireAt: LocalDateTime,
  variant: PlannedRequest['variant'],
): PlannedRequest => ({
  identifier:
    variant === 'pausedNotice'
      ? pausedNoticeIdentifier(input.reminderId)
      : requestIdentifier(input.reminderId, fireStamp(fireAt)),
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
