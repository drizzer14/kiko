// The unit tests in `binance.dust-history.test.ts` fake the repos. This file runs the dust read
// over the REAL repos on a real `node:sqlite` engine (the shipped migrations): the legs of a dust
// conversion land on the Spot holdings, a holding that is missing is created at zero first, every
// leg stays out of the statistics, and a second run dedupes on the `(source, external_id)` key.
let mockDatabase: DatabaseSync;
jest.mock('@kiko/db/client', () => {
  const actual = jest.requireActual('@kiko/db/client');
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { ...actual, database: client.database, write: client.write };
});
jest.mock('./binance.credentials', () => ({
  clearCredentials: async () => undefined,
}));

import { DatabaseSync } from 'node:sqlite';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import { parseExchangeState } from '@kiko/crypto-sync/exchange/walk-state';
import { exchangeExcludedTransactionIds } from '@kiko/statistics/exchange-exclusion';

import { NOW } from './binance.pay-test-fixtures';
import { coinHoldingName } from './binance.holding-keys';
import { syncBinanceDustHistory } from './binance.dust-history';
import type { BinanceDustRecord } from './binance.history-client';
import { createBinanceHistoryRun } from './binance.history-budget';
import { dustEntryOf, dustPageOf, dustRecordOf } from './binance.dust-test-fixtures';

const ACCOUNT_ID = 'acc-1';
const TRX_BALANCE = 5_000;
const BNB_BALANCE = 1_000;
const DOGE_BALANCE = 7_000;

type StoredRow = {
  id: string;
  external_id: string;
  amount_minor_units: number;
  holding_name: string;
  exchange_counterpart_holding_id: string | null;
  exchange_pair_id: string | null;
  untracked_counterpart: string | null;
  operation: string | null;
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

  return rawDatabase;
};

const seedSpotHolding = (coin: 'TRX' | 'BNB' | 'DOGE', balance: number): void => {
  mockDatabase
    .prepare(
      `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units, metadata)
       VALUES (?, 'acc-1', ?, 'crypto_asset', ?, ?, ?)`,
    )
    .run(
      `h-${coin}`,
      coinHoldingName(coin, 'spot'),
      coin,
      balance,
      JSON.stringify({ binanceAsset: coin }),
    );
};

const seedSpotHoldings = (): void => {
  seedSpotHolding('TRX', TRX_BALANCE);
  seedSpotHolding('BNB', BNB_BALANCE);
  seedSpotHolding('DOGE', DOGE_BALANCE);
};

const runRead = (...records: BinanceDustRecord[]) =>
  syncBinanceDustHistory(
    {
      targetAccountId: ACCOUNT_ID,
      run: createBinanceHistoryRun({ now: () => NOW, sleep: async () => undefined }),
    },
    {
      now: () => NOW,
      readCredentials: async () => ({ apiKey: 'api-key', secret: 'secret' }),
      fetchDustHistory: async () => dustPageOf(records),
    },
  );

const storedRows = (): StoredRow[] =>
  mockDatabase
    .prepare(
      `SELECT transactions.id, external_id, amount_minor_units, holdings.name AS holding_name,
              exchange_counterpart_holding_id, exchange_pair_id, untracked_counterpart, operation
         FROM transactions JOIN holdings ON holdings.id = transactions.holding_id
         ORDER BY external_id`,
    )
    .all() as StoredRow[];

const excludedIds = (): Set<string> =>
  exchangeExcludedTransactionIds(
    storedRows().map((row) => ({
      id: row.id,
      exchangeCounterpartHoldingId: row.exchange_counterpart_holding_id,
      untrackedCounterpart: row.untracked_counterpart,
    })),
  );

const holdingBalances = (): Record<string, number> =>
  Object.fromEntries(
    (
      mockDatabase.prepare('SELECT name, balance_minor_units FROM holdings').all() as {
        name: string;
        balance_minor_units: number;
      }[]
    ).map((holding) => [holding.name, holding.balance_minor_units]),
  );

