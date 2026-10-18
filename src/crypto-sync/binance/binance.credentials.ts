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
 * The end of the last Keychain write queued for each account. A write that checks which save
 * stored the pair before it deletes it (`clearCredentialsIfWrittenBy`), or that re-reads the pair
 * before it saves it again (the access-policy repair), is only sound if no other write for the
 * same account lands between its check and its change, and the form saves a new pair outside the
 * database write queue, so every write for an account waits here for the ones queued before it.
 * The tail never rejects, so a failed write does not block the next one.
 */
const writeTails = new Map<string, Promise<void>>();

/**
 * Names one `saveCredentials` write. Two saves of the same keys get two tokens, so a caller that
 * clears "what I saved" can tell its own write from a later one that stored an equal pair.
 */
export type BinanceWriteToken = symbol;

/**
 * The token of the save that stored each account's pair, set only after that save's Keychain
 * write resolved and dropped by a clear, so a failed save keeps the previous token. What the failed
 * save left stored is that token's pair or nothing (the iOS Keychain deletes the old item before
 * it inserts the new one), never another write's pair. Memory only: a restart loses every token,
 * then no token matches and nothing is cleared, which keeps a pair rather than deleting one by
 * mistake.
 */
const storedTokens = new Map<string, BinanceWriteToken>();

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

const writePair = async (accountId: string, credentials: BinanceCredentials): Promise<void> => {
  await saveExchangeCredentials(BINANCE_KEYCHAIN, accountId, credentials);
  hasRepairedAccessPolicy = true;
};

/**
 * Store the pair as ONE JSON Keychain item under the PER-ACCOUNT service for
 * `accountId`, hardened (see `hardenedFor` in `exchange/credentials`). Each connected account owns
 * its own item, so saving account A's pair never touches account B's. Resolves the token naming
 * this write, for `clearCredentialsIfWrittenBy`.
 */
export const saveCredentials = (
  accountId: string,
  credentials: BinanceCredentials,
): Promise<BinanceWriteToken> =>
  serialized(accountId, async () => {
    await writePair(accountId, credentials);

    const token = Symbol('binance-write');

    storedTokens.set(accountId, token);

    return token;
  });

// Re-saves `read` under the hardened policy as ONE serialized step: it re-reads inside the step and
// saves only while the stored pair is still `read`, so a clear or a save that landed after the
// caller's read is never undone with a stale copy. It writes the pair it just checked, so it is not
// a new write and leaves every token as it is: a token that named this pair still names it. It
// loads the pair directly, never through `readCredentials`, which would repair the access policy
// and so wait on this very write forever.
const repairAccessPolicy = (accountId: string, read: BinanceCredentials): Promise<void> =>
  serialized(accountId, async () => {
    const stored = await loadExchangeCredentials(BINANCE_KEYCHAIN, accountId);

    if (
      !hasRepairedAccessPolicy &&
      stored?.apiKey === read.apiKey &&
      stored.secret === read.secret
    ) {
      await writePair(accountId, read);
    }
  });

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
    await repairAccessPolicy(accountId, credentials);
  }

  return credentials;
};

// The token goes with the pair, and only once the pair is gone: a failed reset leaves the pair
// stored, and the token that names it must keep matching.
const resetPair = async (accountId: string): Promise<void> => {
  await clearExchangeCredentials(BINANCE_KEYCHAIN, accountId);
  storedTokens.delete(accountId);
};

export const clearCredentials = (accountId: string): Promise<void> =>
  serialized(accountId, () => resetPair(accountId));

/**
 * Clears the account's pair only when `token` names the save that stored it, for a caller that
 * clears a pair it saved itself and must never delete one a later save stored, even a later save
 * of the very same keys. The check and the delete run as one serialized write, so no save lands
 * between them. A pair stored by a newer save, an already cleared pair, and a token this process
 * never issued leave the Keychain as it is.
 */
export const clearCredentialsIfWrittenBy = (
  accountId: string,
  token: BinanceWriteToken,
): Promise<void> =>
  serialized(accountId, async () => {
    if (storedTokens.get(accountId) === token) {
      await resetPair(accountId);
    }
  });
