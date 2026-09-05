import migrations from '../../drizzle/migrations/migrations';

import { rawDatabase } from './client';

/**
 * A minimal, op-sqlite-18-correct reimplementation of drizzle-orm's op-sqlite
 * migrator.
 *
 * WHY THIS EXISTS: `drizzle-orm@0.45.2`'s migrator decides "already applied?"
 * through `session.values()`, which calls op-sqlite's `executeRawAsync`. On
 * `@op-engineering/op-sqlite@18.1.4` that returns a
 * `{ rawRows, columnNames }` OBJECT, not the bare row array drizzle's migrator
 * expects, so `dbMigrations[0]` is always `undefined`, the last-applied
 * timestamp is never found, and drizzle re-runs *every* migration on each
 * launch — the plain `CREATE TABLE accounts` (no `IF NOT EXISTS`) then throws
 * on the second cold launch once the tables already exist.
 *
 * This runner mirrors drizzle's own semantics exactly (same bookkeeping table,
 * same `folderMillis` gate, same per-migration insert) but reads the applied
 * state through op-sqlite 18's working `execute().rows` path instead of the
 * broken `values()`/`executeRawAsync` path. It reuses the very same bundled
 * migrations drizzle imports — the SQL is never hand-duplicated here.
 */

const MIGRATIONS_TABLE = '__drizzle_migrations';

// drizzle's op-sqlite `readMigrationFiles` splits each migration file on this
// exact token to recover its individual statements. Match it so this runner
// executes the same statements drizzle would.
const STATEMENT_BREAKPOINT = '--> statement-breakpoint';

type MigrationJournalEntry = {
  idx: number;
  when: number;
  tag: string;
};

type MigrationBundle = {
  journal: { entries: MigrationJournalEntry[] };
  migrations: Record<string, string>;
};

// The bundle is a plain `.js` module with an inlined-`.sql` payload and no type
// declarations, so it arrives untyped; view it through the shape drizzle's own
// `MigrationConfig` documents.
const migrationBundle = migrations as MigrationBundle;

const ensureMigrationsTable = async (): Promise<void> => {
  await rawDatabase.execute(
    `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric)`,
  );
};

// Gate on the NUMBER of migrations already recorded, not on a MAX(created_at)
// high-water mark. drizzle applies journal entries strictly in order and records
// one row per applied migration, so "already applied" is exactly "the first N
// journal entries", where N is the recorded row count. A timestamp gate breaks
// the moment the journal's `when` values are non-monotonic — e.g. a later idx
// generated in a different worktree with an earlier wall clock — because it then
// treats those out-of-order entries as already applied and skips their schema.
// Counting is the mechanism drizzle itself uses and is immune to that.
const readAppliedCount = async (): Promise<number> => {
  const result = await rawDatabase.execute(`SELECT COUNT(*) AS count FROM ${MIGRATIONS_TABLE}`);
  const [row] = result.rows;

  return row === undefined ? 0 : Number(row.count);
};

const resolveMigrationSql = (entry: MigrationJournalEntry): string => {
  const key = `m${entry.idx.toString().padStart(4, '0')}`;
  const sql = migrationBundle.migrations[key];

  if (sql === undefined) {
    throw new Error(`Missing migration: ${entry.tag}`);
  }

  return sql;
};

const applyMigration = async (entry: MigrationJournalEntry): Promise<void> => {
  // Drop empty/whitespace-only chunks so a trailing breakpoint or a
  // hand-edited migration file cannot produce a `tx.execute('')`.
  const statements = resolveMigrationSql(entry)
    .split(STATEMENT_BREAKPOINT)
    .filter((statement) => statement.trim() !== '');

  // Each migration's statements and its bookkeeping insert commit atomically,
  // matching drizzle's own transactional migration semantics. drizzle records
  // an empty hash for op-sqlite migrations, so this does the same.
  await rawDatabase.transaction(async (tx) => {
    for (const statement of statements) {
      await tx.execute(statement);
    }

    await tx.execute(`INSERT INTO ${MIGRATIONS_TABLE} ("hash", "created_at") VALUES(?, ?)`, [
      '',
      entry.when,
    ]);
  });
};

const doRun = async (): Promise<void> => {
  await ensureMigrationsTable();

  const appliedCount = await readAppliedCount();

  // The first `appliedCount` journal entries are already recorded; apply every
  // entry from that position to the end, in journal order. Slicing past the end
  // yields nothing, so a fully-migrated database is a no-op.
  for (const entry of migrationBundle.journal.entries.slice(appliedCount)) {
    await applyMigration(entry);
  }
};

// A concurrent or repeat invocation (React.StrictMode's double-invoke, a gate
// remount) must not double-enter the un-guarded `CREATE TABLE accounts`, so
// every caller shares this one in-flight run.
let inFlight: Promise<void> | undefined;

/**
 * Bring the database schema up to the latest bundled migration. Idempotent: on
 * a fully-migrated database it creates no tables and writes nothing, so a cold
 * relaunch is a no-op instead of a crash. Concurrent or repeat callers within a
 * process share a single run.
 */
export const runMigrations = (): Promise<void> => {
  // A failed run clears the memo so the next launch (or caller) retries from a
  // clean slate rather than replaying a permanently-rejected promise; a
  // successful run's resolved promise stays memoized (re-runs are no-ops).
  inFlight ??= doRun().catch((error: unknown) => {
    inFlight = undefined;
    throw error;
  });

  return inFlight;
};
