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
import { Money, toMajor } from '@kiko/currency/money';
import { runBalanceSync } from '@kiko/crypto-sync/sync';
import type { Currency } from '@kiko/currency/currency';
import { transactionsRepo } from '@kiko/transactions/repo';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import { disconnectCryptoAccount } from '@kiko/crypto-sync/disconnect';
import { buildNetWorthSeries } from '@kiko/statistics/net-worth-series';
import type { SeriesTransaction } from '@kiko/statistics/holding-value-at';
import { netMagnitudeOf, sumReturnsByGroup } from '@kiko/statistics/category-breakdown';

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
const SEVEN_TENTHS_OF_A_COIN = 70_000_000;

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

const storedHolding = async (accountId = ACCOUNT_ID): Promise<HoldingRow> => {
  const [holding] = await holdingsRepo.listByAccountQuery(accountId);

  if (holding === undefined) {
    throw new Error(`account ${accountId} should hold a holding by now`);
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

const editRow = (transactionId: string, amountMinorUnits: number): Promise<void> =>
  transactionsRepo.update({ transactionId, amountMinorUnits, time: at(1, 9) });

const CASH_ACCOUNT_ID = 'acc-cash';
const CASH_ID = 'cash-usd';

// A cash holding on an account of its own: the other holding of a Convert or a split, which no
// read overwrites.
const seedCashHolding = (currency: Currency, balanceMinorUnits: number): void => {
  mockDatabase
    .prepare(`INSERT INTO accounts (id, name, kind) VALUES ('${CASH_ACCOUNT_ID}', 'Cash', 'cash')`)
    .run();
  mockDatabase
    .prepare(
      `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units)
       VALUES ('${CASH_ID}', '${CASH_ACCOUNT_ID}', 'Cash', 'cash', ?, ?)`,
    )
    .run(currency, balanceMinorUnits);
};

const storedRowIds = (): string[] =>
  (mockDatabase.prepare('SELECT id FROM transactions ORDER BY id').all() as { id: string }[]).map(
    ({ id }) => id,
  );

// The net-worth line of one holding at local midnight of each day from `firstDay` to `lastDay`, in
// the holding's own currency.
const lineOfHolding = async (
  holding: HoldingRow,
  baseCurrency: Currency,
  firstDay: number,
  lastDay: number,
): Promise<number[]> => {
  const rows = mockDatabase
    .prepare(
      'SELECT id, time, amount_minor_units AS amountMinorUnits, source FROM transactions WHERE holding_id = ?',
    )
    .all(holding.id) as SeriesTransaction[];
  const { points } = buildNetWorthSeries({
    holdings: [holding],
    transactionsByHolding: new Map([[holding.id, rows]]),
    historyRows: [],
    baseCurrency,
    range: { from: at(firstDay, 0), to: at(lastDay, 0) },
  });

  return points.map(({ amount }) => amount);
};

// The line of the account's one coin, in coins.
const lineFrom = async (firstDay: number, lastDay: number): Promise<number[]> =>
  lineOfHolding(await storedHolding(), 'BTC', firstDay, lastDay);

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
      overwrittenRowIds: [firstRowId, secondRowId].sort(),
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
    seedCashHolding('USD', 0);
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

  it('row 16, deleting a row on the mark moves no balance', async () => {
    const typedRowId = await typedRowThenReadOfATenth();

    await transactionsRepo.remove(typedRowId);

    expect((await storedHolding()).balanceMinorUnits).toBe(TENTH_OF_A_COIN);
    expect(await lineFrom(-1, 3)).toEqual([0.1, 0.1, 0.1, 0.1, 0.1]);
    expect(storedRowIds()).toEqual([]);
  });

  it('row 17, editing a row on the mark moves no balance and keeps its id', async () => {
    const typedRowId = await typedRowThenReadOfATenth();

    for (const amountMinorUnits of [SEVEN_TENTHS_OF_A_COIN, -HALF_OF_A_COIN]) {
      await editRow(typedRowId, amountMinorUnits);

      expect((await storedHolding()).balanceMinorUnits).toBe(TENTH_OF_A_COIN);
      expect(await lineFrom(-1, 3)).toEqual([0.1, 0.1, 0.1, 0.1, 0.1]);
      expect(
        mockDatabase.prepare('SELECT id, amount_minor_units AS amount FROM transactions').all(),
      ).toEqual([{ id: typedRowId, amount: amountMinorUnits }]);
    }
  });

  it('a delete of a row not on the mark is right', async () => {
    await typedRowThenReadOfATenth();
    await disconnectCryptoAccount(ACCOUNT_ID, 'bybit');

    const secondRowId = await typedRowAt(at(3, 9), THREE_TENTHS_OF_A_COIN);

    expect((await storedHolding()).balanceMinorUnits).toBe(
      TENTH_OF_A_COIN + THREE_TENTHS_OF_A_COIN,
    );

    await transactionsRepo.remove(secondRowId);

    expect((await storedHolding()).balanceMinorUnits).toBe(TENTH_OF_A_COIN);
    expect(await lineFrom(0, 4)).toEqual([0.1, 0.1, 0.1, 0.1, 0.1]);
  });

  it('row 29, the id leaves the mark at the next read', async () => {
    const typedRowId = await typedRowThenReadOfATenth();

    await transactionsRepo.remove(typedRowId);

    expect((await storedHolding()).metadata).toMatchObject({ overwrittenRowIds: [typedRowId] });
    expect(await lineFrom(-1, 4)).toEqual([0.1, 0.1, 0.1, 0.1, 0.1, 0.1]);

    await readAt(at(3, 10), BALANCE_OF_A_TENTH);

    const holding = await storedHolding();

    expect(holding.metadata).toEqual({
      bybitAsset: HOLDING_KEY,
      syncedAt: at(3, 10),
      balanceReadAt: at(3, 10),
    });
    expect(holding.balanceMinorUnits).toBe(TENTH_OF_A_COIN);
    expect(await lineFrom(-1, 4)).toEqual([0.1, 0.1, 0.1, 0.1, 0.1, 0.1]);
  });

  it('row 30, a row typed again moves the balance', async () => {
    const deletedRowId = await typedRowThenReadOfATenth();

    await transactionsRepo.remove(deletedRowId);
    await disconnectCryptoAccount(ACCOUNT_ID, 'bybit');

    const typedAgainId = await typedRowAt(at(3, 9), HALF_OF_A_COIN);

    expect(typedAgainId).not.toBe(deletedRowId);
    expect((await storedHolding()).balanceMinorUnits).toBe(TENTH_OF_A_COIN + HALF_OF_A_COIN);
    expect(await lineFrom(0, 4)).toEqual([0.1, 0.1, 0.1, 0.6, 0.6]);

    await readAt(at(4, 10), BALANCE_OF_A_TENTH);

    const holding = await storedHolding();

    expect(holding.metadata).toMatchObject({ overwrittenRowIds: [typedAgainId] });
    expect(holding.balanceMinorUnits).toBe(TENTH_OF_A_COIN);
    expect(await lineFrom(0, 4)).toEqual([0.1, 0.1, 0.1, 0.1, 0.1]);
  });

  it('row 31, a deleted row that a read held leaves the read', async () => {
    await readAt(at(0, 10), BALANCE_OF_ONE);
    await disconnectCryptoAccount(ACCOUNT_ID, 'bybit');

    const typedRowId = await typedRowAt(at(1, 9), HALF_OF_A_COIN);

    await readAt(at(2, 10), BALANCE_OF_ONE_AND_A_HALF);
    await transactionsRepo.remove(typedRowId);

    expect((await storedHolding()).balanceMinorUnits).toBe(ONE_COIN + HALF_OF_A_COIN);
    expect(await lineFrom(-1, 3)).toEqual([1.5, 1.5, 1.5, 1.5, 1.5]);
  });

  describe('row 32, each row of a second disconnect follows its own mark', () => {
    // Row 19's world: the first row is on the mark, the second is typed after it and the coin is
    // set aside at the next reconnect, so the stored balance has moved for the second row only,
    // since the read that overwrote the first.
    const rowsOfASecondDisconnect = async (): Promise<{
      firstRowId: string;
      secondRowId: string;
    }> => {
      const firstRowId = await typedRowThenReadOfATenth();

      await disconnectCryptoAccount(ACCOUNT_ID, 'bybit');

      const secondRowId = await typedRowAt(at(3, 9), THREE_TENTHS_OF_A_COIN);

      await readAt(at(4, 10), SET_ASIDE);

      return { firstRowId, secondRowId };
    };

    it('the first row, on the mark, leaves the balance at 0.4', async () => {
      const { firstRowId } = await rowsOfASecondDisconnect();

      await transactionsRepo.remove(firstRowId);

      expect((await storedHolding()).balanceMinorUnits).toBe(
        TENTH_OF_A_COIN + THREE_TENTHS_OF_A_COIN,
      );
      expect(await lineFrom(0, 4)).toEqual([0.1, 0.1, 0.1, 0.4, 0.4]);
    });

    it('the second row, off the mark, takes its amount from the balance', async () => {
      const { secondRowId } = await rowsOfASecondDisconnect();

      await transactionsRepo.remove(secondRowId);

      expect((await storedHolding()).balanceMinorUnits).toBe(TENTH_OF_A_COIN);
      expect(await lineFrom(0, 4)).toEqual([0.1, 0.1, 0.1, 0.1, 0.1]);
    });
  });

  it('row 28, a hand-set balance row on the mark moves no balance, deleted or edited', async () => {
    await readAt(at(0, 10), BALANCE_OF_ONE);
    await disconnectCryptoAccount(ACCOUNT_ID, 'bybit');

    const coin = await storedHolding();

    await holdingsRepo.updateWithBalanceDelta(
      coin.id,
      { balance: Money.of('BTC', ONE_COIN + HALF_OF_A_COIN) },
      at(1, 9),
    );
    await readAt(at(2, 10), BALANCE_OF_ONE);

    const setRow = mockDatabase
      .prepare('SELECT id FROM transactions WHERE holding_id = ? AND sets_balance = 1')
      .get(coin.id) as { id: string };
    const marks = (holding: HoldingRow) => ({
      balanceSetAt: holding.balanceSetAt,
      balanceSetRowId: holding.balanceSetRowId,
    });
    const marksBefore = marks(await storedHolding());

    await editRow(setRow.id, SEVEN_TENTHS_OF_A_COIN);

    expect((await storedHolding()).balanceMinorUnits).toBe(ONE_COIN);
    expect(await lineFrom(-1, 3)).toEqual([1, 1, 1, 1, 1]);

    await transactionsRepo.remove(setRow.id);

    const holding = await storedHolding();

    expect(holding.balanceMinorUnits).toBe(ONE_COIN);
    expect(await lineFrom(-1, 3)).toEqual([1, 1, 1, 1, 1]);
    expect(marks(holding)).toEqual(marksBefore);
    expect(marksBefore.balanceSetRowId).toBe(setRow.id);
  });
});

