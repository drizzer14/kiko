import { ukrainianCardinalCategory } from '@kiko/i18n/plural-rules';
import { isReminderSchedule, type LocalDay } from '@kiko/reminders/schedule';

import {
  defaultDraft,
  draftFromSchedule,
  draftToSchedule,
  type ReminderDraft,
  everyDaysPluralCount,
  validateReminderDraft,
  withFrequency,
} from '.';

const TODAY: LocalDay = { year: 2026, month: 9, day: 29 };
const SAVED_ANCHOR: LocalDay = { year: 2026, month: 8, day: 3 };

const draftOf = (fields: Partial<ReminderDraft>): ReminderDraft => ({
  ...defaultDraft('add_transactions'),
  ...fields,
});

describe('defaultDraft', () => {
  it('starts an import reminder monthly on day 1 at 19:00', () => {
    expect(draftToSchedule(defaultDraft('statement_import'), TODAY)).toEqual({
      frequency: 'monthly',
      minuteOfDay: 19 * 60,
      dayOfMonth: 1,
    });
  });

  it('starts an add-transactions reminder daily at 20:00', () => {
    expect(draftToSchedule(defaultDraft('add_transactions'), TODAY)).toEqual({
      frequency: 'daily',
      minuteOfDay: 20 * 60,
    });
  });

  it('passes validation as it is, for both kinds', () => {
    expect(validateReminderDraft(defaultDraft('statement_import'))).toEqual({});
    expect(validateReminderDraft(defaultDraft('add_transactions'))).toEqual({});
  });
});

describe('validateReminderDraft', () => {
  it('accepts a daily draft', () => {
    expect(validateReminderDraft(draftOf({ frequency: 'daily' }))).toEqual({});
  });

  it('rejects a weekly draft with no days, and accepts one day', () => {
    expect(validateReminderDraft(draftOf({ frequency: 'weekly', weekdays: [] }))).toEqual({
      weekdaysError: true,
    });
    expect(validateReminderDraft(draftOf({ frequency: 'weekly', weekdays: [3] }))).toEqual({});
  });

  it('accepts a monthly draft on any day of the month, including 31', () => {
    expect(validateReminderDraft(draftOf({ frequency: 'monthly', dayOfMonth: 1 }))).toEqual({});
    expect(validateReminderDraft(draftOf({ frequency: 'monthly', dayOfMonth: 31 }))).toEqual({});
  });

  it.each(['2', '7', ' 30 ', '365'])('accepts an interval of %p days', (everyDaysText) => {
    expect(validateReminderDraft(draftOf({ frequency: 'interval', everyDaysText }))).toEqual({});
  });

  it.each(['', ' ', '0', '1', '366', '2.5', '-3', '1e1', 'seven'])(
    'rejects an interval of %p days',
    (everyDaysText) => {
      expect(validateReminderDraft(draftOf({ frequency: 'interval', everyDaysText }))).toEqual({
        intervalError: true,
      });
    },
  );

  it('checks only the fields of the chosen frequency', () => {
    expect(
      validateReminderDraft(draftOf({ frequency: 'daily', weekdays: [], everyDaysText: '' })),
    ).toEqual({});
  });
});

describe('draftToSchedule', () => {
  it('stores the weekdays once each, in Sunday-first order', () => {
    expect(
      draftToSchedule(draftOf({ frequency: 'weekly', weekdays: [5, 1, 0, 5] }), TODAY),
    ).toEqual({ frequency: 'weekly', minuteOfDay: 20 * 60, weekdays: [0, 1, 5] });
  });

  it('stores the day of the month and the time', () => {
    expect(
      draftToSchedule(draftOf({ frequency: 'monthly', dayOfMonth: 31, minuteOfDay: 545 }), TODAY),
    ).toEqual({ frequency: 'monthly', minuteOfDay: 545, dayOfMonth: 31 });
  });

  it('anchors a new interval on today', () => {
    expect(
      draftToSchedule(draftOf({ frequency: 'interval', everyDaysText: ' 10 ' }), TODAY),
    ).toEqual({ frequency: 'interval', minuteOfDay: 20 * 60, everyDays: 10, anchorDay: TODAY });
  });

  it('refuses an interval that failed validation, rather than store a made-up length', () => {
    expect(() =>
      draftToSchedule(draftOf({ frequency: 'interval', everyDaysText: '1' }), TODAY),
    ).toThrow('not a valid interval');
  });

  it('produces a schedule the planner accepts, for every frequency', () => {
    const drafts: readonly ReminderDraft[] = [
      draftOf({ frequency: 'daily' }),
      draftOf({ frequency: 'weekly', weekdays: [6] }),
      draftOf({ frequency: 'monthly', dayOfMonth: 29 }),
      draftOf({ frequency: 'interval', everyDaysText: '2' }),
    ];

    for (const draft of drafts) {
      expect(isReminderSchedule(draftToSchedule(draft, TODAY))).toBe(true);
    }
  });
});

