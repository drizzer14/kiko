import { bytesToUtf8 } from '@noble/ciphers/utils.js';
import * as RNFS from 'react-native-fs';

import { decodeBase64ToBytes } from './base64/base64';
import {
  decryptEnvelope,
  EXPORT_FORMAT,
  EXPORT_VERSION,
  type ExportEnvelope,
} from './crypto/envelope';
import type { ExportPayload } from './payload';
import { restoreExportSecrets } from './secrets/restore-secrets';
import { restoreDataSnapshot } from './snapshot/restore-snapshot';

export type ImportSummary = {
  accountsRestored: number;
  holdingsRestored: number;
  transactionsRestored: number;
};

const isExportEnvelope = (value: unknown): value is ExportEnvelope =>
  typeof value === 'object' &&
  value !== null &&
  (value as ExportEnvelope).format === EXPORT_FORMAT &&
  (value as ExportEnvelope).version === EXPORT_VERSION &&
  typeof (value as ExportEnvelope).nonce === 'string' &&
  typeof (value as ExportEnvelope).ciphertext === 'string';

const isExportPayload = (value: unknown): value is ExportPayload =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as ExportPayload).exportedAt === 'number' &&
  typeof (value as ExportPayload).tables === 'object' &&
  (value as ExportPayload).tables !== null;

const INVALID_FILE_MESSAGE = 'data-transfer/import: not a valid Kiko export file';

/**
 * Reads, decrypts, and restores a `.kiko` export. Every failure mode — an
 * unparseable file, a wrong/garbled key, a tampered ciphertext, or a valid
 * decrypt that yields the wrong payload shape — throws BEFORE
 * `restoreDataSnapshot` runs, so a bad import never partially overwrites the
 * live database. `restoreDataSnapshot` itself runs inside ONE `write()`
 * transaction, so even a mid-restore failure (not reachable today, since the
 * payload is fully validated first, but kept as defense in depth) rolls back
 * rather than leaving a half-replaced database.
 */
export const importData = async (options: {
  fileUri: string;
  keyBase64: string;
}): Promise<ImportSummary> => {
  const fileText = await RNFS.readFile(options.fileUri, 'utf8');

  let envelope: unknown;
  try {
    envelope = JSON.parse(fileText);
  } catch {
    throw new Error(INVALID_FILE_MESSAGE);
  }

  if (!isExportEnvelope(envelope)) {
    throw new Error(INVALID_FILE_MESSAGE);
  }

  const key = decodeBase64ToBytes(options.keyBase64);
  const plaintext = decryptEnvelope(envelope, key);

  let payload: unknown;
  try {
    payload = JSON.parse(bytesToUtf8(plaintext));
  } catch {
    throw new Error(INVALID_FILE_MESSAGE);
  }

  if (!isExportPayload(payload)) {
    throw new Error(INVALID_FILE_MESSAGE);
  }

  await restoreDataSnapshot(payload.tables);
  await restoreExportSecrets(payload.secrets);

  return {
    accountsRestored: payload.tables.accounts.length,
    holdingsRestored: payload.tables.holdings.length,
    transactionsRestored: payload.tables.transactions.length,
  };
};
