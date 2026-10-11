// drizzle/migrations/0056-add-transaction-templates.test.ts
//
// Runs the shipped SQL on a real `node:sqlite` engine seeded as a device's
// database stood before it, so the table, its defaults and the absence of a
// foreign key and an index are proven on the real engine.
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { applyMigrationsThrough } from '@kiko/test-support/real-sqlite';

const MIGRATION_SQL = readFileSync(join(__dirname, '0056_add_transaction_templates.sql'), 'utf8');

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

const databaseThrough0055 = (): DatabaseSync => {
  const database = new DatabaseSync(':memory:');

  applyMigrationsThrough(database, '0055_add_dismissed_tips');
  database.exec('PRAGMA foreign_keys = ON');

  return database;
};

const migratedDatabase = (): DatabaseSync => {
  const database = databaseThrough0055();

  applyMigration(database);

  return database;
};

const columnsOf = (database: DatabaseSync): Column[] =>
  (
    database.prepare("SELECT * FROM pragma_table_info('transaction_templates')").all() as Column[]
  ).map(({ name, type, notnull, pk }) => ({ name, type, notnull, pk }));

const tableNames = (database: DatabaseSync): string[] =>
  (
    database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
      name: string;
    }[]
  ).map((table) => table.name);

describe('migration 0056: the table of transaction templates', () => {
  it('adds the table', () => {
    const database = databaseThrough0055();

    expect(tableNames(database)).not.toContain('transaction_templates');

    applyMigration(database);

    expect(tableNames(database)).toContain('transaction_templates');
  });

  it('has the id, the name, the draft and the two times, the id as the primary key', () => {
    expect(columnsOf(migratedDatabase())).toEqual([
      { name: 'id', type: 'TEXT', notnull: 1, pk: 1 },
      { name: 'name', type: 'TEXT', notnull: 1, pk: 0 },
      { name: 'draft', type: 'TEXT', notnull: 1, pk: 0 },
      { name: 'created_at', type: 'INTEGER', notnull: 1, pk: 0 },
      { name: 'updated_at', type: 'INTEGER', notnull: 1, pk: 0 },
    ]);
  });

  it('stamps both times on its own', () => {
    const database = migratedDatabase();
    const before = Date.now();

    run(
      database,
      `INSERT INTO transaction_templates (id, name, draft) VALUES ('template', 'Rent', '{"version":1}')`,
    );

    const { createdAt, updatedAt } = database
      .prepare(
        "SELECT created_at AS createdAt, updated_at AS updatedAt FROM transaction_templates WHERE id = 'template'",
      )
      .get() as { createdAt: number; updatedAt: number };

    // unixepoch() has one-second resolution, so the stamp may trail by under 1 s.
    for (const stamp of [createdAt, updatedAt]) {
      expect(stamp).toBeGreaterThan(before - 1500);
      expect(stamp).toBeLessThan(Date.now() + 1500);
    }
  });

  it('refuses a template with no name or no draft', () => {
    const database = migratedDatabase();

    expect(() =>
      run(database, `INSERT INTO transaction_templates (id, name, draft) VALUES ('a', NULL, '{}')`),
    ).toThrow(/NOT NULL/);
    expect(() =>
      run(
        database,
        `INSERT INTO transaction_templates (id, name, draft) VALUES ('b', 'Rent', NULL)`,
      ),
    ).toThrow(/NOT NULL/);
  });

  it('has no foreign key and no index but the primary key', () => {
    const database = migratedDatabase();

    expect(
      database.prepare("SELECT * FROM pragma_foreign_key_list('transaction_templates')").all(),
    ).toEqual([]);
    expect(
      (
        database
          .prepare(
            'SELECT origin, "unique" AS isUnique FROM pragma_index_list(\'transaction_templates\')',
          )
          .all() as { origin: string; isUnique: number }[]
      ).map(({ origin, isUnique }) => ({ origin, isUnique })),
    ).toEqual([{ origin: 'pk', isUnique: 1 }]);
  });

  it('starts empty and leaves the other tables as they were', () => {
    const before = databaseThrough0055();

    run(before, "INSERT INTO accounts (id, name, kind) VALUES ('account', 'Bank', 'bank')");

    const accountsBefore = before.prepare('SELECT * FROM accounts').all();

    applyMigration(before);

    expect(before.prepare('SELECT count(*) AS value FROM transaction_templates').get()).toEqual({
      value: 0,
    });
    expect(before.prepare('SELECT * FROM accounts').all()).toEqual(accountsBefore);
    expect(accountsBefore).toHaveLength(1);
  });
});
