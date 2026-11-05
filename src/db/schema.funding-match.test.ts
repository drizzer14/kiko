// src/db/schema.funding-match.test.ts
//
// The stored set of ledger rows and sources, on the real migrated engine: the primary key serving
// the read, the prune and the clear of one account's rows. Its columns, its keys and its empty
// start are pinned in drizzle/migrations/0066-add-funding-match-rows.test.ts.
import { DatabaseSync } from 'node:sqlite';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

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
