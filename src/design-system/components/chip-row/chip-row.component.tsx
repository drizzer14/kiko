import { Pressable } from 'react-native';
import type { ReactElement } from 'react';
import { useUnistyles } from 'react-native-unistyles';
import { CHIP_GAP_STEP, CHIP_TAP_INSET } from '@kiko/design-system/chip-geometry';

import Box from '../box';
import Text from '../text';
import FieldLabel from '../field-label';

import { styles } from './chip-row.styles';
import type { ChipRowProps, ChipRowSelection } from './chip-row.props';

// The chip's visible height sits below the 44pt HIG tap-target floor on
// purpose (the compact chip look). This hitSlop restores the 44pt tap target
// the same way Button's `small` size does.
const CHIP_HIT_SLOP = { top: CHIP_TAP_INSET, bottom: CHIP_TAP_INSET } as const;

type ResolvedSelection<Option extends string | number> = {
  isSelected: (option: Option) => boolean;
  press: (option: Option) => void;
};

// Both modes share one chip look, so only "is this chip on" and "who hears the
// tap" differ; resolving them once keeps the chip markup mode-agnostic.
const resolveSelection = <Option extends string | number>(
  selection: ChipRowSelection<Option>,
): ResolvedSelection<Option> => {
  if (selection.selectedValues !== undefined) {
    const { selectedValues, onToggle } = selection;

    return { isSelected: (option) => selectedValues.includes(option), press: onToggle };
  }

  const { selected, onSelect } = selection;

  return { isSelected: (option) => selected === option, press: onSelect };
};

// A labeled chip row: the kind and currency pickers are otherwise identical
// Pressable/Text JSX, so this reusable component renders either from its
// options and selection props instead of duplicating the markup. It is
// single-select (`selected`/`onSelect`) or multi-select
// (`selectedValues`/`onToggle`) with the same chip look. An optional `labels`
// map humanizes id-like values (term_deposit -> Term Deposit) for display while
// the callback keeps reporting the underlying value; an optional `label`
// renders a caption above the chips so it reads as a labeled field. This is the
// ONE wrap-flow chips component in the app — a value selection that leaves the
// form the same (see the SegmentedControl entry in kiko-design-system for the
// tabs-vs-chips split); an equal-column day grid is DayOfMonthGrid instead.
const ChipRow = <Option extends string | number>(props: ChipRowProps<Option>): ReactElement => {
  const { options, label, labels, labelVariant = 'body' } = props;
  const { theme } = useUnistyles();
  const { isSelected: isOptionSelected, press } = resolveSelection(props);

  return (
    <Box gap={1}>
      {label !== undefined && <FieldLabel label={label} />}

      <Box style={styles.chipRow} gap={CHIP_GAP_STEP}>
        {options.map((option) => {
          const isSelected = isOptionSelected(option);

          return (
            <Pressable
              key={option}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              onPress={() => press(option)}
              hitSlop={CHIP_HIT_SLOP}
              style={[
                styles.chip,
                // The native iOS filter-chip look: accent fill once selected,
                // else the faint neutral fill (never a solid dark surface).
                { backgroundColor: isSelected ? theme.colors.accent : theme.colors.neutralSubtle },
              ]}
            >
              <Text variant={labelVariant} tone={isSelected ? 'onAccent' : 'textPrimary'}>
                {labels?.[option] ?? option}
              </Text>
            </Pressable>
          );
        })}
      </Box>
    </Box>
  );
};

export default ChipRow;
