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
 * Restores the two carried secrets into the new Keychain. A `null` argument
 * (the native `readTextFile` returns `null` on BOTH a missing file AND a read
 * error — `try? ... ?? nil`) is a DELIBERATE no-op: the secrets file is
 * non-essential (the token + credentials can be re-entered in-app), so a
 * missing/unreadable secrets file must never block or fail the DB import.
 * Each secret is restored only when present and well-typed.
 */
const restoreSecrets = async (raw: string | null): Promise<void> => {
  if (raw === null) {
    return;
  }

  const parsed = JSON.parse(raw) as Partial<MigrationSecrets>;

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
 * (spec: "skipped-then-retried rather than blocking startup"). Runs only after
 * `initDatabase()` fully resolves, and only when this launch imported.
 */
export const finalizeImportBridge = async (): Promise<void> => {
  try {
    const container = await migrationBridge.sharedContainerPath(OLD_APP_GROUP_ID);

    if (container === null) {
      return;
    }

    await migrationBridge.deleteFile(`${container}/${EXPORT_DB_FILE}`);
    await migrationBridge.deleteFile(`${container}/${SECRETS_FILE}`);
  } catch {
    // Non-fatal: the next launch retries the wipe after the DB-copy guard has
    // already made the import a no-op. Never surfaces to startup.
  }
};
