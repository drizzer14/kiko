import type { ReactElement } from 'react';
import maybe, { foldMap } from 'fnts/maybe';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { type ColorScheme, type SwatchName, entityColorsDark } from '@kiko/design-system/palette';

import Box from '../box';
import Text from '../text';

import { styles } from './color-picker.styles';
import type { ColorPickerProps } from './color-picker.props';

// The theme field each `swatchSet` paints from.
const PAINT_SET_KEY = { entity: 'entityColors', category: 'categoryColors' } as const;

// The catalogue key of a swatch's spoken name where its paint contradicts the color word of its
// swatch name: the light palette paints `white` charcoal, so VoiceOver reads graphite there. A
// swatch without an entry is spoken as its swatch name.
const SPOKEN_NAME_KEY: Record<
  ColorScheme,
  Partial<Record<SwatchName, 'components.colorPicker.graphite'>>
> = {
  dark: {},
  light: { white: 'components.colorPicker.graphite' },
};

// A labeled single-select row of color swatches, one per named swatch of the
// dark palette. The account and holding create forms use it to color the entity;
// the selected swatch (the one whose dark hex equals `value`) carries a ring, and
// tapping a swatch reports its dark hex through `onSelect`, so a stored color is
// always the canonical hex whichever scheme paints the disc. Presentational: the
// caller owns the state and the default-follows-type wiring, exactly as it does
// for the ChipRow pickers.
const ColorPicker = ({
  value,
  onSelect,
  swatchSet,
  label,
  accessibilityLabelPrefix,
}: ColorPickerProps): ReactElement => {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const paintSet = theme.colors[PAINT_SET_KEY[swatchSet]];
  const swatches = (Object.keys(entityColorsDark) as SwatchName[]).map(
    (name) => [name, entityColorsDark[name], paintSet[name]] as const,
  );
  const resolvedAccessibilityLabelPrefix = accessibilityLabelPrefix ?? t('forms.fields.color');
  const spokenNameOf = (name: SwatchName): string =>
    foldMap(maybe(SPOKEN_NAME_KEY[theme.colorScheme][name]), (key) => t(key)) ?? name;

  return (
    <Box gap={1}>
      {label !== undefined && (
        <Text variant="caption" tone="textSecondary">
          {label}
        </Text>
      )}

      <Box style={styles.swatchRow}>
        {swatches.map(([name, canonicalHex, paintHex]) => {
          const selected = value === canonicalHex;

          return (
            <Pressable
              key={name}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`${resolvedAccessibilityLabelPrefix} ${spokenNameOf(name)}`}
              onPress={() => onSelect(canonicalHex)}
              style={styles.swatchCell}
            >
              <View
                testID={`color-ring-${name}`}
                style={[styles.swatchRing, selected && { borderColor: theme.colors.textPrimary }]}
              >
                <View
                  testID={`color-swatch-${name}`}
                  style={[styles.swatch, { backgroundColor: paintHex }]}
                />
              </View>
            </Pressable>
          );
        })}
      </Box>
    </Box>
  );
};

export default ColorPicker;
