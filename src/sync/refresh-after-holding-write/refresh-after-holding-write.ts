import { logFailure } from '@kiko/diagnostics';
import { confirmDailyLimit } from '@kiko/prices/daily-limit';
import { refreshMarketData } from '@kiko/sync/refresh-market-data';

/**
 * The refresh a user's own holding write needs at once (a new holding, a
 * share's new source or ticker, a new or re-dated lot), unthrottled, since
 * the write was deliberate. The share refresh never reads `/user` itself, so
 * a write that refreshes shares reads a daily limit left unconfirmed first, at
 * no call; a failed check never holds the refresh back. Never rejects.
 */
export const refreshAfterHoldingWrite = async (shares: boolean): Promise<void> => {
  if (shares) {
    await confirmDailyLimit().catch((error: unknown) =>
      logFailure('[refresh-after-holding-write] daily limit check failed', error),
    );
  }

  await refreshMarketData({ throttled: false, metals: true, shares });
};
