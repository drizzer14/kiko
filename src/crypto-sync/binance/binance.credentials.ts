import * as Keychain from 'react-native-keychain';
import { bifoldr, eitherSync } from 'fnts/either';

/**
 * The single GLOBAL Binance credentials service. Historically the app stored ONE
 * Binance key pair per device under this service. The multi-account plan
 * (2026-09-11) moves the pair to a PER-ACCOUNT item (`serviceFor` below); this
 * global item is now transitional — it is what `migrate-binance-credential.ts`
 * reads and clears once the pair is bound to its connected account.
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
 * — an item carrying `BIOMETRY_CURRENT_SET` forces a Face ID /
 * Touch ID prompt on EVERY read, so a pull-to-refresh sync (`readCredentials`
 * -> `fetchAccount`) would prompt the user each time. The app-wide biometric
 * gate is `LockGate` (`src/auth`), which replaces the per-item prompt. The pair
 * is never written to SQLite, holding metadata, or a log. Only the `service`
 * differs between the global item and each per-account item; the hardening is
 * identical, so it is derived here from ONE place and reused verbatim by every
 * writer (the per-account save and the credential migration).
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
 * The end of the last Keychain write queued for each account. A write that
 * checks the stored pair before it deletes it (`clearCredentialsIfStored`) is
 * only sound if no other write for the same account lands between its read and
 * its delete, and the form saves a new pair outside the database write queue, so
 * every write for an account waits here for the ones queued before it. The tail
 * never rejects, so a failed write does not block the next one.
 */
const writeTails = new Map<string, Promise<void>>();

const serialized = <Result>(accountId: string, write: () => Promise<Result>): Promise<Result> => {
  const run = (writeTails.get(accountId) ?? Promise.resolve()).then(write);

  writeTails.set(
    accountId,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );

  return run;
};

/**
 * Store the pair as ONE JSON Keychain item under the PER-ACCOUNT service for
 * `accountId`, hardened per above. Each connected account owns its own item, so
 * saving account A's pair never touches account B's. The pair goes ONLY to the
 * Keychain — never to SQLite, `sync_state`, `settings`, `holdings.metadata`, or a
 * log.
 */
export const saveCredentials = (
  accountId: string,
  credentials: BinanceCredentials,
): Promise<void> =>
  serialized(accountId, async () => {
    await Keychain.setGenericPassword(
      'binance',
      JSON.stringify(credentials),
      hardenedFor(serviceFor(accountId)),
    );
    hasRepairedAccessPolicy = true;
  });

// Never repairs the access policy: it runs inside a serialized write, which a repair save would
// wait on forever.
const readStoredPair = async (accountId: string): Promise<BinanceCredentials | undefined> => {
  const stored = await Keychain.getGenericPassword({ service: serviceFor(accountId) });

  if (!stored) {
    return undefined;
  }

  const parsed = eitherSync<unknown, unknown>(() => JSON.parse(stored.password));
  const value = bifoldr(parsed);

  return isCredentials(value) ? value : undefined;
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
  const value = await readStoredPair(accountId);

  if (value === undefined) {
    return undefined;
  }

  // Repair an item still carrying the old per-read `BIOMETRY_CURRENT_SET`
  // control from before the hardening shipped. Gated so a READ stays a read
  // after the first call: running the repair unconditionally on every call
  // would turn every pull-to-refresh and every crypto sync into a full
  // Keychain write of the API key and secret — a routine read path that
  // could disturb stored credentials if a write failed partway. `readToken`
  // and `readDbKey` are pure; this now matches them after the first call.
  if (!hasRepairedAccessPolicy) {
    await saveCredentials(accountId, value);
  }

  return value;
};

const resetPair = async (accountId: string): Promise<void> => {
  await Keychain.resetGenericPassword({ service: serviceFor(accountId) });
};

export const clearCredentials = (accountId: string): Promise<void> =>
  serialized(accountId, () => resetPair(accountId));

/**
 * Clears the account's pair only when it is still exactly `expected` (both parts), for a caller
 * that clears a pair it wrote itself and must never delete one a later save stored. The read and
 * the delete run as one serialized write, so no save lands between them. Nothing stored, or a
 * different pair stored, leaves the Keychain as it is.
 */
export const clearCredentialsIfStored = (
  accountId: string,
  expected: BinanceCredentials,
): Promise<void> =>
  serialized(accountId, async () => {
    const stored = await readStoredPair(accountId);

    if (stored?.apiKey === expected.apiKey && stored.secret === expected.secret) {
      await resetPair(accountId);
    }
  });
