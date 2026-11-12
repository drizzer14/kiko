import type { FC } from 'react';
import { Money } from '@kiko/currency/money';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '@kiko/currency/format';
import Box from '@kiko/design-system/components/box';
import Text from '@kiko/design-system/components/text';
import { activeLocale } from '@kiko/i18n/active-locale';
import { rowsHeldByBalance } from '@kiko/statistics/holding-value-at';

import { notListedKeyOf } from './not-listed-key';
import { styles } from './exchange-history-footer.styles';
import { showsEarlierHistory } from './shows-earlier-history';
import type { ExchangeHistoryFooterProps } from './exchange-history-footer.props';

// What the balance holds beyond the rows it holds: the opening balance the Statistics net-worth
// series derives from the same rows (`rowsHeldByBalance`, one rule for both), so the line and that
// series never disagree. Zero shows no line.
const ExchangeHistoryFooter: FC<ExchangeHistoryFooterProps> = ({
  holding,
  account,
  transactions,
}) => {
  const { t } = useTranslation();
  const notListedKey = notListedKeyOf(holding, account);

  if (notListedKey === undefined) {
    return null;
  }

  const earlierMinorUnits =
    holding.balanceMinorUnits -
    rowsHeldByBalance(holding, transactions).reduce((sum, row) => sum + row.amountMinorUnits, 0);

  return (
    <Box gap={2} style={styles.root}>
      {showsEarlierHistory(account) && earlierMinorUnits !== 0 && (
        <Text variant="caption" tone="textSecondary">
          {t('holdingDetail.earlierHistory', {
            amount: formatMoney(Money.of(holding.currency, earlierMinorUnits), activeLocale()),
          })}
        </Text>
      )}

      <Text variant="caption" tone="textSecondary">
        {t(notListedKey)}
      </Text>
    </Box>
  );
};

export default ExchangeHistoryFooter;
