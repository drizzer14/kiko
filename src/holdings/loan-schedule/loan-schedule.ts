import type { LoanMeta } from '../holding-metadata';
import { holdingInstrument } from '../../prices/instrument';
import { multiplyToMinorUnits } from '../../currency/decimal';
import { addMonths } from '../interest';
import { dayKeyOf, priceAt, type PriceBook } from '../../prices/price-book';

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
 * The monthly amortization schedule for an `annuity`/`differentiated` loan
 * (spec 5.1). `none` (an informal debt with no known rate/term) has no
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
  const hasSchedule =
    meta.schedule !== 'none' && meta.annualRatePct !== undefined && meta.termMonths !== undefined;

  if (!hasSchedule) {
    return [];
  }

  const annualRatePct = meta.annualRatePct as number;
  const termMonths = meta.termMonths as number;
  const monthlyRate = annualRatePct / 100 / 12;
  const principal = meta.principalMinorUnits;

  // A constant payment per period, the standard amortization formula
  // (undefined for `differentiated`, which instead holds PRINCIPAL constant
  // — see `nonLastPrincipalMinorUnits` below).
  const roundedAnnuityPayment =
    meta.schedule === 'annuity'
      ? Math.round(
          monthlyRate === 0
            ? principal / termMonths
            : (principal * monthlyRate) / (1 - (1 + monthlyRate) ** -termMonths),
        )
      : undefined;
  const basePrincipal = Math.round(principal / termMonths);

  // The principal portion of a NON-last installment: `annuity` derives it
  // from the constant payment above; `differentiated` holds it at the
  // constant `basePrincipal`. Extracted so the loop below never nests a
  // ternary inside the last-installment one.
  const nonLastPrincipalMinorUnits = (interestMinorUnits: number): number =>
    meta.schedule === 'annuity'
      ? (roundedAnnuityPayment as number) - interestMinorUnits
      : basePrincipal;

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
      dueDate: addMonths(meta.startDate, k),
      interestMinorUnits,
      principalMinorUnits,
      paymentMinorUnits,
      balanceMinorUnits: balance,
    });
  }

  return installments;
};

/**
 * `annuity`/`differentiated` outstanding is computed AT READ TIME from the
 * schedule (N10a): the latest manual correction point on the holding's own
 * `holding:<id>` instrument (if any, at or before `instant`'s local day)
 * anchors a fresh baseline, and only the scheduled PRINCIPAL due strictly
 * AFTER that correction's day (and at or before `instant`) is subtracted
 * from it. With no correction, the anchor is the loan's own principal at
 * `startDate` — every installment's due date is after `startDate`, so this
 * reduces to "principal minus every installment due so far", the plain
 * no-correction schedule. `none` (an informal debt) reads the manual series
 * directly, with no schedule to subtract against. Both branches clamp the
 * result to never go below 0 (an overpaid/overcorrected loan reads as paid
 * off, never negative).
 */
export const loanOutstandingMinorAt = (
  meta: LoanMeta,
  holdingId: string,
  book: PriceBook,
  instant: number,
): number => {
  const correction = priceAt(book, holdingInstrument(holdingId), instant);

  if (meta.schedule === 'none') {
    return correction === undefined
      ? 0
      : Math.max(0, multiplyToMinorUnits([correction.price], correction.currency));
  }

  const anchorDayKey = correction === undefined ? dayKeyOf(meta.startDate) : correction.day;
  const anchorValueMinor =
    correction === undefined
      ? meta.principalMinorUnits
      : multiplyToMinorUnits([correction.price], correction.currency);
  const instantDayKey = dayKeyOf(instant);
  const principalDueAfterAnchor = loanInstallments(meta)
    .filter((row) => {
      const dueDayKey = dayKeyOf(row.dueDate);
      return dueDayKey > anchorDayKey && dueDayKey <= instantDayKey;
    })
    .reduce((sum, row) => sum + row.principalMinorUnits, 0);

  return Math.max(0, anchorValueMinor - principalDueAfterAnchor);
};

/**
 * The interest portion of a bank payment linked to this loan (N10b, D14 —
 * "interest-only spending"): `none` (an informal debt has no schedule) never
 * counts any interest. Otherwise the payment maps to the installment whose
 * due date is NEAREST to the payment's own local day (not necessarily the
 * next unpaid one — an early or late payment still matches its intended
 * installment), and the interest counted is that installment's scheduled
 * interest, capped at the payment's own (absolute) amount — a partial
 * payment can never count more interest than it actually paid.
 */
export const loanInterestForPaymentMinor = (
  meta: LoanMeta,
  paymentTime: number,
  paymentAbsMinor: number,
): number => {
  if (meta.schedule === 'none') {
    return 0;
  }

  const installments = loanInstallments(meta);

  if (installments.length === 0) {
    return 0;
  }

  const paymentDayKey = dayKeyOf(paymentTime);
  const nearest = installments.reduce((closest, candidate) =>
    Math.abs(dayKeyOf(candidate.dueDate) - paymentDayKey) <
    Math.abs(dayKeyOf(closest.dueDate) - paymentDayKey)
      ? candidate
      : closest,
  );

  return Math.min(nearest.interestMinorUnits, paymentAbsMinor);
};