const untrackedOf = (): string[] => {
  const state = parseExchangeState(
    (
      mockDatabase
        .prepare("SELECT exchange_state FROM sync_state WHERE account_id = 'acc-1'")
        .get() as { exchange_state: string }
    ).exchange_state,
  );

  return state.kind === 'parsed' ? state.untrackedCoins.history : [];
};

const TWO_COINS = dustRecordOf({
  entries: [dustEntryOf(), dustEntryOf({ fromAsset: 'DOGE', amount: '0.0002' })],
});

beforeEach(() => {
  mockDatabase = openDatabase();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('the dust read on real SQLite', () => {
  it('lands a two-coin record on the Spot holdings, out of the statistics, balances untouched', async () => {
    seedSpotHoldings();

    const result = await runRead(TWO_COINS);

    expect(result.imported).toBe(4);
    expect(
      storedRows().map((row) => [row.holding_name, row.amount_minor_units, row.operation]),
    ).toEqual([
      ['Binance Spot · BNB', 4410, 'dust'],
      ['Binance Spot · DOGE', -2, 'dust'],
      ['Binance Spot · BNB', 4410, 'dust'],
      ['Binance Spot · TRX', -9, 'dust'],
    ]);
    expect(holdingBalances()).toEqual({
      'Binance Spot · TRX': TRX_BALANCE,
      'Binance Spot · BNB': BNB_BALANCE,
      'Binance Spot · DOGE': DOGE_BALANCE,
    });
    expect(excludedIds().size).toBe(4);
  });

  it('names each pair by the record and the coin, both legs on it', async () => {
    seedSpotHoldings();

    await runRead(TWO_COINS);

    expect(storedRows().map((row) => row.exchange_pair_id)).toEqual([
      'acc-1:dust:record-1:DOGE',
      'acc-1:dust:record-1:DOGE',
      'acc-1:dust:record-1:TRX',
      'acc-1:dust:record-1:TRX',
    ]);
  });

  it('creates the Spot holdings at zero when none is stored, and lands the pair on them', async () => {
    const result = await runRead(dustRecordOf());

    expect(result.imported).toBe(2);
    expect(holdingBalances()).toEqual({
      'Binance Spot · TRX': 0,
      'Binance Spot · BNB': 0,
    });
    expect(
      storedRows().map((row) => [row.holding_name, row.amount_minor_units, row.operation]),
    ).toEqual([
      ['Binance Spot · BNB', 4410, 'dust'],
      ['Binance Spot · TRX', -9, 'dust'],
    ]);
    expect(excludedIds().size).toBe(2);
  });

  it('lands the BNB leg of an untracked coin alone, out of the statistics, and lists the coin', async () => {
    seedSpotHolding('BNB', BNB_BALANCE);

    await runRead(dustRecordOf({ entries: [dustEntryOf({ fromAsset: 'PEPE' })] }));

    const [row] = storedRows();
    expect(storedRows()).toHaveLength(1);
    expect(row).toMatchObject({
      holding_name: 'Binance Spot · BNB',
      amount_minor_units: 4410,
      exchange_pair_id: null,
      exchange_counterpart_holding_id: null,
      untracked_counterpart: 'asset:PEPE',
      operation: 'dust',
    });
    expect(excludedIds()).toEqual(new Set([row?.id]));
    expect(untrackedOf()).toEqual(['PEPE']);
  });

  it('counts no new row on a second run that reads the same records', async () => {
    await runRead(TWO_COINS);
    const second = await runRead(TWO_COINS);

    expect(second.imported).toBe(0);
    expect(storedRows()).toHaveLength(4);
  });

  it('imports only the new record when the newest hundred slide by one', async () => {
    const records = Array.from({ length: 101 }, (_unused, index) =>
      dustRecordOf({ transId: `record-${index + 1}` }),
    );

    const first = await runRead(...records.slice(0, 100));
    const second = await runRead(...records.slice(1));

    expect(first.imported).toBe(200);
    expect(second.imported).toBe(2);
    expect(storedRows()).toHaveLength(202);
    expect(
      storedRows()
        .filter((row) => row.external_id.includes(':record-101:'))
        .map((row) => row.holding_name),
    ).toEqual(['Binance Spot · BNB', 'Binance Spot · TRX']);
  });
});
