// src/data-transfer/snapshot/restore-account-currency.two-path.test.ts
//
// A `.kiko` file written before the account currency column carries no `currency` on its
// accounts. It must restore to the same accounts as a live device that ran migration 0062 on the
// same data. The seed is written as a pre-0044 database holds it, a 1.0-era crypto `cash` holding
// included, so the account the crypto cash move creates is derived on both paths. Path 1 upgrades
// that database through 0061 and runs the shipped 0062 SQL; path 2 exports the same seed from a
// database at 0061, drops the key an older file never had, and restores it on a fresh database.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { database: client.database, write: client.write };
});

import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import {
  addAccountCurrencyColumn,
  applyAllMigrations,
  applyMigrationsBetween,
  applyMigrationsThrough,
} from '@kiko/test-support/real-sqlite';
import { DatabaseSync } from 'node:sqlite';

import { EXPORT_VERSION } from '../crypto/envelope';

import { readDataSnapshot } from './read-snapshot';
import type { DataSnapshot } from './data-snapshot';
import { restoreDataSnapshot } from './restore-snapshot';

const MIGRATION_STATEMENTS = readFileSync(
  join(__dirname, '..', '..', '..', 'drizzle', 'migrations', '0062_add_account_currency.sql'),
  'utf8',
)
  .split('--> statement-breakpoint')
  .map((statement) => statement.trim());

const CLOSED_AT = 1_700_000_000_000;
const CREATED_AT = 1_700_000_000_000;
// The export version of a file written before the column: the last one without it.
const VERSION_WITHOUT_ACCOUNT_CURRENCY = 4;

type HoldingSeed = { currency: string; type?: string; closed?: boolean };

