import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import SelectField from '@kiko/design-system/components/select-field';

import type { AccountKindFieldProps } from './account-kind-field.props';

// The account-kind selector: a thin wrapper over the shared design-system
// `SelectField`, so this field stays one implementation with every other
// long-list select rather than its own hand-rolled
// FieldTrigger+BottomSheet+SelectableRow copy. `selected` is always a
// concrete `AccountKind` (never `null` — an account always has one), so
// `placeholder` is resolved here (not threaded through the caller, unlike
// `label`/`sheetTitle`) since it is never shown.
const AccountKindField: FC<AccountKindFieldProps> = ({
  label,
  sheetTitle,
  options,
  selected,
  onSelect,
  labels,
  subtitles,
  icons,
  disabled,
  testID,
}) => {
  const { t } = useTranslation();

  return (
    <SelectField
      label={label}
      sheetTitle={sheetTitle}
      options={options}
      selected={selected}
      onSelect={onSelect}
      labels={labels}
      subtitles={subtitles}
      icons={icons}
      placeholder={t('forms.account.kindPlaceholder')}
      disabled={disabled}
      testID={testID}
    />
  );
};

export default AccountKindField;
