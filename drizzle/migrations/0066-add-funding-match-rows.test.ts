// drizzle/migrations/0066-add-funding-match-rows.test.ts
//
// Runs the shipped SQL on a real `node:sqlite` engine seeded as a device's database stood before
// it, so the table, its key, its foreign key and its empty start are proven on the real engine.
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { applyMigrationsThrough } from '@kiko/test-support/real-sqlite';

const MIGRATION_SQL = readFileSync(join(__dirname, '0066_add_funding_match_rows.sql'), 'utf8');

type Column = {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
};

const run = (
  database: DatabaseSync,
  statement: string,
  ...parameters: (string | number | null)[]
): void => {
  database.prepare(statement).run(...parameters);
};

const applyMigration = (database: DatabaseSync): void => {
  for (const statement of MIGRATION_SQL.split('--> statement-breakpoint')
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate !== '')) {
    database.exec(statement);
  }
};

const databaseThrough0065 = (): DatabaseSync => {
  const database = new DatabaseSync(':memory:');

  applyMigrationsThrough(database, '0065_add_mcc_categories_backfilled');
  database.exec('PRAGMA foreign_keys = ON');
  run(database, "INSERT INTO accounts (id, name, kind) VALUES ('account', 'Exchange', 'crypto')");
  run(
    database,
    `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units)
     VALUES ('coin', 'account', 'Coin', 'crypto_asset', 'BTC', 100)`,
  );
  run(database, 'INSERT INTO sync_state (account_id) VALUES (?)', 'account');

  return database;
};

const migratedDatabase = (): DatabaseSync => {
  const database = databaseThrough0065();

  applyMigration(database);

  return database;
};

const tableNames = (database: DatabaseSync): string[] =>
  (
    database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
      name: string;
    }[]
  ).map((table) => table.name);

const insertRow = (database: DatabaseSync, side: string, recordKey: string): void => {
  run(
    database,
    `INSERT INTO funding_match_rows
       (account_id, side, record_key, coin, direction, amount, time_start, time_end)
     VALUES ('account', ?, ?, 'USDT', 'I', '100', 1, 2)`,
    side,
    recordKey,
  );
};

describe('migration 0066: the table of stored funding match rows', () => {
  it('adds the table', () => {
    const database = databaseThrough0065();

    expect(tableNames(database)).not.toContain('funding_match_rows');

    applyMigration(database);

    expect(tableNames(database)).toContain('funding_match_rows');
  });

  it('has the twelve final columns, the first three as the primary key', () => {
    const columns = (
      migratedDatabase()
        .prepare("SELECT * FROM pragma_table_info('funding_match_rows')")
        .all() as Column[]
    ).map(({ name, type, notnull, dflt_value: defaultValue, pk }) => ({
      name,
      type,
      notnull,
      defaultValue,
      pk,
    }));

    expect(columns).toEqual([
      { name: 'account_id', type: 'TEXT', notnull: 1, defaultValue: null, pk: 1 },
      { name: 'side', type: 'TEXT', notnull: 1, defaultValue: null, pk: 2 },
      { name: 'record_key', type: 'TEXT', notnull: 1, defaultValue: null, pk: 3 },
      { name: 'series', type: 'TEXT', notnull: 0, defaultValue: null, pk: 0 },
      { name: 'coin', type: 'TEXT', notnull: 1, defaultValue: null, pk: 0 },
      { name: 'direction', type: 'TEXT', notnull: 1, defaultValue: null, pk: 0 },
      { name: 'amount', type: 'TEXT', notnull: 1, defaultValue: null, pk: 0 },
      { name: 'fee', type: 'TEXT', notnull: 0, defaultValue: null, pk: 0 },
      { name: 'tax', type: 'TEXT', notnull: 0, defaultValue: null, pk: 0 },
      { name: 'time_start', type: 'INTEGER', notnull: 1, defaultValue: null, pk: 0 },
      { name: 'time_end', type: 'INTEGER', notnull: 1, defaultValue: null, pk: 0 },
      { name: 'earn_principal', type: 'INTEGER', notnull: 1, defaultValue: 'false', pk: 0 },
    ]);
  });

  it('reads a row written without the Earn flag as not an Earn move', () => {
    const database = migratedDatabase();

    insertRow(database, 'ledger', 'k');

    expect(
      database.prepare('SELECT earn_principal AS value FROM funding_match_rows').get(),
    ).toEqual({ value: 0 });
  });

  it('holds one row per account, side and key, and the same key on the other side', () => {
    const database = migratedDatabase();

    insertRow(database, 'ledger', 'k');

    expect(() => insertRow(database, 'ledger', 'k')).toThrow(/UNIQUE/);
    expect(() => insertRow(database, 'source', 'k')).not.toThrow();
  });

  it('refuses a row for an account that does not exist', () => {
    const database = migratedDatabase();

    expect(() =>
      run(
        database,
        `INSERT INTO funding_match_rows
           (account_id, side, record_key, coin, direction, amount, time_start, time_end)
         VALUES ('gone', 'ledger', 'k', 'USDT', 'I', '100', 1, 2)`,
      ),
    ).toThrow(/FOREIGN KEY/);
  });

  it('refuses to delete an account that still has a row, without cascading', () => {
    const database = migratedDatabase();

    insertRow(database, 'ledger', 'k');
    run(database, "DELETE FROM sync_state WHERE account_id = 'account'");
    run(database, "DELETE FROM holdings WHERE account_id = 'account'");

    expect(() => run(database, "DELETE FROM accounts WHERE id = 'account'")).toThrow(/FOREIGN KEY/);
  });

  it('starts empty and leaves the accounts, holdings and sync state as they were', () => {
    const before = databaseThrough0065();
    const tables = ['accounts', 'holdings', 'sync_state', 'transactions', 'settings'];
    const rowsBefore = tables.map((table) => before.prepare(`SELECT * FROM ${table}`).all());

    applyMigration(before);

    expect(before.prepare('SELECT count(*) AS value FROM funding_match_rows').get()).toEqual({
      value: 0,
    });
    expect(tables.map((table) => before.prepare(`SELECT * FROM ${table}`).all())).toEqual(
      rowsBefore,
    );
  });
});
