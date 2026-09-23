// Pure mapper: `ScreenshotDataset` (`../seed/screenshot-seed.ts`) ->
// `DataSnapshot` (`src/data-transfer/snapshot/data-snapshot.d.ts`). No DB, no
// `Date.now()`. `restoreDataSnapshot` (`src/data-transfer/snapshot/
// restore-snapshot.ts`) REPLACES every row in all 9 logical tables on
// import, so this populates every one of them — an incomplete snapshot would
// leave the imported app with no categories and no settings row.
import type {
  AccountRow,
  CategoryRow,
  HoldingRow,
  SettingsRow,
  TransactionRow,
} from '../../../src/db/schema';

import { SETTINGS_ID } from '../../../src/settings/settings.repo';
import { ANCHOR, type ScreenshotDataset } from '../seed/screenshot-seed';
import { SEEDED_CATEGORIES } from '../../../src/db/__fixtures__/seeded-categories';
import type { DataSnapshot } from '../../../src/data-transfer/snapshot/data-snapshot';
import { readSeedCategoryColors } from '../../../src/db/__fixtures__/seed-category-colors';

/**
 * The 10 default categories, sourced from the same fixture the repo tests
 * use, with each `color` taken from the same branded-colors migration
 * (`drizzle/migrations/0017_default_category_colors.sql`, parsed by
 * `readSeedCategoryColors`) that a real fresh install seeds. Importing the
 * demo `.kiko` REPLACES the whole `categories` table (see the module
 * comment above), so leaving `color: null` here would overwrite the
 * migration's branded colors with `resolveCategoryColor`'s hashed
 * fallback — different colors than the committed App Store screenshots
 * were shot with.
 */
const buildCategories = (): CategoryRow[] => {
  const seedColors = new Map(readSeedCategoryColors().map((seed) => [seed.key, seed.color]));

  return SEEDED_CATEGORIES.map((category, index) => ({
    key: category.key,
    title: category.title,
    icon: category.icon,
    color: seedColors.get(category.key) ?? null,
    sortOrder: index,
  }));
};

/** The single settings row: the dataset's language/currency, lock always OFF. */
const buildSettings = (dataset: ScreenshotDataset): SettingsRow[] => [
  {
    id: SETTINGS_ID,
    baseCurrency: dataset.baseCurrency,
    lastSyncAt: null,
    defaultCategoryKey: 'other',
    // Never true: importing a locked snapshot would put a reviewer behind a
    // Face ID / passcode gate on a device that may have no biometric enrolled.
    lockEnabled: false,
    lockGraceSeconds: 30,
    language: dataset.language,
    appearance: 'system',
    lastSyncDisplayAt: null,
    lastFullSyncAt: null,
    trendCategoryKeys: null,
    trendFilter: null,
    failedSyncMonobankIds: null,
  },
];

type BuiltLedger = {
  accounts: AccountRow[];
  holdings: HoldingRow[];
  transactions: TransactionRow[];
};

/**
 * Flattens the dataset's nested accounts/holdings/transactions into
 * deterministically-ided rows: `acc-1..n` for accounts, `hold-1..n` numbered
 * across every account (not per-account), `txn-1..n` numbered across every
 * transaction. Every `createdAt` is the dataset's own fixed `ANCHOR`, never a
 * clock, so the mapping never churns run to run.
 */
const buildLedger = (dataset: ScreenshotDataset): BuiltLedger => {
  const accounts: AccountRow[] = [];
  const holdings: HoldingRow[] = [];
  const transactions: TransactionRow[] = [];
  let holdingCount = 0;
  let transactionCount = 0;

  dataset.accounts.forEach((account, accountIndex) => {
    const accountId = `acc-${accountIndex + 1}`;

    accounts.push({
      id: accountId,
      name: account.name,
      kind: account.kind,
      institution: null,
      bankId: null,
      icon: null,
      color: account.color,
      sortOrder: accountIndex,
      archivedAt: null,
      createdAt: ANCHOR,
    });

    account.holdings.forEach((holding, holdingIndex) => {
      holdingCount += 1;
      const holdingId = `hold-${holdingCount}`;
      const balanceMinorUnits = holding.transactions.reduce(
        (total, transaction) => total + transaction.amountMinorUnits,
        0,
      );

      holdings.push({
        id: holdingId,
        accountId,
        name: holding.name,
        type: holding.type,
        currency: holding.currency,
        icon: null,
        color: holding.color,
        balanceMinorUnits,
        syncedBalanceMinorUnits: null,
        balanceSetAt: null,
        metadata: null,
        sortOrder: holdingIndex,
        closedAt: null,
        createdAt: ANCHOR,
      });

      for (const transaction of holding.transactions) {
        transactionCount += 1;

        transactions.push({
          id: `txn-${transactionCount}`,
          holdingId,
          amountMinorUnits: transaction.amountMinorUnits,
          time: transaction.time,
          description: transaction.description,
          category: transaction.category,
          mcc: null,
          hold: null,
          counterIban: null,
          exchangeCounterpartHoldingId: null,
          changeGroupId: null,
          comment: null,
          source: 'manual',
          externalId: null,
          createdAt: ANCHOR,
        });
      }
    });
  });

  return { accounts, holdings, transactions };
};

export const buildDemoSnapshot = (dataset: ScreenshotDataset): DataSnapshot => {
  const ledger = buildLedger(dataset);

  return {
    accounts: ledger.accounts,
    holdings: ledger.holdings,
    transactions: ledger.transactions,
    currencyRates: dataset.rates,
    currencyRateHistory: dataset.history,
    settings: buildSettings(dataset),
    syncState: [],
    categories: buildCategories(),
    categoryOverrides: [],
  };
};
