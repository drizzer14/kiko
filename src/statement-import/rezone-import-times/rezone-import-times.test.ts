import { eq } from 'drizzle-orm';
import { DatabaseSync } from 'node:sqlite';
import { SETTINGS_ID } from '@kiko/settings';
import { type database, holdings, settings, transactions } from '@kiko/db';
import { monobankCsvFormat } from '@kiko/statement-import/formats/monobank-csv';
import { applyAllMigrations, executingDrizzle } from '@kiko/test-support/real-sqlite';
import { monobankFixtureInput } from '@kiko/statement-import/formats/format-test-fixtures';

import { mapParsedTransaction } from '../mapping';

import { rezoneImportTimesIn } from './rezone-import-times';
import { rezoneImportTime } from './plan-import-time-rezone';

// The real Monobank fixture's own first and last rows — the same raw digits
// `monobank-csv.format.test.ts` pins ("01.04.2022 05:27:35",
// "12.05.2023 17:30:36") — read as a LEGACY (pre-rezone) stored instant, the
// "wall clock written as UTC" convention every import row used before this
// change.
const dedicatedMonobank = monobankCsvFormat.parse(monobankFixtureInput);
const LEGACY_FIRST_MILLISECONDS = Date.UTC(2022, 3, 1, 5, 27, 35);
const LEGACY_LAST_MILLISECONDS = Date.UTC(2023, 4, 12, 17, 30, 36);

// Applies every migration, as `MigrationsGate` does before it runs the
// rezone. Seeding and reading through the real, EXECUTING Drizzle instance
// below names every column Drizzle's own schema knows about (including
// `import_times_rezoned` and the later reminders columns), so each of them
// must already exist. The legacy rows are seeded after the migrations, so
// the data-only migrations have nothing to move.
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

/** Seeds a realistic legacy dataset (pre-0043 shape) directly through the
 * real, EXECUTING Drizzle instance: 2 Monobank import rows (legacy time +
 * key), 1 manual row, 1 monobank sync row, `h-1.balanceSetAt` equal to the
 * newest import row's own legacy time, and `h-2.balanceSetAt` an unrelated
 * manual stamp. */
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

const dumpAll = async (
  drizzleDatabase: typeof database,
): Promise<{
  transactions: (typeof transactions.$inferSelect)[];
  holdings: (typeof holdings.$inferSelect)[];
  settings: (typeof settings.$inferSelect)[];
}> => ({
  transactions: (await drizzleDatabase.select().from(transactions)).sort((a, b) =>
    a.id.localeCompare(b.id),
  ),
  holdings: (await drizzleDatabase.select().from(holdings)).sort((a, b) =>
    a.id.localeCompare(b.id),
  ),
  settings: await drizzleDatabase.select().from(settings),
});

