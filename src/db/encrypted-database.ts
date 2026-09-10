import { migrateLegacyDatabase } from '@kiko/migration/migrate-legacy-db';
import { type DB, isSQLCipher, open } from '@op-engineering/op-sqlite';
import { bifold, eitherSync, isLeft } from 'fnts/either';

import { generateDbKey, readDbKey, storeDbKey, toSQLCipherRawKey } from './keys/db-key';

/**
 * The live plaintext database. The pff->kiko rename already migrated every
 * device's data into this file (`migrate-legacy-db.ts`, VACUUM INTO), so it is
 * the encryption migration's source of truth.
 */
export const LIVE_PLAINTEXT_DATABASE_NAME = 'kiko.db';

/**
 * Pre-rename plaintext backup, left on disk by the rename migration. Deleted
 * here once the encrypted copy exists — a plaintext balances file must not
 * survive on disk after encryption ships.
 */
export const LEGACY_PLAINTEXT_DATABASE_NAME = 'pff.db';

/**
 * The SQLCipher-encrypted database. A different file name because op-sqlite
 * exposes no rename: the one-time export below writes here, then deletes the
 * plaintext files. Mirrored by name in `ios/Kiko/AppDelegate.swift`
 * (`excludeDatabaseFilesFromBackup`) — keep the two in sync.
 */
export const ENCRYPTED_DATABASE_NAME = 'kiko-encrypted.db';

const ATTACHED_ALIAS = 'encrypted';

const USER_TABLE_COUNT_SQL =
  "SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'";

const userTableCount = (db: DB): number =>
  Number(db.executeSync(USER_TABLE_COUNT_SQL).rows[0]?.n ?? 0);

/** Opens an existing file only; `undefined` when it does not exist (nothing is created). */
const openExisting = (name: string): DB | undefined => {
  const attempt = eitherSync<unknown, DB>(() => open({ name, failOnCreate: true }));

  if (isLeft(attempt)) {
    return undefined;
  }

  return bifold(attempt);
};

/** Deletes a plaintext DB file if it is on disk. No-op when absent. */
const deletePlaintextFile = (name: string): void => {
  openExisting(name)?.delete();
};

/** Removes every plaintext residue. The encrypted DB is the only source of truth. */
const removeLeftoverPlaintext = (): void => {
  deletePlaintextFile(LIVE_PLAINTEXT_DATABASE_NAME);
  deletePlaintextFile(LEGACY_PLAINTEXT_DATABASE_NAME);
};

const assertSQLCipherBuild = (): void => {
  if (!isSQLCipher()) {
    throw new Error(
      'op-sqlite was built without SQLCipher. Set "op-sqlite": { "sqlcipher": true } in package.json and re-run pod install.',
    );
  }
};

const encryptedPathBeside = (plaintext: DB): string =>
  plaintext.getDbPath().replace(/[^/]+$/, ENCRYPTED_DATABASE_NAME);

/**
 * SQLCipher's documented plaintext -> encrypted conversion: attach the target
 * with a key, export every table into it, detach. Runs on the plaintext
 * connection; the target file is created by ATTACH.
 */
const exportPlaintextInto = async (
  plaintext: DB,
  encryptedPath: string,
  rawKey: string,
): Promise<void> => {
  await plaintext.execute(`ATTACH DATABASE ? AS ${ATTACHED_ALIAS} KEY ?`, [encryptedPath, rawKey]);
  await plaintext.execute(`SELECT sqlcipher_export('${ATTACHED_ALIAS}')`);
  await plaintext.execute(`DETACH DATABASE ${ATTACHED_ALIAS}`);
};

/**
 * First launch with no key. `migrateLegacyDatabase()` canonicalizes any
 * surviving pre-rename `pff.db` into `kiko.db` (idempotent) and returns the
 * live plaintext connection. Ordering below is the crash-safety contract:
 *   1. export the plaintext into a fresh encrypted copy,
 *   2. only then persist the key (a crash before this leaves plaintext + no
 *      key, so the next launch redoes the export from scratch),
 *   3. only then delete the plaintext files (a crash before this leaves stale
 *      plaintext, scrubbed by `removeLeftoverPlaintext` next launch).
 */
const establishKey = async (keyHex: string): Promise<void> => {
  const plaintext = migrateLegacyDatabase();

  if (userTableCount(plaintext) === 0) {
    plaintext.close();
    await storeDbKey(keyHex);
    removeLeftoverPlaintext();

    return;
  }

  // A partial target from an interrupted earlier attempt would make the export
  // fail on duplicate tables — start from a clean file.
  openExisting(ENCRYPTED_DATABASE_NAME)?.delete();
  await exportPlaintextInto(plaintext, encryptedPathBeside(plaintext), toSQLCipherRawKey(keyHex));
  await storeDbKey(keyHex);
  plaintext.close();
  removeLeftoverPlaintext();
};

const resolveDbKey = async (): Promise<string> => {
  const existingKey = await readDbKey();

  if (existingKey !== undefined) {
    removeLeftoverPlaintext();

    return existingKey;
  }

  const keyHex = generateDbKey();
  await establishKey(keyHex);

  return keyHex;
};

/**
 * Opens the app database encrypted with SQLCipher, keyed from the Keychain,
 * running the one-time plaintext migration when needed. Called once per
 * process by `initDatabase()` in `client.ts`, before any schema migration.
 */
export const openEncryptedDatabase = async (): Promise<DB> => {
  assertSQLCipherBuild();
  const keyHex = await resolveDbKey();

  return open({ name: ENCRYPTED_DATABASE_NAME, encryptionKey: toSQLCipherRawKey(keyHex) });
};
