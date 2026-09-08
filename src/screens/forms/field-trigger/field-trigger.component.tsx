import type { FC } from 'react';
import { Pressable } from 'react-native';

import Box from '../../../design-system/components/box';
import SymbolIcon from '../../../design-system/components/symbol';
import Text from '../../../design-system/components/text';

import type { FieldTriggerProps } from './field-trigger.props';
import { styles } from './field-trigger.styles';

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
  value,
  valueTone,
  trailing,
}) => (
  <Box gap={1}>
    <Text variant="caption" tone="textSecondary">
      {label}
    </Text>

    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}>
      <Box direction="row" gap={2} style={styles.field}>
        {icon !== undefined && (
          <SymbolIcon name={icon} size={18} tone="textSecondary" color={iconColor} />
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
