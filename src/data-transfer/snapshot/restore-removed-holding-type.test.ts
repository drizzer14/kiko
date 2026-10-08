let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');

  return executingClient(() => mockDatabase);
});

import { DatabaseSync } from 'node:sqlite';
import { database, holdings } from '@kiko/db';
import { holdingValue } from '@kiko/holdings/holding-value';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

import { readDataSnapshot } from './read-snapshot';
import type { DataSnapshot } from './data-snapshot';
import { restoreDataSnapshot } from './restore-snapshot';

const openDatabase = (): void => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('INSERT INTO settings (id) VALUES (1)');
};

// A backup written by a build that still had the share holding type, which a
// restore reads as it reads every row: structurally, with no check of `type`.
describe('restoring a holding of a type this build no longer has', () => {
  it('stores the row as it was, and values it at its flat stored balance', async () => {
    openDatabase();
    mockDatabase
      .prepare("INSERT INTO accounts (id, name, kind) VALUES ('broker-1', 'Broker', 'broker')")
      .run();
    mockDatabase
      .prepare(
        `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units, metadata)
         VALUES ('share-1', 'broker-1', 'Apple', 'share', 'USD', 0, ?)`,
      )
      .run(JSON.stringify({ quoteSource: 'manual', lots: [] }));
    const backup = JSON.parse(JSON.stringify(await readDataSnapshot())) as DataSnapshot;

    openDatabase();
    await restoreDataSnapshot(backup);

    const [restored] = await database.select().from(holdings);

    expect(restored.id).toBe('share-1');
    expect(String(restored.type)).toBe('share');
    expect(holdingValue(restored, Date.now()).minorUnits).toBe(0);
  });
});
