import type { Currency } from '@kiko/currency/currency';
import type { UpcomingLoanInstallment } from '@kiko/holdings/loan-ledger';

export type UpcomingPaymentRowProps = {
  installment: UpcomingLoanInstallment;
  currency: Currency;
};
