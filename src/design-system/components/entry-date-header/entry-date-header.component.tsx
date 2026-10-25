import type { FC } from 'react';

import Box from '../box';
import Text from '../text';

import { styles } from './entry-date-header.styles';
import type { EntryDateHeaderProps } from './entry-date-header.props';

/**
 * The date label above an entry card: HoldingDetail's ledger day headers, which head the
 * scheduled loan payments too, render through it.
 */
const EntryDateHeader: FC<EntryDateHeaderProps> = ({ title, testID }) => {
  return (
    <Box style={styles.sectionHeader} testID={testID}>
      <Text variant="caption" tone="textSecondary">
        {title}
      </Text>
    </Box>
  );
};

export default EntryDateHeader;
