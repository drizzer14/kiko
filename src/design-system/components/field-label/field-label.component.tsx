import type { FC } from 'react';

import Box from '../box';
import Text from '../text';

import type { FieldLabelProps } from './field-label.props';

// The one caption every labeled form field renders above its control. It
// centralizes the required-field marker: pass `required` and a red asterisk
// (the `negative` money/error tone) follows the label. Every field primitive
// composes this instead of hand-rolling its own caption Text, so the marker
// looks and behaves the same everywhere.
const FieldLabel: FC<FieldLabelProps> = ({ label, required = false }) => {
  return (
    <Box direction="row" gap={1}>
      <Text variant="caption" tone="textSecondary">
        {label}
      </Text>

      {required && (
        <Text variant="caption" tone="negative">
          *
        </Text>
      )}
    </Box>
  );
};

export default FieldLabel;
