import { type ReactElement, useState } from 'react';
import { Pressable } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import BottomSheet from '../../../design-system/components/bottom-sheet';
import Box from '../../../design-system/components/box';
import SymbolIcon from '../../../design-system/components/symbol';
import Text from '../../../design-system/components/text';

import type { HoldingSelectFieldProps } from './holding-select-field.props';
import { styles } from './holding-select-field.styles';

// A labeled single-select holding picker for the Exchange "To" field: the
// field shows the current selection (its SF Symbol + name, or a placeholder
// when none) and opens a bottom sheet listing every given option as a
// vertical row. One choice; the selected row is tinted accent and carries a
// trailing checkmark, then the sheet closes on pick. Mirrors CategoryField's
// field-plus-sheet chrome so every form picker reads as one family. Purely
// presentational — the caller (the exchange form) builds and filters the
// option list; this component only renders what it is given.
const HoldingSelectField = ({
  label,
  placeholder,
  options,
  selectedId,
  onSelect,
}: HoldingSelectFieldProps): ReactElement => {
  const { theme } = useUnistyles();
  const [open, setOpen] = useState(false);

  const selected = options.find((option) => option.id === selectedId) ?? null;

  const handleSelect = (id: string): void => {
    onSelect(id);
    setOpen(false);
  };

  return (
    <Box gap={1}>
      <Text variant="caption" tone="textSecondary">
        {label}
      </Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => setOpen(true)}
      >
        <Box direction="row" gap={2} style={styles.field}>
          {selected && (
            <SymbolIcon
              name={selected.icon}
              size={18}
              tone="textSecondary"
              color={selected.color}
            />
          )}

          <Text variant="body" tone={selected ? 'textPrimary' : 'textSecondary'}>
            {selected?.name ?? placeholder}
          </Text>

          {selected && (
            // The right-push is a LAYOUT concern, so it sits on a Box rather
            // than on Text — `TextProps['style']` deliberately admits only
            // typography keys (fontSize/fontWeight/textAlign/textTransform),
            // because `tone`/`variant` must stay the authority on appearance.
            // Same shape as the selected row's `checkmark` Box below.
            //
            // NOTE: this moved `fieldAccount` one node UP. Text forwards `style`
            // straight to RNText, so the caption WAS already right-pushed before
            // — the push now applies to this wrapper instead. The component test
            // pins the wrapper's `marginLeft: 'auto'` so a refactor cannot
            // flatten the Box away and silently lose the alignment.
            <Box style={styles.fieldAccount}>
              <Text variant="caption" tone="textSecondary">
                {selected.accountName}
              </Text>
            </Box>
          )}
        </Box>
      </Pressable>

      <BottomSheet visible={open} onDismiss={() => setOpen(false)} gap={2}>
        <Text variant="heading">{label}</Text>

        {options.map((option) => {
          const isSelected = option.id === selectedId;

          return (
            <Pressable
              key={option.id}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={`${option.name}, ${option.accountName}`}
              onPress={() => handleSelect(option.id)}
              style={[
                styles.option,
                { backgroundColor: isSelected ? theme.colors.accent : 'transparent' },
              ]}
            >
              {isSelected ? (
                // The selected row sits on the accent fill, so its glyph reads
                // white (tone) to match the checkmark below — SymbolIcon's
                // `color` overrides `tone`, so it must be omitted here.
                <SymbolIcon name={option.icon} size={18} tone="textPrimary" />
              ) : (
                <SymbolIcon name={option.icon} size={18} color={option.color} />
              )}

              <Box style={styles.optionText}>
                <Text variant="body">{option.name}</Text>
                <Text variant="caption" tone={isSelected ? 'textPrimary' : 'textSecondary'}>
                  {`${option.accountName} · ${option.currency}`}
                </Text>
              </Box>

              {isSelected && (
                <Box style={styles.checkmark}>
                  <SymbolIcon name="checkmark" size={16} tone="textPrimary" />
                </Box>
              )}
            </Pressable>
          );
        })}
      </BottomSheet>
    </Box>
  );
};

export default HoldingSelectField;
