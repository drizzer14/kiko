import { accountsRepo } from '@kiko/accounts';
import { holdingsRepo } from '@kiko/holdings/repo';

import type { BalanceProviderId } from '../provider';
import { clearCredentials, HISTORY_FLOOR_MS } from '../binance';

/**
 * Disconnect a wallet- or Binance-connected account, the required first step
 * before it can be deleted. Mirrors `monobank/disconnect.ts`: for Binance, every
 * history-walk cursor (`binanceWalkCursorFields` in `holding-metadata.ts`) is RESET
 * TO THE FLOOR (`HISTORY_FLOOR_MS`) FIRST — never stripped: a stripped cursor
 * falls back to `latestTransactionTime`, which a reconnected DIFFERENT
 * Binance account would inherit as if it were its own already-imported
 * history, silently skipping that account's own older records. A failure
 * after this only causes a harmless, idempotent re-walk from the floor,
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
    await holdingsRepo.resetBinanceHistoryCursor(accountId, HISTORY_FLOOR_MS);
  }

  await accountsRepo.disconnect(accountId);

  if (providerId === 'binance') {
    await clearCredentials(accountId);
  }
};
