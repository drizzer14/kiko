import { match, P } from 'ts-pattern';
import { type FC, useEffect } from 'react';
import { AccessibilityInfo } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import Animated, { FadeIn } from 'react-native-reanimated';

import Box from '../box';
import Text from '../text';
import SymbolIcon from '../symbol';

import { styles } from './error-notice.styles';
import type { ErrorNoticeProps } from './error-notice.props';

// The persistent, full-width error block a screen renders under the control that failed: the
// tint, the triangle icon and the position carry the error, so the text stays textPrimary (red
// text on the tint falls below 4.5:1 on raised grounds). REFLOW, not reserve: the node exists
// only while there is an error, and `FadeIn` softens the growth like `FieldError` does. The icon
// is decorative: the row is one accessible element labelled by the message.
const ErrorNotice: FC<ErrorNoticeProps> = (props) => {
  const { theme } = useUnistyles();
  const { announce = true, testID } = props;
  const { label, content } = match(props)
    .with({ lines: P.nonNullable }, ({ lines }) => ({
      label: lines.map((line) => line.text).join(' '),
      content: (
        <Box gap={1}>
          {lines.map((line) => (
            <Box key={line.key} testID={line.testID}>
              <Text variant="body" tone="textPrimary">
                {line.text}
              </Text>
            </Box>
          ))}
        </Box>
      ),
    }))
    .with({ message: P.string }, ({ message }) => ({
      label: message,
      content: (
        <Text variant="body" tone="textPrimary">
          {message}
        </Text>
      ),
    }))
    .exhaustive();

  // RN's iOS `alert` role does not speak by itself, and content that appears in response to a
  // press is silent to VoiceOver. The dependency on the text, not on the render, keeps a parent
  // re-render with the same message from repeating it.
  useEffect(() => {
    if (announce) {
      AccessibilityInfo.announceForAccessibility(label);
    }
  }, [announce, label]);

  return (
    <Animated.View entering={FadeIn} testID={testID}>
      <Box
        direction="row"
        gap={2}
        style={styles.row}
        accessible
        accessibilityRole="alert"
        accessibilityLabel={label}
      >
        <SymbolIcon
          name="exclamationmark.triangle.fill"
          size={theme.iconSizes.body}
          tone="negative"
        />

        <Box style={styles.text}>{content}</Box>
      </Box>
    </Animated.View>
  );
};

export default ErrorNotice;
