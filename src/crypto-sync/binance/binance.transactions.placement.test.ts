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
import { seedWalkMarks, walkMarksOf } from '@kiko/test-support/walk-marks';
import { exchangeExcludedTransactionIds } from '@kiko/statistics/exchange-exclusion';

import { syncBinanceTransactions } from './binance.transactions';
import { createBinanceHistoryRun } from './binance.history-budget';
import type { BinanceDeposit, BinanceWithdrawal } from './binance.history-client';

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
    .run(JSON.stringify({ binanceAsset: 'BTC' }));
  seedWalkMarks(rawDatabase, 'acc-1', 'capital', { cursor: NOW - 10 * DAY_MS });

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

const withdrawal = (over: Partial<BinanceWithdrawal>): BinanceWithdrawal => ({
  id: '9',
  amount: '1.5',
  transactionFee: '0.1',
  coin: 'USDT',
  txId: 'wd-tx',
  applyTime: '2024-01-03 00:00:00',
  status: 6,
  walletType: undefined,
  ...over,
});

const runWalk = (deposits: BinanceDeposit[], withdrawals: BinanceWithdrawal[] = []) =>
  syncBinanceTransactions(
    {
      targetAccountId: ACCOUNT_ID,
      run: createBinanceHistoryRun({ now: () => NOW, sleep: async () => undefined }),
    },
    {
      now: () => NOW,
      readCredentials: async () => ({ apiKey: 'api-key', secret: 'secret' }),
      fetchDepositHistory: async () => ({
        rows: deposits,
        unreadable: [],
        untracked: [],
        ...NO_READING,
      }),
      fetchWithdrawHistory: async () => ({
        rows: withdrawals,
        unreadable: [],
        untracked: [],
        ...NO_READING,
      }),
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

    expect(walkMarksOf(mockDatabase, 'acc-1', 'capital').cursor).toBe(NOW);
    expect(storedRows()).toHaveLength(1);
  });
});

describe('capital placement on real SQLite, with no Spot BTC holding', () => {
  const spotHoldings = (): { id: string; name: string; balance_minor_units: number }[] =>
    mockDatabase
      .prepare(
        "SELECT id, name, balance_minor_units FROM holdings WHERE json_extract(metadata, '$.binanceAsset') = 'BTC'",
      )
      .all() as { id: string; name: string; balance_minor_units: number }[];

  beforeEach(() => {
    mockDatabase = openDatabase();
    mockDatabase.prepare("DELETE FROM holdings WHERE id = 'h-spot'").run();
    mockDatabase
      .prepare(
        `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units, metadata)
         VALUES ('h-funding', 'acc-1', 'Binance Funding', 'crypto_asset', 'BTC', 0, ?)`,
      )
      .run(JSON.stringify({ binanceAsset: 'BTC:funding' }));
  });

  it('creates the Spot BTC holding at zero for a new Spot deposit, and places the row on it', async () => {
    const result = await runWalk([deposit({ walletType: 0 })]);

    const [spot] = spotHoldings();
    expect(result).toEqual({ imported: 1, complete: true });
    expect(spot).toMatchObject({ name: 'Binance Spot · BTC', balance_minor_units: 0 });
    expect(storedRows()).toEqual([
      { external_id: 'acc-1:deposit:7', holding_id: spot.id, amount_minor_units: 50_000_000 },
    ]);
  });

  it('creates no second Spot holding and no second row on a second identical run', async () => {
    const deposits = [deposit({ walletType: 0 })];

    await runWalk(deposits);
    const secondRun = await runWalk(deposits);

    expect(secondRun).toEqual({ imported: 0, complete: true });
    expect(spotHoldings()).toHaveLength(1);
    expect(storedRows()).toHaveLength(1);
  });

  // A stored row whose wallet has no holding keeps what it has (the walk only loses the
  // refresh of its own columns), and a new row of the same window still imports.
  it('leaves a stored row out of the write, whatever it now reads as, and imports a new row beside it', async () => {
    await transactionsRepo.addManyDedup([
      {
        holdingId: 'h-funding',
        amountMinorUnits: 50_000_000,
        time: DEPOSIT_TIME,
        source: 'binance',
        externalId: 'acc-1:deposit:7',
        description: 'BTC',
      },
    ]);

    const result = await runWalk([
      deposit({ walletType: 0, amount: '0.9' }),
      deposit({ id: '8', walletType: 1 }),
    ]);

    expect(result).toEqual({ imported: 1, complete: true });
    expect(spotHoldings()).toEqual([]);
    expect(storedRows()).toEqual([
      { external_id: 'acc-1:deposit:7', holding_id: 'h-funding', amount_minor_units: 50_000_000 },
      { external_id: 'acc-1:deposit:8', holding_id: 'h-funding', amount_minor_units: 50_000_000 },
    ]);
  });
});

