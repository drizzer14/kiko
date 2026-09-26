import maybe, { foldMap } from 'fnts/maybe';

import { Money } from '../../currency/money';
import type { HoldingRow } from '../../db/schema';
import { dayKeyOf } from '../../prices/price-book';
import type { Currency } from '../../currency/currency';
import { loanInstallments } from '../../holdings/loan-schedule';
import { asLoanMeta, type LoanMeta } from '../../holdings/holding-metadata';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
// Spec 5.4 rule 2: "3 days before to 7 days after the due date".
const WINDOW_BEFORE_DAYS = 3;
const WINDOW_AFTER_DAYS = 7;

// Spec 5.4 rule 3's fixed keyword list (Ukrainian + English), checked
// case-insensitively against the transaction's own description. The
// lender's own name is a SEPARATE, per-loan signal (not a literal here) —
// see `hasThirdSignal` below.
const PAYMENT_KEYWORDS = [
  'кредит',
  'погашення',
  'іпотек',
  'позик',
  'loan',
  'mortgage',
  'repayment',
];

/** A loan holding as the matcher needs it — mirrors `loan-payments.ts`'s
 * `LoanHolding`, parsing `LoanMeta` internally so a caller hands it plain
 * holding rows straight off `holdingsRepo.loanHoldingsQuery()`, with no
 * intermediate mapping step of its own. */
type MatchableLoanHolding = Pick<HoldingRow, 'id' | 'currency' | 'metadata'>;

/** A transaction as the matcher needs it: every column its own candidate
 * filter (an eligible debit) and its third signal (rule 3) read. */
export type MatchableTransaction = {
  id: string;
  holdingId: string;
  currency: Currency;
  amountMinorUnits: number;
  time: number;
  description: string;
  counterIban: string | null;
  loanHoldingId: string | null;
  loanLinkRejected: boolean;
  exchangeCounterpartHoldingId: string | null;
};

type LoanPaymentMatch = {
  transactionId: string;
  loanHoldingId: string;
  dueDate: number;
};

// Rule-4's candidate filter: a debit, never already linked or previously
// rejected (a manual "None" or Undo must stick — kiko-domain), never one leg
// of an Exchange/Convert (a structural marker, not a description guess — see
// `exchange-exclusion.ts`'s identical check).
const isEligibleTransaction = (transaction: MatchableTransaction): boolean =>
  transaction.amountMinorUnits < 0 &&
  transaction.loanHoldingId === null &&
  !transaction.loanLinkRejected &&
  transaction.exchangeCounterpartHoldingId === null;

// Rule 1: within the LARGER of 1% or 1.00 (in the loan's own currency) of the
// installment's own scheduled payment — a bank fee or rounding, not a
// partial/early payment (which the user links manually instead).
const withinAmountTolerance = (
  installmentPaymentMinorUnits: number,
  transactionAbsMinorUnits: number,
  currency: Currency,
): boolean => {
  const percentTolerance = Math.round(installmentPaymentMinorUnits * 0.01);
  const floorTolerance = Money.fromMajor(currency, 1).minorUnits;
  const tolerance = Math.max(percentTolerance, floorTolerance);

  return Math.abs(transactionAbsMinorUnits - installmentPaymentMinorUnits) <= tolerance;
};

// Rule 2: the transaction's own LOCAL day, 3 days before to 7 days after the
// due date's local day — both bounds inclusive, the same "both bounds
// inclusive" idiom `loanInterestForPaymentMinor` (N10b) already establishes.
const withinDateWindow = (transactionTime: number, dueDate: number): boolean => {
  const dayDiff = (dayKeyOf(transactionTime) - dayKeyOf(dueDate)) / MS_PER_DAY;

  return dayDiff >= -WINDOW_BEFORE_DAYS && dayDiff <= WINDOW_AFTER_DAYS;
};

// One loan's own installment, carrying back the per-loan fields rule 3 needs
// (`paymentHoldingId`/`lenderName`/`lenderIban`) — built once per loan so the
// O(installments x transactions) pass below never re-parses `LoanMeta` or
// re-derives them per pair.
type CandidateInstallment = {
  loanHoldingId: string;
  currency: Currency;
  dueDate: number;
  paymentMinorUnits: number;
  paymentHoldingId: string | undefined;
  lenderName: string | undefined;
  lenderIban: string | undefined;
};

