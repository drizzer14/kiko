import { useState } from 'react';

import { runSync } from '../monobank/sync';
import { refreshRates } from '../rates/rates-refresh';
import { ratesRepo } from '../repositories/rates.repo';

const toErrorMessage = (caught: unknown): string =>
  caught instanceof Error ? caught.message : String(caught);

type UseSync = {
  isSyncing: boolean;
  error: string | undefined;
  sync: () => Promise<void>;
};

/**
 * Encapsulates the shared Sync flow used by Home and Settings: run the Monobank
 * sync, then refresh rates, tracking a syncing flag and surfacing any failure as
 * an error string instead of throwing.
 */
export const useSync = (): UseSync => {
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const sync = async (): Promise<void> => {
    setIsSyncing(true);
    setError(undefined);
    try {
      await runSync();
      const lastRefreshAt = await ratesRepo.latestFetchedAt();
      await refreshRates({ lastRefreshAt });
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setIsSyncing(false);
    }
  };

  return { isSyncing, error, sync };
};
