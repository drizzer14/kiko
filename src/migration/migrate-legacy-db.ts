import type { DB } from '@op-engineering/op-sqlite';
import { open } from '@op-engineering/op-sqlite';

/**
 * LEGACY (pre-`kiko` rename) on-device database name. This literal is the
 * documented residual-`pff` exception: it exists only so a device that ran an
 * older build can have its data migrated into `kiko.db`. Do NOT reference
 * `pff` anywhere else in the app.
 */
const LEGACY_DB_NAME = 'pff.db';
const DB_NAME = 'kiko.db';

const TABLE_COUNT_SQL =
  "SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'";

/** Number of non-internal (user) tables in the given connection. */
const tableCount = (db: DB): number => Number(db.executeSync(TABLE_COUNT_SQL).rows[0]?.n ?? 0);

/**
 * One-time, synchronous, idempotent migration of the legacy `pff.db` database
 * to `kiko.db`. Must run at module load, before anything opens `kiko.db` for
 * real use. Returns the connection the app should adopt as `rawDatabase`.
 *
 * Algorithm:
 * 1. Open (creating if absent) `kiko.db`. If it already has user tables the
 *    migration has run before — adopt it as-is.
 * 2. Otherwise inspect the legacy `pff.db`:
 *    - If it has user tables, copy it into a fresh `kiko.db` with SQLite's
 *      `VACUUM INTO`, which writes a standalone consistent snapshot (so no
 *      `-wal`/`-shm` files need handling). The empty `kiko.db` op-sqlite just
 *      created is closed and deleted first so `VACUUM INTO` can write the
 *      path. The populated legacy db is deliberately LEFT in place as an
 *      on-device safety-net backup.
 *    - If it has no user tables (genuine fresh install, or op-sqlite
 *      auto-created an empty `pff.db`), delete that stray empty legacy db so
 *      nothing is left behind.
 */
export const migrateLegacyDatabase = (): DB => {
  const kiko = open({ name: DB_NAME });

  if (tableCount(kiko) > 0) {
    return kiko;
  }

  const legacy = open({ name: LEGACY_DB_NAME });

  if (tableCount(legacy) === 0) {
    legacy.close();
    legacy.delete();
    return kiko;
  }

  const kikoPath = kiko.getDbPath();
  kiko.close();
  kiko.delete();
  legacy.executeSync(`VACUUM INTO '${kikoPath}'`);

  return open({ name: DB_NAME });
};
