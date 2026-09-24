// src/data-transfer/snapshot/restore-snapshot.ts
import { type Table, getTableColumns } from 'drizzle-orm';

import {
  accounts,
  bondRegister,
  categories,
  categoryOverrides,
  currencyRateHistory,
  currencyRates,
  type HoldingRow,
  holdings,
  pricePoints,
  settings,
  syncState,
  type TransactionRow,
  transactions,
} from '../../db/schema';
import { write } from '../../db/client';

import type { DataSnapshot } from './data-snapshot';

// Each row binds one parameter per PRESENT key (nulls included — Drizzle
// still binds them, `drizzle-orm/sqlite-core/dialect.js:362-380`), and
// SQLite rejects a statement with more than SQLITE_MAX_VARIABLE_NUMBER
// (32766) bound parameters — the same ceiling `rateHistoryRepo.upsertMany`
// (`src/rates/rate-history-repo/rate-history.repo.ts`) chunks around. A
// FIXED rows-per-chunk constant broke this once already: T29 added 3
// columns to `transactions` (15 -> 18) and pushed 2000 rows/chunk from
// 30000 params (safe) to 36000 (over the limit) — a `.kiko` backup with
// >= 1821 transactions failed to restore. Deriving the chunk size from
// EACH table's own column count, every time, means a future column can
// never silently repeat this: the widest table just gets a smaller chunk.
// A margin below SQLite's exact 32766 ceiling, in case a future insert
// path binds a stray extra parameter per row (as `insertDedupRowsTx` now
// does for `loanLinkRejected`'s JS default — see M6 in the T29 review).
const SAFE_BOUND_PARAMETER_LIMIT = 32000;

const chunk = <T>(rows: T[], size: number): T[][] => {
  const parts: T[][] = [];
  for (let start = 0; start < rows.length; start += size) {
    parts.push(rows.slice(start, start + size));
  }
  return parts;
};

/** Chunks `rows` for `table` at the largest size that keeps every insert's
 * bound-parameter count under `SAFE_BOUND_PARAMETER_LIMIT`, computed from
 * the table's OWN column count rather than a fixed row count — see the
 * doc comment above the chunking constants. */
const chunkForTable = <T>(table: Table, rows: T[]): T[][] => {
  const columnCount = Object.keys(getTableColumns(table)).length;
  const rowsPerChunk = Math.max(1, Math.floor(SAFE_BOUND_PARAMETER_LIMIT / columnCount));
  return chunk(rows, rowsPerChunk);
};

/** True for a manual transaction row shaped like a hand-set balance under
 * migration 0036's heuristic (`drizzle/migrations/0036_add_balance_set_at.sql`):
 * no description, no category, and neither the exchange-leg nor the
 * change-return structural marker. See `transactionsRepo.importRows`'s doc
 * comment (`transactions/repo/transactions.repo.ts`) for the single-source
 * rule this backfills toward. */
const isBalanceSetShapedRow = (row: TransactionRow): boolean =>
  row.source === 'manual' &&
  row.description === '' &&
  row.category === null &&
  row.exchangeCounterpartHoldingId === null &&
  row.changeGroupId === null;

/** Migration 0036's `MAX(time)` per holding, computed in one pass over
 * `allTransactions` rather than re-filtering the whole array per holding. */
const balanceSetAtBoundariesByHoldingId = (
  allTransactions: TransactionRow[],
): Map<string, number> => {
  const boundaries = new Map<string, number>();

  for (const row of allTransactions) {
    if (!isBalanceSetShapedRow(row)) {
      continue;
    }

    const current = boundaries.get(row.holdingId);
    if (current === undefined || row.time > current) {
      boundaries.set(row.holdingId, row.time);
    }
  }

  return boundaries;
};

/**
 * Reproduces migration 0036's backfill for a holding restored from a
 * build-25-shaped snapshot (no `balanceSetAt` key at all). Detects on the
 * JSON key's PRESENCE, not its value, so an already-migrated snapshot's
 * value — including an explicit `null` — is returned unchanged.
 * `Object.hasOwn`, not `in`: `HoldingRow` declares `balanceSetAt` as
 * always-present, so `in` would type-narrow the "missing" branch to
 * `never`, even though a legacy runtime object (parsed from JSON) can
 * still lack the key.
 */
const withLegacyBalanceSetAtBackfilled = (
  holding: HoldingRow,
  boundaries: Map<string, number>,
): HoldingRow => {
  if (Object.hasOwn(holding, 'balanceSetAt')) {
    return holding;
  }

  return { ...holding, balanceSetAt: boundaries.get(holding.id) ?? null };
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
 *
 * `snapshot.holdings` is passed through `withLegacyBalanceSetAtBackfilled`
 * (above) before insert, for the same reason: a build-25-shaped `.kiko` file
 * carries no `balanceSetAt` key on its holdings at all, and without this the
 * restored holding would come back with a NULL boundary the live database
 * never actually had, undoing migration 0036's own backfill for that user.
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
      await tx.delete(bondRegister);
    };

    // Split into four sequential groups (rather than one 10-loop function) to
    // stay under the cognitive-complexity ceiling; overall parent-before-child
    // insert order is unchanged because the groups themselves run in order.
    const insertAccountsHoldingsCategories = async (): Promise<void> => {
      for (const part of chunkForTable(accounts, snapshot.accounts)) {
        await tx.insert(accounts).values(part);
      }
      const boundaries = balanceSetAtBoundariesByHoldingId(snapshot.transactions);
      const holdingsToInsert = snapshot.holdings.map((holding) =>
        withLegacyBalanceSetAtBackfilled(holding, boundaries),
      );
      for (const part of chunkForTable(holdings, holdingsToInsert)) {
        await tx.insert(holdings).values(part);
      }
      for (const part of chunkForTable(categories, snapshot.categories)) {
        await tx.insert(categories).values(part);
      }
    };

    const insertOverridesTransactionsSyncState = async (): Promise<void> => {
      for (const part of chunkForTable(categoryOverrides, snapshot.categoryOverrides)) {
        await tx.insert(categoryOverrides).values(part);
      }
      for (const part of chunkForTable(transactions, snapshot.transactions)) {
        await tx.insert(transactions).values(part);
      }
      for (const part of chunkForTable(syncState, snapshot.syncState)) {
        await tx.insert(syncState).values(part);
      }
    };

    const insertRatesAndSettings = async (): Promise<void> => {
      for (const part of chunkForTable(currencyRates, snapshot.currencyRates)) {
        await tx.insert(currencyRates).values(part);
      }
      for (const part of chunkForTable(currencyRateHistory, snapshot.currencyRateHistory)) {
        await tx.insert(currencyRateHistory).values(part);
      }
      for (const part of chunkForTable(settings, snapshot.settings)) {
        await tx.insert(settings).values(part);
      }
      // `?? []`: see the doc comment above — a pre-T11 export carries no
      // `pricePoints` key at all.
      for (const part of chunkForTable(pricePoints, snapshot.pricePoints ?? [])) {
        await tx.insert(pricePoints).values(part);
      }
    };

    // `?? []`: `bond_register` (T24) postdates every other table here too —
    // a pre-T24 export carries no `bondRegister` key at all, for the same
    // reason a pre-T11 export carries no `pricePoints` key.
    const insertBondRegister = async (): Promise<void> => {
      for (const part of chunkForTable(bondRegister, snapshot.bondRegister ?? [])) {
        await tx.insert(bondRegister).values(part);
      }
    };

    await deleteAllTables();
    await insertAccountsHoldingsCategories();
    await insertOverridesTransactionsSyncState();
    await insertRatesAndSettings();
    await insertBondRegister();
  });
