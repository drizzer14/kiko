import { transactionsRepo } from '@kiko/transactions/repo';
import { useLiveQuery, type TransactionRow } from '@kiko/db';

// A disabled read answers with a fresh empty array on every render; this one keeps the screen's
// ledger from rebuilding for a holding that is not a loan.
const NO_PAYMENTS: readonly TransactionRow[] = Object.freeze([]);

// The transactions the matcher (or a manual pick) linked to THIS loan, newest first. A loan is
// ledgerless, so its own transactions read never finds them: a payment always lives on the payer
// holding. The read is disabled outright for every other holding type (kiko-architecture: never
// read data a disabled caller does not need).
export const useLinkedLoanPayments = (
  loanHoldingId: string,
  isLoan: boolean,
): { payments: readonly TransactionRow[]; isLoading: boolean } => {
  const { data, isLoading } = useLiveQuery(
    transactionsRepo.listLinkedToLoanQuery(loanHoldingId),
    ['transactions'],
    isLoan,
    { cached: true },
  );

  return { payments: isLoan ? data : NO_PAYMENTS, isLoading };
};
