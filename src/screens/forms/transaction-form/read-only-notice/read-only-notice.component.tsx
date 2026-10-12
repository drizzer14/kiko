import type { ReactElement } from 'react';
import Box from '@kiko/design-system/components/box';
import { useUnistyles } from 'react-native-unistyles';
import Text from '@kiko/design-system/components/text';

import { styles } from './read-only-notice.styles';
import type { ReadOnlyNoticeProps } from './read-only-notice.props';

// The read-only row's explanatory notice, or nothing on a manual/add row. A
// component of its own (returns `ReactElement | null`) so this branch stays out
// of the screen's returned JSX and its cognitive-complexity budget.
const ReadOnlyNotice = ({ isReadOnly, noticeText }: ReadOnlyNoticeProps): ReactElement | null => {
  const { theme } = useUnistyles();

  if (!isReadOnly) {
    return null;
  }

  return (
    <Box padding={3} style={[styles.notice, { backgroundColor: theme.colors.surfaceHigh }]}>
      <Text variant="caption" tone="textSecondary">
        {noticeText}
      </Text>
    </Box>
  );
};

export default ReadOnlyNotice;
