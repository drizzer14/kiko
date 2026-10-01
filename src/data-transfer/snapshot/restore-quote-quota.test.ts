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
const BACKED_UP_QUOTA = { ...QUOTA, calls: 15, dailyLimit: 100, symbols: ['AAPL.US'] };

const openDatabase = (quota?: object): DatabaseSync => {
  const database = new DatabaseSync(':memory:');

  applyAllMigrations(database);
  database.exec('INSERT INTO settings (id) VALUES (1)');

  if (quota !== undefined) {
    database.prepare('UPDATE settings SET quote_quota = ?').run(JSON.stringify(quota));
  }

  return database;
};

const exportedSnapshot = async (): Promise<DataSnapshot> =>
  JSON.parse(JSON.stringify(await readDataSnapshot())) as DataSnapshot;

const storedQuota = (): unknown => mockDatabase.prepare('SELECT quote_quota FROM settings').get();

// The quota counts this device's EODHD key's calls today, so a backup's copy
// never replaces it.
describe('restoring the EODHD quote quota', () => {
  it('leaves the live quota as it is when the backup predates the quota', async () => {
    mockDatabase = openDatabase();
    const legacy = await exportedSnapshot();

    for (const row of legacy.settings as Record<string, unknown>[]) {
      delete row.quoteQuota;
    }

    mockDatabase = openDatabase(QUOTA);
    await restoreDataSnapshot(legacy);

    expect(storedQuota()).toEqual({ quote_quota: JSON.stringify(QUOTA) });
  });

  it("keeps the live quota, never the backup's", async () => {
    mockDatabase = openDatabase(BACKED_UP_QUOTA);
    const backup = await exportedSnapshot();

    mockDatabase = openDatabase(QUOTA);
    await restoreDataSnapshot(backup);

    expect(storedQuota()).toEqual({ quote_quota: JSON.stringify(QUOTA) });
  });

  it("leaves a device with no quota without one, whatever the backup's", async () => {
    mockDatabase = openDatabase(BACKED_UP_QUOTA);
    const backup = await exportedSnapshot();

    mockDatabase = openDatabase();
    await restoreDataSnapshot(backup);

    expect(storedQuota()).toEqual({ quote_quota: null });
  });
});
