import * as RNFS from 'react-native-fs';

import {
  decryptEnvelope,
  EXPORT_FORMAT,
  EXPORT_VERSION,
  type ExportEnvelope,
} from './crypto/envelope';
import type { ExportPayload } from './payload';
import { decodeBase64ToBytes } from './base64/base64';
import { restoreExportSecrets } from './secrets/restore-secrets';
import { restoreDataSnapshot } from './snapshot/restore-snapshot';
import { utf8Decode } from './utf8/utf8';

// Not exported: nothing outside this file imports it yet (the Import Data
// screen, Task 13, currently consumes only `importData`'s inferred return
// type). Knip flags an exported type nothing imports as dead code.
type ImportSummary = {
  accountsRestored: number;
  holdingsRestored: number;
  transactionsRestored: number;
  /**
   * The imported settings row's `language`, or `null` when the row carries
   * none (or there is no settings row at all). A plain string code, not the
   * app's `AppLanguage` type — this layer must not import i18n. The caller
   * (`import-data.screen.tsx`) applies it via `i18n.changeLanguage` BEFORE
   * resolving the success alert's `t()` copy, so that alert renders in the
   * language the import just restored, not the pre-import one.
   */
  languageRestored: string | null;
};

const isExportEnvelope = (value: unknown): value is ExportEnvelope =>
  typeof value === 'object' &&
  value !== null &&
  (value as ExportEnvelope).format === EXPORT_FORMAT &&
  (value as ExportEnvelope).version === EXPORT_VERSION &&
  typeof (value as ExportEnvelope).nonce === 'string' &&
  typeof (value as ExportEnvelope).ciphertext === 'string';

const REQUIRED_TABLE_KEYS = [
  'accounts',
  'holdings',
  'transactions',
  'currencyRates',
  'currencyRateHistory',
  'settings',
  'syncState',
  'categories',
  'categoryOverrides',
] as const;

const isExportPayload = (value: unknown): value is ExportPayload => {
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof (value as ExportPayload).exportedAt !== 'number'
  ) {
    return false;
  }

  const tables = (value as ExportPayload).tables;

  if (typeof tables !== 'object' || tables === null) {
    return false;
  }

  return REQUIRED_TABLE_KEYS.every((key) =>
    Array.isArray((tables as Record<string, unknown>)[key]),
  );
};

const INVALID_FILE_MESSAGE = 'data-transfer/import: not a valid Kiko export file';

const FILE_URI_SCHEME = 'file://';

// The document picker's `pick`/`keepLocalCopy` hand back a percent-encoded
// `file://…` URI, but `RNFS.readFile` wants a plain filesystem path — handed
// the URI literally, it treats it as a nonexistent path and throws, which
// surfaces as this screen's generic "not a valid Kiko export file" alert on
// EVERY import, including the user's own freshly-exported file.
// `export-data.ts` writes with a scheme-less path already (see `joinPath`
// there), so only this read side needs the strip. `decodeURIComponent` can
// throw on a malformed escape sequence — guarded, falling back to the
// un-decoded (but still scheme-stripped) path rather than crashing the read.
const toFilePath = (uri: string): string => {
  if (!uri.startsWith(FILE_URI_SCHEME)) {
    return uri;
  }

  const stripped = uri.slice(FILE_URI_SCHEME.length);

  try {
    return decodeURIComponent(stripped);
  } catch {
    return stripped;
  }
};

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
  const fileText = await RNFS.readFile(toFilePath(options.fileUri), 'utf8');

  let envelope: unknown;
  try {
    envelope = JSON.parse(fileText);
  } catch {
    throw new Error(INVALID_FILE_MESSAGE);
  }

  if (!isExportEnvelope(envelope)) {
    throw new Error(INVALID_FILE_MESSAGE);
  }

  let key: Uint8Array;
  try {
    key = decodeBase64ToBytes(options.keyBase64);
  } catch {
    throw new Error('data-transfer/decrypt: wrong key or corrupted file');
  }

  const plaintext = decryptEnvelope(envelope, key);

  let payload: unknown;
  try {
    payload = JSON.parse(utf8Decode(plaintext));
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
    languageRestored: payload.tables.settings.at(0)?.language ?? null,
  };
};
