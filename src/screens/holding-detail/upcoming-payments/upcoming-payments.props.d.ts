import type { Currency } from '@kiko/currency/currency';
import type { UpcomingLoanInstallment } from '@kiko/holdings/loan-ledger';

export type UpcomingPaymentsProps = {
  installments: readonly UpcomingLoanInstallment[];
  currency: Currency;
};
