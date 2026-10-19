// The capital walk over the REAL repos: a disconnect before the first window commits must not
// lose the range set 15 backfills. The legacy row time the walk plans from outlives the disconnect
// (the rows stay), so the walk that reconnects records it at its first committed window.
let mockDatabase: DatabaseSync;
jest.mock('@kiko/db/client', () => {
  const actual = jest.requireActual('@kiko/db/client');
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { ...actual, database: client.database, write: client.write };
});

import { DAY_MS } from '@kiko/dates';
import { DatabaseSync } from 'node:sqlite';
import { accountsRepo } from '@kiko/accounts';
import { transactionsRepo } from '@kiko/transactions/repo';
import { walkMarksOf } from '@kiko/test-support/walk-marks';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

import { createBinanceHistoryRun } from './binance.history-budget';
import { HISTORY_FLOOR_MS, syncBinanceTransactions } from './binance.transactions';

const ACCOUNT_ID = 'acc-1';
const NOW = Date.UTC(2026, 9, 15);
const LEGACY_ROW_TIME = NOW - 40 * DAY_MS;

const openDatabase = (): DatabaseSync => {
  const rawDatabase = new DatabaseSync(':memory:');

  applyAllMigrations(rawDatabase);
  rawDatabase.exec('PRAGMA foreign_keys = ON;');
  rawDatabase
    .prepare(
      "INSERT INTO accounts (id, name, kind, institution) VALUES ('acc-1', 'Binance', 'crypto', 'binance')",
    )
    .run();
  rawDatabase
    .prepare(
      `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units, metadata)
       VALUES ('h-spot', 'acc-1', 'Binance Spot', 'crypto_asset', 'BTC', 100, ?)`,
    )
    .run(JSON.stringify({ binanceAsset: 'BTC' }));

  return rawDatabase;
};

const page = {
  rows: [],
  unreadable: [],
  untracked: [],
  usedUidWeight1m: undefined,
  usedIpWeight1m: undefined,
};

const walk = (reads: () => Promise<typeof page>) =>
  syncBinanceTransactions(
    {
      targetAccountId: ACCOUNT_ID,
      run: createBinanceHistoryRun({ now: () => NOW, sleep: async () => undefined }),
    },
    {
      now: () => NOW,
      readCredentials: async () => ({ apiKey: 'api-key', secret: 'secret' }),
      fetchDepositHistory: reads,
      fetchWithdrawHistory: async () => page,
    },
  );

const marks = () => walkMarksOf(mockDatabase, ACCOUNT_ID, 'capital');

let warn: jest.SpyInstance;

beforeEach(() => {
  mockDatabase = openDatabase();
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
});

describe('the capital walk and a disconnect before its first window commits', () => {
  it('a disconnect before any capital window commit keeps the backfill owed', async () => {
    await transactionsRepo.addManyDedup([
      {
        holdingId: 'h-spot',
        amountMinorUnits: 50_000_000,
        time: LEGACY_ROW_TIME,
        source: 'binance',
        externalId: 'acc-1:deposit:1',
        description: 'BTC',
      },
    ]);

    await expect(
      walk(async () => {
        throw new Error('run suspended');
      }),
    ).rejects.toThrow('run suspended');

    expect(marks()).not.toHaveProperty('multiCoinSeen');
    expect(marks()).not.toHaveProperty('multiCoinSince');

    await accountsRepo.disconnectExchange(ACCOUNT_ID, 'binance', HISTORY_FLOOR_MS);
    mockDatabase.prepare("UPDATE accounts SET institution = 'binance' WHERE id = 'acc-1'").run();

    expect(marks()).not.toHaveProperty('multiCoinSince');

    await walk(async () => page);

    expect(marks()).toMatchObject({ multiCoinSince: LEGACY_ROW_TIME, multiCoinSeen: true });
  });
});
