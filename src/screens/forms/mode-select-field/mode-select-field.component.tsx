import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import SelectField from '../../../design-system/components/select-field';

import type { ModeSelectFieldProps } from './mode-select-field.props';

// The transaction-TYPE selector: a thin wrapper over the shared
// design-system `SelectField`, so this field stays one implementation with
// every other long-list select rather than its own hand-rolled
// FieldTrigger+BottomSheet+SelectableRow copy. `visible` stays a CALLER-side
// gate (a convert has no mode toggle at all) rather than a `SelectField`
// concern, so this component still returns `null` itself before ever
// reaching `SelectField`. `selected` is always a concrete `FormMode` (never
// `null`), so `placeholder` is resolved here (not threaded through the
// caller) since it is never shown.
const ModeSelectField = ({
  visible,
  label,
  options,
  selected,
  onSelect,
  labels,
  icons,
  disabled,
}: ModeSelectFieldProps): ReactElement | null => {
  const { t } = useTranslation();

  if (!visible) {
    return null;
  }

  return (
    <SelectField
      label={label}
      sheetTitle={t('forms.transaction.typeSheetTitle')}
      options={options}
      selected={selected}
      onSelect={onSelect}
      labels={labels}
      icons={icons}
      placeholder={t('forms.transaction.typePlaceholder')}
      disabled={disabled}
      testID="transaction-type-field"
    />
  );
};

export default ModeSelectField;
