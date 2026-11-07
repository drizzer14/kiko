let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');

  return executingClient(() => mockDatabase);
});

import { DatabaseSync } from 'node:sqlite';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

import { EXPORT_VERSION } from '../crypto/envelope';

import { readDataSnapshot } from './read-snapshot';
import type { DataSnapshot } from './data-snapshot';
import { restoreDataSnapshot } from './restore-snapshot';

const openDatabase = (appearance: string | null): DatabaseSync => {
  const database = new DatabaseSync(':memory:');

  applyAllMigrations(database);

  if (appearance !== null) {
    database.prepare('INSERT INTO settings (id, appearance) VALUES (1, ?)').run(appearance);
  }

  return database;
};

const exportedSnapshot = async (): Promise<DataSnapshot> =>
  JSON.parse(JSON.stringify(await readDataSnapshot())) as DataSnapshot;

const storedAppearance = (): string | undefined =>
  (
    mockDatabase.prepare('SELECT appearance FROM settings WHERE id = 1').get() as
      | { appearance: string }
      | undefined
  )?.appearance;

const fileSavedWith = async (appearance: string): Promise<DataSnapshot> => {
  mockDatabase = openDatabase(appearance);

  return exportedSnapshot();
};

// The appearance belongs to this device, so a restored file never decides it: the live choice is
// kept, like the app lock.
describe('restoring the appearance setting', () => {
  it('a file with light keeps the live dark', async () => {
    const backup = await fileSavedWith('light');

    mockDatabase = openDatabase('dark');
    await restoreDataSnapshot(backup, EXPORT_VERSION);

    expect(storedAppearance()).toBe('dark');
  });

  it('an old file with system keeps the live dark', async () => {
    const backup = await fileSavedWith('system');

    mockDatabase = openDatabase('dark');
    await restoreDataSnapshot(backup, EXPORT_VERSION);

    expect(storedAppearance()).toBe('dark');
  });

  it('an old file with no appearance key keeps the live value', async () => {
    const backup = await fileSavedWith('system');

    for (const row of backup.settings as Record<string, unknown>[]) {
      delete row.appearance;
    }

    mockDatabase = openDatabase('light');
    await restoreDataSnapshot(backup, EXPORT_VERSION);

    expect(storedAppearance()).toBe('light');
  });

  it('a restore with no live row gives system', async () => {
    const backup = await fileSavedWith('light');

    mockDatabase = openDatabase(null);
    await restoreDataSnapshot(backup, EXPORT_VERSION);

    expect(storedAppearance()).toBe('system');
  });

  it('an export carries the column', async () => {
    mockDatabase = openDatabase('dark');

    const snapshot = await exportedSnapshot();

    expect(snapshot.settings.map((row) => row.appearance)).toEqual(['dark']);
  });
});
