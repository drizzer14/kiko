// The unit tests in `bybit.capital-history.test.ts` fake the repositories. This file runs the
// capital walk over the REAL repositories on a real `node:sqlite` engine (the shipped migrations):
// where a row lands, that no row moves a balance, that the `(source, external_id)` upsert dedupes a
// second run, and that a rolled back deposit takes its row away.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const actual = jest.requireActual('@kiko/db/client');
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { ...actual, database: client.database, write: client.write };
});
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly' },
}));

import { DAY_MS } from '@kiko/dates';
import { DatabaseSync } from 'node:sqlite';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import { seedWalkMarks, walkMarksOf } from '@kiko/test-support/walk-marks';

import { createBybitHistoryRun } from './bybit.history-budget';
import { syncBybitCapitalHistory } from './bybit.capital-history';
import { fakeBybit, served } from './bybit.capital-test-fixtures';
import { API_KEY, NOW, SECRET } from './bybit.client-test-fixtures';
import { depositRow, internalDepositRow, withdrawalRow } from './bybit.history-test-fixtures';

const ACCOUNT = 'acc-1';
const AT = NOW - 2 * DAY_MS;

type StoredRow = { external_id: string; holding_id: string; amount_minor_units: number };

const openDatabase = (): DatabaseSync => {
  const rawDatabase = new DatabaseSync(':memory:');

  applyAllMigrations(rawDatabase);
  rawDatabase.exec('PRAGMA foreign_keys = ON;');
  rawDatabase
    .prepare('INSERT INTO accounts (id, name, kind, institution) VALUES (?, ?, ?, ?)')
    .run(ACCOUNT, 'Bybit', 'crypto', 'bybit');
  rawDatabase
    .prepare(
      `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units, metadata)
       VALUES ('h-unified', ?, 'Bybit Unified · BTC', 'crypto_asset', 'BTC', 100, ?)`,
    )
    .run(ACCOUNT, JSON.stringify({ bybitAsset: 'BTC:unified' }));
  seedWalkMarks(rawDatabase, ACCOUNT, 'capital', { cursor: NOW - 3 * DAY_MS });

  return rawDatabase;
};

const storedRows = (): StoredRow[] =>
  mockDatabase
    .prepare(
      'SELECT external_id, holding_id, amount_minor_units FROM transactions ORDER BY external_id',
    )
    .all() as StoredRow[];

const balances = (): Record<string, number> =>
  Object.fromEntries(
    (
      mockDatabase.prepare('SELECT id, balance_minor_units FROM holdings').all() as {
        id: string;
        balance_minor_units: number;
      }[]
    ).map((holding) => [holding.id, holding.balance_minor_units]),
  );

const fundHolding = (): { id: string; balance_minor_units: number } | undefined =>
  mockDatabase
    .prepare(
      `SELECT id, balance_minor_units FROM holdings
        WHERE account_id = ? AND json_extract(metadata, '$.bybitAsset') = 'BTC:fund'`,
    )
    .get(ACCOUNT) as { id: string; balance_minor_units: number } | undefined;

const walkOver = (bybit: ReturnType<typeof fakeBybit>) =>
  syncBybitCapitalHistory(
    {
      targetAccountId: ACCOUNT,
      run: createBybitHistoryRun({ now: () => NOW, sleep: async () => undefined }),
    },
    {
      now: () => NOW,
      fetchImpl: bybit.fetchImpl,
      readCredentials: async () => ({ apiKey: API_KEY, secret: SECRET }),
    },
  );

describe('the capital walk on real SQLite', () => {
  beforeEach(() => {
    mockDatabase = openDatabase();
  });

  it('every deposit and withdrawal row goes on the FUND holding and moves no balance', async () => {
    const bybit = fakeBybit();
    bybit.world.deposit = [served(AT, depositRow({ coin: 'BTC', successAt: String(AT) }))];
    bybit.world.internal = [
      served(
        AT + 1_000,
        internalDepositRow({ coin: 'BTC', createdTime: String((AT + 1_000) / 1_000) }),
      ),
    ];
    bybit.world.withdraw = [
      served(AT + 2_000, withdrawalRow({ coin: 'BTC', createTime: String(AT + 2_000) })),
    ];

    const result = await walkOver(bybit);

    const fund = fundHolding();
    expect(result.imported).toBe(3);
    expect(fund?.balance_minor_units).toBe(0);
    expect(storedRows().map((row) => row.holding_id)).toEqual([fund?.id, fund?.id, fund?.id]);
    expect(balances()).toEqual({ 'h-unified': 100, [fund?.id ?? '']: 0 });
    expect(walkMarksOf(mockDatabase, ACCOUNT, 'capital').cursor).toBe(NOW);
  });

  it('writes nothing new on a second run over the same records', async () => {
    const bybit = fakeBybit();
    bybit.world.deposit = [served(AT, depositRow({ coin: 'BTC', successAt: String(AT) }))];

    await walkOver(bybit);
    const second = await walkOver(bybit);

    expect(second.imported).toBe(0);
    expect(storedRows()).toHaveLength(1);
  });

  it('removes the row of a rolled back deposit, with or with no time, and moves no balance', async () => {
    const bybit = fakeBybit();
    bybit.world.deposit = [
      served(AT, depositRow({ id: 'with-time', coin: 'BTC', successAt: String(AT) })),
      served(AT + 1_000, depositRow({ id: 'no-time', coin: 'BTC', successAt: String(AT + 1_000) })),
    ];
    await walkOver(bybit);
    const before = balances();

    bybit.world.deposit = [
      served(
        AT,
        depositRow({ id: 'with-time', coin: 'BTC', status: 70011, successAt: String(AT) }),
      ),
      served(AT + 1_000, depositRow({ id: 'no-time', coin: 'BTC', status: 70011, successAt: '' })),
    ];
    await walkOver(bybit);

    expect(storedRows()).toEqual([]);
    expect(balances()).toEqual(before);
  });
});
