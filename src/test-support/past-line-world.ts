/**
 * The set-up and the reads that the real-SQLite past-line tests of the dated holdings (Binance and
 * the Bitcoin wallet) share: one crypto account on a migrated database, the holding it stores, the
 * rows it holds, and the net-worth line `buildNetWorthSeries` draws from them. Each test keeps its
 * own seed rows and reads, since each pin names its own world.
 */
import { DatabaseSync } from 'node:sqlite';
import type { HoldingRow } from '@kiko/db';
import { holdingsRepo } from '@kiko/holdings/repo';
import type { Currency } from '@kiko/currency/currency';
import { transactionsRepo } from '@kiko/transactions/repo';
import { buildNetWorthSeries } from '@kiko/statistics/net-worth-series';
import type { SeriesTransaction } from '@kiko/statistics/holding-value-at';

import { applyAllMigrations } from './real-sqlite';

const TENTH_OF_A_COIN = 10_000_000;
const SIX_TENTHS_OF_A_COIN = 60_000_000;
const SEVEN_TENTHS_OF_A_COIN = 70_000_000;
const LINE_AT_THE_TENTH_READ = [0.1, 0.1, 0.1, 0.1, 0.1];

/** What `react-native-keychain` exposes to a test: only the accessibility constant is read. */
export const keychainModule = {
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly' },
};

/**
 * A local calendar day of January 2026 at an hour, built from local fields: the line samples at
 * local midnight, so no fixed-millisecond offset may stand for a day.
 */
export const at = (day: number, hour = 12): number => new Date(2026, 0, 1 + day, hour).getTime();

/** A migrated database with foreign keys on and one crypto account. */
export const openPastLineDatabase = (accountId: string, accountName: string): DatabaseSync => {
  const database = new DatabaseSync(':memory:');

  applyAllMigrations(database);
  database.exec('PRAGMA foreign_keys = ON;');
  database
    .prepare("INSERT INTO accounts (id, name, kind) VALUES (?, ?, 'crypto')")
    .run(accountId, accountName);

  return database;
};

/** The reads and writes of one account's holding, on the database `resolveDatabase` returns. */
export const pastLineWorld = (resolveDatabase: () => DatabaseSync, accountId: string) => {
  const storedHolding = async (ofAccount = accountId): Promise<HoldingRow> => {
    const [holding] = await holdingsRepo.listByAccountQuery(ofAccount);

    if (holding === undefined) {
      throw new Error(`account ${ofAccount} should hold a holding by now`);
    }

    return holding;
  };

  // A row the user types, which moves the balance as it is written. Returns the row's id.
  const typedRowAt = async (time: number, amountMinorUnits: number): Promise<string> => {
    const { id } = await storedHolding();

    return transactionsRepo.recordManual({ holdingId: id, amountMinorUnits, time });
  };

  const storedRowIds = (): string[] =>
    (
      resolveDatabase().prepare('SELECT id FROM transactions ORDER BY id').all() as {
        id: string;
      }[]
    ).map(({ id }) => id);

  const storedAmounts = (): unknown[] =>
    resolveDatabase().prepare('SELECT id, amount_minor_units AS amount FROM transactions').all();

  // The confirm's balance changes of a delete, which the delete then carries out.
  const deletedRowChanges = async (rowId: string): Promise<unknown> => {
    const { balanceChanges } = await transactionsRepo.removePlan(rowId);

    await transactionsRepo.remove(rowId);

    return balanceChanges;
  };

  // The net-worth line of the account's one holding at local midnight of each day from
  // `firstDay` to `lastDay`, in coins.
  const lineFrom = async (firstDay: number, lastDay: number): Promise<number[]> => {
    const holding = await storedHolding();
    const rows = resolveDatabase()
      .prepare(
        'SELECT id, time, amount_minor_units AS amountMinorUnits, source FROM transactions WHERE holding_id = ?',
      )
      .all(holding.id) as SeriesTransaction[];
    const { points } = buildNetWorthSeries({
      holdings: [holding],
      transactionsByHolding: new Map([[holding.id, rows]]),
      historyRows: [],
      baseCurrency: 'BTC' as Currency,
      range: { from: at(firstDay, 0), to: at(lastDay, 0) },
    });

    return points.map(({ amount }) => amount);
  };

  // A read of 0.1 after a typed +0.5 overwrote the row: Home shows the read, and the line holds it.
  const expectLineAtTheTenthRead = async (holding: HoldingRow): Promise<void> => {
    expect(await lineFrom(-1, 3)).toEqual(LINE_AT_THE_TENTH_READ);
    expect(holding.balanceMinorUnits).toBe(TENTH_OF_A_COIN);
  };

  const expectMarkedRowDeleteMovesNothing = async (rowId: string): Promise<void> => {
    expect(await deletedRowChanges(rowId)).toBeUndefined();
    expect((await storedHolding()).balanceMinorUnits).toBe(TENTH_OF_A_COIN);
    expect(await lineFrom(-1, 3)).toEqual(LINE_AT_THE_TENTH_READ);
    expect(storedRowIds()).toEqual([]);
  };

  const expectMarkedRowEditMovesNothing = async (rowId: string): Promise<void> => {
    await transactionsRepo.update({
      transactionId: rowId,
      amountMinorUnits: SEVEN_TENTHS_OF_A_COIN,
      time: at(1, 9),
    });

    expect((await storedHolding()).balanceMinorUnits).toBe(TENTH_OF_A_COIN);
    expect(await lineFrom(-1, 3)).toEqual(LINE_AT_THE_TENTH_READ);
    expect(storedAmounts()).toEqual([{ id: rowId, amount: SEVEN_TENTHS_OF_A_COIN }]);
  };

  // A row typed after the first dated read is on the mark of the next read, so deleting it moves
  // no balance.
  const expectLaterRowOnTheMark = async (laterRowId: string): Promise<void> => {
    expect((await storedHolding()).metadata).toMatchObject({
      overwrittenRowIds: [laterRowId],
      keptRowIds: ['typed-row'],
    });

    await transactionsRepo.remove(laterRowId);

    expect((await storedHolding()).balanceMinorUnits).toBe(SIX_TENTHS_OF_A_COIN);
  };

  return {
    storedHolding,
    typedRowAt,
    storedRowIds,
    deletedRowChanges,
    lineFrom,
    expectLineAtTheTenthRead,
    expectMarkedRowDeleteMovesNothing,
    expectMarkedRowEditMovesNothing,
    expectLaterRowOnTheMark,
  };
};
