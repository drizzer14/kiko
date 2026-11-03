// drizzle/migrations/0064-seed-travel-category.test.ts
//
// Runs the shipped SQL on a real `node:sqlite` engine seeded as a device's database stood before
// it, so the row, its append-only sort order and its refusal to overwrite are proven on the real
// engine.
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { applyMigrationsThrough } from '@kiko/test-support/real-sqlite';

const MIGRATION_SQL = readFileSync(join(__dirname, '0064_seed_travel_category.sql'), 'utf8');

type CategoryRow = {
  key: string;
  title: string;
  icon: string;
  color: string | null;
  sort_order: number;
};

const applyMigration = (database: DatabaseSync): void => {
  for (const statement of MIGRATION_SQL.split('--> statement-breakpoint')
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate !== '')) {
    database.exec(statement);
  }
};

const databaseThrough0063 = (): DatabaseSync => {
  const database = new DatabaseSync(':memory:');

  applyMigrationsThrough(database, '0063_add_transaction_operation');

  return database;
};

const categoryRows = (database: DatabaseSync): CategoryRow[] =>
  database
    .prepare('SELECT key, title, icon, color, sort_order FROM categories ORDER BY key')
    .all() as CategoryRow[];

const categoryNamed = (database: DatabaseSync, key: string): CategoryRow | undefined =>
  categoryRows(database).find((row) => row.key === key);

const dumpOf = (database: DatabaseSync, table: string): unknown[] =>
  database.prepare(`SELECT * FROM ${table} ORDER BY 1`).all();

describe('migration 0064: the Travel seed', () => {
  it('seeds travel with its title, icon, color and the next sort order', () => {
    const database = databaseThrough0063();

    expect(categoryNamed(database, 'travel')).toBeUndefined();

    applyMigration(database);

    expect(categoryNamed(database, 'travel')).toEqual({
      key: 'travel',
      title: 'Travel',
      icon: 'airplane',
      color: '#40C8E0',
      sort_order: 11,
    });
  });

  it('appends after the highest order of a reordered grid and changes no other order', () => {
    const database = databaseThrough0063();

    database.exec(
      "UPDATE categories SET sort_order = 30 - sort_order WHERE key <> 'loan_interest'",
    );
    database.exec("UPDATE categories SET sort_order = 3 WHERE key = 'loan_interest'");
    database.exec(
      "INSERT INTO categories (key, title, icon, color, sort_order) VALUES ('user-category', 'Pets', 'pawprint', '#112233', 40)",
    );
    const before = categoryRows(database);

    applyMigration(database);

    expect(categoryNamed(database, 'travel')?.sort_order).toBe(41);
    expect(categoryRows(database).filter((row) => row.key !== 'travel')).toEqual(before);
  });

  it('leaves a row already holding the key untouched', () => {
    const database = databaseThrough0063();

    database.exec(
      "INSERT INTO categories (key, title, icon, color, sort_order) VALUES ('travel', 'Trips', 'car', '#010203', 4)",
    );
    const before = categoryNamed(database, 'travel');

    applyMigration(database);

    expect(before).toEqual({
      key: 'travel',
      title: 'Trips',
      icon: 'car',
      color: '#010203',
      sort_order: 4,
    });
    expect(categoryNamed(database, 'travel')).toEqual(before);
    expect(categoryRows(database).filter((row) => row.key === 'travel')).toHaveLength(1);
  });

  it('leaves a user category titled Travel as its own row', () => {
    const database = databaseThrough0063();

    database.exec(
      "INSERT INTO categories (key, title, icon, color, sort_order) VALUES ('0b1c2d3e-0000-4000-8000-000000000001', 'Travel', 'bag', '#A1B2C3', 11)",
    );
    const before = categoryNamed(database, '0b1c2d3e-0000-4000-8000-000000000001');

    applyMigration(database);

    expect(categoryNamed(database, '0b1c2d3e-0000-4000-8000-000000000001')).toEqual(before);
    expect(categoryNamed(database, 'travel')).toMatchObject({ title: 'Travel', sort_order: 12 });
    expect(categoryRows(database).filter((row) => row.title === 'Travel')).toHaveLength(2);
  });

  it('changes no other category, transaction or rule', () => {
    const database = databaseThrough0063();

    database.exec("INSERT INTO accounts (id, name, kind) VALUES ('account', 'Bank', 'bank')");
    database.exec(
      `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units)
       VALUES ('holding', 'account', 'Card', 'fiat', 'UAH', 0)`,
    );
    database.exec(
      `INSERT INTO transactions (id, holding_id, amount_minor_units, time, source, category)
       VALUES ('hotel', 'holding', -100, 1, 'manual', 'other')`,
    );
    database.exec(
      `INSERT INTO category_rules (id, category, matchers, created_at, updated_at)
       VALUES ('rule', 'travel', '[{"type":"nameIs","text":"Hilton"}]', 1, 1)`,
    );
    const before = {
      categories: dumpOf(database, 'categories'),
      transactions: dumpOf(database, 'transactions'),
      rules: dumpOf(database, 'category_rules'),
    };

    applyMigration(database);

    expect(dumpOf(database, 'transactions')).toEqual(before.transactions);
    expect(dumpOf(database, 'category_rules')).toEqual(before.rules);
    expect(
      dumpOf(database, 'categories').filter((row) => (row as CategoryRow).key !== 'travel'),
    ).toEqual(before.categories);
    expect(dumpOf(database, 'categories')).toHaveLength(before.categories.length + 1);
  });

  it('runs twice to one row', () => {
    const database = databaseThrough0063();

    applyMigration(database);
    const afterFirst = categoryRows(database);
    applyMigration(database);

    expect(categoryRows(database)).toEqual(afterFirst);
    expect(categoryRows(database).filter((row) => row.key === 'travel')).toHaveLength(1);
  });

  it('starts at sort order 0 on an empty table', () => {
    const database = databaseThrough0063();

    database.exec('DELETE FROM categories');
    applyMigration(database);

    expect(categoryRows(database)).toEqual([
      { key: 'travel', title: 'Travel', icon: 'airplane', color: '#40C8E0', sort_order: 0 },
    ]);
  });
});
