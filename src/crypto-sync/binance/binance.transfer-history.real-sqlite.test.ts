// The unit tests in `binance.transfer-history.test.ts` fake the repos. This file runs the
// Transfer walk over the REAL repos on a real `node:sqlite` engine (the shipped migrations):
// the legs of a transfer land on the two wallets with their markers, two accounts that share a
// `tranId` keep four rows, the `(source, external_id)` upsert dedupes a second run, and a
// transfer owed as a point imports once it settles.
let mockDatabase: DatabaseSync;
jest.mock('@kiko/db/client', () => {
  const actual = jest.requireActual('@kiko/db/client');
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { ...actual, database: client.database, write: client.write };
});

import { DAY_MS } from '@kiko/dates';
import { DatabaseSync } from 'node:sqlite';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

import type {
  BinanceUniversalTransfer,
  TotalPage,
  UniversalTransferType,
} from './binance.history-client';
import { NOW } from './binance.pay-test-fixtures';
import { createBinanceHistoryRun } from './binance.history-budget';
import { syncBinanceTransferHistory } from './binance.transfer-history';

const CURSOR = NOW - 5 * DAY_MS;

type StoredRow = {
  external_id: string;
  holding_id: string;
  amount_minor_units: number;
  exchange_counterpart_holding_id: string | null;
  exchange_pair_id: string | null;
  untracked_counterpart: string | null;
  description: string;
};

const openDatabase = (): DatabaseSync => {
  const rawDatabase = new DatabaseSync(':memory:');

  applyAllMigrations(rawDatabase);
  rawDatabase.exec('PRAGMA foreign_keys = ON;');

  for (const account of ['acc-1', 'acc-2']) {
    rawDatabase
      .prepare('INSERT INTO accounts (id, name, kind, institution) VALUES (?, ?, ?, ?)')
      .run(account, `Binance ${account}`, 'crypto', 'binance');
    rawDatabase
      .prepare(
        `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units, metadata)
         VALUES (?, ?, 'Binance Spot', 'crypto_asset', 'BTC', 100, ?)`,
      )
      .run(
        `h-spot-${account}`,
        account,
        JSON.stringify({ binanceAsset: 'BTC', binanceTransferHistoryCursor: CURSOR }),
      );
  }

  return rawDatabase;
};

const transferOf = (over: Partial<BinanceUniversalTransfer> = {}): BinanceUniversalTransfer => ({
  asset: 'BTC',
  amount: '0.5',
  type: 'MAIN_FUNDING',
  status: 'CONFIRMED',
  tranId: 'shared-id',
  timestamp: NOW - 2 * DAY_MS,
  ...over,
});

/** Binance answering the given transfers, by type and range (both ends included). */
const fetchOf =
  (transfers: BinanceUniversalTransfer[]) =>
  async (
    _apiKey: string,
    _secret: string,
    query: { type: UniversalTransferType; startTime: number; endTime: number; current: number },
  ): Promise<TotalPage<BinanceUniversalTransfer>> => {
    const rows = transfers.filter(
      (transfer) =>
        transfer.type === query.type &&
        query.startTime <= transfer.timestamp &&
        transfer.timestamp <= query.endTime,
    );

    return {
      rows,
      unreadable: [],
      gathered: rows.length,
      total: rows.length,
      usedUidWeight1m: undefined,
      usedIpWeight1m: undefined,
    };
  };

const runWalk = (accountId: string, transfers: BinanceUniversalTransfer[]) =>
  syncBinanceTransferHistory(
    {
      targetAccountId: accountId,
      run: createBinanceHistoryRun({ now: () => NOW, sleep: async () => undefined }),
    },
    {
      now: () => NOW,
      readCredentials: async () => ({ apiKey: 'api-key', secret: 'secret' }),
      fetchUniversalTransfers: fetchOf(transfers),
    },
  );

const storedRows = (): StoredRow[] =>
  mockDatabase
    .prepare(
      `SELECT external_id, holding_id, amount_minor_units, exchange_counterpart_holding_id,
              exchange_pair_id, untracked_counterpart, description
         FROM transactions ORDER BY external_id`,
    )
    .all() as StoredRow[];

const holdingByKey = (
  accountId: string,
  key: string,
): { id: string; balance_minor_units: number } | undefined =>
  mockDatabase
    .prepare(
      `SELECT id, balance_minor_units FROM holdings
        WHERE account_id = ? AND json_extract(metadata, '$.binanceAsset') = ?`,
    )
    .get(accountId, key) as { id: string; balance_minor_units: number } | undefined;

const spotMetadata = (accountId: string): Record<string, unknown> => {
  const stored = mockDatabase
    .prepare('SELECT metadata FROM holdings WHERE id = ?')
    .get(`h-spot-${accountId}`) as { metadata: string };

  return JSON.parse(stored.metadata);
};

