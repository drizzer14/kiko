import { toInstant } from '@kiko/reminders/schedule';

import {
  IGNORED_LIMIT,
  PENDING_REQUEST_LIMIT,
  type PlannedRequest,
  planAllReminders,
  type ReminderPlanInput,
} from '.';

const local = (year: number, month: number, day: number, hour = 0, minute = 0): number =>
  new Date(year, month - 1, day, hour, minute).getTime();

const NOW = local(2026, 9, 28, 7);

const input = (overrides: Partial<ReminderPlanInput> = {}): ReminderPlanInput => ({
  reminderId: 'reminder-1',
  accountId: 'account-1',
  kind: 'add_transactions',
  schedule: { frequency: 'daily', minuteOfDay: 20 * 60 },
  activeSince: local(2026, 9, 28, 6),
  deliverableSince: local(2026, 9, 1),
  lastEngagedAt: null,
  lastDataAt: null,
  lastSnoozedAt: null,
  now: NOW,
  ...overrides,
});

const byFireThenReminder = (left: PlannedRequest, right: PlannedRequest): number =>
  toInstant(left.fireAt) - toInstant(right.fireAt) ||
  left.reminderId.localeCompare(right.reminderId);

// 20 accounts x 2 kinds, each at its own minute of an evening, so the 160
// planned requests spread over four days and the cap has to pick among them.
const manyAccounts = (): ReminderPlanInput[] =>
  Array.from({ length: 20 }, (_, accountNumber) =>
    (['statement_import', 'add_transactions'] as const).map((kind, kindNumber) =>
      input({
        reminderId: `reminder-${accountNumber}-${kind}`,
        accountId: `account-${accountNumber}`,
        kind,
        schedule: { frequency: 'daily', minuteOfDay: 18 * 60 + accountNumber * 2 + kindNumber },
      }),
    ),
  ).flat();

describe('planAllReminders', () => {
  it('keeps exactly the 64 earliest requests of 20 accounts x 2 kinds', () => {
    const everyRequest = planAllReminders(manyAccounts(), Number.POSITIVE_INFINITY).requests;
    const { requests } = planAllReminders(manyAccounts());

    expect(everyRequest).toHaveLength(40 * (IGNORED_LIMIT + 1));
    expect(PENDING_REQUEST_LIMIT).toBe(64);
    expect(requests).toHaveLength(64);
    expect(requests).toEqual(everyRequest.slice(0, 64));

    const latestKept = Math.max(...requests.map(({ fireAt }) => toInstant(fireAt)));
    const earliestDropped = Math.min(
      ...everyRequest.slice(64).map(({ fireAt }) => toInstant(fireAt)),
    );

    expect(latestKept).toBeLessThanOrEqual(earliestDropped);
  });

  // The native side adds requests in the given order until 64 are pending,
  // counting the kept snoozes, so an earliest-first order is what lets the
  // snoozes still fit while only the latest planned requests are left out.
  it('orders the requests earliest first, then by reminder id', () => {
    const { requests } = planAllReminders([
      input({ reminderId: 'b' }),
      input({ reminderId: 'a' }),
      input({ reminderId: 'c', schedule: { frequency: 'daily', minuteOfDay: 19 * 60 } }),
    ]);

    expect(requests).toEqual([...requests].sort(byFireThenReminder));
    expect(requests.slice(0, 3).map(({ reminderId }) => reminderId)).toEqual(['c', 'a', 'b']);
  });

  it('honours a smaller limit', () => {
    expect(planAllReminders(manyAccounts(), 10).requests).toHaveLength(10);
  });

  it('reports every reminder whose back-off notice slot has passed', () => {
    const { backoffPauses, requests } = planAllReminders([
      input({ reminderId: 'paused', activeSince: local(2026, 9, 20, 6) }),
      input({ reminderId: 'active' }),
    ]);

    expect(backoffPauses).toEqual([{ reminderId: 'paused', pausedAt: local(2026, 9, 23, 20) }]);
    expect(requests.every(({ reminderId }) => reminderId === 'active')).toBe(true);
  });

  it('drops a reminder whose stored schedule is invalid and plans the rest', () => {
    const { requests, backoffPauses } = planAllReminders([
      input({
        reminderId: 'broken',
        schedule: { frequency: 'weekly', minuteOfDay: 9 * 60, weekdays: [] },
      }),
      input({ reminderId: 'valid' }),
    ]);

    expect(backoffPauses).toEqual([]);
    expect(requests).toHaveLength(4);
    expect(requests.every(({ reminderId }) => reminderId === 'valid')).toBe(true);
    expect(requests.every(({ fireAt }) => Number.isFinite(toInstant(fireAt)))).toBe(true);
  });

  it('plans nothing for no reminders', () => {
    expect(planAllReminders([])).toEqual({ requests: [], backoffPauses: [] });
  });
});
