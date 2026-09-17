import * as Keychain from 'react-native-keychain';

/**
 * The per-account Keychain service for a PrivatBank AutoClient token, keyed
 * by the stable `accounts.id` (a local uuid — NOT a secret, so embedding it
 * here leaks nothing). VERIFIED (task-6 brief): the AutoClient's auth is a
 * SINGLE `token` header — there is no separate client id — so this module
 * now mirrors Starling's single-string per-account token
 * (`src/starling/token/token.ts`), not Binance's two-field JSON blob it used
 * to copy. Like Starling, PrivatBank has no pre-multi-account era to migrate
 * from, so there is no transitional GLOBAL item here — every token is
 * per-account from the start.
 */
export const PRIVATBANK_CREDENTIALS_SERVICE = 'kiko.privatbank.credentials';

export const serviceFor = (accountId: string): string =>
  `${PRIVATBANK_CREDENTIALS_SERVICE}.${accountId}`;

/**
 * Storage-at-rest policy for the read-only PrivatBank token: readable only
 * while the device is unlocked, and bound to this device (never
 * iCloud-synced or restored onto another one from a backup). Deliberately NO
 * `accessControl` — a per-read biometric prompt would fire Face ID on every
 * background sync, matching Monobank's/Starling's own tokens.
 */
const hardenedFor = (service: string): Keychain.SetOptions => ({
  service,
  accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
});

/**
 * Persist the token to the PER-ACCOUNT Keychain item for `accountId`. Each
 * connected account owns its own item, so saving account A's token never
 * touches account B's. The token goes ONLY to the Keychain — never to
 * SQLite, `sync_state`, `settings`, `holdings.metadata`, or a log.
 */
export const saveCredentials = async (accountId: string, token: string): Promise<void> => {
  await Keychain.setGenericPassword('privatbank', token, hardenedFor(serviceFor(accountId)));
};

/**
 * Reads the token for ONE account. The per-account service string is derived
 * from the account id on every call, so a read for account A can never
 * return account B's token.
 */
export const readCredentials = async (accountId: string): Promise<string | undefined> => {
  const stored = await Keychain.getGenericPassword({ service: serviceFor(accountId) });

  return stored ? stored.password : undefined;
};

export const clearCredentials = async (accountId: string): Promise<void> => {
  await Keychain.resetGenericPassword({ service: serviceFor(accountId) });
};

/**
 * Whether a token is stored FOR `accountId`, WITHOUT handing the value
 * back — mirrors `hasToken` (`src/monobank/token/token.ts`,
 * `src/starling/token/token.ts`). `hasGenericPassword` queries the item's
 * attributes only, so a "connected" status check never decrypts the token
 * into the JS heap just to compare it against `false`.
 */
export const hasCredentials = async (accountId: string): Promise<boolean> =>
  Keychain.hasGenericPassword({ service: serviceFor(accountId) });
