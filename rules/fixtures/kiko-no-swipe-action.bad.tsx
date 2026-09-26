import type { ReactNode } from 'react';
import { PanResponder } from 'react-native';
import { Gesture, useFlingGesture } from 'react-native-gesture-handler';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
// EXPECT-FINDING
import * as SwipeableModule from 'react-native-gesture-handler/ReanimatedSwipeable';

// Semgrep fixture (POSITIVE): swipe actions were removed from Kiko on
// purpose — a row's edit/delete is the long-press `CardContextMenu`, see
// kiko-gestures's "No swipe actions" section. `kiko-no-swipe-action` MUST
// report a finding on the imports above (a fling-named import, the
// gesture-handler `ReanimatedSwipeable` module by default and by namespace)
// and on every pinned line below: a fling recognizer, the swipeable
// component, a swipe-named row, and a `PanResponder` (the app's own former
// swipe row was built on one).
// A swipe-list package is matched by the same module-path arm; it is not
// installed, so it cannot appear in a type-valid fixture.
const SwipeableRow = ({ children }: { children: ReactNode }) => <>{children}</>;

export const useSwipeRows = (children: ReactNode) => {
  // EXPECT-FINDING
  const legacyFling = Gesture.Fling();

  // EXPECT-FINDING
  const fling = useFlingGesture();

  // EXPECT-FINDING
  const swipeable = <ReanimatedSwipeable>{children}</ReanimatedSwipeable>;

  // EXPECT-FINDING
  const row = <SwipeableRow>{children}</SwipeableRow>;

  // EXPECT-FINDING
  const responder = PanResponder.create({ onMoveShouldSetPanResponder: () => true });

  return { legacyFling, fling, swipeable, row, responder, SwipeableModule };
};
