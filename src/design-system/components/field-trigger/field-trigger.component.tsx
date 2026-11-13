import type { FC } from 'react';
import { Pressable } from 'react-native';
import maybe, { foldMap } from 'fnts/maybe';
import { useUnistyles } from 'react-native-unistyles';
import { markColor } from '@kiko/design-system/entity-tint';
import { deriveFieldTestID } from '@kiko/design-system/derive-field-test-id';

import Box from '../box';
import Text from '../text';
import SymbolIcon from '../symbol';
import FieldError from '../field-error';
import FieldLabel from '../field-label';

import { styles } from './field-trigger.styles';
import type { FieldTriggerProps } from './field-trigger.props';

// The shared "labeled field that opens a picker sheet" trigger: a caption
// above a bordered row showing the current icon + value, tapping which opens
// the caller's own sheet. CategoryField and HoldingSelectField rendered this
// exact JSX (down to an identical `field` style block) independently before
// being unified onto this one component — see each caller's own doc comment
// for why they are meant to read as one family. DateField and TimeField render
// it too, so a new field-plus-sheet picker should reach for it rather than
// re-copying the box.
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
  invalid = false,
  capped = false,
  testID,
}) => {
  const { theme } = useUnistyles();
  // A defined, non-empty `error` IS the invalid signal — same contract as
  // TextField's own `hasError` (see text-field.component.tsx).
  const hasError = error !== undefined && error !== '';
  // A wrapper Box carries the flex, because Text's `style` admits typography keys only. It grows
  // to push the trailing content and chevron to the end and shrinks so a long value wraps.
  const valueText = (
    <Box style={[styles.value, capped && styles.valueCapped]}>
      <Text variant="body" tone={valueTone}>
        {value}
      </Text>
    </Box>
  );

  return (
    <Box gap={1}>
      {!hideLabel && <FieldLabel label={label} required={required} invalid={hasError || invalid} />}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        style={capped && styles.fieldCapped}
        testID={testID}
      >
        <Box direction="row" gap={2} style={[styles.field, disabled && styles.fieldDisabled]}>
          {icon !== undefined && (
            <SymbolIcon
              name={icon}
              size={theme.iconSizes.body}
              tone="textSecondary"
              color={foldMap(maybe(iconColor), (color) => markColor(color, theme.colorScheme))}
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

          {valueText}

          {trailing}

          <Box accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <SymbolIcon name="chevron.down" size={theme.iconSizes.caption} tone="textSecondary" />
          </Box>
        </Box>
      </Pressable>

      {/* REFLOW, not reserve (the reflow error model; see `FieldError`) — same
          contract as every other field type: no error node while valid. */}
      {hasError && <FieldError message={error} testID={deriveFieldTestID(testID, 'error')} />}
    </Box>
  );
};

export default FieldTrigger;
