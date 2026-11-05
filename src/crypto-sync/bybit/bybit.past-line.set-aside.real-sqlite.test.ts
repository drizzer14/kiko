// The valuer unit tests build the holding by hand. This file builds it the way a device does: a
// real `runBalanceSync` over a fake `fetch` writes the balance and its read time, rows come in
// through `addManyDedup` as a history walk would write them, and the line is the one
// `buildNetWorthSeries` draws from what the database holds. A coin set aside by an open order is
// the case where the balance stays old while rows keep arriving.
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
jest.mock('@kiko/crypto-sync/binance/binance.credentials', () => ({
  ...jest.requireActual('@kiko/crypto-sync/binance/binance.credentials'),
  clearCredentials: async () => undefined,
}));
jest.mock('./bybit.credentials', () => ({
  ...jest.requireActual('./bybit.credentials'),
  clearBybitCredentials: async () => undefined,
}));

import { DatabaseSync } from 'node:sqlite';
import type { HoldingRow } from '@kiko/db';
import { holdingsRepo } from '@kiko/holdings/repo';
import { runBalanceSync } from '@kiko/crypto-sync/sync';
import { transactionsRepo } from '@kiko/transactions/repo';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import { disconnectCryptoAccount } from '@kiko/crypto-sync/disconnect';
import { buildNetWorthSeries } from '@kiko/statistics/net-worth-series';
import type { SeriesTransaction } from '@kiko/statistics/holding-value-at';

import {
  FUND_PATH,
  KEY_INFO_PATH,
  UNIFIED_PATH,
  okAnswer,
  routedDeps,
} from './bybit.provider-test-fixtures';
import type { BybitUnifiedCoin } from './bybit.client';
import { type BybitDeps, bybitProvider } from './bybit.provider';
import { fundResult, unifiedCoin, unifiedResult } from './bybit.balance-test-fixtures';

const ACCOUNT_ID = 'acc-1';
const HOLDING_KEY = 'BTC:unified';
const ONE_COIN = 100_000_000;
const FIFTH_OF_A_COIN = 20_000_000;

// A local calendar day of January 2026 at an hour, built from local fields: the line samples at
// local midnight, so no fixed-millisecond offset may stand for a day.
const at = (day: number, hour = 12): number => new Date(2026, 0, 1 + day, hour).getTime();

const BALANCE_OF_ONE = [unifiedCoin('BTC', '1')];
const BALANCE_OF_EIGHT_TENTHS = [unifiedCoin('BTC', '0.8')];
// The fill took 0.2 and 0.1 of the rest is held for an open order, so the coin is set aside and
// the 0.8 it shows is never written.
const SET_ASIDE = [unifiedCoin('BTC', '0.8', { locked: '0.1' })];

const depsAt = (time: number, coins: BybitUnifiedCoin[]): BybitDeps => ({
  ...routedDeps({
    [KEY_INFO_PATH]: okAnswer({}),
    [UNIFIED_PATH]: okAnswer(unifiedResult(coins)),
    [FUND_PATH]: okAnswer(fundResult([])),
  }).deps,
  now: () => time,
});

const readAt = (time: number, coins: BybitUnifiedCoin[]): ReturnType<typeof runBalanceSync> =>
  runBalanceSync(bybitProvider, depsAt(time, coins), {
    targetAccountId: ACCOUNT_ID,
    now: () => time,
  });

const storedHolding = async (): Promise<HoldingRow> => {
  const [holding] = await holdingsRepo.listByAccountQuery(ACCOUNT_ID);

  if (holding === undefined) {
    throw new Error('the first read should have written the holding');
  }

  return holding;
};

// A fill of 0.2 as a history walk would write it: a Bybit row that never moves the balance.
const fillAt = async (time: number): Promise<void> => {
  const { id } = await storedHolding();

  await transactionsRepo.addManyDedup([
    {
      holdingId: id,
      amountMinorUnits: -FIFTH_OF_A_COIN,
      time,
      source: 'bybit',
      externalId: `${ACCOUNT_ID}:fill:${time}`,
    },
  ]);
};

// The net-worth line at local midnight of each day from `firstDay` to `lastDay`, in coins.
const lineFrom = async (firstDay: number, lastDay: number): Promise<number[]> => {
  const holding = await storedHolding();
  const rows = mockDatabase
    .prepare(
      'SELECT time, amount_minor_units AS amountMinorUnits, source FROM transactions WHERE holding_id = ?',
    )
    .all(holding.id) as SeriesTransaction[];
  const { points } = buildNetWorthSeries({
    holdings: [holding],
    transactionsByHolding: new Map([[holding.id, rows]]),
    historyRows: [],
    baseCurrency: 'BTC',
    range: { from: at(firstDay, 0), to: at(lastDay, 0) },
  });

  return points.map(({ amount }) => amount);
};

