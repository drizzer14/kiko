// Builds the ACTUAL SQL/params Drizzle generates for
// `insertDedupRowsDatabaseTransaction`'s upsert — never a hand-transcribed
// copy of it — via a `drizzle-orm/sqlite-proxy` instance whose remote
// callback is never invoked (`.toSQL()` only compiles the query, it never
// executes it), reusing that function's own exported
// `bankOwnedTransactionSet`/`bankOwnedTransactionSetWhere`. That exact SQL is
// then run against a real, in-process `node:sqlite` engine — op-sqlite
// itself is a native module unavailable under Jest, and the fake
// `databaseTransaction` double `transactions.repo.test.ts` uses elsewhere
// never enforces real SQLite upsert/WHERE semantics, so only a real engine
// can prove `setWhere` actually suppresses a no-op UPDATE (and still applies
// a genuine one).
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { transactions } from '@kiko/db';
import { DatabaseSync } from 'node:sqlite';
import { drizzle } from 'drizzle-orm/sqlite-proxy';

import { bankOwnedTransactionSet, bankOwnedTransactionSetWhere } from './transactions.repo';

const neverCalled = async (): Promise<{ rows: unknown[] }> => {
  throw new Error('the sqlite-proxy callback must never run — this instance is toSQL()-only');
};

const proxyDb = drizzle(neverCalled);

// The REAL insert Drizzle builds names every column of the real `transactions`
// table (defaulting the ones this test never sets), so the test database must
// have that table's REAL, full shape too — the ACTUAL shipped migration SQL
// (the same files `run-migrations.ts` loads), applied to a real, in-process
// `node:sqlite` engine, mirroring `accounts.repo.foreign-keys.test.ts`'s own
// "real engine, not a hand-mirrored schema" precedent.
const MIGRATIONS_ROOT = join(__dirname, '..', '..', '..', 'drizzle', 'migrations');
const STATEMENT_BREAKPOINT = '--> statement-breakpoint';

const applyAllMigrations = (database: DatabaseSync): void => {
  const journal = JSON.parse(
    readFileSync(join(MIGRATIONS_ROOT, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: { tag: string }[] };

  for (const entry of journal.entries) {
    const sql = readFileSync(join(MIGRATIONS_ROOT, `${entry.tag}.sql`), 'utf8');
    const statements = sql
      .split(STATEMENT_BREAKPOINT)
      .map((statement) => statement.trim())
      .filter((statement) => statement !== '');

    for (const statement of statements) {
      database.exec(statement);
    }
  }
};

type Row = {
  id: string;
  holdingId: string;
  amountMinorUnits: number;
  time: number;
  description: string;
  category: string | null;
  mcc: number | null;
  hold: boolean | null;
  counterIban: string | null;
  source: 'manual' | 'monobank' | 'btc_wallet' | 'binance' | 'import';
  externalId: string | null;
};

// The exact statement `insertDedupRowsDatabaseTransaction` builds for one
// upsert row (target + set + setWhere) — mirrors it precisely, since it
// reuses that function's own `bankOwnedTransactionSet`/
// `bankOwnedTransactionSetWhere` rather than restating the column list.
const upsertSql = (row: Row): { sql: string; params: unknown[] } =>
  proxyDb
    .insert(transactions)
    .values(row)
    .onConflictDoUpdate({
      target: [transactions.source, transactions.externalId],
      set: bankOwnedTransactionSet,
      setWhere: bankOwnedTransactionSetWhere,
    })
    .toSQL();

// `client.ts` enables `PRAGMA foreign_keys` in production, so `holding_id`
// needs a real target row — a minimal account + holding, matching
// `accounts.repo.foreign-keys.test.ts`'s own real-FK setup.
const openTestDatabase = (): DatabaseSync => {
  const database = new DatabaseSync(':memory:');

  applyAllMigrations(database);
  database.exec('PRAGMA foreign_keys = ON;');
  database
    .prepare("INSERT INTO accounts (id, name, kind) VALUES ('a-1', 'Monobank', 'bank')")
    .run();
  database
    .prepare(
      "INSERT INTO holdings (id, account_id, name, type, currency) VALUES ('h-1', 'a-1', 'Card', 'card', 'UAH')",
    )
    .run();

  return database;
};

const runUpsert = (database: DatabaseSync, row: Row): { changes: number | bigint } => {
  const { sql, params } = upsertSql(row);

  return database.prepare(sql).run(...(params as (string | number | null)[]));
};

const BASE_ROW: Row = {
  id: 'tx-1',
  holdingId: 'h-1',
  amountMinorUnits: -1_000,
  time: 1_700_000_000_000,
  description: 'Coffee shop',
  category: 'groceries',
  mcc: null,
  hold: false,
  counterIban: null,
  source: 'monobank',
  externalId: 'ext-1',
};

describe('addManyDedup upsert — setWhere suppresses a no-op UPDATE', () => {
  it('reports 0 changes for an identical re-upsert', () => {
    const database = openTestDatabase();

    runUpsert(database, BASE_ROW);

    const result = runUpsert(database, BASE_ROW);

    expect(result.changes).toBe(0);
  });

  it('still updates when a bank-owned column genuinely changed', () => {
    const database = openTestDatabase();

    runUpsert(database, BASE_ROW);

    const settled: Row = { ...BASE_ROW, amountMinorUnits: -1_200 };
    const result = runUpsert(database, settled);

    expect(result.changes).toBe(1);

    const stored = database
      .prepare('SELECT amount_minor_units FROM transactions WHERE id = ?')
      .get('tx-1') as { amount_minor_units: number };

    expect(stored.amount_minor_units).toBe(-1_200);
  });

  it('still updates a genuine NULL-to-value change (an `!=` comparison would have missed this)', () => {
    const database = openTestDatabase();

    runUpsert(database, BASE_ROW);

    const withMcc: Row = { ...BASE_ROW, mcc: 5814 };
    const result = runUpsert(database, withMcc);

    expect(result.changes).toBe(1);
  });

  it('never touches the user-owned category on either the no-op or the genuine-change path', () => {
    const database = openTestDatabase();

    runUpsert(database, BASE_ROW);
    database.prepare('UPDATE transactions SET category = ? WHERE id = ?').run('overridden', 'tx-1');

    const settled: Row = { ...BASE_ROW, amountMinorUnits: -1_200 };

    runUpsert(database, settled);

    const stored = database
      .prepare('SELECT category FROM transactions WHERE id = ?')
      .get('tx-1') as { category: string };

    expect(stored.category).toBe('overridden');
  });
});
