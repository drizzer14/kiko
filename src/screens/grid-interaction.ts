import { ActionSheetIOS } from 'react-native';

// The subset of react-native-sortables' `onDragEnd` params this app reads. The
// library also passes `keyToIndex`; it is not needed here. Kept local (callers
// pass a matching object literal by structural typing) so it is not a dangling
// public export.
type GridDragEnd = {
  key: string;
  fromIndex: number;
  toIndex: number;
  indexToKey: string[];
};

/**
 * Reconcile the two long-press gestures the accounts/holdings grids share.
 *
 * react-native-sortables activates a drag on a long-press (after a short
 * activation delay) and fires `onDragEnd` when the finger lifts — WHETHER OR
 * NOT the item moved. This maps the two outcomes:
 *
 * - long-press then MOVE (`fromIndex !== toIndex`): a reorder — persist the new
 *   front-to-back order (`indexToKey`, already the reordered key list).
 * - long-press then RELEASE IN PLACE (`fromIndex === toIndex`): the user held
 *   without dragging, which stands in for the existing context menu — open it
 *   for the pressed item (`key`).
 *
 * A quick tap never activates a drag, so `onDragEnd` never fires for it and the
 * item's own `onPress` (open detail) is left to handle it.
 */
export const onGridDragEnd = (
  params: GridDragEnd,
  persistOrder: (orderedIds: string[]) => void,
  openContextMenu: (key: string) => void,
): void => {
  if (params.fromIndex === params.toIndex) {
    openContextMenu(params.key);
    return;
  }

  persistOrder(params.indexToKey);
};

/**
 * The long-press-in-place context menu shared by both grids: a single
 * destructive `Delete "<name>"` (which IS the confirmation) plus Cancel. The
 * target's display name is spelled out on the destructive button so an
 * accidental long-press does not delete an unnamed item. `onDelete` runs only
 * when Delete (index 0) is chosen; Cancel (index 1) does nothing.
 */
export const showDeleteActionSheet = (name: string, onDelete: () => void): void => {
  ActionSheetIOS.showActionSheetWithOptions(
    { options: [`Delete "${name}"`, 'Cancel'], destructiveButtonIndex: 0, cancelButtonIndex: 1 },
    (buttonIndex) => {
      if (buttonIndex === 0) {
        onDelete();
      }
    },
  );
};
