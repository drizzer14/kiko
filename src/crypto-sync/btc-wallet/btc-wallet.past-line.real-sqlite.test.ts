// A Bitcoin wallet takes the dated read of a Bybit holding: the read writes its time and the list
// of the rows it overwrote, and a delete or an edit of a row on the list moves no balance. The
// wallet writes no ledger row of its own (`btc_wallet` is never a row's source), so only the list
// changes a value. This file builds the holding the way a device does: a real `runBalanceSync`
// over a fake explorer, rows typed through the repo, and the line `buildNetWorthSeries` draws from
// what the database holds.
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

import { DatabaseSync } from 'node:sqlite';
import type { HoldingRow } from '@kiko/db';
import { holdingsRepo } from '@kiko/holdings/repo';
import { runBalanceSync } from '@kiko/crypto-sync/sync';
import type { Currency } from '@kiko/currency/currency';
import { transactionsRepo } from '@kiko/transactions/repo';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import { disconnectCryptoAccount } from '@kiko/crypto-sync/disconnect';
import { buildNetWorthSeries } from '@kiko/statistics/net-worth-series';
import type { SeriesTransaction } from '@kiko/statistics/holding-value-at';

import { bitcoinWalletProvider } from './btc-wallet.provider';

const ACCOUNT_ID = 'acc-wallet';
const ADDRESS = '1BoatSLRHtKNngkdXEeobR76b53LETtpyT';
const ONE_COIN = 100_000_000;
const TENTH_OF_A_COIN = 10_000_000;
const HALF_OF_A_COIN = 50_000_000;
const SIX_TENTHS_OF_A_COIN = 60_000_000;
const SEVEN_TENTHS_OF_A_COIN = 70_000_000;

// A local calendar day of January 2026 at an hour, built from local fields: the line samples at
// local midnight, so no fixed-millisecond offset may stand for a day.
const at = (day: number, hour = 12): number => new Date(2026, 0, 1 + day, hour).getTime();

const readAt = (time: number, balanceMinorUnits: number): ReturnType<typeof runBalanceSync> =>
  runBalanceSync(
    bitcoinWalletProvider,
    { fetchImpl: fetch, fetchAddressBalance: async () => balanceMinorUnits, address: ADDRESS },
    { targetAccountId: ACCOUNT_ID, now: () => time },
  );

const storedHolding = async (): Promise<HoldingRow> => {
  const [holding] = await holdingsRepo.listByAccountQuery(ACCOUNT_ID);

  if (holding === undefined) {
    throw new Error(`account ${ACCOUNT_ID} should hold a holding by now`);
  }

  return holding;
};

// A row the user types, which moves the balance as it is written. Returns the row's id.
const typedRowAt = async (time: number, amountMinorUnits: number): Promise<string> => {
  const { id } = await storedHolding();

  return transactionsRepo.recordManual({ holdingId: id, amountMinorUnits, time });
};

const storedRowIds = (): string[] =>
  (mockDatabase.prepare('SELECT id FROM transactions ORDER BY id').all() as { id: string }[]).map(
    ({ id }) => id,
  );

// The net-worth line of the account's one holding at local midnight of each day from `firstDay` to
// `lastDay`, in coins.
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
    baseCurrency: 'BTC' as Currency,
    range: { from: at(firstDay, 0), to: at(lastDay, 0) },
  });

  return points.map(({ amount }) => amount);
};

beforeEach(() => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('PRAGMA foreign_keys = ON;');
  mockDatabase
    .prepare("INSERT INTO accounts (id, name, kind) VALUES (?, 'Wallet', 'crypto')")
    .run(ACCOUNT_ID);
});

