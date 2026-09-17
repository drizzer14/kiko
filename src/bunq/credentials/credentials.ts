import { bifold, eitherSync, isRight } from 'fnts/either';
import * as Keychain from 'react-native-keychain';

/**
 * The per-account Keychain service for a bunq user API key, keyed by the
 * stable `accounts.id` (a local uuid — NOT a secret, so embedding it here
 * leaks nothing). Mirrors `src/privatbank/credentials/credentials.ts`'s
 * per-account shape. The API key alone is what authenticates the handshake
 * (`/device-server`, `/session-server`); the DERIVED session material lives
 * in a SEPARATE Keychain item (`BUNQ_CONTEXT_SERVICE`, below) — the two are
 * cleared together by `clearCredentials`, but saved/read independently, so a
 * session refresh never has to touch the raw API key item.
 */
export const BUNQ_APIKEY_SERVICE = 'kiko.bunq.apiKey';

/**
 * The per-account Keychain service for bunq's DERIVED session context: the
 * client's RSA keypair, the installation token, the device id, the session
 * token + its expiry, and the bunq user id. Every one of these is as
 * sensitive as the API key itself — the session token alone authenticates
 * every later read call — so this stays in the Keychain only, never SQLite,
 * `sync_state`, `settings`, `holdings.metadata`, or a log.
 */
export const BUNQ_CONTEXT_SERVICE = 'kiko.bunq.context';

export const apiKeyServiceFor = (accountId: string): string =>
  `${BUNQ_APIKEY_SERVICE}.${accountId}`;

export const contextServiceFor = (accountId: string): string =>
  `${BUNQ_CONTEXT_SERVICE}.${accountId}`;

export type BunqCredentials = { apiKey: string };

export type BunqContext = {
  privateKeyPem: string;
  publicKeyPem: string;
  installationToken: string;
  deviceId: string;
  sessionToken: string;
  sessionExpiresAt: number;
  userId: string;
};

const isCredentials = (value: unknown): value is BunqCredentials =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { apiKey?: unknown }).apiKey === 'string';

const isContext = (value: unknown): value is BunqContext => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    typeof record.privateKeyPem === 'string' &&
    typeof record.publicKeyPem === 'string' &&
    typeof record.installationToken === 'string' &&
    typeof record.deviceId === 'string' &&
    typeof record.sessionToken === 'string' &&
    typeof record.sessionExpiresAt === 'number' &&
    typeof record.userId === 'string'
  );
};

/**
 * Storage-at-rest policy for a bunq Keychain item: readable only while the
 * device is unlocked, and bound to this device (never iCloud-synced or
 * restored onto another one from a backup). Deliberately NO `accessControl`
 * — a per-read biometric prompt would fire Face ID on every background
 * sync, matching Monobank's token and PrivatBank's credential pair.
 */
const hardenedFor = (service: string): Keychain.SetOptions => ({
  service,
  accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
});

const readJson = async <T>(
  service: string,
  isValid: (value: unknown) => value is T,
): Promise<T | undefined> => {
  const stored = await Keychain.getGenericPassword({ service });

  if (!stored) {
    return undefined;
  }

  const parsed = eitherSync<unknown, unknown>(() => JSON.parse(stored.password));
  const value = isRight(parsed) ? bifold(parsed) : undefined;

  return isValid(value) ? value : undefined;
};

/**
 * Store the API key as ONE JSON Keychain item under the PER-ACCOUNT service
 * for `accountId`. Each connected account owns its own item, so saving
 * account A's key never touches account B's.
 */
export const saveApiKey = async (
  accountId: string,
  credentials: BunqCredentials,
): Promise<void> => {
  await Keychain.setGenericPassword(
    'bunq',
    JSON.stringify(credentials),
    hardenedFor(apiKeyServiceFor(accountId)),
  );
};

/**
 * Reads the API key for ONE account. Resolves `undefined` when nothing
 * valid is stored (absent, corrupt JSON, or a mis-shaped value missing the
 * `apiKey` field).
 */
export const readApiKey = async (accountId: string): Promise<BunqCredentials | undefined> =>
  readJson(apiKeyServiceFor(accountId), isCredentials);

/**
 * Store the derived session context for `accountId`. Called once after a
 * fresh handshake, and again every time a session is refreshed (see
 * `ensureBunqContext`, `src/bunq/sync/sync.ts`).
 */
export const saveContext = async (accountId: string, context: BunqContext): Promise<void> => {
  await Keychain.setGenericPassword(
    'bunq',
    JSON.stringify(context),
    hardenedFor(contextServiceFor(accountId)),
  );
};

/**
 * Reads the derived session context for ONE account. Resolves `undefined`
 * when nothing valid is stored — a fresh connect, a disconnected account,
 * or a corrupt/mis-shaped value missing a required field.
 */
export const readContext = async (accountId: string): Promise<BunqContext | undefined> =>
  readJson(contextServiceFor(accountId), isContext);

/**
 * Clears BOTH bunq Keychain items for `accountId` — the API key AND the
 * derived session context — in one call, so `disconnectBunq`
 * (`src/bunq/disconnect/disconnect.ts`) never has to remember to clear two
 * separate services.
 */
export const clearCredentials = async (accountId: string): Promise<void> => {
  await Keychain.resetGenericPassword({ service: apiKeyServiceFor(accountId) });
  await Keychain.resetGenericPassword({ service: contextServiceFor(accountId) });
};

/**
 * Whether an API key is stored FOR `accountId`, WITHOUT handing the value
 * back — mirrors `hasCredentials` (`src/privatbank/credentials/credentials.ts`).
 * Checks the API-key item only: whether the derived session context exists
 * or has expired is an implementation detail the "connected" status does
 * not need to know about. `hasGenericPassword` queries the item's
 * attributes only, so this never decrypts the key into the JS heap just to
 * compare it against `false`.
 */
export const hasCredentials = async (accountId: string): Promise<boolean> =>
  Keychain.hasGenericPassword({ service: apiKeyServiceFor(accountId) });
