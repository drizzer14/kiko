// A pre-0043 `.kiko` export (no `importTimesRezoned` key at all) must
// restore to the EXACT SAME rows a live device's own upgrade produces. Mocks
// `write` so `restoreDataSnapshot` runs its JS mirrors against a fake,
// row-capturing transaction handle — the same pattern
// `restore-snapshot.test.ts` uses — while the LIVE path runs
// `rezoneImportTimesIn` against a REAL, in-process `node:sqlite` engine
// (`@kiko/test-support/real-sqlite`), so this proves the two paths agree on
// what a real database ends up storing, not just on two JS object literals.
let mockDatabaseTransaction: unknown;
jest.mock('@kiko/db/client', () => {
  const actual = jest.requireActual('@kiko/db/client');

  return { ...actual, write: (work: (db: unknown) => unknown) => work(mockDatabaseTransaction) };
});

import {
  type database,
  type HoldingRow,
  type TransactionRow,
  holdings,
  settings,
  transactions,
} from '@kiko/db';
import { eq } from 'drizzle-orm';
import { DatabaseSync } from 'node:sqlite';
import { SETTINGS_ID } from '@kiko/settings';
import { mapParsedTransaction } from '@kiko/statement-import/mapping';
import { monobankCsvFormat } from '@kiko/statement-import/formats/monobank-csv';
import { applyMigrationsThrough, executingDrizzle } from '@kiko/test-support/real-sqlite';
import { monobankFixtureInput } from '@kiko/statement-import/formats/format-test-fixtures';
import { rezoneImportTime, rezoneImportTimesIn } from '@kiko/statement-import/rezone-import-times';

import type { DataSnapshot } from './data-snapshot';
import { restoreDataSnapshot } from './restore-snapshot';

const dedicatedMonobank = monobankCsvFormat.parse(monobankFixtureInput);
// The real Monobank fixture's own first and last rows — the same raw digits
// `monobank-csv.format.test.ts` pins, read as the LEGACY (pre-rezone) stored
// instant.
const LEGACY_FIRST_MILLISECONDS = Date.UTC(2022, 3, 1, 5, 27, 35);
const LEGACY_LAST_MILLISECONDS = Date.UTC(2023, 4, 12, 17, 30, 36);

const openTestDatabase = (): DatabaseSync => {
  const rawDatabase = new DatabaseSync(':memory:');

  applyMigrationsThrough(rawDatabase, '0042_uah_star_rates');
  rawDatabase.exec(
    'ALTER TABLE `settings` ADD `import_times_rezoned` integer DEFAULT false NOT NULL;',
  );
  rawDatabase.exec('PRAGMA foreign_keys = ON;');
  rawDatabase
    .prepare("INSERT INTO accounts (id, name, kind) VALUES ('a-1', 'Monobank', 'bank')")
    .run();
  rawDatabase
    .prepare(
      "INSERT INTO holdings (id, account_id, name, type, currency) VALUES ('h-1', 'a-1', 'Card', 'card', 'UAH')",
    )
    .run();
  rawDatabase
    .prepare(
      "INSERT INTO holdings (id, account_id, name, type, currency) VALUES ('h-2', 'a-1', 'Card 2', 'card', 'UAH')",
    )
    .run();

  return rawDatabase;
};

/** Seeds the SAME legacy dataset `rezone-import-times.test.ts` proves the
 * live upgrade against: 2 Monobank import rows (legacy time + key) and one
 * holding stamped with the newest import row's own legacy time. */
const seedLegacyData = async (drizzleDatabase: typeof database): Promise<void> => {
  const legacyFirstRow = mapParsedTransaction(
    { ...dedicatedMonobank.transactions[0], timeSeconds: LEGACY_FIRST_MILLISECONDS / 1000 },
    'h-1',
    0,
  );
  const legacyLastRow = mapParsedTransaction(
    { ...dedicatedMonobank.transactions[3], timeSeconds: LEGACY_LAST_MILLISECONDS / 1000 },
    'h-1',
    0,
  );

  await drizzleDatabase.insert(settings).values({ id: SETTINGS_ID });
  await drizzleDatabase.insert(transactions).values([
    { id: 'tx-import-1', ...legacyFirstRow },
    { id: 'tx-import-2', ...legacyLastRow },
  ]);
  await drizzleDatabase
    .update(holdings)
    .set({ balanceSetAt: LEGACY_LAST_MILLISECONDS })
    .where(eq(holdings.id, 'h-1'));
};

