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
import {
  computeDedupKeyBase,
  mapParsedTransaction,
  upgradeLegacyDedupKey,
} from '@kiko/statement-import/mapping';
import { DatabaseSync } from 'node:sqlite';
import { SETTINGS_ID } from '@kiko/settings';
import { monobankCsvFormat } from '@kiko/statement-import/formats/monobank-csv';
import { applyAllMigrations, executingDrizzle } from '@kiko/test-support/real-sqlite';
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
// A legacy (pre-`␟`) occurrence-suffixed key, on its own row so it never
// interacts with the Monobank rows' own keys above.
const LEGACY_SUFFIX_MILLISECONDS = Date.UTC(2026, 2, 3, 9, 45, 0);
// A midnight (date-only) row and a noon row, same holding/amount/description,
// that both rezone onto the exact same instant — the planner's own
// collision-renumbering proof, exercised here through both real paths.
const MIDNIGHT_LEGACY_MILLISECONDS = Date.UTC(2026, 2, 20, 0, 0, 0);
const NOON_LEGACY_MILLISECONDS = Date.UTC(2026, 2, 20, 12, 0, 0);

/** Mirrors `upgradeStoredDedupKeys`' own rewrite (`upgrade-stored-dedup-
 * keys.ts`) against this file's real, in-process test database directly —
 * that function's own export always goes through the app's real `write()`,
 * which this file's module-level `jest.mock` only ever wires to the
 * restore path's row-capturing fake, never to a raw `node:sqlite` instance.
 * Needed so the LIVE path below runs the two upgrades in the SAME order
 * production does (dedup-key upgrade, then rezone — `migrations.gate.tsx`),
 * matching what the restore mirror already does unconditionally
 * (`withLegacyDedupKeysUpgraded` before `withImportTimesRezoned`). */
const upgradeLegacyDedupKeysIn = async (drizzleDatabase: typeof database): Promise<void> => {
  const importRows = await drizzleDatabase
    .select({
      id: transactions.id,
      holdingId: transactions.holdingId,
      time: transactions.time,
      amountMinorUnits: transactions.amountMinorUnits,
      description: transactions.description,
      source: transactions.source,
      externalId: transactions.externalId,
    })
    .from(transactions)
    .where(eq(transactions.source, 'import'));

  for (const row of importRows) {
    const upgraded = upgradeLegacyDedupKey(row);

    if (upgraded !== null) {
      await drizzleDatabase
        .update(transactions)
        .set({ externalId: upgraded })
        .where(eq(transactions.id, row.id));
    }
  }
};

// Applies every migration, as `MigrationsGate` does before it runs the
// rezone: seeding through the EXECUTING Drizzle instance names every column
// Drizzle's own schema knows about, including the later reminders columns.
const openTestDatabase = (): DatabaseSync => {
  const rawDatabase = new DatabaseSync(':memory:');

  applyAllMigrations(rawDatabase);
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

/** Seeds a realistic legacy dataset (pre-0043 shape): 2 Monobank import rows
 * (legacy time + key), a legacy (pre-`␟`) occurrence-suffixed import row, a
 * midnight/noon pair that collides once rezoned, 1 manual row, 1 monobank
 * sync row, `h-1.balanceSetAt` equal to the newest import row's own legacy
 * time, and `h-2.balanceSetAt` an unrelated manual stamp. */
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
  const legacySuffixBase = computeDedupKeyBase(
    'h-1',
    LEGACY_SUFFIX_MILLISECONDS / 1000,
    -350,
    'legacy suffix key',
  );
  const collisionRow = (timeSeconds: number) =>
    mapParsedTransaction(
      {
        currency: 'UAH' as const,
        amountMinorUnits: -450,
        description: 'midnight-noon collision',
        timeSeconds,
      },
      'h-1',
      0,
    );

  await drizzleDatabase.insert(settings).values({ id: SETTINGS_ID });
  await drizzleDatabase.insert(transactions).values([
    { id: 'tx-import-1', ...legacyFirstRow },
    { id: 'tx-import-2', ...legacyLastRow },
    {
      id: 'tx-import-legacy-suffix',
      holdingId: 'h-1',
      amountMinorUnits: -350,
      time: LEGACY_SUFFIX_MILLISECONDS,
      description: 'legacy suffix key',
      source: 'import',
      externalId: `${legacySuffixBase} 1`,
    },
    { id: 'tx-import-midnight', ...collisionRow(MIDNIGHT_LEGACY_MILLISECONDS / 1000) },
    { id: 'tx-import-noon', ...collisionRow(NOON_LEGACY_MILLISECONDS / 1000) },
    {
      id: 'tx-manual-1',
      holdingId: 'h-1',
      amountMinorUnits: -500,
      time: 1_700_000_000_000,
      source: 'manual',
      externalId: null,
    },
    {
      id: 'tx-sync-1',
      holdingId: 'h-1',
      amountMinorUnits: -700,
      time: 1_700_000_500_000,
      source: 'monobank',
      externalId: 'sync-ext-1',
    },
  ]);
  await drizzleDatabase
    .update(holdings)
    .set({ balanceSetAt: LEGACY_LAST_MILLISECONDS })
    .where(eq(holdings.id, 'h-1'));
  await drizzleDatabase
    .update(holdings)
    .set({ balanceSetAt: 1_790_000_000_123 })
    .where(eq(holdings.id, 'h-2'));
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
    // carries no `importTimesRezoned` key at all, matching a real pre-0043
    // export.
    const preUpgradeTransactions = await drizzleDatabase.select().from(transactions);
    const preUpgradeHoldings = await drizzleDatabase.select().from(holdings);

    // Path 1: the LIVE database upgrades itself, in production's own order
    // (dedup-key upgrade, then rezone — see `upgradeLegacyDedupKeysIn`'s doc
    // comment).
    await upgradeLegacyDedupKeysIn(drizzleDatabase);
    await rezoneImportTimesIn(drizzleDatabase);
    const afterLiveUpgradeTransactions = sortedById(
      await drizzleDatabase.select().from(transactions),
    );
    const afterLiveUpgradeHoldings = sortedById(await drizzleDatabase.select().from(holdings));

    // Path 2: a `.kiko` restore of the PRE-upgrade export, through the JS
    // mirrors (`withLegacyDedupKeysUpgraded`, `withImportTimesRezoned`).
    const insertedRows: {
      transactions?: TransactionRow[];
      holdings?: HoldingRow[];
      settings?: { importTimesRezoned: boolean }[];
    } = {};
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

          if (table === settings) {
            insertedRows.settings = [
              ...(insertedRows.settings ?? []),
              ...(rows as { importTimesRezoned: boolean }[]),
            ];
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
      reminders: [],
    };

    await restoreDataSnapshot(snapshot);

    const afterRestoreTransactions = sortedById(insertedRows.transactions ?? []);
    const afterRestoreHoldings = sortedById(insertedRows.holdings ?? []);

    expect(afterRestoreTransactions).toEqual(afterLiveUpgradeTransactions);
    expect(afterRestoreHoldings).toEqual(afterLiveUpgradeHoldings);
    // Both paths must end with the flag true — a restore replaces the whole
    // database, so there is no live device left to retry.
    expect(insertedRows.settings?.[0]?.importTimesRezoned).toBe(true);
  });

  it('dedups a re-import of the same digits on BOTH the live-upgraded and the restored database', async () => {
    const rawDatabase = openTestDatabase();
    const drizzleDatabase = executingDrizzle<typeof database>(rawDatabase);

    await seedLegacyData(drizzleDatabase);
    await upgradeLegacyDedupKeysIn(drizzleDatabase);
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
