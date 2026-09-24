import { useState } from 'react';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import Text from '../../../design-system/components/text';
import BottomSheet from '../../../design-system/components/bottom-sheet';
import FieldTrigger from '../../../design-system/components/field-trigger';
import SelectableRow from '../../../design-system/components/selectable-row';

import type { ColumnSelectFieldProps } from './column-select-field.props';

/**
 * The column-mapping screen's shared "pick one" field: a `FieldTrigger` that
 * opens a `BottomSheet` listing `options` as `SelectableRow`s. Generic over
 * the option value type (a header-row cell's column INDEX for every column
 * role, or a fixed `DateFormatId` string for the date-format field), so it
 * is a plain function component (an `FC` cannot carry a type parameter,
 * mirroring `OptionPills`). `allowNotUsed` adds a trailing "Not used" row
 * that selects `undefined` — only meaningful for an OPTIONAL role (the
 * counterparty column); a required field omits it.
 */
const ColumnSelectField = <T extends string | number>({
  label,
  options,
  selected,
  onSelect,
  allowNotUsed = false,
  required = false,
  placeholder,
  error,
  testID,
}: ColumnSelectFieldProps<T>): ReactElement => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const selectedOption = options.find((option) => option.value === selected);

  const handleSelect = (value: T | undefined): void => {
    onSelect(value);
    setOpen(false);
  };

  return (
    <>
      <FieldTrigger
        label={label}
        required={required}
        onPress={() => setOpen(true)}
        value={selectedOption ? selectedOption.label : placeholder}
        valueTone={selectedOption ? 'textPrimary' : 'textSecondary'}
        error={error}
        testID={testID}
      />

      <BottomSheet
        visible={open}
        onDismiss={() => setOpen(false)}
        header={<Text variant="heading">{label}</Text>}
        testID={testID ? `${testID}-sheet` : undefined}
      >
        {options.map((option) => (
          <SelectableRow
            key={String(option.value)}
            selected={option.value === selected}
            onPress={() => handleSelect(option.value)}
            label={option.label}
            testID={testID ? `${testID}-option-${option.value}` : undefined}
          />
        ))}

        {allowNotUsed && (
          <SelectableRow
            selected={selected === undefined}
            onPress={() => handleSelect(undefined)}
            label={t('columnMapping.notUsed')}
            testID={testID ? `${testID}-not-used` : undefined}
          />
        )}
      </BottomSheet>
    </>
  );
};

export default ColumnSelectField;
