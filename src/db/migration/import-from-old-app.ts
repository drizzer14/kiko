import { open } from '@op-engineering/op-sqlite';

import {
  type BinanceCredentials,
  saveCredentials,
} from '../../crypto-sync/binance/binance.credentials';
import { saveToken } from '../../monobank/token';
import { LIVE_PLAINTEXT_DATABASE_NAME } from '../encrypted-database';
import { readDbKey } from '../keys/db-key';

import { migrationBridge } from './migration-bridge';
import { EXPORT_DB_FILE, OLD_APP_GROUP_ID, SECRETS_FILE } from './migration-constants';
import { deleteWithSidecars } from './migration-files';

type MigrationSecrets = {
  monobankToken: string | null;
  binanceCredentials: BinanceCredentials | null;
};

const isCredentials = (value: unknown): value is BinanceCredentials =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { apiKey?: unknown }).apiKey === 'string' &&
  typeof (value as { secret?: unknown }).secret === 'string';

/**
 * Resolves the on-disk path `establishKey()` expects the live plaintext
 * `kiko.db` to occupy, WITHOUT leaving an empty file behind: open a throwaway
 * handle (op-sqlite creates the file), read its path, close and delete it —
 * the exact `kikoPath`/`close`/`delete` pattern in `migrateLegacyDatabase()`
 * (migrate-legacy-db.ts:53).
 */
const resolveLivePlaintextPath = (): string => {
  const probe = open({ name: LIVE_PLAINTEXT_DATABASE_NAME });
  const path = probe.getDbPath();
  probe.close();
  probe.delete();

  return path;
};

/**
 * Parses the secrets JSON defensively. Returns `undefined` for anything that is
 * not a JSON object — a corrupt/truncated file (e.g. a crash mid export-write),
 * or a literal `null`/scalar — so the caller degrades to the same no-op as an
 * absent file rather than letting `JSON.parse` throw. Never returns `null`, so
 * the caller can safely read its fields.
 */
const parseSecrets = (raw: string): Partial<MigrationSecrets> | undefined => {
  try {
    const parsed: unknown = JSON.parse(raw);

    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Partial<MigrationSecrets>)
      : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Restores the two carried secrets into the new Keychain. A `null` argument
 * (the native `readTextFile` returns `null` on BOTH a missing file AND a read
 * error — `try? ... ?? nil`) is a DELIBERATE no-op: the secrets file is
 * non-essential (the token + credentials can be re-entered in-app), so a
 * missing/unreadable secrets file must never block or fail the DB import. A file
 * that EXISTS but holds malformed/truncated JSON falls in the SAME bucket
 * (`parseSecrets` -> `undefined`): the DB import still completes, no secret is
 * restored, and nothing throws — an unguarded parse here would escape
 * `importFromOldApp` after `copyFile` already ran and brick every relaunch.
 * Each secret is restored only when present and well-typed.
 */
const restoreSecrets = async (raw: string | null): Promise<void> => {
  if (raw === null) {
    return;
  }

  const parsed = parseSecrets(raw);

  if (parsed === undefined) {
    return;
  }

  if (typeof parsed.monobankToken === 'string') {
    await saveToken(parsed.monobankToken);
  }

  if (isCredentials(parsed.binanceCredentials)) {
    await saveCredentials(parsed.binanceCredentials);
  }
};

/**
 * One-time import from the retired old app, run BEFORE `openConnection()` in
 * `client.ts`. Idempotent and re-entrant: a no-op once the new app has a DB key
 * (spec ordering rule). Returns `true` only when it actually imported this
 * launch, so the caller wipes the shared container only then.
 *
 * Crash-safety (spec "Error handling & ordering"): copy DB -> restore secrets;
 * the caller then lets `establishKey()` encrypt and wipes the container LAST. A
 * crash before the wipe re-imports next launch — the source in the shared
 * container is only read, never modified, so re-copy/re-restore are harmless.
 */
export const importFromOldApp = async (): Promise<boolean> => {
  if ((await readDbKey()) !== undefined) {
    return false;
  }

  const container = await migrationBridge.sharedContainerPath(OLD_APP_GROUP_ID);

  if (container === null) {
    return false;
  }

  const exportPath = `${container}/${EXPORT_DB_FILE}`;

  if (!(await migrationBridge.fileExists(exportPath))) {
    return false;
  }

  await migrationBridge.copyFile(exportPath, resolveLivePlaintextPath());
  await restoreSecrets(await migrationBridge.readTextFile(`${container}/${SECRETS_FILE}`));

  return true;
};

/**
 * Wipes the migration bridge files from the shared container. Best-effort and
 * NON-blocking: swallows every error so a failed wipe never blocks startup
 * (spec: "skipped-then-retried rather than blocking startup"). The caller runs
 * it after `initDatabase()` fully resolves, on EVERY launch — a launch where a
 * key already exists (so nothing imported) but residual bridge files remain
 * still clears them, which is the real retry for a wipe that failed on the
 * import launch. Deleting an already-absent file is a harmless no-op.
 */
export const finalizeImportBridge = async (): Promise<void> => {
  try {
    const container = await migrationBridge.sharedContainerPath(OLD_APP_GROUP_ID);

    if (container === null) {
      return;
    }

    // Delete the export DB with its -wal/-shm/-journal sidecars, not just the
    // main file — a lingering plaintext -wal would otherwise stay at rest in the
    // shared container until the Phase 5 cleanup build.
    await deleteWithSidecars(`${container}/${EXPORT_DB_FILE}`);
    await migrationBridge.deleteFile(`${container}/${SECRETS_FILE}`);
  } catch {
    // Non-fatal: the next launch retries the wipe (the caller invokes this on
    // every launch, not only the importing one), so a transient failure here is
    // cleared later. Never surfaces to startup.
  }
};
