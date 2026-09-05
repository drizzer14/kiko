import type { FC, ReactNode } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { openDeleteMenu } from '../grid-interaction';

// The gesture's jest test id, exported so the component test can look the
// long-press up with `getByGestureTestId` and drive it.
export const HOLD_GESTURE_TEST_ID = 'card-context-menu-hold';

// A touch-and-hold must stay still for this long to open the delete menu — long
// enough that a scroll or a drag-to-reorder (which both move the finger) is not
// mistaken for a delete intent.
const HOLD_DURATION_MS = 450;

// ...and must not travel past this many points. Any real movement past it
// CANCELS the long-press, so the finger is free to start the sortables
// drag-to-reorder instead of opening the menu.
const HOLD_MAX_DISTANCE = 10;

/**
 * Wraps a grid card in a self-contained "deep-press (haptic)" delete menu.
 *
 * A manual (deletable) entity gets a `react-native-gesture-handler` `LongPress`
 * composed alongside — never over — the card:
 *
 * - a quick TAP never activates the long-press (its min duration is not met), so
 *   it falls straight through to the child card's own `onPress` (open detail).
 *   Nothing is layered on top of the card that could swallow the tap.
 * - a touch-and-HOLD that stays still (past `HOLD_DURATION_MS`, within
 *   `HOLD_MAX_DISTANCE`) plays a medium-impact haptic and presents the native
 *   destructive delete sheet (see `openDeleteMenu`).
 * - a hold that MOVES past `HOLD_MAX_DISTANCE` fails the long-press, freeing the
 *   finger for the enclosing sortables drag-to-reorder.
 *
 * The callbacks run on the JS thread (`runOnJS`) because `openDeleteMenu` calls
 * `ActionSheetIOS` and the haptic bridge, neither of which is a worklet.
 *
 * A synced (Monobank) entity is not deletable here, so it renders bare — no
 * gesture at all. This keeps the synced guard AND, deliberately, leaves the
 * touch-and-hold free for the enclosing sortables drag to claim, so a synced
 * card can still be reordered.
 *
 * COEXISTENCE NOTE: both this long-press and the sortables drag begin from a
 * hold. A hold that stays still opens this menu; a hold that moves the finger
 * fails this gesture (`HOLD_MAX_DISTANCE`) and reorders instead; a quick tap
 * opens the card. On-device, `HOLD_DURATION_MS` may need tuning against the
 * grid's drag activation so the two never both fire on a single hold.
 */
const CardContextMenu: FC<{
  name: string;
  deletable: boolean;
  onDelete: () => void;
  children: ReactNode;
}> = ({ name, deletable, onDelete, children }) => {
  if (!deletable) {
    return <>{children}</>;
  }

  const holdToDelete = Gesture.LongPress()
    .minDuration(HOLD_DURATION_MS)
    .maxDistance(HOLD_MAX_DISTANCE)
    .runOnJS(true)
    .withTestId(HOLD_GESTURE_TEST_ID)
    .onStart(() => openDeleteMenu(name, onDelete));

  return (
    <GestureDetector gesture={holdToDelete}>
      <View testID="card-context-menu">{children}</View>
    </GestureDetector>
  );
};

export default CardContextMenu;
