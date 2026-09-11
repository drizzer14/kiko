import {
  type BinanceCredentials,
  saveGlobalCredentials,
} from '@kiko/crypto-sync/binance/binance.credentials';
import { LIVE_PLAINTEXT_DATABASE_NAME } from '@kiko/db/encrypted-database';
import { resetDbKey } from '@kiko/db/keys/db-key';
import { saveGlobalToken } from '@kiko/monobank/token';
import { open } from '@op-engineering/op-sqlite';

import { migrationBridge } from '../migration-bridge';
import { EXPORT_DB_FILE, OLD_APP_GROUP_ID, SECRETS_FILE } from '../migration-constants';
import { deleteWithSidecars } from '../migration-files';

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
    // Restore the retired app's single token to the TRANSITIONAL GLOBAL item —
    // no account row exists yet at import time (the DB copy has not been opened),
    // so it cannot be keyed per account here. The boot migration
    // (`migrateSingleTokenToPerAccount`) binds it to the connected account once
    // the imported DB is live.
    await saveGlobalToken(parsed.monobankToken);
  }

  if (isCredentials(parsed.binanceCredentials)) {
    // Restore the retired app's single pair to the TRANSITIONAL GLOBAL item — no
    // account row exists yet at import time, so it cannot be keyed per account
    // here. The boot migration (`migrateBinanceCredentialToPerAccount`) binds it
    // to the connected account once the imported DB is live, mirroring the token.
    await saveGlobalCredentials(parsed.binanceCredentials);
  }
};

/**
 * One-time import from the retired old app, run BEFORE `openConnection()` in
 * `client.ts`. Returns `true` only when it actually imported this launch, so the
 * caller wipes the shared container only then.
 *
 * GATE — export-file presence, NOT DB-key presence. A migration is pending IFF
 * the plaintext export the old app wrote still exists in its shared App Group.
 * The absence of that file is the sole no-op path (a fresh install or an
 * already-consumed migration). Gating on the new DB key was the data-loss bug:
 * iOS keeps a bundle id's Keychain items across a container wipe/reinstall, so a
 * STALE `kiko.db.key` from an earlier run of this bundle made the gate no-op and
 * the app self-initialized an EMPTY encrypted DB, dropping the user's real data.
 *
 * SELF-HEAL of stale state: when an export IS pending we `resetDbKey()` first, so
 * a surviving stale key can no longer short-circuit `resolveDbKey()` — it now
 * mints a fresh key for the imported data via `establishKey()`. The stale EMPTY
 * `kiko-encrypted.db` an earlier no-op launch created is deleted by
 * `establishKey()` itself: the copied `kiko.db` has user tables, so its
 * stale-target cleanup (`encrypted-database.ts:108`) runs and rebuilds the
 * encrypted file from scratch. We therefore need not delete it here.
 *
 * Crash-safety (spec "Error handling & ordering"): reset stale key -> copy DB ->
 * restore secrets; the caller then lets `establishKey()` encrypt and wipes the
 * container LAST. A crash before the wipe re-imports next launch — the export in
 * the shared container is only read, never modified, and it is still present
 * (the wipe never ran), so re-copy/re-restore are harmless and idempotent.
 */
export const importFromOldApp = async (): Promise<boolean> => {
  const container = await migrationBridge.sharedContainerPath(OLD_APP_GROUP_ID);

  if (container === null) {
    return false;
  }

  const exportPath = `${container}/${EXPORT_DB_FILE}`;

  if (!(await migrationBridge.fileExists(exportPath))) {
    return false;
  }

  await resetDbKey();
  await migrationBridge.copyFile(exportPath, resolveLivePlaintextPath());
  await restoreSecrets(await migrationBridge.readTextFile(`${container}/${SECRETS_FILE}`));

  return true;
};

/**
 * Wipes the migration bridge files from the shared container. Best-effort and
 * NON-blocking: swallows every error so a failed wipe never blocks startup
 * (spec: "skipped-then-retried rather than blocking startup"). The caller runs
 * it after `initDatabase()` resolves, ONLY on a launch that actually imported —
 * never on a no-op launch, which would delete a still-pending export before it
 * is consumed. A wipe that fails here is retried the next launch: the export
 * survives, so `importFromOldApp()` re-imports and this runs again. Deleting an
 * already-absent file is a harmless no-op.
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
