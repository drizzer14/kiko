let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');

  return executingClient(() => mockDatabase);
});

const mockSaveEodhdKey = jest.fn();
jest.mock('@kiko/prices/eodhd-key/eodhd-key', () => ({
  saveEodhdKey: (key: string) => mockSaveEodhdKey(key),
}));

jest.mock('@kiko/monobank/token', () => ({ saveToken: jest.fn() }));
jest.mock('@kiko/crypto-sync/binance/binance.credentials', () => ({ saveCredentials: jest.fn() }));

import { DatabaseSync } from 'node:sqlite';
import maybe, { foldMap } from 'fnts/maybe';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

import { restoreExportSecrets } from './restore-secrets';

const TODAY = Date.UTC(2026, 9, 1);
const NOW = TODAY + 9 * 60 * 60 * 1000;
const LIVE_QUOTA = {
  day: TODAY,
  calls: 7,
  dailyLimit: 100,
  symbols: [],
  keyGeneration: 2,
  isKeyRejected: true,
};

const openDatabase = (quota?: object): DatabaseSync => {
  const database = new DatabaseSync(':memory:');

  applyAllMigrations(database);
  database.exec('INSERT INTO settings (id) VALUES (1)');

  if (quota !== undefined) {
    database.prepare('UPDATE settings SET quote_quota = ?').run(JSON.stringify(quota));
  }

  return database;
};

const storedQuota = (): unknown => {
  const row = mockDatabase.prepare('SELECT quote_quota FROM settings').get() as {
    quote_quota: string | null;
  };

  return foldMap(maybe(row.quote_quota), (json): unknown => JSON.parse(json)) ?? null;
};

// A restored key may belong to another EODHD plan than the one this device's
// limit was read for, so Share prices reads its limit again on open.
describe('restoring the EODHD key', () => {
  beforeEach(() => {
    mockSaveEodhdKey.mockReset().mockResolvedValue(undefined);
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("marks the limit unconfirmed and the key new, keeping this device's calls today", async () => {
    mockDatabase = openDatabase(LIVE_QUOTA);

    await restoreExportSecrets({
      monobankTokens: [],
      binanceCredentials: [],
      eodhdKey: 'fake-eodhd-key-0000',
    });

    expect(mockSaveEodhdKey).toHaveBeenCalledWith('fake-eodhd-key-0000');
    expect(storedQuota()).toEqual({
      day: TODAY,
      calls: 7,
      dailyLimit: 100,
      symbols: [],
      keyGeneration: 3,
      isLimitUnconfirmed: true,
    });
  });

  it('starts an unconfirmed quota on a device that never had one', async () => {
    mockDatabase = openDatabase();

    await restoreExportSecrets({
      monobankTokens: [],
      binanceCredentials: [],
      eodhdKey: 'fake-eodhd-key-0000',
    });

    expect(storedQuota()).toEqual({
      day: TODAY,
      calls: 0,
      dailyLimit: 20,
      symbols: [],
      keyGeneration: 1,
      isLimitUnconfirmed: true,
    });
  });

  it('leaves the quota alone for a backup with no key', async () => {
    mockDatabase = openDatabase(LIVE_QUOTA);

    await restoreExportSecrets({ monobankTokens: [], binanceCredentials: [] });

    expect(storedQuota()).toEqual(LIVE_QUOTA);
  });

  it('stores the key before the quota marks it new', async () => {
    mockDatabase = openDatabase(LIVE_QUOTA);
    mockSaveEodhdKey.mockImplementation(async () => {
      expect(storedQuota()).toEqual(LIVE_QUOTA);
    });

    await restoreExportSecrets({
      monobankTokens: [],
      binanceCredentials: [],
      eodhdKey: 'fake-eodhd-key-0000',
    });

    expect(mockSaveEodhdKey).toHaveBeenCalledTimes(1);
  });
});
