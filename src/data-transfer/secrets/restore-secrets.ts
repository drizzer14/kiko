import { logOnFailure } from '@kiko/diagnostics';
import { saveToken } from '@kiko/monobank/token';
import { saveCredentials } from '@kiko/crypto-sync/binance';

import type { ExportSecrets } from '../payload';

/** The connection a secret belongs to, for telling the user which one to set up again. */
export type ExportSecretKind = 'monobank' | 'binance';

const onlyRestoredAccounts = <Entry extends { accountId: string }>(
  entries: readonly Entry[] | undefined,
  accountIds: ReadonlySet<string>,
): readonly Entry[] => (entries ?? []).filter(({ accountId }) => accountIds.has(accountId));

/**
 * Restores ONLY the Monobank tokens and the Binance credentials (each absent
 * from a file that did not carry it) from an imported archive, each secret to
 * the SAME account id it was exported under —
 * `import-data.ts` calls `restoreDataSnapshot` (which preserves original ids)
 * BEFORE this, so `serviceFor(accountId)` (`src/monobank/token/token.ts` /
 * `binance.credentials.ts`) resolves to exactly the Keychain item the
 * freshly-restored account row expects, letting a restored connection resume
 * syncing immediately. A secret whose account `accountIds` does not hold is
 * dropped: it belongs to an account deleted before the export, and a Keychain
 * item with no account row would stay on the device with nothing to remove it.
 *
 * Never rejects. It resolves with the connections whose secret could not be
 * written (empty when all were), so the caller can tell the user which one to
 * set up again instead of reporting the whole import as failed.
 *
 * A legacy export file may still carry an `eodhdKey` field (the removed share
 * prices key); it is ignored and never written to the Keychain.
 *
 * A legacy export file may still carry a `dbKeyHex` field, and it is
 * deliberately never restored — `storeDbKey` is not even imported here. The
 * database key is device-local: THIS device's live encrypted database is
 * already open, keyed by ITS OWN `kiko.db.key` Keychain item, established at
 * first launch — BEFORE the Import screen is ever reachable
 * (`db/encrypted-database.ts`). Overwriting that item with a FOREIGN key
 * would not touch the already-open connection this session, but the very
 * NEXT launch's `resolveDbKey()` would then try to open THIS device's real
 * encrypted file with the WRONG key and fail outright — a self-inflicted,
 * unrecoverable lockout. Import restores data exclusively through the
 * repository/`write()` layer against the database the app already has
 * open; it must never re-key or replace that database file.
 */
export const restoreExportSecrets = async (
  secrets: ExportSecrets | undefined,
  accountIds: ReadonlySet<string>,
): Promise<readonly ExportSecretKind[]> => {
  if (secrets === undefined) {
    return [];
  }

  const failed = new Set<ExportSecretKind>();

  // A failed write is reported, not thrown: the data is already restored, so
  // one secret that cannot be written must not hide that, nor stop the others.
  const write = async (kind: ExportSecretKind, save: () => Promise<unknown>): Promise<void> => {
    if (!(await logOnFailure(`[restore-secrets] ${kind} secret could not be written`, save))) {
      failed.add(kind);
    }
  };

  for (const { accountId, token } of onlyRestoredAccounts(secrets.monobankTokens, accountIds)) {
    await write('monobank', () => saveToken(accountId, token));
  }

  for (const { accountId, apiKey, secret } of onlyRestoredAccounts(
    secrets.binanceCredentials,
    accountIds,
  )) {
    await write('binance', () => saveCredentials(accountId, { apiKey, secret }));
  }

  return [...failed];
};