const sortedById = <Row extends { id: string }>(rows: Row[]): Row[] =>
  [...rows].sort((a, b) => a.id.localeCompare(b.id));

describe('a pre-0043 .kiko restore ends byte-equal to the live upgrade of the same data', () => {
  it('produces IDENTICAL transaction and holding rows on both paths', async () => {
    const rawDatabase = openTestDatabase();
    const drizzleDatabase = executingDrizzle<typeof database>(rawDatabase);

    await seedLegacyData(drizzleDatabase);

    // The exported (pre-restore) snapshot: the SAME rows the live database
    // currently holds, before either path rewrites anything — settings
    // carries no `importTimesRezoned` key at all, exactly a build-26 export.
    const preUpgradeTransactions = await drizzleDatabase.select().from(transactions);
    const preUpgradeHoldings = await drizzleDatabase.select().from(holdings);

    // Path 1: the LIVE database upgrades itself.
    await rezoneImportTimesIn(drizzleDatabase);
    const afterLiveUpgradeTransactions = sortedById(
      await drizzleDatabase.select().from(transactions),
    );
    const afterLiveUpgradeHoldings = sortedById(await drizzleDatabase.select().from(holdings));

    // Path 2: a `.kiko` restore of the PRE-upgrade export, through the JS
    // mirrors (`withLegacyDedupKeysUpgraded`, `withImportTimesRezoned`).
    const insertedRows: { transactions?: TransactionRow[]; holdings?: HoldingRow[] } = {};
    mockDatabaseTransaction = {
      delete: () => Promise.resolve(),
      insert: (table: unknown) => ({
        values: (rows: unknown[]) => {
          if (table === transactions) {
            insertedRows.transactions = [
              ...(insertedRows.transactions ?? []),
              ...(rows as TransactionRow[]),
            ];
          }

          if (table === holdings) {
            insertedRows.holdings = [...(insertedRows.holdings ?? []), ...(rows as HoldingRow[])];
          }

          return Promise.resolve();
        },
      }),
    };

    const snapshot: DataSnapshot = {
      accounts: [],
      holdings: preUpgradeHoldings as never,
      transactions: preUpgradeTransactions as never,
      currencyRates: [],
      currencyRateHistory: [],
      settings: [{ id: SETTINGS_ID, baseCurrency: 'UAH' }] as never,
      syncState: [],
      categories: [],
      categoryOverrides: [],
      pricePoints: [],
      bondRegister: [],
    };

    await restoreDataSnapshot(snapshot);

    const afterRestoreTransactions = sortedById(insertedRows.transactions ?? []);
    const afterRestoreHoldings = sortedById(insertedRows.holdings ?? []);

    expect(afterRestoreTransactions).toEqual(afterLiveUpgradeTransactions);
    expect(afterRestoreHoldings).toEqual(afterLiveUpgradeHoldings);
  });

  it('dedups a re-import of the same digits on BOTH the live-upgraded and the restored database', async () => {
    const rawDatabase = openTestDatabase();
    const drizzleDatabase = executingDrizzle<typeof database>(rawDatabase);

    await seedLegacyData(drizzleDatabase);
    await rezoneImportTimesIn(drizzleDatabase);

    const reimportedFirst = mapParsedTransaction(
      {
        ...dedicatedMonobank.transactions[0],
        timeSeconds: rezoneImportTime(LEGACY_FIRST_MILLISECONDS) / 1000,
      },
      'h-1',
      0,
    );
    const reimportedLast = mapParsedTransaction(
      {
        ...dedicatedMonobank.transactions[3],
        timeSeconds: rezoneImportTime(LEGACY_LAST_MILLISECONDS) / 1000,
      },
      'h-1',
      0,
    );

    const beforeCount = (await drizzleDatabase.select().from(transactions)).length;

    await drizzleDatabase
      .insert(transactions)
      .values([
        { id: 'tx-reimport-1', ...reimportedFirst },
        { id: 'tx-reimport-2', ...reimportedLast },
      ])
      .onConflictDoNothing({ target: [transactions.source, transactions.externalId] });

    const afterCount = (await drizzleDatabase.select().from(transactions)).length;

    expect(afterCount).toBe(beforeCount);
  });
});
