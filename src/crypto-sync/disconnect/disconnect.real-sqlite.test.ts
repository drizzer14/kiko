// The unit test in `disconnect.test.ts` fakes the repos. This file runs the disconnect over the
// REAL repos on a real `node:sqlite` engine (the shipped migrations), where the walk state, the
// institution, the holdings and the rows it must leave alone all sit side by side.
let mockDatabase: DatabaseSync;
const mockClearCredentials = jest.fn(async (_id: string) => {});

jest.mock('@kiko/db/client', () => {
  const actual = jest.requireActual('@kiko/db/client');
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { ...actual, database: client.database, write: client.write };
});
jest.mock('@kiko/crypto-sync/binance/binance.credentials', () => ({
  clearCredentials: (id: string) => mockClearCredentials(id),
}));

import { DatabaseSync } from 'node:sqlite';
import { HISTORY_FLOOR_MS } from '@kiko/crypto-sync/binance';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import { seedWalkMarks, walkMarksOf } from '@kiko/test-support/walk-marks';

import { disconnectCryptoAccount } from './disconnect';

const NOW = 1_800_000_000_000;

const rowCount = (table: string): number =>
  (mockDatabase.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number }).total;

const connectedBinanceAccount = (): void => {
  mockDatabase.exec('PRAGMA foreign_keys = ON;');
  mockDatabase.exec(
    "INSERT INTO accounts (id, name, kind, institution) VALUES ('acc-1', 'Binance', 'crypto', 'binance')",
  );
  mockDatabase
    .prepare(
      `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units, metadata)
       VALUES ('h-spot', 'acc-1', 'Binance Spot', 'crypto_asset', 'BTC', 100, ?)`,
    )
    .run(JSON.stringify({ binanceAsset: 'BTC', syncedAt: NOW }));
  mockDatabase.exec(
    `INSERT INTO transactions (id, holding_id, amount_minor_units, time, source, external_id)
     VALUES ('t-1', 'h-spot', 50, 1, 'binance', 'acc-1:deposit:1')`,
  );
  seedWalkMarks(mockDatabase, 'acc-1', 'capital', { cursor: NOW });
  seedWalkMarks(mockDatabase, 'acc-1', 'pay', {
    cursor: NOW,
    rescan: NOW - 1,
    pending: [{ start: 5, end: 7 }],
    pointCursor: 6,
  });
};

beforeEach(() => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockClearCredentials.mockClear();
});

describe('disconnectCryptoAccount over the real repos', () => {
  it('for Binance, resets every walk to the floor and keeps the holdings and the rows', async () => {
    connectedBinanceAccount();

    await disconnectCryptoAccount('acc-1', 'binance');

    expect(walkMarksOf(mockDatabase, 'acc-1', 'capital')).toEqual({ cursor: HISTORY_FLOOR_MS });
    expect(walkMarksOf(mockDatabase, 'acc-1', 'pay')).toEqual({
      cursor: HISTORY_FLOOR_MS,
      rescan: HISTORY_FLOOR_MS,
      pending: [],
    });
    expect(
      (
        mockDatabase.prepare("SELECT institution FROM accounts WHERE id = 'acc-1'").get() as {
          institution: string | null;
        }
      ).institution,
    ).toBeNull();
    expect(rowCount('holdings')).toBe(1);
    expect(rowCount('transactions')).toBe(1);
    expect(mockClearCredentials).toHaveBeenCalledWith('acc-1');
  });
});
