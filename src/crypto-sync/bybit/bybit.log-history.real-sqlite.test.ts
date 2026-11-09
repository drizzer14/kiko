// The unit tests in `bybit.log-history.test.ts` fake the repositories. This file runs the log walk
// over the REAL repositories on a real `node:sqlite` engine (the shipped migrations): the case is a
// coin sold out, which has no holding to write to. No page with a spot row was read live: the rows
// are built on the docs page's TRADE sample.
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
import { holdingsRepo } from '@kiko/holdings/repo';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import { seedWalkMarks, walkMarksOf } from '@kiko/test-support/walk-marks';

import { syncBybitLogHistory } from './bybit.log-history';
import { fakeBybit } from './bybit.capital-test-fixtures';
import { createBybitHistoryRun } from './bybit.history-budget';
import { API_KEY, NOW, SECRET } from './bybit.client-test-fixtures';
import { entryAt, quoteLegAt, spotAt } from './bybit.log-test-fixtures';

const ACCOUNT_ID = 'acc-1';
const AT = NOW - 2 * DAY_MS;
const HALF_OF_A_COIN = 50_000_000;
const TWENTY_THOUSAND_USDT = 2_000_000_000_000;

const walkOver = (bybit: ReturnType<typeof fakeBybit>) =>
  syncBybitLogHistory(
    {
      targetAccountId: ACCOUNT_ID,
      run: createBybitHistoryRun({ now: () => NOW, sleep: async () => undefined }),
    },
    {
      now: () => NOW,
      fetchImpl: bybit.fetchImpl,
      readCredentials: async () => ({ apiKey: API_KEY, secret: SECRET }),
    },
  );

type StoredRow = {
  external_id: string;
  holding_id: string;
  amount_minor_units: number;
  exchange_pair_id: string | null;
  exchange_counterpart_holding_id: string | null;
  operation: string | null;
};

const storedRows = (): StoredRow[] =>
  mockDatabase
    .prepare(
      `SELECT external_id, holding_id, amount_minor_units, exchange_pair_id,
              exchange_counterpart_holding_id, operation
         FROM transactions ORDER BY amount_minor_units`,
    )
    .all() as StoredRow[];

const holdingKeyed = async (key: string) =>
  (await holdingsRepo.listByAccountQuery(ACCOUNT_ID)).find(
    (holding) => (holding.metadata as { bybitAsset?: string } | null)?.bybitAsset === key,
  );

const loggedKinds = (): string[] => {
  const row = mockDatabase
    .prepare('SELECT exchange_state FROM sync_state WHERE account_id = ?')
    .get(ACCOUNT_ID) as { exchange_state: string };

  return (JSON.parse(row.exchange_state) as { logKinds?: string[] }).logKinds ?? [];
};

beforeEach(() => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('PRAGMA foreign_keys = ON;');
  mockDatabase
    .prepare(
      "INSERT INTO accounts (id, name, kind, institution) VALUES (?, 'Bybit', 'crypto', 'bybit')",
    )
    .run(ACCOUNT_ID);
  seedWalkMarks(mockDatabase, ACCOUNT_ID, 'log', { cursor: NOW - 3 * DAY_MS });
});

describe('the log walk on real SQLite', () => {
  it('a coin with no holding gets one at zero, and its past is on the line', async () => {
    const bybit = fakeBybit();
    bybit.world.log = [
      spotAt(AT, { id: 'sell', orderId: 'order-1', qty: '-0.5', fee: '0', change: '-0.5' }),
      quoteLegAt(AT, {
        id: 'receive',
        orderId: 'order-1',
        qty: '20000',
        fee: '0',
        change: '20000',
      }),
    ];

    expect(await holdingsRepo.listByAccountQuery(ACCOUNT_ID)).toEqual([]);

    const result = await walkOver(bybit);
    const coin = await holdingKeyed('BTC:unified');
    const quote = await holdingKeyed('USDT:unified');

    expect(result.imported).toBe(2);
    expect(coin?.balanceMinorUnits).toBe(0);
    expect(quote?.balanceMinorUnits).toBe(0);
    expect(
      storedRows().map((row) => [
        row.external_id,
        row.holding_id,
        row.amount_minor_units,
        row.exchange_pair_id,
        row.exchange_counterpart_holding_id,
        row.operation,
      ]),
    ).toEqual([
      [
        `acc-1:log:sell:TRADE:${AT}:BTC`,
        coin?.id,
        -HALF_OF_A_COIN,
        'acc-1:trade:order-1:BTCUSDT',
        quote?.id,
        'trade',
      ],
      [
        `acc-1:log:receive:TRADE:${AT}:USDT`,
        quote?.id,
        TWENTY_THOUSAND_USDT,
        'acc-1:trade:order-1:BTCUSDT',
        coin?.id,
        'trade',
      ],
    ]);
    // The past of the coin is its balance less its rows: the half coin it held before the sale.
    expect((coin?.balanceMinorUnits ?? 0) - -HALF_OF_A_COIN).toBe(HALF_OF_A_COIN);
    expect(walkMarksOf(mockDatabase, ACCOUNT_ID, 'log').cursor).toBe(NOW);
  });

  it('a convert shown in the log writes no row from the log, and names its kind', async () => {
    const bybit = fakeBybit();
    bybit.world.log = [
      entryAt(AT, 'CURRENCY_SELL', { currency: 'BTC', qty: '-0.5', change: '-0.5', fee: '0' }),
      entryAt(AT + 1_000, 'CURRENCY_BUY', { currency: 'ETH', qty: '8', change: '8', fee: '0' }),
    ];

    const result = await walkOver(bybit);

    expect(result.imported).toBe(0);
    expect(storedRows()).toEqual([]);
    expect(await holdingsRepo.listByAccountQuery(ACCOUNT_ID)).toEqual([]);
    expect(loggedKinds()).toEqual(['convertEntries']);
  });

  it('a log walk run twice over one trade writes it once', async () => {
    const bybit = fakeBybit();
    bybit.world.log = [spotAt(AT, { id: 'once' })];

    await walkOver(bybit);
    const second = await walkOver(bybit);

    expect(second.imported).toBe(0);
    expect(storedRows()).toHaveLength(1);
  });
});
