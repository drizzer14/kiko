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
// actually agree, across every matching-rule scenario: no eligible target,
// an eligible target competing with Binance/an archived account, a
// sort_order tie, and an archived SOURCE account.
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import {
  columnsWithout,
  applyMigrationsThrough,
  executingDrizzle,
} from '@kiko/test-support/real-sqlite';
import { DatabaseSync } from 'node:sqlite';
import { asc, getTableColumns } from 'drizzle-orm';
import { type database, accounts, type HoldingRow, holdings } from '@kiko/db';

import { withCryptoCashHoldingsMoved } from './restore-snapshot';

const MIGRATION_0044_SQL = readFileSync(
  join(__dirname, '..', '..', '..', 'drizzle', 'migrations', '0044_move_crypto_cash_holdings.sql'),
  'utf8',
);

type AccountSeed = {
  id: string;
  name: string;
  kind: string;
  institution?: string | null;
  sortOrder?: number;
  archivedAt?: number | null;
  createdAt?: number;
};

// A full select names `balance_set_row_id`, which arrives only with migration
// 0047, after this test's 0043 database.
const holdingRowsOf = async (source: typeof database): Promise<HoldingRow[]> =>
  (await source
    .select(columnsWithout(getTableColumns(holdings), 'balanceSetRowId'))
    .from(holdings)
    .orderBy(asc(holdings.id))) as HoldingRow[];

const newMigratedDatabase = (): DatabaseSync => {
  const rawDatabase = new DatabaseSync(':memory:');

  applyMigrationsThrough(rawDatabase, '0043_add_import_times_rezoned');
  rawDatabase.exec('PRAGMA foreign_keys = ON;');

  return rawDatabase;
};