describe('rezoneImportTimesIn (real SQLite)', () => {
  it('moves every import row to the Kyiv reading, leaves manual/sync rows and every balance untouched', async () => {
    const rawDatabase = openTestDatabase();
    const drizzleDatabase = executingDrizzle<typeof database>(rawDatabase);

    await seedLegacyData(drizzleDatabase);

    await rezoneImportTimesIn(drizzleDatabase);

    const rows = await drizzleDatabase.select().from(transactions);
    const byId = new Map(rows.map((row) => [row.id, row]));

    const expectedFirstTime = rezoneImportTime(LEGACY_FIRST_MILLISECONDS);
    const expectedLastTime = rezoneImportTime(LEGACY_LAST_MILLISECONDS);
    const expectedFirstRow = mapParsedTransaction(
      { ...dedicatedMonobank.transactions[0], timeSeconds: expectedFirstTime / 1000 },
      'h-1',
      0,
    );
    const expectedLastRow = mapParsedTransaction(
      { ...dedicatedMonobank.transactions[3], timeSeconds: expectedLastTime / 1000 },
      'h-1',
      0,
    );

    expect(byId.get('tx-import-1')?.time).toBe(expectedFirstTime);
    expect(byId.get('tx-import-1')?.externalId).toBe(expectedFirstRow.externalId);
    expect(byId.get('tx-import-2')?.time).toBe(expectedLastTime);
    expect(byId.get('tx-import-2')?.externalId).toBe(expectedLastRow.externalId);

    // Manual and sync rows never move.
    expect(byId.get('tx-manual-1')?.time).toBe(1_700_000_000_000);
    expect(byId.get('tx-manual-1')?.externalId).toBeNull();
    expect(byId.get('tx-sync-1')?.time).toBe(1_700_000_500_000);
    expect(byId.get('tx-sync-1')?.externalId).toBe('sync-ext-1');

    // balanceMinorUnits is never written by this step.
    const storedHoldings = await drizzleDatabase.select().from(holdings);

    expect(storedHoldings.every((holding) => holding.balanceMinorUnits === 0)).toBe(true);

    const holdingOne = storedHoldings.find((holding) => holding.id === 'h-1');
    const holdingTwo = storedHoldings.find((holding) => holding.id === 'h-2');

    // h-1's balanceSetAt equalled the newest import row's OLD time, so it
    // moves to that row's NEW time.
    expect(holdingOne?.balanceSetAt).toBe(expectedLastTime);
    // h-2's stamp matches no import row's time at all — untouched.
    expect(holdingTwo?.balanceSetAt).toBe(1_790_000_000_123);
  });

  it('dedups a re-import of the SAME digits through column mapping (0 new rows)', async () => {
    const rawDatabase = openTestDatabase();
    const drizzleDatabase = executingDrizzle<typeof database>(rawDatabase);

    await seedLegacyData(drizzleDatabase);
    await rezoneImportTimesIn(drizzleDatabase);

    // Column mapping reads the SAME raw digits as Kyiv time too
    // (`rezoneImportTime` IS that same reading), so a re-import
    // through column mapping reproduces the identical (time, externalId)
    // pair for each row and must dedup against what the rezone just wrote.
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

  it('is idempotent: a second run changes nothing', async () => {
    const rawDatabase = openTestDatabase();
    const drizzleDatabase = executingDrizzle<typeof database>(rawDatabase);

    await seedLegacyData(drizzleDatabase);
    await rezoneImportTimesIn(drizzleDatabase);

    const afterFirstRun = await dumpAll(drizzleDatabase);

    await rezoneImportTimesIn(drizzleDatabase);

    const afterSecondRun = await dumpAll(drizzleDatabase);

    expect(afterSecondRun).toEqual(afterFirstRun);
  });

  // Without phase A's temporary key, updating rowB's key to exactly what
  // rowA's OLD key still holds (before rowA itself is rewritten) would trip
  // the (source, external_id) UNIQUE index mid-statement.
  it('never trips the UNIQUE index on a transient key collision', async () => {
    const rawDatabase = openTestDatabase();
    const drizzleDatabase = executingDrizzle<typeof database>(rawDatabase);

    await drizzleDatabase.insert(settings).values({ id: SETTINGS_ID });

    // A midnight (date-only) legacy row always moves on to noon Kyiv, nine
    // or ten hours later, on rezone — so rowA's
    // pre-rezone digits below can never equal its own rezoned instant, which
    // is what lets rowB's (distinct) pre-rezone time be set to exactly that
    // rezoned instant without the seed insert itself colliding.
    const legacyA = Date.UTC(2026, 0, 15, 0, 0, 0);
    const rezonedA = rezoneImportTime(legacyA);
    // rowB's OLD time is deliberately set to rowA's OWN rezoned instant, so
    // rowB's CURRENT key already equals what rowA's key becomes.
    const legacyB = rezonedA;
    const transaction = { currency: 'UAH' as const, amountMinorUnits: -100, description: 'coffee' };

    const rowA = mapParsedTransaction({ ...transaction, timeSeconds: legacyA / 1000 }, 'h-1', 0);
    const rowB = mapParsedTransaction({ ...transaction, timeSeconds: legacyB / 1000 }, 'h-1', 0);

    await drizzleDatabase.insert(transactions).values([
      { id: 'tx-a', ...rowA },
      { id: 'tx-b', ...rowB },
    ]);

    await expect(rezoneImportTimesIn(drizzleDatabase)).resolves.toBeUndefined();

    const rows = await drizzleDatabase.select().from(transactions);
    const externalIds = rows.map((row) => row.externalId);

    expect(new Set(externalIds).size).toBe(externalIds.length);
  });

  it('rolls back completely on a crash partway through phase B, leaving the flag false', async () => {
    const rawDatabase = openTestDatabase();
    const drizzleDatabase = executingDrizzle<typeof database>(rawDatabase);

    await seedLegacyData(drizzleDatabase);

    const beforeCrash = await dumpAll(drizzleDatabase);

    const crashingRawDatabase = new Proxy(rawDatabase, {
      get(target, property, receiver) {
        if (property !== 'prepare') {
          return Reflect.get(target, property, receiver);
        }

        return (sql: string) => {
          if (sql.includes('time = (SELECT')) {
            throw new Error('injected crash for test');
          }

          return target.prepare(sql);
        };
      },
    });
    const crashingDrizzleDatabase = executingDrizzle<typeof database>(crashingRawDatabase);

    rawDatabase.exec('BEGIN');

    // Drizzle wraps the injected error in its own query-context error, so
    // only the crash's OWN cause is asserted here — the meaningful proof is
    // the post-rollback state below.
    await expect(rezoneImportTimesIn(crashingDrizzleDatabase)).rejects.toMatchObject({
      cause: expect.objectContaining({ message: 'injected crash for test' }),
    });

    rawDatabase.exec('ROLLBACK');

    const afterRollback = await dumpAll(drizzleDatabase);

    expect(afterRollback).toEqual(beforeCrash);
    expect(afterRollback.settings[0]?.importTimesRezoned).toBe(false);
  });

  it('flips the flag and changes nothing else on an empty database', async () => {
    const rawDatabase = openTestDatabase();
    const drizzleDatabase = executingDrizzle<typeof database>(rawDatabase);

    await drizzleDatabase.insert(settings).values({ id: SETTINGS_ID });

    await rezoneImportTimesIn(drizzleDatabase);

    const storedSettings = await drizzleDatabase.select().from(settings);
    const storedTransactions = await drizzleDatabase.select().from(transactions);

    expect(storedSettings[0]?.importTimesRezoned).toBe(true);
    expect(storedTransactions).toEqual([]);
  });

  it('is a no-op when the flag is already true', async () => {
    const rawDatabase = openTestDatabase();
    const drizzleDatabase = executingDrizzle<typeof database>(rawDatabase);

    await seedLegacyData(drizzleDatabase);
    await drizzleDatabase
      .update(settings)
      .set({ importTimesRezoned: true })
      .where(eq(settings.id, SETTINGS_ID));

    const before = await dumpAll(drizzleDatabase);

    await rezoneImportTimesIn(drizzleDatabase);

    const after = await dumpAll(drizzleDatabase);

    expect(after).toEqual(before);
  });
});
