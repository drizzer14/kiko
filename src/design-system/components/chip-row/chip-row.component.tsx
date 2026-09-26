import { Pressable } from 'react-native';
import type { ReactElement } from 'react';
import { useUnistyles } from 'react-native-unistyles';

import Box from '../box';
import Text from '../text';
import FieldLabel from '../field-label';

import { styles } from './chip-row.styles';
import type { ChipRowProps } from './chip-row.props';

// The chip's visible height sits below the 44pt HIG tap-target floor on
// purpose (the compact chip look). This hitSlop restores the 44pt tap target
// the same way Button's `small` size does: (44 - 34) / 2 = 5pt per edge.
const CHIP_HIT_SLOP = { top: 5, bottom: 5 } as const;

// A labeled single-select chip row: the kind and currency pickers are otherwise
// identical Pressable/Text JSX, so this reusable component renders either from
// its options/selected/onSelect props instead of duplicating the markup. An
// optional `labels` map humanizes id-like values (term_deposit -> Term Deposit)
// for display while `onSelect` keeps reporting the underlying value; an optional
// `label` renders a caption above the chips so it reads as a labeled field. This
// is the ONE chips component in the app — a value selection that leaves the
// form the same (see the SegmentedControl entry in kiko-design-system for the
// tabs-vs-chips split).
const ChipRow = <Option extends string | number>({
  options,
  selected,
  onSelect,
  label,
  labels,
  labelVariant = 'body',
}: ChipRowProps<Option>): ReactElement => {
  const { theme } = useUnistyles();

  return (
    <Box gap={1}>
      {label !== undefined && <FieldLabel label={label} />}

      <Box style={styles.chipRow} gap={2}>
        {options.map((option) => {
          const isSelected = selected === option;

          return (
            <Pressable
              key={option}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              onPress={() => onSelect(option)}
              hitSlop={CHIP_HIT_SLOP}
              style={[
                styles.chip,
                { backgroundColor: isSelected ? theme.colors.accent : theme.colors.surface },
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
