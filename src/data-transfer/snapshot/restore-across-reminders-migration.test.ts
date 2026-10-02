// A backup restored on a device that already ran the reminders migration,
// proven on a real, fully migrated `node:sqlite` engine with foreign keys on,
// through the real read and restore paths: the delete order a reminder's
// foreign key needs, an older backup with no `reminders` key, and every
// reminder column surviving an export and an import.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');

  return executingClient(() => mockDatabase);
});

import { DatabaseSync } from 'node:sqlite';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

import { readDataSnapshot } from './read-snapshot';
import type { DataSnapshot } from './data-snapshot';
import { restoreDataSnapshot } from './restore-snapshot';

const RESTORED_AT = new Date(2026, 9, 1, 12, 0).getTime();

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(RESTORED_AT);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const openDatabase = (): DatabaseSync => {
  const database = new DatabaseSync(':memory:');

  applyAllMigrations(database);
  database.exec('PRAGMA foreign_keys = ON');
  database.exec('INSERT INTO settings (id) VALUES (1)');

  return database;
};

const insertAccount = (database: DatabaseSync, id: string): void => {
  // A bank account always names a bank (`other` when it is none listed), so a
  // row restores as it was exported rather than through the 0049 mirror.
  database
    .prepare(
      "INSERT INTO accounts (id, name, kind, bank_id) VALUES (?, 'Account', 'bank', 'other')",
    )
    .run(id);
};

const insertReminder = (database: DatabaseSync, id: string, accountId: string): void => {
  database
    .prepare(
      `INSERT INTO reminders
         (id, account_id, kind, schedule, paused_at, pause_reason, active_since,
          last_engaged_at, last_snoozed_at, created_at, updated_at)
       VALUES (?, ?, 'add_transactions', ?, 40, 'user', 10, 20, 30, 1, 2)`,
    )
    .run(id, accountId, JSON.stringify({ frequency: 'weekly', minuteOfDay: 1200, weekdays: [1] }));
};

// An export from the build before the reminders migration: no `reminders`
// key, and no `reminderOfferDismissals` or `notificationsDeliverableSince` on
// the settings row.
const asPreRemindersExport = (snapshot: DataSnapshot): DataSnapshot => {
  const legacy = JSON.parse(JSON.stringify(snapshot)) as Record<string, unknown>;

  delete legacy.reminders;

  for (const row of legacy.settings as Record<string, unknown>[]) {
    delete row.reminderOfferDismissals;
    delete row.notificationsDeliverableSince;
  }

  return legacy as unknown as DataSnapshot;
};

const tableIds = (table: string): unknown[] =>
  mockDatabase.prepare(`SELECT id FROM ${table} ORDER BY id`).all();

