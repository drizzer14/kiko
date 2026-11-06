import type { FC } from 'react';
import Box from '@kiko/design-system/components/box';
import Text from '@kiko/design-system/components/text';
import MoneyText from '@kiko/design-system/components/money-text';
import EntityIconTile from '@kiko/design-system/components/entity-icon-tile';

import { styles } from './recurring-group-heading.styles';
import type { RecurringGroupHeadingProps } from './recurring-group-heading.props';

// A category's heading in the recurring list: its icon tile and title, and what its series paid
// so far. Nothing opens a category from here, so it is no button and has no chevron.
const RecurringGroupHeading: FC<RecurringGroupHeadingProps> = ({
  title,
  icon,
  color,
  total,
  testID,
  totalTestID,
}) => {
  return (
    <Box direction="row" testID={testID} style={styles.row}>
      <Box direction="row" gap={3} style={styles.lead}>
        <EntityIconTile name={icon} color={color} compact />

        <Box style={styles.title}>
          <Text variant="heading">{title}</Text>
        </Box>
      </Box>

      <Box testID={totalTestID} style={styles.total}>
        <MoneyText money={total} />
      </Box>
    </Box>
  );
};

export default RecurringGroupHeading;
