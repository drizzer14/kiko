import * as RNFS from 'react-native-fs';

import pkg from '../../package.json';

import { utf8Encode } from './utf8/utf8';
import type { ExportPayload } from './payload';
import { encryptEnvelope } from './crypto/envelope';
import { encodeBytesToBase64 } from './base64/base64';
import { generateExportKey } from './crypto/generate-key';
import { readExportSecrets } from './secrets/read-secrets';
import { readDataSnapshot } from './snapshot/read-snapshot';

// Not exported: nothing outside this file imports it yet (the Export Data
// screen consumes only `exportData`'s inferred return type). Knip flags an
// exported type nothing imports as dead code.
type ExportResult = { fileUri: string; keyBase64: string };

const exportFileName = (): string => `kiko-export-${Date.now()}.kiko`;

// `RNFS.TemporaryDirectoryPath` is a native constant (`NSTemporaryDirectory()`
// on iOS) whose trailing-slash presence has drifted across OS/library
// versions — a bare concatenation silently produces a malformed path (e.g.
// `/tmp` + `kiko-export-….kiko` with no separator) that `writeFile` then
// fails on, with the failure surfacing only as the generic export error
// Alert. This joins the two unconditionally correctly regardless of whether
// the directory constant already ends in `/`.
const joinPath = (directory: string, fileName: string): string =>
  `${directory}${directory.endsWith('/') ? '' : '/'}${fileName}`;

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

  const envelope = encryptEnvelope(utf8Encode(JSON.stringify(payload)), key);
  const fileUri = joinPath(RNFS.TemporaryDirectoryPath, exportFileName());

  await RNFS.writeFile(fileUri, JSON.stringify(envelope), 'utf8');

  return { fileUri, keyBase64: encodeBytesToBase64(key) };
};
