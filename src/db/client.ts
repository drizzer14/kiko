import { open } from '@op-engineering/op-sqlite';
import { drizzle } from 'drizzle-orm/op-sqlite';
import * as schema from './schema';

/**
 * The raw op-sqlite connection handle. Exposed so reactive consumers
 * (the `useLiveQuery` hook in Task 8) can call `rawDatabase.reactiveExecute`.
 * All ORM access should go through `database`; all writes through `write`.
 */
export const rawDatabase = open({ name: 'pff.db' });

// SQLite defaults foreign_keys OFF per connection and op-sqlite's open() does
// not change it. Enable enforcement once at module load, on the raw connection,
// before any transaction/write runs. The pragma is per-connection and a no-op
// inside a transaction, so it must run here rather than inside `write`.
rawDatabase.execute('PRAGMA foreign_keys = ON');

/**
 * The Drizzle ORM instance layered over the same op-sqlite connection.
 * Reads (query builders passed to `useLiveQuery`) use this directly;
 * writes must go through `write` so they run inside a transaction.
 */
export const database = drizzle(rawDatabase, { schema });

/**
 * The one sanctioned write path for the app.
 *
 * REACTIVE RULE: op-sqlite fires a reactive query's callback only when the
 * mutation that changed the table ran inside `rawDatabase.transaction(...)`.
 * A write issued outside a transaction is invisible to every live query
 * watching that table, so the UI silently goes stale. Therefore `write`
 * wraps the Drizzle operations in the *raw* op-sqlite transaction (not
 * Drizzle's own `database.transaction`, which does not drive op-sqlite's
 * reactive flush). Because `database` is built over `rawDatabase`, the
 * Drizzle statements run on the same connection inside the native
 * transaction, and reactive queries fire on commit. Errors auto-rollback.
 *
 * The callback receives the global `database` instance (not a
 * transaction-scoped Drizzle handle) — its statements run on `rawDatabase`,
 * which is already inside the open native transaction.
 *
 * Every insert/update/delete in the app — even a single statement — must
 * go through here.
 */
export const write = async <T>(work: (db: typeof database) => Promise<T>): Promise<T> => {
  let result!: T;
  await rawDatabase.transaction(async () => {
    result = await work(database);
  });
  // Idempotent: flushes only the pending reactive queue. If the transaction
  // commit already flushed, this is a harmless no-op. Guarantees live queries
  // (Task 8's useLiveQuery) refresh after every write, removing the runtime
  // uncertainty about whether the commit alone drives the reactive flush.
  await rawDatabase.flushPendingReactiveQueries();
  return result;
};
