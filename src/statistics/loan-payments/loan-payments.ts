import type { Currency } from '../../currency/currency';
import type { HoldingRow } from '../../db/schema';
import { asLoanMeta } from '../../holdings/holding-metadata';
import { loanInterestForPaymentMinor } from '../../holdings/loan-schedule';
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

/** A loan holding as `loanInterestEntries` needs it — its id plus its raw metadata to parse. */
export type LoanHolding = Pick<HoldingRow, 'id' | 'metadata'>;

/**
 * The ids of every transaction that is a LINKED loan payment whose loan
 * holding still exists (spec 5, D14 — "interest-only spending"): the caller
 * drops these from the raw spending pie/trend and replaces each one with its
 * own `loanInterestEntries` row (the interest portion only), so a linked
 * loan payment's PRINCIPAL never counts as spending and its INTEREST counts
 * once, under its own category.
 *
 * Review Focus 7 (global-constraints.md): a `loanHoldingId` pointing at a
 * holding that is not in `loanHoldings` — a dangling link — is NOT
 * excluded here. `holdingsRepo.remove`/`accountsRepo.remove` already clear
 * the link transactionally the moment its loan holding is deleted (T29), so
 * this is the belt to that braces: the payment counts as ordinary spending
 * under its own category, in full, exactly like an unlinked payment.
 */
export const loanPaymentExcludedTxIds = (
  transactions: readonly Pick<LoanPaymentTransaction, 'id' | 'loanHoldingId'>[],
  loanHoldings: readonly Pick<LoanHolding, 'id'>[],
): Set<string> => {
  const loanHoldingIds = new Set(loanHoldings.map((holding) => holding.id));
  const ids = new Set<string>();

  for (const transaction of transactions) {
    if (transaction.loanHoldingId !== null && loanHoldingIds.has(transaction.loanHoldingId)) {
      ids.add(transaction.id);
    }
  }

  return ids;
};

/**
 * One synthetic "Loan interest" entry per linked payment whose loan still
 * exists (N10b): the payment maps to the installment whose due date is
 * NEAREST to its own local day, and the interest counted is that
 * installment's interest, capped at the payment's own absolute amount
 * (`loanInterestForPaymentMinor`). A payment with 0 counted interest (an
 * informal `'none'`-schedule loan, or a payment more than one period
 * outside the schedule — M2) produces NO entry: its whole amount was
 * already dropped by `loanPaymentExcludedTxIds` above, so it simply counts
 * as 0 spending rather than a stray zero-amount slice. A dangling
 * `loanHoldingId` (Review Focus 7) also produces no entry — that row was
 * never excluded above, so it already counts in full under its own
 * category.
 *
 * Shaped as `TrendTransaction` (a superset of `BreakdownTransaction`) so the
 * SAME entries feed both `buildCategoryBreakdown` and the category trend
 * (statistics.screen.tsx): the id is `loan-interest:<txId>` (never collides
 * with a real transaction id), the category is the seeded `loan_interest`
 * key, and the amount is the interest as a NEGATIVE minor-units expense, in
 * the payment's own currency.
 */
export const loanInterestEntries = (input: {
  transactions: readonly LoanPaymentTransaction[];
  loanHoldings: readonly LoanHolding[];
}): TrendTransaction[] => {
  const { transactions, loanHoldings } = input;
  const metaById = new Map(
    loanHoldings.flatMap((holding) => {
      const meta = asLoanMeta(holding.metadata);

      return meta === null ? [] : [[holding.id, meta] as const];
    }),
  );

  return transactions.flatMap((transaction) => {
    if (transaction.loanHoldingId === null) {
      return [];
    }

    const meta = metaById.get(transaction.loanHoldingId);
    if (meta === undefined) {
      return [];
    }

    const interest = loanInterestForPaymentMinor(
      meta,
      transaction.time,
      Math.abs(transaction.amountMinorUnits),
    );

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