const insertAccount = (
  database: DatabaseSync,
  id: string,
  kind: string,
  options: { name?: string; archived?: boolean; createdAt?: number } = {},
): void => {
  database
    .prepare(
      `INSERT INTO accounts (id, name, kind, archived_at, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      options.name ?? id,
      kind,
      options.archived === true ? CLOSED_AT : null,
      0,
      options.createdAt ?? CREATED_AT,
    );
};

const insertHoldings = (database: DatabaseSync, accountId: string, seeds: HoldingSeed[]): void => {
  seeds.forEach((seed, index) => {
    database
      .prepare(
        `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units,
           closed_at, created_at)
         VALUES (?, ?, ?, ?, ?, 100, ?, 1700000000000)`,
      )
      .run(
        `${accountId}-${index}`,
        accountId,
        `${accountId}-${index}`,
        seed.type ?? 'card',
        seed.currency,
        seed.closed === true ? CLOSED_AT : null,
      );
  });
};

const openDatabase = (migrate: (target: DatabaseSync) => void): DatabaseSync => {
  const target = new DatabaseSync(':memory:');

  migrate(target);
  target.exec('PRAGMA foreign_keys = ON;');

  return target;
};

// A database as a build before migration 0044 left it.
const databaseBefore0044 = (): DatabaseSync =>
  openDatabase((target) => applyMigrationsThrough(target, '0043_add_import_times_rezoned'));

// A database one step before 0062, holding the same rows a pre-0044 build wrote.
const databaseBefore0062 = (): DatabaseSync =>
  openDatabase((target) => applyMigrationsThrough(target, '0061_exchange_state'));

const freshDatabase = (): DatabaseSync => openDatabase(applyAllMigrations);

const seedEveryClass = (target: DatabaseSync): void => {
  target.prepare("INSERT INTO settings (id, base_currency) VALUES (1, 'USD')").run();
  insertAccount(target, 'one-currency', 'bank');
  insertHoldings(target, 'one-currency', [{ currency: 'EUR' }, { currency: 'EUR' }]);
  insertAccount(target, 'mixed', 'bank');
  insertHoldings(target, 'mixed', [{ currency: 'UAH' }, { currency: 'GBP' }]);
  insertAccount(target, 'empty', 'bank');
  insertAccount(target, 'all-closed', 'bank');
  insertHoldings(target, 'all-closed', [{ currency: 'EUR', closed: true }]);
  insertAccount(target, 'open-eur-closed-gbp', 'bank');
  insertHoldings(target, 'open-eur-closed-gbp', [
    { currency: 'EUR' },
    { currency: 'GBP', closed: true },
  ]);
  insertAccount(target, 'archived', 'bank', { archived: true });
  insertHoldings(target, 'archived', [{ currency: 'GBP' }]);
  insertAccount(target, 'property', 'property', { name: 'Properties' });
  insertHoldings(target, 'property', [{ currency: 'UAH', type: 'property_item' }]);
  insertAccount(target, 'debt', 'debt', { name: 'Loans' });
  insertHoldings(target, 'debt', [{ currency: 'USD', type: 'loan' }]);
  insertAccount(target, 'wallet', 'cash');
  insertHoldings(target, 'wallet', [
    { currency: 'UAH', type: 'cash' },
    { currency: 'BTC', type: 'cash' },
  ]);
};

type Scenario = {
  name: string;
  seed: (target: DatabaseSync) => void;
  expected: Record<string, string>;
};

const EVERY_CLASS_EXPECTED = {
  'one-currency': 'EUR',
  mixed: 'USD',
  empty: 'USD',
  'all-closed': 'USD',
  'open-eur-closed-gbp': 'EUR',
  archived: 'GBP',
  property: 'UAH',
  debt: 'USD',
  wallet: 'UAH',
};

const SCENARIOS: Scenario[] = [
  {
    name: 'a crypto cash holding moves to a new crypto-from account',
    seed: seedEveryClass,
    expected: { ...EVERY_CLASS_EXPECTED, 'crypto-from-wallet': 'BTC' },
  },
  {
    name: 'a crypto cash holding joins an eligible crypto account holding another coin',
    seed: (target) => {
      seedEveryClass(target);
      insertAccount(target, 'cold', 'crypto');
      insertHoldings(target, 'cold', [{ currency: 'USDT', type: 'crypto_asset' }]);
    },
    expected: { ...EVERY_CLASS_EXPECTED, cold: 'USD' },
  },
  {
    name: 'a crypto cash holding joins an eligible crypto account holding the same coin',
    seed: (target) => {
      seedEveryClass(target);
      insertAccount(target, 'cold', 'crypto');
      insertHoldings(target, 'cold', [{ currency: 'BTC', type: 'crypto_asset' }]);
    },
    expected: { ...EVERY_CLASS_EXPECTED, cold: 'BTC' },
  },
  {
    // The implicit-account merge folds the newer property account into the oldest before the
    // currency rule runs: the kept account held only UAH, but after the merge it holds UAH and
    // EUR, so it takes the base. Run before the merge, the rule would read UAH.
    name: 'two live property accounts merge into one that then holds two currencies',
    seed: (target) => {
      target.prepare("INSERT INTO settings (id, base_currency) VALUES (1, 'USD')").run();
      // The file's source database is built at 0061, past the index 0050 adds, but the file it
      // exports stands for a device that never ran 0050, so two live property accounts coexist.
      target.exec('DROP INDEX IF EXISTS accounts_implicit_kind;');
      insertAccount(target, 'P1', 'property', { createdAt: CREATED_AT });
      insertHoldings(target, 'P1', [{ currency: 'UAH', type: 'property_item' }]);
      insertAccount(target, 'P2', 'property', { createdAt: CREATED_AT + 1 });
      insertHoldings(target, 'P2', [{ currency: 'EUR', type: 'property_item' }]);
    },
    expected: { P1: 'USD' },
  },
];

const accountRowsOf = (target: DatabaseSync): Record<string, unknown>[] =>
  target.prepare('SELECT * FROM accounts ORDER BY id').all() as Record<string, unknown>[];

const currencyById = (rows: Record<string, unknown>[]): Record<string, unknown> =>
  Object.fromEntries(rows.map((row) => [row.id, row.currency]));

// Path 1: the live upgrade, 0044 through 0061 and then the shipped 0062 SQL.
const upgraded = (seed: Scenario['seed']): DatabaseSync => {
  const target = databaseBefore0044();

  seed(target);
  applyMigrationsBetween(target, '0043_add_import_times_rezoned', '0061_exchange_state');

  for (const statement of MIGRATION_STATEMENTS) {
    target.exec(statement);
  }

  return target;
};

// Path 2: a file written by a build before the column, restored on a fresh database.
const restoredFromOlderFile = async (seed: Scenario['seed']): Promise<DatabaseSync> => {
  const source = databaseBefore0062();

  seed(source);
  addAccountCurrencyColumn(source);
  mockDatabase = source;

  const exported = JSON.parse(JSON.stringify(await readDataSnapshot())) as DataSnapshot;
  const snapshot: DataSnapshot = {
    ...exported,
    accounts: exported.accounts.map(({ currency: _dropped, ...row }) => row as never),
  };
  const target = freshDatabase();

  mockDatabase = target;
  await restoreDataSnapshot(snapshot, VERSION_WITHOUT_ACCOUNT_CURRENCY);

  return target;
};

describe('restoring a .kiko file written before the account currency column', () => {
  it.each(SCENARIOS)(
    'restores every account equal to the migrated database: $name',
    async ({ seed, expected }) => {
      const migrated = upgraded(seed);
      const restored = await restoredFromOlderFile(seed);

      expect(currencyById(accountRowsOf(migrated))).toEqual(expected);
      expect(accountRowsOf(restored)).toEqual(accountRowsOf(migrated));
    },
  );

  it('keeps the currency a file carries, even where the rule would choose another', async () => {
    const source = databaseBefore0062();

    seedEveryClass(source);
    addAccountCurrencyColumn(source);
    source.exec(
      "UPDATE accounts SET currency = 'GBP' WHERE id IN ('mixed', 'empty', 'one-currency')",
    );
    mockDatabase = source;

    const target = freshDatabase();
    const snapshot = JSON.parse(JSON.stringify(await readDataSnapshot())) as DataSnapshot;

    mockDatabase = target;
    await restoreDataSnapshot(snapshot, EXPORT_VERSION);

    expect(currencyById(accountRowsOf(target))).toMatchObject({
      mixed: 'GBP',
      empty: 'GBP',
      'one-currency': 'GBP',
    });
  });
});
