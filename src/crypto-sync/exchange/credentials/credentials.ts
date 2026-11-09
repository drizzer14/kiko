import * as Keychain from 'react-native-keychain';
import { bifoldr, eitherSync } from 'fnts/either';

export type ExchangeCredentials = { apiKey: string; secret: string };

/**
 * What names one exchange's Keychain items: the service every account's item is suffixed onto, and
 * the username the item is stored under.
 */
export type ExchangeKeychain = { service: string; username: string };

/**
 * The per-account Keychain service of an exchange's key pair, keyed by the stable `accounts.id`
 * (a local uuid, NOT a secret, so embedding it here leaks nothing). Each connected account holds
 * its own isolated item, so a read or clear for account A can never touch account B's pair.
 */
export const credentialServiceFor = (keychain: ExchangeKeychain, accountId: string): string =>
  `${keychain.service}.${accountId}`;

const isCredentials = (value: unknown): value is ExchangeCredentials =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { apiKey?: unknown }).apiKey === 'string' &&
  typeof (value as { secret?: unknown }).secret === 'string';

/**
 * Storage-at-rest policy for a read-only exchange key pair: readable only while the device is
 * unlocked, and bound to this device (never iCloud-synced or restored onto another one from a
 * backup). Deliberately NO `accessControl`: an item carrying `BIOMETRY_CURRENT_SET` forces a Face
 * ID / Touch ID prompt on EVERY read, so a pull-to-refresh sync would prompt the user each time.
 * The app-wide biometric gate is `LockGate` (`src/auth`). The pair is never written to SQLite,
 * holding metadata, or a log. Only the `service` differs between items; the hardening is derived
 * here from ONE place and reused verbatim by every writer. These helpers take no per-account lock,
 * so a caller must serialize its own writes and clears (Binance does, with its write tokens, in
 * `src/crypto-sync/binance/binance.credentials.ts`, and Bybit with `createWriteSerial`, in
 * `src/crypto-sync/bybit/bybit.credentials.ts`); never call `saveExchangeCredentials` or
 * `clearExchangeCredentials` directly from elsewhere.
 */
export const hardenedFor = (service: string): Keychain.SetOptions => ({
  service,
  accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
});

/**
 * Store the pair as ONE JSON Keychain item under the per-account service, hardened per above. The
 * pair goes ONLY to the Keychain, never to SQLite, `sync_state`, `settings`,
 * `holdings.metadata`, or a log.
 */
export const saveExchangeCredentials = async (
  keychain: ExchangeKeychain,
  accountId: string,
  credentials: ExchangeCredentials,
): Promise<void> => {
  await Keychain.setGenericPassword(
    keychain.username,
    JSON.stringify(credentials),
    hardenedFor(credentialServiceFor(keychain, accountId)),
  );
};

/**
 * Reads the pair of ONE account. The service is derived from the account id on every call, so a
 * read for account A can never return account B's pair. Resolves `undefined` when nothing valid is
 * stored.
 */
export const loadExchangeCredentials = async (
  keychain: ExchangeKeychain,
  accountId: string,
): Promise<ExchangeCredentials | undefined> => {
  const stored = await Keychain.getGenericPassword({
    service: credentialServiceFor(keychain, accountId),
  });

  if (!stored) {
    return undefined;
  }

  const value = bifoldr(eitherSync<unknown, unknown>(() => JSON.parse(stored.password)));

  return isCredentials(value) ? value : undefined;
};

export const clearExchangeCredentials = async (
  keychain: ExchangeKeychain,
  accountId: string,
): Promise<void> => {
  await Keychain.resetGenericPassword({ service: credentialServiceFor(keychain, accountId) });
};
