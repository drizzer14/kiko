import { type ReactElement, useState } from 'react';
import Box from '@kiko/design-system/components/box';
import Text from '@kiko/design-system/components/text';
import BottomSheet from '@kiko/design-system/components/bottom-sheet';
import FieldTrigger from '@kiko/design-system/components/field-trigger';
import SelectableRow from '@kiko/design-system/components/selectable-row';

import { styles } from './holding-select-field.styles';
import type { HoldingSelectFieldProps } from './holding-select-field.props';

// A labeled single-select holding picker for the Exchange "To" field: the
// field shows the current selection (its SF Symbol + name, or a placeholder
// when none) and opens a bottom sheet listing every given option as a
// `SelectableRow` — the shared single-select row, with its own leading
// checkmark when selected. One choice; the sheet closes on pick. Mirrors
// CategoryField's field-plus-sheet chrome so every form picker reads as one
// family. Purely presentational — the caller (the exchange form) builds and
// filters the option list; this component only renders what it is given.
const HoldingSelectField = ({
  label,
  sheetTitle,
  placeholder,
  options,
  selectedId,
  onSelect,
  required,
  error,
  invalid,
}: HoldingSelectFieldProps): ReactElement => {
  const [open, setOpen] = useState(false);

  const selected = options.find((option) => option.id === selectedId) ?? null;

  const handleSelect = (id: string): void => {
    onSelect(id);
    setOpen(false);
  };

  return (
    <Box gap={1}>
      <FieldTrigger
        label={label}
        required={required}
        error={error}
        invalid={invalid}
        onPress={() => setOpen(true)}
        icon={selected?.icon}
        iconColor={selected?.color}
        value={selected?.name ?? placeholder}
        valueTone={selected ? 'textPrimary' : 'textSecondary'}
        trailing={
          selected && (
            // The right-push is a LAYOUT concern, so it sits on a Box rather
            // than on Text — `TextProps['style']` deliberately admits only
            // typography keys (fontSize/fontWeight/textAlign/textTransform),
            // because `tone`/`variant` must stay the authority on styling.
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
          )
        }
      />

      <BottomSheet
        visible={open}
        onDismiss={() => setOpen(false)}
        gap={2}
        header={<Text variant="heading">{sheetTitle}</Text>}
      >
        {options.map((option) => {
          const isSelected = option.id === selectedId;

          return (
            <SelectableRow
              key={option.id}
              selected={isSelected}
              onPress={() => handleSelect(option.id)}
              label={option.name}
              icon={option.icon}
              iconColor={option.color}
              accessibilityLabel={`${option.name}, ${option.accountName}`}
              description={
                <Text variant="caption" tone={isSelected ? 'onAccent' : 'textSecondary'}>
                  {`${option.accountName} · ${option.currency}`}
                </Text>
              }
            />
          );
        })}
      </BottomSheet>
    </Box>
  );
};

export default HoldingSelectField;
