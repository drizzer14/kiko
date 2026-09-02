import type { Currency } from '../currency/currency';
import { Money, toMajor } from '../currency/money';
import type { BondMeta, TermDepositMeta } from './holding-metadata';
import {
  addMonths,
  biweeklyCreditDates,
  bondCouponDates,
  bondCouponMajor,
  depositAccruedMajor,
  depositBiweeklyMajor,
  depositCompoundedMajor,
  periodBoundary,
} from './interest';
import { INTEREST_TAX_RATE_PCT, taxOnInterestMinor } from './tax';

// One row of the deposit lifecycle table: the value observed over a single
// compounding period, so a user can reconcile each period against their bank
// statement. `openingMajor` carries in from the previous period's close;
// `interestMajor` is the interest credited this period; `closingMajor` is the
// deposit value at `periodEnd`. `isFuture` marks a period that ends after `now`
// (projected, greyed in the UI).
type DepositScheduleRow = {
  periodEnd: number;
  openingMajor: number;
  contributionMajor: number;
  interestMajor: number;
  closingMajor: number;
  isFuture: boolean;
};

// One row of the bond coupon table: the coupon payment date, the net coupon
// paid that period, the running cumulative coupon, and whether the coupon is
// still in the future (projected).
type BondScheduleRow = {
  couponDate: number;
  couponMajor: number;
  cumulativeMajor: number;
  isFuture: boolean;
};

// The distinct period-end instants to tabulate: every capitalization boundary
// strictly inside (start, maturity), plus `now` (clamped to maturity) as the
// current partial close, plus maturity itself. Sorted ascending, de-duplicated.
//
// For bi-weekly compounding the boundaries are the opening-day-anchored credit
// dates (twice a month); the first credit date is the accrual START, not a
// period end, so it is dropped. For the calendar frequencies the boundaries fall
// on the monthly/quarterly/annual anniversaries of the start.
const depositPeriodEnds = (
  meta: TermDepositMeta,
  start: number,
  maturity: number,
  now: number,
): number[] => {
  const ends = new Set<number>();
  if (meta.compounding === 'bi-weekly') {
    // Drop the first credit date: it is where accrual begins, not a period end.
    for (const credit of biweeklyCreditDates(start, maturity).slice(1)) {
      if (credit < maturity) {
        ends.add(credit);
      }
    }
  } else {
    for (let k = 1; ; k += 1) {
      const boundary = periodBoundary(start, meta.compounding, k);
      if (boundary >= maturity) {
        break;
      }
      ends.add(boundary);
    }
  }
  ends.add(Math.min(now, maturity));
  ends.add(maturity);
  return [...ends].filter((end) => end > start).sort((a, b) => a - b);
};

