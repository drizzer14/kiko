// The whole sync runs on a real, fully migrated `node:sqlite` engine; only the
// native module is stubbed, at the wrapper, so each test sees exactly what
// would reach iOS.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { database: client.database, write: jest.fn(client.write) };
});

import {
  type NativeReminderRequest,
  type NotificationAuthorization,
  type NotificationResponse,
  remindersNative,
} from '@kiko/reminders/native';
import { write } from '@kiko/db';
import { i18n } from '@kiko/i18n/init';
import { DatabaseSync } from 'node:sqlite';
import { remindersRepo } from '@kiko/reminders/repo';
import type { ReminderSchedule } from '@kiko/reminders/schedule';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

import { drainReminderResponses, syncReminders } from './sync-reminders';

const local = (month: number, day: number, hour = 0, minute = 0): number =>
  new Date(2026, month - 1, day, hour, minute).getTime();

const NOW = local(10, 1, 12);
const DAILY_AT_EIGHT_PM = { frequency: 'daily', minuteOfDay: 20 * 60 };
const english = i18n.getFixedT('en');

type ReminderSeed = {
  id: string;
  accountId: string;
  kind: 'statement_import' | 'add_transactions';
  schedule?: ReminderSchedule;
  activeSince?: number;
  pausedAt?: number | null;
  lastSnoozedAt?: number | null;
};

let drainedResponses: NotificationResponse[] = [];
let authorization: NotificationAuthorization = 'authorized';

const replaceRequests = jest.spyOn(remindersNative, 'replaceRequests');
const registerCategories = jest.spyOn(remindersNative, 'registerCategories');

jest.spyOn(remindersNative, 'drainResponses').mockImplementation(async () => drainedResponses);
jest.spyOn(remindersNative, 'authorizationStatus').mockImplementation(async () => authorization);

const seedAccount = (
  id: string,
  columns: { kind?: string; institution?: string; archivedAt?: number; importedAt?: number } = {},
): void => {
  mockDatabase
    .prepare(
      "INSERT INTO accounts (id, name, kind, institution, archived_at) VALUES (?, 'Mono Black', ?, ?, ?)",
    )
    .run(id, columns.kind ?? 'bank', columns.institution ?? null, columns.archivedAt ?? null);
  mockDatabase
    .prepare(
      "INSERT INTO holdings (id, account_id, name, type, currency) VALUES (?, ?, 'Card', 'card', 'UAH')",
    )
    .run(`${id}-card`, id);

  if (columns.importedAt !== undefined) {
    mockDatabase
      .prepare(
        "INSERT INTO transactions (id, holding_id, amount_minor_units, time, source, external_id, created_at) VALUES (?, ?, -100, ?, 'import', ?, ?)",
      )
      .run(`${id}-import`, `${id}-card`, columns.importedAt, `${id}-import`, columns.importedAt);
  }
};

const seedManualTransaction = (accountId: string, createdAt: number): void => {
  mockDatabase
    .prepare(
      "INSERT INTO transactions (id, holding_id, amount_minor_units, time, source, created_at) VALUES (?, ?, -100, ?, 'manual', ?)",
    )
    .run(`${accountId}-manual-${createdAt}`, `${accountId}-card`, createdAt, createdAt);
};

