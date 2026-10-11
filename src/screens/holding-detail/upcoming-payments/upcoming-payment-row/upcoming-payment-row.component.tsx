import { type FC, memo } from 'react';
import { formatDate } from '@kiko/dates';
import { Money } from '@kiko/currency/money';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '@kiko/currency/format';
import Box from '@kiko/design-system/components/box';
import { activeLocale } from '@kiko/i18n/active-locale';
import EntryCard from '@kiko/design-system/components/entry-card';
import MoneyText from '@kiko/design-system/components/money-text';
import EntryDateHeader from '@kiko/design-system/components/entry-date-header';

import type { UpcomingPaymentRowProps } from './upcoming-payment-row.props';

// One scheduled loan payment as a ledger entry: its due date above a card of the payment, a
// "Scheduled" marker, and the principal / interest split. Memoized, since a 30-year mortgage
// can show 360 of them and an unrelated screen render must not re-draw each one.
const UpcomingPaymentRow: FC<UpcomingPaymentRowProps> = ({ installment, currency }) => {
  const { t } = useTranslation();
  const dueDate = formatDate(installment.dueDate);
  const title = t('holdingDetail.loanPayment');
  const payment = Money.of(currency, installment.paymentMinorUnits);
  const marker = t('holdingDetail.scheduled');
  const split = t('holdingDetail.paymentSplit', {
    principal: formatMoney(Money.of(currency, installment.principalMinorUnits), activeLocale()),
    interest: formatMoney(Money.of(currency, installment.interestMinorUnits), activeLocale()),
  });

  // One VoiceOver stop per installment, read in the order the row is drawn, built from the
  // already translated parts.
  const accessibilityLabel = [
    dueDate,
    title,
    formatMoney(payment, activeLocale()),
    marker,
    split,
  ].join(', ');

  return (
    <Box accessible accessibilityLabel={accessibilityLabel}>
      <EntryDateHeader title={dueDate} />

      <EntryCard
        testID={`upcoming-payment-${installment.index}`}
        label={title}
        amount={<MoneyText money={payment} tone="negative" />}
        footerLines={[marker, split]}
      />
    </Box>
  );
};

export default memo(UpcomingPaymentRow);
