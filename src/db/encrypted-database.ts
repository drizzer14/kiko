import * as RNFS from 'react-native-fs';
import { migrateLegacyDatabase } from '@kiko/migration/migrate-legacy-db';
import { type Either, bifold, bifoldr, eitherSync, isLeft } from 'fnts/either';
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

/**
 * Whether the named file is on disk with user tables. `whenUnreadable` is the answer for a file
 * whose table count cannot be read: the refusing guard wants no, so it refuses; the keyed path
 * wants yes, so an unreadable kiko.db is never deleted as if it were empty.
 */
const databaseHasUserTables = (name: string, whenUnreadable: boolean): boolean => {
  const existing = openExisting(name);

  if (existing === undefined) {
    return false;
  }

  const counted = eitherSync<unknown, number>(() => userTableCount(existing));
  existing.close();

  if (isLeft(counted)) {
    return whenUnreadable;
  }

  const tables: number = bifold(counted);

  return tables > 0;
};

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/**
 * Reads the user table count of the existing encrypted file with the key (a wrong key fails on the
 * first read). `failOnCreate` keeps the read from creating an empty keyed file where none exists,
 * which would pass and let the plaintext be deleted.
 */
const readEncryptedTableCount = (keyHex: string): Either<unknown, number> =>
  eitherSync<unknown, number>(() => {
    const probe = open({
      name: ENCRYPTED_DATABASE_NAME,
      encryptionKey: toSQLCipherRawKey(keyHex),
      failOnCreate: true,
    });

    try {
      return userTableCount(probe);
    } finally {
      probe.close();
    }
  });

/**
 * Throws `message` plus the cause's own message, since the launch gate shows only
 * `error.message`; the cause stays attached.
 */
const failWithCause = (message: string, cause: unknown): never => {
  throw new Error(`${message}: ${messageOf(cause)}`, { cause });
};

/**
 * Proves the stored key opens the existing encrypted file before anything irreversible happens, so
 * a key that does not match keeps the plaintext residue.
 */
const assertKeyOpensEncryptedFile = (keyHex: string): void => {
  const proof = readEncryptedTableCount(keyHex);

  if (isLeft(proof)) {
    failWithCause('The stored database key does not open the encrypted database', bifold(proof));
  }
};

/** Deletes a plaintext DB file if it is on disk. No-op when absent. */
const deletePlaintextFile = (name: string): void => {
  openExisting(name)?.delete();
};

/**
 * Removes every plaintext residue. The encrypted DB is the only source of truth. pff.db goes
 * first: it is the older copy, so a kill between the two deletes leaves the newer kiko.db, which a
 * later launch can still rebuild from. op-sqlite's remove ignores failures, and a surviving
 * kiko.db would make that rebuild delete an encrypted database already in use, so a file still on
 * disk stops the launch before the encrypted database is opened.
 */
const removeLeftoverPlaintext = async (): Promise<void> => {
  for (const name of [LEGACY_PLAINTEXT_DATABASE_NAME, LIVE_PLAINTEXT_DATABASE_NAME]) {
    deletePlaintextFile(name);

    if (await RNFS.exists(`${IOS_LIBRARY_PATH}/${name}`)) {
      throw new Error(`The plaintext database ${name} could not be removed`);
    }
  }
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

/** An export that left a keyed file unreadable or without tables did not copy the data. */
const assertExportHoldsTables = (keyHex: string): void => {
  const copied = readEncryptedTableCount(keyHex);

  if (isLeft(copied)) {
    failWithCause('The encrypted copy could not be read back', bifold(copied));
  }

  if (bifoldr(copied) === 0) {
    throw new Error('The encrypted copy holds no tables; the plaintext database was kept');
  }
};

/** A key that already sits in the Keychain is never stored again. */
const persistNewKey = async (keyHex: string, storedKey: string | undefined): Promise<void> => {
  if (storedKey === undefined) {
    await storeDbKey(keyHex);
  }
};

/**
 * Exports the plaintext into a keyed encrypted file, or creates a fresh one when there is nothing
 * to export. `migrateLegacyDatabase()` canonicalizes any surviving pre-rename `pff.db` into
 * `kiko.db` (idempotent) and returns the live plaintext connection. Ordering below is the
 * crash-safety contract:
 *   1. export the plaintext into a fresh encrypted copy,
 *   2. verify the key opens the copy and it holds tables,
 *   3. only then persist a NEW key (a crash before this leaves plaintext + no
 *      key, so the next launch redoes the export from scratch),
 *   4. only then delete the plaintext files (a crash before this leaves stale
 *      plaintext, scrubbed by `removeLeftoverPlaintext` next launch).
 *
 * `storedKey` is the Keychain key when it survived while the encrypted file did not (for example
 * an old backup restored over the app): the plaintext is then exported under that same key, and
 * is deleted only after the copy is verified.
 */
const buildEncryptedDatabase = async (storedKey: string | undefined): Promise<string> => {
  const plaintext = migrateLegacyDatabase();
  const keyHex = storedKey ?? generateDbKey();

  if (userTableCount(plaintext) === 0) {
    plaintext.close();
    await persistNewKey(keyHex, storedKey);
    await removeLeftoverPlaintext();

    return keyHex;
  }

  // An encrypted file is present here only beside a populated kiko.db. kiko.db is
  // deleted only after the copy is verified (and, for a new key, stored), and the
  // app opens the encrypted file only after that, so such a file never served the
  // app: it is a partial, empty, or keyless target of an interrupted export, which
  // kiko.db still fully backs. A stored key does
  // not make it trustworthy either: a kill after ATTACH leaves an empty file that
  // key opens. It would also make the export fail on duplicate tables, so start
  // from a clean file.
  openExisting(ENCRYPTED_DATABASE_NAME)?.delete();
  await exportPlaintextInto(plaintext, encryptedPathBeside(plaintext), toSQLCipherRawKey(keyHex));
  assertExportHoldsTables(keyHex);
  await persistNewKey(keyHex, storedKey);
  plaintext.close();
  await removeLeftoverPlaintext();

  return keyHex;
};

/**
 * First launch with no key. A key is generated only once it is known to be usable. An encrypted
 * file on disk with no populated kiko.db beside it was written under a key the Keychain does not
 * return, and a new key would never open it, so launch stops before `migrateLegacyDatabase()`
 * runs: that call would rebuild a populated kiko.db from a surviving pff.db and hide the missing
 * key.
 */
const establishKey = async (): Promise<string> => {
  if (
    (await encryptedDatabaseExists()) &&
    !databaseHasUserTables(LIVE_PLAINTEXT_DATABASE_NAME, false)
  ) {
    throw new DatabaseKeyMissingError();
  }

  return buildEncryptedDatabase(undefined);
};

const resolveDbKey = async (): Promise<string> => {
  const existingKey = await readDbKey();

  if (existingKey === undefined) {
    return establishKey();
  }

  // Only kiko.db shows the encrypted file is untrusted: the export's ATTACH runs once kiko.db is
  // populated and kiko.db is deleted only after the copy is verified. A pff.db beside a present
  // encrypted file now comes only from the OLD delete order (kiko.db first) or a pff.db delete
  // that throws.
  if (
    !(await encryptedDatabaseExists()) ||
    databaseHasUserTables(LIVE_PLAINTEXT_DATABASE_NAME, true)
  ) {
    return buildEncryptedDatabase(existingKey);
  }

  assertKeyOpensEncryptedFile(existingKey);
  await removeLeftoverPlaintext();

  return existingKey;
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
