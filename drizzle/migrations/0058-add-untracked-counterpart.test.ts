// drizzle/migrations/0058-add-untracked-counterpart.test.ts
//
// Runs the shipped SQL on a real `node:sqlite` engine seeded as a device's
// database stood before it, so the column, its nullability and the absence of an
// index are proven on the real engine.
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { applyMigrationsThrough } from '@kiko/test-support/real-sqlite';

const MIGRATION_SQL = readFileSync(join(__dirname, '0058_add_untracked_counterpart.sql'), 'utf8');

type Column = { name: string; type: string; notnull: number; dflt_value: string | null };

const applyMigration = (database: DatabaseSync): void => {
  for (const statement of MIGRATION_SQL.split('--> statement-breakpoint')
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate !== '')) {
    database.exec(statement);
  }
};

const databaseThrough0057 = (): DatabaseSync => {
  const database = new DatabaseSync(':memory:');

  applyMigrationsThrough(database, '0057_add_transaction_templates');
  database.exec("INSERT INTO accounts (id, name, kind) VALUES ('account', 'Bank', 'bank')");
  database.exec(
    `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units)
     VALUES ('holding', 'account', 'Spot', 'crypto_asset', 'BTC', 0)`,
  );
  database.exec(
    `INSERT INTO transactions (id, holding_id, amount_minor_units, time, source)
     VALUES ('existing', 'holding', -100, 1, 'manual')`,
  );

  return database;
};

const transactionColumns = (database: DatabaseSync): Column[] =>
  database.prepare("SELECT * FROM pragma_table_info('transactions')").all() as Column[];

const indexCount = (database: DatabaseSync): number =>
  (
    database.prepare("SELECT count(*) AS value FROM pragma_index_list('transactions')").get() as {
      value: number;
    }
  ).value;

const untrackedCounterpartOf = (database: DatabaseSync, transactionId: string): string | null =>
  (
    database
      .prepare('SELECT untracked_counterpart AS value FROM transactions WHERE id = ?')
      .get(transactionId) as { value: string | null }
  ).value;

describe('migration 0058: the untracked counterpart column', () => {
  it('adds the column', () => {
    const database = databaseThrough0057();

    expect(transactionColumns(database).map((column) => column.name)).not.toContain(
      'untracked_counterpart',
    );

    applyMigration(database);

    expect(transactionColumns(database).map((column) => column.name)).toContain(
      'untracked_counterpart',
    );
  });

  it('is nullable text with no default', () => {
    const database = databaseThrough0057();

    applyMigration(database);

    const column = transactionColumns(database).find(
      ({ name }) => name === 'untracked_counterpart',
    );

    expect(column).toMatchObject({ type: 'TEXT', notnull: 0, dflt_value: null });
  });

  it('reads null on the row that already existed', () => {
    const database = databaseThrough0057();

    applyMigration(database);

    expect(untrackedCounterpartOf(database, 'existing')).toBeNull();
  });

  it('stores a wallet code on a row inserted afterwards', () => {
    const database = databaseThrough0057();

    applyMigration(database);
    database.exec(
      `INSERT INTO transactions (id, holding_id, amount_minor_units, time, source, untracked_counterpart)
       VALUES ('futures', 'holding', -200, 2, 'manual', 'wallet:UMFUTURE')`,
    );

    expect(untrackedCounterpartOf(database, 'futures')).toBe('wallet:UMFUTURE');
  });

  it('adds no index', () => {
    const database = databaseThrough0057();
    const before = indexCount(database);

    applyMigration(database);

    expect(indexCount(database)).toBe(before);
  });
});
