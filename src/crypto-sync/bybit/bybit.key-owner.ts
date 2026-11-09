import { signQuery } from '@kiko/crypto-sync/exchange/signing';
import { exchangeStateDepsOf } from '@kiko/crypto-sync/exchange/walk';
import { keyOwnerOf } from '@kiko/crypto-sync/exchange/history-status';
import { parseExchangeState } from '@kiko/crypto-sync/exchange/walk-state';

/**
 * The value that tells one Bybit account's key from another's: the HMAC of the user id under the
 * account id, which is the one thing Kiko keeps made from the id. It is no secret from someone
 * who holds the data and a script (a user id has few digits), so it is not called one: the
 * policy says so. A sync writes it and a connect compares against it; both make it here.
 */
export const keyOwnerValueOf = (accountId: string, userId: string): string =>
  signQuery(accountId, userId);

/**
 * The value the account's state stores, or `undefined` when none: no row, a column nothing wrote,
 * a value that is no text, or a state whose top level this build cannot read. A failed read of the
 * state rejects, which the caller must not take for "no value".
 */
export const readStoredKeyOwner = async (accountId: string): Promise<string | undefined> =>
  keyOwnerOf(parseExchangeState(await exchangeStateDepsOf('bybit').readExchangeState(accountId)));
