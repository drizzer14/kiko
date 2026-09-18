import type { FC } from 'react';

import Box from '../box';
import Text from '../text';

import type { FieldErrorProps } from './field-error.props';

// The one inline validation-failure line a form renders next to a blocked
// field — in the `negative` caption tone, the same tone FieldLabel's
// required asterisk already uses. TextField and HoldingIdentityField render
// this themselves (in a reserved-height slot directly under their own
// input) when their `error` prop is set; every other field type composes it
// directly, next to the specific field it explains — never in a form's
// footer or at page bottom (see the form-validation inline-error-UX plan).
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