beforeEach(() => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('PRAGMA foreign_keys = ON;');
  mockDatabase
    .prepare("INSERT INTO accounts (id, name, kind) VALUES (?, 'Bybit', 'crypto')")
    .run(ACCOUNT_ID);
});

describe('the line of a Bybit holding whose balance is older than its rows, on real SQLite', () => {
  it('row 2, a fill after the read counts once the next read holds it', async () => {
    await readAt(at(0, 10), BALANCE_OF_ONE);
    await fillAt(at(1, 9));

    expect(await lineFrom(-1, 3)).toEqual([1, 1, 1, 1, 1]);

    await readAt(at(2, 10), BALANCE_OF_EIGHT_TENTHS);

    expect(await lineFrom(-1, 3)).toEqual([1, 1, 0.8, 0.8, 0.8]);
  });

  it('row 3, a fill older than the read that arrives after it moves the line from its own day', async () => {
    await readAt(at(0, 10), BALANCE_OF_ONE);
    await readAt(at(2, 10), BALANCE_OF_EIGHT_TENTHS);

    expect(await lineFrom(-1, 3)).toEqual([0.8, 0.8, 0.8, 0.8, 0.8]);

    await fillAt(at(1, 9));

    expect(await lineFrom(-1, 3)).toEqual([1, 1, 0.8, 0.8, 0.8]);
  });

  it('row 8, a disconnect after a fill keeps the read time and the line flat at the read balance', async () => {
    await readAt(at(0, 10), BALANCE_OF_ONE);
    await readAt(at(1, 8), SET_ASIDE);
    await fillAt(at(1, 9));

    await disconnectCryptoAccount(ACCOUNT_ID, 'bybit');

    const holding = await storedHolding();

    expect(holding.metadata).toEqual({ bybitAsset: HOLDING_KEY, balanceReadAt: at(0, 10) });
    expect(holding.balanceMinorUnits).toBe(ONE_COIN);
    expect(await lineFrom(-1, 3)).toEqual([1, 1, 1, 1, 1]);
  });

  it('row 10, a reconnect that still sets the coin aside keeps the read time and the line', async () => {
    await readAt(at(0, 10), BALANCE_OF_ONE);
    await readAt(at(1, 8), SET_ASIDE);
    await fillAt(at(1, 9));
    await disconnectCryptoAccount(ACCOUNT_ID, 'bybit');

    await readAt(at(2, 10), SET_ASIDE);

    const holding = await storedHolding();

    expect(holding.metadata).toEqual({ bybitAsset: HOLDING_KEY, balanceReadAt: at(0, 10) });
    expect(holding.balanceMinorUnits).toBe(ONE_COIN);
    expect(await lineFrom(-1, 3)).toEqual([1, 1, 1, 1, 1]);
  });

  it('row 11, the first good read after that reconnect counts the fill', async () => {
    await readAt(at(0, 10), BALANCE_OF_ONE);
    await readAt(at(1, 8), SET_ASIDE);
    await fillAt(at(1, 9));
    await disconnectCryptoAccount(ACCOUNT_ID, 'bybit');
    await readAt(at(2, 10), SET_ASIDE);

    await readAt(at(3, 10), BALANCE_OF_EIGHT_TENTHS);

    const holding = await storedHolding();

    expect(holding.metadata).toEqual({
      bybitAsset: HOLDING_KEY,
      syncedAt: at(3, 10),
      balanceReadAt: at(3, 10),
    });
    expect(await lineFrom(-1, 4)).toEqual([1, 1, 0.8, 0.8, 0.8, 0.8]);
  });

  it('row 13, a fill written after the read by the walk of the same run counts from the next read', async () => {
    await readAt(at(1, 10), BALANCE_OF_ONE);
    await fillAt(at(1, 10) + 60_000);

    expect(await lineFrom(0, 3)).toEqual([1, 1, 1, 1]);

    await readAt(at(2, 10), BALANCE_OF_EIGHT_TENTHS);

    expect(await lineFrom(0, 3)).toEqual([1, 0.8, 0.8, 0.8]);
  });
});
