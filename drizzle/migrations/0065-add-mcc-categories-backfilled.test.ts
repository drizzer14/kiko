// drizzle/migrations/0065-add-mcc-categories-backfilled.test.ts
//
// Runs the shipped SQL on a real `node:sqlite` engine seeded as a device's
// database stood before it, so the column, its default and the absence of an
// index are proven on the real engine.
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { applyMigrationsThrough } from '@kiko/test-support/real-sqlite';

const MIGRATION_SQL = readFileSync(
  join(__dirname, '0065_add_mcc_categories_backfilled.sql'),
  'utf8',
);

type Column = { name: string; type: string; notnull: number; dflt_value: string | null };

const applyMigration = (database: DatabaseSync): void => {
  for (const statement of MIGRATION_SQL.split('--> statement-breakpoint')
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate !== '')) {
    database.exec(statement);
  }
};

const databaseThrough0064 = (): DatabaseSync => {
  const database = new DatabaseSync(':memory:');

  applyMigrationsThrough(database, '0064_seed_travel_category');
  database.prepare('INSERT INTO settings (id) VALUES (1)').run();

  return database;
};

const settingsColumns = (database: DatabaseSync): Column[] =>
  database.prepare("SELECT * FROM pragma_table_info('settings')").all() as Column[];

const indexCount = (database: DatabaseSync): number =>
  (
    database.prepare("SELECT count(*) AS value FROM pragma_index_list('settings')").get() as {
      value: number;
    }
  ).value;

const markOf = (database: DatabaseSync, id: number): number =>
  (
    database
      .prepare('SELECT mcc_categories_backfilled AS value FROM settings WHERE id = ?')
      .get(id) as {
      value: number;
    }
  ).value;

describe('migration 0065: the MCC back-fill mark column', () => {
  it('adds a NOT NULL integer column defaulting to false', () => {
    const database = databaseThrough0064();

    expect(settingsColumns(database).map((column) => column.name)).not.toContain(
      'mcc_categories_backfilled',
    );

    applyMigration(database);

    expect(
      settingsColumns(database).find(({ name }) => name === 'mcc_categories_backfilled'),
    ).toMatchObject({ type: 'INTEGER', notnull: 1, dflt_value: 'false' });
  });

  it('keeps the settings row with the mark false', () => {
    const database = databaseThrough0064();

    applyMigration(database);

    expect(markOf(database, 1)).toBe(0);
    expect(database.prepare('SELECT count(*) AS value FROM settings').get()).toEqual({ value: 1 });
  });

  it('adds no index', () => {
    const database = databaseThrough0064();
    const before = indexCount(database);

    applyMigration(database);

    expect(indexCount(database)).toBe(before);
  });
});
