import { holdingInstrument } from '@kiko/prices/instrument';
import { multiplyToMinorUnits } from '@kiko/currency/decimal';
import { dayKeyOf, priceAt, type PriceBook } from '@kiko/prices/price-book';

import { addMonths } from '../interest';
import type { LoanMeta } from '../holding-metadata';

/**
 * One row of a scheduled loan's amortization table. `dueDate` is a
 * LOCAL-MIDNIGHT instant (built from `addMonths`, kiko-domain's "Dates"
 * convention — not a `dayKeyOf`-style UTC-midnight day key). Every amount is
 * an integer minor-units value; `balanceMinorUnits` is the outstanding
 * principal remaining AFTER this installment is paid.
 */
export type LoanInstallment = {
  index: number;
  dueDate: number;
  interestMinorUnits: number;
  principalMinorUnits: number;
  paymentMinorUnits: number;
  balanceMinorUnits: number;
};

/**
 * The monthly amortization schedule for an `annuity`/`differentiated` loan.
 * `none` (an informal debt with no known rate/term) has no
 * schedule and returns an empty array — its outstanding balance is instead a
 * manual price-point series, read directly by `loanOutstandingMinorAt`
 * below.
 *
 * Due dates fall on the calendar-anniversary of `startDate`, one per month
 * (`addMonths(startDate, k)`, clamped to the target month's length — the
 * same convention `depositLedger`/`bondCouponDates` already use). Interest
 * each period is `round(balance * annualRatePct / 100 / 12)`; the LAST
 * installment absorbs whatever rounding drifted across every prior period,
 * so the schedule always reduces the balance to EXACTLY 0 rather than
 * leaving a stray kopeck.
 *
 * `annuity`: a constant payment per period (the standard amortization
 * formula), computed once and rounded; every period but the last derives its
 * principal as `roundedPayment - interest`. `differentiated`: a constant
 * PRINCIPAL per period (`round(principal / termMonths)`); the payment varies
 * as the shrinking balance's interest falls.
 */
export const loanInstallments = (meta: LoanMeta): LoanInstallment[] => {
  const { schedule, annualRatePct, termMonths, principalMinorUnits: principal, startDate } = meta;

  if (schedule === 'none' || annualRatePct === undefined || termMonths === undefined) {
    return [];
  }

  const monthlyRate = annualRatePct / 100 / 12;

  // A constant payment per period, the standard amortization formula — used
  // only by `annuity` (see `nonLastPrincipalMinorUnits` below); cheap enough
  // to compute unconditionally rather than branch on `schedule` here too.
  const roundedAnnuityPayment = Math.round(
    monthlyRate === 0
      ? principal / termMonths
      : (principal * monthlyRate) / (1 - (1 + monthlyRate) ** -termMonths),
  );
  const basePrincipal = Math.round(principal / termMonths);

  // The principal portion of a NON-last installment: `annuity` derives it
  // from the constant payment above; `differentiated` holds it at the
  // constant `basePrincipal`. Extracted so the loop below never nests a
  // ternary inside the last-installment one.
  const nonLastPrincipalMinorUnits = (interestMinorUnits: number): number =>
    schedule === 'annuity' ? roundedAnnuityPayment - interestMinorUnits : basePrincipal;

  const installments: LoanInstallment[] = [];
  let balance = principal;

  for (let k = 1; k <= termMonths; k += 1) {
    const isLast = k === termMonths;
    const interestMinorUnits = Math.round(balance * monthlyRate);
    const principalMinorUnits = isLast ? balance : nonLastPrincipalMinorUnits(interestMinorUnits);
    const paymentMinorUnits = principalMinorUnits + interestMinorUnits;

    balance -= principalMinorUnits;

    installments.push({
      index: k,
      dueDate: addMonths(startDate, k),
      interestMinorUnits,
      principalMinorUnits,
      paymentMinorUnits,
      balanceMinorUnits: balance,
    });
  }

  return installments;
};

