// `accounts.repo.test.ts` doubles `write`'s op-sqlite transaction with a fake
// handle that answers every select/insert/delete call but enforces NO
// foreign key at all — it could not have caught the `sync_state` FK
// violation this file protects. This file instead applies
// the REAL, shipped migration SQL (the same files `run-migrations.ts` loads)
// to an in-process `node:sqlite` engine with `PRAGMA foreign_keys = ON`
// (mirroring `db/client.ts`'s own per-connection PRAGMA), then mirrors
// `accountsRepo.remove`'s delete sequence as raw SQL against it — the same
// technique `drizzle/migrations/0040-*.test.ts` uses for one migration file,
// applied here to the FULL migration chain.
//
// The table list this test checks is DERIVED from `PRAGMA foreign_key_list`
// at run time, not hand-typed: it seeds a generic dummy row (from `PRAGMA
// table_info`, with no knowledge of any specific table's columns) into EVERY
// table that currently references `accounts`, then asserts every one of them
// is empty for the deleted account afterward. A future migration that adds a
// new `accounts`-referencing column is caught by that generic assertion even
// though `removeAccountLikeTheRepoDoes` below — a hand-mirror of
// `accountsRepo.remove`'s own delete statements — was not updated for it.
import { DatabaseSync } from 'node:sqlite';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

type ForeignKeyListRow = { table: string; from: string };
type TableInfoRow = {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
};

/** Every (table, column) pair whose column is a live foreign key into `accounts`. */
const tablesReferencingAccounts = (database: DatabaseSync): { table: string; column: string }[] => {
  const tables = (
    database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
      name: string;
    }[]
  ).map((row) => row.name);

  return tables.flatMap((table) =>
    (database.prepare(`PRAGMA foreign_key_list(${table})`).all() as ForeignKeyListRow[])
      .filter((foreignKey) => foreignKey.table === 'accounts')
      .map((foreignKey) => ({ table, column: foreignKey.from })),
  );
};

/**
 * Insert a minimal, generically-valid row into `table`: the foreign key
 * column gets `accountId`, any OTHER primary key gets `generatedId`, and
 * every remaining NOT NULL, no-default column gets a type-appropriate
 * placeholder. A nullable or defaulted column is left out of the statement
 * entirely. This has no knowledge of any specific table's schema, so it
 * seeds a table a FUTURE migration adds the same generic way it seeds
 * `holdings`/`sync_state` today.
 */
const insertDummyRowReferencingAccount = (
  database: DatabaseSync,
  table: string,
  foreignKeyColumn: string,
  accountId: string,
  generatedId: string,
): void => {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as TableInfoRow[];
  const names: string[] = [];
  const values: (string | number)[] = [];

  for (const column of columns) {
    const isForeignKeyColumn = column.name === foreignKeyColumn;

    if (!isForeignKeyColumn && column.dflt_value !== null) {
      continue;
    }

    if (!isForeignKeyColumn && !column.notnull && column.pk !== 1) {
      continue;
    }

    names.push(column.name);

    if (isForeignKeyColumn) {
      values.push(accountId);
    } else if (column.pk === 1) {
      values.push(generatedId);
    } else if (column.type.toUpperCase().includes('INT')) {
      values.push(0);
    } else {
      values.push('placeholder');
    }
  }

  database
    .prepare(
      `INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
    )
    .run(...values);
};

const rowCountFor = (
  database: DatabaseSync,
  table: string,
  column: string,
  value: string,
): number =>
  (
    database.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} = ?`).get(value) as {
      count: number;
    }
  ).count;

/**
 * Mirrors `accountsRepo.remove`'s own delete sequence (`accounts.repo.ts`) as
 * raw SQL, in the SAME order: each holding's transactions, then the
 * account's `sync_state` row, then holdings, then the account
 * itself. Loan-link clearing (an UPDATE, not a DELETE) is intentionally not
 * mirrored — it never touches a row this FK invariant cares about. Keep this
 * in sync by hand when `remove`'s delete order changes, the same way
 * `sync.test.ts`'s in-memory repo doubles are kept in sync with the real
 * repos they stand for.
 */
const removeAccountLikeTheRepoDoes = (database: DatabaseSync, accountId: string): void => {
  const holdingIds = (
    database.prepare('SELECT id FROM holdings WHERE account_id = ?').all(accountId) as {
      id: string;
    }[]
  ).map((row) => row.id);

  for (const holdingId of holdingIds) {
    database.prepare('DELETE FROM transactions WHERE holding_id = ?').run(holdingId);
  }
  database.prepare('DELETE FROM sync_state WHERE account_id = ?').run(accountId);
  database.prepare('DELETE FROM holdings WHERE account_id = ?').run(accountId);
  database.prepare('DELETE FROM accounts WHERE id = ?').run(accountId);
};

describe('accountsRepo.remove — real-SQLite foreign key invariant', () => {
  it('clears every table with a live foreign key to accounts, with FKs enforced', () => {
    const database = new DatabaseSync(':memory:');
    applyAllMigrations(database);
    database.exec('PRAGMA foreign_keys = ON;');
    database
      .prepare("INSERT INTO accounts (id, name, kind) VALUES ('acc-1', 'Test', 'bank')")
      .run();

    const referencingTables = tablesReferencingAccounts(database);
    // A schema change that stopped referencing `accounts` entirely would make
    // every later assertion here vacuous (trivially true over zero tables),
    // so pin the two known today as a floor — a future migration only grows
    // this list.
    expect(referencingTables.map((entry) => entry.table).sort()).toEqual([
      'holdings',
      'sync_state',
    ]);

    for (const { table, column } of referencingTables) {
      insertDummyRowReferencingAccount(database, table, column, 'acc-1', `${table}-row-1`);
    }

    expect(() => removeAccountLikeTheRepoDoes(database, 'acc-1')).not.toThrow();

    for (const { table, column } of referencingTables) {
      expect(rowCountFor(database, table, column, 'acc-1')).toBe(0);
    }
  });

  // The regression itself, isolated: deleting `accounts` while its
  // `sync_state` row is still present throws a real FK constraint error —
  // proving FKs are genuinely enforced in this test, and reproducing exactly
  // what an un-fixed `accountsRepo.remove` (deleting `accounts` before
  // `sync_state`) hits on any account that ever attempted a Monobank sync.
  it('throws a foreign key error when accounts is deleted before its sync_state row', () => {
    const database = new DatabaseSync(':memory:');
    applyAllMigrations(database);
    database.exec('PRAGMA foreign_keys = ON;');
    database
      .prepare("INSERT INTO accounts (id, name, kind) VALUES ('acc-1', 'Test', 'bank')")
      .run();
    database.prepare("INSERT INTO sync_state (account_id) VALUES ('acc-1')").run();

    expect(() => database.prepare("DELETE FROM accounts WHERE id = 'acc-1'").run()).toThrow(
      /FOREIGN KEY constraint failed/,
    );
  });
});
