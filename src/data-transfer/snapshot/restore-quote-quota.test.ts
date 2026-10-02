let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');

  return executingClient(() => mockDatabase);
});

import { DAY_MS } from '@kiko/dates';
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

const storedQuotaObject = (): unknown =>
  JSON.parse((storedQuota() as { quote_quota: string }).quote_quota);

// The quota counts this device's EODHD key's calls today, so a backup's copy
// never replaces it.
describe('restoring the EODHD quote quota', () => {
  it('keeps the live quota when the backup predates the quota', async () => {
    mockDatabase = openDatabase();
    const legacy = await exportedSnapshot();

    for (const row of legacy.settings as Record<string, unknown>[]) {
      delete row.quoteQuota;
    }

    mockDatabase = openDatabase(QUOTA);
    await restoreDataSnapshot(legacy);

    expect(storedQuotaObject()).toEqual({ ...QUOTA, symbols: [] });
  });

  it("keeps the live quota's calls and key state, never the backup's", async () => {
    mockDatabase = openDatabase(BACKED_UP_QUOTA);
    const backup = await exportedSnapshot();
    const live = { ...QUOTA, keyGeneration: 2, isLimitUnconfirmed: true };

    mockDatabase = openDatabase(live);
    await restoreDataSnapshot(backup);

    expect(storedQuotaObject()).toEqual({ ...live, symbols: [] });
  });

  // The restored prices replace the ones the live quota's symbols were asked
  // for: a symbol refreshed today must be asked again for the backup's series.
  it('forgets which symbols the live quota asked today, backed off, or backfilled', async () => {
    mockDatabase = openDatabase(BACKED_UP_QUOTA);
    const backup = await exportedSnapshot();

    mockDatabase = openDatabase({
      ...QUOTA,
      backoff: { 'DEAD.US': { strikes: 1, retryDay: QUOTA.day, lastLotDay: 0 } },
      backfilledFrom: { 'VOD.LSE': QUOTA.day - 100 * DAY_MS },
    });
    await restoreDataSnapshot(backup);

    expect(storedQuotaObject()).toEqual({ ...QUOTA, symbols: [] });
  });

  it("leaves a device with no quota without one, whatever the backup's", async () => {
    mockDatabase = openDatabase(BACKED_UP_QUOTA);
    const backup = await exportedSnapshot();

    mockDatabase = openDatabase();
    await restoreDataSnapshot(backup);

    expect(storedQuota()).toEqual({ quote_quota: null });
  });
});
