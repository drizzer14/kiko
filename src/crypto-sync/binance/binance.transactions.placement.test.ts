// The unit tests in `binance.transactions.test.ts` fake the repos, so they cannot
// prove that re-reading a row never MOVES it. This file runs the capital walk over
// the REAL repos on a real `node:sqlite` engine (the shipped migrations), where
// the `(source, external_id)` upsert and the insert-only Funding holding behave as
// they do on a device.
let mockDatabase: DatabaseSync;
jest.mock('@kiko/db/client', () => {
  const actual = jest.requireActual('@kiko/db/client');
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { ...actual, database: client.database, write: client.write };
});

import { DAY_MS } from '@kiko/dates';
import { DatabaseSync } from 'node:sqlite';
import { transactionsRepo } from '@kiko/transactions/repo';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

import type { BinanceDeposit } from './binance.history-client';
import { syncBinanceTransactions } from './binance.transactions';
import { createBinanceHistoryRun } from './binance.history-budget';

const NOW = 1_704_326_400_000; // 2024-01-04T00:00:00Z
const ACCOUNT_ID = 'acc-1';
const DEPOSIT_TIME = NOW - DAY_MS;

type StoredRow = { external_id: string; holding_id: string; amount_minor_units: number };

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
    .run(JSON.stringify({ binanceAsset: 'BTC', binanceHistoryCursor: NOW - 10 * DAY_MS }));

  return rawDatabase;
};

const deposit = (over: Partial<BinanceDeposit>): BinanceDeposit => ({
  id: '7',
  amount: '0.5',
  coin: 'BTC',
  txId: 'dep-tx',
  insertTime: DEPOSIT_TIME,
  status: 1,
  walletType: undefined,
  ...over,
});

const NO_READING = { usedUidWeight1m: undefined, usedIpWeight1m: undefined };

const runWalk = (deposits: BinanceDeposit[]) =>
  syncBinanceTransactions(
    {
      targetAccountId: ACCOUNT_ID,
      run: createBinanceHistoryRun({ now: () => NOW, sleep: async () => undefined }),
    },
    {
      now: () => NOW,
      readCredentials: async () => ({ apiKey: 'api-key', secret: 'secret' }),
      fetchDepositHistory: async () => ({ rows: deposits, unreadable: [], ...NO_READING }),
      fetchWithdrawHistory: async () => ({ rows: [], unreadable: [], ...NO_READING }),
    },
  );

const storedRows = (): StoredRow[] =>
  mockDatabase
    .prepare(
      'SELECT external_id, holding_id, amount_minor_units FROM transactions ORDER BY external_id',
    )
    .all() as StoredRow[];

const fundingHoldings = (): { id: string; balance_minor_units: number }[] =>
  mockDatabase
    .prepare(
      "SELECT id, balance_minor_units FROM holdings WHERE json_extract(metadata, '$.binanceAsset') = 'BTC:funding'",
    )
    .all() as { id: string; balance_minor_units: number }[];

const holdingIds = (): string[] =>
  (mockDatabase.prepare('SELECT id FROM holdings ORDER BY id').all() as { id: string }[]).map(
    (holding) => holding.id,
  );

const importOldSpotDeposit = (): Promise<number> =>
  transactionsRepo.addManyDedup([
    {
      holdingId: 'h-spot',
      amountMinorUnits: 50_000_000,
      time: DEPOSIT_TIME,
      source: 'binance',
      externalId: 'acc-1:deposit:7',
      description: 'BTC',
    },
  ]);

describe('capital placement on real SQLite', () => {
  beforeEach(() => {
    mockDatabase = openDatabase();
  });

  it('an old Spot deposit read again with walletType 1 stays on Spot: no second row, same count', async () => {
    await importOldSpotDeposit();

    const holdingsBefore = holdingIds();

    const result = await runWalk([deposit({ walletType: 1 })]);

    expect(result).toEqual({ imported: 0, complete: true });
    expect(holdingIds()).toEqual(holdingsBefore);
    expect(fundingHoldings()).toEqual([]);
    expect(storedRows()).toEqual([
      { external_id: 'acc-1:deposit:7', holding_id: 'h-spot', amount_minor_units: 50_000_000 },
    ]);
  });

  it('keeps the old row on Spot while a NEW walletType 1 deposit lands on a Funding holding created at zero', async () => {
    await importOldSpotDeposit();

    await runWalk([deposit({ walletType: 1 }), deposit({ id: '8', walletType: 1 })]);

    const funding = fundingHoldings();
    expect(funding).toHaveLength(1);
    expect(funding[0].balance_minor_units).toBe(0);
    expect(storedRows()).toEqual([
      { external_id: 'acc-1:deposit:7', holding_id: 'h-spot', amount_minor_units: 50_000_000 },
      { external_id: 'acc-1:deposit:8', holding_id: funding[0].id, amount_minor_units: 50_000_000 },
    ]);
  });

  it('a window with a new Spot row and a stored row read as Funding creates no Funding holding and keeps both on Spot', async () => {
    await importOldSpotDeposit();

    const result = await runWalk([deposit({ walletType: 1 }), deposit({ id: '8', walletType: 0 })]);

    expect(result).toEqual({ imported: 1, complete: true });
    expect(fundingHoldings()).toEqual([]);
    expect(storedRows()).toEqual([
      { external_id: 'acc-1:deposit:7', holding_id: 'h-spot', amount_minor_units: 50_000_000 },
      { external_id: 'acc-1:deposit:8', holding_id: 'h-spot', amount_minor_units: 50_000_000 },
    ]);
  });

  it('a second identical run creates no second Funding holding and no second row', async () => {
    const deposits = [deposit({ walletType: 1 })];

    await runWalk(deposits);
    const secondRun = await runWalk(deposits);

    expect(secondRun).toEqual({ imported: 0, complete: true });
    expect(storedRows()).toHaveLength(1);
    expect(fundingHoldings()).toHaveLength(1);
  });

  it('never touches the balance of an existing Funding holding while placing a row on it', async () => {
    mockDatabase
      .prepare(
        `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units, metadata)
         VALUES ('h-funding', 'acc-1', 'My Funding', 'crypto_asset', 'BTC', 777, ?)`,
      )
      .run(JSON.stringify({ binanceAsset: 'BTC:funding', syncedAt: 1 }));

    await runWalk([deposit({ walletType: 1 })]);

    expect(fundingHoldings()).toEqual([{ id: 'h-funding', balance_minor_units: 777 }]);
    expect(storedRows()).toEqual([
      { external_id: 'acc-1:deposit:7', holding_id: 'h-funding', amount_minor_units: 50_000_000 },
    ]);
  });

  it('advances the capital cursor on the Spot holding once the rows are stored', async () => {
    await runWalk([deposit({ walletType: 1 })]);

    const stored = mockDatabase
      .prepare("SELECT metadata FROM holdings WHERE id = 'h-spot'")
      .get() as {
      metadata: string;
    };
    expect(JSON.parse(stored.metadata).binanceHistoryCursor).toBe(NOW);
    expect(storedRows()).toHaveLength(1);
  });
});
