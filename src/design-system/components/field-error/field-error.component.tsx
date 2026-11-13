import type { FC } from 'react';
import { useUnistyles } from 'react-native-unistyles';
import Animated, { FadeIn } from 'react-native-reanimated';

import Box from '../box';
import Text from '../text';
import SymbolIcon from '../symbol';

import { styles } from './field-error.styles';
import type { FieldErrorProps } from './field-error.props';

// The one inline validation-failure line a form renders next to a blocked
// field — in the `negative` caption tone, the same tone FieldLabel's
// required asterisk already uses. A leading triangle icon is a second cue
// beside the colour (HIG: more than colour alone); it is decorative, the row
// is one accessible element labelled by the message, laid out like
// `InfoHint`. Every field composes this directly, right
// where its own `error` prop is truthy — REFLOW, not reserve: there is no
// reserved-height slot, so a valid field takes no extra space and an invalid
// one grows to fit this line
// the instant it mounts. `Animated.View` (reanimated, already the app's
// layout-animation primitive — see sync-progress-bar/card-context-menu) with
// `entering={FadeIn}` gives that growth a soft fade-in instead of an
// instant, jarring pop, matching every other reflow in the app; there is no
// per-field outline (the reflow error model drops it — see
// `text-field.component.tsx`'s own doc comment), so this line — plus an
// optional negative-tinted `FieldLabel` beside it — IS the invalid signal.
const FieldError: FC<FieldErrorProps> = ({ message, testID }) => {
  const { theme } = useUnistyles();

  return (
    <Animated.View entering={FadeIn} testID={testID}>
      <Box direction="row" gap={2} style={styles.row} accessible accessibilityLabel={message}>
        <SymbolIcon
          name="exclamationmark.triangle.fill"
          size={theme.iconSizes.caption}
          tone="negative"
        />

        <Box style={styles.text}>
          <Text variant="caption" tone="negative">
            {message}
          </Text>
        </Box>
      </Box>
    </Animated.View>
  );
};

export default FieldError;