describe('the line of a Bitcoin wallet whose read overwrote rows the user typed, on real SQLite', () => {
  // Read 0.1, disconnect, type +0.5 (the balance moves to 0.6), reconnect, read 0.1 again.
  const typedRowThenReadOfATenth = async (): Promise<string> => {
    await readAt(at(0, 10), TENTH_OF_A_COIN);
    await disconnectCryptoAccount(ACCOUNT_ID, 'btc_wallet');

    const typedRowId = await typedRowAt(at(1, 9), HALF_OF_A_COIN);

    await readAt(at(2, 10), TENTH_OF_A_COIN);

    return typedRowId;
  };

  it('W8, a row the read overwrote is left off the line, and Home shows the read', async () => {
    const typedRowId = await typedRowThenReadOfATenth();
    const holding = await storedHolding();

    expect(await lineFrom(-1, 3)).toEqual([0.1, 0.1, 0.1, 0.1, 0.1]);
    expect(holding.balanceMinorUnits).toBe(TENTH_OF_A_COIN);
    expect(holding.metadata).toEqual({
      walletAddress: ADDRESS,
      syncedAt: at(2, 10),
      balanceReadAt: at(2, 10),
      overwrittenRowIds: [typedRowId],
    });
  });

  it('W8, deleting a row on the mark moves no balance and the confirm names no change', async () => {
    const typedRowId = await typedRowThenReadOfATenth();

    expect((await transactionsRepo.removePlan(typedRowId)).balanceChanges).toBeUndefined();

    await transactionsRepo.remove(typedRowId);

    expect((await storedHolding()).balanceMinorUnits).toBe(TENTH_OF_A_COIN);
    expect(await lineFrom(-1, 3)).toEqual([0.1, 0.1, 0.1, 0.1, 0.1]);
    expect(storedRowIds()).toEqual([]);
  });

  it('W8, editing a row on the mark moves no balance and keeps its id', async () => {
    const typedRowId = await typedRowThenReadOfATenth();

    await transactionsRepo.update({
      transactionId: typedRowId,
      amountMinorUnits: SEVEN_TENTHS_OF_A_COIN,
      time: at(1, 9),
    });

    expect((await storedHolding()).balanceMinorUnits).toBe(TENTH_OF_A_COIN);
    expect(await lineFrom(-1, 3)).toEqual([0.1, 0.1, 0.1, 0.1, 0.1]);
    expect(
      mockDatabase.prepare('SELECT id, amount_minor_units AS amount FROM transactions').all(),
    ).toEqual([{ id: typedRowId, amount: SEVEN_TENTHS_OF_A_COIN }]);
  });
});

