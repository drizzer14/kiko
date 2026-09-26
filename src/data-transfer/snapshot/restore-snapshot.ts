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
  type SettingsRow,
  settings,
  syncState,
  type TransactionRow,
  transactions,
} from '../../db/schema';
import { write } from '../../db/client';
import { chunkForTable } from '../../db/chunk-for-table';
import { upgradeLegacyDedupKey } from '../../statement-import/mapping/upgrade-dedup-key';

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

// Migration 0040's own predicate (`drizzle/migrations/0040_cleanup_stray_
// deposit_bond_balance.sql`'s doc comment is the full statement of WHY this
// can only ever match the pre-fix create-time bug, fixed in 63f9073, never a
// real balance): term_deposit/bond are ledgerless (their value derives
// entirely from metadata), and every current write path either writes 0
// unconditionally (create) or never touches `balanceMinorUnits` at all
// (`saveMetadataEdit`, every edit) — the SAME literal pair the SQL's own
// `IN (...)` names, not the wider `isLedgerlessHoldingType` set (property_item/
// metal/loan never had this create-time bug at all).
const STRAY_DEPOSIT_BOND_TYPES = new Set(['term_deposit', 'bond']);

/**
 * The one transaction a stray create wrote, if `transactionsForHolding` is
 * EXACTLY that one row and nothing else — conservative on purpose: a holding
 * with zero, two, or a differently-shaped transaction returns `undefined`
 * (left alone), since none of those can be this exact create-time artifact.
 */
const strayOpeningTransactionFor = (
  holding: HoldingRow,
  transactionsForHolding: TransactionRow[],
): TransactionRow | undefined => {
  if (!STRAY_DEPOSIT_BOND_TYPES.has(holding.type)) {
    return undefined;
  }
  if (holding.balanceMinorUnits === 0 || holding.balanceSetAt === null) {
    return undefined;
  }
  if (transactionsForHolding.length !== 1) {
    return undefined;
  }

  const [candidate] = transactionsForHolding;
  if (
    candidate === undefined ||
    !isBalanceSetShapedRow(candidate) ||
    candidate.amountMinorUnits !== holding.balanceMinorUnits ||
    candidate.time !== holding.balanceSetAt
  ) {
    return undefined;
  }

  return candidate;
};

/** Buckets a flat transaction list by `holdingId`, for a single pass over
 * `snapshot.transactions` rather than re-filtering it per holding. */
const transactionsByHoldingId = (
  allTransactions: TransactionRow[],
): Map<string, TransactionRow[]> => {
  const buckets = new Map<string, TransactionRow[]>();

  for (const row of allTransactions) {
    const bucket = buckets.get(row.holdingId);
    if (bucket === undefined) {
      buckets.set(row.holdingId, [row]);
      continue;
    }
    bucket.push(row);
  }

  return buckets;
};

/**
 * Migration 0040's cleanup, mirrored here for a `.kiko` restore, applied
 * AFTER `withLegacyBalanceSetAtBackfilled` above so a legacy (pre-0036)
 * snapshot's freshly-backfilled `balanceSetAt` still gets the same cleanup a
 * live device would apply on upgrade. Zeroes a matching holding's
 * `balanceMinorUnits`/`balanceSetAt` and drops its one matching transaction.
 */
const withStrayDepositBondBalanceCleaned = (
  snapshotHoldings: HoldingRow[],
  snapshotTransactions: TransactionRow[],
): { holdings: HoldingRow[]; transactions: TransactionRow[] } => {
  const buckets = transactionsByHoldingId(snapshotTransactions);
  const strayTransactionIds = new Set<string>();

  const cleanedHoldings = snapshotHoldings.map((holding) => {
    const stray = strayOpeningTransactionFor(holding, buckets.get(holding.id) ?? []);
    if (stray === undefined) {
      return holding;
    }

    strayTransactionIds.add(stray.id);
    return { ...holding, balanceMinorUnits: 0, balanceSetAt: null };
  });

  return {
    holdings: cleanedHoldings,
    transactions: snapshotTransactions.filter((row) => !strayTransactionIds.has(row.id)),
  };
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
      color: '#5E5CE6',
      sortOrder,
    },
  ];
};

/**
 * Migration 0041's flag and its launch-time rewrite (`upgradeStoredDedupKeys`)
 * only run on LIVE data — a `.kiko` restore REPLACES the whole
 * `transactions`/`settings` tables, so a pre-0041 export's legacy
 * statement-import dedup keys need the identical upgrade applied HERE, the
 * same way `withLegacyBalanceSetAtBackfilled` mirrors migration 0036.
 * `Object.hasOwn` detects the settings row's `dedupKeysUpgraded` key by
 * PRESENCE, not value — an already-0041-shaped snapshot's `false` (a device
 * that hadn't upgraded yet) is left exactly as exported, since that device's
 * own next launch runs the identical rewrite through `upgradeStoredDedupKeys`;
 * restoring it here too would just be redundant, never wrong, but this stays
 * a no-op to match every other "only a LEGACY export gets the mirror"
 * backfill in this file. An absent settings row (an empty `settings: []`
 * snapshot) is left alone entirely — there's nothing to flag.
 */
const withLegacyDedupKeysUpgraded = (
  snapshotSettings: SettingsRow[],
  snapshotTransactions: TransactionRow[],
): { settings: SettingsRow[]; transactions: TransactionRow[] } => {
  const [settingsRow] = snapshotSettings;
  if (settingsRow === undefined || Object.hasOwn(settingsRow, 'dedupKeysUpgraded')) {
    return { settings: snapshotSettings, transactions: snapshotTransactions };
  }

  const upgradedTransactions = snapshotTransactions.map((row) => {
    const upgradedExternalId = upgradeLegacyDedupKey(row);
    return upgradedExternalId === null ? row : { ...row, externalId: upgradedExternalId };
  });

  return {
    settings: [{ ...settingsRow, dedupKeysUpgraded: true }],
    transactions: upgradedTransactions,
  };
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

    // Legacy backfill runs first (it may turn a legacy null `balanceSetAt`
    // into the exact stray shape migration 0040 cleans), then the stray
    // cleanup — computed ONCE, ahead of both insert groups below, since it
    // decides what BOTH `holdings` and `transactions` actually insert.
    const boundaries = balanceSetAtBoundariesByHoldingId(snapshot.transactions);
    const holdingsAfterLegacyBackfill = snapshot.holdings.map((holding) =>
      withLegacyBalanceSetAtBackfilled(holding, boundaries),
    );
    const { holdings: holdingsToInsert, transactions: transactionsAfterStrayCleanup } =
      withStrayDepositBondBalanceCleaned(holdingsAfterLegacyBackfill, snapshot.transactions);

    // Independent of the two backfills above (a different table, a different
    // migration) — applied last, to the FINAL transaction set the stray
    // cleanup produced, since that's what actually gets inserted.
    const { settings: settingsToInsert, transactions: transactionsToInsert } =
      withLegacyDedupKeysUpgraded(snapshot.settings, transactionsAfterStrayCleanup);

    // Split into four sequential groups (rather than one 10-loop function) to
    // stay under the cognitive-complexity ceiling; overall parent-before-child
    // insert order is unchanged because the groups themselves run in order.
    const insertAccountsHoldingsCategories = async (): Promise<void> => {
      for (const part of chunkForTable(accounts, snapshot.accounts)) {
        await databaseTransaction.insert(accounts).values(part);
      }
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
      for (const part of chunkForTable(transactions, transactionsToInsert)) {
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
      for (const part of chunkForTable(settings, settingsToInsert)) {
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
