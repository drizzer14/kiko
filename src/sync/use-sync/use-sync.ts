import { ratesRepo } from '@kiko/rates/rates.repo';
import either, { bifold, isLeft } from 'fnts/either';
import { useState } from 'react';

import { runSync } from '../../monobank/sync';
import { refreshRates } from '../../rates/rates-refresh';

export type SyncAction<Input> = {
  isSyncing: boolean;
  error: string | undefined;
  /** Resolves `true` on success, `false` when the run or the rate refresh failed (the failure is in `error`). */
  sync: (input: Input) => Promise<boolean>;
};

type UseSync = {
  isSyncing: boolean;
  error: string | undefined;
  sync: (targetAccountId?: string) => Promise<boolean>;
};

/**
 * The shared state machine behind every user-triggered sync (Monobank, wallet,
 * Binance): run the given sync, then refresh rates, tracking a syncing flag and
 * surfacing any failure as an error string instead of throwing.
 */
export const useSyncAction = <Input>(
  run: (input: Input) => Promise<unknown>,
): SyncAction<Input> => {
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const sync = async (input: Input): Promise<boolean> => {
    setIsSyncing(true);
    setError(undefined);

    const result = await either<unknown, void>(async () => {
      await run(input);
      const lastRefreshAt = await ratesRepo.latestFetchedAt();
      await refreshRates({ lastRefreshAt });
    });

    // Always clear the syncing flag, whether the run succeeded or failed —
    // this is the old `finally` block.
    setIsSyncing(false);

    if (isLeft(result)) {
      const caught = bifold(result);
      setError(caught instanceof Error ? caught.message : String(caught));

      return false;
    }

    return true;
  };

  return { isSyncing, error, sync };
};

/** The Monobank sync action used by Home, Settings and the bank account detail. */
export const useSync = (): UseSync => {
  const action = useSyncAction((targetAccountId: string | undefined) =>
    runSync({ targetAccountId }),
  );

  return { ...action, sync: (targetAccountId?: string) => action.sync(targetAccountId) };
};
