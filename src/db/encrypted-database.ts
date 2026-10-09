import * as RNFS from 'react-native-fs';
import { bifold, eitherSync, isLeft, isRight } from 'fnts/either';
import { migrateLegacyDatabase } from '@kiko/migration/migrate-legacy-db';
import { type DB, IOS_LIBRARY_PATH, isSQLCipher, open } from '@op-engineering/op-sqlite';

import { DatabaseKeyMissingError } from './database-key-missing-error';
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

/**
 * Whether the encrypted file is on disk. A failed open cannot tell an absent file from one that
 * exists but cannot be opened (SQLite reports both as "unable to open database file"), so a path
 * check comes first and either signal alone counts as "exists". The path is op-sqlite's own base
 * directory, which is the Library folder while no app group is configured. Residual risk: if that
 * base ever moves, only the keyless open remains, and an unexplained open failure on a present
 * file would read as absent.
 */
const encryptedDatabaseExists = async (): Promise<boolean> => {
  if (await RNFS.exists(`${IOS_LIBRARY_PATH}/${ENCRYPTED_DATABASE_NAME}`)) {
    return true;
  }

  const existing = openExisting(ENCRYPTED_DATABASE_NAME);
  existing?.close();

  return existing !== undefined;
};

/** Whether kiko.db is on disk with user tables. Unreadable counts as no, so callers refuse. */
const liveDatabaseHasUserTables = (): boolean => {
  const live = openExisting(LIVE_PLAINTEXT_DATABASE_NAME);

  if (live === undefined) {
    return false;
  }

  const counted = eitherSync<unknown, number>(() => userTableCount(live));
  live.close();

  return isRight(counted) && bifold(counted) > 0;
};

/**
 * Proves the Keychain key opens the encrypted file (a wrong key fails on the first read) before
 * anything irreversible happens, so a key that does not match keeps the plaintext residue.
 */
const assertKeyOpensEncryptedFile = (keyHex: string): void => {
  const probe = open({ name: ENCRYPTED_DATABASE_NAME, encryptionKey: toSQLCipherRawKey(keyHex) });
  const proof = eitherSync<unknown, number>(() => userTableCount(probe));
  probe.close();

  if (isLeft(proof)) {
    throw new Error('The stored database key does not open the encrypted database', {
      cause: bifold(proof),
    });
  }
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
 *
 * A key is generated only once it is known to be usable. An encrypted file on
 * disk with no populated kiko.db beside it was written under a key the Keychain
 * does not return, and a new key would never open it, so launch stops before
 * `migrateLegacyDatabase()` runs: that call would rebuild a populated kiko.db
 * from a surviving pff.db and hide the missing key.
 */
const establishKey = async (): Promise<string> => {
  if ((await encryptedDatabaseExists()) && !liveDatabaseHasUserTables()) {
    throw new DatabaseKeyMissingError();
  }

  const plaintext = migrateLegacyDatabase();

  if (userTableCount(plaintext) === 0) {
    plaintext.close();
    const freshKeyHex = generateDbKey();
    await storeDbKey(freshKeyHex);
    removeLeftoverPlaintext();

    return freshKeyHex;
  }

  const keyHex = generateDbKey();

  // Reached with an encrypted file present only when kiko.db is populated. kiko.db
  // is deleted only after the key is stored, so a populated kiko.db with no key
  // means the file beside it was never keyed for good: a partial or keyless target
  // of an interrupted export, which kiko.db still fully backs. It would also make
  // the export fail on duplicate tables, so start from a clean file.
  openExisting(ENCRYPTED_DATABASE_NAME)?.delete();
  await exportPlaintextInto(plaintext, encryptedPathBeside(plaintext), toSQLCipherRawKey(keyHex));
  await storeDbKey(keyHex);
  plaintext.close();
  removeLeftoverPlaintext();

  return keyHex;
};

const resolveDbKey = async (): Promise<string> => {
  const existingKey = await readDbKey();

  if (existingKey !== undefined) {
    assertKeyOpensEncryptedFile(existingKey);
    removeLeftoverPlaintext();

    return existingKey;
  }

  return establishKey();
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
