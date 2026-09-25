import type { ExportSecrets } from '../payload';
import { saveToken } from '../../monobank/token';
import { saveCredentials } from '../../crypto-sync/binance/binance.credentials';

/**
 * Restores ONLY the Monobank tokens and Binance credentials from an imported
 * archive, each to the SAME account id it was exported under — `import-data.ts`
 * calls `restoreDataSnapshot` (which preserves original ids) BEFORE this, so
 * `serviceFor(accountId)` (`monobank/token.ts` / `binance.credentials.ts`)
 * resolves to exactly the Keychain item the freshly-restored account row
 * expects, letting a restored connection resume syncing immediately.
 *
 * DELIBERATELY NEVER restores `secrets.dbKeyHex` — `storeDbKey` is not even
 * imported here. The exported DB key is a plaintext-DISPLAY value only (see
 * `payload.d.ts`): THIS device's live encrypted database is already open,
 * keyed by ITS OWN `kiko.db.key` Keychain item, established at first launch
 * — BEFORE the Import screen is ever reachable (`db/encrypted-database.ts`).
 * Overwriting that item with a FOREIGN key would not touch the already-open
 * connection this session, but the very NEXT launch's `resolveDbKey()`
 * would then try to open THIS device's real encrypted file with the WRONG
 * key and fail outright — a self-inflicted, unrecoverable lockout. Import
 * restores data exclusively through the repository/`write()` layer against
 * the database the app already has open; it must never re-key or replace
 * that database file.
 */
export const restoreExportSecrets = async (secrets: ExportSecrets | undefined): Promise<void> => {
  if (secrets === undefined) {
    return;
  }

  for (const { accountId, token } of secrets.monobankTokens) {
    await saveToken(accountId, token);
  }

  for (const { accountId, apiKey, secret } of secrets.binanceCredentials) {
    await saveCredentials(accountId, { apiKey, secret });
  }
};