describe('the Transfer walk on real SQLite', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    mockDatabase = openDatabase();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('writes the two legs of a Spot to Funding transfer on their wallets, creating the Funding wallet at zero, each naming the other, one pair id', async () => {
    const result = await runWalk('acc-1', [transferOf()]);

    const funding = holdingByKey('acc-1', 'BTC:funding');
    expect(result).toEqual({ imported: 2, complete: true });
    expect(funding?.balance_minor_units).toBe(0);
    expect(storedRows()).toEqual([
      {
        external_id: 'acc-1:xfer:MAIN_FUNDING:shared-id:BTC',
        holding_id: 'h-spot-acc-1',
        amount_minor_units: -50_000_000,
        exchange_counterpart_holding_id: funding?.id,
        exchange_pair_id: 'acc-1:xfer:MAIN_FUNDING:shared-id',
        untracked_counterpart: null,
        description: '',
      },
      {
        external_id: 'acc-1:xfer:MAIN_FUNDING:shared-id:BTC:funding',
        holding_id: funding?.id,
        amount_minor_units: 50_000_000,
        exchange_counterpart_holding_id: 'h-spot-acc-1',
        exchange_pair_id: 'acc-1:xfer:MAIN_FUNDING:shared-id',
        untracked_counterpart: null,
        description: '',
      },
    ]);
  });

  it('writes a transfer to a wallet Kiko does not track as one leg with its code and no pair', async () => {
    await runWalk('acc-1', [transferOf({ type: 'MAIN_UMFUTURE', tranId: 'fut' })]);

    expect(storedRows()).toEqual([
      {
        external_id: 'acc-1:xfer:MAIN_UMFUTURE:fut:BTC',
        holding_id: 'h-spot-acc-1',
        amount_minor_units: -50_000_000,
        exchange_counterpart_holding_id: null,
        exchange_pair_id: null,
        untracked_counterpart: 'wallet:UMFUTURE',
        description: '',
      },
    ]);
  });

  it('keeps four rows and two pair ids for two accounts whose transfers share a tranId', async () => {
    await runWalk('acc-1', [transferOf()]);
    await runWalk('acc-2', [transferOf()]);

    const rows = storedRows();
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((row) => row.exchange_pair_id))).toEqual(
      new Set(['acc-1:xfer:MAIN_FUNDING:shared-id', 'acc-2:xfer:MAIN_FUNDING:shared-id']),
    );
    expect(rows.filter((row) => row.external_id.startsWith('acc-2:'))).toHaveLength(2);
  });

  it('keeps one row per type for a tranId two types share', async () => {
    await runWalk('acc-1', [transferOf(), transferOf({ type: 'MAIN_UMFUTURE', amount: '0.25' })]);

    expect(storedRows().map((row) => row.external_id)).toEqual([
      'acc-1:xfer:MAIN_FUNDING:shared-id:BTC',
      'acc-1:xfer:MAIN_FUNDING:shared-id:BTC:funding',
      'acc-1:xfer:MAIN_UMFUTURE:shared-id:BTC',
    ]);
  });

  it('imports nothing new on a second identical run, and never moves the funding balance', async () => {
    await runWalk('acc-1', [transferOf()]);
    const funding = holdingByKey('acc-1', 'BTC:funding');
    mockDatabase
      .prepare('UPDATE holdings SET balance_minor_units = 777 WHERE id = ?')
      .run(funding?.id ?? '');

    const second = await runWalk('acc-1', [transferOf()]);

    expect(second.imported).toBe(0);
    expect(storedRows()).toHaveLength(2);
    expect(holdingByKey('acc-1', 'BTC:funding')?.balance_minor_units).toBe(777);
  });

  it('owes a transfer that is still PENDING as a point, imports it once it is CONFIRMED, and takes the point off the list', async () => {
    const at = NOW - 10 * DAY_MS;
    const pending = transferOf({ status: 'PENDING', timestamp: at });

    const first = await runWalk('acc-1', [pending]);

    expect(first.imported).toBe(0);
    expect(storedRows()).toEqual([]);
    expect(spotMetadata('acc-1').binanceTransferPendingOverlap).toEqual([
      { start: at - 1, end: at + 1, kind: 'point', series: 'MAIN_FUNDING' },
    ]);

    const second = await runWalk('acc-1', [{ ...pending, status: 'CONFIRMED' }]);

    expect(second.imported).toBe(2);
    expect(storedRows()).toHaveLength(2);
    expect(spotMetadata('acc-1').binanceTransferPendingOverlap).toEqual([]);
  });
});
