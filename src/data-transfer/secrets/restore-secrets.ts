import { settingsRepo } from '@kiko/settings';
import { logFailure } from '@kiko/diagnostics';
import either, { bifoldMap } from 'fnts/either';
import { saveToken } from '@kiko/monobank/token';
import { saveEodhdKey } from '@kiko/prices/eodhd-key';
import { withRestoredKey } from '@kiko/prices/quote-quota';
import { saveCredentials } from '@kiko/crypto-sync/binance';

import type { ExportSecrets } from '../payload';

/** The connection a secret belongs to, for telling the user which one to set up again. */
export type ExportSecretKind = 'monobank' | 'binance' | 'eodhd';

const onlyRestoredAccounts = <Entry extends { accountId: string }>(
  entries: readonly Entry[] | undefined,
  accountIds: ReadonlySet<string>,
): readonly Entry[] => (entries ?? []).filter(({ accountId }) => accountIds.has(accountId));

// A failed write is reported, not thrown: the data is already restored, so one
// secret that cannot be written must not hide that, nor stop the others. The
// thunk is `async` so a write that throws before it returns a promise is
// caught too.
const failedKinds = async (
  kind: ExportSecretKind,
  write: () => Promise<unknown>,
): Promise<readonly ExportSecretKind[]> => {
  const attempt = await either<unknown, unknown>(async () => write());

  return bifoldMap(
    attempt,
    (error): readonly ExportSecretKind[] => {
      logFailure(`[restore-secrets] ${kind} secret could not be written`, error);

      return [kind];
    },
    (): readonly ExportSecretKind[] => [],
  );
};

/**
 * Restores ONLY the Monobank tokens, the Binance credentials, and the global
 * EODHD key (each absent from a file that did not carry it) from an imported
 * archive, each account secret to the SAME account id it was exported under —
 * `import-data.ts` calls `restoreDataSnapshot` (which preserves original ids)
 * BEFORE this, so `serviceFor(accountId)` (`monobank/token.ts` /
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

  const failed: ExportSecretKind[] = [];

  for (const { accountId, token } of onlyRestoredAccounts(secrets.monobankTokens, accountIds)) {
    failed.push(...(await failedKinds('monobank', () => saveToken(accountId, token))));
  }

  for (const { accountId, apiKey, secret } of onlyRestoredAccounts(
    secrets.binanceCredentials,
    accountIds,
  )) {
    failed.push(
      ...(await failedKinds('binance', () => saveCredentials(accountId, { apiKey, secret }))),
    );
  }

  const { eodhdKey } = secrets;

  if (eodhdKey !== undefined) {
    failed.push(
      ...(await failedKinds('eodhd', async () => {
        await saveEodhdKey(eodhdKey);
        // After the key, like a key save in Share prices: a refresh that read
        // the previous key never pairs it with the restored key's state.
        await settingsRepo.updateQuoteQuota((stored) => withRestoredKey(stored, Date.now()));
      })),
    );
  }

  return [...new Set(failed)];
};