describe('restoring across the reminders migration', () => {
  it('restores a backup made before the migration, and leaves no reminder behind', async () => {
    mockDatabase = openDatabase();
    insertAccount(mockDatabase, 'backed-up');
    const legacyExport = asPreRemindersExport(await readDataSnapshot());

    mockDatabase = openDatabase();
    insertAccount(mockDatabase, 'on-device');
    insertReminder(mockDatabase, 'reminder-on-device', 'on-device');
    mockDatabase.exec('UPDATE settings SET notifications_deliverable_since = 5');

    await restoreDataSnapshot(legacyExport);

    expect(tableIds('accounts')).toEqual([{ id: 'backed-up' }]);
    expect(tableIds('reminders')).toEqual([]);
    expect(
      mockDatabase
        .prepare('SELECT reminder_offer_dismissals, notifications_deliverable_since FROM settings')
        .all(),
    ).toEqual([{ reminder_offer_dismissals: null, notifications_deliverable_since: 5 }]);
  });

  // When iOS first allowed notifications is a fact about this device, so a file
  // never changes it: the reminders' ignored count starts from it.
  it.each([
    ['this device has it', 5],
    ['this device has none', null],
  ])(
    'keeps this device’s notifications start when %s, whatever the file carries',
    async (_name, liveSince) => {
      mockDatabase = openDatabase();
      mockDatabase.exec('UPDATE settings SET notifications_deliverable_since = 9');
      const exported = JSON.parse(JSON.stringify(await readDataSnapshot())) as DataSnapshot;

      mockDatabase = openDatabase();
      mockDatabase
        .prepare('UPDATE settings SET notifications_deliverable_since = ?')
        .run(liveSince);
      await restoreDataSnapshot(exported);

      expect(
        mockDatabase.prepare('SELECT notifications_deliverable_since FROM settings').all(),
      ).toEqual([{ notifications_deliverable_since: liveSince }]);
    },
  );

  it('round-trips every reminder column and the offer dismissals through an export and an import', async () => {
    mockDatabase = openDatabase();
    insertAccount(mockDatabase, 'account-1');
    insertReminder(mockDatabase, 'reminder-1', 'account-1');
    mockDatabase
      .prepare('UPDATE settings SET reminder_offer_dismissals = ?')
      .run(JSON.stringify({ 'account-1': ['statement_import'] }));
    const exported = JSON.parse(JSON.stringify(await readDataSnapshot())) as DataSnapshot;

    mockDatabase = openDatabase();
    await restoreDataSnapshot(exported);

    const restored = await readDataSnapshot();

    // The start and the snooze belong to the device and time the backup was
    // made on: see the restart test below.
    const restartedReminders = exported.reminders.map((reminder) => ({
      ...reminder,
      activeSince: RESTORED_AT,
      lastSnoozedAt: null,
    }));

    expect(restored.reminders).toEqual([
      {
        id: 'reminder-1',
        accountId: 'account-1',
        kind: 'add_transactions',
        schedule: { frequency: 'weekly', minuteOfDay: 1200, weekdays: [1] },
        pausedAt: 40,
        pauseReason: 'user',
        activeSince: RESTORED_AT,
        lastEngagedAt: 20,
        lastSnoozedAt: null,
        createdAt: 1,
        updatedAt: 2,
      },
    ]);
    // This database never ran `MigrationsGate`, so the export carries
    // `importTimesRezoned: false`; a restore rezones such a backup at once
    // (`withImportTimesRezoned`), as no live device is left to retry it.
    expect(restored).toEqual({
      ...exported,
      reminders: restartedReminders,
      settings: exported.settings.map((row) => ({ ...row, importTimesRezoned: true })),
    });
  });

  // Counted from the backup, every reminder sent since then would read as
  // ignored and back-off pause on the first re-plan, and a restored snooze may
  // have no request on this device. The restart is part of the restore's own
  // transaction, so a kill right after the commit cannot leave the old start.
  it('restarts every restored reminder from now and forgets its snooze, keeping its pause and engagement', async () => {
    mockDatabase = openDatabase();
    insertAccount(mockDatabase, 'account-1');
    insertAccount(mockDatabase, 'account-2');
    insertReminder(mockDatabase, 'reminder-1', 'account-1');
    insertReminder(mockDatabase, 'reminder-2', 'account-2');
    const exported = JSON.parse(JSON.stringify(await readDataSnapshot())) as DataSnapshot;

    mockDatabase = openDatabase();
    await restoreDataSnapshot(exported);

    expect(
      mockDatabase
        .prepare(
          'SELECT id, active_since, last_snoozed_at, paused_at, pause_reason, last_engaged_at FROM reminders ORDER BY id',
        )
        .all(),
    ).toEqual([
      {
        id: 'reminder-1',
        active_since: RESTORED_AT,
        last_snoozed_at: null,
        paused_at: 40,
        pause_reason: 'user',
        last_engaged_at: 20,
      },
      {
        id: 'reminder-2',
        active_since: RESTORED_AT,
        last_snoozed_at: null,
        paused_at: 40,
        pause_reason: 'user',
        last_engaged_at: 20,
      },
    ]);
  });
});
