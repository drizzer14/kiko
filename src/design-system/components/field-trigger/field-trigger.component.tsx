import type { FC } from 'react';
import { Pressable } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import Box from '../box';
import Text from '../text';
import SymbolIcon from '../symbol';
import FieldError from '../field-error';
import FieldLabel from '../field-label';
import { deriveFieldTestID } from '../../derive-field-test-id';

import { styles } from './field-trigger.styles';
import type { FieldTriggerProps } from './field-trigger.props';

// The shared "labeled field that opens a picker sheet" trigger: a caption
// above a bordered row showing the current icon + value, tapping which opens
// the caller's own sheet. CategoryField and HoldingSelectField rendered this
// exact JSX (down to an identical `field` style block) independently before
// being unified onto this one component — see each caller's own doc comment
// for why they are meant to read as one family. A future field-plus-sheet
// picker (DateField already has its own near-identical shape) should reach
// for this too rather than re-copying it a third time.
const FieldTrigger: FC<FieldTriggerProps> = ({
  label,
  onPress,
  icon,
  iconColor,
  leadingText,
  value,
  valueTone,
  trailing,
  required,
  disabled = false,
  hideLabel = false,
  error,
  testID,
}) => {
  const { theme } = useUnistyles();
  // A defined, non-empty `error` IS the invalid signal — same contract as
  // TextField's own `hasError` (see text-field.component.tsx).
  const hasError = error !== undefined && error !== '';

  return (
    <Box gap={1}>
      {!hideLabel && <FieldLabel label={label} required={required} invalid={hasError} />}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        testID={testID}
      >
        <Box direction="row" gap={2} style={[styles.field, disabled && styles.fieldDisabled]}>
          {icon !== undefined && (
            <SymbolIcon
              name={icon}
              size={theme.iconSizes.body}
              tone="textSecondary"
              color={iconColor}
            />
          )}

          {icon === undefined && leadingText !== undefined && (
            <Text
              variant="body"
              tone="textSecondary"
              numberOfLines={1}
              style={styles.leadingTextMark}
            >
              {leadingText}
            </Text>
          )}

          <Text variant="body" tone={valueTone}>
            {value}
          </Text>

          {trailing}
        </Box>
      </Pressable>

      {/* REFLOW, not reserve (Option A) — same contract as every other field
          type: no error node while valid. */}
      {hasError && <FieldError message={error} testID={deriveFieldTestID(testID, 'error')} />}
    </Box>
  );
};

export default FieldTrigger;
