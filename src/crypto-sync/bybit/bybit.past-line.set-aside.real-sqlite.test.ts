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
import { Money } from '@kiko/currency/money';
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
const TENTH_OF_A_COIN = 10_000_000;
const THREE_TENTHS_OF_A_COIN = 30_000_000;
const HALF_OF_A_COIN = 50_000_000;

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

// A row as a history walk would write it: a Bybit row that never moves the balance.
const walkRowAt = async (time: number, amountMinorUnits: number): Promise<void> => {
  const { id } = await storedHolding();

  await transactionsRepo.addManyDedup([
    {
      holdingId: id,
      amountMinorUnits,
      time,
      source: 'bybit',
      externalId: `${ACCOUNT_ID}:fill:${time}`,
    },
  ]);
};

const fillAt = (time: number): Promise<void> => walkRowAt(time, -FIFTH_OF_A_COIN);

// A row the user types, which moves the balance as it is written. Returns the row's id.
const typedRowAt = async (time: number, amountMinorUnits: number): Promise<string> => {
  const { id } = await storedHolding();

  return transactionsRepo.recordManual({ holdingId: id, amountMinorUnits, time });
};

const idsOf = (...rowIds: string[]): string[] => [...rowIds].sort();

// The net-worth line at local midnight of each day from `firstDay` to `lastDay`, in coins.
const lineFrom = async (firstDay: number, lastDay: number): Promise<number[]> => {
  const holding = await storedHolding();
  const rows = mockDatabase
    .prepare(
      'SELECT id, time, amount_minor_units AS amountMinorUnits, source FROM transactions WHERE holding_id = ?',
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

describe('the line of a Bybit holding whose read overwrote rows the user typed, on real SQLite', () => {
  const BALANCE_OF_A_TENTH = [unifiedCoin('BTC', '0.1')];
  const BALANCE_OF_ONE_AND_A_HALF = [unifiedCoin('BTC', '1.5')];
  const BALANCE_OF_HALF = [unifiedCoin('BTC', '0.5')];

  // Read 0.1, disconnect, type +0.5 (the balance moves to 0.6), reconnect, read 0.1 again.
  const typedRowThenReadOfATenth = async (): Promise<string> => {
    await readAt(at(0, 10), BALANCE_OF_A_TENTH);
    await disconnectCryptoAccount(ACCOUNT_ID, 'bybit');

    const typedRowId = await typedRowAt(at(1, 9), HALF_OF_A_COIN);

    await readAt(at(2, 10), BALANCE_OF_A_TENTH);

    return typedRowId;
  };

  it('row 15, a row the read overwrote is left off the line, and Home shows the read', async () => {
    const typedRowId = await typedRowThenReadOfATenth();
    const holding = await storedHolding();

    expect(await lineFrom(-1, 3)).toEqual([0.1, 0.1, 0.1, 0.1, 0.1]);
    expect(holding.balanceMinorUnits).toBe(TENTH_OF_A_COIN);
    expect(holding.metadata).toEqual({
      bybitAsset: HOLDING_KEY,
      syncedAt: at(2, 10),
      balanceReadAt: at(2, 10),
      overwrittenRowIds: [typedRowId],
    });
  });

  it('row 15, the other sign: a typed row of -0.5 that the read overwrote leaves the line at 1', async () => {
    await readAt(at(0, 10), BALANCE_OF_ONE);
    await disconnectCryptoAccount(ACCOUNT_ID, 'bybit');
    await typedRowAt(at(1, 9), -HALF_OF_A_COIN);

    await readAt(at(2, 10), BALANCE_OF_ONE);

    expect(await lineFrom(-1, 3)).toEqual([1, 1, 1, 1, 1]);
  });

  it('row 18, a second read replaces the list with the row it held and the row typed since', async () => {
    const firstRowId = await typedRowThenReadOfATenth();

    await disconnectCryptoAccount(ACCOUNT_ID, 'bybit');

    const secondRowId = await typedRowAt(at(3, 9), THREE_TENTHS_OF_A_COIN);

    expect((await storedHolding()).metadata).toEqual({
      bybitAsset: HOLDING_KEY,
      balanceReadAt: at(2, 10),
      overwrittenRowIds: [firstRowId],
    });
    expect(await lineFrom(0, 4)).toEqual([0.1, 0.1, 0.1, 0.4, 0.4]);

    await readAt(at(4, 10), BALANCE_OF_A_TENTH);

    expect((await storedHolding()).metadata).toEqual({
      bybitAsset: HOLDING_KEY,
      syncedAt: at(4, 10),
      balanceReadAt: at(4, 10),
      overwrittenRowIds: idsOf(firstRowId, secondRowId),
    });
    expect(await lineFrom(0, 4)).toEqual([0.1, 0.1, 0.1, 0.1, 0.1]);
  });

  it('row 19, a coin set aside keeps its list and its read time, and the row typed since counts', async () => {
    const firstRowId = await typedRowThenReadOfATenth();

    await disconnectCryptoAccount(ACCOUNT_ID, 'bybit');
    await typedRowAt(at(3, 9), THREE_TENTHS_OF_A_COIN);

    await readAt(at(4, 10), SET_ASIDE);

    const holding = await storedHolding();

    expect(holding.metadata).toEqual({
      bybitAsset: HOLDING_KEY,
      balanceReadAt: at(2, 10),
      overwrittenRowIds: [firstRowId],
    });
    expect(holding.balanceMinorUnits).toBe(TENTH_OF_A_COIN + THREE_TENTHS_OF_A_COIN);
    expect(await lineFrom(0, 4)).toEqual([0.1, 0.1, 0.1, 0.4, 0.4]);
  });

  it('row 20, a typed row for a move that really arrived is left off the line as well', async () => {
    await readAt(at(0, 10), BALANCE_OF_ONE);
    await disconnectCryptoAccount(ACCOUNT_ID, 'bybit');
    await typedRowAt(at(1, 9), HALF_OF_A_COIN);

    await readAt(at(2, 10), BALANCE_OF_ONE_AND_A_HALF);

    expect(await lineFrom(-1, 3)).toEqual([1.5, 1.5, 1.5, 1.5, 1.5]);
  });

  it('row 20, the other sign: a typed row of -0.5 for a move that really left', async () => {
    await readAt(at(0, 10), BALANCE_OF_ONE);
    await disconnectCryptoAccount(ACCOUNT_ID, 'bybit');
    await typedRowAt(at(1, 9), -HALF_OF_A_COIN);

    await readAt(at(2, 10), BALANCE_OF_HALF);

    expect(await lineFrom(-1, 3)).toEqual([0.5, 0.5, 0.5, 0.5, 0.5]);
  });

  it('row 21, a walk that also wrote the move counts it once, from its own day', async () => {
    await readAt(at(0, 10), BALANCE_OF_ONE);
    await disconnectCryptoAccount(ACCOUNT_ID, 'bybit');
    await typedRowAt(at(1, 9), HALF_OF_A_COIN);
    await walkRowAt(at(1, 8), HALF_OF_A_COIN);

    await readAt(at(2, 10), BALANCE_OF_ONE_AND_A_HALF);

    expect(await lineFrom(-1, 3)).toEqual([1, 1, 1.5, 1.5, 1.5]);
  });

  it('row 22, an Exchange leg on the coin is left off the line and the leg on cash is not', async () => {
    mockDatabase
      .prepare("INSERT INTO accounts (id, name, kind) VALUES ('acc-cash', 'Cash', 'cash')")
      .run();
    mockDatabase
      .prepare(
        `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units)
         VALUES ('cash-usd', 'acc-cash', 'Dollars', 'cash', 'USD', 0)`,
      )
      .run();
    await readAt(at(0, 10), BALANCE_OF_ONE);
    await disconnectCryptoAccount(ACCOUNT_ID, 'bybit');

    const coin = await storedHolding();

    await transactionsRepo.recordExchange({
      sourceHoldingId: coin.id,
      valueOutMinorUnits: HALF_OF_A_COIN,
      destinationHoldingId: 'cash-usd',
      destinationType: 'cash',
      valueInMinorUnits: 10_000,
      time: at(1, 9),
    });
    await readAt(at(2, 10), BALANCE_OF_ONE);

    const legOnCoin = mockDatabase
      .prepare('SELECT id FROM transactions WHERE holding_id = ?')
      .all(coin.id) as { id: string }[];
    const cash = mockDatabase
      .prepare('SELECT balance_minor_units AS balance, metadata FROM holdings WHERE id = ?')
      .get('cash-usd');

    expect(await lineFrom(-1, 3)).toEqual([1, 1, 1, 1, 1]);
    expect(legOnCoin).toHaveLength(1);
    expect((await storedHolding()).metadata).toMatchObject({
      overwrittenRowIds: [legOnCoin[0]?.id],
    });
    expect(cash).toEqual({ balance: 10_000, metadata: null });
  });

  it('row 23, a hand-set balance that the read overwrote is left off the line', async () => {
    await readAt(at(0, 10), BALANCE_OF_ONE);
    await disconnectCryptoAccount(ACCOUNT_ID, 'bybit');

    const coin = await storedHolding();

    await holdingsRepo.updateWithBalanceDelta(
      coin.id,
      { balance: Money.of('BTC', ONE_COIN + HALF_OF_A_COIN) },
      at(1, 9),
    );
    await readAt(at(2, 10), BALANCE_OF_ONE);

    const holding = await storedHolding();
    const setRow = mockDatabase
      .prepare('SELECT id FROM transactions WHERE holding_id = ? AND sets_balance = 1')
      .get(coin.id) as { id: string };

    expect(await lineFrom(-1, 3)).toEqual([1, 1, 1, 1, 1]);
    expect(holding.metadata).toMatchObject({ overwrittenRowIds: [setRow.id] });
    expect(holding.balanceSetRowId).toBe(setRow.id);
  });
});
