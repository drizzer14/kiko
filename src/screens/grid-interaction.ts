import { ActionSheetIOS } from 'react-native';
import { trigger } from 'react-native-haptic-feedback';

// The subset of react-native-sortables' `onDragEnd` params this app reads. The
// library also passes `keyToIndex`; it is not needed here. Kept local (callers
// pass a matching object literal by structural typing) so it is not a dangling
// public export.
type GridDragEnd = {
  fromIndex: number;
  toIndex: number;
  indexToKey: string[];
};

/**
 * Persist a real reorder from the accounts/holdings sortable grid.
 *
 * react-native-sortables fires `onDragEnd` when the finger lifts — WHETHER OR
 * NOT the item moved:
 *
 * - long-press then MOVE (`fromIndex !== toIndex`): a reorder — persist the new
 *   front-to-back order (`indexToKey`, already the reordered key list).
 * - long-press then RELEASE IN PLACE (`fromIndex === toIndex`): the user held
 *   without dragging. That gesture belongs to the card's deep-press (haptic)
 *   delete menu (see `CardContextMenu`), so a release-in-place persists nothing
 *   here.
 *
 * A quick tap never activates a drag, so `onDragEnd` never fires for it and the
 * card's own `onPress` (open detail) handles it.
 */
export const onGridDragEnd = (
  params: GridDragEnd,
  persistOrder: (orderedIds: string[]) => void,
): void => {
  if (params.fromIndex !== params.toIndex) {
    persistOrder(params.indexToKey);
  }
};

/**
 * Open the card's deep-press (haptic) delete menu.
 *
 * Fired from a touch-and-hold that stays still (the `LongPress` gesture in
 * `CardContextMenu`; movement cancels it so the sortables drag wins instead).
 * It plays a medium-impact haptic and presents a native `ActionSheetIOS` with a
 * single destructive `Delete "<name>"` and a `Cancel`. The target's display
 * name is spelled out on the destructive row so an accidental hold does not
 * delete an unnamed item; only the destructive index routes to `onDelete`, so
 * Cancel (and the sheet dismiss) deletes nothing. A synced (Monobank) entity
 * never reaches here — `CardContextMenu` renders no gesture for it — so this
 * always describes a deletable, manual entity.
 */
export const openDeleteMenu = (name: string, onDelete: () => void): void => {
  trigger('impactMedium');
  ActionSheetIOS.showActionSheetWithOptions(
    {
      options: ['Cancel', `Delete "${name}"`],
      destructiveButtonIndex: 1,
      cancelButtonIndex: 0,
    },
    (buttonIndex) => {
      if (buttonIndex === 1) {
        onDelete();
      }
    },
  );
};
