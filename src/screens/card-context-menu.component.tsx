import { MenuView } from '@react-native-menu/menu';
import type { FC, ReactNode } from 'react';
import { deleteMenuActions, onMenuAction } from './grid-interaction';

/**
 * Wraps a grid card in the native iOS touch-and-hold context menu.
 *
 * A manual (deletable) entity gets a `MenuView` whose touch-and-hold surfaces a
 * single destructive Delete with the system haptic and preview; a plain tap
 * still falls through to the child card's own `onPress` (open detail), and
 * opening the menu does not navigate.
 *
 * A synced (Monobank) entity is not deletable here, so it gets NO menu at all —
 * the card renders bare. This keeps the synced guard AND, deliberately, leaves
 * the touch-and-hold gesture free for the enclosing sortables drag to claim, so
 * a synced card can still be reordered.
 *
 * COEXISTENCE NOTE: both `shouldOpenOnLongPress` (native menu) and the
 * sortables drag start from a hold. On device: a hold that stays still opens
 * the native menu; a hold that moves the finger reorders; a quick tap opens the
 * card. The exact hand-off between the native `UIContextMenuInteraction` and
 * the gesture-handler long-press that sortables uses may need on-device tuning
 * of the grid's `dragActivationDelay`.
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

  return (
    <MenuView
      testID="card-context-menu"
      shouldOpenOnLongPress
      actions={deleteMenuActions(name)}
      onPressAction={({ nativeEvent }) => onMenuAction(nativeEvent.event, onDelete)}
    >
      {children}
    </MenuView>
  );
};

export default CardContextMenu;
