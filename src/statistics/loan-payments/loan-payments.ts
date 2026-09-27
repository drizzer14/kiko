import type { HoldingRow } from '@kiko/db';
import maybe, { foldMap } from 'fnts/maybe';
import type { Currency } from '@kiko/currency/currency';
import { asLoanMeta } from '@kiko/holdings/holding-metadata';
import { loanInterestPerPaymentMinor } from '@kiko/holdings/loan-schedule';

import type { TrendTransaction } from '../category-trend';

// The seeded default category (`drizzle/migrations/0039_seed_loan_interest_category.sql`)
// every derived interest entry below is filed under.
export const LOAN_INTEREST_CATEGORY_KEY = 'loan_interest';

/** A transaction as the loan-payment pipeline needs it. */
export type LoanPaymentTransaction = {
  id: string;
  loanHoldingId: string | null;
  time: number;
  amountMinorUnits: number;
  currency: Currency;
};

/**
 * A loan holding as `loanInterestEntries` needs it — its id, its currency
 * (a link is only valid when this equals the payment's own currency — see
 * both functions below), and its raw metadata to parse.
 */
export type LoanHolding = Pick<HoldingRow, 'id' | 'metadata' | 'currency'>;

/**
 * The ids of every transaction that is a LINKED loan payment whose loan
 * holding still exists AND is in the SAME currency as the payment
 * ("interest-only spending"): the caller drops these from the raw
 * spending pie/trend and replaces each one with its own `loanInterestEntries`
 * row (the interest portion only), so a linked loan payment's PRINCIPAL
 * never counts as spending and its INTEREST counts once, under its own
 * category.
 *
 * A dangling `loanHoldingId` — or, the same defensive shape, one whose
 * loan holding exists but is in a
 * DIFFERENT currency than the payment — is NOT excluded here:
 * `holdingsRepo.remove`/`accountsRepo.remove` clear a dangling link
 * transactionally the moment its loan holding is deleted, and
 * `transactionsRepo.setLoanPayment` refuses a cross-currency link outright,
 * so both cases can only reach here from data written before either guard
 * existed. Either way the payment counts as ordinary spending under its own
 * category, in full, exactly like an unlinked payment — a wrong-currency
 * interest amount would otherwise be silently wrong.
 */
export const loanPaymentExcludedTransactionIds = (
  transactions: readonly Pick<LoanPaymentTransaction, 'id' | 'loanHoldingId' | 'currency'>[],
  loanHoldings: readonly Pick<LoanHolding, 'id' | 'currency'>[],
): Set<string> => {
  const currencyByLoanHoldingId = new Map(
    loanHoldings.map((holding) => [holding.id, holding.currency] as const),
  );
  const ids = new Set<string>();

  for (const transaction of transactions) {
    if (
      transaction.loanHoldingId !== null &&
      currencyByLoanHoldingId.get(transaction.loanHoldingId) === transaction.currency
    ) {
      ids.add(transaction.id);
    }
  }

  return ids;
};

/**
 * One synthetic "Loan interest" entry per linked payment whose loan still
 * exists: the payment maps to the installment whose due date is
 * NEAREST to its own local day, and the interest counted is what is left of
 * that installment's interest after the loan's earlier payments mapped to
 * it, capped at the payment's own absolute amount
 * (`loanInterestPerPaymentMinor`). A payment with 0 counted interest (an
 * informal `'none'`-schedule loan, or a payment more than one period
 * outside the schedule) produces NO entry: its whole amount was
 * already dropped by `loanPaymentExcludedTransactionIds` above, so it simply counts
 * as 0 spending rather than a stray zero-amount slice. A dangling
 * `loanHoldingId` also produces no entry — that row was
 * never excluded above, so it already counts in full under its own
 * category.
 *
 * Shaped as `TrendTransaction` (a superset of `BreakdownTransaction`) so the
 * SAME entries feed both `buildCategoryBreakdown` and the category trend
 * (statistics.screen.tsx): the id is `loan-interest:<txId>` (never collides
 * with a real transaction id), the category is the seeded `loan_interest`
 * key, and the amount is the interest as a NEGATIVE minor-units expense, in
 * the LOAN holding's own currency — `loanInterestPerPaymentMinor` computes
 * interest in that currency, which is the payment's own: a payment whose
 * currency differs from its linked loan's produces no entry at all (same
 * rule as `loanPaymentExcludedTransactionIds` above, so the row is never dropped
 * from spending without a replacement). A CREDIT (a positive amount, e.g. a
 * linked row edited into a reversal) is never interest either — only a
 * debit pays down a loan.
 */
export const loanInterestEntries = (input: {
  transactions: readonly LoanPaymentTransaction[];
  loanHoldings: readonly LoanHolding[];
}): TrendTransaction[] => {
  const { transactions, loanHoldings } = input;
  const holdingById = new Map(loanHoldings.map((holding) => [holding.id, holding] as const));
  const interests = interestByTransactionId(transactions, holdingById);

  return transactions.flatMap((transaction) => {
    const interest = interests.get(transaction.id) ?? 0;

    if (interest <= 0) {
      return [];
    }

    return [
      {
        id: `loan-interest:${transaction.id}`,
        category: LOAN_INTEREST_CATEGORY_KEY,
        amountMinorUnits: -interest,
        mcc: null,
        counterIban: null,
        description: '',
        exchangeCounterpartHoldingId: null,
        changeGroupId: null,
        currency: transaction.currency,
        time: transaction.time,
      },
    ];
  });
};

// An installment paid in parts counts its interest once across the parts, so
// interest is allocated per loan over all of that loan's counted payments,
// never one payment at a time.
const interestByTransactionId = (
  transactions: readonly LoanPaymentTransaction[],
  holdingById: ReadonlyMap<string, LoanHolding>,
): Map<string, number> => {
  const paymentsByLoan = new Map<string, LoanPaymentTransaction[]>();

  for (const transaction of transactions) {
    if (transaction.loanHoldingId === null || transaction.amountMinorUnits >= 0) {
      continue;
    }

    if (holdingById.get(transaction.loanHoldingId)?.currency !== transaction.currency) {
      continue;
    }

    const payments = paymentsByLoan.get(transaction.loanHoldingId) ?? [];

    payments.push(transaction);
    paymentsByLoan.set(transaction.loanHoldingId, payments);
  }

  return new Map(
    [...paymentsByLoan].flatMap(([loanHoldingId, payments]) => {
      const meta = asLoanMeta(holdingById.get(loanHoldingId)?.metadata);

      return (
        foldMap(maybe(meta), (found) => {
          const interests = loanInterestPerPaymentMinor(found, payments);

          return payments.map((payment, index) => [payment.id, interests[index]] as const);
        }) ?? []
      );
    }),
  );
};
