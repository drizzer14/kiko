import type { ReactElement } from 'react';
import { Pressable, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import Box from '../box';
import SymbolIcon from '../symbol';
import Text from '../text';

import type { OptionPillsProps } from './option-pills.props';
import { styles } from './option-pills.styles';

// The selected pill's label weight — semibold, so the selected state reads
// through weight on top of the accent fill and onAccent tone. A module-level
// constant (not an inline object) so it is one stable style reference.
const selectedLabelStyle = { fontWeight: '600' } as const;

// A wrapping grid of selectable pills for a small closed set of options (base
// currency, lock grace period). Only the selected pill paints a raised surface;
// the rest stay transparent so the glass card behind shows through. Generic over
// the option type, so it is a plain function component (an `FC` cannot carry a
// type parameter).
const OptionPills = <T extends string | number>({
  options,
  selected,
  onSelect,
  label = String,
  icon,
  columns = 2,
}: OptionPillsProps<T>): ReactElement => {
  const { theme } = useUnistyles();
  const cellWidth = { width: `${100 / columns}%` } as const;

  return (
    <Box style={styles.grid}>
      {options.map((option) => {
        const isSelected = selected === option;

        return (
          <View key={String(option)} style={[styles.cell, cellWidth]}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              onPress={() => onSelect(option)}
              // The selected option paints a FILLED accent surface (the iOS
              // selected-segment / filter-chip treatment, mirroring ChipRow), so
              // it reads as clearly chosen even on the low-contrast sheet
              // background; the others stay transparent so the glass card behind
              // them shows through.
              style={[
                styles.pill,
                { backgroundColor: isSelected ? theme.colors.accent : 'transparent' },
              ]}
            >
              {icon !== undefined && (
                <SymbolIcon
                  name={icon(option)}
                  size={18}
                  // On the accent fill the glyph takes the always-white onAccent
                  // tone (the onAccent rule for a selected icon on an accent fill).
                  tone={isSelected ? 'onAccent' : 'textSecondary'}
                />
              )}

              <Text
                variant="body"
                tone={isSelected ? 'onAccent' : 'textSecondary'}
                // The selected label is semibold, so the selected/unselected
                // hierarchy reads through weight as well as fill and tone.
                style={isSelected ? selectedLabelStyle : undefined}
              >
                {label(option)}
              </Text>
            </Pressable>
          </View>
        );
      })}
    </Box>
  );
};

export default OptionPills;
