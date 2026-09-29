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

const journalEntries = (): MigrationJournalEntry[] =>
  (
    JSON.parse(readFileSync(join(MIGRATIONS_ROOT, 'meta', '_journal.json'), 'utf8')) as {
      entries: MigrationJournalEntry[];
    }
  ).entries;

const applyEntries = (database: DatabaseSync, entries: MigrationJournalEntry[]): void => {
  for (const entry of entries) {
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

/**
 * Applies every shipped migration SQL file (the same files `run-migrations.ts`
 * loads) to `database`, in journal order, so a test runs against the real,
 * full schema rather than a hand-mirrored subset of it.
 */
export const applyAllMigrations = (database: DatabaseSync): void => {
  applyEntries(database, journalEntries());
};

/**
 * Applies every migration up to and including `lastTag`, in journal order —
 * for a test that needs to seed data as it would have existed BEFORE a
 * later migration (e.g. `0043`) ran, then apply that migration itself as a
 * separate, observed step. Throws if `lastTag` isn't a real journal entry —
 * a typo'd tag would otherwise silently apply every migration (an empty
 * `.slice` reads as "stop immediately", not "tag not found").
 */
export const applyMigrationsThrough = (database: DatabaseSync, lastTag: string): void => {
  const entries = journalEntries();
  const lastIndex = entries.findIndex((entry) => entry.tag === lastTag);

  if (lastIndex === -1) {
    throw new Error(`real-sqlite: no migration journal entry tagged "${lastTag}"`);
  }

  applyEntries(database, entries.slice(0, lastIndex + 1));
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

type SqlParameter = string | number | bigint | null | Uint8Array;

type ExecutingClient = {
  database: SqliteRemoteDatabase;
  write: <T>(work: (database: SqliteRemoteDatabase) => Promise<T>) => Promise<T>;
};

/**
 * The two members of `@kiko/db/client` a repository calls, `database` and
 * `write`, EXECUTING every query on the real engine `resolveDatabase` returns,
 * so a repository test proves real joins, aggregates, NULL handling and
 * foreign keys instead of a fake handle's idea of them. `write` wraps its work
 * in BEGIN/COMMIT and rolls back on a throw, as op-sqlite's transaction does.
 * The engine is resolved per query, so a `jest.mock` factory can build this
 * before the test has opened its database.
 */
export const executingClient = (resolveDatabase: () => DatabaseSync): ExecutingClient => {
  const database = drizzle(async (sql, params, method) => {
    const statement = resolveDatabase().prepare(sql);
    const parameters = params as SqlParameter[];

    if (method === 'run') {
      statement.run(...parameters);

      return { rows: [] };
    }

    // Drizzle maps a selected row by column position, not by name.
    statement.setReturnArrays(true);

    return method === 'get'
      ? { rows: statement.get(...parameters) as unknown as unknown[] }
      : { rows: statement.all(...parameters) };
  });

  const write = async <T>(work: (database: SqliteRemoteDatabase) => Promise<T>): Promise<T> => {
    const engine = resolveDatabase();

    engine.exec('BEGIN');

    try {
      const result = await work(database);

      engine.exec('COMMIT');

      return result;
    } catch (error) {
      engine.exec('ROLLBACK');
      throw error;
    }
  };

  return { database, write };
};

/**
 * A `drizzle-orm/sqlite-proxy` instance that actually EXECUTES against a
 * real, in-process `node:sqlite` database — unlike `toSqlOnlyDrizzle` above,
 * every query this instance runs (`select`/`update`/`insert`) reaches real
 * SQLite. Cast to the app's own `typeof database` (`@kiko/db/client`): the
 * real production type is op-sqlite-specific, but the SQL this generates is
 * the identical `drizzle-orm/sqlite-core` dialect either driver speaks, so a
 * function typed against `typeof database` (e.g. `rezoneImportTimesIn`) can
 * run its real query-builder calls directly against this in a test.
 */
export const executingDrizzle = <Database>(database: DatabaseSync): Database =>
  drizzle(async (sql, params, method) => {
    const statement = database.prepare(sql);
    const bound = params as SqlParameter[];

    if (method === 'run') {
      statement.run(...bound);

      return { rows: [] };
    }

    const rows = (statement.all(...bound) as Record<string, unknown>[]).map((row) =>
      Object.values(row),
    );

    return { rows: method === 'get' ? (rows[0] ?? []) : rows };
  }) as unknown as Database;
