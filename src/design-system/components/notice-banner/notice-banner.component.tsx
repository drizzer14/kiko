import type { FC } from 'react';

import Box from '../box';
import Text from '../text';
import Button from '../button';

import { styles } from './notice-banner.styles';
import type { NoticeBannerProps } from './notice-banner.props';

// Inline and non-modal on purpose: the notice explains a state the user can
// keep working around, so it never interrupts with an alert or a sheet. The
// action is a small tonal secondary so it reads below the screen's primary CTA.
const NoticeBanner: FC<NoticeBannerProps> = ({ message, actionLabel, onAction, testID }) => {
  return (
    <Box background="surfaceHigh" padding={3} gap={2} style={styles.banner} testID={testID}>
      <Text variant="caption" tone="textSecondary">
        {message}
      </Text>

      {actionLabel !== undefined && onAction !== undefined && (
        <Button variant="secondaryTonal" size="small" fullWidth={false} onPress={onAction}>
          {actionLabel}
        </Button>
      )}
    </Box>
  );
};

export default NoticeBanner;