const seedReminder = (seed: ReminderSeed): void => {
  mockDatabase
    .prepare(
      `INSERT INTO reminders (id, account_id, kind, schedule, active_since, paused_at, pause_reason, last_snoozed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      seed.id,
      seed.accountId,
      seed.kind,
      JSON.stringify(seed.schedule ?? DAILY_AT_EIGHT_PM),
      seed.activeSince ?? local(10, 1, 10),
      seed.pausedAt ?? null,
      seed.pausedAt === undefined || seed.pausedAt === null ? null : 'user',
      seed.lastSnoozedAt ?? null,
    );
};

const reminderColumn = (id: string, column: string): unknown =>
  (
    mockDatabase.prepare(`SELECT ${column} AS value FROM reminders WHERE id = ?`).get(id) as {
      value: unknown;
    }
  ).value;

const deliverableSince = (): unknown =>
  (
    mockDatabase.prepare('SELECT notifications_deliverable_since AS value FROM settings').get() as {
      value: unknown;
    }
  ).value;

const lastReplace = (): { requests: NativeReminderRequest[]; keptSnoozeIds: string[] } => {
  const [requests, keptSnoozeIds] = replaceRequests.mock.calls.at(-1) ?? [[], []];

  return { requests: [...requests], keptSnoozeIds: [...keptSnoozeIds] };
};

const scheduledIds = (): string[] => [
  ...new Set(lastReplace().requests.map((request) => request.reminderId)),
];

const fireStamps = (reminderId: string): string[] =>
  lastReplace()
    .requests.filter((request) => request.reminderId === reminderId)
    .map(({ fireAt }) => `${fireAt.month}-${fireAt.day} ${fireAt.hour}:${fireAt.minute}`);

beforeEach(() => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('PRAGMA foreign_keys = ON');
  mockDatabase
    .prepare('INSERT INTO settings (id, notifications_deliverable_since) VALUES (1, ?)')
    .run(local(9, 1));
  drainedResponses = [];
  authorization = 'authorized';
  replaceRequests.mockResolvedValue(undefined);
});

describe('syncReminders — the app-open gate', () => {
  it('clears the pending set with one native call and reads no plan input when there are no reminders', async () => {
    const planInputsQuery = jest.spyOn(remindersRepo, 'planInputsQuery');

    await syncReminders(english, NOW);

    expect(replaceRequests.mock.calls).toEqual([[[], []]]);
    expect(planInputsQuery).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();

    planInputsQuery.mockRestore();
  });

  it('opens no write when there is nothing to record, pause, or clear', async () => {
    seedAccount('account-1');
    seedReminder({ id: 'reminder-1', accountId: 'account-1', kind: 'add_transactions' });

    await syncReminders(english, NOW);

    expect(write).not.toHaveBeenCalled();
    expect(scheduledIds()).toEqual(['reminder-1']);
  });
});

describe('syncReminders — which reminders are scheduled', () => {
  it('skips a paused reminder, an archived account, and a synced account', async () => {
    seedAccount('manual');
    seedAccount('archived', { archivedAt: local(9, 1) });
    seedAccount('synced', { institution: 'monobank', importedAt: local(9, 30) });
    seedReminder({ id: 'active', accountId: 'manual', kind: 'add_transactions' });
    seedReminder({
      id: 'paused',
      accountId: 'manual',
      kind: 'statement_import',
      pausedAt: local(9, 30),
    });
    seedReminder({ id: 'on-archived', accountId: 'archived', kind: 'add_transactions' });
    seedReminder({ id: 'synced-entry', accountId: 'synced', kind: 'add_transactions' });
    seedReminder({ id: 'synced-import', accountId: 'synced', kind: 'statement_import' });

    await syncReminders(english, NOW);

    expect(scheduledIds().sort()).toEqual(['active']);
  });

  it('schedules an import reminder on a manual bank account with no import yet, saying so', async () => {
    seedAccount('account-1');
    seedReminder({ id: 'import', accountId: 'account-1', kind: 'statement_import' });

    await syncReminders(english, NOW);

    expect(lastReplace().requests.map(({ identifier, body }) => [identifier, body])).toEqual([
      ['kiko.reminder.import.202610012000', 'No statements imported yet.'],
      ['kiko.reminder.import.202610022000', 'No statements imported yet.'],
      ['kiko.reminder.import.202610032000', 'No statements imported yet.'],
      ['kiko.reminder.import.paused', 'Turn them on again in Kiko.'],
    ]);
  });

  it.each([
    ['a cash', 'cash', undefined, ['entry']],
    ['a property', 'property', undefined, ['entry']],
    ['a synced bank', 'bank', 'monobank', []],
    ['a synced crypto', 'crypto', 'binance', []],
  ])(
    'never schedules an import reminder on %s account, which has no statement import',
    async (_label, kind, institution, scheduled) => {
      seedAccount('account-1', { kind, institution });
      seedReminder({ id: 'import', accountId: 'account-1', kind: 'statement_import' });
      seedReminder({ id: 'entry', accountId: 'account-1', kind: 'add_transactions' });

      await syncReminders(english, NOW);

      expect(scheduledIds()).toEqual(scheduled);
    },
  );

  it('skips the next occurrence after the first import and restarts the ignored count', async () => {
    seedAccount('manual', { importedAt: local(10, 1, 11) });
    seedReminder({
      id: 'import',
      accountId: 'manual',
      kind: 'statement_import',
      activeSince: local(9, 20, 10),
    });

    await syncReminders(english, NOW);

    expect(fireStamps('import')).toEqual(['10-2 20:0', '10-3 20:0', '10-4 20:0', '10-5 20:0']);
    expect(reminderColumn('import', 'paused_at')).toBeNull();
  });

  it('keeps the snoozes of exactly the scheduled reminders', async () => {
    seedAccount('manual');
    seedAccount('imported', { importedAt: local(9, 30) });
    seedReminder({ id: 'active', accountId: 'manual', kind: 'add_transactions' });
    seedReminder({ id: 'paused', accountId: 'manual', kind: 'statement_import', pausedAt: 1 });
    seedReminder({ id: 'imported-import', accountId: 'imported', kind: 'statement_import' });

    await syncReminders(english, NOW);

    expect(lastReplace().keptSnoozeIds).toEqual(['active', 'imported-import']);
  });

  it('builds each native request from the plan and the active language', async () => {
    seedAccount('imported', { importedAt: local(9, 30, 9) });
    seedReminder({ id: 'import', accountId: 'imported', kind: 'statement_import' });

    await syncReminders(english, NOW);

    expect(lastReplace().requests[0]).toEqual({
      identifier: 'kiko.reminder.import.202610012000',
      reminderId: 'import',
      accountId: 'imported',
      kind: 'statement_import',
      fireAt: { year: 2026, month: 10, day: 1, hour: 20, minute: 0 },
      title: 'Statement import',
      body: '1 day since your last statement import.',
      interruptionLevel: 'active',
      threadIdentifier: 'statement_import',
      categoryIdentifier: 'kiko.reminder',
    });
  });

  it('gives the "Tomorrow" category to the reminders and not to the paused notice', async () => {
    seedAccount('manual');
    seedReminder({ id: 'reminder-1', accountId: 'manual', kind: 'add_transactions' });

    await syncReminders(english, NOW);

    expect(
      lastReplace().requests.map(({ identifier, categoryIdentifier }) => [
        identifier,
        categoryIdentifier,
      ]),
    ).toEqual([
      ['kiko.reminder.reminder-1.202610012000', 'kiko.reminder'],
      ['kiko.reminder.reminder-1.202610022000', 'kiko.reminder'],
      ['kiko.reminder.reminder-1.202610032000', 'kiko.reminder'],
      ['kiko.reminder.reminder-1.paused', 'kiko.reminder.notice'],
    ]);
  });
});

describe('syncReminders — notification categories', () => {
  it.each([
    { language: 'en', snoozeTitle: 'Tomorrow', placeholder: 'Reminder' },
    { language: 'uk', snoozeTitle: 'Завтра', placeholder: 'Нагадування' },
  ])(
    'registers the categories in the active language ($language) before it replaces the requests',
    async ({ language, snoozeTitle, placeholder }) => {
      seedAccount('manual');
      seedReminder({ id: 'reminder-1', accountId: 'manual', kind: 'add_transactions' });

      await syncReminders(i18n.getFixedT(language), NOW);

      expect(registerCategories.mock.calls).toEqual([[snoozeTitle, placeholder]]);
      expect(registerCategories.mock.invocationCallOrder[0]).toBeLessThan(
        replaceRequests.mock.invocationCallOrder[0] as number,
      );
    },
  );

  it('registers them on every sync, with no reminders too, so a language change re-words them', async () => {
    await syncReminders(english, NOW);
    await syncReminders(i18n.getFixedT('uk'), NOW);

    expect(registerCategories.mock.calls).toEqual([
      ['Tomorrow', 'Reminder'],
      ['Завтра', 'Нагадування'],
    ]);
  });
});

describe('drainReminderResponses', () => {
  it('records a tap as engagement and returns the drained responses', async () => {
    seedAccount('manual');
    seedReminder({ id: 'reminder-1', accountId: 'manual', kind: 'add_transactions' });
    drainedResponses = [
      {
        reminderId: 'reminder-1',
        requestIdentifier: 'kiko.reminder.reminder-1.202609302000',
        action: 'open',
        respondedAt: local(10, 1, 9),
      },
    ];

    await expect(drainReminderResponses()).resolves.toEqual(drainedResponses);

    expect(reminderColumn('reminder-1', 'last_engaged_at')).toBe(local(10, 1, 9));
  });

  it('is not part of the plan, which leaves the response queue to it', async () => {
    seedAccount('manual');
    seedReminder({ id: 'reminder-1', accountId: 'manual', kind: 'add_transactions' });

    await syncReminders(english, NOW);

    expect(remindersNative.drainResponses).not.toHaveBeenCalled();
  });
});

describe('syncReminders — responses, back-off, and snoozes', () => {
  const seedSnoozeAndEntry = (snoozedAt: number, enteredAt: number): void => {
    seedAccount('manual');
    seedReminder({
      id: 'snoozed',
      accountId: 'manual',
      kind: 'add_transactions',
      lastSnoozedAt: snoozedAt,
    });
    seedManualTransaction('manual', enteredAt);
  };

  it('keeps a reminder paused when the user taps its paused notice', async () => {
    seedAccount('manual');
    seedReminder({ id: 'ignored', accountId: 'manual', kind: 'add_transactions' });
    drainedResponses = [
      {
        reminderId: 'ignored',
        requestIdentifier: 'kiko.reminder.ignored.paused',
        action: 'open',
        respondedAt: local(10, 4, 20, 5),
      },
    ];

    await expect(drainReminderResponses()).resolves.toEqual(drainedResponses);
    await syncReminders(english, local(10, 4, 20, 6));

    expect(reminderColumn('ignored', 'last_engaged_at')).toBeNull();
    expect(reminderColumn('ignored', 'paused_at')).toBe(local(10, 4, 20));
    expect(reminderColumn('ignored', 'pause_reason')).toBe('backoff');
    expect(scheduledIds()).toEqual([]);
  });

  it('persists a back-off pause and schedules nothing more for that reminder', async () => {
    seedAccount('manual');
    seedReminder({
      id: 'ignored',
      accountId: 'manual',
      kind: 'add_transactions',
      activeSince: local(9, 20, 10),
    });

    await syncReminders(english, NOW);

    expect(reminderColumn('ignored', 'paused_at')).toBe(local(9, 23, 20));
    expect(reminderColumn('ignored', 'pause_reason')).toBe('backoff');
    expect(scheduledIds()).toEqual([]);
  });

  it('stores a "Tomorrow" snooze and skips its occurrence on this and every later sync', async () => {
    seedAccount('manual');
    seedReminder({ id: 'snoozed', accountId: 'manual', kind: 'add_transactions' });
    drainedResponses = [
      {
        reminderId: 'snoozed',
        requestIdentifier: 'kiko.reminder.snoozed.202609302000',
        action: 'snooze',
        respondedAt: local(10, 1, 8),
      },
    ];

    await drainReminderResponses();
    await syncReminders(english, NOW);

    expect(reminderColumn('snoozed', 'last_snoozed_at')).toBe(local(10, 1, 8));
    expect(reminderColumn('snoozed', 'last_engaged_at')).toBe(local(10, 1, 8));
    expect(fireStamps('snoozed')).toEqual(['10-1 20:0', '10-3 20:0', '10-4 20:0']);

    await syncReminders(english, NOW);

    expect(fireStamps('snoozed')).toEqual(['10-1 20:0', '10-3 20:0', '10-4 20:0']);
    expect(lastReplace().keptSnoozeIds).toEqual(['snoozed']);
  });

  it('clears a snooze once it has fired, and keeps one still pending', async () => {
    seedAccount('manual');
    seedAccount('other-manual');
    seedReminder({
      id: 'fired',
      accountId: 'manual',
      kind: 'add_transactions',
      lastSnoozedAt: local(9, 29, 8),
    });
    seedReminder({
      id: 'pending',
      accountId: 'other-manual',
      kind: 'add_transactions',
      lastSnoozedAt: local(10, 1, 8),
    });

    await syncReminders(english, NOW);

    expect(reminderColumn('fired', 'last_snoozed_at')).toBeNull();
    expect(reminderColumn('pending', 'last_snoozed_at')).toBe(local(10, 1, 8));
  });

  it('drops a snooze once new data arrives after it, so its stale text never fires', async () => {
    seedSnoozeAndEntry(local(10, 1, 20, 1), local(10, 2, 12));

    await syncReminders(english, local(10, 2, 13));

    expect(lastReplace().keptSnoozeIds).toEqual([]);
    expect(reminderColumn('snoozed', 'last_snoozed_at')).toBeNull();
  });

  it('plans the occurrence a data-stale snooze stood in for', async () => {
    seedSnoozeAndEntry(local(10, 3, 9), local(10, 3, 12));

    await syncReminders(english, local(10, 3, 13));

    expect(fireStamps('snoozed')).toEqual(['10-4 20:0', '10-5 20:0', '10-6 20:0', '10-7 20:0']);
  });

  it('keeps a snooze made after the latest data', async () => {
    seedSnoozeAndEntry(local(10, 1, 20, 1), local(10, 1, 19));

    await syncReminders(english, local(10, 1, 21));

    expect(lastReplace().keptSnoozeIds).toEqual(['snoozed']);
    expect(reminderColumn('snoozed', 'last_snoozed_at')).toBe(local(10, 1, 20, 1));
  });

  it('clears the snooze of a reminder that is not scheduled, since iOS drops it too', async () => {
    seedAccount('manual');
    seedReminder({
      id: 'paused',
      accountId: 'manual',
      kind: 'add_transactions',
      pausedAt: local(10, 1, 9),
      lastSnoozedAt: local(10, 1, 8),
    });

    await syncReminders(english, NOW);

    expect(reminderColumn('paused', 'last_snoozed_at')).toBeNull();
  });
});

describe('syncReminders — notification permission', () => {
  const seedLongIgnoredReminder = (): void => {
    seedAccount('manual');
    seedReminder({
      id: 'reminder-1',
      accountId: 'manual',
      kind: 'add_transactions',
      activeSince: local(9, 20, 10),
    });
  };

  it.each<NotificationAuthorization>(['denied', 'notDetermined'])(
    'never back-off pauses while notifications are %s, and counts from now',
    async (status) => {
      seedLongIgnoredReminder();
      authorization = status;

      await syncReminders(english, NOW);

      expect(reminderColumn('reminder-1', 'paused_at')).toBeNull();
      expect(fireStamps('reminder-1')).toEqual([
        '10-1 20:0',
        '10-2 20:0',
        '10-3 20:0',
        '10-4 20:0',
      ]);
      expect(deliverableSince()).toBeNull();
    },
  );

  it('starts the ignored count at the first sync that sees notifications authorized', async () => {
    seedLongIgnoredReminder();
    authorization = 'denied';
    await syncReminders(english, NOW);

    authorization = 'authorized';
    await syncReminders(english, local(10, 5, 12));

    expect(deliverableSince()).toBe(local(10, 5, 12));
    expect(reminderColumn('reminder-1', 'paused_at')).toBeNull();
    expect(fireStamps('reminder-1')).toEqual(['10-5 20:0', '10-6 20:0', '10-7 20:0', '10-8 20:0']);

    await syncReminders(english, local(10, 9, 12));

    expect(reminderColumn('reminder-1', 'paused_at')).toBe(local(10, 8, 20));
    expect(reminderColumn('reminder-1', 'pause_reason')).toBe('backoff');
  });

  it('writes the permission state only when it changes', async () => {
    seedAccount('manual');
    seedReminder({ id: 'reminder-1', accountId: 'manual', kind: 'add_transactions' });
    authorization = 'denied';

    await syncReminders(english, NOW);
    expect(write).toHaveBeenCalledTimes(1);

    jest.mocked(write).mockClear();
    await syncReminders(english, NOW);
    expect(write).not.toHaveBeenCalled();

    authorization = 'authorized';
    await syncReminders(english, NOW);
    expect(write).toHaveBeenCalledTimes(1);

    jest.mocked(write).mockClear();
    await syncReminders(english, NOW);
    expect(write).not.toHaveBeenCalled();
  });
});

// Fire N is Oct 1 at 20:00 and fire N+1 is Oct 2 at 20:00, unless a row says
// otherwise. Fire N+1 is skipped only for data added after fire N's local day
// and, as well, on fire N+1's own local day or at or after the midpoint
// between the two fires. An entry on fire N's day, in answer to it, never
// silences fire N+1, so a user who answers every evening is still reminded
// every evening; nor does an entry early in a longer gap, so a monthly
// reminder answered the next morning still fires next month.
describe('syncReminders — the smart-skip scenario matrix', () => {
  type Entry = { at: number; later?: 'deleted' | 'edited' };

  type Scenario = {
    scenario: string;
    schedule?: ReminderSchedule;
    createdAt?: number;
    entries?: Entry[];
    editedTo?: { at: number; schedule: ReminderSchedule };
    now: number;
    firstFire: string;
  };

  const localOn = (year: number, month: number, day: number, hour = 0, minute = 0): number =>
    new Date(year, month - 1, day, hour, minute).getTime();

  const daily = (hour: number, minute = 0): ReminderSchedule => ({
    frequency: 'daily',
    minuteOfDay: hour * 60 + minute,
  });

  const MONDAY_AND_THURSDAY: ReminderSchedule = {
    frequency: 'weekly',
    minuteOfDay: 9 * 60,
    weekdays: [1, 4],
  };

  const MONTHLY_ON_THE_FIRST: ReminderSchedule = {
    frequency: 'monthly',
    minuteOfDay: 19 * 60,
    dayOfMonth: 1,
  };

  const EVERY_THREE_DAYS_FROM_OCTOBER_2: ReminderSchedule = {
    frequency: 'interval',
    minuteOfDay: 20 * 60,
    everyDays: 3,
    anchorDay: { year: 2026, month: 10, day: 2 },
  };

  it.each<Scenario>([
    { scenario: 'no data: fire N+1 fires', now: local(10, 1, 21), firstFire: '10-2 20:0' },
    {
      scenario: 'an entry before fire N on its day: fire N+1 still fires',
      entries: [{ at: local(10, 1, 19) }],
      now: local(10, 1, 21),
      firstFire: '10-2 20:0',
    },
    {
      scenario: 'an entry the evening of fire N, after it fired: fire N+1 still fires',
      entries: [{ at: local(10, 1, 20, 10) }],
      now: local(10, 1, 21),
      firstFire: '10-2 20:0',
    },
    {
      scenario: 'an entry at 23:59 on fire N’s day: fire N+1 still fires',
      entries: [{ at: local(10, 1, 23, 59) }],
      now: local(10, 2, 0, 30),
      firstFire: '10-2 20:0',
    },
    {
      scenario: 'an entry at the midnight that starts fire N+1’s day: it is skipped',
      entries: [{ at: local(10, 2) }],
      now: local(10, 2, 0, 30),
      firstFire: '10-3 20:0',
    },
    {
      scenario: 'an entry a minute before fire N+1: it is skipped',
      entries: [{ at: local(10, 2, 19, 59) }],
      now: local(10, 2, 19, 59) + 30_000,
      firstFire: '10-3 20:0',
    },
    {
      scenario: 'an entry after fire N+1 fired: the next day still fires',
      entries: [{ at: local(10, 2, 20, 30) }],
      now: local(10, 2, 21),
      firstFire: '10-3 20:0',
    },
    {
      scenario: 'the only entry of fire N+1’s day deleted: it fires again',
      entries: [{ at: local(10, 1, 19) }, { at: local(10, 2, 10), later: 'deleted' }],
      now: local(10, 2, 12),
      firstFire: '10-2 20:0',
    },
    {
      scenario: 'one of two entries of fire N+1’s day deleted: it stays skipped',
      entries: [{ at: local(10, 2, 10) }, { at: local(10, 2, 11), later: 'deleted' }],
      now: local(10, 2, 12),
      firstFire: '10-3 20:0',
    },
    {
      scenario: 'an entry from fire N’s day edited on fire N+1’s day: an edit is not new data',
      entries: [{ at: local(10, 1, 19), later: 'edited' }],
      now: local(10, 2, 12),
      firstFire: '10-2 20:0',
    },
    {
      scenario: 'a reminder created after an entry the same day: tonight is skipped',
      createdAt: local(10, 2, 12),
      entries: [{ at: local(10, 2, 11, 55) }],
      now: local(10, 2, 12),
      firstFire: '10-3 20:0',
    },
    {
      scenario: 'a reminder created the day after an entry: tonight fires',
      createdAt: local(10, 2, 12),
      entries: [{ at: local(10, 1, 18) }],
      now: local(10, 2, 12),
      firstFire: '10-2 20:0',
    },
    {
      scenario: 'a reminder edited to 21:00 after an entry that day: tonight stays skipped',
      entries: [{ at: local(10, 2, 18) }],
      editedTo: { at: local(10, 2, 19), schedule: daily(21) },
      now: local(10, 2, 19),
      firstFire: '10-3 21:0',
    },
    {
      scenario: 'a reminder edited to 21:00 the day after an entry: tonight fires',
      entries: [{ at: local(10, 1, 18) }],
      editedTo: { at: local(10, 2, 19), schedule: daily(21) },
      now: local(10, 2, 19),
      firstFire: '10-2 21:0',
    },
    {
      scenario: 'a 00:15 reminder, an entry late the evening before: it fires',
      schedule: daily(0, 15),
      entries: [{ at: local(10, 1, 23, 50) }],
      now: local(10, 1, 23, 55),
      firstFire: '10-2 0:15',
    },
    {
      scenario: 'a 00:15 reminder, an entry after midnight before it fires: it is skipped',
      schedule: daily(0, 15),
      entries: [{ at: local(10, 2, 0, 5) }],
      now: local(10, 2, 0, 10),
      firstFire: '10-3 0:15',
    },
    {
      scenario: 'the fall-back day, an entry after midnight: its 03:30 fire is skipped',
      schedule: daily(3, 30),
      createdAt: local(10, 24, 10),
      entries: [{ at: local(10, 25, 2) }],
      now: local(10, 25, 2, 10),
      firstFire: '10-26 3:30',
    },
    {
      scenario: 'the fall-back day, an entry the evening before: its 03:30 fire fires',
      schedule: daily(3, 30),
      createdAt: local(10, 24, 10),
      entries: [{ at: local(10, 24, 23, 30) }],
      now: local(10, 25, 0, 30),
      firstFire: '10-25 3:30',
    },
    {
      scenario: 'the spring-forward day, an entry before the gap: its 03:30 fire is skipped',
      schedule: daily(3, 30),
      createdAt: localOn(2027, 3, 27, 10),
      entries: [{ at: localOn(2027, 3, 28, 2, 30) }],
      now: localOn(2027, 3, 28, 2, 40),
      firstFire: '3-29 3:30',
    },
    {
      scenario: 'the spring-forward day, an entry the evening before: its 03:30 fire fires',
      schedule: daily(3, 30),
      createdAt: localOn(2027, 3, 27, 10),
      entries: [{ at: localOn(2027, 3, 27, 23) }],
      now: localOn(2027, 3, 28, 1),
      firstFire: '3-28 3:30',
    },
    {
      scenario: 'weekly on Monday and Thursday, an entry on Tuesday morning: Thursday fires',
      schedule: MONDAY_AND_THURSDAY,
      createdAt: local(9, 28, 8),
      entries: [{ at: local(9, 29, 10) }],
      now: local(9, 30, 10),
      firstFire: '10-1 9:0',
    },
    {
      scenario: 'weekly on Monday and Thursday, an entry just before the midpoint: Thursday fires',
      schedule: MONDAY_AND_THURSDAY,
      createdAt: local(9, 28, 8),
      entries: [{ at: local(9, 29, 20, 59) }],
      now: local(9, 29, 22),
      firstFire: '10-1 9:0',
    },
    {
      scenario: 'weekly on Monday and Thursday, an entry at the midpoint: Thursday is skipped',
      schedule: MONDAY_AND_THURSDAY,
      createdAt: local(9, 28, 8),
      entries: [{ at: local(9, 29, 21) }],
      now: local(9, 29, 22),
      firstFire: '10-5 9:0',
    },
    {
      scenario: 'weekly on Monday and Thursday, an entry on Wednesday: Thursday is skipped',
      schedule: MONDAY_AND_THURSDAY,
      createdAt: local(9, 28, 8),
      entries: [{ at: local(9, 30, 10) }],
      now: local(9, 30, 11),
      firstFire: '10-5 9:0',
    },
    {
      scenario: 'weekly on Monday and Thursday, an entry on Monday after its fire: Thursday fires',
      schedule: MONDAY_AND_THURSDAY,
      createdAt: local(9, 28, 8),
      entries: [{ at: local(9, 28, 10) }],
      now: local(9, 28, 11),
      firstFire: '10-1 9:0',
    },
    {
      scenario: 'monthly on the 1st, an entry on the 28th: the 1st is skipped',
      schedule: MONTHLY_ON_THE_FIRST,
      createdAt: local(9, 20, 10),
      entries: [{ at: local(9, 28, 12) }],
      now: local(9, 28, 13),
      firstFire: '11-1 19:0',
    },
    {
      scenario: 'monthly on the 1st, an entry on the 1st after its fire: next month fires',
      schedule: MONTHLY_ON_THE_FIRST,
      createdAt: local(9, 20, 10),
      entries: [{ at: local(10, 1, 19, 30) }],
      now: local(10, 1, 21),
      firstFire: '11-1 19:0',
    },
    {
      scenario: 'monthly on the 1st, an entry the morning after its fire: next month fires',
      schedule: MONTHLY_ON_THE_FIRST,
      createdAt: local(9, 20, 10),
      entries: [{ at: local(10, 2, 10) }],
      now: local(10, 2, 11),
      firstFire: '11-1 19:0',
    },
    {
      scenario: 'monthly on the 1st, an entry on the 20th: next month is skipped',
      schedule: MONTHLY_ON_THE_FIRST,
      createdAt: local(9, 20, 10),
      entries: [{ at: local(10, 20, 10) }],
      now: local(10, 20, 11),
      firstFire: '12-1 19:0',
    },
    {
      scenario: 'a 09:00 reminder, an entry the evening of its fire: the next morning fires',
      schedule: daily(9),
      createdAt: local(9, 20, 10),
      entries: [{ at: local(10, 1, 22) }],
      now: local(10, 1, 23),
      firstFire: '10-2 9:0',
    },
    {
      scenario: 'every 3 days, an entry on the first fire’s day: the first fire is skipped',
      schedule: EVERY_THREE_DAYS_FROM_OCTOBER_2,
      entries: [{ at: local(10, 2, 10) }],
      now: local(10, 2, 12),
      firstFire: '10-5 20:0',
    },
    {
      scenario: 'every 3 days, an entry the day before the first fire: it fires',
      schedule: EVERY_THREE_DAYS_FROM_OCTOBER_2,
      entries: [{ at: local(10, 1, 18) }],
      now: local(10, 1, 19),
      firstFire: '10-2 20:0',
    },
    {
      scenario: 'weekly on Monday and Thursday, an entry on Thursday before 09:00: it is skipped',
      schedule: MONDAY_AND_THURSDAY,
      createdAt: local(9, 28, 8),
      entries: [{ at: local(10, 1, 8) }],
      now: local(10, 1, 8, 30),
      firstFire: '10-5 9:0',
    },
  ])('$scenario', async ({ schedule, createdAt, entries = [], editedTo, now, firstFire }) => {
    seedAccount('manual');
    seedReminder({
      id: 'reminder-1',
      accountId: 'manual',
      kind: 'add_transactions',
      schedule,
      activeSince: createdAt,
    });

    for (const { at, later } of entries) {
      seedManualTransaction('manual', at);

      const entryId = `manual-manual-${at}`;

      if (later === 'deleted') {
        mockDatabase.prepare('DELETE FROM transactions WHERE id = ?').run(entryId);
      }

      if (later === 'edited') {
        mockDatabase
          .prepare('UPDATE transactions SET amount_minor_units = -250, time = ? WHERE id = ?')
          .run(now, entryId);
      }
    }

    if (editedTo !== undefined) {
      const dateNow = jest.spyOn(Date, 'now').mockReturnValue(editedTo.at);

      await remindersRepo.update('reminder-1', editedTo.schedule);
      dateNow.mockRestore();
    }

    await syncReminders(english, now);

    expect(fireStamps('reminder-1')[0]).toBe(firstFire);
    expect(lastReplace().requests.filter(({ body }) => body.startsWith('0 '))).toEqual([]);
  });
});
