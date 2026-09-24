import type { ReactElement } from 'react';
import { Pressable } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import Box from '../box';
import Text from '../text';
import SymbolIcon from '../symbol';
import FieldLabel from '../field-label';

import type { ChipRowProps } from './chip-row.props';
import { styles } from './chip-row.styles';

// The compact (`labelVariant="caption"`) chip's visible height sits below the
// 44pt HIG tap-target floor on purpose, so it reads as clearly smaller around
// a caption label sitting under its own larger section label. This hitSlop
// restores the 44pt tap target the same way Button's `small` size does:
// (44 - 34) / 2 = 5pt per edge.
const CAPTION_HIT_SLOP = { top: 5, bottom: 5 } as const;

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
  icons,
  disabled = false,
  required,
  labelVariant = 'body',
}: ChipRowProps<Option>): ReactElement => {
  const { theme } = useUnistyles();
  // Only the caption label variant compacts the chip (a value sitting under
  // its own larger section label); the default body sizing stays exactly as
  // it was, so every pre-existing ChipRow consumer is unaffected.
  const isCompact = labelVariant === 'caption';

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
              // The compact chip's visible height sits below the 44pt HIG
              // floor on purpose (see CAPTION_HIT_SLOP above); this hitSlop
              // restores the tap target. The default (body) chip already
              // holds 44pt via its own minHeight, so it needs none.
              hitSlop={isCompact ? CAPTION_HIT_SLOP : undefined}
              style={[
                styles.chip,
                isCompact && styles.chipCompact,
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
                  // The icon size pairs with the label's own type step (never
                  // an inline literal) — theme.iconSizes is keyed by the same
                  // step names as theme.typography.
                  size={theme.iconSizes[labelVariant]}
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
