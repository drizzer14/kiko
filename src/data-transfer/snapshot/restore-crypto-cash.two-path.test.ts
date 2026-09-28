// src/data-transfer/snapshot/restore-crypto-cash.two-path.test.ts
//
// A pre-0044 `.kiko` export (a cash holding in a crypto currency) must
// restore to the EXACT SAME accounts/holdings rows a live device's own
// migration 0044 upgrade produces. Path 1 runs the REAL migration SQL
// against a REAL, in-process SQLite engine (`node:sqlite`,
// `applyMigrationsThrough`); path 2 reads an IDENTICALLY seeded database
// back through drizzle's own SELECT — the same shape `read-snapshot.ts`
// gives a `.kiko` export — and runs the pure JS mirror
// `withCryptoCashHoldingsMoved` on those rows. Comparing REAL rows on both
// sides (not two hand-typed object literals) is what proves the two paths
// actually agree.
import { join } from 'node:path';
import { asc } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { type database, accounts, holdings } from '@kiko/db';
import { applyMigrationsThrough, executingDrizzle } from '@kiko/test-support/real-sqlite';

import { withCryptoCashHoldingsMoved } from './restore-snapshot';

const MIGRATION_0044_SQL = readFileSync(
  join(__dirname, '..', '..', '..', 'drizzle', 'migrations', '0044_move_crypto_cash_holdings.sql'),
  'utf8',
);

const openSeededDatabase = (): DatabaseSync => {
  const rawDatabase = new DatabaseSync(':memory:');

  applyMigrationsThrough(rawDatabase, '0043_add_import_times_rezoned');
  rawDatabase.exec('PRAGMA foreign_keys = ON;');
  rawDatabase
    .prepare(
      "INSERT INTO accounts (id, name, kind, sort_order, created_at) VALUES ('acc-wallet', 'Wallet', 'cash', 3, 1700000000000)",
    )
    .run();
  rawDatabase
    .prepare(
      `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units, balance_set_at, icon, color, created_at)
       VALUES ('h-uah', 'acc-wallet', 'Cash', 'cash', 'UAH', 250000, 1700000100000, NULL, NULL, 1700000000000)`,
    )
    .run();
  rawDatabase
    .prepare(
      `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units, balance_set_at, icon, color, created_at)
       VALUES ('h-usdt', 'acc-wallet', 'Tether', 'cash', 'USDT', 150000000, 1700000100000, 'banknote', '#00FF00', 1700000000000)`,
    )
    .run();
  rawDatabase
    .prepare(
      `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units, created_at)
       VALUES ('h-btc', 'acc-wallet', 'Bitcoin', 'cash', 'BTC', 12345, 1700000000000)`,
    )
    .run();

  return rawDatabase;
};

const sortedById = <Row extends { id: string }>(rows: Row[]): Row[] =>
  [...rows].sort((left, right) => left.id.localeCompare(right.id));

describe('a pre-0044 .kiko restore ends byte-equal to the live migration 0044 upgrade', () => {
  it('produces IDENTICAL accounts and holdings rows on both paths (scenario A)', async () => {
    // Path 1: the LIVE database applies the real migration SQL directly.
    const liveDatabase = openSeededDatabase();
    liveDatabase.exec(MIGRATION_0044_SQL.split('--> statement-breakpoint').join('\n'));
    const liveDrizzle = executingDrizzle<typeof database>(liveDatabase);
    const liveAccounts = sortedById(
      await liveDrizzle.select().from(accounts).orderBy(asc(accounts.id)),
    );
    const liveHoldings = sortedById(
      await liveDrizzle.select().from(holdings).orderBy(asc(holdings.id)),
    );

    // Path 2: an IDENTICALLY seeded database, restored through the JS
    // mirror instead of the SQL migration.
    const restoredDatabase = openSeededDatabase();
    const restoredDrizzle = executingDrizzle<typeof database>(restoredDatabase);
    const preUpgradeAccounts = await restoredDrizzle.select().from(accounts);
    const preUpgradeHoldings = await restoredDrizzle.select().from(holdings);

    const mirrored = withCryptoCashHoldingsMoved(preUpgradeAccounts, preUpgradeHoldings);

    expect(sortedById(mirrored.accounts)).toEqual(liveAccounts);
    expect(sortedById(mirrored.holdings)).toEqual(liveHoldings);
  });

  it('is a true no-op (same array references) for a snapshot with no crypto cash holding', async () => {
    const database_ = executingDrizzle<typeof database>(openSeededDatabase());
    // Re-seed without any crypto currency: a plain UAH-only snapshot.
    const fiatOnlyAccounts = (await database_.select().from(accounts)) as never[];
    const fiatOnlyHoldings = (await database_.select().from(holdings)).filter(
      (holding: { currency: string }) => holding.currency === 'UAH',
    ) as never[];

    const result = withCryptoCashHoldingsMoved(fiatOnlyAccounts, fiatOnlyHoldings);

    expect(result.accounts).toBe(fiatOnlyAccounts);
    expect(result.holdings).toBe(fiatOnlyHoldings);
  });
});
