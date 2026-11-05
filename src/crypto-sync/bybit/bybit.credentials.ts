import {
  clearExchangeCredentials,
  createWriteSerial,
  type ExchangeCredentials,
  type ExchangeKeychain,
  loadExchangeCredentials,
  saveExchangeCredentials,
  type WriteToken,
} from '@kiko/crypto-sync/exchange/credentials';

// Stored items outlive an app update, so the service string and the username are part of the
// stored data: a changed byte would orphan every connected user's pair.
const BYBIT_KEYCHAIN: ExchangeKeychain = { service: 'kiko.bybit.credentials', username: 'bybit' };

const writes = createWriteSerial();

/**
 * Store the pair as ONE JSON Keychain item under the per-account service, hardened by
 * `hardenedFor` in `exchange/credentials` (unlocked only, this device only, no per-read
 * biometric). Resolves the token naming this write, for `clearBybitCredentialsIfWrittenBy`.
 */
export const saveBybitCredentials = (
  accountId: string,
  credentials: ExchangeCredentials,
): Promise<WriteToken> =>
  writes.serialized(accountId, async () => {
    await saveExchangeCredentials(BYBIT_KEYCHAIN, accountId, credentials);

    return writes.issueToken(accountId);
  });

/** Reads the pair of ONE account; `undefined` when nothing valid is stored. */
export const readBybitCredentials = (accountId: string): Promise<ExchangeCredentials | undefined> =>
  loadExchangeCredentials(BYBIT_KEYCHAIN, accountId);

// The token goes with the pair, and only once the pair is gone: a failed reset leaves the pair
// stored, and the token that names it must keep matching.
const resetPair = async (accountId: string): Promise<void> => {
  await clearExchangeCredentials(BYBIT_KEYCHAIN, accountId);
  writes.dropToken(accountId);
};

export const clearBybitCredentials = (accountId: string): Promise<void> =>
  writes.serialized(accountId, () => resetPair(accountId));

/**
 * Clears the account's pair only when `token` names the save that stored it, for a caller that
 * clears a pair it saved itself and must never delete one a later save stored, even a later save
 * of the very same keys. The check and the delete run as one serialized write, so no save lands
 * between them.
 */
export const clearBybitCredentialsIfWrittenBy = (
  accountId: string,
  token: WriteToken,
): Promise<void> =>
  writes.serialized(accountId, async () => {
    if (writes.holdsToken(accountId, token)) {
      await resetPair(accountId);
    }
  });
