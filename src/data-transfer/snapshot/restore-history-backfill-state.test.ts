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

const openDatabase = (state: string | null): DatabaseSync => {
  const database = new DatabaseSync(':memory:');

  applyAllMigrations(database);
  database.prepare('INSERT INTO settings (id, history_backfill_state) VALUES (1, ?)').run(state);

  return database;
};

const exportedSnapshot = async (): Promise<DataSnapshot> =>
  JSON.parse(JSON.stringify(await readDataSnapshot())) as DataSnapshot;

// The file the restore reads: one that carries a state, one exported before the column existed
// (no key at all), and one with no settings row.
const FILES: Record<string, (snapshot: DataSnapshot) => DataSnapshot> = {
  'a file saved with no state': (snapshot) => snapshot,
  'a file saved with a state': (snapshot) => ({
    ...snapshot,
    settings: snapshot.settings.map((row) => ({ ...row, historyBackfillState: 'BNB' })),
  }),
  'a file with no historyBackfillState key': (snapshot) => {
    for (const row of snapshot.settings as Record<string, unknown>[]) {
      delete row.historyBackfillState;
    }

    return snapshot;
  },
  'a file with an empty settings table': (snapshot) => ({ ...snapshot, settings: [] }),
};

const storedState = (): string | null =>
  (
    mockDatabase
      .prepare('SELECT history_backfill_state AS value FROM settings WHERE id = 1')
      .get() as { value: string | null } | undefined
  )?.value ?? null;

// Where the history backfill resumes is runtime state of this device, so a restored file never
// decides it: the live device's state is kept.
describe('restoring the history backfill state', () => {
  describe.each([null, 'XRP'])('with live state %s', (liveState) => {
    it.each(Object.keys(FILES))('keeps the live state when restoring %s', async (name) => {
      mockDatabase = openDatabase(null);
      const backup = FILES[name](await exportedSnapshot());

      mockDatabase = openDatabase(liveState);
      await restoreDataSnapshot(backup, EXPORT_VERSION);

      expect(storedState()).toBe(liveState);
    });
  });
});
