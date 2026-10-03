import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import AccountKindField, {
  accountKinds,
  useAccountKindLabels,
} from '@kiko/screens/forms/account-kind-field';
import { accountKindSymbol } from '@kiko/holdings/entity-symbols';
import { isImplicitAccountKind } from '@kiko/holdings/implicit-account';

import type { ImplicitKindFieldProps } from './implicit-kind-field.props';

// The account form's own kind field, shown on the implicit holding form so the
// two read as one form whose fields swap: the same labels, subtitles and glyphs.
// Never disabled, as picking another kind is how the user leaves this form.
const ImplicitKindField: FC<ImplicitKindFieldProps> = ({
  selected,
  onSelectImplicit,
  onSelectAccountKind,
}) => {
  const { t } = useTranslation();
  const { labels, subtitles } = useAccountKindLabels();

  return (
    <AccountKindField
      label={t('forms.account.kind')}
      sheetTitle={t('forms.account.kindSheetTitle')}
      options={accountKinds}
      selected={selected}
      onSelect={(kind) => {
        if (isImplicitAccountKind(kind)) {
          onSelectImplicit(kind);
        } else {
          onSelectAccountKind(kind);
        }
      }}
      labels={labels}
      subtitles={subtitles}
      icons={accountKindSymbol}
      disabled={false}
      testID="account-kind-field"
    />
  );
};

export default ImplicitKindField;
