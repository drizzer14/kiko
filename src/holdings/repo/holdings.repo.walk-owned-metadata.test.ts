// `holdings.repo.test.ts` doubles `write`'s op-sqlite transaction with a fake
// handle whose `select` never enforces a real stored row — it could not have
// caught a blind metadata overwrite, only proven the update ran. This file
// instead applies the REAL, shipped migration SQL (`applyAllMigrations`) to an
// in-process `node:sqlite` engine, then runs `upsertByMetadataKeyDatabaseTransaction`
// directly against a REAL, EXECUTING drizzle instance (`executingDrizzle`) —
// the only way to prove a walk-owned key (the Binance history cursor) survives
// a routine balance-sync upsert while every OTHER stored field still updates.
import { eq } from 'drizzle-orm';
import { DatabaseSync } from 'node:sqlite';
import { type database, holdings } from '@kiko/db';
import { applyAllMigrations, executingDrizzle } from '@kiko/test-support/real-sqlite';

import { upsertByMetadataKeyDatabaseTransaction } from './holdings.repo';

const openTestDatabase = (): DatabaseSync => {
  const rawDatabase = new DatabaseSync(':memory:');

  applyAllMigrations(rawDatabase);
  rawDatabase.exec('PRAGMA foreign_keys = ON;');
  rawDatabase
    .prepare("INSERT INTO accounts (id, name, kind) VALUES ('acc-1', 'Binance', 'crypto')")
    .run();

  return rawDatabase;
};

describe('upsertByMetadataKeyDatabaseTransaction — walk-owned metadata carry-over', () => {
  it('a balance-sync upsert keeps the stored binanceHistoryCursor AND still replaces every other synced field', async () => {
    const rawDatabase = openTestDatabase();
    const drizzleDatabase = executingDrizzle<typeof database>(rawDatabase);
    rawDatabase
      .prepare(
        `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units, metadata)
         VALUES ('h-spot', 'acc-1', 'Binance Spot', 'crypto_asset', 'BTC', 100, ?)`,
      )
      .run(JSON.stringify({ binanceAsset: 'BTC', binanceHistoryCursor: 1_000, syncedAt: 500 }));

    // The exact shape a balance sync writes (`runBalanceSyncInner`): a fresh
    // `{ syncedAt }` object, never carrying the walk's own cursor.
    await upsertByMetadataKeyDatabaseTransaction(drizzleDatabase, {
      accountId: 'acc-1',
      name: 'Binance Spot',
      type: 'crypto_asset',
      currency: 'BTC',
      balanceMinorUnits: 250,
      metadata: { syncedAt: 2_000 },
      metadataField: 'binanceAsset',
      metadataKey: 'BTC',
    });

    const row = (await drizzleDatabase.select().from(holdings).where(eq(holdings.id, 'h-spot')))[0];

    expect(row.balanceMinorUnits).toBe(250);
    expect(row.metadata).toEqual({
      binanceAsset: 'BTC',
      syncedAt: 2_000,
      binanceHistoryCursor: 1_000,
    });
  });

  it('adds no binanceHistoryCursor key for a holding that never had one (wallet/Monobank rows unaffected)', async () => {
    const rawDatabase = openTestDatabase();
    const drizzleDatabase = executingDrizzle<typeof database>(rawDatabase);
    rawDatabase
      .prepare(
        `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units, metadata)
         VALUES ('h-wallet', 'acc-1', 'BTC Wallet', 'crypto_asset', 'BTC', 100, ?)`,
      )
      .run(JSON.stringify({ walletAddress: 'bc1qsomething', syncedAt: 500 }));

    await upsertByMetadataKeyDatabaseTransaction(drizzleDatabase, {
      accountId: 'acc-1',
      name: 'BTC Wallet',
      type: 'crypto_asset',
      currency: 'BTC',
      balanceMinorUnits: 300,
      metadata: { syncedAt: 2_000 },
      metadataField: 'walletAddress',
      metadataKey: 'bc1qsomething',
    });

    const row = (
      await drizzleDatabase.select().from(holdings).where(eq(holdings.id, 'h-wallet'))
    )[0];

    expect(row.balanceMinorUnits).toBe(300);
    expect(row.metadata).toEqual({ walletAddress: 'bc1qsomething', syncedAt: 2_000 });
  });
});
