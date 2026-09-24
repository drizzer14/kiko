import type { ReactElement } from 'react';
import { useState } from 'react';

import Box from '../box';
import Text from '../text';
import BottomSheet from '../bottom-sheet';
import FieldTrigger from '../field-trigger';
import SelectableRow from '../selectable-row';

import type { SelectFieldProps } from './select-field.props';

// The generic "labeled field that opens a picker sheet" family
// (`FieldTrigger` + `BottomSheet` + a `SelectableRow` per option) —
// `AccountKindField`, `ModeSelectField`, and `BankTypeField`
// (`src/screens/forms/`) all hand-rolled this exact shape independently; this
// is the one shared implementation the codebase-review round (decision 24)
// asked for, so a NEW long-list select (property category, loan kind, bond
// coupon frequency) reaches for this rather than a fourth hand-rolled copy.
// Generic over the option type, so it is a plain function component (an `FC`
// cannot carry a type parameter) — mirrors `ChipRow`'s own shape.
const SelectField = <Option extends string>({
  label,
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
  sheetTestID,
}: SelectFieldProps<Option>): ReactElement => {
  const [open, setOpen] = useState(false);

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
        icon={selected === null ? undefined : icons?.[selected]}
        value={selected === null ? placeholder : labels[selected]}
        valueTone={selected === null ? 'textSecondary' : 'textPrimary'}
        error={error}
        testID={testID}
      />

      <BottomSheet
        visible={open}
        onDismiss={() => setOpen(false)}
        gap={2}
        header={<Text variant="heading">{label}</Text>}
        testID={sheetTestID}
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
              testID={`${testID}-option-${option}`}
              description={
                subtitle === undefined ? undefined : (
                  <Text variant="caption" tone={isSelected ? 'onAccent' : 'textSecondary'}>
                    {subtitle}
                  </Text>
                )
              }
            />
          );
        })}
      </BottomSheet>
    </Box>
  );
};

export default SelectField;
