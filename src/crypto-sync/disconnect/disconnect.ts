import { accountsRepo } from '@kiko/accounts';
import { holdingsRepo } from '@kiko/holdings/repo';

import { clearCredentials } from '../binance';
import type { BalanceProviderId } from '../provider';

/**
 * Disconnect a wallet- or Binance-connected account, the required first step
 * before it can be deleted. Mirrors `monobank/disconnect.ts`: for Binance, the
 * history-walk cursor (`holdings.metadata.binanceHistoryCursor`) is cleared
 * FIRST — a failure after this only causes a harmless re-walk from the floor,
 * whereas leaving it until after `accountsRepo.disconnect` risks a crash in
 * between stranding a stale watermark on an already-disconnected account. The
 * DB mutation (`accountsRepo.disconnect` — clear `institution`, drop the stale
 * `syncedAt` stamp, and KEEP each holding's `walletAddress` / `binanceAsset` so
 * a later reconnect re-adopts those rows) commits next; only then is the
 * non-transactional PER-ACCOUNT Keychain item cleared (`clearCredentials(accountId)`),
 * and only for Binance — a wallet stores no secret and has no history cursor.
 * Clearing is keyed by the account id, so disconnecting one Binance connection
 * never touches another's cursor or credentials. If an earlier step throws,
 * every later step is skipped and the account stays connected.
 */
export const disconnectCryptoAccount = async (
  accountId: string,
  providerId: BalanceProviderId,
): Promise<void> => {
  if (providerId === 'binance') {
    await holdingsRepo.clearBinanceHistoryCursor(accountId);
  }

  await accountsRepo.disconnect(accountId);

  if (providerId === 'binance') {
    await clearCredentials(accountId);
  }
};
