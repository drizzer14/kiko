import maybe, { foldMap } from 'fnts/maybe';
import { type ReactElement, useState } from 'react';

import Box from '../box';
import Text from '../text';
import BottomSheet from '../bottom-sheet';
import FieldTrigger from '../field-trigger';
import SelectableRow from '../selectable-row';

import type { SelectFieldProps } from './select-field.props';

// The generic "labeled field that opens a picker sheet" family
// (`FieldTrigger` + `BottomSheet` + a `SelectableRow` per option) — a NEW
// long-list select (property category, loan kind, bond coupon frequency,
// account kind, transaction type) reaches for this rather than hand-rolling
// its own copy. Generic over the option type, so it is a plain function
// component (an `FC` cannot carry a type parameter) — mirrors `ChipRow`'s
// own shape.
const SelectField = <Option extends string>({
  label,
  sheetTitle,
  options,
  selected,
  onSelect,
  labels,
  subtitles,
  icons,
  placeholder,
  required,
  disabled,
  error,
  testID,
}: SelectFieldProps<Option>): ReactElement => {
  const [open, setOpen] = useState(false);
  const selectedOption = maybe(selected);

  const handleSelect = (option: Option): void => {
    setOpen(false);
    onSelect(option);
  };

  return (
    <Box gap={1}>
      <FieldTrigger
        label={label}
        required={required}
        disabled={disabled}
        onPress={() => setOpen(true)}
        icon={foldMap(selectedOption, (option) => icons?.[option])}
        value={foldMap(selectedOption, (option) => labels[option]) ?? placeholder}
        valueTone={selected === null ? 'textSecondary' : 'textPrimary'}
        error={error}
        testID={testID}
      />

      <BottomSheet
        visible={open}
        onDismiss={() => setOpen(false)}
        gap={2}
        header={<Text variant="heading">{sheetTitle}</Text>}
      >
        {options.map((option) => {
          const isSelected = option === selected;
          const subtitle = subtitles?.[option];

          return (
            <SelectableRow
              key={option}
              selected={isSelected}
              onPress={() => handleSelect(option)}
              label={labels[option]}
              icon={icons?.[option]}
              accessibilityLabel={
                subtitle === undefined ? labels[option] : `${labels[option]}. ${subtitle}`
              }
              testID={testID ? `${testID}-option-${option}` : undefined}
              description={foldMap(maybe(subtitle), (found) => (
                <Text variant="caption" tone={isSelected ? 'onAccent' : 'textSecondary'}>
                  {found}
                </Text>
              ))}
            />
          );
        })}
      </BottomSheet>
    </Box>
  );
};

export default SelectField;
