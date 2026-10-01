import type { LocalDateTime } from '@kiko/reminders/native';
import { type ReminderSchedule, toInstant } from '@kiko/reminders/schedule';

import {
  isPausedNoticeResponse,
  isSnoozePending,
  type PlannedRequest,
  planReminder,
  type ReminderPlanInput,
} from './plan-reminder';

// Instants are built through the local `Date` constructor so each fixture is a
// wall-clock time on the host's own calendar, the same way the planner reads it.
const local = (year: number, month: number, day: number, hour = 0, minute = 0): number =>
  new Date(year, month - 1, day, hour, minute).getTime();

const at = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): LocalDateTime => ({ year, month, day, hour, minute });

const DAILY_AT_EIGHT_PM: ReminderSchedule = { frequency: 'daily', minuteOfDay: 20 * 60 };

const input = (overrides: Partial<ReminderPlanInput> = {}): ReminderPlanInput => ({
  reminderId: 'reminder-1',
  accountId: 'account-1',
  kind: 'add_transactions',
  schedule: DAILY_AT_EIGHT_PM,
  activeSince: local(2026, 9, 24, 10),
  deliverableSince: local(2026, 9, 1),
  lastEngagedAt: null,
  lastDataAt: null,
  lastSnoozedAt: null,
  now: local(2026, 9, 24, 12),
  ...overrides,
});

const firesOf = (requests: readonly PlannedRequest[]) =>
  requests.map(({ fireAt, variant }) => ({ fireAt, variant }));

describe('planReminder — smart skip', () => {
  const mondayAndThursday: ReminderSchedule = {
    frequency: 'weekly',
    minuteOfDay: 9 * 60,
    weekdays: [1, 4],
  };

  const monthlyOnTheFirst: ReminderSchedule = {
    frequency: 'monthly',
    minuteOfDay: 19 * 60,
    dayOfMonth: 1,
  };

  it('fires Thursday after data on Tuesday morning, before the middle of the gap since Monday', () => {
    const { requests } = planReminder(
      input({
        schedule: mondayAndThursday,
        activeSince: local(2026, 9, 28, 8),
        lastDataAt: local(2026, 9, 29, 10),
        now: local(2026, 9, 30, 10),
      }),
    );

    expect(firesOf(requests)).toEqual([
      { fireAt: at(2026, 10, 1, 9, 0), variant: 'reminder' },
      { fireAt: at(2026, 10, 5, 9, 0), variant: 'reminder' },
      { fireAt: at(2026, 10, 8, 9, 0), variant: 'reminder' },
      { fireAt: at(2026, 10, 12, 9, 0), variant: 'pausedNotice' },
    ]);
  });

  it('skips Thursday after data on Wednesday, in the later half of the gap since Monday', () => {
    const { requests } = planReminder(
      input({
        schedule: mondayAndThursday,
        activeSince: local(2026, 9, 28, 8),
        lastDataAt: local(2026, 9, 30, 10),
        now: local(2026, 9, 30, 11),
      }),
    );

    expect(firesOf(requests)).toEqual([
      { fireAt: at(2026, 10, 5, 9, 0), variant: 'reminder' },
      { fireAt: at(2026, 10, 8, 9, 0), variant: 'reminder' },
      { fireAt: at(2026, 10, 12, 9, 0), variant: 'reminder' },
      { fireAt: at(2026, 10, 15, 9, 0), variant: 'pausedNotice' },
    ]);
  });

  it('fires next month for a monthly reminder answered the morning after its fire', () => {
    const { requests } = planReminder(
      input({
        schedule: monthlyOnTheFirst,
        activeSince: local(2026, 9, 20, 10),
        lastDataAt: local(2026, 10, 2, 10),
        now: local(2026, 10, 2, 11),
      }),
    );

    expect(requests[0]?.fireAt).toEqual(at(2026, 11, 1, 19, 0));
  });

  it('skips next month for a monthly reminder after data late in the month', () => {
    const { requests } = planReminder(
      input({
        schedule: monthlyOnTheFirst,
        activeSince: local(2026, 9, 20, 10),
        lastDataAt: local(2026, 10, 20, 10),
        now: local(2026, 10, 20, 11),
      }),
    );

    expect(requests[0]?.fireAt).toEqual(at(2026, 12, 1, 19, 0));
  });

  it('fires the next morning for a 09:00 daily reminder answered the evening before', () => {
    const { requests } = planReminder(
      input({
        schedule: { frequency: 'daily', minuteOfDay: 9 * 60 },
        activeSince: local(2026, 9, 20, 10),
        lastDataAt: local(2026, 9, 28, 22),
        now: local(2026, 9, 28, 23),
      }),
    );

    expect(requests[0]?.fireAt).toEqual(at(2026, 9, 29, 9, 0));
  });

  it('fires Thursday after data on Monday, the day of the previous fire', () => {
    const { requests } = planReminder(
      input({
        schedule: mondayAndThursday,
        activeSince: local(2026, 9, 28, 8),
        lastDataAt: local(2026, 9, 28, 10),
        now: local(2026, 9, 28, 11),
      }),
    );

    expect(requests[0]?.fireAt).toEqual(at(2026, 10, 1, 9, 0));
  });

  it('skips tonight for data added earlier today, before the reminder existed', () => {
    const { requests } = planReminder(
      input({
        activeSince: local(2026, 9, 28, 10),
        lastDataAt: local(2026, 9, 28, 9),
        now: local(2026, 9, 28, 10),
      }),
    );

    expect(requests[0]?.fireAt).toEqual(at(2026, 9, 29, 20, 0));
    expect(requests.map(({ daysSinceData }) => daysSinceData)).toEqual([1, 2, 3, 4]);
  });

  it('new data resets the ignored count, and data after a fire keeps the next day’s fire', () => {
    const { requests, backoffPausedAt } = planReminder(
      input({ now: local(2026, 9, 25, 21), lastDataAt: local(2026, 9, 25, 20, 55) }),
    );

    expect(backoffPausedAt).toBeNull();
    expect(firesOf(requests)).toEqual([
      { fireAt: at(2026, 9, 26, 20, 0), variant: 'reminder' },
      { fireAt: at(2026, 9, 27, 20, 0), variant: 'reminder' },
      { fireAt: at(2026, 9, 28, 20, 0), variant: 'reminder' },
      { fireAt: at(2026, 9, 29, 20, 0), variant: 'pausedNotice' },
    ]);
  });
});

