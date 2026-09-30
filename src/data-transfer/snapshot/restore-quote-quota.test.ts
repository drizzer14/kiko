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

const QUOTA = { day: 1_790_812_800_000, calls: 7, dailyLimit: 20, symbols: ['VOD.LSE'] };

const openDatabase = (): DatabaseSync => {
  const database = new DatabaseSync(':memory:');

  applyAllMigrations(database);
  database.exec('INSERT INTO settings (id) VALUES (1)');

  return database;
};

const storedQuota = (): unknown => mockDatabase.prepare('SELECT quote_quota FROM settings').get();

describe('restoring the EODHD quote quota', () => {
  it('reads a backup made before the quota existed as no quota', async () => {
    mockDatabase = openDatabase();
    const legacy = JSON.parse(JSON.stringify(await readDataSnapshot())) as DataSnapshot;

    for (const row of legacy.settings as Record<string, unknown>[]) {
      delete row.quoteQuota;
    }

    mockDatabase = openDatabase();
    mockDatabase.prepare('UPDATE settings SET quote_quota = ?').run(JSON.stringify(QUOTA));

    await restoreDataSnapshot(legacy);

    expect(storedQuota()).toEqual({ quote_quota: null });
  });

  it('carries a stored quota through an export and an import', async () => {
    mockDatabase = openDatabase();
    mockDatabase.prepare('UPDATE settings SET quote_quota = ?').run(JSON.stringify(QUOTA));
    const exported = JSON.parse(JSON.stringify(await readDataSnapshot())) as DataSnapshot;

    mockDatabase = openDatabase();
    await restoreDataSnapshot(exported);

    expect((await readDataSnapshot()).settings[0]?.quoteQuota).toEqual(QUOTA);
  });
});
