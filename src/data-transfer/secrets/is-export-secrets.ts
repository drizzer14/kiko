import type { ExportSecrets } from '../payload';

type Entry = Record<string, unknown>;

const isRecord = (value: unknown): value is Entry => typeof value === 'object' && value !== null;

const isText = (value: unknown): boolean => typeof value === 'string';

const isMonobankToken = (entry: Entry): boolean => isText(entry.token);

const isBinanceCredentials = (entry: Entry): boolean =>
  isText(entry.apiKey) && isText(entry.secret);

const isEveryEntry = (
  value: unknown,
  isEntry: (entry: Entry) => boolean,
  accountIds: ReadonlySet<string>,
): boolean =>
  Array.isArray(value) &&
  value.every(
    (entry) =>
      isRecord(entry) &&
      isText(entry.accountId) &&
      accountIds.has(entry.accountId as string) &&
      isEntry(entry),
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
  isEveryEntry(value.monobankTokens, isMonobankToken, accountIds) &&
  isEveryEntry(value.binanceCredentials, isBinanceCredentials, accountIds) &&
  (value.eodhdKey === undefined || isText(value.eodhdKey));