describe('planReminder — back-off', () => {
  it.each([
    { ignored: 0, now: local(2026, 9, 24, 12), reminderDays: [24, 25, 26] },
    { ignored: 1, now: local(2026, 9, 24, 21), reminderDays: [25, 26] },
    { ignored: 2, now: local(2026, 9, 25, 21), reminderDays: [26] },
    { ignored: 3, now: local(2026, 9, 26, 21), reminderDays: [] },
  ])(
    'after $ignored ignored fires, plans the rest of 3 reminders and one notice',
    ({ now, reminderDays }) => {
      const { requests, backoffPausedAt } = planReminder(input({ now }));

      expect(backoffPausedAt).toBeNull();
      expect(firesOf(requests)).toEqual([
        ...reminderDays.map((day) => ({ fireAt: at(2026, 9, day, 20, 0), variant: 'reminder' })),
        { fireAt: at(2026, 9, 27, 20, 0), variant: 'pausedNotice' },
      ]);
    },
  );

  it('pauses at the notice slot and plans nothing once that slot is in the past', () => {
    expect(planReminder(input({ now: local(2026, 9, 27, 21) }))).toEqual({
      requests: [],
      backoffPausedAt: local(2026, 9, 27, 20),
    });
  });

  it('counts no ignored fire from before notifications could be delivered', () => {
    const { requests, backoffPausedAt } = planReminder(
      input({ now: local(2026, 9, 27, 21), deliverableSince: local(2026, 9, 27, 20, 30) }),
    );

    expect(backoffPausedAt).toBeNull();
    expect(firesOf(requests)).toEqual([
      { fireAt: at(2026, 9, 28, 20, 0), variant: 'reminder' },
      { fireAt: at(2026, 9, 29, 20, 0), variant: 'reminder' },
      { fireAt: at(2026, 9, 30, 20, 0), variant: 'reminder' },
      { fireAt: at(2026, 10, 1, 20, 0), variant: 'pausedNotice' },
    ]);
  });

  it('still skips for data added before notifications could be delivered', () => {
    const { requests } = planReminder(
      input({
        lastDataAt: local(2026, 9, 27, 12),
        deliverableSince: local(2026, 9, 27, 13),
        now: local(2026, 9, 27, 14),
      }),
    );

    expect(firesOf(requests)[0]).toEqual({ fireAt: at(2026, 9, 28, 20, 0), variant: 'reminder' });
  });

  it('a tap after two ignored fires resets the count', () => {
    const { requests } = planReminder(
      input({ now: local(2026, 9, 25, 21), lastEngagedAt: local(2026, 9, 25, 20, 30) }),
    );

    expect(firesOf(requests)).toEqual([
      { fireAt: at(2026, 9, 26, 20, 0), variant: 'reminder' },
      { fireAt: at(2026, 9, 27, 20, 0), variant: 'reminder' },
      { fireAt: at(2026, 9, 28, 20, 0), variant: 'reminder' },
      { fireAt: at(2026, 9, 29, 20, 0), variant: 'pausedNotice' },
    ]);
  });
});

