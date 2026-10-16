import { useTranslation } from 'react-i18next';
import { type FC, memo, useState } from 'react';
import Box from '@kiko/design-system/components/box';
import Text from '@kiko/design-system/components/text';
import ExpandToggle from '@kiko/design-system/components/expand-toggle';

import UpcomingPaymentRow from './upcoming-payment-row';
import type { UpcomingPaymentsProps } from './upcoming-payments.props';

// A 30-year mortgage lists up to 360 payments, so only the next year of them is drawn until
// the user asks for the rest.
const UPCOMING_PAYMENT_PREVIEW_COUNT = 12;

// Every remaining scheduled payment of a loan, one ledger-style card each. The section sits in
// the ledger's header, so it is a plain stack, not a nested list. Memoized so a screen render
// does not re-draw the cards.
const UpcomingPayments: FC<UpcomingPaymentsProps> = ({ installments, currency }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  if (installments.length === 0) {
    return null;
  }

  const shown = expanded ? installments : installments.slice(0, UPCOMING_PAYMENT_PREVIEW_COUNT);

  return (
    <Box gap={2} testID="upcoming-payments">
      <Text variant="heading">{t('holdingDetail.upcomingPayments')}</Text>

      {shown.map((installment) => (
        <UpcomingPaymentRow key={installment.index} installment={installment} currency={currency} />
      ))}

      {installments.length > UPCOMING_PAYMENT_PREVIEW_COUNT && (
        <ExpandToggle
          expanded={expanded}
          onPress={() => setExpanded((isExpanded) => !isExpanded)}
          testID="upcoming-payments-toggle"
        />
      )}
    </Box>
  );
};

export default memo(UpcomingPayments);
