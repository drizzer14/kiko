// drizzle/migrations/0062-add-account-currency.test.ts
//
// Runs the shipped SQL on a real `node:sqlite` engine seeded as a device's database stood before
// it, so each account's backfilled currency is proven on real rows, not on a restated predicate.
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { applyAllMigrations, applyMigrationsThrough } from '@kiko/test-support/real-sqlite';

const MIGRATION_FILE = join(__dirname, '0062_add_account_currency.sql');

const migrationStatements = (): string[] =>
  readFileSync(MIGRATION_FILE, 'utf8')
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter((statement) => statement !== '');

const applyMigration = (database: DatabaseSync): void => {
  for (const statement of migrationStatements()) {
    database.exec(statement);
  }
};

const databaseThrough0061 = (baseCurrency: string | undefined): DatabaseSync => {
  const database = new DatabaseSync(':memory:');

  applyMigrationsThrough(database, '0061_exchange_state');
  database.exec('PRAGMA foreign_keys = ON;');

  if (baseCurrency !== undefined) {
    database.prepare('INSERT INTO settings (id, base_currency) VALUES (1, ?)').run(baseCurrency);
  }

  return database;
};

type HoldingSeed = { currency: string; closed?: boolean };

const seedAccount = (
  database: DatabaseSync,
  id: string,
  holdings: HoldingSeed[],
  kind = 'bank',
  archivedAt: number | null = null,
): void => {
  database
    .prepare('INSERT INTO accounts (id, name, kind, archived_at) VALUES (?, ?, ?, ?)')
    .run(id, id, kind, archivedAt);

  holdings.forEach((holding, index) => {
    database
      .prepare(
        `INSERT INTO holdings (id, account_id, name, type, currency, closed_at)
         VALUES (?, ?, ?, 'card', ?, ?)`,
      )
      .run(
        `${id}-${index}`,
        id,
        `${id}-${index}`,
        holding.currency,
        holding.closed === true ? 1_700_000_000_000 : null,
      );
  });
};

const seedEveryClass = (database: DatabaseSync): void => {
  seedAccount(database, 'one-currency', [{ currency: 'EUR' }, { currency: 'EUR' }]);
  seedAccount(database, 'mixed', [{ currency: 'UAH' }, { currency: 'USD' }]);
  seedAccount(database, 'empty', []);
  seedAccount(database, 'all-closed', [
    { currency: 'EUR', closed: true },
    { currency: 'EUR', closed: true },
  ]);
  seedAccount(database, 'open-eur-closed-usd', [
    { currency: 'EUR' },
    { currency: 'USD', closed: true },
  ]);
  seedAccount(database, 'closed-foreign-beside-base', [
    { currency: 'USD' },
    { currency: 'EUR', closed: true },
  ]);
  seedAccount(database, 'archived', [{ currency: 'GBP' }], 'bank', 1_690_000_000_000);
  seedAccount(database, 'archived-mixed', [{ currency: 'GBP' }, { currency: 'EUR' }], 'bank', 1);
  seedAccount(database, 'property', [{ currency: 'UAH' }, { currency: 'UAH' }], 'property');
  seedAccount(database, 'crypto-from-x', [{ currency: 'BTC' }], 'crypto');
};

const currencyOf = (database: DatabaseSync, id: string): unknown =>
  (database.prepare('SELECT currency FROM accounts WHERE id = ?').get(id) as { currency: unknown })
    .currency;

describe('migration 0062: the account currency', () => {
  it('adds a NOT NULL text column that defaults to UAH', () => {
    const database = databaseThrough0061('USD');

    applyMigration(database);

    expect(database.prepare("SELECT * FROM pragma_table_info('accounts')").all()).toContainEqual(
      expect.objectContaining({ name: 'currency', type: 'TEXT', notnull: 1, dflt_value: "'UAH'" }),
    );
  });

  it.each([
    ['one currency among the open holdings', 'one-currency', 'EUR'],
    ['mixed currencies take the base', 'mixed', 'USD'],
    ['no holding takes the base', 'empty', 'USD'],
    ['only closed holdings take the base', 'all-closed', 'USD'],
    ['an open EUR beside a closed USD', 'open-eur-closed-usd', 'EUR'],
    ['an open USD beside a closed EUR', 'closed-foreign-beside-base', 'USD'],
    ['an archived account follows the same rule', 'archived', 'GBP'],
    ['an archived account with mixed currencies takes the base', 'archived-mixed', 'USD'],
    ['an implicit property account', 'property', 'UAH'],
    ['an account the crypto cash move created', 'crypto-from-x', 'BTC'],
  ])('backfills %s', (_title, accountId, expected) => {
    const database = databaseThrough0061('USD');

    seedEveryClass(database);
    applyMigration(database);

    expect(currencyOf(database, accountId)).toBe(expected);
  });

  it('gives every account UAH when there is no settings row', () => {
    const database = databaseThrough0061(undefined);

    seedEveryClass(database);
    applyMigration(database);

    expect(currencyOf(database, 'mixed')).toBe('UAH');
    expect(currencyOf(database, 'empty')).toBe('UAH');
    expect(currencyOf(database, 'all-closed')).toBe('UAH');
    expect(currencyOf(database, 'one-currency')).toBe('EUR');
  });

  it('writes nothing but the account currency', () => {
    const database = databaseThrough0061('USD');

    seedEveryClass(database);

    const holdingsBefore = database.prepare('SELECT * FROM holdings ORDER BY id').all();
    const accountsBefore = database
      .prepare('SELECT id, name, kind, archived_at FROM accounts ORDER BY id')
      .all();

    applyMigration(database);

    expect(database.prepare('SELECT * FROM holdings ORDER BY id').all()).toEqual(holdingsBefore);
    expect(
      database.prepare('SELECT id, name, kind, archived_at FROM accounts ORDER BY id').all(),
    ).toEqual(accountsBefore);
  });

  it('reads holdings in one grouped scan, never one lookup per account', () => {
    const database = databaseThrough0061('USD');
    const statements = migrationStatements();
    const backfill = statements[statements.length - 1] ?? '';

    for (const statement of statements.slice(0, -1)) {
      database.exec(statement);
    }

    const plan = (
      database.prepare(`EXPLAIN QUERY PLAN ${backfill}`).all() as { detail: string }[]
    ).map((step) => step.detail);

    expect(plan).toEqual([
      'MATERIALIZE single',
      'SCAN holdings',
      'USE TEMP B-TREE FOR GROUP BY',
      'USE TEMP B-TREE FOR count(DISTINCT)',
      'SCAN single',
      'SEARCH accounts USING COVERING INDEX sqlite_autoindex_accounts_1 (id=?)',
    ]);
  });

  it('runs clean on an empty database through every migration', () => {
    const database = new DatabaseSync(':memory:');

    applyAllMigrations(database);

    expect(database.prepare('SELECT COUNT(*) AS value FROM accounts').get()).toEqual({ value: 0 });
  });
});
