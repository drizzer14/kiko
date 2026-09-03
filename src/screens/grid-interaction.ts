import type { MenuAction } from '@react-native-menu/menu';

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
 * Persist a real reorder from the accounts/holdings sortable grid.
 *
 * react-native-sortables fires `onDragEnd` when the finger lifts — WHETHER OR
 * NOT the item moved:
 *
 * - long-press then MOVE (`fromIndex !== toIndex`): a reorder — persist the new
 *   front-to-back order (`indexToKey`, already the reordered key list).
 * - long-press then RELEASE IN PLACE (`fromIndex === toIndex`): the user held
 *   without dragging. That gesture now belongs to the native iOS context menu
 *   (see `CardContextMenu`), so a release-in-place persists nothing here.
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

// The id carried by the single Delete action, matched back in `onMenuAction`
// when the native menu reports the pressed action.
export const DELETE_ACTION_ID = 'delete';

/**
 * The actions for a card's native iOS context menu (touch-and-hold): a single
 * destructive `Delete "<name>"` carrying the `trash` SF Symbol. The target's
 * display name is spelled out on the destructive row so an accidental hold does
 * not delete an unnamed item. A synced (Monobank) entity never reaches here —
 * `CardContextMenu` renders no menu at all for it — so this always describes a
 * deletable, manual entity.
 */
export const deleteMenuActions = (name: string): MenuAction[] => [
  {
    id: DELETE_ACTION_ID,
    title: `Delete "${name}"`,
    attributes: { destructive: true },
    image: 'trash',
  },
];

/**
 * Route a native menu's pressed-action id to the delete callback. Only the
 * Delete action runs `onDelete`; any other id is ignored, so adding a future
 * non-destructive action cannot accidentally delete the item.
 */
export const onMenuAction = (actionId: string, onDelete: () => void): void => {
  if (actionId === DELETE_ACTION_ID) {
    onDelete();
  }
};
