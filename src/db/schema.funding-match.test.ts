// src/db/schema.funding-match.test.ts
//
// The stored set of paired ledger rows, on the real migrated engine: its final columns, an
// empty start, and the primary key serving the read and the prune of one account's rows.
import { DatabaseSync } from 'node:sqlite';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

type Column = {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
};

const migratedDatabase = (): DatabaseSync => {
  const database = new DatabaseSync(':memory:');

  applyAllMigrations(database);
  database.exec('PRAGMA foreign_keys = ON');

  return database;
};

const planOf = (database: DatabaseSync, statement: string): string[] =>
  (database.prepare(`EXPLAIN QUERY PLAN ${statement}`).all() as { detail: string }[]).map(
    (step) => step.detail,
  );

describe('the funding_match_rows table', () => {
  it('has its final columns, starts empty, and keys its rows by account, side and record', () => {
    const database = migratedDatabase();
    const columns = (
      database.prepare("SELECT * FROM pragma_table_info('funding_match_rows')").all() as Column[]
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
    expect(database.prepare('SELECT COUNT(*) AS total FROM funding_match_rows').get()).toEqual({
      total: 0,
    });
  });

  it('refers to accounts, and a row with no such account is refused', () => {
    const database = migratedDatabase();
    const references = database
      .prepare('SELECT "table", "from", "to" FROM pragma_foreign_key_list(\'funding_match_rows\')')
      .all();

    expect(references).toEqual([{ table: 'accounts', from: 'account_id', to: 'id' }]);
    expect(() =>
      database
        .prepare(
          `INSERT INTO funding_match_rows (account_id, side, record_key, coin, direction, amount, time_start, time_end)
           VALUES ('missing', 'ledger', 'k', 'USDT', 'I', '1', 1, 1)`,
        )
        .run(),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  it('keeps one row per account, side and record key', () => {
    const database = migratedDatabase();

    database.exec("INSERT INTO accounts (id, name, kind) VALUES ('account', 'Exchange', 'crypto')");

    const insert = (side: string, recordKey: string): void => {
      database
        .prepare(
          `INSERT INTO funding_match_rows (account_id, side, record_key, coin, direction, amount, time_start, time_end)
           VALUES ('account', ?, ?, 'USDT', 'I', '1', 1, 1)`,
        )
        .run(side, recordKey);
    };

    insert('ledger', 'k');
    insert('source', 'k');

    expect(() => insert('ledger', 'k')).toThrow(/UNIQUE constraint failed/);
  });

  it.each([
    ['the read of one account', 'SELECT * FROM funding_match_rows WHERE account_id = ?'],
    [
      'the prune of one account below a time',
      'DELETE FROM funding_match_rows WHERE account_id = ? AND time_end < ?',
    ],
    ['the clear of one account', 'DELETE FROM funding_match_rows WHERE account_id = ?'],
  ])('serves %s by the primary key, never a scan', (_label, statement) => {
    const plan = planOf(migratedDatabase(), statement).join('\n');

    expect(plan).toMatch(
      /SEARCH funding_match_rows USING (COVERING )?INDEX sqlite_autoindex_funding_match_rows_1 \(account_id=\?\)/,
    );
    expect(plan).not.toMatch(/SCAN/);
  });
});
