// `holdings.repo.test.ts` doubles `write`'s op-sqlite transaction with a fake
// handle whose `select`/`innerJoin` never enforce real SQLite JOIN semantics —
// it could not have caught a blind write past a disconnected account. This
// file instead applies the REAL, shipped migration SQL (`applyAllMigrations`)
// to an in-process `node:sqlite` engine, and mocks `@kiko/db/client`'s `write`
// to route the repo's OWN `write(...)` calls through `executingDrizzle`
// against it — proving `setBinanceWalkCursor`'s account-institution gate
// (a walk holds the account's credentials for its whole run, so a
// disconnect can commit while it is still in flight) against a real join.
let mockWorkDatabase: unknown;
jest.mock('@kiko/db/client', () => {
  const actual = jest.requireActual('@kiko/db/client');

  return {
    ...actual,
    write: (work: (db: unknown) => unknown) => work(mockWorkDatabase),
  };
});

import type { database } from '@kiko/db';
import { DatabaseSync } from 'node:sqlite';
import { binanceWalkCursorFields } from '@kiko/holdings/holding-metadata';
import { applyAllMigrations, executingDrizzle } from '@kiko/test-support/real-sqlite';

import { holdingsRepo } from './holdings.repo';

const openTestDatabase = (institution: string | null): DatabaseSync => {
  const rawDatabase = new DatabaseSync(':memory:');

  applyAllMigrations(rawDatabase);
  rawDatabase.exec('PRAGMA foreign_keys = ON;');
  rawDatabase
    .prepare(
      "INSERT INTO accounts (id, name, kind, institution) VALUES ('acc-1', 'Binance', 'crypto', ?)",
    )
    .run(institution);
  rawDatabase
    .prepare(
      `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units, metadata)
       VALUES ('h-spot', 'acc-1', 'Binance Spot', 'crypto_asset', 'BTC', 100, ?)`,
    )
    .run(JSON.stringify({ binanceAsset: 'BTC', binanceHistoryCursor: 500, syncedAt: 500 }));

  return rawDatabase;
};

const storedMetadata = (rawDatabase: DatabaseSync): unknown =>
  JSON.parse(
    (
      rawDatabase.prepare("SELECT metadata FROM holdings WHERE id = 'h-spot'").get() as {
        metadata: string;
      }
    ).metadata,
  );

describe("holdingsRepo.setBinanceWalkCursor — gated on the holding's account still being connected to Binance", () => {
  it('is a no-op on a disconnected account: the cursor stays exactly as stored', async () => {
    const rawDatabase = openTestDatabase(null);
    mockWorkDatabase = executingDrizzle<typeof database>(rawDatabase);

    await holdingsRepo.setBinanceWalkCursor('h-spot', 'binanceHistoryCursor', 999_999);

    expect(storedMetadata(rawDatabase)).toEqual({
      binanceAsset: 'BTC',
      binanceHistoryCursor: 500,
      syncedAt: 500,
    });
  });

  it.each(binanceWalkCursorFields)(
    'still writes %s when the account is connected to Binance, keeping every other key',
    async (field) => {
      const rawDatabase = openTestDatabase('binance');
      mockWorkDatabase = executingDrizzle<typeof database>(rawDatabase);

      await holdingsRepo.setBinanceWalkCursor('h-spot', field, 999_999);

      expect(storedMetadata(rawDatabase)).toEqual({
        binanceAsset: 'BTC',
        binanceHistoryCursor: 500,
        syncedAt: 500,
        [field]: 999_999,
      });
    },
  );

  it('keeps the other walks cursors when one walk advances its own', async () => {
    const rawDatabase = openTestDatabase('binance');
    mockWorkDatabase = executingDrizzle<typeof database>(rawDatabase);

    await holdingsRepo.setBinanceWalkCursor('h-spot', 'binancePayHistoryCursor', 700);
    await holdingsRepo.setBinanceWalkCursor('h-spot', 'binanceEarnHistoryCursor', 800);

    expect(storedMetadata(rawDatabase)).toEqual({
      binanceAsset: 'BTC',
      binanceHistoryCursor: 500,
      binancePayHistoryCursor: 700,
      binanceEarnHistoryCursor: 800,
      syncedAt: 500,
    });
  });

  it("a disconnect's floor write is not undone by a walk's late-arriving window commit", async () => {
    const rawDatabase = openTestDatabase('binance');
    mockWorkDatabase = executingDrizzle<typeof database>(rawDatabase);

    // The disconnect itself, in its own real order: reset the cursor to the
    // floor FIRST, then clear the institution — see `disconnectCryptoAccount`.
    await holdingsRepo.resetBinanceWalkCursors('acc-1', 1);
    rawDatabase.prepare("UPDATE accounts SET institution = NULL WHERE id = 'acc-1'").run();

    // A window commit from a walk that started BEFORE the disconnect, whose
    // write only reaches the DB after the disconnect already cleared the
    // institution — it must not resurrect a forward watermark over the floor.
    await holdingsRepo.setBinanceWalkCursor('h-spot', 'binanceHistoryCursor', 999_999);

    expect(storedMetadata(rawDatabase)).toEqual({
      binanceAsset: 'BTC',
      binanceHistoryCursor: 1,
      syncedAt: 500,
    });
  });

  it('a disconnect resets every walk cursor the Spot holding carries to the floor', async () => {
    const rawDatabase = openTestDatabase('binance');
    mockWorkDatabase = executingDrizzle<typeof database>(rawDatabase);

    for (const field of binanceWalkCursorFields) {
      await holdingsRepo.setBinanceWalkCursor('h-spot', field, 999_999);
    }
    await holdingsRepo.resetBinanceWalkCursors('acc-1', 1);

    expect(storedMetadata(rawDatabase)).toEqual({
      binanceAsset: 'BTC',
      binanceHistoryCursor: 1,
      binanceHistoryRescanCursor: 1,
      binancePayHistoryCursor: 1,
      binancePayRescanCursor: 1,
      binanceTransferHistoryCursor: 1,
      binanceEarnHistoryCursor: 1,
      syncedAt: 500,
    });
  });
});
