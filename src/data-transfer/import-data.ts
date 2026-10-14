import * as RNFS from 'react-native-fs';
import { isRecord } from '@kiko/type-guards';
import { bifold, eitherSync, isLeft } from 'fnts/either';
import { recostStoredLots } from '@kiko/holdings/lot-recost';
import { runLoanAutoLink } from '@kiko/loans/use-loan-auto-link';
import { refreshMarketData } from '@kiko/sync/refresh-market-data';
import { replanRestoredReminders } from '@kiko/reminders/use-reminder-scheduler';

import {
  decryptEnvelope,
  EXPORT_FORMAT,
  isReadableExportVersion,
  type ExportEnvelope,
} from './crypto/envelope';
import { utf8Decode } from './utf8/utf8';
import type { ExportPayload } from './payload';
import {
  type LegacyCategoryOverrideRow,
  withLegacyOverridesConverted,
} from './snapshot/with-legacy-overrides-converted';
import { decodeBase64ToBytes } from './base64/base64';
import type { DataSnapshot } from './snapshot/data-snapshot';
import { isExportSecrets } from './secrets/is-export-secrets';
import { restoreDataSnapshot } from './snapshot/restore-snapshot';
import { type ExportSecretKind, restoreExportSecrets } from './secrets/restore-secrets';

type ImportSummary = {
  accountsRestored: number;
  holdingsRestored: number;
  transactionsRestored: number;
  /**
   * The imported settings row's `language`, or `null` when the row carries
   * none (or there is no settings row at all). A plain string code, not the
   * app's `AppLanguage` type, so this summary does not depend on the i18n
   * catalogue's types. The caller
   * (`import-data.screen.tsx`) applies it via `i18n.changeLanguage` BEFORE
   * resolving the success alert's `t()` copy, so that alert renders in the
   * language the import just restored, not the pre-import one.
   */
  languageRestored: string | null;
  /**
   * The connections whose saved key or token the file carried but the Keychain
   * would not take. The data is restored either way, so this is not a failure:
   * the caller tells the user which connections to set up again.
   */
  unrestoredCredentials: readonly ExportSecretKind[];
};

const isExportEnvelope = (value: unknown): value is ExportEnvelope =>
  typeof value === 'object' &&
  value !== null &&
  (value as ExportEnvelope).format === EXPORT_FORMAT &&
  isReadableExportVersion((value as ExportEnvelope).version) &&
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
] as const;

// A file written before category rules (versions 1 and 2) carries the name rules as overrides, and
// has no rule table; a version 3 file carries rules and no overrides.
const FIRST_RULES_EXPORT_VERSION = 3;

type LegacyExportPayload = Omit<ExportPayload, 'tables'> & {
  tables: Omit<DataSnapshot, 'categoryRules'> & { categoryOverrides: LegacyCategoryOverrideRow[] };
};

const restoredAccountIds = (accountRows: readonly { id?: unknown }[]): ReadonlySet<string> =>
  new Set(accountRows.flatMap(({ id }) => (typeof id === 'string' ? [id] : [])));

// Only the shape of a rule is checked, never whether its matchers read back: the app itself stores
// a rule it cannot read (a migrated override with a blank name) and exports it, and a restore must
// take its own file back. A rule that does not read never matches and shows as unreadable.
const isStoredCategoryRule = (value: unknown): boolean =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  typeof value.category === 'string' &&
  typeof value.matchers === 'string' &&
  typeof value.createdAt === 'number' &&
  typeof value.updatedAt === 'number';

// An override row as an earlier build exported it: its timestamps may be missing, its text never.
const isLegacyCategoryOverride = (value: unknown): boolean =>
  isRecord(value) &&
  typeof value.category === 'string' &&
  typeof value.displayName === 'string' &&
  (value.createdAt === undefined || typeof value.createdAt === 'number') &&
  (value.updatedAt === undefined || typeof value.updatedAt === 'number');

const hasPayloadShape = (value: unknown, tableKeys: readonly string[]): boolean => {
  if (!isRecord(value) || typeof value.exportedAt !== 'number') {
    return false;
  }

  const { tables, secrets } = value;

  if (!isRecord(tables)) {
    return false;
  }

  return (
    tableKeys.every((key) => Array.isArray(tables[key])) &&
    (secrets === undefined || isExportSecrets(secrets))
  );
};