// Builds the per-period deposit table. Opening/closing balances come straight
// from the value model, evaluated at each period end, so a row can never
// disagree with the headline value:
//   - recap-ON bi-weekly: the net-of-tax capitalized value (the engine already
//     withholds tax each period).
//   - recap-ON calendar: `depositCompoundedMajor` (principal + compounded gross).
//   - recap-OFF: principal + the CUMULATIVE interest accrued to date, NET of tax.
// The per-period interest is the change in cumulative interest across the period.
export const depositSchedule = (
  meta: TermDepositMeta,
  currency: Currency,
  now: number,
): DepositScheduleRow[] => {
  const contributions = meta.contributions.map((c) => ({
    amountMajor: toMajor(c.amountMinorUnits, currency),
    date: c.date,
  }));
  const start = Math.min(...contributions.map((c) => c.date));
  const maturity = addMonths(start, meta.termMonths);

  const principalAt = (at: number): number =>
    contributions.filter((c) => c.date <= at).reduce((sum, c) => sum + c.amountMajor, 0);
  // Principal credited by `at`, in minor units — the exact basis the headline
  // breakdown uses, so the tax-and-net arithmetic below reconciles to the cent.
  const principalMinorAt = (at: number): number =>
    meta.contributions.filter((c) => c.date <= at).reduce((sum, c) => sum + c.amountMinorUnits, 0);
  // Recap-off cumulative interest, net of tax, at `at` — computed on the exact
  // minor-unit basis `depositBreakdown` uses for the headline (gross interest
  // rounded to minor units, 23% tax floored), so the last schedule row's
  // closing equals the headline Value to the cent rather than drifting off it.
  const netInterestAt = (at: number): number => {
    const grossMinor = Money.fromMajor(
      currency,
      depositAccruedMajor(contributions, meta.annualRatePct, meta.termMonths, at),
    ).minorUnits;
    return toMajor(grossMinor - taxOnInterestMinor(grossMinor), currency);
  };
  // Recap-ON value at `at`, NET of the 23% withholding, on the SAME minor-unit
  // basis the headline uses — so the last schedule row's closing equals the
  // headline net Value exactly (not the gross, which overstates it by the tax).
  //   - bi-weekly: the engine withholds tax per period; round its gross interest
  //     and cumulative tax to minor units, then net = principal + interest - tax.
  //   - calendar: round the gross compounded value, derive interest over
  //     principal, floor the tax, then net = gross - tax.
  const compoundedValueAt = (at: number): number => {
    const principalMinor = principalMinorAt(at);
    if (meta.compounding === 'bi-weekly') {
      const result = depositBiweeklyMajor(
        contributions,
        meta.annualRatePct,
        INTEREST_TAX_RATE_PCT,
        start,
        at,
      );
      const interestMinor = Money.fromMajor(currency, result.grossInterestMajor).minorUnits;
      const taxMinor = Money.fromMajor(currency, result.taxMajor).minorUnits;
      return toMajor(principalMinor + interestMinor - taxMinor, currency);
    }
    const grossMinor = Money.fromMajor(
      currency,
      depositCompoundedMajor(
        contributions,
        meta.annualRatePct,
        meta.compounding,
        meta.termMonths,
        at,
      ),
    ).minorUnits;
    const interestMinor = Math.max(0, grossMinor - principalMinor);
    return toMajor(grossMinor - taxOnInterestMinor(interestMinor), currency);
  };
  const valueAt = (at: number): number =>
    meta.recapitalization ? compoundedValueAt(at) : principalAt(at) + netInterestAt(at);
  const cumulativeInterestAt = (at: number): number =>
    meta.recapitalization ? valueAt(at) - principalAt(at) : netInterestAt(at);

  let prevEnd = start;
  return depositPeriodEnds(meta, start, maturity, now).map((periodEnd) => {
    const row: DepositScheduleRow = {
      periodEnd,
      openingMajor: valueAt(prevEnd),
      contributionMajor: principalAt(periodEnd) - principalAt(prevEnd),
      interestMajor: cumulativeInterestAt(periodEnd) - cumulativeInterestAt(prevEnd),
      closingMajor: valueAt(periodEnd),
      isFuture: periodEnd > now,
    };
    prevEnd = periodEnd;
    return row;
  });
};

// Builds the per-coupon bond table: one row per coupon payment date (mid-month
// 15th, or the exact maturity date for the final coupon), the NET coupon paid
// that period, and the running cumulative net coupon. Coupons dated after `now`
// are projected. An un-purchased bond (purchase date in the future) has no
// schedule yet.
export const bondSchedule = (
  meta: BondMeta,
  currency: Currency,
  now: number,
): BondScheduleRow[] => {
  if (meta.purchaseDate > now) {
    return [];
  }
  const nominalMajor = toMajor(meta.quantity * meta.faceValueMinorUnits, currency);
  const grossCouponMinor = Money.fromMajor(
    currency,
    bondCouponMajor(nominalMajor, meta.couponPct, meta.couponFrequency),
  ).minorUnits;
  const netCouponMajor = toMajor(
    grossCouponMinor - (meta.bondKind === 'corporate' ? taxOnInterestMinor(grossCouponMinor) : 0),
    currency,
  );

  let cumulative = 0;
  return bondCouponDates(meta.purchaseDate, meta.maturityDate, meta.couponFrequency).map(
    (couponDate) => {
      cumulative += netCouponMajor;
      return {
        couponDate,
        couponMajor: netCouponMajor,
        cumulativeMajor: cumulative,
        isFuture: couponDate > now,
      };
    },
  );
};
