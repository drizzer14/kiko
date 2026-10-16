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

const openDatabase = (cursor: string | null): DatabaseSync => {
  const database = new DatabaseSync(':memory:');

  applyAllMigrations(database);
  database.prepare('INSERT INTO settings (id, history_backfill_cursor) VALUES (1, ?)').run(cursor);

  return database;
};

const exportedSnapshot = async (): Promise<DataSnapshot> =>
  JSON.parse(JSON.stringify(await readDataSnapshot())) as DataSnapshot;

// The file the restore reads: one that carries a cursor, one exported before the column existed
// (no key at all), and one with no settings row.
const FILES: Record<string, (snapshot: DataSnapshot) => DataSnapshot> = {
  'a file saved with no cursor': (snapshot) => snapshot,
  'a file saved with a cursor': (snapshot) => ({
    ...snapshot,
    settings: snapshot.settings.map((row) => ({ ...row, historyBackfillCursor: 'BNB' })),
  }),
  'a file with no historyBackfillCursor key': (snapshot) => {
    for (const row of snapshot.settings as Record<string, unknown>[]) {
      delete row.historyBackfillCursor;
    }

    return snapshot;
  },
  'a file with an empty settings table': (snapshot) => ({ ...snapshot, settings: [] }),
};

const storedCursor = (): string | null =>
  (
    mockDatabase
      .prepare('SELECT history_backfill_cursor AS value FROM settings WHERE id = 1')
      .get() as { value: string | null } | undefined
  )?.value ?? null;

// Where the history backfill resumes is runtime state of this device, so a restored file never
// decides it: the live device's cursor is kept.
describe('restoring the history backfill cursor', () => {
  describe.each([null, 'XRP'])('with live cursor %s', (liveCursor) => {
    it.each(Object.keys(FILES))('keeps the live cursor when restoring %s', async (name) => {
      mockDatabase = openDatabase(null);
      const backup = FILES[name](await exportedSnapshot());

      mockDatabase = openDatabase(liveCursor);
      await restoreDataSnapshot(backup, EXPORT_VERSION);

      expect(storedCursor()).toBe(liveCursor);
    });
  });
});
