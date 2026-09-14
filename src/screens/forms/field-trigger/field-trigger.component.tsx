import type { FC } from 'react';
import { Pressable } from 'react-native';

import Box from '../../../design-system/components/box';
import Text from '../../../design-system/components/text';
import SymbolIcon from '../../../design-system/components/symbol';
import FieldLabel from '../../../design-system/components/field-label';

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

// The leading SF Symbol/text mark size, shared by both the `icon` and
// `leadingText` paths so the two visually match (a "$"/"AED" mark should
// read at the same size as the SF Symbol it stands in for).
const FIELD_TRIGGER_ICON_SIZE = 18;

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
  testID,
}) => (
  <Box gap={1}>
    {!hideLabel && <FieldLabel label={label} required={required} />}

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
            size={FIELD_TRIGGER_ICON_SIZE}
            tone="textSecondary"
            color={iconColor}
          />
        )}

        {icon === undefined && leadingText !== undefined && (
          <Text
            variant="body"
            tone="textSecondary"
            numberOfLines={1}
            style={[styles.leadingTextMark, { fontSize: FIELD_TRIGGER_ICON_SIZE }]}
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
  </Box>
);

export default FieldTrigger;
