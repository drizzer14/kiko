import { isRecord } from '@kiko/type-guards';

import type { ExportSecrets } from '../payload';

const isText = (value: unknown): value is string => typeof value === 'string';

const isEveryEntryWith =
  (fields: readonly string[]) =>
  (value: unknown): boolean =>
    Array.isArray(value) &&
    value.every(
      (entry) => isRecord(entry) && ['accountId', ...fields].every((field) => isText(entry[field])),
    );

const FIELD_CHECKS: Record<keyof ExportSecrets, (value: unknown) => boolean> = {
  monobankTokens: isEveryEntryWith(['token']),
  binanceCredentials: isEveryEntryWith(['apiKey', 'secret']),
  eodhdKey: isText,
};

/**
 * Whether a decrypted payload's `secrets` block is shaped the way
 * `restoreExportSecrets` reads it. A field a file lacks is not a fault (an
 * earlier build, or an export with no saved key, writes fewer of them); a field
 * it has, of the wrong shape, is, because the block is written after the data
 * commits and a malformed one would throw past a restore that already replaced
 * the database. Which accounts a secret may name is `restoreExportSecrets`'s
 * business: it drops one the file does not restore.
 */
export const isExportSecrets = (value: unknown): value is ExportSecrets =>
  isRecord(value) &&
  Object.entries(FIELD_CHECKS).every(
    ([field, check]) => value[field] === undefined || check(value[field]),
  );
