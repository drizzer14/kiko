import { useState } from 'react';
import either, { bifold, isLeft } from 'fnts/either';
import { refreshMarketData } from '@kiko/sync/refresh-market-data';

import { runSync } from '../../monobank/sync';

export type SyncAction<Input> = {
  isSyncing: boolean;
  error: string | undefined;
  /** Resolves `true` on success, `false` when the run failed (the failure is in `error`). */
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
    });

    if (isLeft(result)) {
      // Always clear the syncing flag, whether the run succeeded or failed —
      // this is the old `finally` block.
      setIsSyncing(false);
      const caught = bifold(result);
      setError(caught instanceof Error ? caught.message : String(caught));

      return false;
    }

    // One rate refresh per sync, run only after a SUCCESSFUL account sync —
    // a single sync keeps rates-only scope (`metals: false`), unchanged from
    // before this refactor. `refreshMarketData` never rejects and logs its
    // own failure with no UI surface, so a rate-refresh failure never turns
    // a successful sync into a reported error here.
    await refreshMarketData({ throttled: true, metals: false });

    setIsSyncing(false);

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
