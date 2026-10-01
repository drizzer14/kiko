let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');

  return executingClient(() => mockDatabase);
});

import { DatabaseSync } from 'node:sqlite';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

import { saveShareRefresh } from './share-refresh-write';

const DAY = Date.UTC(2026, 8, 30);
const QUOTA = { day: Date.UTC(2026, 9, 1), calls: 2, dailyLimit: 20, symbols: ['VOD.LSE'] };
const LOT = { day: DAY, quantityDelta: '10', costMinorUnits: 1500 };
const VOD_ROW = {
  instrument: 'share:VOD.LSE',
  day: DAY,
  price: '1.227',
  currency: 'GBP' as const,
  source: 'eodhd' as const,
};

const openDatabase = (metadata: Record<string, unknown>): DatabaseSync => {
  const database = new DatabaseSync(':memory:');

  applyAllMigrations(database);
  database.exec('INSERT INTO settings (id) VALUES (1)');
  database.exec("INSERT INTO accounts (id, name, kind) VALUES ('broker-1', 'Broker', 'broker')");
  database
    .prepare(
      `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units, metadata)
       VALUES ('share-1', 'broker-1', 'Vodafone', 'share', 'GBP', 0, ?)`,
    )
    .run(JSON.stringify(metadata));

  return database;
};

const storedMetadata = (): unknown =>
  JSON.parse(
    (
      mockDatabase.prepare("SELECT metadata FROM holdings WHERE id = 'share-1'").get() as {
        metadata: string;
      }
    ).metadata,
  );

const storedQuota = (): unknown =>
  JSON.parse(
    (mockDatabase.prepare('SELECT quote_quota FROM settings').get() as { quote_quota: string })
      .quote_quota,
  );

const handTyped = { quoteSource: 'eodhd', symbol: 'VOD.LSE', lots: [LOT] };
const unit = { holdingId: 'share-1', symbol: 'VOD.LSE', quoteCurrency: 'GBX' };

describe('saveShareRefresh', () => {
  it('stores the closes, the resolved unit, and the quota', async () => {
    mockDatabase = openDatabase(handTyped);

    await saveShareRefresh({ rows: [VOD_ROW], units: [unit], quota: QUOTA });

    expect(mockDatabase.prepare('SELECT instrument, day, price FROM price_points').all()).toEqual([
      { instrument: 'share:VOD.LSE', day: DAY, price: '1.227' },
    ]);
    expect(storedMetadata()).toEqual({ ...handTyped, quoteCurrency: 'GBX' });
    expect(storedQuota()).toEqual(QUOTA);
  });

  it('keeps a unit the share already has', async () => {
    mockDatabase = openDatabase({ ...handTyped, quoteCurrency: 'GBP' });

    await saveShareRefresh({ rows: [], units: [unit], quota: QUOTA });

    expect(storedMetadata()).toEqual({ ...handTyped, quoteCurrency: 'GBP' });
  });

  it('leaves a share whose symbol was edited since the refresh read it', async () => {
    mockDatabase = openDatabase({ ...handTyped, symbol: 'VOD.US' });

    await saveShareRefresh({ rows: [], units: [unit], quota: QUOTA });

    expect(storedMetadata()).toEqual({ ...handTyped, symbol: 'VOD.US' });
  });

  it('never stores a unit the share metadata cannot hold', async () => {
    mockDatabase = openDatabase(handTyped);

    await saveShareRefresh({
      rows: [],
      units: [{ ...unit, quoteCurrency: 'GBp' }],
      quota: QUOTA,
    });

    expect(storedMetadata()).toEqual(handTyped);
  });

  it('stores nothing when one part of the write fails', async () => {
    mockDatabase = openDatabase(handTyped);
    const invalidRow = { ...VOD_ROW, day: DAY + 1, price: null as unknown as string };

    await expect(
      saveShareRefresh({ rows: [VOD_ROW, invalidRow], units: [unit], quota: QUOTA }),
    ).rejects.toThrow();

    expect(mockDatabase.prepare('SELECT COUNT(*) AS count FROM price_points').get()).toEqual({
      count: 0,
    });
    expect(storedMetadata()).toEqual(handTyped);
    expect(mockDatabase.prepare('SELECT quote_quota FROM settings').get()).toEqual({
      quote_quota: null,
    });
  });
});
