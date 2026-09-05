import { open } from '@op-engineering/op-sqlite';
import * as Keychain from 'react-native-keychain';

/** Keychain service holding the SQLCipher key. Separate from the Monobank token's service. */
export const DB_KEY_SERVICE = 'kiko.db.key';

const KEY_USERNAME = 'kiko';
const KEY_BYTES = 32;
const HEX_CHARS_PER_BYTE = 2;

export const readDbKey = async (): Promise<string | undefined> => {
  const credentials = await Keychain.getGenericPassword({ service: DB_KEY_SERVICE });

  return credentials ? credentials.password : undefined;
};

/**
 * Same storage policy as the Monobank token: readable only while the device is
 * unlocked, never migrated to another device via backup restore. No
 * `accessControl` — the key is read silently at every launch before any UI.
 */
export const storeDbKey = async (keyHex: string): Promise<void> => {
  await Keychain.setGenericPassword(KEY_USERNAME, keyHex, {
    service: DB_KEY_SERVICE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
};

/**
 * 32 random bytes as 64 lowercase hex chars. Hermes ships no WebCrypto
 * (`crypto.getRandomValues` is undefined), so the entropy comes from SQLite's
 * `randomblob()` — a ChaCha20 stream seeded from the OS CSPRNG — drawn on a
 * throwaway in-memory connection so no file is touched. Never `Math.random`.
 */
export const generateDbKey = (): string => {
  const entropy = open({ name: 'kiko-key-entropy', location: ':memory:' });
  const result = entropy.executeSync('SELECT lower(hex(randomblob(?))) AS keyHex', [KEY_BYTES]);
  entropy.close();
  const keyHex = result.rows[0]?.keyHex;

  if (typeof keyHex !== 'string' || keyHex.length !== KEY_BYTES * HEX_CHARS_PER_BYTE) {
    throw new Error('Could not generate a database key');
  }

  return keyHex;
};

/**
 * SQLCipher's raw-key syntax. Skips the PBKDF2 passphrase derivation, which
 * adds nothing to an already-random 256-bit key and costs hundreds of
 * milliseconds on every open.
 */
export const toSQLCipherRawKey = (keyHex: string): string => "x'".concat(keyHex, "'");
