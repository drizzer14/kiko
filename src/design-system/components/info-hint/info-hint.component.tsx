import type { FC } from 'react';
import { useUnistyles } from 'react-native-unistyles';

import Box from '../box';
import Text from '../text';
import SymbolIcon from '../symbol';

import { styles } from './info-hint.styles';
import type { InfoHintProps } from './info-hint.props';

// The icon is decorative: the row is one accessible element labelled by the message.
const InfoHint: FC<InfoHintProps> = ({ message, testID }) => {
  const { theme } = useUnistyles();

  return (
    <Box
      direction="row"
      gap={2}
      style={styles.row}
      accessible
      accessibilityLabel={message}
      testID={testID}
    >
      <SymbolIcon name="info.circle" size={theme.iconSizes.caption} tone="textSecondary" />

      <Box style={styles.text}>
        <Text variant="caption" tone="textSecondary">
          {message}
        </Text>
      </Box>
    </Box>
  );
};

export default InfoHint;
