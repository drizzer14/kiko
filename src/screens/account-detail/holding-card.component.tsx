import type { FC } from 'react';
import { ActionSheetIOS, Pressable } from 'react-native';

import { styles } from './holding-card.styles';
import type { HoldingRow } from '../../db/schema';
import Box from '../../design-system/components/box';
import Text from '../../design-system/components/text';
import { holdingValue } from '../../holdings/holding-value';
import { holdingTypeIcon } from '../../holdings/holding-icon';
import SymbolIcon from '../../design-system/components/symbol';
import MoneyText from '../../design-system/components/money-text';
import GlassSurface from '../../design-system/components/glass-surface';

// One holding rendered as a square grid card: its icon at the top, its name and
// computed value at the bottom. Tappable — pressing anywhere opens the holding
// detail. A long-press opens the native iOS action sheet offering Delete
// (destructive) for a deletable holding; `onDelete` is omitted for a synced
// holding, so its card carries no destructive menu at all. The value is the
// holding's COMPUTED worth as of `now` (deposits/bonds accrue over time and
// carry a stored balance of 0), matching the account headline and the
// holding-detail page.
const HoldingCard: FC<{
  holding: HoldingRow;
  now: number;
  onOpen: () => void;
  onDelete?: () => void;
}> = ({ holding, now, onOpen, onDelete }) => {
  // The action sheet's destructive Delete IS the confirmation, so selecting it
  // deletes directly. Cancel (the sheet's own cancel index) does nothing.
  const openMenu = (): void => {
    ActionSheetIOS.showActionSheetWithOptions(
      { options: ['Delete', 'Cancel'], destructiveButtonIndex: 0, cancelButtonIndex: 1 },
      (buttonIndex) => {
        if (buttonIndex === 0) {
          onDelete?.();
        }
      },
    );
  };

  return (
    <GlassSurface testID="holding-card" radius="md" padding={3} style={styles.card}>
      <Pressable
        accessibilityRole="button"
        onPress={onOpen}
        onLongPress={onDelete ? openMenu : undefined}
        style={styles.pressable}
      >
        <SymbolIcon
          name={holding.icon ?? holdingTypeIcon[holding.type]}
          accessibilityLabel={`${holding.name} icon`}
        />

        <Box gap={2}>
          <Text variant="body">{holding.name}</Text>

          <MoneyText money={holdingValue(holding, now)} style={styles.value} />
        </Box>
      </Pressable>
    </GlassSurface>
  );
};

export default HoldingCard;
