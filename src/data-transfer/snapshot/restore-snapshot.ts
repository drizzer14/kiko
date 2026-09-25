// src/data-transfer/snapshot/restore-snapshot.ts
import {
  accounts,
  bondRegister,
  type CategoryRow,
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
import { chunkForTable } from '../../db/chunk-for-table';
import { entityColorsDark } from '../../design-system/palette';

import type { DataSnapshot } from './data-snapshot';

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

// Migration 0039's own seed values (`drizzle/migrations/0039_seed_loan_interest_category.sql`),
// duplicated here rather than imported: that migration's SQL runs only on a
// LIVE device upgrade, never against a restored snapshot's own categories.
const LOAN_INTEREST_CATEGORY_KEY = 'loan_interest';

/**
 * A pre-0039 `.kiko` snapshot's categories never included `loan_interest` —
 * migration 0039 seeds it only on-device, and `restoreDataSnapshot` REPLACEs
 * the whole table with the snapshot's own rows, so nothing re-seeds it
 * afterward. Appended here, at one past every OTHER category's own
 * `sortOrder` (mirroring the migration's own "append at max + 1"), the same
 * way restore already re-applies migration 0036's backfill for a legacy
 * snapshot (`withLegacyBalanceSetAtBackfilled`). A no-op when the snapshot
 * already carries its own `loan_interest` row (a post-0039 export, or one
 * already restored once), so a user's own edit to it is never overwritten.
 */
const withLoanInterestReseeded = (snapshotCategories: CategoryRow[]): CategoryRow[] => {
  if (snapshotCategories.some((category) => category.key === LOAN_INTEREST_CATEGORY_KEY)) {
    return snapshotCategories;
  }

  const sortOrder = Math.max(-1, ...snapshotCategories.map((category) => category.sortOrder)) + 1;

  return [
    ...snapshotCategories,
    {
      key: LOAN_INTEREST_CATEGORY_KEY,
      title: 'Loan interest',
      icon: 'percent',
      color: entityColorsDark.indigo,
      sortOrder,
    },
  ];
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
 * postdates every other table here, so a `.kiko` file exported before it
 * existed carries no `pricePoints` key at all despite the `DataSnapshot`
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
  write(async (databaseTransaction) => {
    const deleteAllTables = async (): Promise<void> => {
      await databaseTransaction.delete(transactions);
      await databaseTransaction.delete(syncState);
      await databaseTransaction.delete(holdings);
      await databaseTransaction.delete(accounts);
      await databaseTransaction.delete(categoryOverrides);
      await databaseTransaction.delete(categories);
      await databaseTransaction.delete(currencyRateHistory);
      await databaseTransaction.delete(currencyRates);
      await databaseTransaction.delete(settings);
      await databaseTransaction.delete(pricePoints);
      await databaseTransaction.delete(bondRegister);
    };

    // Split into four sequential groups (rather than one 10-loop function) to
    // stay under the cognitive-complexity ceiling; overall parent-before-child
    // insert order is unchanged because the groups themselves run in order.
    const insertAccountsHoldingsCategories = async (): Promise<void> => {
      for (const part of chunkForTable(accounts, snapshot.accounts)) {
        await databaseTransaction.insert(accounts).values(part);
      }
      const boundaries = balanceSetAtBoundariesByHoldingId(snapshot.transactions);
      const holdingsToInsert = snapshot.holdings.map((holding) =>
        withLegacyBalanceSetAtBackfilled(holding, boundaries),
      );
      for (const part of chunkForTable(holdings, holdingsToInsert)) {
        await databaseTransaction.insert(holdings).values(part);
      }
      for (const part of chunkForTable(categories, withLoanInterestReseeded(snapshot.categories))) {
        await databaseTransaction.insert(categories).values(part);
      }
    };

    const insertOverridesTransactionsSyncState = async (): Promise<void> => {
      for (const part of chunkForTable(categoryOverrides, snapshot.categoryOverrides)) {
        await databaseTransaction.insert(categoryOverrides).values(part);
      }
      for (const part of chunkForTable(transactions, snapshot.transactions)) {
        await databaseTransaction.insert(transactions).values(part);
      }
      for (const part of chunkForTable(syncState, snapshot.syncState)) {
        await databaseTransaction.insert(syncState).values(part);
      }
    };

    const insertRatesAndSettings = async (): Promise<void> => {
      for (const part of chunkForTable(currencyRates, snapshot.currencyRates)) {
        await databaseTransaction.insert(currencyRates).values(part);
      }
      for (const part of chunkForTable(currencyRateHistory, snapshot.currencyRateHistory)) {
        await databaseTransaction.insert(currencyRateHistory).values(part);
      }
      for (const part of chunkForTable(settings, snapshot.settings)) {
        await databaseTransaction.insert(settings).values(part);
      }
      // `?? []`: see the doc comment above — an export that predates
      // `price_points` carries no `pricePoints` key at all.
      for (const part of chunkForTable(pricePoints, snapshot.pricePoints ?? [])) {
        await databaseTransaction.insert(pricePoints).values(part);
      }
    };

    // `?? []`: `bond_register` postdates every other table here too — an
    // export from before it existed carries no `bondRegister` key at all,
    // for the same reason a pre-`price_points` export carries no
    // `pricePoints` key.
    const insertBondRegister = async (): Promise<void> => {
      for (const part of chunkForTable(bondRegister, snapshot.bondRegister ?? [])) {
        await databaseTransaction.insert(bondRegister).values(part);
      }
    };

    await deleteAllTables();
    await insertAccountsHoldingsCategories();
    await insertOverridesTransactionsSyncState();
    await insertRatesAndSettings();
    await insertBondRegister();
  });
