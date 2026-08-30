import { useState } from 'react';

import { runSync } from '../monobank/sync';
import { refreshRates } from '../rates/rates-refresh';

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
      await refreshRates();
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setIsSyncing(false);
    }
  };

  return { isSyncing, error, sync };
};
