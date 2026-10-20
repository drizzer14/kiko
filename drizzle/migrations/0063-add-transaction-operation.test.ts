// drizzle/migrations/0063-add-transaction-operation.test.ts
//
// Runs the shipped SQL on a real `node:sqlite` engine seeded as a device's
// database stood before it, so the column, its nullability and the absence of an
// index are proven on the real engine.
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { applyMigrationsThrough } from '@kiko/test-support/real-sqlite';

const MIGRATION_SQL = readFileSync(join(__dirname, '0063_add_transaction_operation.sql'), 'utf8');

const OPERATION_CODES = ['trade', 'trade-fee', 'convert', 'dust', 'p2p', 'card', 'fiat'];

type Column = { name: string; type: string; notnull: number; dflt_value: string | null };

const applyMigration = (database: DatabaseSync): void => {
  for (const statement of MIGRATION_SQL.split('--> statement-breakpoint')
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate !== '')) {
    database.exec(statement);
  }
};

const databaseThrough0062 = (): DatabaseSync => {
  const database = new DatabaseSync(':memory:');

  applyMigrationsThrough(database, '0062_add_account_currency');
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

const operationOf = (database: DatabaseSync, transactionId: string): string | null =>
  (
    database
      .prepare('SELECT operation AS value FROM transactions WHERE id = ?')
      .get(transactionId) as {
      value: string | null;
    }
  ).value;

describe('migration 0063: the transaction operation column', () => {
  it('adds a nullable text column with no default', () => {
    const database = databaseThrough0062();

    expect(transactionColumns(database).map((column) => column.name)).not.toContain('operation');

    applyMigration(database);

    expect(transactionColumns(database).find(({ name }) => name === 'operation')).toMatchObject({
      type: 'TEXT',
      notnull: 0,
      dflt_value: null,
    });
  });

  it("leaves every existing row's operation null", () => {
    const database = databaseThrough0062();

    applyMigration(database);

    expect(operationOf(database, 'existing')).toBeNull();
  });

  it('adds no index to transactions', () => {
    const database = databaseThrough0062();
    const before = indexCount(database);

    applyMigration(database);

    expect(indexCount(database)).toBe(before);
  });

  it.each(OPERATION_CODES)('accepts the operation code %s on insert', (code) => {
    const database = databaseThrough0062();

    applyMigration(database);
    database.exec(
      `INSERT INTO transactions (id, holding_id, amount_minor_units, time, source, operation)
       VALUES ('labelled', 'holding', -200, 2, 'manual', '${code}')`,
    );

    expect(operationOf(database, 'labelled')).toBe(code);
  });
});