describe('planReminder — a pending "Tomorrow" snooze', () => {
  it('skips the regular occurrence at the snooze’s minute, so one notification fires', () => {
    const snoozedAt = local(2026, 9, 28, 20, 5);
    const { requests } = planReminder(
      input({
        activeSince: local(2026, 9, 20, 10),
        lastEngagedAt: snoozedAt,
        lastSnoozedAt: snoozedAt,
        now: local(2026, 9, 28, 20, 10),
      }),
    );

    expect(firesOf(requests)).toEqual([
      { fireAt: at(2026, 9, 30, 20, 0), variant: 'reminder' },
      { fireAt: at(2026, 10, 1, 20, 0), variant: 'reminder' },
      { fireAt: at(2026, 10, 2, 20, 0), variant: 'pausedNotice' },
    ]);
  });

  it('a snooze tapped the next morning lands one day later and skips that day only', () => {
    const snoozedAt = local(2026, 9, 29, 8);
    const { requests } = planReminder(
      input({
        activeSince: local(2026, 9, 20, 10),
        lastEngagedAt: snoozedAt,
        lastSnoozedAt: snoozedAt,
        now: local(2026, 9, 29, 8, 5),
      }),
    );

    expect(firesOf(requests)).toEqual([
      { fireAt: at(2026, 9, 29, 20, 0), variant: 'reminder' },
      { fireAt: at(2026, 10, 1, 20, 0), variant: 'reminder' },
      { fireAt: at(2026, 10, 2, 20, 0), variant: 'pausedNotice' },
    ]);
  });

  it('once the snooze has fired, it counts as that day’s ignored fire', () => {
    const snoozedAt = local(2026, 9, 28, 20, 5);
    const { requests } = planReminder(
      input({
        activeSince: local(2026, 9, 20, 10),
        lastEngagedAt: snoozedAt,
        lastSnoozedAt: snoozedAt,
        now: local(2026, 9, 29, 21),
      }),
    );

    expect(firesOf(requests)).toEqual([
      { fireAt: at(2026, 9, 30, 20, 0), variant: 'reminder' },
      { fireAt: at(2026, 10, 1, 20, 0), variant: 'reminder' },
      { fireAt: at(2026, 10, 2, 20, 0), variant: 'pausedNotice' },
    ]);
  });

  it('skips nothing when the snooze lands on a day with no occurrence', () => {
    const snoozedAt = local(2026, 9, 28, 9, 5);
    const { requests } = planReminder(
      input({
        schedule: { frequency: 'weekly', minuteOfDay: 9 * 60, weekdays: [1] },
        activeSince: local(2026, 9, 20, 10),
        lastEngagedAt: snoozedAt,
        lastSnoozedAt: snoozedAt,
        now: local(2026, 9, 28, 9, 10),
      }),
    );

    expect(requests.map(({ fireAt }) => fireAt)).toEqual([
      at(2026, 10, 5, 9, 0),
      at(2026, 10, 12, 9, 0),
      at(2026, 10, 19, 9, 0),
      at(2026, 10, 26, 9, 0),
    ]);
  });
});

