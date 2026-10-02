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

const openDatabase = (lockEnabled: boolean): DatabaseSync => {
  const database = new DatabaseSync(':memory:');

  applyAllMigrations(database);
  database
    .prepare('INSERT INTO settings (id, lock_enabled) VALUES (1, ?)')
    .run(lockEnabled ? 1 : 0);

  return database;
};

const exportedSnapshot = async (): Promise<DataSnapshot> =>
  JSON.parse(JSON.stringify(await readDataSnapshot())) as DataSnapshot;

// The file the restore reads: one exported with the lock on or off, an old one
// with no `lockEnabled` key at all, or one with no settings row.
const FILES: Record<string, (snapshot: DataSnapshot) => DataSnapshot> = {
  'a file saved with the lock off': (snapshot) => snapshot,
  'a file with no lockEnabled key': (snapshot) => {
    for (const row of snapshot.settings as Record<string, unknown>[]) {
      delete row.lockEnabled;
    }

    return snapshot;
  },
  'a file with an empty settings table': (snapshot) => ({ ...snapshot, settings: [] }),
};

const storedLockEnabled = (): boolean =>
  (
    mockDatabase.prepare('SELECT lock_enabled FROM settings WHERE id = 1').get() as
      | { lock_enabled: number }
      | undefined
  )?.lock_enabled === 1;

// Turning the lock off needs the owner to confirm (Settings), so a restored
// file never decides it: the live device's choice is kept, like the quota.
describe('restoring the app lock setting', () => {
  describe.each([true, false])('with live lockEnabled %s', (liveLockEnabled) => {
    it.each(Object.keys(FILES))('keeps the live lock when restoring %s', async (name) => {
      mockDatabase = openDatabase(false);
      const backup = FILES[name](await exportedSnapshot());

      mockDatabase = openDatabase(liveLockEnabled);
      await restoreDataSnapshot(backup);

      expect(storedLockEnabled()).toBe(liveLockEnabled);
    });

    it(`keeps the live lock when restoring a file saved with the lock on`, async () => {
      mockDatabase = openDatabase(true);
      const backup = await exportedSnapshot();

      mockDatabase = openDatabase(liveLockEnabled);
      await restoreDataSnapshot(backup);

      expect(storedLockEnabled()).toBe(liveLockEnabled);
    });
  });
});
