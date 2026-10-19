// A backup of a Binance BTC holding that already went through the one-time default-name rename
// must restore its mark whole: without it the first sync after a restore renames a name the user
// set back to an old default. The real export read, the real restore and the real holdings
// repository run on a fully migrated `node:sqlite` engine.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const actual = jest.requireActual('@kiko/db/client');
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { ...actual, database: client.database, write: client.write };
});

import { DatabaseSync } from 'node:sqlite';
import { holdingsRepo } from '@kiko/holdings/repo';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

import { EXPORT_VERSION } from '../crypto/envelope';

import { readDataSnapshot } from './read-snapshot';
import { restoreDataSnapshot } from './restore-snapshot';

const openDatabase = (): DatabaseSync => {
  const database = new DatabaseSync(':memory:');

  applyAllMigrations(database);
  database.exec('PRAGMA foreign_keys = ON;');

  return database;
};

const seedSpotHolding = (name: string, metadata: Record<string, unknown>): void => {
  mockDatabase
    .prepare(
      "INSERT INTO accounts (id, name, kind, institution) VALUES ('acc-1', 'Binance', 'crypto', 'binance')",
    )
    .run();
  mockDatabase
    .prepare(
      `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units, metadata)
       VALUES ('h-spot', 'acc-1', ?, 'crypto_asset', 'BTC', 100, ?)`,
    )
    .run(name, JSON.stringify({ binanceAsset: 'BTC', ...metadata }));
};

const restoredFromBackup = async (): Promise<void> => {
  const snapshot = await readDataSnapshot();

  mockDatabase = openDatabase();
  await restoreDataSnapshot(snapshot, EXPORT_VERSION);
};

const storedSpot = (): { name: string; metadata: Record<string, unknown> } => {
  const row = mockDatabase
    .prepare("SELECT name, metadata FROM holdings WHERE id = 'h-spot'")
    .get() as { name: string; metadata: string };

  return { name: row.name, metadata: JSON.parse(row.metadata) };
};

const syncOnce = () =>
  holdingsRepo.upsertExchangeMany([
    {
      accountId: 'acc-1',
      name: 'Binance Spot · BTC',
      type: 'crypto_asset',
      currency: 'BTC',
      balanceMinorUnits: 250,
      metadata: { syncedAt: 2_000 },
      metadataField: 'binanceAsset',
      metadataKey: 'BTC',
      renameFromDefaults: ['Binance BTC', 'Binance Spot'],
    },
  ]);

describe('restoring a backup of a Binance BTC holding past its default-name rename', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockDatabase = openDatabase();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps the mark whole, so the next sync leaves a name set back to an old default alone', async () => {
    seedSpotHolding('Binance Spot', { defaultNameRenameSettled: true });
    await restoredFromBackup();

    expect(storedSpot().metadata).toMatchObject({ defaultNameRenameSettled: true });

    await syncOnce();

    expect(storedSpot().name).toBe('Binance Spot');
  });
});
