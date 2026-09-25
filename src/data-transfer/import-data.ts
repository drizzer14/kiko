import * as RNFS from 'react-native-fs';
import { bifold, eitherSync, isLeft } from 'fnts/either';

import { refreshRates } from '../rates/rates-refresh';
import { refreshMetalPrices } from '../prices/metal-refresh';

import {
  decryptEnvelope,
  EXPORT_FORMAT,
  EXPORT_VERSION,
  type ExportEnvelope,
} from './crypto/envelope';
import { utf8Decode } from './utf8/utf8';
import type { ExportPayload } from './payload';
import { decodeBase64ToBytes } from './base64/base64';
import { restoreExportSecrets } from './secrets/restore-secrets';
import { restoreDataSnapshot } from './snapshot/restore-snapshot';

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

// Runs `action`, throwing `message` in its place instead of the original
// error on any failure — the same rethrow shape `decryptEnvelope`
// (`envelope.ts`) uses.
const attemptOrThrow = <Value>(action: () => Value, message: string): Value => {
  const attempt = eitherSync<unknown, Value>(action);

  if (isLeft(attempt)) {
    throw new Error(message);
  }

  return bifold(attempt);
};

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

  const envelope = attemptOrThrow<unknown>(() => JSON.parse(fileText), INVALID_FILE_MESSAGE);

  if (!isExportEnvelope(envelope)) {
    throw new Error(INVALID_FILE_MESSAGE);
  }

  const key = attemptOrThrow(
    () => decodeBase64ToBytes(options.keyBase64),
    'data-transfer/decrypt: wrong key or corrupted file',
  );

  const plaintext = decryptEnvelope(envelope, key);

  const payload = attemptOrThrow<unknown>(
    () => JSON.parse(utf8Decode(plaintext)),
    INVALID_FILE_MESSAGE,
  );

  if (!isExportPayload(payload)) {
    throw new Error(INVALID_FILE_MESSAGE);
  }

  await restoreDataSnapshot(payload.tables);
  await restoreExportSecrets(payload.secrets);

  // A restored foreign-currency/metal/crypto holding needs its price/rate
  // visible without an app restart — a bulk restore bypasses the sync
  // fan-out that normally triggers this, so trigger the SAME gated refresh
  // explicitly here. Both calls gate themselves on data presence
  // (kiko-architecture), so this is a no-op for a restore with neither.
  // `Promise.allSettled` never rejects, so a refresh failure here never
  // turns a successful import into a shown error.
  await Promise.allSettled([refreshRates(), refreshMetalPrices()]);

  return {
    accountsRestored: payload.tables.accounts.length,
    holdingsRestored: payload.tables.holdings.length,
    transactionsRestored: payload.tables.transactions.length,
    languageRestored: payload.tables.settings.at(0)?.language ?? null,
  };
};
