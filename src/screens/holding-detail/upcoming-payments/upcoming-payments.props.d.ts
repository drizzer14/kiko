import type { Currency } from '@kiko/currency/currency';
import type { LoanInstallment } from '@kiko/holdings/loan-schedule';

export type UpcomingPaymentsProps = {
  installments: readonly LoanInstallment[];
  currency: Currency;
};
