// Pure mapper: `ScreenshotDataset` (`../seed/screenshot-seed.ts`) ->
// `DataSnapshot` (`src/data-transfer/snapshot/data-snapshot.d.ts`). No DB, no
// `Date.now()`. `restoreDataSnapshot` (`src/data-transfer/snapshot/
// restore-snapshot.ts`) REPLACES every row in all 9 logical tables on
// import, so this populates every one of them — an incomplete snapshot would
// leave the imported app with no categories and no settings row.
import type {
  AccountRow,
  HoldingRow,
  CategoryRow,
  ReminderRow,
  SettingsRow,
  PricePointRow,
  TransactionRow,
} from '@kiko/db';
import { match } from 'ts-pattern';
import maybe, { foldMap } from 'fnts/maybe';
import { SETTINGS_ID } from '@kiko/settings';
import type { DataSnapshot } from '@kiko/data-transfer';
import { entityColorsDark } from '@kiko/design-system/palette';
import { holdingInstrument, metalInstrument } from '@kiko/prices/instrument';
import { readSeedCategoryColors } from '@kiko/db/__fixtures__/seed-category-colors';
import { SEEDED_CATEGORIES, LOAN_INTEREST_CATEGORY } from '@kiko/db/__fixtures__/seeded-categories';

import { ANCHOR, type ScreenshotDataset } from '../seed/screenshot-seed';

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

  return [
    ...SEEDED_CATEGORIES.map((category, index) => ({
      key: category.key,
      title: category.title,
      icon: category.icon,
      color: seedColors.get(category.key) ?? null,
      sortOrder: index,
    })),
    // Seeded on a fresh install by its own migration
    // (`0039_seed_loan_interest_category.sql`, colored systemIndigo), so the
    // linked loan payment's interest files under a named category.
    {
      ...LOAN_INTEREST_CATEGORY,
      color: entityColorsDark.indigo,
      sortOrder: SEEDED_CATEGORIES.length,
    },
  ];
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
    statementMappings: null,
    // This dataset never wrote a statement-import dedup key at all (every
    // transaction here is built by `buildLedger` below, not imported), so
    // there is nothing for `upgradeLegacyDedupKey` to rewrite — `true` skips
    // that pass entirely on import, the same as a real post-upgrade device.
    dedupKeysUpgraded: true,
    // Same reasoning: no imported row exists for `planImportTimeRezone` to
    // rewrite either, so `true` skips that pass too.
    importTimesRezoned: true,
    reminderOfferDismissals: null,
    notificationsDeliverableSince: null,
    quoteQuota: null,
  },
];

type BuiltLedger = {
  accounts: AccountRow[];
  holdings: HoldingRow[];
  transactions: TransactionRow[];
};

// `hold-1..n`, numbered across every account (not per-account) in dataset order.
const holdingIdsByKey = (dataset: ScreenshotDataset): Map<string, string> =>
  new Map(
    dataset.accounts
      .flatMap((account) => account.holdings)
      .flatMap(
        (holding, index) =>
          foldMap(maybe(holding.key), (key) => [[key, `hold-${index + 1}`] as const]) ?? [],
      ),
  );

// A key that names no holding is a broken dataset, not something to import.
const holdingIdOf = (idsByKey: ReadonlyMap<string, string>, key: string): string => {
  const id = idsByKey.get(key);

  if (id === undefined) {
    throw new Error(`The demo dataset names no holding with the key "${key}"`);
  }

  return id;
};

/**
 * Flattens the dataset's nested accounts/holdings/transactions into
 * deterministically-ided rows: `acc-1..n` for accounts, `hold-1..n` numbered
 * across every account (not per-account), `txn-1..n` numbered across every
 * transaction. Every `createdAt` is the dataset's own fixed `ANCHOR`, never a
 * clock, so the mapping never churns run to run. A transaction that pays a
 * loan is linked to it manually.
 */
const buildLedger = (dataset: ScreenshotDataset): BuiltLedger => {
  const accounts: AccountRow[] = [];
  const holdings: HoldingRow[] = [];
  const transactions: TransactionRow[] = [];
  const idsByKey = holdingIdsByKey(dataset);
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
        metadata: holding.metadata ?? null,
        sortOrder: holdingIndex,
        closedAt: null,
        createdAt: ANCHOR,
      });

      for (const transaction of holding.transactions) {
        transactionCount += 1;
        const loanHoldingId =
          foldMap(maybe(transaction.loanHoldingKey), (key) => holdingIdOf(idsByKey, key)) ?? null;

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
          loanHoldingId,
          loanLinkSource: loanHoldingId === null ? null : 'manual',
          loanLinkRejected: false,
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

// Each point keyed by the instrument `src/prices/instrument/` builds for it.
const buildPricePoints = (dataset: ScreenshotDataset): PricePointRow[] => {
  const idsByKey = holdingIdsByKey(dataset);

  return dataset.pricePoints.map(({ instrument, ...point }) => ({
    ...point,
    instrument: match(instrument)
      .with({ kind: 'holding' }, ({ holdingKey }) =>
        holdingInstrument(holdingIdOf(idsByKey, holdingKey)),
      )
      .with({ kind: 'metal' }, ({ metal }) => metalInstrument(metal))
      .exhaustive(),
  }));
};

// `rem-1..n`, numbered across every account, each on its own account's `acc-n`.
const buildReminders = (dataset: ScreenshotDataset): ReminderRow[] =>
  dataset.accounts
    .flatMap((account, accountIndex) =>
      (account.reminders ?? []).map((reminder) => ({
        ...reminder,
        accountId: `acc-${accountIndex + 1}`,
      })),
    )
    .map((reminder, index) => ({
      id: `rem-${index + 1}`,
      accountId: reminder.accountId,
      kind: reminder.kind,
      schedule: reminder.schedule,
      pausedAt: null,
      pauseReason: null,
      activeSince: ANCHOR,
      lastEngagedAt: null,
      lastSnoozedAt: null,
      createdAt: ANCHOR,
      updatedAt: ANCHOR,
    }));

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
    pricePoints: buildPricePoints(dataset),
    bondRegister: dataset.bondRegister,
    reminders: buildReminders(dataset),
  };
};
