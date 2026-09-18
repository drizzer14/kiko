import { utf8ToBytes } from '@noble/ciphers/utils.js';
import * as RNFS from 'react-native-fs';

import pkg from '../../package.json';

import { encodeBytesToBase64 } from './base64/base64';
import { encryptEnvelope } from './crypto/envelope';
import { generateExportKey } from './crypto/generate-key';
import type { ExportPayload } from './payload';
import { readExportSecrets } from './secrets/read-secrets';
import { readDataSnapshot } from './snapshot/read-snapshot';

export type ExportResult = { fileUri: string; keyBase64: string };

const exportFileName = (): string => `kiko-export-${Date.now()}.kiko`;

/**
 * Builds a fresh AES-256-GCM-encrypted `.kiko` export of every logical table
 * and, when `includeSecrets` is true, the Monobank token / Binance
 * credentials of every connected account plus the display-only DB key (see
 * `readExportSecrets`). Writes the encrypted file to
 * `RNFS.TemporaryDirectoryPath` — a one-shot generate-then-share flow, the
 * caller hands the returned `fileUri` straight to `Share.share`, so nothing
 * needs to persist in the app's own Documents directory — and returns the
 * base64 key the user must save separately: the key is NEVER written into
 * the file.
 */
export const exportData = async (options: { includeSecrets: boolean }): Promise<ExportResult> => {
  const tables = await readDataSnapshot();
  const key = generateExportKey();

  const payload: ExportPayload = {
    exportedAt: Date.now(),
    appVersion: pkg.version,
    tables,
    secrets: options.includeSecrets ? await readExportSecrets(tables.accounts) : undefined,
  };

  const envelope = encryptEnvelope(utf8ToBytes(JSON.stringify(payload)), key);
  const fileUri = `${RNFS.TemporaryDirectoryPath}${exportFileName()}`;

  await RNFS.writeFile(fileUri, JSON.stringify(envelope), 'utf8');

  return { fileUri, keyBase64: encodeBytesToBase64(key) };
};
