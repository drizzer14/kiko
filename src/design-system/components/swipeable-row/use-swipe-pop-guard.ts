import { useCallback, useRef } from 'react';
import type { ParamListBase } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

// The stacks use createNativeStackNavigator, so the iOS interactive back-swipe
// is a NATIVE pop gesture — a JS PanResponder inside a SwipeableRow cannot
// cancel it. When an open row is swiped right to close, that same rightward
// travel also fires the native pop. The fix is to disable the current screen's
// native pop gesture while any row is open and re-enable it once every row is
// closed.

// Only the setOptions surface of a native-stack navigation is needed. Narrowed
// to that so the screen can pass its own `navigation` prop straight in (which
// also keeps the hook trivially testable without a NavigationContainer).
type PopGuardNavigation = Pick<NativeStackNavigationProp<ParamListBase>, 'setOptions'>;

// Pure open-row tally: a row opening bumps the count, a row closing drops it,
// floored at zero so a stray close (or a double-emit) can never drive the tally
// negative and strand the gesture disabled.
export const nextOpenCount = (previous: number, open: boolean): number =>
  open ? previous + 1 : Math.max(0, previous - 1);

// Returns an onOpenChange handler for SwipeableRow. It reference-counts the
// open rows on this screen, so multiple rows behave correctly: the native pop
// gesture is disabled the moment the first row opens and restored only when the
// last one closes. The screen's own back-swipe stays available at every other
// time.
export const useSwipePopGuard = (navigation: PopGuardNavigation): ((open: boolean) => void) => {
  const openCount = useRef(0);

  return useCallback(
    (open: boolean) => {
      const previous = openCount.current;
      const next = nextOpenCount(previous, open);
      openCount.current = next;

      const wasAnyOpen = previous > 0;
      const isAnyOpen = next > 0;

      // Only toggle on the 0<->1 boundary: disable when the first row opens,
      // re-enable when the last one closes. A second row opening (or one of
      // several closing) leaves the tally on the same side of the boundary and
      // must not re-issue setOptions.
      if (wasAnyOpen === isAnyOpen) {
        return;
      }

      navigation.setOptions({
        gestureEnabled: !isAnyOpen,
        fullScreenGestureEnabled: !isAnyOpen,
      });
    },
    [navigation],
  );
};