/**
 * A loan's installment table with each row's due-date day key alongside it.
 * Build it once per loan and pass it to every read below that repeats for
 * the same loan (each net-worth bucket, each linked payment): building the
 * table and its day keys is the expensive part of every one of those reads.
 */
export type LoanPlan = {
  installments: readonly LoanInstallment[];
  dueDayKeys: readonly number[];
};

export const loanPlanOf = (meta: LoanMeta): LoanPlan => {
  const installments = loanInstallments(meta);

  return { installments, dueDayKeys: installments.map((row) => dayKeyOf(row.dueDate)) };
};

/**
 * `annuity`/`differentiated` outstanding is computed AT READ TIME from the
 * schedule: the latest manual correction point on the holding's own
 * `holding:<id>` instrument, WHEN ITS DAY IS ON OR BEFORE `instant`'s local
 * day, anchors a fresh baseline, and only the scheduled PRINCIPAL due
 * strictly AFTER that correction's day (and at or before `instant`) is
 * subtracted from it. A correction dated AFTER `instant` must never anchor a
 * query for an earlier instant — `priceAt` itself falls back to the
 * EARLIEST stored point when every point is later than the requested day (a
 * fallback that is correct for the `none`/Property "manual series"
 * convention below, but not for a scheduled loan being queried before its
 * only correction), so that fallback is deliberately NOT trusted here; the
 * day is checked explicitly instead. With no correction (or none on or
 * before `instant`), the anchor is the loan's own principal at `startDate`
 * — every installment's due date is after `startDate`, so this reduces to
 * "principal minus every installment due so far", the plain no-correction
 * schedule. `none` (an informal debt) reads the manual series directly
 * (earliest-point fallback included), with no schedule to subtract against.
 * Both branches clamp the result to never go below 0 (an overpaid/
 * overcorrected loan reads as paid off, never negative).
 *
 * An instant whose local day is BEFORE the loan's own `startDate` day
 * contributes 0, in either branch — mirroring the rule a priced holding
 * (`property_item`/`metal`) already follows for an instant before its first
 * lot (`kiko-pricing`). Without this guard the `none` branch could surface a
 * LATER manual correction (`priceAt`'s earliest-point fallback) for a query
 * before the loan even started, and the scheduled branch would surface the
 * full, un-amortized principal instead of "not taken out yet".
 */
export const loanOutstandingMinorAt = (
  meta: LoanMeta,
  holdingId: string,
  book: PriceBook,
  instant: number,
  plan: LoanPlan = loanPlanOf(meta),
): number => {
  if (dayKeyOf(instant) < dayKeyOf(meta.startDate)) {
    return 0;
  }

  const correction = priceAt(book, holdingInstrument(holdingId), instant);

  if (meta.schedule === 'none') {
    return correction === undefined
      ? 0
      : Math.max(0, multiplyToMinorUnits([correction.price], correction.currency));
  }

  const instantDayKey = dayKeyOf(instant);
  const anchor = loanAnchorAt(meta, holdingId, book, instant);
  const principalDueAfterAnchor = plan.installments
    .filter((_, index) => {
      const dueDayKey = plan.dueDayKeys[index];

      return dueDayKey > anchor.dayKey && dueDayKey <= instantDayKey;
    })
    .reduce((sum, row) => sum + row.principalMinorUnits, 0);

  return Math.max(0, anchor.valueMinorUnits - principalDueAfterAnchor);
};

/** The day and value a loan's outstanding is counted down from. */
export type LoanAnchor = {
  dayKey: number;
  valueMinorUnits: number;
  fromCorrection: boolean;
};

/**
 * The baseline a loan's outstanding is counted down from at `instant`: the
 * latest manual correction on the loan's own `holding:<id>` series whose day
 * is on or before `instant`'s local day, else the principal at the start
 * day. A correction dated AFTER `instant` never anchors it — `priceAt`'s
 * earliest-point fallback is deliberately not trusted (see
 * `loanOutstandingMinorAt` above). Shared by the schedule branch above and
 * the linked-payments ledger (`src/holdings/loan-ledger/`), so both anchor on
 * the exact same point.
 */
