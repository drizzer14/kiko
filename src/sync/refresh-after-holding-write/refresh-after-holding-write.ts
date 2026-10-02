import { refreshMarketData } from '@kiko/sync/refresh-market-data';

/**
 * The refresh a user's own holding write needs at once (a new holding, a new
 * or re-dated lot), unthrottled, since the write was deliberate. Never rejects.
 */
export const refreshAfterHoldingWrite = async (): Promise<void> => {
  await refreshMarketData({ throttled: false, metals: true });
};
