import type { ReactNode } from 'react';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

// Semgrep fixture (NEGATIVE): the allowed gestures. A bottom sheet's
// drag-to-dismiss `Gesture.Pan()` and a card's long-press
// `Gesture.LongPress()` (the `CardContextMenu` shape) are not swipe actions,
// and a comment or a test id merely naming a swipe-to-delete row (like
// `swipeable-row-actions` here) must not match `kiko-no-swipe-action`.
const dragToDismiss = Gesture.Pan().onEnd(() => undefined);

const longPressMenu = Gesture.LongPress().minDuration(400);

export const REMOVED_ACTIONS_TEST_ID = 'swipeable-row-actions';

export const AllowedGestures = ({ children }: { children: ReactNode }) => (
  <GestureDetector gesture={Gesture.Simultaneous(dragToDismiss, longPressMenu)}>
    {children}
  </GestureDetector>
);
