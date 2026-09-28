import {
  INTERVAL_MAXIMUM_DAYS,
  INTERVAL_MINIMUM_DAYS,
  type LocalDay,
  type ReminderKind,
  type ReminderSchedule,
  type Weekday,
  weekdayOf,
} from '@kiko/reminders/schedule';
import { match } from 'ts-pattern';

type ReminderFrequency = ReminderSchedule['frequency'];

// The form's state. It holds every frequency's fields at once, so switching
// the frequency back and forth keeps what the user entered. `everyDaysText` is
// the raw text field value. `savedInterval` is the stored interval of the
// reminder being edited: its anchor day survives an edit only while the length
// stays the same, or every occurrence would shift.
export type ReminderDraft = {
  frequency: ReminderFrequency;
  minuteOfDay: number;
  weekdays: readonly Weekday[];
  dayOfMonth: number;
  everyDaysText: string;
  savedInterval?: { everyDays: number; anchorDay: LocalDay };
};

type ReminderDraftErrors = { weekdaysError?: true; intervalError?: true };

const KIND_DEFAULTS: Record<
  ReminderKind,
  Pick<ReminderDraft, 'frequency' | 'minuteOfDay' | 'dayOfMonth'>
> = {
  statement_import: { frequency: 'monthly', minuteOfDay: 19 * 60, dayOfMonth: 1 },
  add_transactions: { frequency: 'daily', minuteOfDay: 20 * 60, dayOfMonth: 1 },
};

const WHOLE_NUMBER = /^\d+$/;

const parseEveryDays = (text: string): number | undefined => {
  const trimmed = text.trim();

  if (!WHOLE_NUMBER.test(trimmed)) {
    return undefined;
  }

  const everyDays = Number(trimmed);

  return everyDays >= INTERVAL_MINIMUM_DAYS && everyDays <= INTERVAL_MAXIMUM_DAYS
    ? everyDays
    : undefined;
};

// The weekday and interval fields start empty; `withFrequency` fills them the
// first time the user switches to that frequency.
export const defaultDraft = (kind: ReminderKind): ReminderDraft => ({
  ...KIND_DEFAULTS[kind],
  weekdays: [],
  everyDaysText: '',
});

const PRESELECTED_EVERY_DAYS = '7';

// A switch to weekly or every-N-days starts from a valid choice (today's
// weekday, a week), so Save works at once. A value the user already entered
// stays, since switching back and forth must not lose it.
export const withFrequency = (
  draft: ReminderDraft,
  frequency: ReminderFrequency,
  today: LocalDay,
): ReminderDraft =>
  match(frequency)
    .returnType<ReminderDraft>()
    .with('weekly', () => ({
      ...draft,
      frequency,
      weekdays: draft.weekdays.length === 0 ? [weekdayOf(today)] : draft.weekdays,
    }))
    .with('interval', () => ({
      ...draft,
      frequency,
      everyDaysText: draft.everyDaysText === '' ? PRESELECTED_EVERY_DAYS : draft.everyDaysText,
    }))
    .with('daily', 'monthly', () => ({ ...draft, frequency }))
    .exhaustive();

export const draftFromSchedule = (
  kind: ReminderKind,
  schedule: ReminderSchedule,
): ReminderDraft => {
  const draft: ReminderDraft = {
    ...defaultDraft(kind),
    frequency: schedule.frequency,
    minuteOfDay: schedule.minuteOfDay,
  };

  return match(schedule)
    .returnType<ReminderDraft>()
    .with({ frequency: 'daily' }, () => draft)
    .with({ frequency: 'weekly' }, ({ weekdays }) => ({ ...draft, weekdays }))
    .with({ frequency: 'monthly' }, ({ dayOfMonth }) => ({ ...draft, dayOfMonth }))
    .with({ frequency: 'interval' }, ({ everyDays, anchorDay }) => ({
      ...draft,
      everyDaysText: String(everyDays),
      savedInterval: { everyDays, anchorDay },
    }))
    .exhaustive();
};

// Only the chosen frequency's fields are checked: a hidden field never blocks
// a save.
export const validateReminderDraft = (draft: ReminderDraft): ReminderDraftErrors =>
  match(draft.frequency)
    .returnType<ReminderDraftErrors>()
    .with('weekly', () => (draft.weekdays.length === 0 ? { weekdaysError: true } : {}))
    .with('interval', () =>
      parseEveryDays(draft.everyDaysText) === undefined ? { intervalError: true } : {},
    )
    .with('daily', 'monthly', () => ({}))
    .exhaustive();

const anchorDayFor = (draft: ReminderDraft, everyDays: number, today: LocalDay): LocalDay =>
  draft.savedInterval?.everyDays === everyDays ? draft.savedInterval.anchorDay : today;

// Call it only on a draft that passed `validateReminderDraft`: a stored
// schedule must never hold a length the user did not enter.
export const draftToSchedule = (draft: ReminderDraft, today: LocalDay): ReminderSchedule => {
  const { minuteOfDay } = draft;

  return match(draft.frequency)
    .returnType<ReminderSchedule>()
    .with('daily', () => ({ frequency: 'daily', minuteOfDay }))
    .with('weekly', () => ({
      frequency: 'weekly',
      minuteOfDay,
      weekdays: [...new Set(draft.weekdays)].sort((left, right) => left - right),
    }))
    .with('monthly', () => ({ frequency: 'monthly', minuteOfDay, dayOfMonth: draft.dayOfMonth }))
    .with('interval', () => {
      const everyDays = parseEveryDays(draft.everyDaysText);

      if (everyDays === undefined) {
        throw new Error(
          `reminders/draftToSchedule: "${draft.everyDaysText}" is not a valid interval`,
        );
      }

      return {
        frequency: 'interval',
        minuteOfDay,
        everyDays,
        anchorDay: anchorDayFor(draft, everyDays, today),
      };
    })
    .exhaustive();
};
