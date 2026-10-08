// drizzle/migrations/0055-add-dismissed-tips.test.ts
//
// Runs the shipped SQL on a real `node:sqlite` engine seeded as a device's
// database stood before it, so the column, its default and its NOT NULL are
// proven on the real engine.
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { applyMigrationsThrough } from '@kiko/test-support/real-sqlite';

const MIGRATION_SQL = readFileSync(join(__dirname, '0055_add_dismissed_tips.sql'), 'utf8');

type Column = { name: string; type: string; notnull: number; dflt_value: string | null };

const applyMigration = (database: DatabaseSync): void => {
  for (const statement of MIGRATION_SQL.split('--> statement-breakpoint')
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate !== '')) {
    database.exec(statement);
  }
};

const databaseThrough0054 = (): DatabaseSync => {
  const database = new DatabaseSync(':memory:');

  applyMigrationsThrough(database, '0054_add_deleted_import_keys');
  database.prepare('INSERT INTO settings (id) VALUES (1)').run();

  return database;
};

const settingsColumns = (database: DatabaseSync): Column[] =>
  database.prepare("SELECT * FROM pragma_table_info('settings')").all() as Column[];

const dismissedTipsOf = (database: DatabaseSync, id: number): string =>
  (
    database.prepare('SELECT dismissed_tips AS value FROM settings WHERE id = ?').get(id) as {
      value: string;
    }
  ).value;

describe('migration 0055: the dismissed tips column', () => {
  it('adds the column', () => {
    const database = databaseThrough0054();

    expect(settingsColumns(database).map((column) => column.name)).not.toContain('dismissed_tips');

    applyMigration(database);

    expect(settingsColumns(database).map((column) => column.name)).toContain('dismissed_tips');
  });

  it('is text, NOT NULL, and defaults to an empty list', () => {
    const database = databaseThrough0054();

    applyMigration(database);

    const column = settingsColumns(database).find(({ name }) => name === 'dismissed_tips');

    expect(column).toMatchObject({ type: 'TEXT', notnull: 1, dflt_value: "'[]'" });
  });

  it('reads an empty list on the row that already existed', () => {
    const database = databaseThrough0054();

    applyMigration(database);

    expect(dismissedTipsOf(database, 1)).toBe('[]');
  });

  it('reads an empty list on a row inserted afterwards', () => {
    const database = databaseThrough0054();

    applyMigration(database);
    database.prepare('INSERT INTO settings (id) VALUES (2)').run();

    expect(dismissedTipsOf(database, 2)).toBe('[]');
  });

  it('refuses NULL', () => {
    const database = databaseThrough0054();

    applyMigration(database);

    expect(() => database.prepare('UPDATE settings SET dismissed_tips = NULL').run()).toThrow(
      /NOT NULL/,
    );
  });
});
