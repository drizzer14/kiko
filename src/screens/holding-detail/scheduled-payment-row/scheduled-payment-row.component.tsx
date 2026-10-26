import { type FC, memo } from 'react';
import { Money } from '@kiko/currency/money';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '@kiko/currency/format';
import Box from '@kiko/design-system/components/box';
import { activeLocale } from '@kiko/i18n/active-locale';
import EntryCard from '@kiko/design-system/components/entry-card';
import MoneyText from '@kiko/design-system/components/money-text';

import { paymentSplitText } from '../payment-split-text';

import type { ScheduledPaymentRowProps } from './scheduled-payment-row.props';

// One scheduled loan payment as a ledger entry, titled "Loan payment" with "Scheduled" as its
// subtitle like a projected row, with the principal / interest split and the balance left once it
// is paid. Its day header comes from the list it sits in, and a due date has no time, so the card
// has no caption under the amount. Memoized, since a 30-year mortgage can show 360 of them and an
// unrelated screen render must not re-draw each one.
const ScheduledPaymentRow: FC<ScheduledPaymentRowProps> = ({ installment, currency, style }) => {
  const { t } = useTranslation();
  const title = t('holdingDetail.loanPayment');
  const subtitle = t('holdingDetail.scheduled');
  // Signed like a linked payment: money leaving the user is negative, so MoneyText draws it red
  // with the minus and the label below reads it the same way.
  const payment = Money.of(currency, installment.paymentMinorUnits).negate();
  const split = paymentSplitText(
    t,
    currency,
    installment.principalMinorUnits,
    installment.interestMinorUnits,
  );
  const remaining = t('holdingDetail.remainingBalance', {
    amount: formatMoney(Money.of(currency, installment.remainderMinorUnits), activeLocale()),
  });

  // One VoiceOver stop per installment, read in the order the row is drawn, built from the
  // already translated parts.
  const accessibilityLabel = [
    title,
    subtitle,
    formatMoney(payment, activeLocale()),
    split,
    remaining,
  ].join(', ');

  return (
    <Box accessible accessibilityLabel={accessibilityLabel}>
      <EntryCard
        testID={`scheduled-payment-${installment.index}`}
        label={title}
        subtitle={subtitle}
        style={style}
        amount={<MoneyText money={payment} context="transaction" />}
        footerLines={[split, remaining]}
      />
    </Box>
  );
};

export default memo(ScheduledPaymentRow);