describe('draftFromSchedule', () => {
  it('reads each frequency back into the same schedule', () => {
    const schedules = [
      { frequency: 'daily', minuteOfDay: 0 },
      { frequency: 'weekly', minuteOfDay: 1439, weekdays: [1, 3] },
      { frequency: 'monthly', minuteOfDay: 600, dayOfMonth: 15 },
      { frequency: 'interval', minuteOfDay: 480, everyDays: 14, anchorDay: SAVED_ANCHOR },
    ] as const;

    for (const schedule of schedules) {
      expect(draftToSchedule(draftFromSchedule('statement_import', schedule), TODAY)).toEqual(
        schedule,
      );
    }
  });

  it('keeps the other fields at the kind defaults, so a frequency switch starts from them', () => {
    const draft = draftFromSchedule('statement_import', { frequency: 'daily', minuteOfDay: 90 });

    expect(draftToSchedule({ ...draft, frequency: 'monthly' }, TODAY)).toEqual({
      frequency: 'monthly',
      minuteOfDay: 90,
      dayOfMonth: 1,
    });
  });

  it('keeps the saved anchor when an edit leaves the interval length alone', () => {
    const draft = draftFromSchedule('add_transactions', {
      frequency: 'interval',
      minuteOfDay: 480,
      everyDays: 14,
      anchorDay: SAVED_ANCHOR,
    });

    expect(draftToSchedule({ ...draft, minuteOfDay: 540 }, TODAY)).toMatchObject({
      everyDays: 14,
      anchorDay: SAVED_ANCHOR,
    });
  });

  it('re-anchors on today when an edit changes the interval length', () => {
    const draft = draftFromSchedule('add_transactions', {
      frequency: 'interval',
      minuteOfDay: 480,
      everyDays: 14,
      anchorDay: SAVED_ANCHOR,
    });

    expect(draftToSchedule({ ...draft, everyDaysText: '7' }, TODAY)).toMatchObject({
      everyDays: 7,
      anchorDay: TODAY,
    });
  });

  it('anchors on today when an edit turns another frequency into an interval', () => {
    const draft = draftFromSchedule('add_transactions', { frequency: 'daily', minuteOfDay: 480 });

    expect(
      draftToSchedule({ ...draft, frequency: 'interval', everyDaysText: '3' }, TODAY),
    ).toMatchObject({ everyDays: 3, anchorDay: TODAY });
  });
});

describe('withFrequency', () => {
  const TUESDAY = 2;

  it('preselects today’s weekday on a switch to weekly', () => {
    const draft = withFrequency(defaultDraft('add_transactions'), 'weekly', TODAY);

    expect(draft.frequency).toBe('weekly');
    expect(draft.weekdays).toEqual([TUESDAY]);
    expect(validateReminderDraft(draft)).toEqual({});
  });

  it('preselects 7 days on a switch to every N days', () => {
    const draft = withFrequency(defaultDraft('statement_import'), 'interval', TODAY);

    expect(draftToSchedule(draft, TODAY)).toMatchObject({ frequency: 'interval', everyDays: 7 });
  });

  it('keeps the days the user already picked', () => {
    const draft = withFrequency(draftOf({ frequency: 'daily', weekdays: [5, 6] }), 'weekly', TODAY);

    expect(draft.weekdays).toEqual([5, 6]);
  });

  it('keeps the interval the user already typed, even an invalid one', () => {
    const draft = withFrequency(draftOf({ everyDaysText: '1' }), 'interval', TODAY);

    expect(draft.everyDaysText).toBe('1');
  });

  it('changes nothing but the frequency for daily and monthly', () => {
    const draft = draftOf({ frequency: 'weekly', weekdays: [], everyDaysText: '' });

    expect(withFrequency(draft, 'daily', TODAY)).toEqual({ ...draft, frequency: 'daily' });
    expect(withFrequency(draft, 'monthly', TODAY)).toEqual({ ...draft, frequency: 'monthly' });
  });
});

describe('everyDaysPluralCount', () => {
  it.each([
    ['1', 1],
    ['2', 2],
    [' 22 ', 22],
    ['400', 400],
  ])('counts %p as %p, in or out of the allowed range', (everyDaysText, count) => {
    expect(everyDaysPluralCount(everyDaysText)).toBe(count);
  });

  it.each(['', ' ', '1.5', 'abc'])(
    'counts %p as no number: the plural form of "days" with no number before it',
    (everyDaysText) => {
      const count = everyDaysPluralCount(everyDaysText);

      expect(count).toBe(0);
      expect(ukrainianCardinalCategory(count)).toBe('many');
    },
  );
});
