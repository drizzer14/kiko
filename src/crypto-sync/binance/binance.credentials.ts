import {
  clearExchangeCredentials,
  credentialServiceFor,
  type ExchangeCredentials,
  type ExchangeKeychain,
  loadExchangeCredentials,
  saveExchangeCredentials,
} from '@kiko/crypto-sync/exchange/credentials';

/**
 * The single GLOBAL Binance credentials service. Historically the app stored ONE
 * Binance key pair per device under this service. Multi-account support keeps the
 * pair in a PER-ACCOUNT item (`serviceFor` below); this
 * global item is now transitional — it is what `migrate-binance-credential.ts`
 * reads and clears once the pair is bound to its connected account.
 */
export const BINANCE_CREDENTIALS_SERVICE = 'kiko.binance.credentials';

// Stored items outlive an app update, so the service string and the username are part of the
// stored data: a changed byte would orphan every connected user's pair.
const BINANCE_KEYCHAIN: ExchangeKeychain = {
  service: BINANCE_CREDENTIALS_SERVICE,
  username: 'binance',
};

/**
 * The per-account Keychain service for a Binance key pair, keyed by the stable
 * `accounts.id` (a local uuid — NOT a secret, so embedding it here leaks
 * nothing). Each connected Binance account holds its own isolated item, so a
 * read/clear for account A can never touch account B's credentials.
 */
export const serviceFor = (accountId: string): string =>
  credentialServiceFor(BINANCE_KEYCHAIN, accountId);

export type BinanceCredentials = ExchangeCredentials;

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
 * `accountId`, hardened (see `hardenedFor`). Each connected account owns its own item, so
 * saving account A's pair never touches account B's.
 */
export const saveCredentials = async (
  accountId: string,
  credentials: BinanceCredentials,
): Promise<void> => {
  await saveExchangeCredentials(BINANCE_KEYCHAIN, accountId, credentials);
  hasRepairedAccessPolicy = true;
};

/**
 * Reads the pair for ONE account. No biometric prompt for an item stored under the hardened
 * policy. A pair written before the hardening shipped still carries the old
 * per-read `BIOMETRY_CURRENT_SET` control (its first read here still prompts
 * once, unavoidably); it is re-saved once per process under the hardened,
 * prompt-free policy so later reads never fire Face ID and the pair is never
 * silently orphaned. Resolves `undefined` when nothing valid is stored.
 */
export const readCredentials = async (
  accountId: string,
): Promise<BinanceCredentials | undefined> => {
  const credentials = await loadExchangeCredentials(BINANCE_KEYCHAIN, accountId);

  if (credentials === undefined) {
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
    await saveCredentials(accountId, credentials);
  }

  return credentials;
};

export const clearCredentials = async (accountId: string): Promise<void> => {
  await clearExchangeCredentials(BINANCE_KEYCHAIN, accountId);
};