// Rule 3: at least one more signal beyond amount+date — the loan's own
// `paymentHoldingId`, `lenderIban` against the transaction's `counterIban`,
// or a keyword/the lender's own name in the description (both
// case-insensitive). Amount + date ALONE (e.g. a same-size monthly rent)
// never links — this is what stops that false positive.
const hasThirdSignal = (
  transaction: MatchableTransaction,
  installment: CandidateInstallment,
): boolean => {
  if (
    installment.paymentHoldingId !== undefined &&
    transaction.holdingId === installment.paymentHoldingId
  ) {
    return true;
  }

  if (
    installment.lenderIban !== undefined &&
    transaction.counterIban !== null &&
    transaction.counterIban === installment.lenderIban
  ) {
    return true;
  }

  const description = transaction.description.toLowerCase();

  if (PAYMENT_KEYWORDS.some((keyword) => description.includes(keyword))) {
    return true;
  }

  return (
    installment.lenderName !== undefined &&
    installment.lenderName.trim() !== '' &&
    description.includes(installment.lenderName.toLowerCase())
  );
};

// Every installment due on or before `now` (plus the window's own
// before-margin, so a payment already made a few days ahead of an upcoming
// due date still matches) — a cheap UPPER bound only, never a lower one:
// every past installment stays candidate, so a freshly created/edited loan
// backfills its whole history the first time this runs. `'none'`
// (informal) loans have no installments at all (`loanInstallments` already
// returns `[]` for them), so they never produce a candidate here — no
// separate schedule check is needed.
const candidateInstallmentsFor = (
  loan: MatchableLoanHolding,
  meta: LoanMeta,
  now: number,
): CandidateInstallment[] => {
  const cutoffDayKey = dayKeyOf(now) + WINDOW_BEFORE_DAYS * MS_PER_DAY;

  return loanInstallments(meta)
    .filter((installment) => dayKeyOf(installment.dueDate) <= cutoffDayKey)
    .map((installment) => ({
      loanHoldingId: loan.id,
      currency: loan.currency,
      dueDate: installment.dueDate,
      paymentMinorUnits: installment.paymentMinorUnits,
      paymentHoldingId: meta.paymentHoldingId,
      lenderName: meta.lenderName,
      lenderIban: meta.lenderIban,
    }));
};

const installmentKey = (installment: CandidateInstallment): string =>
  `${installment.loanHoldingId}:${installment.dueDate}`;

/**
 * The auto-link matcher: a pure, idempotent function from every candidate
 * transaction + every loan's own schedule to the links that
 * should be written with `source: 'auto'` (`transactionsRepo.setAutoLoanLinks`
 * is the ONLY write path for what this returns — see that function's own doc
 * comment). Never mutates anything itself; a caller re-running it against
 * already-linked data (its own `MatchableTransaction.loanHoldingId` no longer
 * `null`) simply excludes that row from `isEligibleTransaction`, so a re-run
 * is naturally idempotent.
 *
 * Rule 4 (uniqueness) is checked over the FULL candidate matrix, not a
 * sequential filter: an installment with more than one matching transaction,
 * or a transaction that matches more than one installment (of the SAME or a
 * DIFFERENT loan), is excluded from BOTH ends — order-independent, so it
 * matches the spec's own "exactly one candidate for the installment, and the
 * candidate matches exactly one installment of one loan" regardless of which
 * ambiguity is checked first.
 */
export const matchLoanPayments = (params: {
  transactions: readonly MatchableTransaction[];
  loans: readonly MatchableLoanHolding[];
  now: number;
}): LoanPaymentMatch[] => {
  const { transactions, loans, now } = params;

  const candidates = transactions.filter(isEligibleTransaction);
  const installments = loans.flatMap(
    (loan) =>
      foldMap(maybe(asLoanMeta(loan.metadata)), (meta) =>
        candidateInstallmentsFor(loan, meta, now),
      ) ?? [],
  );

  const pairs: { transactionId: string; installment: CandidateInstallment }[] = [];

  for (const transaction of candidates) {
    for (const installment of installments) {
      if (
        transaction.currency === installment.currency &&
        withinAmountTolerance(
          installment.paymentMinorUnits,
          Math.abs(transaction.amountMinorUnits),
          installment.currency,
        ) &&
        withinDateWindow(transaction.time, installment.dueDate) &&
        hasThirdSignal(transaction, installment)
      ) {
        pairs.push({ transactionId: transaction.id, installment });
      }
    }
  }

  const installmentCounts = new Map<string, number>();
  const transactionCounts = new Map<string, number>();

  for (const pair of pairs) {
    const key = installmentKey(pair.installment);
    installmentCounts.set(key, (installmentCounts.get(key) ?? 0) + 1);
    transactionCounts.set(pair.transactionId, (transactionCounts.get(pair.transactionId) ?? 0) + 1);
  }

  return pairs
    .filter(
      (pair) =>
        installmentCounts.get(installmentKey(pair.installment)) === 1 &&
        transactionCounts.get(pair.transactionId) === 1,
    )
    .map((pair) => ({
      transactionId: pair.transactionId,
      loanHoldingId: pair.installment.loanHoldingId,
      dueDate: pair.installment.dueDate,
    }));
};