describe('planReminder — request fields', () => {
  it('counts whole calendar days since the data to each fire', () => {
    const { requests } = planReminder(
      input({
        kind: 'statement_import',
        schedule: { frequency: 'monthly', minuteOfDay: 19 * 60, dayOfMonth: 1 },
        lastDataAt: local(2026, 9, 25, 12),
        activeSince: local(2026, 9, 25, 13),
        now: local(2026, 9, 25, 13),
      }),
    );

    // The data is in the later half of the gap from Sep 1's fire, so Oct 1 is
    // skipped.
    expect(requests.map(({ daysSinceData }) => daysSinceData)).toEqual([37, 67, 98, 129]);
  });

  it('gives an import reminder with no data a null day count', () => {
    const { requests } = planReminder(input({ kind: 'statement_import', lastDataAt: null }));

    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every(({ daysSinceData }) => daysSinceData === null)).toBe(true);
  });

  it('names each request by reminder and local fire minute, and the notice by reminder', () => {
    const { requests } = planReminder(input({ reminderId: 'abc' }));

    expect(requests.map(({ identifier }) => identifier)).toEqual([
      'kiko.reminder.abc.202609242000',
      'kiko.reminder.abc.202609252000',
      'kiko.reminder.abc.202609262000',
      'kiko.reminder.abc.paused',
    ]);
  });

  it('keeps the same identifiers across two runs and a later run with nothing fired', () => {
    const identifiersAt = (now: number): string[] =>
      planReminder(input({ now })).requests.map(({ identifier }) => identifier);

    expect(identifiersAt(local(2026, 9, 24, 12))).toEqual(identifiersAt(local(2026, 9, 24, 12)));
    expect(identifiersAt(local(2026, 9, 24, 19))).toEqual(identifiersAt(local(2026, 9, 24, 12)));
  });

  it('carries the reminder, account and kind on every request', () => {
    const { requests } = planReminder(
      input({ reminderId: 'r-9', accountId: 'a-9', kind: 'statement_import' }),
    );

    expect(
      requests.every(
        (request) =>
          request.reminderId === 'r-9' &&
          request.accountId === 'a-9' &&
          request.kind === 'statement_import',
      ),
    ).toBe(true);
  });

  it('fires at the chosen local time on a DST day, as floating components', () => {
    const { requests } = planReminder(
      input({
        schedule: { frequency: 'daily', minuteOfDay: 3 * 60 + 30 },
        activeSince: local(2027, 3, 27, 12),
        now: local(2027, 3, 27, 12),
      }),
    );
    const instants = requests.map(({ fireAt }) => toInstant(fireAt));

    expect(requests.map(({ fireAt }) => fireAt)).toEqual([
      at(2027, 3, 28, 3, 30),
      at(2027, 3, 29, 3, 30),
      at(2027, 3, 30, 3, 30),
      at(2027, 3, 31, 3, 30),
    ]);
    expect(instants).toEqual([...instants].sort((left, right) => left - right));
  });
});

describe('planReminder — an invalid stored schedule', () => {
  it('plans nothing for a weekly schedule with no weekdays, and does not throw', () => {
    expect(
      planReminder(input({ schedule: { frequency: 'weekly', minuteOfDay: 9 * 60, weekdays: [] } })),
    ).toEqual({ requests: [], backoffPausedAt: null });
  });
});

describe('isSnoozePending', () => {
  const snoozedAt = local(2026, 9, 28, 20, 5);

  it('is false when the reminder was never snoozed', () => {
    expect(isSnoozePending(input({ lastSnoozedAt: null }))).toBe(false);
  });

  it('is true until the next day at the reminder’s time, and false from that minute on', () => {
    expect(
      isSnoozePending(input({ lastSnoozedAt: snoozedAt, now: local(2026, 9, 29, 19, 59) })),
    ).toBe(true);
    expect(isSnoozePending(input({ lastSnoozedAt: snoozedAt, now: local(2026, 9, 29, 20) }))).toBe(
      false,
    );
  });

  it('is false for a stored schedule that fails the guard', () => {
    expect(
      isSnoozePending(
        input({
          schedule: { frequency: 'weekly', minuteOfDay: 9 * 60, weekdays: [] },
          lastSnoozedAt: snoozedAt,
          now: local(2026, 9, 29, 8),
        }),
      ),
    ).toBe(false);
  });
});

describe('isPausedNoticeResponse', () => {
  const planned = planReminder(input({ now: local(2026, 9, 25, 21) })).requests;
  const tapOn = ({ reminderId, identifier }: PlannedRequest) => ({
    reminderId,
    requestIdentifier: identifier,
  });

  it('is true for a tap on the paused notice the plan scheduled', () => {
    const notice = planned.find(({ variant }) => variant === 'pausedNotice');

    expect(notice).toBeDefined();
    expect(isPausedNoticeResponse(tapOn(notice as PlannedRequest))).toBe(true);
  });

  it('is false for a tap on any of the reminder’s own notifications', () => {
    const reminders = planned.filter(({ variant }) => variant === 'reminder');

    expect(reminders).not.toHaveLength(0);
    expect(reminders.some((request) => isPausedNoticeResponse(tapOn(request)))).toBe(false);
  });

  it('is false for another reminder’s paused notice identifier', () => {
    expect(
      isPausedNoticeResponse({
        reminderId: 'reminder-2',
        requestIdentifier: 'kiko.reminder.reminder-1.paused',
      }),
    ).toBe(false);
  });
});
