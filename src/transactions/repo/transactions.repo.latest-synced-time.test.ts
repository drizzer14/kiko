// `latestSyncedTimeQuery` is the capital walk's legacy fallback cursor. With external-id
// prefixes it follows one kind of row while other kinds of the same source sit on the
// holding. Only a real engine proves the prefix reaches the SQL.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { database: client.database, write: client.write };
});

import { DAY_MS } from '@kiko/dates';
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

const importRow = (externalId: string, time: number) =>
  transactionsRepo.addManyDedup([
    { holdingId: 'spot', amountMinorUnits: 100, time, source: 'binance', externalId },
  ]);

describe('transactionsRepo.latestSyncedTimeQuery', () => {
  it('reads the newest row of the source when no prefix is given', async () => {
    await importRow('account:deposit:1', TIME - DAY_MS);
    await importRow('account:pay:C2C:1:2', TIME);

    const latest = await transactionsRepo.latestSyncedTimeQuery('spot', 'binance');

    expect(latest).toEqual([{ time: TIME }]);
  });

  it('reads the newest row whose external id starts with a given prefix, and no other', async () => {
    await importRow('account:deposit:1', TIME - 2 * DAY_MS);
    await importRow('account:withdraw:1', TIME - DAY_MS);
    await importRow('account:pay:C2C:1:2', TIME);

    const latest = await transactionsRepo.latestSyncedTimeQuery('spot', 'binance', [
      'account:deposit:',
      'account:withdraw:',
    ]);

    expect(latest).toEqual([{ time: TIME - DAY_MS }]);
  });

  it('reads nothing when no row starts with a given prefix, and takes % and _ as plain characters', async () => {
    await importRow('account:pay:C2C:1:2', TIME);

    const latest = await transactionsRepo.latestSyncedTimeQuery('spot', 'binance', [
      'account:deposit:',
      '%',
      'account:p_y:',
    ]);

    expect(latest).toEqual([]);
  });
});
