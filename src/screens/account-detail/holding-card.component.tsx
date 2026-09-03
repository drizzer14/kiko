import type { FC } from 'react';
import { Pressable } from 'react-native';

import { styles } from './holding-card.styles';
import type { HoldingRow } from '../../db/schema';
import Box from '../../design-system/components/box';
import Text from '../../design-system/components/text';
import { entityTintBackground } from '../../design-system/entity-tint';
import { defaultHoldingColor } from '../../holdings/entity-colors';
import { holdingValue } from '../../holdings/holding-value';
import { holdingTypeIcon } from '../../holdings/holding-icon';
import SymbolIcon from '../../design-system/components/symbol';
import MoneyText from '../../design-system/components/money-text';
import GlassSurface from '../../design-system/components/glass-surface';

// One holding rendered as a square grid card: its icon at the top, its name and
// computed value at the bottom. A plain tap opens the holding detail. Reordering
// and delete are owned by the enclosing grid and `CardContextMenu`: a hold that
// moves activates a drag (reorder), and a hold that stays still opens the
// deep-press (haptic) delete menu, so this card intentionally carries no
// long-press handler of its own. The value is
// the holding's COMPUTED worth as of `now` (deposits/bonds accrue over time and
// carry a stored balance of 0), matching the account headline and the
// holding-detail page.
const HoldingCard: FC<{
  holding: HoldingRow;
  now: number;
  onOpen: () => void;
}> = ({ holding, now, onOpen }) => (
  <GlassSurface
    testID="holding-card"
    radius="md"
    padding={3}
    bordered
    tint={entityTintBackground(holding.color ?? defaultHoldingColor[holding.type])}
    style={styles.card}
  >
    <Pressable accessibilityRole="button" onPress={onOpen} style={styles.pressable}>
      <SymbolIcon
        name={holding.icon ?? holdingTypeIcon[holding.type]}
        color={holding.color ?? defaultHoldingColor[holding.type]}
        accessibilityLabel={`${holding.name} icon`}
      />

      <Box gap={2}>
        <Text variant="body">{holding.name}</Text>

        <MoneyText money={holdingValue(holding, now)} style={styles.value} />
      </Box>
    </Pressable>
  </GlassSurface>
);

export default HoldingCard;
