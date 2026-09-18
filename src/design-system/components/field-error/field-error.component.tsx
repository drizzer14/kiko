import type { FC } from 'react';

import Box from '../box';
import Text from '../text';

import type { FieldErrorProps } from './field-error.props';

// The one inline validation-failure line a form renders next to a blocked
// field or footer Save button, in the `negative` caption tone — the same
// tone `FieldLabel`'s required asterisk already uses. Every form composes
// this instead of hand-rolling its own `Box`+`Text` error caption (see
// kiko-code-style's disabled-Save audit).
const FieldError: FC<FieldErrorProps> = ({ message, testID }) => {
  return (
    <Box testID={testID}>
      <Text variant="caption" tone="negative">
        {message}
      </Text>
    </Box>
  );
};

export default FieldError;
