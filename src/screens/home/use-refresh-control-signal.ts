import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';

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
 */
export const useRefreshControlSignal = (isSyncing: boolean): boolean => {
  const [refreshing, setRefreshing] = useState(isSyncing);

  // Track the global signal while the screen stays focused: a sync that begins
  // or ends without a tab blur still drives the spinner on and off.
  useEffect(() => {
    setRefreshing(isSyncing);
  }, [isSyncing]);

  // Re-issue the native begin edge on refocus. The prop is already `true` when a
  // sync outlives a blur, so only a `false`->`true` transition makes RN call
  // `beginRefreshing()` again. Defer the rising edge one frame so RN commits the
  // falling edge first — a same-tick `false` then `true` is no edge at all.
  useFocusEffect(
    useCallback(() => {
      if (!isSyncing) {
        return;
      }

      setRefreshing(false);
      const frame = requestAnimationFrame(() => {
        setRefreshing(true);
      });

      return () => {
        cancelAnimationFrame(frame);
      };
    }, [isSyncing]),
  );

  return refreshing;
};
