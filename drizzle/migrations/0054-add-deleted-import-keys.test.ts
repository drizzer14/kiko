// drizzle/migrations/0054-add-deleted-import-keys.test.ts
//
// Runs the shipped SQL on a real `node:sqlite` engine seeded as a device's
// database stood before it, so the table, its key and its foreign key are proven
// on the real engine.
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { applyMigrationsThrough } from '@kiko/test-support/real-sqlite';

const MIGRATION_SQL = readFileSync(join(__dirname, '0054_add_deleted_import_keys.sql'), 'utf8');

type Column = { name: string; type: string; notnull: number; pk: number };

const run = (
  database: DatabaseSync,
  statement: string,
  ...parameters: (string | number | null)[]
) => {
  database.prepare(statement).run(...parameters);
};

const applyMigration = (database: DatabaseSync): void => {
  for (const statement of MIGRATION_SQL.split('--> statement-breakpoint')
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate !== '')) {
    database.exec(statement);
  }
};

const databaseThrough0053 = (): DatabaseSync => {
  const database = new DatabaseSync(':memory:');

  applyMigrationsThrough(database, '0053_add_loan_holding_id_index');
  database.exec('PRAGMA foreign_keys = ON');
  run(database, "INSERT INTO accounts (id, name, kind) VALUES ('account', 'Bank', 'bank')");
  run(
    database,
    `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units)
     VALUES ('card', 'account', 'Card', 'card', 'UAH', 5000)`,
  );
  run(
    database,
    `INSERT INTO transactions (id, holding_id, amount_minor_units, time, source, external_id)
     VALUES ('row', 'card', -300, 1000, 'import', 'key-1')`,
  );

  return database;
};

const migratedDatabase = (): DatabaseSync => {
  const database = databaseThrough0053();

  applyMigration(database);

  return database;
};

const columnsOf = (database: DatabaseSync): Column[] =>
  (
    database.prepare("SELECT * FROM pragma_table_info('deleted_import_keys')").all() as Column[]
  ).map(({ name, type, notnull, pk }) => ({ name, type, notnull, pk }));

const tableNames = (database: DatabaseSync): string[] =>
  (
    database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
      name: string;
    }[]
  ).map((table) => table.name);

describe('migration 0054: the table of deleted import keys', () => {
  it('adds the table', () => {
    const database = databaseThrough0053();

    expect(tableNames(database)).not.toContain('deleted_import_keys');

    applyMigration(database);

    expect(tableNames(database)).toContain('deleted_import_keys');
  });

  it('has the holding, the key and the delete time, the first two as the primary key', () => {
    expect(columnsOf(migratedDatabase())).toEqual([
      { name: 'holding_id', type: 'TEXT', notnull: 1, pk: 1 },
      { name: 'external_id', type: 'TEXT', notnull: 1, pk: 2 },
      { name: 'deleted_at', type: 'INTEGER', notnull: 1, pk: 0 },
    ]);
  });

  it('stamps the delete time on its own', () => {
    const database = migratedDatabase();

    run(database, "INSERT INTO deleted_import_keys (holding_id, external_id) VALUES ('card', 'k')");

    const { deletedAt } = database
      .prepare("SELECT deleted_at AS deletedAt FROM deleted_import_keys WHERE external_id = 'k'")
      .get() as { deletedAt: number };

    expect(deletedAt).toBeGreaterThan(Date.UTC(2026, 0, 1));
  });

  it('holds one row per holding and key, and the same key on another holding', () => {
    const database = migratedDatabase();

    run(
      database,
      `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units)
       VALUES ('other', 'account', 'Other', 'card', 'UAH', 0)`,
    );
    run(database, "INSERT INTO deleted_import_keys (holding_id, external_id) VALUES ('card', 'k')");

    expect(() =>
      run(
        database,
        "INSERT INTO deleted_import_keys (holding_id, external_id) VALUES ('card', 'k')",
      ),
    ).toThrow();
    expect(() =>
      run(
        database,
        "INSERT INTO deleted_import_keys (holding_id, external_id) VALUES ('other', 'k')",
      ),
    ).not.toThrow();
  });

  it('refuses a key for a holding that does not exist', () => {
    const database = migratedDatabase();

    expect(() =>
      run(
        database,
        "INSERT INTO deleted_import_keys (holding_id, external_id) VALUES ('gone', 'k')",
      ),
    ).toThrow(/FOREIGN KEY/);
  });

  it('refuses to delete a holding that still has a key, without cascading', () => {
    const database = migratedDatabase();

    run(database, "INSERT INTO deleted_import_keys (holding_id, external_id) VALUES ('card', 'k')");
    run(database, "DELETE FROM transactions WHERE holding_id = 'card'");

    expect(() => run(database, "DELETE FROM holdings WHERE id = 'card'")).toThrow(/FOREIGN KEY/);
  });

  it('starts empty and leaves the holdings and rows as they were', () => {
    const before = databaseThrough0053();
    const rowsBefore = before.prepare('SELECT * FROM transactions').all();
    const holdingsBefore = before.prepare('SELECT * FROM holdings').all();

    applyMigration(before);

    expect(before.prepare('SELECT count(*) AS value FROM deleted_import_keys').get()).toEqual({
      value: 0,
    });
    expect(before.prepare('SELECT * FROM transactions').all()).toEqual(rowsBefore);
    expect(before.prepare('SELECT * FROM holdings').all()).toEqual(holdingsBefore);
    expect(rowsBefore).toHaveLength(1);
  });
});