describe('a Convert or a split with a leg on a coin whose read overwrote it, on real SQLite', () => {
  const usdt = (major: number): number => Money.fromMajor('USDT', major).minorUnits;

  // Home and the line of the coin and of the cash holding, each in its own currency.
  const standing = async (currency: 'BTC' | 'USDT') => {
    const coin = await storedHolding();
    const cash = await storedHolding(CASH_ACCOUNT_ID);

    return {
      coinHome: toMajor(coin.balanceMinorUnits, currency),
      coinLine: await lineOfHolding(coin, currency, -1, 3),
      cashHome: toMajor(cash.balanceMinorUnits, cash.currency),
      cashLine: await lineOfHolding(cash, cash.currency, -1, 3),
    };
  };

  const legOnCoinId = async (): Promise<string> => {
    const coin = await storedHolding();

    return (
      mockDatabase.prepare('SELECT id FROM transactions WHERE holding_id = ?').get(coin.id) as {
        id: string;
      }
    ).id;
  };

  // Read 1, cash at 200, a typed expense of -100 on cash, its Convert to +0.5 on the coin, read 1.
  const convertedToTheCoin = async (): Promise<{ expenseId: string; coinLegId: string }> => {
    seedCashHolding('USD', 20_000);
    await readAt(at(0, 10), BALANCE_OF_ONE);
    await disconnectCryptoAccount(ACCOUNT_ID, 'bybit');

    const coin = await storedHolding();
    const expenseId = await transactionsRepo.recordManual({
      holdingId: CASH_ID,
      amountMinorUnits: -10_000,
      time: at(1, 9),
    });

    await transactionsRepo.recordExchangeCounterpart({
      direction: 'record-destination',
      counterpartHoldingId: coin.id,
      counterpartType: 'crypto_asset',
      amountMinorUnits: HALF_OF_A_COIN,
      existingTransactionId: expenseId,
      existingHoldingId: CASH_ID,
      time: at(1, 9),
    });
    await readAt(at(2, 10), BALANCE_OF_ONE);

    return { expenseId, coinLegId: await legOnCoinId() };
  };

  const BEFORE_AN_EDIT = {
    coinHome: 1,
    coinLine: [1, 1, 1, 1, 1],
    cashHome: 100,
    cashLine: [200, 200, 100, 100, 100],
  };

  it('row 25, a delete from either leg takes both and moves the cash holding alone', async () => {
    const { coinLegId } = await convertedToTheCoin();

    expect(await standing('BTC')).toEqual(BEFORE_AN_EDIT);

    await transactionsRepo.remove(coinLegId);

    expect(storedRowIds()).toEqual([]);
    expect(await standing('BTC')).toEqual({
      coinHome: 1,
      coinLine: [1, 1, 1, 1, 1],
      cashHome: 200,
      cashLine: [200, 200, 200, 200, 200],
    });
  });

  it('row 25, a delete from the cash leg gives the same', async () => {
    const { expenseId } = await convertedToTheCoin();

    await transactionsRepo.remove(expenseId);

    expect(storedRowIds()).toEqual([]);
    expect(await standing('BTC')).toEqual({
      coinHome: 1,
      coinLine: [1, 1, 1, 1, 1],
      cashHome: 200,
      cashLine: [200, 200, 200, 200, 200],
    });
  });

  it('row 26, an edit of the leg on the coin moves nothing', async () => {
    const { coinLegId } = await convertedToTheCoin();

    await editRow(coinLegId, SEVEN_TENTHS_OF_A_COIN);

    expect(await standing('BTC')).toEqual(BEFORE_AN_EDIT);
  });

  it('row 26, an edit of the leg on cash moves the cash holding alone', async () => {
    const { expenseId } = await convertedToTheCoin();

    await editRow(expenseId, -12_000);

    expect(await standing('BTC')).toEqual({
      ...BEFORE_AN_EDIT,
      cashHome: 80,
      cashLine: [200, 200, 80, 80, 80],
    });
  });

  describe('row 27, a split whose return is on the coin', () => {
    // Cash holds 200 USDT and pays -100 with a return of +30 to the coin, which a read of 10 then
    // overwrites.
    const splitWithAReturn = async (): Promise<{ paymentId: string; returnId: string }> => {
      seedCashHolding('USDT', usdt(200));
      await readAt(at(0, 10), [unifiedCoin('USDT', '10')]);
      await disconnectCryptoAccount(ACCOUNT_ID, 'bybit');

      const coin = await storedHolding();
      const paymentId = await transactionsRepo.recordManualWithReturns({
        payment: { holdingId: CASH_ID, amountMinorUnits: -usdt(100), time: at(1, 9) },
        returns: [{ holdingId: coin.id, amountMinorUnits: usdt(30) }],
      });

      await readAt(at(2, 10), [unifiedCoin('USDT', '10')]);

      return { paymentId, returnId: await legOnCoinId() };
    };

    // What the spending pie nets for the payment: its amount less the return of its group.
    const netSpentOnPayment = (): number => {
      const rows = mockDatabase
        .prepare(
          'SELECT id, amount_minor_units AS amountMinorUnits, change_group_id AS changeGroupId FROM transactions',
        )
        .all() as { id: string; amountMinorUnits: number; changeGroupId: string }[];
      const payment = rows.find(({ amountMinorUnits }) => amountMinorUnits < 0);

      if (payment === undefined) {
        throw new Error('the split should hold its payment');
      }

      return toMajor(netMagnitudeOf(payment, sumReturnsByGroup(rows)), 'USDT');
    };

    it.each(['the return', 'the payment'] as const)(
      'a delete of %s takes both rows and moves the cash holding alone',
      async (which) => {
        const { paymentId, returnId } = await splitWithAReturn();

        await transactionsRepo.remove(which === 'the return' ? returnId : paymentId);

        expect(storedRowIds()).toEqual([]);
        expect(await standing('USDT')).toEqual({
          coinHome: 10,
          coinLine: [10, 10, 10, 10, 10],
          cashHome: 200,
          cashLine: [200, 200, 200, 200, 200],
        });
      },
    );

    it('an edit of the return to +50 moves nothing and the pie nets the difference', async () => {
      const { returnId } = await splitWithAReturn();

      await editRow(returnId, usdt(50));

      expect(await standing('USDT')).toMatchObject({
        coinHome: 10,
        coinLine: [10, 10, 10, 10, 10],
        cashHome: 100,
      });
      expect(netSpentOnPayment()).toBe(50);
    });

    it('an edit of the payment to -120 moves the cash holding alone', async () => {
      const { paymentId } = await splitWithAReturn();

      await editRow(paymentId, -usdt(120));

      expect(await standing('USDT')).toMatchObject({
        coinHome: 10,
        coinLine: [10, 10, 10, 10, 10],
        cashHome: 80,
        cashLine: [200, 200, 80, 80, 80],
      });
      expect(netSpentOnPayment()).toBe(90);
    });
  });
});

