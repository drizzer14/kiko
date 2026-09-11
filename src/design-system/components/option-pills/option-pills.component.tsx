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

// The compact (`labelVariant="caption"`) pill's visible height (34, see
// `pillCompact` in option-pills.styles.ts) sits below the 44pt HIG tap-target
// floor on purpose, so it reads as clearly smaller around the caption label.
// This hitSlop restores the 44pt tap target the same way Button's `small` size
// does (`SMALL_HIT_SLOP`, button.component.tsx): (44 - 34) / 2 = 5pt per edge.
const COMPACT_HIT_SLOP = { top: 5, bottom: 5 } as const;

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
  labelVariant = 'body',
}: OptionPillsProps<T>): ReactElement => {
  const { theme } = useUnistyles();
  const cellWidth = { width: `${100 / columns}%` } as const;
  // Only the caption label variant compacts the pill (the trend-filter sheet's
  // value pills); the default body sizing stays exactly as it was, so the
  // settings screens (base currency, lock grace) are unaffected.
  const isCompact = labelVariant === 'caption';

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
              // The compact pill's visible height sits below the 44pt HIG floor
              // on purpose (see COMPACT_HIT_SLOP above); this hitSlop restores
              // the tap target. The default (body) pill already holds 44pt via
              // its own minHeight, so it needs none.
              hitSlop={isCompact ? COMPACT_HIT_SLOP : undefined}
              // The selected option paints a FILLED accent surface (the iOS
              // selected-segment / filter-chip treatment, mirroring ChipRow), so
              // it reads as clearly chosen even on the low-contrast sheet
              // background; the others stay transparent so the glass card behind
              // them shows through.
              style={[
                styles.pill,
                isCompact && styles.pillCompact,
                { backgroundColor: isSelected ? theme.colors.accent : 'transparent' },
              ]}
            >
              {icon !== undefined && (
                <SymbolIcon
                  name={icon(option)}
                  // The icon size pairs with the label's own type step (never
                  // an inline literal) — `theme.iconSizes` is keyed by the
                  // same step names as `theme.typography`, so a smaller
                  // `labelVariant` shrinks the glyph with it.
                  size={theme.iconSizes[labelVariant]}
                  // On the accent fill the glyph takes the always-white onAccent
                  // tone (the onAccent rule for a selected icon on an accent fill).
                  tone={isSelected ? 'onAccent' : 'textSecondary'}
                />
              )}

              <Text
                variant={labelVariant}
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
