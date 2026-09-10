import { readCredentials } from '@kiko/crypto-sync/binance/binance.credentials';
import { ENCRYPTED_DATABASE_NAME } from '@kiko/db/encrypted-database';
import { readDbKey, toSQLCipherRawKey } from '@kiko/db/keys/db-key';
import { readToken } from '@kiko/monobank/token';
import { open } from '@op-engineering/op-sqlite';

import { migrationBridge } from './migration-bridge';
import { EXPORT_DB_FILE, OLD_APP_GROUP_ID, SECRETS_FILE } from './migration-constants';
import { deleteWithSidecars } from './migration-files';

const PLAINTEXT_ALIAS = 'plaintext_out';

/**
 * ONE-TIME, developer-triggered old-app export. Writes a DECRYPTED copy of the
 * live encrypted DB and a plaintext secrets JSON into the shared App Group
 * container for the new app to import. Never logs a secret or DB contents.
 *
 * Decrypt-direction mirror of `exportPlaintextInto` (encrypted-database.ts:75):
 * the main connection is the ENCRYPTED db (keyed from the Keychain); the ATTACH
 * target is opened with an EMPTY key (SQLCipher's plaintext-target convention),
 * so `sqlcipher_export` writes an unencrypted copy. This direction is unit-
 * tested here for its SQL sequence and proven on-device against a fixture
 * (`export-self-check.ts`) before it runs on real data.
 */
export const exportForNewApp = async (): Promise<void> => {
  const keyHex = await readDbKey();

  if (keyHex === undefined) {
    throw new Error('Export aborted: no database key in the Keychain to open the encrypted DB.');
  }

  const container = await migrationBridge.sharedContainerPath(OLD_APP_GROUP_ID);

  if (container === null) {
    throw new Error('Export aborted: shared container is unavailable for group.com.dmytro.pff.');
  }

  const exportPath = `${container}/${EXPORT_DB_FILE}`;

  // Clear any stale target from an aborted prior export — the main file AND its
  // -wal/-shm/-journal sidecars. A leftover journal/WAL could otherwise shadow
  // the freshly-created target before sqlcipher_export writes it.
  await deleteWithSidecars(exportPath);

  const encrypted = open({
    name: ENCRYPTED_DATABASE_NAME,
    encryptionKey: toSQLCipherRawKey(keyHex),
  });
  await encrypted.execute(`ATTACH DATABASE ? AS ${PLAINTEXT_ALIAS} KEY ?`, [exportPath, '']);
  await encrypted.execute(`SELECT sqlcipher_export('${PLAINTEXT_ALIAS}')`);
  await encrypted.execute(`DETACH DATABASE ${PLAINTEXT_ALIAS}`);
  encrypted.close();

  const secrets = {
    monobankToken: (await readToken()) ?? null,
    binanceCredentials: (await readCredentials()) ?? null,
  };
  await migrationBridge.writeTextFile(JSON.stringify(secrets), `${container}/${SECRETS_FILE}`);
};
