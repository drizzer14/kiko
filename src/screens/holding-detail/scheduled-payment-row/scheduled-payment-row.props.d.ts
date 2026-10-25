import type { Currency } from '@kiko/currency/currency';
import type { StyleProp, ViewStyle } from 'react-native';
import type { UpcomingLoanInstallment } from '@kiko/holdings/loan-ledger';

export type ScheduledPaymentRowProps = {
  installment: UpcomingLoanInstallment;
  currency: Currency;
  // Forwarded to the card, so the list can dim it like any other estimate.
  style?: StyleProp<ViewStyle>;
};
