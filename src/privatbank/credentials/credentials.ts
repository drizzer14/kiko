import { bifold, eitherSync, isRight } from 'fnts/either';
import * as Keychain from 'react-native-keychain';

/**
 * The per-account Keychain service for a PrivatBank AutoClient credential
 * pair, keyed by the stable `accounts.id` (a local uuid — NOT a secret, so
 * embedding it here leaks nothing). Mirrors `src/crypto-sync/binance/binance.credentials.ts`'s
 * two-field JSON blob shape, NOT Monobank's single-string token
 * (`src/monobank/token/token.ts`) — PrivatBank's AutoClient API needs BOTH a
 * token and a client id to authenticate. Unlike Binance/Monobank, PrivatBank
 * has no pre-multi-account era to migrate from, so there is no transitional
 * GLOBAL item here — every credential is per-account from the start.
 */
export const PRIVATBANK_CREDENTIALS_SERVICE = 'kiko.privatbank.credentials';

export const serviceFor = (accountId: string): string =>
  `${PRIVATBANK_CREDENTIALS_SERVICE}.${accountId}`;

export type PrivatbankCredentials = { token: string; clientId: string };

const isCredentials = (value: unknown): value is PrivatbankCredentials =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { token?: unknown }).token === 'string' &&
  typeof (value as { clientId?: unknown }).clientId === 'string';

/**
 * Storage-at-rest policy for the read-only PrivatBank credential pair:
 * readable only while the device is unlocked, and bound to this device
 * (never iCloud-synced or restored onto another one from a backup).
 * Deliberately NO `accessControl` — a per-read biometric prompt would fire
 * Face ID on every background sync, matching Monobank's token and Binance's
 * credential pair (both hardened the same way, for the same reason).
 */
const hardenedFor = (service: string): Keychain.SetOptions => ({
  service,
  accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
});

/**
 * Store the pair as ONE JSON Keychain item under the PER-ACCOUNT service for
 * `accountId`. Each connected account owns its own item, so saving account
 * A's pair never touches account B's. Both `token` and `clientId` go ONLY to
 * the Keychain — never to SQLite, `sync_state`, `settings`,
 * `holdings.metadata`, or a log.
 */
export const saveCredentials = async (
  accountId: string,
  credentials: PrivatbankCredentials,
): Promise<void> => {
  await Keychain.setGenericPassword(
    'privatbank',
    JSON.stringify(credentials),
    hardenedFor(serviceFor(accountId)),
  );
};

/**
 * Reads the pair for ONE account. The per-account service string is derived
 * from the account id on every call, so a read for account A can never
 * return account B's credentials. Resolves `undefined` when nothing valid is
 * stored (absent, corrupt JSON, or a mis-shaped value missing either field).
 */
export const readCredentials = async (
  accountId: string,
): Promise<PrivatbankCredentials | undefined> => {
  const stored = await Keychain.getGenericPassword({ service: serviceFor(accountId) });

  if (!stored) {
    return undefined;
  }

  const parsed = eitherSync<unknown, unknown>(() => JSON.parse(stored.password));
  const value = isRight(parsed) ? bifold(parsed) : undefined;

  return isCredentials(value) ? value : undefined;
};

export const clearCredentials = async (accountId: string): Promise<void> => {
  await Keychain.resetGenericPassword({ service: serviceFor(accountId) });
};

/**
 * Whether a credential pair is stored FOR `accountId`, WITHOUT handing the
 * value back — mirrors `hasToken` (`src/monobank/token/token.ts`).
 * `hasGenericPassword` queries the item's attributes only, so a "connected"
 * status check never decrypts the pair into the JS heap just to compare it
 * against `false`.
 */
export const hasCredentials = async (accountId: string): Promise<boolean> =>
  Keychain.hasGenericPassword({ service: serviceFor(accountId) });