describe('a BTC and a USDT record of one on-chain transaction with no id, on real SQLite', () => {
  const noId = { id: '', txId: '0xabc' };

  beforeEach(() => {
    mockDatabase = openDatabase();
  });

  it('stores two rows on their own holdings, and a second identical run stores no third', async () => {
    const deposits = [deposit({ ...noId }), deposit({ ...noId, coin: 'USDT', amount: '12.5' })];

    const firstRun = await runWalk(deposits);
    const secondRun = await runWalk(deposits);

    const usdtHolding = mockDatabase
      .prepare("SELECT id FROM holdings WHERE json_extract(metadata, '$.binanceAsset') = 'USDT'")
      .get() as { id: string };
    expect(firstRun).toEqual({ imported: 2, complete: true });
    expect(secondRun).toEqual({ imported: 0, complete: true });
    expect(storedRows()).toEqual([
      { external_id: 'acc-1:deposit:0xabc', holding_id: 'h-spot', amount_minor_units: 50_000_000 },
      {
        external_id: 'acc-1:deposit:0xabc:USDT',
        holding_id: usdtHolding.id,
        amount_minor_units: 1_250_000_000,
      },
    ]);
  });

  it('stores the withdrawal twin as two rows', async () => {
    await runWalk(
      [],
      [
        withdrawal({ ...noId, coin: 'BTC', amount: '0.25' }),
        withdrawal({ ...noId, amount: '1.5' }),
      ],
    );

    expect(storedRows().map((row) => row.external_id)).toEqual([
      'acc-1:withdraw:0xabc',
      'acc-1:withdraw:0xabc:USDT',
    ]);
  });
});

describe('a USDT withdrawal on real SQLite', () => {
  type SpendingRow = {
    id: string;
    holding_id: string;
    amount_minor_units: number;
    category: string | null;
    category_set_by_hand: number;
    exchange_counterpart_holding_id: string | null;
    exchange_pair_id: string | null;
    untracked_counterpart: string | null;
  };

  const withdrawalRow = (): SpendingRow =>
    mockDatabase
      .prepare(
        `SELECT id, holding_id, amount_minor_units, category, category_set_by_hand,
                exchange_counterpart_holding_id, exchange_pair_id, untracked_counterpart
           FROM transactions WHERE external_id = 'acc-1:withdraw:9'`,
      )
      .get() as SpendingRow;

  const excludedIdsOf = (row: SpendingRow): Set<string> =>
    exchangeExcludedTransactionIds([
      {
        id: row.id,
        exchangeCounterpartHoldingId: row.exchange_counterpart_holding_id,
        untrackedCounterpart: row.untracked_counterpart,
      },
    ]);

  beforeEach(() => {
    mockDatabase = openDatabase();
  });

  it('imports a USDT withdrawal as spending in the default category', async () => {
    const result = await runWalk([], [withdrawal({})]);

    const row = withdrawalRow();
    expect(result).toEqual({ imported: 1, complete: true });
    expect(row).toMatchObject({
      amount_minor_units: -150_000_000,
      category: null,
      category_set_by_hand: 0,
      exchange_counterpart_holding_id: null,
      exchange_pair_id: null,
      untracked_counterpart: null,
    });
    expect(
      mockDatabase.prepare('SELECT currency, name FROM holdings WHERE id = ?').get(row.holding_id),
    ).toEqual({ currency: 'USDT', name: 'Binance Spot · USDT' });
    expect(excludedIdsOf(row).size).toBe(0);
  });

  it('a hand-linked withdrawal stays excluded when the walk reads it again', async () => {
    await runWalk([], [withdrawal({})]);
    const imported = withdrawalRow();
    mockDatabase
      .prepare('UPDATE transactions SET exchange_counterpart_holding_id = ? WHERE id = ?')
      .run('h-spot', imported.id);

    const secondRun = await runWalk([], [withdrawal({})]);

    const row = withdrawalRow();
    expect(secondRun).toEqual({ imported: 0, complete: true });
    expect(row).toMatchObject({
      holding_id: imported.holding_id,
      amount_minor_units: -150_000_000,
      exchange_counterpart_holding_id: 'h-spot',
    });
    expect(excludedIdsOf(row)).toEqual(new Set([row.id]));
    expect(
      mockDatabase.prepare('SELECT currency FROM holdings WHERE id = ?').get(row.holding_id),
    ).toEqual({ currency: 'USDT' });
  });
});
