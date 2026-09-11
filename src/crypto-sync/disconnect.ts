import { accountsRepo } from '@kiko/accounts/accounts.repo';

import { clearCredentials } from './binance/binance.credentials';
import type { BalanceProviderId } from './provider';

/**
 * Disconnect a wallet- or Binance-connected account, the required first step
 * before it can be deleted. Mirrors `monobank/disconnect.ts`: the DB mutation
 * (`accountsRepo.disconnect` — clear `institution`, drop the stale `syncedAt`
 * stamp, and KEEP each holding's `walletAddress` / `binanceAsset` so a later
 * reconnect re-adopts those rows) commits first; only then is the
 * non-transactional Keychain item cleared, and only for Binance — a wallet
 * stores no secret. If the DB write throws, the credentials stay put and the
 * account stays connected.
 */
export const disconnectCryptoAccount = async (
  accountId: string,
  providerId: BalanceProviderId,
): Promise<void> => {
  await accountsRepo.disconnect(accountId);

  if (providerId === 'binance') {
    await clearCredentials();
  }
};