const isExportPayload = (value: unknown): value is ExportPayload =>
  hasPayloadShape(value, [...REQUIRED_TABLE_KEYS, 'categoryRules']) &&
  (value as ExportPayload).tables.categoryRules.every(isStoredCategoryRule);

const isLegacyExportPayload = (value: unknown): value is LegacyExportPayload =>
  hasPayloadShape(value, [...REQUIRED_TABLE_KEYS, 'categoryOverrides']) &&
  (value as LegacyExportPayload).tables.categoryOverrides.every(isLegacyCategoryOverride);

// The payload as this build restores it, or undefined when the file is not a valid export of its
// own version. An older file's overrides become rules before the restore, as the category-rules
// migration makes them; no rewrite runs, because the rows of the file already carry the
// categories they have.
const payloadToRestore = (value: unknown, version: number): ExportPayload | undefined => {
  if (version >= FIRST_RULES_EXPORT_VERSION) {
    return isExportPayload(value) ? value : undefined;
  }

  if (!isLegacyExportPayload(value)) {
    return undefined;
  }

  const { categoryOverrides, ...tables } = value.tables;

  return {
    ...value,
    tables: {
      ...tables,
      categoryRules: withLegacyOverridesConverted(categoryOverrides, Date.now()),
    },
  };
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

  const parsedPayload = attemptOrThrow<unknown>(
    () => JSON.parse(utf8Decode(plaintext)),
    INVALID_FILE_MESSAGE,
  );
  const payload = payloadToRestore(parsedPayload, envelope.version);

  if (payload === undefined) {
    throw new Error(INVALID_FILE_MESSAGE);
  }

  const { accountsRestored } = await restoreDataSnapshot(payload.tables);
  // Right after the commit, ahead of every later step: the re-plan drops the
  // replaced data's pending requests and snoozes, and a later step that threw
  // would leave them on the device to fire beside the restored reminders.
  // Never rejects.
  await replanRestoredReminders();
  // A backup made before the one-time lot recost restores with its flag
  // unset, so its stale sale costs are fixed before any screen reads them.
  // Local and quick, and it never rejects.
  await recostStoredLots();
  // Never rejects: a secret the Keychain refuses comes back as a connection to
  // set up again, so the steps below still run for data that is restored.
  const unrestoredCredentials = await restoreExportSecrets(
    payload.secrets,
    restoredAccountIds(payload.tables.accounts),
  );

  // A restored foreign-currency/metal/crypto holding needs its price/rate
  // visible without an app restart — a bulk restore bypasses the sync
  // fan-out that normally triggers this, so trigger the SAME gated refresh
  // explicitly here, unthrottled (a restore is a deliberate user action, not
  // a background poll). Both steps gate themselves on data presence
  // (kiko-architecture), so this is a no-op for a restore with neither.
  // `refreshMarketData` never rejects and logs its own failure, so it never
  // turns a successful import into a shown error. Fire-and-forget (not
  // awaited): the refresh is a background nicety, not an import
  // precondition — `importData` must resolve with its row-count summary
  // without sitting on the network; only fire the refresh after the write
  // commits.
  // biome-ignore lint/nursery/noFloatingPromises: OVERRIDE(total function) never rejects
  refreshMarketData({ throttled: false, metals: true });
  // A bulk restore bypasses the sync/import/loan-edit call sites that
  // normally trigger the auto-link matcher — trigger it explicitly
  // here too. `runLoanAutoLink` never rejects and returns early with no
  // loan (its own doc comment), so this is a no-op for a restore with none;
  // fire-and-forget for the same "background nicety, not a precondition"
  // reason as `refreshMarketData` above.
  // biome-ignore lint/nursery/noFloatingPromises: OVERRIDE(total function) never rejects
  runLoanAutoLink();

  return {
    accountsRestored,
    holdingsRestored: payload.tables.holdings.length,
    transactionsRestored: payload.tables.transactions.length,
    languageRestored: payload.tables.settings.at(0)?.language ?? null,
    unrestoredCredentials,
  };
};
