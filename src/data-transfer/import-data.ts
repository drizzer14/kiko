import * as RNFS from 'react-native-fs';
import { logFailure } from '@kiko/diagnostics';
import { bifold, eitherSync, isLeft } from 'fnts/either';
import { confirmDailyLimit } from '@kiko/prices/daily-limit';
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
import { decodeBase64ToBytes } from './base64/base64';
import { isExportSecrets } from './secrets/is-export-secrets';
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
  'categoryOverrides',
] as const;

const restoredAccountIds = (accountRows: readonly { id?: unknown }[]): ReadonlySet<string> =>
  new Set(accountRows.flatMap(({ id }) => (typeof id === 'string' ? [id] : [])));

const isExportPayload = (value: unknown): value is ExportPayload => {
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof (value as ExportPayload).exportedAt !== 'number'
  ) {
    return false;
  }

  const { tables, secrets } = value as ExportPayload;

  if (typeof tables !== 'object' || tables === null) {
    return false;
  }

  return (
    REQUIRED_TABLE_KEYS.every((key) => Array.isArray((tables as Record<string, unknown>)[key])) &&
    (secrets === undefined || isExportSecrets(secrets, restoredAccountIds(tables.accounts)))
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

  const { accountsRestored } = await restoreDataSnapshot(payload.tables);
  // Right after the commit, ahead of the credentials step that can still fail
  // on a Keychain write: left to the screen, a failed step would skip the
  // re-plan, and the next one would read every reminder as ignored since the
  // backup and back-off pause them. Never rejects.
  await replanRestoredReminders();
  // A backup made before the one-time lot recost restores with its flag
  // unset, so its stale sale costs are fixed before any screen reads them.
  // Local and quick, and it never rejects.
  await recostStoredLots();
  await restoreExportSecrets(payload.secrets);

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
  // commits. A restored EODHD key's daily limit is unconfirmed, so the 0-call
  // limit check goes first: the refresh must not plan under the limit stored
  // before the restore.
  // biome-ignore lint/nursery/noFloatingPromises: OVERRIDE(total function) the catch handles a failed limit check and refreshMarketData never rejects
  confirmDailyLimit()
    .catch((error: unknown) => logFailure('[import-data] daily limit check failed', error))
    .then(() => refreshMarketData({ throttled: false, metals: true, shares: true }));
  // A bulk restore bypasses the sync/import/loan-edit call sites that
  // normally trigger the auto-link matcher — trigger it explicitly
  // here too. `runLoanAutoLink` never rejects and returns early with no
  // loan (its own doc comment), so this is a no-op for a restore with none;
  // fire-and-forget for the same "background nicety, not a precondition"
  // reason as `refreshMarketData` above.
  // biome-ignore lint/nursery/noFloatingPromises: OVERRIDE(total function) runLoanAutoLink never rejects; see the comment above
  runLoanAutoLink();

  return {
    accountsRestored,
    holdingsRestored: payload.tables.holdings.length,
    transactionsRestored: payload.tables.transactions.length,
    languageRestored: payload.tables.settings.at(0)?.language ?? null,
  };
};
