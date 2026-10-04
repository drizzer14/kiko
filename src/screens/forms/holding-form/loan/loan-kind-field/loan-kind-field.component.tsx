import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import { loanKindSymbol } from '@kiko/holdings/entity-symbols';
import SelectField from '@kiko/design-system/components/select-field';
import { type LoanKind, loanKinds } from '@kiko/holdings/holding-metadata';

import type { LoanKindFieldProps } from './loan-kind-field.props';

// A `debt` account's Type field IS its loan-kind picker: `loan` is that
// account kind's only holding type (`holdingTypesForAccountKind`), so a
// generic Type sheet would offer nothing but one fixed option — the kind
// itself takes the Type slot instead of sitting in its own separate field
// inside the loan section. Reuses the SAME "Type" label/sheet-title/
// placeholder catalog keys the generic `HoldingTypeField` and
// `PropertyTypeField` use, so a debt account's form still reads "Type" like
// every other account kind's holding form; never disabled (unlike the
// generic field in edit mode) — the kind stays user-editable in both create
// and edit mode.
const LoanKindField: FC<LoanKindFieldProps> = ({ selected, onSelect, testID }) => {
  const { t } = useTranslation();

  const labels: Record<LoanKind, string> = {
    mortgage: t('forms.holding.loanKind.mortgage'),
    car_loan: t('forms.holding.loanKind.carLoan'),
    consumer_loan: t('forms.holding.loanKind.consumerLoan'),
    personal: t('forms.holding.loanKind.personal'),
  };

  return (
    <SelectField
      label={t('forms.holding.type')}
      sheetTitle={t('forms.holding.typeSheetTitle')}
      options={loanKinds}
      selected={selected}
      onSelect={onSelect}
      labels={labels}
      icons={loanKindSymbol}
      placeholder={t('forms.holding.typePlaceholder')}
      testID={testID}
    />
  );
};

export default LoanKindField;
