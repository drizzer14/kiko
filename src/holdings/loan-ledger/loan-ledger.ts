import type { HoldingRow } from '@kiko/db';
import maybe, { foldMap } from 'fnts/maybe';
import { startOfLocalDay } from '@kiko/dates';
import { dayKeyOf, type LoanLedgerPayment, type PriceBook } from '@kiko/prices/price-book';

import {
  loanPlanOf,
  loanAnchorAt,
  installmentIndexOf,
  loanOutstandingMinorAt,
  loanInterestPerPaymentMinor,
  type LoanPlan,
  type LoanAnchor,
} from '../loan-schedule';
import type { LoanMeta } from '../holding-metadata';

/** The loan holding a ledger reads its own payments for. */
type LedgerLoan = Pick<HoldingRow, 'id' | 'currency'>;

/** A linked payment that pays the loan down, with its day key and interest part. */
type LedgerEntry = {
  payment: LoanLedgerPayment;
  dayKey: number;
  interestMinorUnits: number;
};

/** A loan's installment table plus every payment that can pay it down, time ascending. */
type Ledger = {
  plan: LoanPlan;
  entries: readonly LedgerEntry[];
};

// A book is read-only once built and one book serves every net-worth bucket,
// so a loan's ledger is built once per book instead of once per payment per
// bucket; the metadata is part of the key because the loan form reads the
// same book with the old and the new terms.
const ledgersByBook = new WeakMap<PriceBook, Map<string, Ledger>>();

const ledgerKeyOf = (meta: LoanMeta, loan: LedgerLoan): string =>
  JSON.stringify([
    loan.id,
    loan.currency,
    meta.schedule,
    meta.principalMinorUnits,
    meta.startDate,
    meta.annualRatePct,
    meta.termMonths,
  ]);

// A linked payment pays this loan down only as a debit in the loan's own
// currency (the rule the spending pie's loan-payment exclusion applies).
const buildLedger = (meta: LoanMeta, loan: LedgerLoan, book: PriceBook): Ledger => {
  const plan = loanPlanOf(meta);
  const payments = (book.loanPayments.get(loan.id) ?? []).filter(
    (payment) => payment.currency === loan.currency && payment.amountMinorUnits < 0,
  );
  const interests = loanInterestPerPaymentMinor(meta, payments, plan);
  const entries = payments.map((payment, index) => ({
    payment,
    dayKey: dayKeyOf(payment.time),
    interestMinorUnits: interests[index],
  }));

  return { plan, entries };
};

const ledgerOf = (meta: LoanMeta, loan: LedgerLoan, book: PriceBook): Ledger => {
  const ledgers = ledgersByBook.get(book) ?? new Map<string, Ledger>();
  const key = ledgerKeyOf(meta, loan);
  const cached = ledgers.get(key);

  if (cached !== undefined) {
    return cached;
  }

  const ledger = buildLedger(meta, loan, book);

  ledgers.set(key, ledger);
  ledgersByBook.set(book, ledgers);

  return ledger;
};

/** The loan detail's breakdown table, every amount in the loan's own minor units. */
type LoanLedgerSummary = {
  principalMinorUnits: number;
  paidSoFarMinorUnits: number;
  interestPaidMinorUnits: number;
  principalRepaidMinorUnits: number;
  outstandingMinorUnits: number;
};

// A payment counts for `instant` when its LOCAL day is on or before
// `instant`'s — the local-day rule the payer holding's own running balance
// follows, so a net-worth bucket sees the card's debit and the loan's drop
// together.
const countedEntries = (ledger: Ledger, instant: number): readonly LedgerEntry[] => {
  const instantDayKey = dayKeyOf(instant);

  return ledger.entries.filter((entry) => entry.dayKey <= instantDayKey);
};

const paidOf = (entry: LedgerEntry): number => Math.abs(entry.payment.amountMinorUnits);

const principalOf = (entry: LedgerEntry): number => paidOf(entry) - entry.interestMinorUnits;

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
  ledger: Ledger,
  counted: readonly LedgerEntry[],
): LoanAnchor => {
  const anchor = loanAnchorAt(meta, loan.id, book, instant);

  if (anchor.fromCorrection || meta.schedule === 'none') {
    return anchor;
  }

  const firstPaymentTime = Math.min(...counted.map((entry) => entry.payment.time));
  const endOfDayBeforeFirstPayment = startOfLocalDay(firstPaymentTime) - 1;

  // A payment days late still maps to its OWN installment's due date (the
  // same nearest-due-date mapping its interest is attributed by), so the
  // anchor must read the schedule from before THAT installment was due, not
  // from before the payment itself landed — otherwise its principal is
  // already subtracted once by the schedule and a second time by the link.
  const firstInstallmentIndex = installmentIndexOf(meta, ledger.plan, firstPaymentTime);
  const endOfDayBeforeDueDate = foldMap(
    maybe(firstInstallmentIndex),
    (index) => startOfLocalDay(ledger.plan.installments[index].dueDate) - 1,
  );
  const anchorInstant =
    endOfDayBeforeDueDate === undefined
      ? endOfDayBeforeFirstPayment
      : Math.min(endOfDayBeforeFirstPayment, endOfDayBeforeDueDate);
  const dayKey = dayKeyOf(anchorInstant);

  if (dayKey < anchor.dayKey) {
    return anchor;
  }

  return {
    dayKey,
    valueMinorUnits: loanOutstandingMinorAt(meta, loan.id, book, anchorInstant, ledger.plan),
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
  const ledger = ledgerOf(meta, loan, book);
  const counted = countedEntries(ledger, instant);

  if (counted.length === 0) {
    return loanOutstandingMinorAt(meta, loan.id, book, instant, ledger.plan);
  }

  if (dayKeyOf(instant) < dayKeyOf(meta.startDate)) {
    return 0;
  }

  const anchor = ledgerAnchorAt(meta, loan, book, instant, ledger, counted);
  const principalRepaidAfterAnchor = counted
    .filter((entry) => entry.dayKey > anchor.dayKey)
    .reduce((sum, entry) => sum + principalOf(entry), 0);

  return Math.max(0, anchor.valueMinorUnits - principalRepaidAfterAnchor);
};

/**
 * The loan detail's breakdown at `now`: the principal, what the counted
 * linked payments paid in total, its interest part (each payment's share
 * from `loanInterestPerPaymentMinor` — 0 for a `none` schedule), its principal
 * part, and the outstanding every other screen shows.
 */
export const loanLedgerSummary = (
  meta: LoanMeta,
  loan: LedgerLoan,
  book: PriceBook,
  now: number,
): LoanLedgerSummary => {
  const counted = countedEntries(ledgerOf(meta, loan, book), now);
  const paidSoFarMinorUnits = counted.reduce((sum, entry) => sum + paidOf(entry), 0);
  const interestPaidMinorUnits = counted.reduce((sum, entry) => sum + entry.interestMinorUnits, 0);

  return {
    principalMinorUnits: meta.principalMinorUnits,
    paidSoFarMinorUnits,
    interestPaidMinorUnits,
    principalRepaidMinorUnits: paidSoFarMinorUnits - interestPaidMinorUnits,
    outstandingMinorUnits: loanLedgerOutstandingMinorAt(meta, loan, book, now),
  };
};
