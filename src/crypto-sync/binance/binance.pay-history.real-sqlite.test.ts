// The unit tests in `binance.pay-history.test.ts` fake the repos. This file runs the Pay
// walk over the REAL repos on a real `node:sqlite` engine (the shipped migrations), where
// a Pay row and a capital row of the same size sit side by side, the `(source, external_id)`
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
import { holdingsRepo } from '@kiko/holdings/repo';
import { transactionsRepo } from '@kiko/transactions/repo';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

import type {
  BinanceDeposit,
  BinancePayOrder,
  HistoryPage,
  HistoryWindow,
} from './binance.history-client';
import { syncBinancePayHistory } from './binance.pay-history';
import { createBinanceHistoryRun } from './binance.history-budget';
import { HISTORY_FLOOR_MS, syncBinanceTransactions } from './binance.transactions';
import { costOn, NOW, OTHER, OWN, party, payOrder } from './binance.pay-test-fixtures';

const ACCOUNT_ID = 'acc-1';
const MINUTE_MS = 60_000;
const DEPOSIT_TIME = NOW - 10 * DAY_MS;
/**
 * 12 hours before the instant Pay receipts go to Spot (2026-09-29T00:00Z), so a receive at
 * this time lands on Funding.
 */
const BEFORE_SPOT_RECEIPTS_TIME = Date.UTC(2026, 8, 28, 12);

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

/** The request every walk of this file makes: the connected account, a fresh gate and budget. */
const requestOf = () => ({
  targetAccountId: ACCOUNT_ID,
  run: createBinanceHistoryRun({ now: () => NOW, sleep: async () => undefined }),
});

/** The clock and the credentials every walk of this file reads. */
const clockAndCredentials = {
  now: () => NOW,
  readCredentials: async () => ({ apiKey: 'api-key', secret: 'secret' }),
};

/** A fresh database for each test and a silenced `console.warn`, which the walks log to. */
const useRealDatabase = (): void => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    mockDatabase = openDatabase();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });
};

const runWalk = (orders: BinancePayOrder[]) =>
  syncBinancePayHistory(requestOf(), {
    ...clockAndCredentials,
    fetchAccount: async () => ({ balances: [], uid: OWN }),
    fetchPayHistory: async () => ({
      rows: orders,
      unreadable: [],
      gathered: orders.length,
      btcFundedOtherCoinOrders: [],
      usedUidWeight1m: undefined,
      usedIpWeight1m: undefined,
    }),
  });

type TestDeposit = { id: string; amount: string; insertTime: number };

const depositRecord = (deposit: TestDeposit) => ({
  ...deposit,
  coin: 'BTC',
  txId: `tx-${deposit.id}`,
  status: 1,
  walletType: undefined,
});

const historyPageOf = <Row>(rows: Row[]) => ({
  rows,
  unreadable: [],
  usedUidWeight1m: undefined,
  usedIpWeight1m: undefined,
});

/** The capital walk over the real repos, with the given answer to a deposit-history request. */
const runCapitalWalkOver = (
  fetchDepositHistory: (window: HistoryWindow) => Promise<HistoryPage<BinanceDeposit>>,
) =>
  syncBinanceTransactions(requestOf(), {
    ...clockAndCredentials,
    fetchDepositHistory: (_apiKey, _secret, window) => fetchDepositHistory(window),
    fetchWithdrawHistory: async () => historyPageOf([]),
  });

/** The capital walk over the real repos, with Binance answering one page of deposits. */
const runCapitalWalk = (deposits: TestDeposit[]) =>
  runCapitalWalkOver(async () => historyPageOf(deposits.map(depositRecord)));

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

const spotMetadata = (): Record<string, unknown> => {
  const stored = mockDatabase
    .prepare("SELECT metadata FROM holdings WHERE id = 'h-spot'")
    .get() as { metadata: string };

  return JSON.parse(stored.metadata);
};

const holdingByKey = (key: string): { id: string; balance_minor_units: number } | undefined =>
  mockDatabase
    .prepare(
      "SELECT id, balance_minor_units FROM holdings WHERE json_extract(metadata, '$.binanceAsset') = ?",
    )
    .get(key) as { id: string; balance_minor_units: number } | undefined;

