import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import Box from '../../../design-system/components/box';
import Text from '../../../design-system/components/text';

import type { ColorPickerProps } from './color-picker.props';
import { styles } from './color-picker.styles';

// A labeled single-select row of color swatches drawn from the named
// `entityColors` palette (the one source of truth in the theme). The account and
// holding create forms use it to color the entity; the selected swatch (the one
// whose hex equals `value`) carries a ring, and tapping a swatch reports its hex
// through `onSelect`. Presentational: the caller owns the state and the
// default-follows-type wiring, exactly as it does for the ChipRow pickers.
const ColorPicker = ({
  value,
  onSelect,
  label,
  accessibilityLabelPrefix,
}: ColorPickerProps): ReactElement => {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const swatches = Object.entries(theme.colors.entityColors);
  const resolvedAccessibilityLabelPrefix = accessibilityLabelPrefix ?? t('forms.fields.color');

  return (
    <Box gap={1}>
      {label !== undefined && (
        <Text variant="caption" tone="textSecondary">
          {label}
        </Text>
      )}

      <Box style={styles.swatchRow} gap={2}>
        {swatches.map(([name, hex]) => {
          const selected = value === hex;

          return (
            <Pressable
              key={name}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`${resolvedAccessibilityLabelPrefix} ${name}`}
              onPress={() => onSelect(hex)}
              style={[styles.swatchRing, selected && { borderColor: theme.colors.textPrimary }]}
            >
              <View style={[styles.swatch, { backgroundColor: hex }]} />
            </Pressable>
          );
        })}
      </Box>
    </Box>
  );
};

export default ColorPicker;
