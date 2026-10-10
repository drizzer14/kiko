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
import { syncBinanceTransactions } from './binance.transactions';
import { createBinanceHistoryRun } from './binance.history-budget';
import { NOW, OTHER, OWN, party, payOrder } from './binance.pay-test-fixtures';

const ACCOUNT_ID = 'acc-1';
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

const received = (over: Partial<BinancePayOrder>): BinancePayOrder =>
  payOrder({
    transactionId: 'pay-1',
    transactionTime: DEPOSIT_TIME,
    amount: '0.5',
    payerInfo: party('Bob', undefined),
    receiverInfo: party('Me', OWN),
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
        hasBtcFundedOtherCoinOrder: false,
        usedUidWeight1m: undefined,
        usedIpWeight1m: undefined,
      }),
    },
  );

/** The capital walk over the real repos, with Binance answering one page of deposits. */
const runCapitalWalk = (deposits: { id: string; amount: string; insertTime: number }[]) =>
  syncBinanceTransactions(
    {
      targetAccountId: ACCOUNT_ID,
      run: createBinanceHistoryRun({ now: () => NOW, sleep: async () => undefined }),
    },
    {
      now: () => NOW,
      readCredentials: async () => ({ apiKey: 'api-key', secret: 'secret' }),
      fetchDepositHistory: async () => ({
        rows: deposits.map((deposit) => ({
          ...deposit,
          coin: 'BTC',
          txId: `tx-${deposit.id}`,
          status: 1,
          walletType: undefined,
        })),
        usedUidWeight1m: undefined,
        usedIpWeight1m: undefined,
      }),
      fetchWithdrawHistory: async () => ({
        rows: [],
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
      payerInfo: party('Me', OWN),
      receiverInfo: party('Ann', OTHER),
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

  it('skips a Funding Pay receive that repeats a capital deposit stored on Spot, and creates no Funding wallet', async () => {
    await importCapitalDeposit('1', 50_000_000, DEPOSIT_TIME);

    const result = await runWalk([
      received({
        transactionId: 'twin',
        walletType: 1,
        transactionTime: DEPOSIT_TIME + 3 * MINUTE_MS,
      }),
    ]);

    expect(result).toEqual({ imported: 0, complete: true });
    expect(storedRows().map((row) => row.external_id)).toEqual(['acc-1:deposit:1']);
    expect(holdingByKey('BTC:funding')).toBeUndefined();
  });

  it('keeps one of two same-size Pay receives beside one stored capital twin: the closer pairs, the other stays', async () => {
    await importCapitalDeposit('1', 50_000_000, DEPOSIT_TIME);
    const orders = [
      received({ transactionId: 'closer', transactionTime: DEPOSIT_TIME + MINUTE_MS }),
      received({ transactionId: 'farther', transactionTime: DEPOSIT_TIME + 5 * MINUTE_MS }),
    ];

    const first = await runWalk(orders);
    const second = await runWalk(orders);

    expect(first.imported).toBe(1);
    expect(second.imported).toBe(0);
    expect(storedRows().map((row) => row.external_id)).toEqual([
      'acc-1:deposit:1',
      'acc-1:pay:C2C:farther:2',
    ]);
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

describe('the capital walk beside stored Pay rows on real SQLite', () => {
  let warn: jest.SpyInstance;
  const twinDeposit = { id: '1', amount: '0.5', insertTime: DEPOSIT_TIME };

  beforeEach(() => {
    mockDatabase = openDatabase();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('leaves out a deposit that settles after its Pay twin was stored: one row, on every run', async () => {
    await runWalk([
      received({ transactionId: 'first', transactionTime: DEPOSIT_TIME + 3 * MINUTE_MS }),
    ]);

    const firstCapital = await runCapitalWalk([twinDeposit]);
    const secondCapital = await runCapitalWalk([twinDeposit]);
    const payAgain = await runWalk([
      received({ transactionId: 'first', transactionTime: DEPOSIT_TIME + 3 * MINUTE_MS }),
    ]);

    expect(firstCapital).toEqual({ imported: 0, complete: true });
    expect(secondCapital.imported).toBe(0);
    expect(payAgain.imported).toBe(0);
    expect(storedRows().map((row) => row.external_id)).toEqual(['acc-1:pay:C2C:first:2']);
  });

  it('imports a deposit with no Pay twin beside it', async () => {
    await runWalk([received({ transactionTime: DEPOSIT_TIME + 11 * MINUTE_MS })]);

    const result = await runCapitalWalk([twinDeposit]);

    expect(result.imported).toBe(1);
    expect(storedRows().map((row) => row.external_id)).toEqual([
      'acc-1:deposit:1',
      'acc-1:pay:C2C:pay-1:2',
    ]);
  });

  it('pairs a late deposit with the closer of two stored Pay rows, and each row only once', async () => {
    await runWalk([
      received({ transactionId: 'closer', transactionTime: DEPOSIT_TIME + MINUTE_MS }),
      received({ transactionId: 'farther', transactionTime: DEPOSIT_TIME + 5 * MINUTE_MS }),
    ]);

    const result = await runCapitalWalk([
      twinDeposit,
      { id: '2', amount: '0.5', insertTime: DEPOSIT_TIME + 4 * MINUTE_MS },
    ]);

    // The second deposit takes the farther Pay row, since the closer one is paired already.
    expect(result.imported).toBe(0);
    expect(storedRows()).toHaveLength(2);
  });
});
