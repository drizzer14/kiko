// Builds the ACTUAL SQL/params Drizzle generates for `setSyncedBalance`'s
// UPDATE — never a hand-transcribed copy of it — via a
// `drizzle-orm/sqlite-proxy` instance whose remote callback is never invoked
// (`.toSQL()` only compiles the query, it never executes it), reusing that
// function's own exported `syncedBalanceUpdateWhere`. That exact SQL is then
// run against a real, in-process `node:sqlite` engine, with the real
// migrated schema (the same files `run-migrations.ts` loads) — op-sqlite
// itself is a native module unavailable under Jest, and the fake
// `databaseTransaction` double `holdings.repo.test.ts` uses elsewhere never
// enforces real SQLite WHERE semantics, so only a real engine can prove the
// write is skipped when the synced balance already matches (and still
// applies when it does not). Mirrors `accounts.repo.foreign-keys.test.ts`'s
// own "real engine, not a hand-mirrored schema" precedent.
import { holdings } from '@kiko/db';
import { DatabaseSync } from 'node:sqlite';
import { applyAllMigrations, toSqlOnlyDrizzle } from '@kiko/test-support/real-sqlite';

import { syncedBalanceUpdateWhere } from './holdings.repo';

const proxyDb = toSqlOnlyDrizzle();

// The exact statement `setSyncedBalance` builds — mirrors it precisely,
// since it reuses that function's own exported `syncedBalanceUpdateWhere`
// rather than restating the WHERE clause.
const updateSql = (minorUnits: number): { sql: string; params: unknown[] } =>
  proxyDb
    .update(holdings)
    .set({ syncedBalanceMinorUnits: minorUnits })
    .where(syncedBalanceUpdateWhere('h-1', minorUnits))
    .toSQL();

// `client.ts` enables `PRAGMA foreign_keys` in production, so `account_id`
// needs a real target row.
const openTestDatabase = (initialSyncedBalance: number | null): DatabaseSync => {
  const database = new DatabaseSync(':memory:');

  applyAllMigrations(database);
  database.exec('PRAGMA foreign_keys = ON;');
  database
    .prepare("INSERT INTO accounts (id, name, kind) VALUES ('a-1', 'Monobank', 'bank')")
    .run();
  database
    .prepare(
      `INSERT INTO holdings (id, account_id, name, type, currency, synced_balance_minor_units)
       VALUES ('h-1', 'a-1', 'Card', 'card', 'UAH', ?)`,
    )
    .run(initialSyncedBalance);

  return database;
};

const runUpdate = (database: DatabaseSync, minorUnits: number): { changes: number | bigint } => {
  const { sql, params } = updateSql(minorUnits);

  return database.prepare(sql).run(...(params as (string | number | null)[]));
};

const storedBalance = (database: DatabaseSync): number | null =>
  (
    database
      .prepare('SELECT synced_balance_minor_units AS value FROM holdings WHERE id = ?')
      .get('h-1') as { value: number | null }
  ).value;

describe('setSyncedBalance update — skips a no-op write', () => {
  it('reports 0 changes when the synced balance already matches', () => {
    const database = openTestDatabase(5_000);

    const result = runUpdate(database, 5_000);

    expect(result.changes).toBe(0);
  });

  it('still updates when the synced balance genuinely changed', () => {
    const database = openTestDatabase(5_000);

    const result = runUpdate(database, 6_000);

    expect(result.changes).toBe(1);
    expect(storedBalance(database)).toBe(6_000);
  });

  it('still updates a never-synced-through holding (NULL marker) on its first real balance', () => {
    const database = openTestDatabase(null);

    const result = runUpdate(database, 5_000);

    expect(result.changes).toBe(1);
  });
});