const insertAccount = (database: DatabaseSync, account: AccountSeed): void => {
  database
    .prepare(
      `INSERT INTO accounts (id, name, kind, institution, sort_order, archived_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      account.id,
      account.name,
      account.kind,
      account.institution ?? null,
      account.sortOrder ?? 0,
      account.archivedAt ?? null,
      account.createdAt ?? 1_700_000_000_000,
    );
};

const insertCryptoCashHolding = (
  database: DatabaseSync,
  holding: { id: string; accountId: string; name: string; currency: string },
): void => {
  database
    .prepare(
      `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units, created_at)
       VALUES (?, ?, ?, 'cash', ?, 100, 1700000000000)`,
    )
    .run(holding.id, holding.accountId, holding.name, holding.currency);
};

const sortedById = <Row extends { id: string }>(rows: Row[]): Row[] =>
  [...rows].sort((left, right) => left.id.localeCompare(right.id));

type Scenario = { name: string; seed: (database: DatabaseSync) => void };

const scenarios: Scenario[] = [
  {
    name: 'creates crypto-from-<source> when no eligible crypto account exists',
    seed: (database) => {
      insertAccount(database, { id: 'acc-wallet', name: 'Wallet', kind: 'cash', sortOrder: 3 });
      insertCryptoCashHolding(database, {
        id: 'h-usdt',
        accountId: 'acc-wallet',
        name: 'Tether',
        currency: 'USDT',
      });
      insertCryptoCashHolding(database, {
        id: 'h-btc',
        accountId: 'acc-wallet',
        name: 'Bitcoin',
        currency: 'BTC',
      });
    },
  },
  {
    // Scenario A (plan): a Binance account, an archived crypto account, and
    // one eligible manual crypto account — the holding must go to the
    // eligible one, never Binance or the archived one.
    name: 'reuses the first eligible manual crypto account over Binance and an archived one',
    seed: (database) => {
      insertAccount(database, {
        id: 'acc-binance',
        name: 'Binance',
        kind: 'crypto',
        institution: 'binance',
        sortOrder: 0,
      });
      insertAccount(database, {
        id: 'acc-archived',
        name: 'Old wallet',
        kind: 'crypto',
        sortOrder: 1,
        archivedAt: 1_690_000_000_000,
      });
      insertAccount(database, { id: 'acc-cold', name: 'Cold', kind: 'crypto', sortOrder: 2 });
      insertAccount(database, { id: 'acc-wallet', name: 'Wallet', kind: 'cash', sortOrder: 3 });
      insertCryptoCashHolding(database, {
        id: 'h-usdt',
        accountId: 'acc-wallet',
        name: 'Tether',
        currency: 'USDT',
      });
    },
  },
  {
    name: 'breaks a sort_order tie by created_at, then by id',
    seed: (database) => {
      // All three share sort_order 0. acc-x-later has the latest
      // created_at, so it loses to the other two; those tie on created_at
      // too, so the lower id (aaaaa-tie) wins over bbbbb-tie.
      insertAccount(database, { id: 'acc-x-later', name: 'X', kind: 'crypto', createdAt: 200 });
      insertAccount(database, { id: 'bbbbb-tie', name: 'B', kind: 'crypto', createdAt: 100 });
      insertAccount(database, { id: 'aaaaa-tie', name: 'A', kind: 'crypto', createdAt: 100 });
      insertAccount(database, { id: 'acc-wallet', name: 'Wallet', kind: 'cash', sortOrder: 3 });
      insertCryptoCashHolding(database, {
        id: 'h-usdt',
        accountId: 'acc-wallet',
        name: 'Tether',
        currency: 'USDT',
      });
    },
  },
  {
    // The archived-source ruling: an archived source's holding never joins
    // a LIVE reuse target, even though 'acc-cold' is perfectly eligible.
    name: "never moves an archived source's holding onto a live reuse target",
    seed: (database) => {
      insertAccount(database, { id: 'acc-cold', name: 'Cold', kind: 'crypto', sortOrder: 0 });
      insertAccount(database, {
        id: 'acc-archived-wallet',
        name: 'Old wallet',
        kind: 'cash',
        sortOrder: 5,
        archivedAt: 1_690_000_000_000,
      });
      insertCryptoCashHolding(database, {
        id: 'h-usdt-archived',
        accountId: 'acc-archived-wallet',
        name: 'Tether',
        currency: 'USDT',
      });
    },
  },
];

describe('a pre-0044 .kiko restore ends byte-equal to the live migration 0044 upgrade', () => {
  describe.each(scenarios)('$name', ({ seed }) => {
    it('produces IDENTICAL accounts and holdings rows on both paths', async () => {
      // Path 1: the LIVE database applies the real migration SQL directly.
      const liveDatabase = newMigratedDatabase();
      seed(liveDatabase);
      liveDatabase.exec(MIGRATION_0044_SQL.split('--> statement-breakpoint').join('\n'));
      const liveDrizzle = executingDrizzle<typeof database>(liveDatabase);
      const liveAccounts = sortedById(
        await liveDrizzle.select().from(accounts).orderBy(asc(accounts.id)),
      );
      const liveHoldings = sortedById(await holdingRowsOf(liveDrizzle));

      // Path 2: an IDENTICALLY seeded database, restored through the JS
      // mirror instead of the SQL migration.
      const restoredDatabase = newMigratedDatabase();
      seed(restoredDatabase);
      const restoredDrizzle = executingDrizzle<typeof database>(restoredDatabase);
      const preUpgradeAccounts = await restoredDrizzle.select().from(accounts);
      const preUpgradeHoldings = await holdingRowsOf(restoredDrizzle);

      const mirrored = withCryptoCashHoldingsMoved(preUpgradeAccounts, preUpgradeHoldings);

      expect(sortedById(mirrored.accounts)).toEqual(liveAccounts);
      expect(sortedById(mirrored.holdings)).toEqual(liveHoldings);
    });
  });

  it('is a true no-op (same array references) for a snapshot with no crypto cash holding', async () => {
    const noOpDatabase = newMigratedDatabase();
    insertAccount(noOpDatabase, { id: 'acc-wallet', name: 'Wallet', kind: 'cash', sortOrder: 3 });
    noOpDatabase
      .prepare(
        `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units, created_at)
         VALUES ('h-uah', 'acc-wallet', 'Cash', 'cash', 'UAH', 250000, 1700000000000)`,
      )
      .run();
    const noOpDrizzle = executingDrizzle<typeof database>(noOpDatabase);
    const fiatOnlyAccounts = await noOpDrizzle.select().from(accounts);
    const fiatOnlyHoldings = await holdingRowsOf(noOpDrizzle);

    const result = withCryptoCashHoldingsMoved(fiatOnlyAccounts, fiatOnlyHoldings);

    expect(result.accounts).toBe(fiatOnlyAccounts);
    expect(result.holdings).toBe(fiatOnlyHoldings);
  });
});