export const loanAnchorAt = (
  meta: LoanMeta,
  holdingId: string,
  book: PriceBook,
  instant: number,
): LoanAnchor => {
  const correction = priceAt(book, holdingInstrument(holdingId), instant);

  if (correction === undefined || correction.day > dayKeyOf(instant)) {
    return {
      dayKey: dayKeyOf(meta.startDate),
      valueMinorUnits: meta.principalMinorUnits,
      fromCorrection: false,
    };
  }

  return {
    dayKey: correction.day,
    valueMinorUnits: multiplyToMinorUnits([correction.price], correction.currency),
    fromCorrection: true,
  };
};

/** A bank payment linked to a loan; a debit carries a negative amount. */
type LinkedPayment = { time: number; amountMinorUnits: number };

// The installment a payment pays: the one whose due date is NEAREST to the
// payment's local day (an early or late payment still matches its intended
// installment), or undefined when the loan has no schedule or the payment is
// more than one period outside it (see `loanInterestPerPaymentMinor`).
const installmentIndexOf = (
  meta: LoanMeta,
  plan: LoanPlan,
  paymentTime: number,
): number | undefined => {
  const { installments, dueDayKeys } = plan;

  if (installments.length === 0) {
    return undefined;
  }

  const paymentDayKey = dayKeyOf(paymentTime);
  const lowerBoundDayKey = dayKeyOf(meta.startDate);
  const upperBoundDayKey = dayKeyOf(addMonths(meta.startDate, installments.length + 1));

  if (paymentDayKey < lowerBoundDayKey || paymentDayKey > upperBoundDayKey) {
    return undefined;
  }

  return dueDayKeys.reduce(
    (closest, dueDayKey, index) =>
      Math.abs(dueDayKey - paymentDayKey) < Math.abs(dueDayKeys[closest] - paymentDayKey)
        ? index
        : closest,
    0,
  );
};

/**
 * The interest portion of each of one loan's linked bank payments
 * ("interest-only spending"), in the order `payments` is given: `none` (an
 * informal debt has no schedule) never counts any interest. Otherwise each
 * payment maps to the installment whose due date is NEAREST to its own local
 * day (not necessarily the next unpaid one), and that installment's scheduled
 * interest is counted ONCE across every payment mapped to it: taking the
 * payments earliest first, each counts what is left of the installment's
 * interest, capped at its own absolute amount, and the rest of it is
 * principal. So an installment paid in two halves counts its interest on the
 * first half (and on the second only what the first could not cover), and a
 * partial payment never counts more interest than it actually paid.
 *
 * A payment MORE THAN ONE PERIOD outside the schedule counts 0 interest,
 * rather than mapping to the nearest (first/last) installment regardless of
 * distance — a payment years before the loan even started, or years after it
 * was fully paid off, is not this loan's interest. "One period" is the same
 * monthly cadence every due date is built from (`addMonths(startDate, k)`):
 * one period before the first installment is `startDate` itself, one period
 * after the last is `addMonths(startDate, installments.length + 1)`. Both
 * bounds are INCLUSIVE — a payment exactly on one still maps to its boundary
 * installment, only a payment strictly beyond it counts 0.
 */
export const loanInterestPerPaymentMinor = (
  meta: LoanMeta,
  payments: readonly LinkedPayment[],
  plan: LoanPlan = loanPlanOf(meta),
): number[] => {
  const interests = payments.map(() => 0);
  const interestLeftByInstallment = new Map<number, number>();
  const earliestFirst = payments
    .map((payment, position) => ({ payment, position }))
    .sort((first, second) => first.payment.time - second.payment.time);

  for (const { payment, position } of earliestFirst) {
    const index = installmentIndexOf(meta, plan, payment.time);

    if (index === undefined) {
      continue;
    }

    const interestLeft =
      interestLeftByInstallment.get(index) ?? plan.installments[index].interestMinorUnits;
    const interest = Math.min(interestLeft, Math.abs(payment.amountMinorUnits));

    interests[position] = interest;
    interestLeftByInstallment.set(index, interestLeft - interest);
  }

  return interests;
};
