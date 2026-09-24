import type { FC } from 'react';
import { useTranslation } from 'react-i18next';

import SelectField from '../../../design-system/components/select-field';

import type { HoldingTypeFieldProps } from './holding-type-field.props';

// The holding-type selector: a thin wrapper over the shared design-system
// `SelectField`, mirroring `AccountKindField` — a select sheet rather than a
// `ChipRow`, since holding-type labels (e.g. "Строковий депозит") run too
// wide for a chip row, the same label-width reasoning that moved the
// property-category and loan-kind pickers onto `SelectField`. `selected` is
// always a concrete `HoldingType` (never `null` — a holding always has one),
// so `placeholder` is resolved here (not threaded through the caller) since
// it is never shown.
const HoldingTypeField: FC<HoldingTypeFieldProps> = ({
  options,
  selected,
  onSelect,
  labels,
  icons,
  disabled,
  testID,
}) => {
  const { t } = useTranslation();

  return (
    <SelectField
      label={t('forms.holding.type')}
      sheetTitle={t('forms.holding.typeSheetTitle')}
      options={options}
      selected={selected}
      onSelect={onSelect}
      labels={labels}
      icons={icons}
      placeholder={t('forms.holding.typePlaceholder')}
      disabled={disabled}
      testID={testID}
    />
  );
};

export default HoldingTypeField;
