// The unit tests in `binance.convert-history.test.ts` fake the repos. This file runs the Convert
// walk over the REAL repos on a real `node:sqlite` engine (the shipped migrations): the legs of a
// conversion land on Funding holdings created at zero and stay out of the statistics, a second
// run dedupes on the `(source, external_id)` key, and the not-imported list holds a refused
// conversion once, until a disconnect clears it.
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
import { seedWalkMarks } from '@kiko/test-support/walk-marks';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import { disconnectCryptoAccount } from '@kiko/crypto-sync/disconnect';
import { parseExchangeState } from '@kiko/crypto-sync/exchange/walk-state';
import { exchangeExcludedTransactionIds } from '@kiko/statistics/exchange-exclusion';

import { NOW } from './binance.pay-test-fixtures';
import { createBinanceHistoryRun } from './binance.history-budget';
import { syncBinanceConvertHistory } from './binance.convert-history';
import { convertRecordOf, convertServerOf } from './binance.convert-test-fixtures';

const ACCOUNT_ID = 'acc-1';
const HOUR_MS = 3_600_000;

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
  seedWalkMarks(rawDatabase, ACCOUNT_ID, 'convert', { cursor: NOW - HOUR_MS });

  return rawDatabase;
};

const runWalk = (fetchConvertHistory: ReturnType<typeof convertServerOf>) =>
  syncBinanceConvertHistory(
    {
      targetAccountId: ACCOUNT_ID,
      run: createBinanceHistoryRun({ now: () => NOW, sleep: async () => undefined }),
    },
    {
      now: () => NOW,
      readCredentials: async () => ({ apiKey: 'api-key', secret: 'secret' }),
      fetchConvertHistory,
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

const notImportedOf = (): string[] => {
  const state = parseExchangeState(
    (
      mockDatabase
        .prepare("SELECT exchange_state FROM sync_state WHERE account_id = 'acc-1'")
        .get() as { exchange_state: string }
    ).exchange_state,
  );

  return state.kind === 'parsed' ? state.notImported : [];
};

beforeEach(() => {
  mockDatabase = openDatabase();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('the Convert walk on real SQLite', () => {
  it('lands a Funding conversion on Funding holdings created at zero, out of the statistics', async () => {
    const result = await runWalk(convertServerOf([convertRecordOf()]));

    expect(result.imported).toBe(2);
    expect(holdingBalances()).toEqual({
      'Binance Funding · UAH': 0,
      'Binance Funding · USDT': 0,
    });
    expect(
      storedRows().map((row) => [row.holding_name, row.amount_minor_units, row.operation]),
    ).toEqual([
      ['Binance Funding · UAH', -100_000, 'convert'],
      ['Binance Funding · USDT', 2_410_000_000, 'convert'],
    ]);
    expect(storedRows().every((row) => row.exchange_pair_id === 'acc-1:convert:order-1')).toBe(
      true,
    );
    expect(excludedIds().size).toBe(2);
  });

  it('lands the tracked leg of a conversion into an untracked coin alone, out of the statistics', async () => {
    await runWalk(
      convertServerOf([
        convertRecordOf({ fromAsset: 'USDT', fromAmount: '5', toAsset: 'PEPE', toAmount: '9' }),
      ]),
    );

    const [row] = storedRows();
    expect(storedRows()).toHaveLength(1);
    expect(row).toMatchObject({
      holding_name: 'Binance Funding · USDT',
      amount_minor_units: -500_000_000,
      exchange_pair_id: null,
      exchange_counterpart_holding_id: null,
      untracked_counterpart: 'asset:PEPE',
      operation: 'convert',
    });
    expect(excludedIds()).toEqual(new Set([row.id]));
  });

  it('keeps two rows when a second run reads the same conversion again', async () => {
    const server = convertServerOf([convertRecordOf()]);

    await runWalk(server);
    const second = await runWalk(server);

    expect(second.imported).toBe(0);
    expect(storedRows()).toHaveLength(2);
  });

  it('holds a refused conversion once, and lists it once again after a disconnect and a new walk', async () => {
    const refused = convertRecordOf({ walletType: 'MAIN' });
    const server = convertServerOf([refused]);
    const entry = `convert-unrecognized:order-1:${refused.createTime}`;

    await runWalk(server);
    await runWalk(server);

    expect(notImportedOf()).toEqual([entry]);
    expect(storedRows()).toEqual([]);

    await disconnectCryptoAccount(ACCOUNT_ID, 'binance');

    expect(notImportedOf()).toEqual([]);

    mockDatabase.exec("UPDATE accounts SET institution = 'binance' WHERE id = 'acc-1'");
    seedWalkMarks(mockDatabase, ACCOUNT_ID, 'convert', { cursor: NOW - HOUR_MS });
    await runWalk(server);

    expect(notImportedOf()).toEqual([entry]);
  });
});
