import type { ExportSecrets } from '../payload';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isEveryEntry = (
  value: unknown,
  fieldNames: readonly string[],
  accountIds: ReadonlySet<string>,
): boolean =>
  Array.isArray(value) &&
  value.every(
    (entry) =>
      isRecord(entry) &&
      fieldNames.every((fieldName) => typeof entry[fieldName] === 'string') &&
      accountIds.has(entry.accountId as string),
  );

/**
 * Whether a decrypted payload's `secrets` block has the shape
 * `restoreExportSecrets` reads, and names only accounts the file itself
 * restores. The block is written after the data commits, so a malformed one
 * has to be refused before it: it would throw past a restore that already
 * replaced the database, or write Keychain items for accounts that do not
 * exist. `eodhdKey` is the one optional field (an older file has none).
 */
export const isExportSecrets = (
  value: unknown,
  accountIds: ReadonlySet<string>,
): value is ExportSecrets =>
  isRecord(value) &&
  isEveryEntry(value.monobankTokens, ['accountId', 'token'], accountIds) &&
  isEveryEntry(value.binanceCredentials, ['accountId', 'apiKey', 'secret'], accountIds) &&
  (value.eodhdKey === undefined || typeof value.eodhdKey === 'string');
