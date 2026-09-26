import { type FC, memo } from 'react';
import { formatDate } from '@kiko/dates';
import { Money } from '@kiko/currency/money';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '@kiko/currency/format';
import Box from '@kiko/design-system/components/box';
import Text from '@kiko/design-system/components/text';
import { activeLocale } from '@kiko/i18n/active-locale';
import MoneyText from '@kiko/design-system/components/money-text';
import SummaryTable from '@kiko/design-system/components/summary-table';

import { styles } from './upcoming-payments.styles';
import type { UpcomingPaymentsProps } from './upcoming-payments.props';

// Every remaining scheduled payment of a loan, one `SummaryTable` row each:
// its due date, its payment, and that payment's principal / interest split.
// Memoized, since a 30-year mortgage lists up to 360 rows inside the
// ledger's header and they must not re-render with every screen render.
const UpcomingPayments: FC<UpcomingPaymentsProps> = ({ installments, currency }) => {
  const { t } = useTranslation();

  if (installments.length === 0) {
    return null;
  }

  const money = (minorUnits: number): Money => Money.of(currency, minorUnits);

  return (
    <SummaryTable
      title={t('holdingDetail.upcomingPayments')}
      testID="upcoming-payments"
      rows={installments.map((installment) => ({
        key: String(installment.index),
        label: formatDate(installment.dueDate),
        testID: `upcoming-payment-${installment.index}`,
        value: (
          <Box style={styles.value}>
            <MoneyText money={money(installment.paymentMinorUnits)} />
            <Text variant="caption" tone="textSecondary">
              {t('holdingDetail.paymentSplit', {
                principal: formatMoney(money(installment.principalMinorUnits), activeLocale()),
                interest: formatMoney(money(installment.interestMinorUnits), activeLocale()),
              })}
            </Text>
          </Box>
        ),
      }))}
    />
  );
};

export default memo(UpcomingPayments);
