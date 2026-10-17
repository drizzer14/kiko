import { match } from 'ts-pattern';
import { accountsRepo } from '@kiko/accounts';

import type { BalanceProviderId } from '../provider';
import { clearCredentials, HISTORY_FLOOR_MS } from '../binance';

/**
 * Disconnect a wallet- or Binance-connected account, the required first step
 * before it can be deleted. Mirrors `src/monobank/disconnect/disconnect.ts`. For Binance the DB
 * mutation is `accountsRepo.disconnectExchange`, ONE write that resets the walk state first and
 * then does what `accountsRepo.disconnect` does (clear `institution`, drop the stale `syncedAt`
 * stamp, and KEEP each holding's `walletAddress` / `binanceAsset` so a later reconnect re-adopts
 * those rows). Every walk cursor goes to the floor (`HISTORY_FLOOR_MS`), never gone: a missing
 * cursor falls back to `latestTransactionTime`, which a reconnected DIFFERENT Binance account
 * would inherit as if it were its own already-imported history, silently skipping that
 * account's own older records. One write, because a walk still in flight can queue a patch
 * behind it: that patch finds the institution cleared and writes nothing, where a patch landing
 * between two writes would bring back a cursor the reset removed. Only then is the
 * non-transactional PER-ACCOUNT Keychain item cleared (`clearCredentials(accountId)`), and only
 * for Binance: a wallet stores no secret and has no walk state. Clearing is keyed by the
 * account id, so disconnecting one Binance connection never touches another's walk state or
 * credentials. If the DB write throws, the Keychain is left alone and the account stays
 * connected.
 */
export const disconnectCryptoAccount = async (
  accountId: string,
  providerId: BalanceProviderId,
): Promise<void> => {
  await match(providerId)
    .with('binance', async (exchangeId) => {
      await accountsRepo.disconnectExchange(accountId, exchangeId, HISTORY_FLOOR_MS);
      await clearCredentials(accountId);
    })
    .with('btc_wallet', () => accountsRepo.disconnect(accountId))
    .exhaustive();
};
