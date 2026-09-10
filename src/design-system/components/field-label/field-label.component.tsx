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
        // Decorative: the field's own control owns its accessibilityLabel, so
        // the marker is hidden from the accessibility tree (importantForAccessibility
        // for Android, accessibilityElementsHidden for iOS) — otherwise VoiceOver
        // reads a lone "star" after the label.
        <Box importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <Text variant="caption" tone="negative">
            *
          </Text>
        </Box>
      )}
    </Box>
  );
};

export default FieldLabel;
