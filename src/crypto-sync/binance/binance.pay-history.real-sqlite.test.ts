// The unit tests in `binance.pay-history.test.ts` fake the repos. This file runs the Pay
// walk over the REAL repos on a real `node:sqlite` engine (the shipped migrations), where
// the overlap guard reads the rows the capital walk stored, the `(source, external_id)`
// upsert dedupes a second run, and a missing wallet holding is created insert-only.
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

import { syncBinancePayHistory } from './binance.pay-history';
import type { BinancePayOrder } from './binance.history-client';
import { createBinanceHistoryRun } from './binance.history-budget';

const NOW = Date.UTC(2026, 9, 10);
const ACCOUNT_ID = 'acc-1';
const OWN = '1001';
const MINUTE_MS = 60_000;
const DEPOSIT_TIME = NOW - 10 * DAY_MS;

type StoredRow = {
  external_id: string;
  holding_id: string;
  amount_minor_units: number;
  description: string;
};

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
    .run(JSON.stringify({ binanceAsset: 'BTC', binanceHistoryCursor: NOW }));

  return rawDatabase;
};

const received = (over: Partial<BinancePayOrder>): BinancePayOrder => ({
  orderType: 'C2C',
  transactionId: 'pay-1',
  transactionTime: DEPOSIT_TIME,
  amount: '0.5',
  currency: 'BTC',
  walletType: 2,
  walletTypes: undefined,
  fundsDetail: [],
  payerInfo: { name: 'Bob', binanceId: undefined },
  receiverInfo: { name: 'Me', binanceId: OWN },
  ...over,
});

const runWalk = (orders: BinancePayOrder[]) =>
  syncBinancePayHistory(
    {
      targetAccountId: ACCOUNT_ID,
      run: createBinanceHistoryRun({ now: () => NOW, sleep: async () => undefined }),
    },
    {
      now: () => NOW,
      readCredentials: async () => ({ apiKey: 'api-key', secret: 'secret' }),
      fetchAccount: async () => ({ balances: [], uid: OWN }),
      fetchPayHistory: async () => ({
        rows: orders,
        gathered: orders.length,
        oldestTransactionTime: undefined,
        hasBtcFundedOtherCoinOrder: false,
        usedUidWeight1m: undefined,
        usedIpWeight1m: undefined,
      }),
    },
  );

const storedRows = (): StoredRow[] =>
  mockDatabase
    .prepare(
      'SELECT external_id, holding_id, amount_minor_units, description FROM transactions ORDER BY external_id',
    )
    .all() as StoredRow[];

const importCapitalDeposit = (id: string, amountMinorUnits: number, time: number) =>
  transactionsRepo.addManyDedup([
    {
      holdingId: 'h-spot',
      amountMinorUnits,
      time,
      source: 'binance',
      externalId: `acc-1:deposit:${id}`,
      description: 'BTC',
    },
  ]);

const holdingByKey = (key: string): { id: string; balance_minor_units: number } | undefined =>
  mockDatabase
    .prepare(
      "SELECT id, balance_minor_units FROM holdings WHERE json_extract(metadata, '$.binanceAsset') = ?",
    )
    .get(key) as { id: string; balance_minor_units: number } | undefined;

describe('the Pay walk on real SQLite', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    mockDatabase = openDatabase();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('skips a Pay row that repeats a stored capital deposit 9 minutes apart, and keeps one 11 minutes apart', async () => {
    await importCapitalDeposit('1', 50_000_000, DEPOSIT_TIME);
    await importCapitalDeposit('2', 30_000_000, DEPOSIT_TIME);

    const result = await runWalk([
      received({ transactionId: 'dup', transactionTime: DEPOSIT_TIME + 9 * MINUTE_MS }),
      received({
        transactionId: 'apart',
        amount: '0.3',
        transactionTime: DEPOSIT_TIME + 11 * MINUTE_MS,
      }),
    ]);

    expect(result).toEqual({ imported: 1, complete: true });
    expect(storedRows().map((row) => row.external_id)).toEqual([
      'acc-1:deposit:1',
      'acc-1:deposit:2',
      'acc-1:pay:C2C:apart:2',
    ]);
  });

  it('stores the counterparty nickname, signed, on Spot', async () => {
    const sent = received({
      amount: '-0.25',
      payerInfo: { name: 'Me', binanceId: OWN },
      receiverInfo: { name: 'Ann', binanceId: '2002' },
    });

    await runWalk([sent]);

    expect(storedRows()).toEqual([
      {
        external_id: 'acc-1:pay:C2C:pay-1:2',
        holding_id: 'h-spot',
        amount_minor_units: -25_000_000,
        description: 'Ann',
      },
    ]);
  });

  it('writes the Pay cursor next to the capital cursor on the Spot holding', async () => {
    await runWalk([]);

    const stored = mockDatabase
      .prepare("SELECT metadata FROM holdings WHERE id = 'h-spot'")
      .get() as { metadata: string };
    expect(JSON.parse(stored.metadata)).toMatchObject({
      binanceHistoryCursor: NOW,
      binancePayHistoryCursor: NOW,
    });
  });

  it('a second identical run imports no new row and keeps the one stored', async () => {
    const orders = [received({ transactionId: 'once' })];

    const first = await runWalk(orders);
    const second = await runWalk(orders);

    expect(first.imported).toBe(1);
    expect(second).toEqual({ imported: 0, complete: true });
    expect(storedRows()).toHaveLength(1);
  });

  it('creates a missing Earn holding at zero for an Earn order, and never touches an existing balance', async () => {
    await runWalk([received({ transactionId: 'earn-order', walletType: 5 })]);

    const earn = holdingByKey('BTC:earn');
    expect(earn?.balance_minor_units).toBe(0);
    expect(storedRows()).toMatchObject([
      { external_id: 'acc-1:pay:C2C:earn-order:5', holding_id: earn?.id },
    ]);

    mockDatabase
      .prepare('UPDATE holdings SET balance_minor_units = 777 WHERE id = ?')
      .run(earn?.id ?? '');
    await runWalk([received({ transactionId: 'earn-again', walletType: 5 })]);

    expect(holdingByKey('BTC:earn')?.balance_minor_units).toBe(777);
  });

  it('creates no holding on an account disconnected while the walk was running', async () => {
    mockDatabase.prepare("UPDATE accounts SET institution = NULL WHERE id = 'acc-1'").run();

    const result = await runWalk([received({ walletType: 1 })]);

    expect(holdingByKey('BTC:funding')).toBeUndefined();
    expect(result.complete).toBe(false);
  });

  it('writes no Pay watermark on an account disconnected while the walk was running', async () => {
    mockDatabase.prepare("UPDATE accounts SET institution = NULL WHERE id = 'acc-1'").run();

    await runWalk([]);

    const stored = mockDatabase
      .prepare("SELECT metadata FROM holdings WHERE id = 'h-spot'")
      .get() as { metadata: string };
    expect(JSON.parse(stored.metadata).binancePayHistoryCursor).toBeUndefined();
  });
});
