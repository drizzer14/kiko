import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import { accountKindSymbol } from '@kiko/holdings/entity-symbols';
import SelectField from '@kiko/design-system/components/select-field';

import type { AccountKindFieldProps } from './account-kind-field.props';
import { accountKinds, useAccountKindLabels } from './use-account-kind-labels';

// The account-kind selector: a thin wrapper over the shared design-system
// `SelectField`, so this field stays one implementation with every other
// long-list select rather than its own hand-rolled
// FieldTrigger+BottomSheet+SelectableRow copy. `selected` is always a
// concrete `AccountKind` (never `null` — an account always has one), so
// `placeholder` is resolved here since it is never shown.
const AccountKindField: FC<AccountKindFieldProps> = ({
  selected,
  onSelect,
  onSelectClosed,
  disabled,
}) => {
  const { t } = useTranslation();
  const { labels, subtitles } = useAccountKindLabels();

  return (
    <SelectField
      label={t('forms.account.kind')}
      sheetTitle={t('forms.account.kindSheetTitle')}
      options={accountKinds}
      selected={selected}
      onSelect={onSelect}
      onSelectClosed={onSelectClosed}
      labels={labels}
      subtitles={subtitles}
      icons={accountKindSymbol}
      placeholder={t('forms.account.kindPlaceholder')}
      disabled={disabled}
      testID="account-kind-field"
    />
  );
};

export default AccountKindField;
