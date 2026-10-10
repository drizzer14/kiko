// `storedExternalIdsQuery` answers "does a stored row of THIS source hold this key" for
// the Binance walk's placement. A key is unique per `(source, external_id)`, so a row of
// another source with the same external id is a different row and must not count. Only
// a real engine proves the `source` filter reaches the SQL.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { database: client.database, write: client.write };
});

import { DatabaseSync } from 'node:sqlite';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

import { transactionsRepo } from './transactions.repo';

const TIME = Date.UTC(2026, 8, 20, 10);

beforeEach(() => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('PRAGMA foreign_keys = ON');
  mockDatabase.exec(
    "INSERT INTO accounts (id, name, kind) VALUES ('account', 'Binance', 'crypto')",
  );
  mockDatabase.exec(
    `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units) VALUES
      ('spot', 'account', 'Bitcoin', 'crypto_asset', 'BTC', 0)`,
  );
});

describe('transactionsRepo.storedExternalIdsQuery', () => {
  it('returns the keys a stored row of the asked source holds, and no others', async () => {
    await transactionsRepo.addManyDedup([
      { holdingId: 'spot', amountMinorUnits: 100, time: TIME, source: 'binance', externalId: 'a' },
      { holdingId: 'spot', amountMinorUnits: 200, time: TIME, source: 'binance', externalId: 'b' },
    ]);

    const stored = await transactionsRepo.storedExternalIdsQuery('binance', ['a', 'c']);

    expect([...stored]).toEqual(['a']);
  });

  it('does not return a Monobank row that holds the same external id', async () => {
    await transactionsRepo.addManyDedup([
      { holdingId: 'spot', amountMinorUnits: 100, time: TIME, source: 'monobank', externalId: 'a' },
    ]);

    const stored = await transactionsRepo.storedExternalIdsQuery('binance', ['a']);

    expect(stored.size).toBe(0);
  });

  it('returns the key from whichever holding stores it', async () => {
    mockDatabase.exec(
      `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units) VALUES
        ('funding', 'account', 'Funding', 'crypto_asset', 'BTC', 0)`,
    );
    await transactionsRepo.addManyDedup([
      {
        holdingId: 'funding',
        amountMinorUnits: 100,
        time: TIME,
        source: 'binance',
        externalId: 'a',
      },
    ]);

    const stored = await transactionsRepo.storedExternalIdsQuery('binance', ['a']);

    expect([...stored]).toEqual(['a']);
  });
});
