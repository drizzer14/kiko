import * as Keychain from 'react-native-keychain';

/**
 * The per-account Keychain service for a Starling Personal Access Token
 * (PAT), keyed by the stable `accounts.id` (a local uuid — NOT a secret, so
 * embedding it here leaks nothing). Mirrors Monobank's single-string token
 * shape (`src/monobank/token/token.ts`) — a Starling PAT is ONE bearer
 * token, unlike PrivatBank's/bunq's own credential pairs — but, like
 * PrivatBank, Starling has no pre-multi-account era to migrate from, so
 * there is no transitional GLOBAL item here and no legacy-service migration
 * — every token is per-account from the start.
 */
export const STARLING_TOKEN_SERVICE = 'kiko.starling.token';

export const serviceFor = (accountId: string): string => `${STARLING_TOKEN_SERVICE}.${accountId}`;

/**
 * Storage-at-rest policy for a Starling token item: readable only while the
 * device is unlocked, and bound to this device (never iCloud-synced or
 * restored onto another one from a backup). Deliberately NO `accessControl`
 * — a per-read biometric prompt would fire Face ID on every background
 * sync, matching Monobank's token and PrivatBank's/bunq's own credential
 * pairs (all hardened the same way, for the same reason).
 */
const hardenedFor = (service: string): Keychain.SetOptions => ({
  service,
  accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
});

/**
 * Persist a Starling PAT to the PER-ACCOUNT Keychain item for `accountId`.
 * Each connected account owns its own item, so saving account A's token
 * never touches account B's. The token goes ONLY to the Keychain — never to
 * SQLite, `sync_state`, `settings`, `holdings.metadata`, or a log.
 */
export const saveToken = async (accountId: string, token: string): Promise<void> => {
  await Keychain.setGenericPassword('starling', token, hardenedFor(serviceFor(accountId)));
};

/**
 * Read the token for ONE account. The per-account service string is derived
 * from the account id on every call, so a read for account A can never
 * return account B's secret.
 */
export const readToken = async (accountId: string): Promise<string | undefined> => {
  const credentials = await Keychain.getGenericPassword({ service: serviceFor(accountId) });
  return credentials ? credentials.password : undefined;
};

export const clearToken = async (accountId: string): Promise<void> => {
  await Keychain.resetGenericPassword({ service: serviceFor(accountId) });
};

/**
 * Whether a token is stored FOR `accountId`, WITHOUT handing the value
 * back — mirrors Monobank's `hasToken`. `hasGenericPassword` queries the
 * item's attributes only, so a "connected" status check never decrypts the
 * token into the JS heap just to compare it against `false`.
 */
export const hasToken = async (accountId: string): Promise<boolean> =>
  Keychain.hasGenericPassword({ service: serviceFor(accountId) });
