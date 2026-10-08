import type { FC } from 'react';
import Animated, { FadeIn } from 'react-native-reanimated';

import Text from '../text';

import type { FieldErrorProps } from './field-error.props';

// The one inline validation-failure line a form renders next to a blocked
// field — in the `negative` caption tone, the same tone FieldLabel's
// required asterisk already uses. Every field composes this directly, right
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
  return (
    <Animated.View entering={FadeIn} testID={testID}>
      <Text variant="caption" tone="negative">
        {message}
      </Text>
    </Animated.View>
  );
};

export default FieldError;
