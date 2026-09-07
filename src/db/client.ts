import type { DB, Scalar } from '@op-engineering/op-sqlite';
import { drizzle } from 'drizzle-orm/op-sqlite';

import { DB_ENCRYPTION_ENABLED } from './db-config';
import { openEncryptedDatabase } from './encrypted-database';
import { migrateLegacyDatabase } from './migrate-legacy-db';
import { finalizeImportBridge, importFromOldApp } from './migration/import-from-old-app';
import * as schema from './schema';

let connection: DB | undefined;

const requireConnection = (): DB => {
  if (connection === undefined) {
    throw new Error(
      'Database is not initialized: await initDatabase() (MigrationsGate does this) before any query.',
    );
  }

  return connection;
};

/**
 * The raw op-sqlite connection handle, exposed as a lazy proxy. Reactive
 * consumers (`useLiveQuery`) call `rawDatabase.reactiveExecute`, the migrator
 * calls `rawDatabase.execute`/`transaction`, `write` calls `transaction`.
 *
 * WHY A PROXY: the SQLCipher key lives in the Keychain, whose API is async, so
 * the connection can no longer be opened at module load. Every property access
 * on this handle forwards to the live connection once `initDatabase()` has
 * opened it, which keeps every existing `rawDatabase.<method>(...)` call site
 * (and every test mock of this module) unchanged. Before init it throws a clear
 * error instead of an opaque `undefined is not a function`.
 */
export const rawDatabase: DB = new Proxy({} as DB, {
  get: (_target, property) => {
    const live = requireConnection();
    const value = live[property as keyof DB];

    return typeof value === 'function'
      ? (value as (...args: never[]) => unknown).bind(live)
      : value;
  },
});

/**
 * The launch-time connection. Gated on `DB_ENCRYPTION_ENABLED`:
 *   - flag OFF (default): open the LIVE PLAINTEXT `kiko.db` exactly as the app
 *     did before encryption shipped. `migrateLegacyDatabase()` canonicalizes any
 *     surviving pre-rename `pff.db` into `kiko.db` (idempotent) and returns that
 *     plaintext connection. Nothing here reads/creates the db key, asserts a
 *     SQLCipher build, or deletes a plaintext file.
 *   - flag ON: the full cluster-2 encrypted path (keyed open + one-time
 *     plaintext -> encrypted export). See `db-config.ts` — ON only for the
 *     supervised on-device migration test.
 */
const openConnection = (): Promise<DB> =>
  DB_ENCRYPTION_ENABLED ? openEncryptedDatabase() : Promise.resolve(migrateLegacyDatabase());

const openAndConfigure = async (): Promise<void> => {
  // Run the one-time old-app import BEFORE opening the connection, so
  // establishKey() finds the just-copied kiko.db. A no-op once a key exists.
  await importFromOldApp();
  const opened = await openConnection();
  // SQLite defaults foreign_keys OFF per connection; op-sqlite's open() does not
  // change it. Enable enforcement once, on the raw connection, before any
  // transaction/write runs. The pragma is per-connection and a no-op inside a
  // transaction, so it must run here rather than inside `write`.
  await opened.execute('PRAGMA foreign_keys = ON');
  connection = opened;
  // Wipe the shared bridge container LAST — after init fully resolved. Run this
  // on EVERY launch, not only the importing one: the wipe is best-effort, so a
  // single failed attempt on the import launch (container momentarily
  // unavailable, deleteFile rejects) would otherwise leave the plaintext export
  // DB + secrets JSON at rest in the shared App Group until the Phase 5 cleanup
  // build — a later launch no longer imports (a key exists), so it would never
  // retry. finalizeImportBridge resolves the container itself and never throws,
  // so a later launch with residual bridge files still clears them.
  await finalizeImportBridge();
};

// A concurrent or repeat invocation (a gate remount) must not open two
// connections or run the plaintext export twice, so every caller shares this
// one in-flight run. A failed run clears the memo so the next call retries.
let initialization: Promise<void> | undefined;

/**
 * Opens the encrypted database (running the one-time plaintext export on the
 * first launch after encryption shipped) and enables foreign-key enforcement.
 * Must resolve before the first query; `MigrationsGate` awaits it before
 * `runMigrations()`. Idempotent.
 */
export const initDatabase = (): Promise<void> => {
  initialization ??= openAndConfigure().catch((error: unknown) => {
    initialization = undefined;
    throw error;
  });

  return initialization;
};

/**
 * The op-sqlite connection shape drizzle's op-sqlite session actually calls.
 * drizzle's fielded read path invokes `client.executeRawAsync(sql, params)` and
 * expects a bare `Scalar[][]`; op-sqlite's runtime `executeRawAsync` resolves to
 * a `{ rawRows, columnNames, rowsAffected }` OBJECT — the method is not even on
 * the exported `DB` type. The mismatch makes every read throw and `useLiveQuery`
 * swallow it into empty data, so the whole UI renders blank.
 */
type DrizzleOPSQLiteClient = DB & {
  executeRawAsync(query: string, params?: Scalar[]): Promise<Scalar[][]>;
};

/**
 * Forwards every method to the given op-sqlite handle but overrides
 * `executeRawAsync` to return the unwrapped `Scalar[][]` drizzle's reads expect.
 * A proxy (not a spread copy) so it composes with the lazy `rawDatabase` handle,
 * which has no own properties to copy. Writes are untouched: drizzle mutations
 * and the transaction begin/commit/rollback route through `executeAsync`, whose
 * `QueryResult` return shape this wrapper preserves verbatim.
 */
export const wrapClientForDrizzle = (client: DB): DrizzleOPSQLiteClient =>
  new Proxy(client as DrizzleOPSQLiteClient, {
    get: (target, property, receiver) =>
      property === 'executeRawAsync'
        ? async (query: string, params?: Scalar[]) =>
            (await target.executeRaw(query, params)).rawRows
        : Reflect.get(target, property, receiver),
  });

/**
 * The Drizzle ORM instance layered over the same op-sqlite connection. Reads use
 * this directly; writes must go through `write` so they run inside a transaction.
 * Building a query (`.toSQL()`) needs no connection; executing one needs `initDatabase`.
 */
export const database = drizzle(wrapClientForDrizzle(rawDatabase), { schema });

/**
 * The one sanctioned write path for the app.
 *
 * REACTIVE RULE: op-sqlite fires a reactive query's callback only when the
 * mutation ran inside `rawDatabase.transaction(...)`. A write outside a
 * transaction is invisible to every live query watching that table. So `write`
 * wraps the Drizzle operations in the *raw* op-sqlite transaction (not Drizzle's
 * own `database.transaction`, which does not drive op-sqlite's reactive flush).
 * Errors auto-rollback.
 */
export const write = async <T>(work: (db: typeof database) => Promise<T>): Promise<T> => {
  let result!: T;
  await rawDatabase.transaction(async () => {
    result = await work(database);
  });
  await rawDatabase.flushPendingReactiveQueries();

  return result;
};
