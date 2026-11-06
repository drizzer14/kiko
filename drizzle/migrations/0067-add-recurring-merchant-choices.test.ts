// Runs the shipped SQL on a real `node:sqlite` engine seeded as a device's database stood before
// it, so the column, its absent default and the absence of an index are proven on the real engine.
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { applyMigrationsThrough } from '@kiko/test-support/real-sqlite';

const MIGRATION_SQL = readFileSync(
  join(__dirname, '0067_add_recurring_merchant_choices.sql'),
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

const databaseBeforeChoicesColumn = (): DatabaseSync => {
  const database = new DatabaseSync(':memory:');

  applyMigrationsThrough(database, '0066_add_funding_match_rows');
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

describe('the recurring merchant choices column migration', () => {
  it('adds a nullable text column with no default', () => {
    const database = databaseBeforeChoicesColumn();

    expect(settingsColumns(database).map((column) => column.name)).not.toContain(
      'recurring_merchant_choices',
    );

    applyMigration(database);

    expect(
      settingsColumns(database).find(({ name }) => name === 'recurring_merchant_choices'),
    ).toMatchObject({ type: 'TEXT', notnull: 0, dflt_value: null });
  });

  it('keeps the settings row with nothing stored in the column', () => {
    const database = databaseBeforeChoicesColumn();
    const before = database.prepare('SELECT * FROM settings').all();

    applyMigration(database);

    expect(
      database.prepare('SELECT recurring_merchant_choices AS value FROM settings').all(),
    ).toEqual([{ value: null }]);
    expect(database.prepare('SELECT count(*) AS value FROM settings').get()).toEqual({ value: 1 });
    expect(
      database
        .prepare('SELECT * FROM settings')
        .all()
        .map(({ recurring_merchant_choices: _column, ...rest }) => rest),
    ).toEqual(before);
  });

  it('adds no index', () => {
    const database = databaseBeforeChoicesColumn();
    const before = indexCount(database);

    applyMigration(database);

    expect(indexCount(database)).toBe(before);
  });
});
