import { bifold, eitherSync, isRight } from 'fnts/either';
import * as Keychain from 'react-native-keychain';

/**
 * The single GLOBAL Binance credentials service. Historically the app stored ONE
 * Binance key pair per device under this service. The multi-account plan
 * (2026-09-11) moves the pair to a PER-ACCOUNT item (`serviceFor` below); this
 * global item is now transitional — it is what `migrate-binance-credential.ts`
 * reads and clears once the pair is bound to its connected account, and what the
 * old-app import restores into for that migration to pick up.
 */
export const BINANCE_CREDENTIALS_SERVICE = 'kiko.binance.credentials';

/**
 * The per-account Keychain service for a Binance key pair, keyed by the stable
 * `accounts.id` (a local uuid — NOT a secret, so embedding it here leaks
 * nothing). Each connected Binance account holds its own isolated item, so a
 * read/clear for account A can never touch account B's credentials.
 */
export const serviceFor = (accountId: string): string =>
  `${BINANCE_CREDENTIALS_SERVICE}.${accountId}`;

export type BinanceCredentials = { apiKey: string; secret: string };

const isCredentials = (value: unknown): value is BinanceCredentials =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { apiKey?: unknown }).apiKey === 'string' &&
  typeof (value as { secret?: unknown }).secret === 'string';

/**
 * Storage-at-rest policy for the read-only Binance key pair: readable only
 * while the device is unlocked, and bound to this device (never iCloud-synced
 * or restored onto another one from a backup). Deliberately NO `accessControl`
 * — this pair used to carry `BIOMETRY_CURRENT_SET`, which forced a Face ID /
 * Touch ID prompt on EVERY read, so a pull-to-refresh sync (`readCredentials`
 * -> `fetchAccount`) prompted the user each time. The app-wide biometric gate
 * is now `LockGate` (`src/auth`), which replaces the per-item prompt. The pair
 * is never written to SQLite, holding metadata, or a log. Only the `service`
 * differs between the global item and each per-account item; the hardening is
 * identical, so it is derived here from ONE place and reused verbatim by every
 * writer (the per-account save, the global save, and the credential migration).
 */
export const hardenedFor = (service: string): Keychain.SetOptions => ({
  service,
  accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
});

/**
 * Once-per-process latch for the legacy-policy re-save below: a module-level
 * marker, reset only by a fresh process. Set only AFTER the re-save resolves,
 * never before the `await`, so a rejected write leaves the repair to be retried
 * on the next read instead of permanently disabling it.
 *
 * When to delete: drop this latch and the repair path with it once no device
 * can still hold a pair saved under the old `BIOMETRY_CURRENT_SET` policy —
 * that is, once the user has re-saved credentials at least once on a build
 * carrying this fix.
 */
let hasRepairedAccessPolicy = false;

/**
 * Store the pair as ONE JSON Keychain item under the PER-ACCOUNT service for
 * `accountId`, hardened per above. Each connected account owns its own item, so
 * saving account A's pair never touches account B's. The pair goes ONLY to the
 * Keychain — never to SQLite, `sync_state`, `settings`, `holdings.metadata`, or a
 * log.
 */
export const saveCredentials = async (
  accountId: string,
  credentials: BinanceCredentials,
): Promise<void> => {
  await Keychain.setGenericPassword(
    'binance',
    JSON.stringify(credentials),
    hardenedFor(serviceFor(accountId)),
  );
  hasRepairedAccessPolicy = true;
};

/**
 * Write the TRANSITIONAL GLOBAL credentials item. Used ONLY by the old-app
 * import, which restores the retired app's single pair before any account row
 * exists to key it by; the boot migration (`migrateBinanceCredentialToPerAccount`)
 * then binds it to the connected account. Ordinary in-app saves use the
 * per-account `saveCredentials`.
 */
export const saveGlobalCredentials = async (credentials: BinanceCredentials): Promise<void> => {
  await Keychain.setGenericPassword(
    'binance',
    JSON.stringify(credentials),
    hardenedFor(BINANCE_CREDENTIALS_SERVICE),
  );
};

/**
 * Reads the pair for ONE account. The per-account service string is derived from
 * the account id on every call, so a read for account A can never return account
 * B's credentials. No biometric prompt for an item stored under the hardened
 * policy. A pair written before the hardening shipped still carries the old
 * per-read `BIOMETRY_CURRENT_SET` control (its first read here still prompts
 * once, unavoidably); it is re-saved once per process under the hardened,
 * prompt-free policy so later reads never fire Face ID and the pair is never
 * silently orphaned. Resolves `undefined` when nothing valid is stored.
 */
export const readCredentials = async (
  accountId: string,
): Promise<BinanceCredentials | undefined> => {
  const stored = await Keychain.getGenericPassword({ service: serviceFor(accountId) });

  if (!stored) {
    return undefined;
  }

  const parsed = eitherSync<unknown, unknown>(() => JSON.parse(stored.password));
  const value = isRight(parsed) ? bifold(parsed) : undefined;

  if (!isCredentials(value)) {
    return undefined;
  }

  // Repair an item written before the hardening shipped (it still carries the
  // old per-read `BIOMETRY_CURRENT_SET` control). Gated so a READ stays a read:
  // this used to run on every single call, turning every pull-to-refresh and
  // every crypto sync into a full Keychain write of the API key and secret — a
  // routine read path that could disturb stored credentials if a write failed
  // partway. `readToken` and `readDbKey` are pure; this now matches them after
  // the first call.
  if (!hasRepairedAccessPolicy) {
    await saveCredentials(accountId, value);
  }

  return value;
};

export const clearCredentials = async (accountId: string): Promise<void> => {
  await Keychain.resetGenericPassword({ service: serviceFor(accountId) });
};