// The account stays connected, so the gate refuses the row: no copy of the row of row 15 can
// exist, and Home and the line stay at the read.
describe('row 34, a manual row on the connected coin, on real SQLite', () => {
  const REFUSAL = new Error('transactions/synced-holding');

  it('row 34, a manual row on the connected coin is refused, and Home and the line stay at the read', async () => {
    await readAt(at(0, 10), [unifiedCoin('BTC', '0.1')]);

    await expect(typedRowAt(at(1, 9), HALF_OF_A_COIN)).rejects.toThrow(REFUSAL);

    expect((await storedHolding()).balanceMinorUnits).toBe(TENTH_OF_A_COIN);
    expect(storedRowIds()).toEqual([]);
    expect(await lineFrom(-1, 3)).toEqual([0.1, 0.1, 0.1, 0.1, 0.1]);
  });

  it('row 34, the other sign: a row of -0.5 is refused, and Home and the line stay at 1', async () => {
    await readAt(at(0, 10), BALANCE_OF_ONE);

    await expect(typedRowAt(at(1, 9), -HALF_OF_A_COIN)).rejects.toThrow(REFUSAL);

    expect((await storedHolding()).balanceMinorUnits).toBe(ONE_COIN);
    expect(storedRowIds()).toEqual([]);
    expect(await lineFrom(-1, 3)).toEqual([1, 1, 1, 1, 1]);
  });

  it('row 34, with the coin set aside: a manual row is refused, and Home and the line stay at the read', async () => {
    await readAt(at(0, 10), BALANCE_OF_ONE);
    await readAt(at(1, 8), SET_ASIDE);

    await expect(typedRowAt(at(1, 9), HALF_OF_A_COIN)).rejects.toThrow(REFUSAL);

    expect((await storedHolding()).balanceMinorUnits).toBe(ONE_COIN);
    expect(storedRowIds()).toEqual([]);
    expect(await lineFrom(-1, 3)).toEqual([1, 1, 1, 1, 1]);
  });
});
