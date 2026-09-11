import { migrationBridge } from './migration-bridge';

/**
 * SQLite writes these sidecars beside a database file: the WAL journal, the
 * shared-memory index, and the rollback journal. They must be deleted together
 * WITH the main file. A lingering `-wal`/`-journal` from an aborted prior export
 * can shadow a freshly-created target before `sqlcipher_export` runs (wrong data
 * migrated), and a plaintext `-wal` left in the shared container is user data at
 * rest until the Phase 5 cleanup build.
 */
const DB_SIDECAR_SUFFIXES = ['-wal', '-shm', '-journal'] as const;

/**
 * Best-effort delete of a DB file AND all of its SQLite sidecars.
 * `migrationBridge.deleteFile` no-ops on an absent file, so every path is
 * deleted unconditionally — no `fileExists` probe is needed. Shared by the
 * export's stale-target cleanup and the import's final wipe so the sidecar
 * suffix list lives in exactly one place.
 */
export const deleteWithSidecars = async (basePath: string): Promise<void> => {
  await Promise.all([
    migrationBridge.deleteFile(basePath),
    ...DB_SIDECAR_SUFFIXES.map((suffix) => migrationBridge.deleteFile(`${basePath}${suffix}`)),
  ]);
};