describe('the Pay walk on real SQLite', () => {
  useRealDatabase();

  it('keeps a Pay row beside a stored capital deposit of the same size 9 minutes apart', async () => {
    await importCapitalDeposit('1', 50_000_000, DEPOSIT_TIME);

    const result = await runWalk([
      received({ transactionId: 'near', transactionTime: DEPOSIT_TIME + 9 * MINUTE_MS }),
    ]);

    expect(result).toEqual({ imported: 1, complete: true });
    expect(storedRows().map((row) => row.external_id)).toEqual([
      'acc-1:deposit:1',
      'acc-1:pay:C2C:near:2',
    ]);
  });

  it('runs on a Spot holding that has no capital watermark', async () => {
    mockDatabase
      .prepare("UPDATE holdings SET metadata = ? WHERE id = 'h-spot'")
      .run(JSON.stringify({ binanceAsset: 'BTC' }));

    const result = await runWalk([received({ transactionId: 'no-capital-cursor' })]);

    expect(result).toEqual({ imported: 1, complete: true });
    expect(spotMetadata()).toMatchObject({ binancePayHistoryCursor: NOW });
  });

  it('stores the counterparty nickname, signed, on Spot', async () => {
    const sent = received({
      amount: '-0.25',
      fundsDetail: costOn(2, '0.25'),
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

  it('finishes a stored re-scan through the same keys: the order is imported once, the mark restarts, and a disconnect resets it', async () => {
    const inProgress = {
      binanceAsset: 'BTC',
      binanceHistoryCursor: NOW,
      binancePayHistoryCursor: NOW - 2 * DAY_MS,
      binancePayRescanCursor: NOW - 40 * DAY_MS,
    };
    mockDatabase
      .prepare("UPDATE holdings SET metadata = ? WHERE id = 'h-spot'")
      .run(JSON.stringify(inProgress));
    const orders = [received({ transactionId: 'late', transactionTime: NOW - 5 * DAY_MS })];

    const first = await runWalk(orders);
    const second = await runWalk(orders);

    expect(first.imported).toBe(1);
    expect(second.imported).toBe(0);
    expect(storedRows().map((row) => row.external_id)).toEqual(['acc-1:pay:C2C:late:2']);
    expect(spotMetadata()).toMatchObject({
      binancePayHistoryCursor: NOW,
      binancePayRescanCursor: HISTORY_FLOOR_MS,
    });

    mockDatabase
      .prepare("UPDATE holdings SET metadata = json_set(metadata, '$.binancePayRescanCursor', ?)")
      .run(NOW - 40 * DAY_MS);
    await holdingsRepo.resetBinanceWalkCursors(ACCOUNT_ID, 1);

    expect(spotMetadata()).toMatchObject({ binancePayHistoryCursor: 1, binancePayRescanCursor: 1 });
  });

  it('keeps the overlap day behind a stale cursor on the Spot holding until a run has read it, and a disconnect empties the list', async () => {
    const cursor = NOW - 120 * DAY_MS;
    mockDatabase
      .prepare("UPDATE holdings SET metadata = ? WHERE id = 'h-spot'")
      .run(JSON.stringify({ binanceAsset: 'BTC', binancePayHistoryCursor: cursor }));
    const late = received({ transactionId: 'late', transactionTime: cursor - DAY_MS / 2 });
    const answerByRange = (cutAfter: number) => {
      let calls = 0;

      return async (
        _apiKey: string,
        _secret: string,
        query: { startTime: number; endTime: number },
      ) => {
        calls += 1;

        if (calls > cutAfter) {
          throw new Error('run suspended');
        }

        const rows = [late].filter(
          (order) =>
            order.transactionTime >= query.startTime && order.transactionTime <= query.endTime,
        );

        return {
          rows,
          unreadable: [],
          gathered: rows.length,
          btcFundedOtherCoinOrders: [],
          usedUidWeight1m: undefined,
          usedIpWeight1m: undefined,
        };
      };
    };
    const walkWith = (cutAfter: number) =>
      syncBinancePayHistory(requestOf(), {
        ...clockAndCredentials,
        fetchAccount: async () => ({ balances: [], uid: OWN }),
        fetchPayHistory: answerByRange(cutAfter),
      });

    await expect(walkWith(2)).rejects.toThrow('run suspended');

    expect(spotMetadata()).toMatchObject({
      binancePayHistoryCursor: NOW,
      binancePayPendingOverlap: [{ start: cursor - DAY_MS, end: cursor }],
    });
    expect(storedRows()).toEqual([]);

    const resumed = await walkWith(10);

    expect(resumed.imported).toBe(1);
    expect(spotMetadata()).toMatchObject({ binancePayPendingOverlap: [] });
    expect(storedRows().map((row) => row.external_id)).toEqual(['acc-1:pay:C2C:late:1']);

    mockDatabase
      .prepare(
        "UPDATE holdings SET metadata = json_set(metadata, '$.binancePayPendingOverlap', json(?))",
      )
      .run(JSON.stringify([{ start: 1, end: 2 }]));
    await holdingsRepo.resetBinanceWalkCursors(ACCOUNT_ID, 1);

    expect(spotMetadata()).toMatchObject({ binancePayPendingOverlap: [] });
  });

  it('writes the range cursor of an owed day it read on the Spot holding, and a disconnect drops it', async () => {
    const day = { start: NOW - 150 * DAY_MS, end: NOW - 149 * DAY_MS };
    mockDatabase.prepare("UPDATE holdings SET metadata = ? WHERE id = 'h-spot'").run(
      JSON.stringify({
        binanceAsset: 'BTC',
        binancePayHistoryCursor: NOW - 2 * DAY_MS,
        binancePayPendingOverlap: [day],
      }),
    );

    await runWalk([]);

    expect(spotMetadata()).toMatchObject({
      binancePayRangeCursor: day.end,
      binancePayPendingOverlap: [],
    });

    await holdingsRepo.resetBinanceWalkCursors(ACCOUNT_ID, 1);

    expect(spotMetadata()).not.toHaveProperty('binancePayRangeCursor');
  });

  it('creates a missing Earn holding at zero for an Earn order, and never touches an existing balance', async () => {
    const earnSend = (transactionId: string) =>
      payOrder({ transactionId, walletType: 5, fundsDetail: costOn(5) });

    await runWalk([earnSend('earn-order')]);

    const earn = holdingByKey('BTC:earn');
    expect(earn?.balance_minor_units).toBe(0);
    expect(storedRows()).toMatchObject([
      { external_id: 'acc-1:pay:C2C:earn-order:5', holding_id: earn?.id },
    ]);

    mockDatabase
      .prepare('UPDATE holdings SET balance_minor_units = 777 WHERE id = ?')
      .run(earn?.id ?? '');
    await runWalk([earnSend('earn-again')]);

    expect(holdingByKey('BTC:earn')?.balance_minor_units).toBe(777);
  });

  it('creates no holding on an account disconnected while the walk was running', async () => {
    mockDatabase.prepare("UPDATE accounts SET institution = NULL WHERE id = 'acc-1'").run();

    const result = await runWalk([received({ transactionTime: BEFORE_SPOT_RECEIPTS_TIME })]);

    expect(holdingByKey('BTC:funding')).toBeUndefined();
    expect(result.complete).toBe(false);
  });

  it('creates the Funding wallet for a Funding Pay receive beside a capital deposit stored on Spot', async () => {
    await importCapitalDeposit('1', 50_000_000, BEFORE_SPOT_RECEIPTS_TIME);

    const result = await runWalk([
      received({
        transactionId: 'beside',
        transactionTime: BEFORE_SPOT_RECEIPTS_TIME + 3 * MINUTE_MS,
      }),
    ]);

    expect(result).toEqual({ imported: 1, complete: true });
    expect(storedRows().map((row) => row.external_id)).toEqual([
      'acc-1:deposit:1',
      'acc-1:pay:C2C:beside:1',
    ]);
    expect(holdingByKey('BTC:funding')?.balance_minor_units).toBe(0);
  });

  it('keeps both of two same-size Pay receives beside one stored capital deposit, on every run', async () => {
    await importCapitalDeposit('1', 50_000_000, DEPOSIT_TIME);
    const orders = [
      received({ transactionId: 'closer', transactionTime: DEPOSIT_TIME + MINUTE_MS }),
      received({ transactionId: 'farther', transactionTime: DEPOSIT_TIME + 5 * MINUTE_MS }),
    ];

    const first = await runWalk(orders);
    const second = await runWalk(orders);

    expect(first.imported).toBe(2);
    expect(second.imported).toBe(0);
    expect(storedRows().map((row) => row.external_id)).toEqual([
      'acc-1:deposit:1',
      'acc-1:pay:C2C:closer:2',
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
  useRealDatabase();
  const twinDeposit = { id: '1', amount: '0.5', insertTime: DEPOSIT_TIME };

  it('imports a deposit that settles after a Pay row of the same size: both rows stay, on every run', async () => {
    const payOrders = [
      received({ transactionId: 'first', transactionTime: DEPOSIT_TIME + 3 * MINUTE_MS }),
    ];
    await runWalk(payOrders);

    const firstCapital = await runCapitalWalk([twinDeposit]);
    const secondCapital = await runCapitalWalk([twinDeposit]);
    const payAgain = await runWalk(payOrders);

    expect(firstCapital).toEqual({ imported: 1, complete: true });
    expect(secondCapital.imported).toBe(0);
    expect(payAgain.imported).toBe(0);
    expect(storedRows().map((row) => row.external_id)).toEqual([
      'acc-1:deposit:1',
      'acc-1:pay:C2C:first:2',
    ]);
  });
});

describe('the capital cursor beside rows of the other walks on real SQLite', () => {
  useRealDatabase();
  const OLD_DEPOSIT = { id: 'old', amount: '0.5', insertTime: Date.UTC(2019, 2, 1) };

  const withoutCapitalCursor = (): void => {
    mockDatabase
      .prepare("UPDATE holdings SET metadata = ? WHERE id = 'h-spot'")
      .run(JSON.stringify({ binanceAsset: 'BTC' }));
  };

  /** Binance answering as it does: the deposits that fall in the window asked for. */
  const depositServer =
    (deposits: BinanceDeposit[], asked: HistoryWindow[] = []) =>
    async (window: HistoryWindow): Promise<HistoryPage<BinanceDeposit>> => {
      asked.push(window);

      return historyPageOf(
        deposits.filter(
          (deposit) =>
            deposit.insertTime >= window.startTime && deposit.insertTime <= window.endTime,
        ),
      );
    };

  it('reads the capital history from the floor when the only rows on Spot are Pay, Transfer and Earn rows', async () => {
    withoutCapitalCursor();
    await expect(
      runCapitalWalkOver(async () => {
        throw new Error('capital history unavailable');
      }),
    ).rejects.toThrow('capital history unavailable');
    await runWalk([received({ transactionId: 'recent', transactionTime: NOW - 2 * DAY_MS })]);
    await transactionsRepo.addManyDedup(
      ['acc-1:xfer:MAIN_UMFUTURE:7:spot', 'acc-1:earn:reward:flexible:BTC:REWARDS:1:0'].map(
        (externalId) => ({
          holdingId: 'h-spot',
          amountMinorUnits: 10,
          time: NOW - DAY_MS,
          source: 'binance' as const,
          externalId,
          description: 'BTC',
        }),
      ),
    );
    const asked: HistoryWindow[] = [];

    const result = await runCapitalWalkOver(depositServer([depositRecord(OLD_DEPOSIT)], asked));

    expect(asked[0].startTime).toBe(HISTORY_FLOOR_MS);
    expect(result.imported).toBe(1);
    expect(storedRows().map((row) => row.external_id)).toContain('acc-1:deposit:old');
  });

  it('keeps reading the ground behind an account whose capital rows are all it has, after a run whose forward pass stopped', async () => {
    withoutCapitalCursor();
    await importCapitalDeposit('latest', 10, NOW - DAY_MS);
    const stuck = {
      ...depositRecord({ ...OLD_DEPOSIT, insertTime: NOW - DAY_MS + 60_000 }),
      id: '',
      txId: '',
    };
    const behind = depositRecord({ id: 'behind', amount: '0.5', insertTime: NOW - 30 * DAY_MS });
    const server = (asked: HistoryWindow[]) => depositServer([stuck, behind], asked);
    const firstRun: HistoryWindow[] = [];
    const secondRun: HistoryWindow[] = [];

    await runCapitalWalkOver(server(firstRun));
    await runCapitalWalkOver(server(secondRun));

    const earliest = (windows: HistoryWindow[]) => Math.min(...windows.map((w) => w.startTime));
    expect(earliest(firstRun)).toBe(NOW - 89 * DAY_MS);
    expect(earliest(secondRun)).toBe(earliest(firstRun));
    expect(storedRows().map((row) => row.external_id)).toContain('acc-1:deposit:behind');
  });

  it('starts at the newest stored withdrawal of an account that has no capital cursor, beside a newer Pay row', async () => {
    withoutCapitalCursor();
    await transactionsRepo.addManyDedup([
      {
        holdingId: 'h-spot',
        amountMinorUnits: -10,
        time: NOW - 5 * DAY_MS,
        source: 'binance',
        externalId: 'acc-1:withdraw:w1',
        description: 'BTC',
      },
    ]);
    await runWalk([received({ transactionId: 'recent', transactionTime: NOW - DAY_MS })]);
    const asked: HistoryWindow[] = [];

    await runCapitalWalkOver(depositServer([], asked));

    expect(Math.min(...asked.map((window) => window.startTime))).toBe(NOW - 89 * DAY_MS);
  });
});
