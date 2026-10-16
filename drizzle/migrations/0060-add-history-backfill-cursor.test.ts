// drizzle/migrations/0060-add-history-backfill-cursor.test.ts
//
// Runs the shipped SQL on a real `node:sqlite` engine seeded as a device's
// database stood before it, so the column and its nullability are proven on the
// real engine.
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { applyMigrationsThrough } from '@kiko/test-support/real-sqlite';

const MIGRATION_SQL = readFileSync(join(__dirname, '0060_add_history_backfill_cursor.sql'), 'utf8');

type Column = { name: string; type: string; notnull: number; dflt_value: string | null };

const applyMigration = (database: DatabaseSync): void => {
  for (const statement of MIGRATION_SQL.split('--> statement-breakpoint')
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate !== '')) {
    database.exec(statement);
  }
};

const databaseThrough0059 = (): DatabaseSync => {
  const database = new DatabaseSync(':memory:');

  applyMigrationsThrough(database, '0059_usdt_scale_8');
  database.prepare('INSERT INTO settings (id) VALUES (1)').run();

  return database;
};

const settingsColumns = (database: DatabaseSync): Column[] =>
  database.prepare("SELECT * FROM pragma_table_info('settings')").all() as Column[];

const cursorOf = (database: DatabaseSync, id: number): string | null =>
  (
    database
      .prepare('SELECT history_backfill_cursor AS value FROM settings WHERE id = ?')
      .get(id) as {
      value: string | null;
    }
  ).value;

describe('migration 0060: the history backfill cursor column', () => {
  it('adds the column', () => {
    const database = databaseThrough0059();

    expect(settingsColumns(database).map((column) => column.name)).not.toContain(
      'history_backfill_cursor',
    );

    applyMigration(database);

    expect(settingsColumns(database).map((column) => column.name)).toContain(
      'history_backfill_cursor',
    );
  });

  it('is nullable text with no default', () => {
    const database = databaseThrough0059();

    applyMigration(database);

    const column = settingsColumns(database).find(({ name }) => name === 'history_backfill_cursor');

    expect(column).toMatchObject({ type: 'TEXT', notnull: 0, dflt_value: null });
  });

  it('reads null on the row that already existed', () => {
    const database = databaseThrough0059();

    applyMigration(database);

    expect(cursorOf(database, 1)).toBeNull();
  });

  it('keeps a stored coin code', () => {
    const database = databaseThrough0059();

    applyMigration(database);
    database.prepare("UPDATE settings SET history_backfill_cursor = 'XRP' WHERE id = 1").run();

    expect(cursorOf(database, 1)).toBe('XRP');
  });
});
