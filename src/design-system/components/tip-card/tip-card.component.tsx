import type { FC } from 'react';
import Box from '@kiko/design-system/components/box';
import Card from '@kiko/design-system/components/card';
import Text from '@kiko/design-system/components/text';
import Button from '@kiko/design-system/components/button';

import { styles } from './tip-card.styles';
import type { TipCardProps } from './tip-card.props';

// A one-time hint: inline on the plain Card surface (the ReminderOfferCard
// precedent), never a sheet, alert, or warning tone, so the user can ignore it
// and keep working. Close is an icon-only ghost button that holds a 44pt tap.
const TipCard: FC<TipCardProps> = ({ message, closeLabel, onClose, testID }) => {
  return (
    <Card padding={3} style={styles.card} testID={testID}>
      <Box style={styles.message}>
        <Text variant="body" tone="textPrimary">
          {message}
        </Text>
      </Box>

      <Button
        variant="ghost"
        size="compact"
        fullWidth={false}
        icon="xmark"
        accessibilityLabel={closeLabel}
        onPress={onClose}
      />
    </Card>
  );
};

export default TipCard;
