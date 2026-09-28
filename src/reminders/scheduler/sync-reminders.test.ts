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
  type NotificationResponse,
  remindersNative,
} from '@kiko/reminders/native';
import { write } from '@kiko/db';
import { i18n } from '@kiko/i18n/init';
import { DatabaseSync } from 'node:sqlite';
import { remindersRepo } from '@kiko/reminders/repo';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

import { syncReminders } from './sync-reminders';

const local = (month: number, day: number, hour = 0, minute = 0): number =>
  new Date(2026, month - 1, day, hour, minute).getTime();

const NOW = local(10, 1, 12);
const DAILY_AT_EIGHT_PM = { frequency: 'daily', minuteOfDay: 20 * 60 };
const english = i18n.getFixedT('en');

type ReminderSeed = {
  id: string;
  accountId: string;
  kind: 'statement_import' | 'add_transactions';
  activeSince?: number;
  pausedAt?: number | null;
  lastSnoozedAt?: number | null;
};

let drainedResponses: NotificationResponse[] = [];

const replaceRequests = jest.spyOn(remindersNative, 'replaceRequests');

jest.spyOn(remindersNative, 'drainResponses').mockImplementation(async () => drainedResponses);

const seedAccount = (
  id: string,
  columns: { institution?: string; archivedAt?: number; importedAt?: number } = {},
): void => {
  mockDatabase
    .prepare(
      "INSERT INTO accounts (id, name, kind, institution, archived_at) VALUES (?, 'Mono Black', 'bank', ?, ?)",
    )
    .run(id, columns.institution ?? null, columns.archivedAt ?? null);
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
      JSON.stringify(DAILY_AT_EIGHT_PM),
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
  drainedResponses = [];
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
  it('skips a paused reminder, an archived account, synced manual entry, and an account with no import', async () => {
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

    expect(scheduledIds().sort()).toEqual(['active', 'synced-import']);
  });

  it('never schedules an import reminder on an account with no import', async () => {
    seedAccount('manual');
    seedReminder({ id: 'import', accountId: 'manual', kind: 'statement_import' });

    await syncReminders(english, NOW);

    expect(lastReplace()).toEqual({ requests: [], keptSnoozeIds: [] });
  });

  it('keeps the snoozes of exactly the scheduled reminders', async () => {
    seedAccount('manual');
    seedAccount('synced', { institution: 'monobank', importedAt: local(9, 30) });
    seedReminder({ id: 'active', accountId: 'manual', kind: 'add_transactions' });
    seedReminder({ id: 'paused', accountId: 'manual', kind: 'statement_import', pausedAt: 1 });
    seedReminder({ id: 'synced-import', accountId: 'synced', kind: 'statement_import' });

    await syncReminders(english, NOW);

    expect(lastReplace().keptSnoozeIds).toEqual(['active', 'synced-import']);
  });

  it('builds each native request from the plan and the active language', async () => {
    seedAccount('synced', { institution: 'monobank', importedAt: local(9, 30, 9) });
    seedReminder({ id: 'import', accountId: 'synced', kind: 'statement_import' });

    await syncReminders(english, NOW);

    expect(lastReplace().requests[0]).toEqual({
      identifier: 'kiko.reminder.import.202610012000',
      reminderId: 'import',
      accountId: 'synced',
      kind: 'statement_import',
      fireAt: { year: 2026, month: 10, day: 1, hour: 20, minute: 0 },
      title: 'Statement import',
      body: '1 day since your last statement import.',
      interruptionLevel: 'active',
      threadIdentifier: 'statement_import',
    });
  });
});

describe('syncReminders — responses, back-off, and snoozes', () => {
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

    await expect(syncReminders(english, NOW)).resolves.toEqual(drainedResponses);

    expect(reminderColumn('reminder-1', 'last_engaged_at')).toBe(local(10, 1, 9));
  });

  it('keeps a reminder paused when the user taps its paused notice, and returns the tap', async () => {
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

    await expect(syncReminders(english, local(10, 4, 20, 6))).resolves.toEqual(drainedResponses);

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

    await syncReminders(english, NOW);

    expect(reminderColumn('snoozed', 'last_snoozed_at')).toBe(local(10, 1, 8));
    expect(fireStamps('snoozed')).toEqual(['10-1 20:0', '10-3 20:0', '10-4 20:0']);

    drainedResponses = [];
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
    seedAccount('manual');
    seedReminder({
      id: 'snoozed',
      accountId: 'manual',
      kind: 'add_transactions',
      lastSnoozedAt: local(10, 1, 20, 1),
    });
    seedManualTransaction('manual', local(10, 2, 12));

    await syncReminders(english, local(10, 2, 13));

    expect(lastReplace().keptSnoozeIds).toEqual([]);
    expect(reminderColumn('snoozed', 'last_snoozed_at')).toBeNull();
  });

  it('plans the occurrence a data-stale snooze stood in for', async () => {
    seedAccount('manual');
    seedReminder({
      id: 'snoozed',
      accountId: 'manual',
      kind: 'add_transactions',
      lastSnoozedAt: local(10, 3, 9),
    });
    seedManualTransaction('manual', local(10, 3, 12));

    await syncReminders(english, local(10, 3, 13));

    expect(fireStamps('snoozed')).toEqual(['10-4 20:0', '10-5 20:0', '10-6 20:0', '10-7 20:0']);
  });

  it('keeps a snooze made after the latest data', async () => {
    seedAccount('manual');
    seedReminder({
      id: 'snoozed',
      accountId: 'manual',
      kind: 'add_transactions',
      lastSnoozedAt: local(10, 1, 20, 1),
    });
    seedManualTransaction('manual', local(10, 1, 19));

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
