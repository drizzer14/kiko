// src/data-transfer/snapshot/restore-snapshot.ts
import { write } from '../../db/client';
import {
  accounts,
  categories,
  categoryOverrides,
  currencyRateHistory,
  currencyRates,
  holdings,
  pricePoints,
  settings,
  syncState,
  transactions,
} from '../../db/schema';

import type { DataSnapshot } from './data-snapshot';

// Each row binds several parameters and SQLite rejects a statement with more
// than SQLITE_MAX_VARIABLE_NUMBER (32766) bound parameters — the same ceiling
// `rateHistoryRepo.upsertMany` (`src/rates/rate-history-repo/rate-history.repo.ts`)
// chunks around. 2000 rows/chunk stays a safe margin under it for every table
// here (the widest, `transactions`, binds ~14 params/row = 28000/chunk).
const CHUNK_SIZE = 2000;

const chunk = <T>(rows: T[], size: number): T[][] => {
  const parts: T[][] = [];
  for (let start = 0; start < rows.length; start += size) {
    parts.push(rows.slice(start, start + size));
  }
  return parts;
};

/**
 * Replaces every row in every one of the 10 logical tables with the given
 * snapshot's rows, inside ONE `write()` transaction — so a failure partway
 * leaves the live database untouched (op-sqlite's transaction auto-rolls-back
 * on a thrown error, same guarantee every other `write()` caller relies on).
 *
 * REPLACE, not merge: every existing row is deleted first. Ids are preserved
 * verbatim from the snapshot (never regenerated), which is what makes
 * export-then-import reproduce the data exactly, and what lets
 * `restoreExportSecrets` (`secrets/restore-secrets.ts`) re-key each restored
 * account's Monobank token / Binance credentials to the SAME account id.
 *
 * Delete order is child-before-parent, insert order is parent-before-child —
 * `PRAGMA foreign_keys = ON` (set once per connection in `db/client.ts`)
 * rejects a delete/insert that violates a `holdings.accountId`,
 * `transactions.holdingId`, or `syncState.accountId` reference otherwise
 * (the same ordering `accountsRepo.remove` hand-codes for one account).
 *
 * `snapshot.pricePoints` is read defensively with `?? []`: `price_points`
 * (T11) postdates every other table here, so a `.kiko` file exported before
 * it existed carries no `pricePoints` key at all despite the `DataSnapshot`
 * type declaring it required — that JSON simply never had the field. Such a
 * legacy import must still restore cleanly, with an EMPTY `price_points`
 * table, rather than throw on the missing key.
 */
export const restoreDataSnapshot = (snapshot: DataSnapshot): Promise<void> =>
  write(async (tx) => {
    const deleteAllTables = async (): Promise<void> => {
      await tx.delete(transactions);
      await tx.delete(syncState);
      await tx.delete(holdings);
      await tx.delete(accounts);
      await tx.delete(categoryOverrides);
      await tx.delete(categories);
      await tx.delete(currencyRateHistory);
      await tx.delete(currencyRates);
      await tx.delete(settings);
      await tx.delete(pricePoints);
    };

    // Split into three sequential groups (rather than one 9-loop function) to
    // stay under the cognitive-complexity ceiling; overall parent-before-child
    // insert order is unchanged because the groups themselves run in order.
    const insertAccountsHoldingsCategories = async (): Promise<void> => {
      for (const part of chunk(snapshot.accounts, CHUNK_SIZE)) {
        await tx.insert(accounts).values(part);
      }
      for (const part of chunk(snapshot.holdings, CHUNK_SIZE)) {
        await tx.insert(holdings).values(part);
      }
      for (const part of chunk(snapshot.categories, CHUNK_SIZE)) {
        await tx.insert(categories).values(part);
      }
    };

    const insertOverridesTransactionsSyncState = async (): Promise<void> => {
      for (const part of chunk(snapshot.categoryOverrides, CHUNK_SIZE)) {
        await tx.insert(categoryOverrides).values(part);
      }
      for (const part of chunk(snapshot.transactions, CHUNK_SIZE)) {
        await tx.insert(transactions).values(part);
      }
      for (const part of chunk(snapshot.syncState, CHUNK_SIZE)) {
        await tx.insert(syncState).values(part);
      }
    };

    const insertRatesAndSettings = async (): Promise<void> => {
      for (const part of chunk(snapshot.currencyRates, CHUNK_SIZE)) {
        await tx.insert(currencyRates).values(part);
      }
      for (const part of chunk(snapshot.currencyRateHistory, CHUNK_SIZE)) {
        await tx.insert(currencyRateHistory).values(part);
      }
      for (const part of chunk(snapshot.settings, CHUNK_SIZE)) {
        await tx.insert(settings).values(part);
      }
      // `?? []`: see the doc comment above — a pre-T11 export carries no
      // `pricePoints` key at all.
      for (const part of chunk(snapshot.pricePoints ?? [], CHUNK_SIZE)) {
        await tx.insert(pricePoints).values(part);
      }
    };

    await deleteAllTables();
    await insertAccountsHoldingsCategories();
    await insertOverridesTransactionsSyncState();
    await insertRatesAndSettings();
  });
