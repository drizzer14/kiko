import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The native iOS `RefreshControl` spinner on the Home list is driven off the
 * GLOBAL sync signal (`isSyncing`, from `useSyncStatus`). Binding the control's
 * `refreshing` prop straight to that signal has one failure: iOS drops the spin
 * animation when the list leaves the window (a tab blur), and React re-renders
 * with `refreshing` STILL `true` on refocus. RN sees no `false`->`true` edge, so
 * it never re-calls the native `beginRefreshing()`, and the spinner stays frozen
 * even though the sync is still running.
 *
 * This hook returns a LOCAL `refreshing` flag that mirrors `isSyncing` while the
 * screen stays focused, and on every refocus while a sync is still in flight it
 * re-issues a `false`->`true` edge (`false` now, `true` on the next frame) so RN
 * restarts the native spin. The re-drive is the only fix for the frozen spinner;
 * the mirror keeps a sync that starts or ends without a blur honest.
 *
 * The re-drive reads `isSyncing` through a REF, not a dependency. Depending on
 * `isSyncing` made the focus callback re-run on an in-place false->true change
 * WHILE focused — a manual pull-to-refresh — firing its leading `false` edge and
 * retracting the native spinner the user had just pulled (the 663f2e5
 * regression). With a stable callback the re-drive fires ONLY on an actual
 * focus event (mount and blur->refocus), never on an isSyncing change in place;
 * a manual pull then flows through the mirror alone, a single `true` with no
 * intervening `false`.
 */
export const useRefreshControlSignal = (isSyncing: boolean): boolean => {
  const [refreshing, setRefreshing] = useState(isSyncing);

  // The latest signal, read by the focus re-drive without making it a dependency
  // (see the doc comment above). Updated in render so it is current the instant
  // a focus event fires.
  const isSyncingRef = useRef(isSyncing);
  isSyncingRef.current = isSyncing;

  // Track the global signal while the screen stays focused: a sync that begins
  // or ends without a tab blur still drives the spinner on and off. A manual
  // pull (isSyncing false->true while focused) lands here as a single `true`, so
  // the native spinner the user just started is never retracted.
  useEffect(() => {
    setRefreshing(isSyncing);
  }, [isSyncing]);

  // Re-issue the native begin edge on refocus. The prop is already `true` when a
  // sync outlives a blur, so only a `false`->`true` transition makes RN call
  // `beginRefreshing()` again. Defer the rising edge one frame so RN commits the
  // falling edge first — a same-tick `false` then `true` is no edge at all. The
  // callback is STABLE (empty deps, reads `isSyncing` via the ref), so it runs
  // only on a real focus event, never on an in-place isSyncing change.
  useFocusEffect(
    useCallback(() => {
      if (!isSyncingRef.current) {
        return;
      }

      setRefreshing(false);
      const frame = requestAnimationFrame(() => {
        setRefreshing(true);
      });

      return () => {
        cancelAnimationFrame(frame);
      };
    }, []),
  );

  return refreshing;
};
