import type { HoldingRow } from '@kiko/db';
import { startOfLocalDay } from '@kiko/dates';
import { dayKeyOf, type LoanLedgerPayment, type PriceBook } from '@kiko/prices/price-book';

import {
  loanAnchorAt,
  loanOutstandingMinorAt,
  loanInterestForPaymentMinor,
  type LoanAnchor,
} from '../loan-schedule';
import type { LoanMeta } from '../holding-metadata';

/** The loan holding a ledger reads its own payments for. */
type LedgerLoan = Pick<HoldingRow, 'id' | 'currency'>;

/** The loan detail's breakdown table, every amount in the loan's own minor units. */
type LoanLedgerSummary = {
  principalMinorUnits: number;
  paidSoFarMinorUnits: number;
  interestPaidMinorUnits: number;
  principalRepaidMinorUnits: number;
  outstandingMinorUnits: number;
};

// A linked payment pays this loan down only as a debit in the loan's own
// currency (the rule the spending pie's loan-payment exclusion applies), and
// counts for `instant` when its LOCAL day is on or before `instant`'s — the
// local-day rule the payer holding's own running balance follows, so a
// net-worth bucket sees the card's debit and the loan's drop together.
const countedPayments = (
  loan: LedgerLoan,
  book: PriceBook,
  instant: number,
): readonly LoanLedgerPayment[] =>
  (book.loanPayments.get(loan.id) ?? []).filter(
    (payment) =>
      payment.currency === loan.currency &&
      payment.amountMinorUnits < 0 &&
      dayKeyOf(payment.time) <= dayKeyOf(instant),
  );

const interestOf = (meta: LoanMeta, payment: LoanLedgerPayment): number =>
  loanInterestForPaymentMinor(meta, payment.time, Math.abs(payment.amountMinorUnits));

const principalOf = (meta: LoanMeta, payment: LoanLedgerPayment): number =>
  Math.abs(payment.amountMinorUnits) - interestOf(meta, payment);

// With no correction to count down from, a scheduled loan starts from what
// its schedule says was outstanding on the day before its first linked
// payment, not from the original principal: auto-links only reach back as far
// as the bank sync window, so a loan's earlier payments are often never
// linked and the principal would read far too high. A `none` loan has no
// schedule to read, and a first payment on or before the start day leaves
// nothing scheduled before it, so both keep the principal.
const ledgerAnchorAt = (
  meta: LoanMeta,
  loan: LedgerLoan,
  book: PriceBook,
  instant: number,
  payments: readonly LoanLedgerPayment[],
): LoanAnchor => {
  const anchor = loanAnchorAt(meta, loan.id, book, instant);

  if (anchor.fromCorrection || meta.schedule === 'none') {
    return anchor;
  }

  const firstPaymentTime = Math.min(...payments.map((payment) => payment.time));
  const endOfDayBeforeFirstPayment = startOfLocalDay(firstPaymentTime) - 1;
  const dayKey = dayKeyOf(endOfDayBeforeFirstPayment);

  if (dayKey < anchor.dayKey) {
    return anchor;
  }

  return {
    dayKey,
    valueMinorUnits: loanOutstandingMinorAt(meta, loan.id, book, endOfDayBeforeFirstPayment),
    fromCorrection: false,
  };
};

/**
 * A loan's outstanding at `instant`, the ONE number every valuation site
 * reads (card, detail, totals, statistics, net-worth history). With no
 * counted linked payment it is the schedule's `loanOutstandingMinorAt`,
 * unchanged. Otherwise it is the anchor (`ledgerAnchorAt`: the latest
 * correction on or before `instant`, else the schedule outstanding on the day
 * before the first linked payment, else the principal at the start day)
 * minus the principal part of each counted payment dated strictly after the
 * anchor's day — what was actually repaid, not what the schedule says was
 * due — clamped to never go below 0. 0 before the loan's start day, the same
 * as the schedule.
 */
export const loanLedgerOutstandingMinorAt = (
  meta: LoanMeta,
  loan: LedgerLoan,
  book: PriceBook,
  instant: number,
): number => {
  const payments = countedPayments(loan, book, instant);

  if (payments.length === 0) {
    return loanOutstandingMinorAt(meta, loan.id, book, instant);
  }

  if (dayKeyOf(instant) < dayKeyOf(meta.startDate)) {
    return 0;
  }

  const anchor = ledgerAnchorAt(meta, loan, book, instant, payments);
  const principalRepaidAfterAnchor = payments
    .filter((payment) => dayKeyOf(payment.time) > anchor.dayKey)
    .reduce((sum, payment) => sum + principalOf(meta, payment), 0);

  return Math.max(0, anchor.valueMinorUnits - principalRepaidAfterAnchor);
};

/**
 * The loan detail's breakdown at `now`: the principal, what the counted
 * linked payments paid in total, its interest part (each payment's own
 * `loanInterestForPaymentMinor` — 0 for a `none` schedule), its principal
 * part, and the outstanding every other screen shows.
 */
export const loanLedgerSummary = (
  meta: LoanMeta,
  loan: LedgerLoan,
  book: PriceBook,
  now: number,
): LoanLedgerSummary => {
  const payments = countedPayments(loan, book, now);
  const paidSoFarMinorUnits = payments.reduce(
    (sum, payment) => sum + Math.abs(payment.amountMinorUnits),
    0,
  );
  const interestPaidMinorUnits = payments.reduce(
    (sum, payment) => sum + interestOf(meta, payment),
    0,
  );

  return {
    principalMinorUnits: meta.principalMinorUnits,
    paidSoFarMinorUnits,
    interestPaidMinorUnits,
    principalRepaidMinorUnits: paidSoFarMinorUnits - interestPaidMinorUnits,
    outstandingMinorUnits: loanLedgerOutstandingMinorAt(meta, loan, book, now),
  };
};
