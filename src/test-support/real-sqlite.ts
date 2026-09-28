/**
 * A real, in-process `node:sqlite` engine plus a `.toSQL()`-only
 * `drizzle-orm/sqlite-proxy` instance, for a test that needs Drizzle's ACTUAL
 * generated SQL/params proven against the REAL, fully-migrated schema —
 * op-sqlite itself is a native module unavailable under Jest, and a
 * hand-mirrored fake `databaseTransaction` double never enforces real SQLite
 * WHERE/upsert/foreign-key semantics. Three call sites each built their own
 * copy of both pieces before this consolidation:
 * `accounts.repo.foreign-keys.test.ts`, `holdings.repo.synced-balance-no-op.test.ts`,
 * and `transactions.repo.upsert-no-op.test.ts`.
 */
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import type { SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy';

const MIGRATIONS_ROOT = join(__dirname, '..', '..', 'drizzle', 'migrations');
const STATEMENT_BREAKPOINT = '--> statement-breakpoint';

type MigrationJournalEntry = { tag: string };

/**
 * Applies every shipped migration SQL file (the same files `run-migrations.ts`
 * loads) to `database`, in journal order, so a test runs against the real,
 * full schema rather than a hand-mirrored subset of it.
 */
export const applyAllMigrations = (database: DatabaseSync): void => {
  const journal = JSON.parse(
    readFileSync(join(MIGRATIONS_ROOT, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: MigrationJournalEntry[] };

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

const neverCalled = async (): Promise<{ rows: unknown[] }> => {
  throw new Error('the sqlite-proxy callback must never run — this instance is toSQL()-only');
};

/**
 * A `drizzle-orm/sqlite-proxy` instance whose remote callback is never
 * invoked (`.toSQL()` only compiles a query, it never executes it) — lets a
 * test read the ACTUAL SQL/params Drizzle generates for a query, rather than
 * a hand-transcribed copy of it.
 */
export const toSqlOnlyDrizzle = (): SqliteRemoteDatabase => drizzle(neverCalled);
