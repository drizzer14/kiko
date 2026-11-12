import { minOf } from '@kiko/numbers';
import type { HoldingRow } from '@kiko/db';
import maybe, { foldMap } from 'fnts/maybe';
import { startOfLocalDay } from '@kiko/dates';
import { dayKeyOf, type LoanLedgerPayment, type PriceBook } from '@kiko/prices/price-book';

import {
  loanPlanOf,
  loanAnchorAt,
  installmentIndexOf,
  isOnOrAfterLoanStartDay,
  loanOutstandingMinorAt,
  loanPaymentSplitsMinor,
  type LoanPlan,
  type LoanAnchor,
  type LoanInstallment,
} from '../loan-schedule';
import type { LoanMeta } from '../holding-metadata';

/** The loan holding a ledger reads its own payments for. */
type LedgerLoan = Pick<HoldingRow, 'id' | 'currency'>;

/** A linked payment that pays the loan down, with its day key, interest part and fee. */
type LedgerEntry = {
  payment: LoanLedgerPayment;
  dayKey: number;
  interestMinorUnits: number;
  excessMinorUnits: number;
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
// currency (the rule the spending pie's loan-payment exclusion applies), dated
// on or after the start day.
const buildLedger = (meta: LoanMeta, loan: LedgerLoan, book: PriceBook): Ledger => {
  const plan = loanPlanOf(meta);
  const payments = (book.loanPayments.get(loan.id) ?? []).filter(
    (payment) =>
      payment.currency === loan.currency &&
      payment.amountMinorUnits < 0 &&
      isOnOrAfterLoanStartDay(meta, payment.time),
  );
  const splits = loanPaymentSplitsMinor(meta, payments, loan.currency, plan);
  const entries = payments.map((payment, index) => ({
    payment,
    dayKey: dayKeyOf(payment.time),
    ...splits[index],
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

// What the loan drops by: the bank amount less the interest and less the fee
// a within-tolerance over-payment carries (kept in spending, not principal).
const principalOf = (entry: LedgerEntry): number =>
  paidOf(entry) - entry.interestMinorUnits - entry.excessMinorUnits;

// With no correction to count down from, a scheduled loan starts from what
// its schedule says was outstanding on the EARLIER of the day before its
// first linked payment and the day before that payment's own mapped
// installment's due date, not from the original principal: auto-links only
// reach back as far as the bank sync window, so a loan's earlier payments are
// often never linked and the principal would read far too high. A `none`
// loan has no schedule to read, and a first payment on or before the start
// day leaves nothing scheduled before it, so both keep the principal.
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

  const firstPaymentTime = minOf(counted.map((entry) => entry.payment.time));
  const endOfDayBeforeFirstPayment = startOfLocalDay(firstPaymentTime) - 1;

  // A payment days late still maps to its OWN installment's due date (the
  // same nearest-due-date mapping its interest is attributed by), so the
  // anchor must read the schedule from before THAT installment was due, not
  // from before the payment itself landed — otherwise its principal is
  // already subtracted once by the schedule and a second time by the link.
  const firstInstallmentIndex = installmentIndexOf(meta, ledger.plan, firstPaymentTime);
  const anchorInstant =
    foldMap(maybe(firstInstallmentIndex), (index) =>
      Math.min(
        endOfDayBeforeFirstPayment,
        startOfLocalDay(ledger.plan.installments[index].dueDate) - 1,
      ),
    ) ?? endOfDayBeforeFirstPayment;
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

// The anchor's value less the principal of each of `paid` the anchor does not already cover: a
// correction covers its own day (it was recorded with that day's payments in mind), the
// start-day anchor does not (payment 1 is due on the start day). Never below 0. The header and
// every linked payment's remainder read this one rule, so they cannot disagree.
const balanceAfterPaymentsMinor = (anchor: LoanAnchor, paid: readonly LedgerEntry[]): number =>
  Math.max(
    0,
    anchor.valueMinorUnits -
      paid
        .filter((entry) =>
          anchor.fromCorrection ? entry.dayKey > anchor.dayKey : entry.dayKey >= anchor.dayKey,
        )
        .reduce((sum, entry) => sum + principalOf(entry), 0),
  );

// The principal the counted payments paid on each installment row, keyed by the row's `index`:
// each payment goes to the row its time maps to (`installmentIndexOf`), and a row no payment maps
// to has no key. The remainders and the paid-in-full filter read this one mapping.
const paidPrincipalByRowOf = (
  meta: LoanMeta,
  ledger: Ledger,
  counted: readonly LedgerEntry[],
): ReadonlyMap<number, number> => {
  const paidByRow = new Map<number, number>();

  for (const entry of counted) {
    const rowIndex = foldMap(
      maybe(installmentIndexOf(meta, ledger.plan, entry.payment.time)),
      (index) => ledger.plan.installments[index].index,
    );

    if (rowIndex !== undefined) {
      paidByRow.set(rowIndex, (paidByRow.get(rowIndex) ?? 0) + principalOf(entry));
    }
  }

  return paidByRow;
};

/**
 * A loan's outstanding at `instant`, the ONE number every valuation site
 * reads (card, detail, totals, statistics, net-worth history). With no
 * counted linked payment it is the schedule's `loanOutstandingMinorAt`,
 * unchanged. Otherwise it is the anchor (`ledgerAnchorAt`: the latest
 * correction on or before `instant`, else the schedule outstanding on the
 * EARLIER of the day before the first linked payment and the day before that
 * payment's own mapped installment's due date, else the principal at the
 * start day) minus the principal part of each counted payment dated strictly
 * after the anchor's day (ON it too for the start-day anchor, since payment 1
 * is due on the start day) — what was actually repaid, not what the schedule
 * says was due — clamped to never go below 0. 0 before the loan's start day,
 * the same as the schedule.
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

  if (!isOnOrAfterLoanStartDay(meta, instant)) {
    return 0;
  }

  return balanceAfterPaymentsMinor(
    ledgerAnchorAt(meta, loan, book, instant, ledger, counted),
    counted,
  );
};

/** An upcoming installment with the loan balance left once it is paid. */
export type UpcomingLoanInstallment = LoanInstallment & { remainderMinorUnits: number };

/**
 * The balance left after each of `rows` (the loan detail's upcoming installments, in schedule
 * order) is paid, one value per row: the header outstanding (`loanLedgerOutstandingMinorAt`)
 * less the scheduled principal of every row up to it that the header does not already count,
 * never below 0. The header counts a row fully when it is a schedule row due on or before `now`
 * (the schedule branch, so the row due today), and only the principal paid by the counted linked
 * payments mapped to it otherwise (the ledger branch), so a partly paid row keeps its unpaid
 * principal. Reading the header keeps the first remainder equal to the header less row 1 after a
 * correction or a linked payment, not only for the untouched schedule.
 */
export const loanRemaindersAfterMinor = (
  meta: LoanMeta,
  loan: LedgerLoan,
  book: PriceBook,
  now: number,
  rows: readonly LoanInstallment[],
): readonly number[] => {
  const ledger = ledgerOf(meta, loan, book);
  const counted = countedEntries(ledger, now);
  const header = loanLedgerOutstandingMinorAt(meta, loan, book, now);
  const paidPrincipalByRow = paidPrincipalByRowOf(meta, ledger, counted);
  const uncountedPrincipalOf = (row: LoanInstallment): number => {
    if (counted.length === 0) {
      return dayKeyOf(row.dueDate) <= dayKeyOf(now) ? 0 : row.principalMinorUnits;
    }

    return Math.max(0, row.principalMinorUnits - (paidPrincipalByRow.get(row.index) ?? 0));
  };
  let uncountedThroughRow = 0;

  return rows.map((row) => {
    uncountedThroughRow += uncountedPrincipalOf(row);

    return Math.max(0, header - uncountedThroughRow);
  });
};

/**
 * `rows` less each row the counted linked payments paid in full: at least one counted payment
 * maps to it (`installmentIndexOf`) and their principal reaches the row's principal. A partly paid
 * row stays, and with no counted payment nothing is dropped (the row due today keeps its place).
 * The remainder chain (`loanRemaindersAfterMinor`) subtracts 0 for a dropped row, so the rows that
 * stay keep their remainders.
 */
export const loanInstallmentsLeftToPay = (
  meta: LoanMeta,
  loan: LedgerLoan,
  book: PriceBook,
  now: number,
  rows: readonly LoanInstallment[],
): readonly LoanInstallment[] => {
  const ledger = ledgerOf(meta, loan, book);
  const paidPrincipalByRow = paidPrincipalByRowOf(meta, ledger, countedEntries(ledger, now));

  return rows.filter((row) => {
    const paidPrincipal = paidPrincipalByRow.get(row.index);

    return paidPrincipal === undefined || paidPrincipal < row.principalMinorUnits;
  });
};

/** One linked payment's own split and the loan balance left right after it. */
export type LinkedPaymentBreakdown = {
  principalMinorUnits: number;
  interestMinorUnits: number;
  remainderMinorUnits: number;
};

/**
 * Each counted linked payment's principal and interest part and the loan balance right after it,
 * keyed by transaction id; a payment the ledger does not count (another currency, a credit,
 * before the start day, after `now`) has no entry. The balance reads the header's own rule
 * (`loanLedgerOutstandingMinorAt`): the anchor at the payment's time, less the principal of
 * every payment up to and including it that the anchor does not already cover, never below 0,
 * so the last payment's balance is the header when no correction follows it. The split is
 * order-dependent (`loanPaymentSplitsMinor`), so the whole payment list is read, never one row.
 */
export const loanLinkedPaymentBreakdownsMinor = (
  meta: LoanMeta,
  loan: LedgerLoan,
  book: PriceBook,
  now: number,
): ReadonlyMap<string, LinkedPaymentBreakdown> => {
  const ledger = ledgerOf(meta, loan, book);
  const counted = countedEntries(ledger, now);

  return new Map(
    counted.map((entry, index) => {
      const paidThroughHere = counted.slice(0, index + 1);
      const anchor = ledgerAnchorAt(meta, loan, book, entry.payment.time, ledger, paidThroughHere);

      return [
        entry.payment.transactionId,
        {
          principalMinorUnits: principalOf(entry),
          interestMinorUnits: entry.interestMinorUnits,
          remainderMinorUnits: balanceAfterPaymentsMinor(anchor, paidThroughHere),
        },
      ];
    }),
  );
};

/**
 * The loan detail's breakdown at `now`: the principal, what the counted
 * linked payments paid in total (the bank total, fees included), its interest
 * part (each payment's share from `loanInterestPerPaymentMinor` — 0 for a
 * `none` schedule), its principal part (the fees left out, so the rows are not
 * an equation), and the outstanding every other screen shows.
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
    principalRepaidMinorUnits: counted.reduce((sum, entry) => sum + principalOf(entry), 0),
    outstandingMinorUnits: loanLedgerOutstandingMinorAt(meta, loan, book, now),
  };
};
