import either, { bifold, isLeft } from 'fnts/either';
import { useState } from 'react';

import { runSync } from '../monobank/sync';
import { refreshRates } from '../rates/rates-refresh';
import { ratesRepo } from '../repositories/rates.repo';

type UseSync = {
  isSyncing: boolean;
  error: string | undefined;
  sync: (targetAccountId?: string) => Promise<void>;
};

/**
 * Encapsulates the shared Sync flow used by Home and Settings: run the Monobank
 * sync, then refresh rates, tracking a syncing flag and surfacing any failure as
 * an error string instead of throwing.
 */
export const useSync = (): UseSync => {
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const sync = async (targetAccountId?: string): Promise<void> => {
    setIsSyncing(true);
    setError(undefined);

    const result = await either<unknown, void>(async () => {
      await runSync({ targetAccountId });
      const lastRefreshAt = await ratesRepo.latestFetchedAt();
      await refreshRates({ lastRefreshAt });
    });

    // Always clear the syncing flag, whether the run succeeded or failed —
    // this is the old `finally` block.
    setIsSyncing(false);

    if (isLeft(result)) {
      const caught = bifold(result);
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  return { isSyncing, error, sync };
};
