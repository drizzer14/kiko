// The stored funding match rows hold a NO ACTION foreign key on the account, so the real delete
// must clear them before the account row goes, and a disconnect must clear them in the write that
// closes the connection. Only a real engine with foreign keys on shows either.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { database: client.database, write: client.write };
});

jest.mock('@kiko/monobank/token', () => ({ clearToken: jest.fn() }));
jest.mock('@kiko/crypto-sync/binance', () => ({ clearCredentials: jest.fn() }));

import { DatabaseSync } from 'node:sqlite';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

import { accountsRepo } from './accounts.repo';

const FLOOR_MS = 1;

const seedAccountWithRows = (accountId: string, institution: string | null): void => {
  mockDatabase
    .prepare('INSERT INTO accounts (id, name, kind, institution) VALUES (?, ?, ?, ?)')
    .run(accountId, 'Exchange', 'crypto', institution);
  mockDatabase.prepare('INSERT INTO sync_state (account_id) VALUES (?)').run(accountId);

  for (const side of ['ledger', 'source']) {
    mockDatabase
      .prepare(
        `INSERT INTO funding_match_rows
           (account_id, side, record_key, coin, direction, amount, time_start, time_end)
         VALUES (?, ?, 'k', 'USDT', 'I', '100', 1, 2)`,
      )
      .run(accountId, side);
  }
};

const accountIdsWithRows = (): string[] =>
  (
    mockDatabase
      .prepare('SELECT account_id AS accountId FROM funding_match_rows ORDER BY account_id, side')
      .all() as { accountId: string }[]
  ).map((row) => row.accountId);

beforeEach(() => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('PRAGMA foreign_keys = ON');
});

describe('accountsRepo.remove with stored funding match rows', () => {
  it('deletes the account and its rows, and leaves the rows of another account', async () => {
    seedAccountWithRows('gone', null);
    seedAccountWithRows('kept', null);

    await expect(accountsRepo.remove('gone')).resolves.toBeUndefined();

    expect(accountIdsWithRows()).toEqual(['kept', 'kept']);
    expect(mockDatabase.prepare('SELECT id FROM accounts').all()).toEqual([{ id: 'kept' }]);
  });
});

describe('accountsRepo.disconnectExchange with stored funding match rows', () => {
  it('clears the rows of the account in the same write, and not those of another account', async () => {
    seedAccountWithRows('disconnected', 'binance');
    seedAccountWithRows('other', 'binance');

    await accountsRepo.disconnectExchange('disconnected', 'binance', FLOOR_MS);

    expect(accountIdsWithRows()).toEqual(['other', 'other']);
    expect(
      mockDatabase.prepare("SELECT institution FROM accounts WHERE id = 'disconnected'").get(),
    ).toEqual({ institution: null });
  });

  it('keeps the rows when the write fails, together with the connection', async () => {
    seedAccountWithRows('disconnected', 'binance');
    mockDatabase.exec(
      "CREATE TRIGGER refuse_account_update BEFORE UPDATE ON accounts BEGIN SELECT RAISE(ABORT, 'refused'); END",
    );

    await expect(
      accountsRepo.disconnectExchange('disconnected', 'binance', FLOOR_MS),
    ).rejects.toThrow(/Failed query: update "accounts"/);

    expect(accountIdsWithRows()).toEqual(['disconnected', 'disconnected']);
    expect(
      mockDatabase.prepare("SELECT institution FROM accounts WHERE id = 'disconnected'").get(),
    ).toEqual({ institution: 'binance' });
  });
});
