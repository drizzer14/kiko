import { isRecord } from '@kiko/type-guards';

import type { ExportSecrets } from '../payload';

const isText = (value: unknown): value is string => typeof value === 'string';

// The fields are read by property, never named as quoted literals: the plist
// check (`scripts/checks/plist.sh`) reads a quoted credential name as a client
// that sends one, and demands an endpoint for it.
const isEveryEntry =
  (isEntry: (entry: Record<string, unknown>) => boolean) =>
  (value: unknown): boolean =>
    Array.isArray(value) &&
    value.every((entry) => isRecord(entry) && isText(entry.accountId) && isEntry(entry));

const FIELD_CHECKS: Record<keyof ExportSecrets, (value: unknown) => boolean> = {
  monobankTokens: isEveryEntry((entry) => isText(entry.token)),
  binanceCredentials: isEveryEntry((entry) => isText(entry.apiKey) && isText(entry.secret)),
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
