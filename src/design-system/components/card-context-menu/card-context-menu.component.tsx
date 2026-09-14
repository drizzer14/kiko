import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { trigger } from 'react-native-haptic-feedback';
import { type FC, type ReactNode, useState } from 'react';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import ConfirmSheet from '../confirm-sheet';

// The gesture's jest test id, exported so the component test can look the
// long-press up with `getByGestureTestId` and drive it.
export const HOLD_GESTURE_TEST_ID = 'card-context-menu-hold';

// The confirm button's jest test id, exported so a consumer's screen test can
// drive the themed delete confirm to completion (every card grid routes its
// delete through here, so they share one selector).
export const DELETE_CONFIRM_TEST_ID = 'card-context-menu-delete-confirm';

// A touch-and-hold must stay still for this long to open the delete confirm —
// long enough that a scroll or a drag-to-reorder (which both move the finger)
// is not mistaken for a delete intent.
const HOLD_DURATION_MS = 450;

// ...and must not travel past this many points. Any real movement past it
// CANCELS the long-press, so the finger is free to start the sortables
// drag-to-reorder instead of opening the confirm.
const HOLD_MAX_DISTANCE = 10;

/**
 * Wraps a grid card in a self-contained "deep-press (haptic)" delete confirm.
 *
 * A manual (deletable) entity gets a `react-native-gesture-handler` `LongPress`
 * composed alongside — never over — the card:
 *
 * - a quick TAP never activates the long-press (its min duration is not met), so
 *   it falls straight through to the child card's own `onPress` (open detail).
 *   Nothing is layered on top of the card that could swallow the tap.
 * - a touch-and-HOLD that stays still (past `HOLD_DURATION_MS`, within
 *   `HOLD_MAX_DISTANCE`) plays a medium-impact haptic and raises the shared,
 *   themed `ConfirmSheet` (a `BottomSheet`, NOT a native `ActionSheetIOS`),
 *   titled `Delete "<name>"` with a bare destructive `Delete` confirm and no
 *   body. Only that confirm routes to `onDelete`; Cancel and a scrim/back
 *   dismiss delete nothing. The named title keeps an accidental hold from
 *   deleting an unnamed item.
 * - a hold that MOVES past `HOLD_MAX_DISTANCE` fails the long-press, freeing the
 *   finger for the enclosing sortables drag-to-reorder.
 *
 * The confirm's visibility is component state (`confirmVisible`) because a
 * `BottomSheet` lives in the render tree — unlike the old imperative
 * `ActionSheetIOS`. The `LongPress` runs `.runOnJS(true)`, so its `onStart`
 * callback (the haptic bridge plus the `setState`) runs on the JS thread
 * directly, neither being a worklet.
 *
 * A synced (Monobank) entity is not deletable here, so it renders bare — no
 * gesture and no sheet. This keeps the synced guard AND, deliberately, leaves
 * the touch-and-hold free for the enclosing sortables drag to claim, so a
 * synced card can still be reordered.
 *
 * COEXISTENCE NOTE: both this long-press and the sortables drag begin from a
 * hold. A hold that stays still opens this confirm; a hold that moves the finger
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
  const { t } = useTranslation();
  const [confirmVisible, setConfirmVisible] = useState(false);

  if (!deletable) {
    return <>{children}</>;
  }

  const holdToDelete = Gesture.LongPress()
    .minDuration(HOLD_DURATION_MS)
    .maxDistance(HOLD_MAX_DISTANCE)
    .runOnJS(true)
    .withTestId(HOLD_GESTURE_TEST_ID)
    .onStart(() => {
      trigger('impactMedium');
      setConfirmVisible(true);
    });

  const cancelDelete = (): void => {
    setConfirmVisible(false);
  };

  // Close first, THEN delete: `onDelete` typically removes this card from its
  // grid, which unmounts this component — closing before that keeps the
  // setState off an unmounted node.
  const confirmDelete = (): void => {
    setConfirmVisible(false);
    onDelete();
  };

  return (
    <>
      <GestureDetector gesture={holdToDelete}>
        <View testID="card-context-menu">{children}</View>
      </GestureDetector>

      <ConfirmSheet
        visible={confirmVisible}
        title={t('common.deleteNamed', { name })}
        confirmLabel={t('common.delete')}
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
        destructive
        confirmTestID={DELETE_CONFIRM_TEST_ID}
      />
    </>
  );
};

export default CardContextMenu;
