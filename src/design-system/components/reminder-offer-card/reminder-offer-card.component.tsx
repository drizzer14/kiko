import type { FC } from 'react';
import Box from '@kiko/design-system/components/box';
import Card from '@kiko/design-system/components/card';
import Text from '@kiko/design-system/components/text';
import Button from '@kiko/design-system/components/button';

import { styles } from './reminder-offer-card.styles';
import type { ReminderOfferCardProps } from './reminder-offer-card.props';

// An invitation, not a problem: it sits in the content flow on the plain Card
// surface with a neutral message, never a sheet, an alert, or a warning tone, so
// the user can ignore it and keep working. Dismiss is the faint-tint secondary,
// so it reads clearly below the accept action.
const ReminderOfferCard: FC<ReminderOfferCardProps> = ({
  message,
  acceptLabel,
  dismissLabel,
  onAccept,
  onDismiss,
  testID,
}) => {
  return (
    <Card padding={3} style={styles.card} testID={testID}>
      <Text variant="body" tone="textPrimary">
        {message}
      </Text>

      <Box direction="row" gap={2} style={styles.actions}>
        <Button variant="primary" size="small" fullWidth={false} onPress={onAccept}>
          {acceptLabel}
        </Button>

        <Button variant="secondaryTonal" size="small" fullWidth={false} onPress={onDismiss}>
          {dismissLabel}
        </Button>
      </Box>
    </Card>
  );
};

export default ReminderOfferCard;
