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

const openDatabase = (): DatabaseSync => {
  const database = new DatabaseSync(':memory:');

  applyAllMigrations(database);
  database.exec('PRAGMA foreign_keys = ON');
  database.exec('INSERT INTO settings (id) VALUES (1)');

  return database;
};

const insertAccount = (database: DatabaseSync, id: string): void => {
  database.prepare("INSERT INTO accounts (id, name, kind) VALUES (?, 'Account', 'bank')").run(id);
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
// key, and no `reminderOfferDismissals` on the settings row.
const asPreRemindersExport = (snapshot: DataSnapshot): DataSnapshot => {
  const legacy = JSON.parse(JSON.stringify(snapshot)) as Record<string, unknown>;

  delete legacy.reminders;

  for (const row of legacy.settings as Record<string, unknown>[]) {
    delete row.reminderOfferDismissals;
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

    await restoreDataSnapshot(legacyExport);

    expect(tableIds('accounts')).toEqual([{ id: 'backed-up' }]);
    expect(tableIds('reminders')).toEqual([]);
    expect(mockDatabase.prepare('SELECT reminder_offer_dismissals FROM settings').all()).toEqual([
      { reminder_offer_dismissals: null },
    ]);
  });

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

    expect(restored.reminders).toEqual([
      {
        id: 'reminder-1',
        accountId: 'account-1',
        kind: 'add_transactions',
        schedule: { frequency: 'weekly', minuteOfDay: 1200, weekdays: [1] },
        pausedAt: 40,
        pauseReason: 'user',
        activeSince: 10,
        lastEngagedAt: 20,
        lastSnoozedAt: 30,
        createdAt: 1,
        updatedAt: 2,
      },
    ]);
    expect(restored).toEqual(exported);
  });
});
