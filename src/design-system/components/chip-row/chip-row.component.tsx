import type { ReactElement } from 'react';
import { Pressable } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import Box from '../box';
import FieldLabel from '../field-label';
import SymbolIcon from '../symbol';
import Text from '../text';

import type { ChipRowProps } from './chip-row.props';
import { styles } from './chip-row.styles';

// A labeled single-select chip row: the kind and currency pickers are otherwise
// identical Pressable/Text JSX, so this reusable component renders either from
// its options/selected/onSelect props instead of duplicating the markup. An
// optional `labels` map humanizes id-like values (term_deposit -> Term Deposit)
// for display while `onSelect` keeps reporting the underlying value; an optional
// `label` renders a caption above the chips so it reads as a labeled field.
// Codebase-review decision 24: this is now the ONE chips component — the
// former `design-system/components/option-pills` (LanguageSwitch, the
// Statistics trend-filter sheet's amount/measure pills) merged in here, in
// ChipRow's own compact look, rather than staying a second near-duplicate
// selectable-pill-row component.
const ChipRow = <Option extends string | number>({
  options,
  selected,
  onSelect,
  label,
  labels,
  icons,
  disabled = false,
  required,
  labelVariant = 'body',
}: ChipRowProps<Option>): ReactElement => {
  const { theme } = useUnistyles();

  return (
    <Box gap={1}>
      {label !== undefined && <FieldLabel label={label} required={required} />}

      <Box style={[styles.chipRow, disabled && styles.disabled]} gap={2}>
        {options.map((option) => {
          const isSelected = selected === option;
          const icon = icons?.[option];

          return (
            <Pressable
              key={option}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected, disabled }}
              disabled={disabled}
              onPress={() => onSelect(option)}
              style={[
                styles.chip,
                { backgroundColor: isSelected ? theme.colors.accent : theme.colors.surface },
              ]}
            >
              {icon !== undefined && (
                // Only the entity selects (account Kind, holding Type) pass
                // `icons`; the glyph tints like CategoryField's chip icon so it
                // reads on both the accent-selected and surface-unselected chip.
                // Selected sits on the filled accent surface, so it needs the
                // always-white `onAccent` tone — `textPrimary` flips to black on
                // light and would vanish there.
                <SymbolIcon
                  name={icon}
                  size={18}
                  tone={isSelected ? 'onAccent' : 'textSecondary'}
                />
              )}
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
