import type { Currency } from '@kiko/currency/currency';
import type { LoanInstallment } from '@kiko/holdings/loan-schedule';

export type UpcomingPaymentRowProps = {
  installment: LoanInstallment;
  currency: Currency;
};
