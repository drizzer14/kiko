let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');

  return executingClient(() => mockDatabase);
});

import { DatabaseSync } from 'node:sqlite';
import { dismissedTipIds } from '@kiko/tips';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

import { readDataSnapshot } from './read-snapshot';
import type { DataSnapshot } from './data-snapshot';
import { restoreDataSnapshot } from './restore-snapshot';

const openDatabase = (dismissedTips: string[]): DatabaseSync => {
  const database = new DatabaseSync(':memory:');

  applyAllMigrations(database);
  database
    .prepare('INSERT INTO settings (id, dismissed_tips) VALUES (1, ?)')
    .run(JSON.stringify(dismissedTips));

  return database;
};

const exportedSnapshot = async (): Promise<DataSnapshot> =>
  JSON.parse(JSON.stringify(await readDataSnapshot())) as DataSnapshot;

const storedDismissedTips = (): unknown =>
  JSON.parse(
    (
      mockDatabase.prepare('SELECT dismissed_tips FROM settings WHERE id = 1').get() as {
        dismissed_tips: string;
      }
    ).dismissed_tips,
  );

const restoreOnto = async (backup: DataSnapshot): Promise<void> => {
  mockDatabase = openDatabase(['live.tip']);
  await restoreDataSnapshot(backup);
};

const exportWith = async (dismissedTips: string[]): Promise<DataSnapshot> => {
  mockDatabase = openDatabase(dismissedTips);

  return exportedSnapshot();
};

describe('restoring the dismissed tips', () => {
  it('keeps the dismissed tips through a round trip', async () => {
    const backup = await exportWith(['settings.categories', 'transaction.applyToAll']);

    await restoreOnto(backup);

    expect(storedDismissedTips()).toEqual(['settings.categories', 'transaction.applyToAll']);
  });

  it('restores an empty list from a file with no dismissedTips key', async () => {
    const backup = await exportWith(['settings.categories']);

    for (const row of backup.settings as Record<string, unknown>[]) {
      delete row.dismissedTips;
    }
    await restoreOnto(backup);

    expect(storedDismissedTips()).toEqual([]);
  });

  it('restores an id this build does not know, and dismissedTipIds ignores it', async () => {
    const backup = await exportWith(['future.tip']);

    await restoreOnto(backup);

    expect(storedDismissedTips()).toEqual(['future.tip']);
    expect(dismissedTipIds(storedDismissedTips() as string[]).size).toBe(0);
  });

  it('restores an empty list from a file with an empty settings table', async () => {
    const backup = { ...(await exportWith(['settings.categories'])), settings: [] };

    await restoreOnto(backup);

    expect(storedDismissedTips()).toEqual([]);
  });
});
