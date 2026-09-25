import type { FC } from 'react';
import { useTranslation } from 'react-i18next';

import { currencySymbol } from '../../../../../currency/currency';
import { groupAmount } from '../../../amount-format/amount-format';
import TextField from '../../../../../design-system/components/text-field';

import type { BalanceFormBlockProps } from './balance-form-block.props';

// The opening-balance field shared by every ledgered type (card, cash,
// crypto_asset, jar). A synced (Monobank) holding's balance is owned by the
// sync, so this renders nothing in that case.
const BalanceFormBlock: FC<BalanceFormBlockProps> = ({ fields, isSyncedEdit }) => {
  const { t } = useTranslation();

  if (isSyncedEdit) {
    return null;
  }

  return (
    <TextField
      label={t('forms.holding.balance')}
      value={fields.openingBalance}
      onChangeText={(text) => fields.setOpeningBalance(groupAmount(text))}
      keyboardType="decimal-pad"
      placeholder={t('forms.holding.balancePlaceholder')}
      suffix={currencySymbol[fields.currency]}
    />
  );
};

export default BalanceFormBlock;