describe('the line of a Bitcoin wallet that shipped with a row the user typed, on real SQLite', () => {
  // Shipped, disconnected, a +0.5 typed (the balance 0.6), then reconnected. Seeded per pin, since
  // each pin names its own world.
  const seedShippedWalletWithTypedRow = (): void => {
    mockDatabase
      .prepare(
        `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units, metadata)
         VALUES ('shipped', ?, 'BTC Wallet', 'crypto_asset', 'BTC', ?, ?)`,
      )
      .run(ACCOUNT_ID, SIX_TENTHS_OF_A_COIN, JSON.stringify({ walletAddress: ADDRESS }));
    mockDatabase
      .prepare(
        `INSERT INTO transactions (id, holding_id, amount_minor_units, time, source)
         VALUES ('typed-row', 'shipped', ?, ?, 'manual')`,
      )
      .run(HALF_OF_A_COIN, at(1, 9));
  };

  it('Q3, the first dated read writes the date and no mark, and the old typed row keeps counting', async () => {
    seedShippedWalletWithTypedRow();

    expect(await lineFrom(-1, 3)).toEqual([0.1, 0.1, 0.6, 0.6, 0.6]);

    await readAt(at(2, 10), SIX_TENTHS_OF_A_COIN);

    expect((await storedHolding()).metadata).toEqual({
      walletAddress: ADDRESS,
      syncedAt: at(2, 10),
      balanceReadAt: at(2, 10),
    });
    expect(await lineFrom(-1, 3)).toEqual([0.1, 0.1, 0.6, 0.6, 0.6]);
  });

  it('Q3, a delete of the old typed row after the first dated read moves the balance as today', async () => {
    seedShippedWalletWithTypedRow();
    await readAt(at(2, 10), SIX_TENTHS_OF_A_COIN);

    expect((await transactionsRepo.removePlan('typed-row')).balanceChanges).toBeDefined();

    await transactionsRepo.remove('typed-row');

    expect((await storedHolding()).balanceMinorUnits).toBe(TENTH_OF_A_COIN);
  });

  it('Q-j, a row typed after the first dated read is on the mark of the next read', async () => {
    seedShippedWalletWithTypedRow();
    await readAt(at(2, 10), SIX_TENTHS_OF_A_COIN);
    await disconnectCryptoAccount(ACCOUNT_ID, 'btc_wallet');

    const laterRowId = await typedRowAt(at(3, 9), HALF_OF_A_COIN);

    await readAt(at(4, 10), SIX_TENTHS_OF_A_COIN);

    expect((await storedHolding()).metadata).toMatchObject({
      overwrittenRowIds: [laterRowId],
      keptRowIds: ['typed-row'],
    });

    await transactionsRepo.remove(laterRowId);

    expect((await storedHolding()).balanceMinorUnits).toBe(SIX_TENTHS_OF_A_COIN);
  });

  it('the old typed row stays off the mark at the second and the third dated read, with a disconnect between them, and keeps counting', async () => {
    seedShippedWalletWithTypedRow();

    const dayOfRead = [2, 3, 4];

    for (const day of dayOfRead) {
      await readAt(at(day, 10), SIX_TENTHS_OF_A_COIN);

      expect((await storedHolding()).metadata).toEqual({
        walletAddress: ADDRESS,
        syncedAt: at(day, 10),
        balanceReadAt: at(day, 10),
        keptRowIds: ['typed-row'],
      });
      expect(await lineFrom(-1, 3)).toEqual([0.1, 0.1, 0.6, 0.6, 0.6]);

      await disconnectCryptoAccount(ACCOUNT_ID, 'btc_wallet');
    }
  });

  it('a delete of the old typed row after the third dated read moves the balance as today', async () => {
    seedShippedWalletWithTypedRow();
    await readAt(at(2, 10), SIX_TENTHS_OF_A_COIN);
    await disconnectCryptoAccount(ACCOUNT_ID, 'btc_wallet');
    await readAt(at(3, 10), SIX_TENTHS_OF_A_COIN);
    await disconnectCryptoAccount(ACCOUNT_ID, 'btc_wallet');
    await readAt(at(4, 10), SIX_TENTHS_OF_A_COIN);

    expect((await transactionsRepo.removePlan('typed-row')).balanceChanges).toBeDefined();

    await transactionsRepo.remove('typed-row');

    expect((await storedHolding()).balanceMinorUnits).toBe(TENTH_OF_A_COIN);
  });

  it('a deleted old row leaves the kept list at the next dated read', async () => {
    seedShippedWalletWithTypedRow();
    await readAt(at(2, 10), SIX_TENTHS_OF_A_COIN);
    await transactionsRepo.remove('typed-row');
    await readAt(at(3, 10), TENTH_OF_A_COIN);

    expect((await storedHolding()).metadata).toEqual({
      walletAddress: ADDRESS,
      syncedAt: at(3, 10),
      balanceReadAt: at(3, 10),
    });
  });
});

describe('the line of a Bitcoin wallet that shipped and was disconnected, on real SQLite', () => {
  beforeEach(() => {
    mockDatabase
      .prepare(
        `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units, metadata)
         VALUES ('shipped', ?, 'BTC Wallet', 'crypto_asset', 'BTC', ?, ?)`,
      )
      .run(ACCOUNT_ID, ONE_COIN, JSON.stringify({ walletAddress: ADDRESS }));
  });

  it('W9, a row typed after the disconnect moves the balance and the line as typed, with no read and no mark', async () => {
    const typedRowId = await typedRowAt(at(1, 9), HALF_OF_A_COIN);

    expect((await storedHolding()).balanceMinorUnits).toBe(ONE_COIN + HALF_OF_A_COIN);
    expect((await storedHolding()).metadata).toEqual({ walletAddress: ADDRESS });
    expect(await lineFrom(0, 2)).toEqual([1, 1.5, 1.5]);

    await transactionsRepo.remove(typedRowId);

    expect((await storedHolding()).balanceMinorUnits).toBe(ONE_COIN);
    expect(await lineFrom(0, 2)).toEqual([1, 1, 1]);
  });
});
