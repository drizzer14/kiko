import type { FC } from 'react';
import { Pressable } from 'react-native';

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
// computed value at the bottom. Display-only and tappable — pressing anywhere
// opens the holding detail. The value is the holding's COMPUTED worth as of
// `now` (deposits/bonds accrue over time and carry a stored balance of 0),
// matching the account headline and the holding-detail page.
const HoldingCard: FC<{ holding: HoldingRow; now: number; onOpen: () => void }> = ({
  holding,
  now,
  onOpen,
}) => {
  return (
    <GlassSurface testID="holding-card" radius="md" padding={3} style={styles.card}>
      <Pressable accessibilityRole="button" onPress={onOpen} style={styles.pressable}>
        <SymbolIcon
          name={holding.icon ?? holdingTypeIcon[holding.type]}
          accessibilityLabel={`${holding.name} icon`}
        />

        <Box gap={1}>
          <Text variant="body">{holding.name}</Text>

          <MoneyText money={holdingValue(holding, now)} />
        </Box>
      </Pressable>
    </GlassSurface>
  );
};

export default HoldingCard;
