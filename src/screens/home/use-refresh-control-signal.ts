import { useState } from 'react';

import { isFastPhaseDone, subscribeFastPhase } from '../../monobank/sync-status';

/**
 * The native iOS `RefreshControl` spinner on the Home list is the PULL GESTURE
 * indicator ALONE. It is DECOUPLED from the whole sync run: binding its
 * `refreshing` prop to the whole-run `isSyncing` flag fought iOS across
 * navigation, window-detach and scroll (the spinner froze, vanished every other
 * Home navigation, or drew behind the cells). The whole run is now shown by the
 * determinate progress bar (`SyncProgressBar`), not this spinner.
 *
 * This hook returns a LOCAL `refreshing` flag driven ONLY by the user's pull. It
 * wraps the caller's `onRefresh` and sets the flag `true` SYNCHRONOUSLY inside
 * it — before any await — so `refreshing` is already true in the commit right
 * after the pull. The native iOS `RefreshControl` retracts the spinner on
 * finger-release unless `refreshing` is ALREADY true at that commit, so the
 * synchronous set is what keeps the pulled spinner on.
 *
 * The spinner ends when the FAST BALANCE PHASE resolves — the instant
 * `runSync`'s `upsertAllHoldings` commits the client-info balances
 * (`fastPhaseDone` in `sync-status.ts`) — NOT when the whole run settles minutes
 * later. Ending on the whole run reintroduced the frozen-spinner bug; ending on
 * the fast phase gives a brief native spinner while balances load, then hands
 * the slow per-card transaction fetch to the progress bar.
 *
 * The flag clears on the FIRST of two events, whichever comes first:
 *  - the fast-phase-done signal fires (the normal Monobank path), OR
 *  - the whole run settles (`onRefresh`'s promise) — the fallback for a fan-out
 *    with NO Monobank job (a crypto-only account, or no syncable account),
 *    which fires no fast-phase signal, so the spinner can never hang.
 *
 * A pull that JOINS an already-in-flight run whose fast phase already committed
 * clears immediately: the balances are already loaded, so the check right after
 * subscribing catches the already-`true` signal.
 *
 * The fast-phase-done signal is read only inside the pull handler, so an
 * auto-sync-on-open (which fires the same signal with NO pull) never lights this
 * spinner — it drives only the progress bar.
 */
export const useRefreshControlSignal = (
  onRefresh: () => Promise<void>,
): { refreshing: boolean; onRefresh: () => void } => {
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = (): void => {
    setRefreshing(true);

    let cleared = false;
    let unsubscribe = (): void => undefined;
    const clear = (): void => {
      if (cleared) {
        return;
      }
      cleared = true;
      unsubscribe();
      setRefreshing(false);
    };

    // Clear when the fast balance phase resolves (the normal path).
    unsubscribe = subscribeFastPhase(() => {
      if (isFastPhaseDone()) {
        clear();
      }
    });
    // A pull joining a run whose fast phase already committed: clear at once.
    if (isFastPhaseDone()) {
      clear();
    }
    // Fallback so the spinner never hangs when no fast-phase signal fires.
    onRefresh().finally(clear);
  };

  return { refreshing, onRefresh: handleRefresh };
};
