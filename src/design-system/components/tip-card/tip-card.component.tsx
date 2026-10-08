import type { FC } from 'react';
import { View } from 'react-native';
import maybe, { foldMap } from 'fnts/maybe';
import { useUnistyles } from 'react-native-unistyles';
import Text from '@kiko/design-system/components/text';
import Button from '@kiko/design-system/components/button';
import SymbolIcon from '@kiko/design-system/components/symbol';

import { styles } from './tip-card.styles';
import type { TipCardProps } from './tip-card.props';

// A one-time hint in the TipKit inline shape: a flat tinted-accent callout (no
// border, no shadow) with a leading filled lightbulb, the message, and a
// trailing xmark close. It is deliberately NOT the solid bordered Card, so it
// reads as a separate transient layer beside neighbouring cards. Inline and
// non-modal, never a sheet, alert, or warning tone, so the user can ignore it.
// The glyph is decorative (the message carries the meaning); the close is an
// icon-only ghost button that holds a 44pt tap.
const TipCard: FC<TipCardProps> = ({ message, closeLabel, onClose, testID }) => {
  const { theme } = useUnistyles();
  const iconTestID = foldMap(maybe(testID), (value) => `${value}-icon`);

  return (
    <View style={styles.callout} testID={testID}>
      <SymbolIcon
        name="lightbulb.fill"
        size={theme.iconSizes.body}
        tone="accent"
        testID={iconTestID}
      />

      <View style={styles.message}>
        <Text variant="body" tone="textPrimary">
          {message}
        </Text>
      </View>

      <Button
        variant="ghost"
        size="compact"
        fullWidth={false}
        icon="xmark"
        accessibilityLabel={closeLabel}
        onPress={onClose}
      />
    </View>
  );
};

export default TipCard;
