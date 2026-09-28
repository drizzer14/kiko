import { splitInterestTaxMinor } from '../tax';
import type { BondPayment, BondCouponFrequency, CompoundingFrequency } from '../holding-metadata';

const DAY_MS = 86_400_000;
const DAYS_PER_YEAR = 365;

// Calendar-anniversary compounding frequencies. `bi-weekly` is excluded: it is
// opening-day-anchored semi-monthly, whose period boundaries come from
// `biweeklyCredits` rather than the whole-month `periodBoundary` path (both
// feed the shared step-by-step `depositLedger` engine).
type CalendarCompounding = Exclude<CompoundingFrequency, 'bi-weekly'>;

const PERIODS_PER_YEAR: Record<CompoundingFrequency, number> = {
  'bi-weekly': 24,
  monthly: 12,
  quarterly: 4,
  annually: 1,
};

export const periodsPerYear = (frequency: CompoundingFrequency): number =>
  PERIODS_PER_YEAR[frequency];

// How many calendar months one compounding period spans.
const MONTHS_PER_PERIOD: Record<CalendarCompounding, number> = {
  monthly: 1,
  quarterly: 3,
  annually: 12,
};

const monthsPerPeriod = (frequency: CalendarCompounding): number => MONTHS_PER_PERIOD[frequency];

// Add (or subtract) whole calendar months, CLAMPING the day to the target
// month's length. A naive `setMonth(getMonth() + n)` overflows whenever the
// target month is shorter than the source day-of-month (31 Jan + 1 month ->
// 3 Mar, not 28 Feb), which silently fabricates or drops days of interest in
// every boundary built on it: `periodBoundary`, `depositMaturity`,
// `depositLedger`'s maturity, and `bondCouponDates`. This is the same clamp
// `midCredit` already applies to the bi-weekly path.
export const addMonths = (start: number, months: number): number => {
  const date = new Date(start);
  const targetMonthStart = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const year = targetMonthStart.getFullYear();
  const monthIndex = targetMonthStart.getMonth();
  const day = Math.min(date.getDate(), daysInMonth(year, monthIndex));
  const result = new Date(date);
  // Only the year/month/day fields are rewritten, so a non-midnight input
  // (a caller that hasn't normalized to local midnight) keeps its original
  // hour/minute/second/millisecond rather than being silently snapped to 00:00.
  result.setFullYear(year, monthIndex, day);

  return result.getTime();
};

// Whole CALENDAR days between the two instants' LOCAL dates. Normalizing each
// local Y/M/D to a UTC midnight before subtracting makes the count immune to
// Kyiv DST: a raw floor((end-start)/DAY_MS) under-counts by a day across the
// spring-forward (a period is 24h-1h short) and over-counts across the fall-back.
// Every boundary here is built with local-midnight arithmetic (atDay / midCredit
// / addMonths), so the local Y/M/D is the meaningful unit to diff.
export const daysBetween = (start: number, end: number): number => {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const startUtc = Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const endUtc = Date.UTC(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());

  return Math.max(0, Math.round((endUtc - startUtc) / DAY_MS));
};

// The k-th compounding boundary counted from `start`. Boundaries fall on the
// CALENDAR anniversaries of the deposit start (month arithmetic), so a period
// ends on the same day-of-month the bank recapitalizes on — never a fixed
// 365/periodsPerYear day slice that drifts off the calendar between
// anniversaries.
export const periodBoundary = (start: number, frequency: CalendarCompounding, k: number): number =>
  addMonths(start, k * monthsPerPeriod(frequency));

export const accruedMajor = (
  baseMajor: number,
  annualRatePct: number,
  daysElapsed: number,
): number => (baseMajor * (annualRatePct / 100) * daysElapsed) / DAYS_PER_YEAR;

type ContributionMajor = { amountMajor: number; date: number };

export const depositMaturity = (contributions: { date: number }[], termMonths: number): number =>
  addMonths(Math.min(...contributions.map((c) => c.date)), termMonths);

// The number of days in the calendar month that `instant` falls in.
const daysInMonth = (year: number, monthIndex: number): number =>
  new Date(year, monthIndex + 1, 0).getDate();

const atDay = (year: number, monthIndex: number, day: number): number =>
  new Date(year, monthIndex, day).getTime();

// The mid-month credit instant for a calendar month given the opening
// day-of-month D: the (D+1)-th of the month. If D+1 exceeds the month's length
// (or D itself does — e.g. D=31 in a 30-day month), the boundary collapses onto
// the 1st of the next month, so that month has a single period (Period B empty).
const midCredit = (year: number, monthIndex: number, openingDay: number): number => {
  const length = daysInMonth(year, monthIndex);
  const clampedDay = Math.min(openingDay, length);

  return clampedDay + 1 <= length
    ? atDay(year, monthIndex, clampedDay + 1)
    : atDay(year, monthIndex + 1, 1);
};

/** One bi-weekly credit instant, tagged with whether the bank capitalizes on
 * it — the mid-month (openingDay+1) credit does, the plain 1st-of-month
 * credit does not. `depositPeriods` (same file) reads the tag straight off
 * the instant that PRODUCED it, rather than re-deriving it from the instant's
 * own value (see `biweeklyCredits`'s own comment for why that re-derivation is
 * unsound). */
type BiweeklyCredit = { instant: number; capitalizes: boolean };

// The ordered, tagged capitalization ("credit") instants for an
// opening-day-anchored semi-monthly ("bi-weekly") deposit that are strictly
// after `start` and at or before `end`. Boundaries alternate between each
// month's mid-month credit (the day after the opening day-of-month,
// `capitalizes: true`) and the 1st of the next month (`capitalizes: false`).
// The first entry is always start + 1 day — the day accrual begins — because
// the deposit opened on the opening day itself earns from the next day.
//
// A month whose mid-credit COLLAPSES (openingDay+1 past the month's own
// length — 28 in a non-leap February, 29, 30, 31 — see `midCredit`) lands on
// the SAME instant as that month's own plain "1st" credit, since the collapse
// target IS `atDay(year, month+1, 1)`. Pushing the non-capitalizing "1st" on
// top of that instant would just duplicate it, so it is skipped and the
// mid-credit's own capitalizing tag stands for the month.
//
// This collapse is also why `capitalizes` can never be re-derived from an
// instant's own date value: a collapsed mid-credit and an ordinary
// non-capitalizing "1st" credit both land on the 1st of a month — the same
// shape of instant means opposite things depending on which month produced
// it — so only the tag recorded here, read straight off the credit that
// produced it, tells the two apart.
const biweeklyCredits = (start: number, end: number): BiweeklyCredit[] => {
  const openingDay = new Date(start).getDate();
  const first = new Date(start);
  let year = first.getFullYear();
  let month = first.getMonth();
  const credits: BiweeklyCredit[] = [];
  // Walk month by month; each month contributes its mid-month credit and the
  // following 1st. A generous guard bounds the loop for any realistic term.
  for (let guard = 0; guard < 2400; guard += 1) {
    const mid = midCredit(year, month, openingDay);
    const nextFirst = atDay(year, month + 1, 1);

    if (mid > start && mid <= end) {
      credits.push({ instant: mid, capitalizes: true });
    }

    if (nextFirst !== mid && nextFirst > start && nextFirst <= end) {
      credits.push({ instant: nextFirst, capitalizes: false });
    }

    if (nextFirst > end) {
      break;
    }
    month += 1;

    if (month > 11) {
      month = 0;
      year += 1;
    }
  }

  return credits;
};

// The local-midnight instant one calendar day after `instant`. Every capital
// tranche — a contribution or a block of capitalized interest — earns from the
// day AFTER it lands: a deposit opened on the 11th earns from the 12th, a top-up
// on the 10th earns from the 11th, interest capitalized on the 12th earns from
// the 13th. Built with local Y/M/D arithmetic so it stays DST-safe (see
// `daysBetween`).
const dayAfter = (instant: number): number => {
  const d = new Date(instant);

  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
};

type DepositPeriod = { periodStart: number; periodEnd: number; capitalize: boolean };

// The ordered accrual periods over a deposit's whole life (start .. maturity).
// Each period ends on an accrual/credit instant and is flagged whether the
// bank CAPITALIZES on that instant:
//   - bi-weekly (default): two accruals a month — one on the 1st (the
//     [12th..EOM] period, NOT capitalized) and one on the (openingDay+1)=12th
//     (the [1st..11th] period, capitalized). Capitalization once a month.
//   - monthly / quarterly / annually: a single accrual per calendar-anniversary
//     period, capitalized on every boundary.
// A trailing partial period runs to maturity and capitalizes there.
const depositPeriods = (
  start: number,
  maturity: number,
  frequency: CompoundingFrequency,
): DepositPeriod[] => {
  const periods: DepositPeriod[] = [];

  if (frequency === 'bi-weekly') {
    const credits = biweeklyCredits(start, maturity);
    // credits[0] is where accrual begins (the day after opening); every later
    // credit closes a period, capitalizing exactly when THAT credit's own tag
    // says so (see `biweeklyCredits`'s comment for why this must read the tag
    // off the credit itself rather than re-derive it from the date alone).
    // The period ending AT maturity always capitalizes, even when maturity
    // coincides with what would otherwise be a plain, non-capitalizing credit
    // (an opening day of 1 lands maturity on December's own "1st" credit).
    for (let i = 0; i < credits.length - 1; i += 1) {
      periods.push({
        periodStart: credits[i].instant,
        periodEnd: credits[i + 1].instant,
        capitalize: credits[i + 1].capitalizes || credits[i + 1].instant === maturity,
      });
    }
    const last = credits[credits.length - 1]?.instant ?? start;

    if (maturity > last) {
      periods.push({ periodStart: last, periodEnd: maturity, capitalize: true });
    }

    return periods;
  }
  let previous = start;

  for (let k = 1; ; k += 1) {
    const boundary = periodBoundary(start, frequency, k);

    if (boundary >= maturity) {
      break;
    }
    periods.push({ periodStart: previous, periodEnd: boundary, capitalize: true });
    previous = boundary;
  }

  if (maturity > previous) {
    periods.push({ periodStart: previous, periodEnd: maturity, capitalize: true });
  }

  return periods;
};

type DepositContributionMinor = { amountMinor: number; date: number };

// One accrual event in the deposit ledger: the interest earned over a single
// period, its two withholding lines (18% income + 5% military, each rounded to
// the minor unit separately), the net, and — when the bank capitalizes on this
// instant — the block of net interest folded into the balance and the resulting
// capitalized balance. Amounts are all integer minor units.
type DepositAccrual = {
  date: number;
  periodStart: number;
  grossMinor: number;
  incomeTaxMinor: number;
  militaryLevyMinor: number;
  netMinor: number;
  capitalized: boolean;
  capitalizationMinor: number;
  balanceAfterMinor: number;
};

// The full deposit ledger, computed step by step against a real bank statement.
// `accruals` spans the whole life (past and projected); `currentValueMinor` and
// the capitalized totals are as of `now` (the in-progress, not-yet-capitalized
// accrual is excluded from the value — that is the fix for the old overvaluation).
type DepositLedger = {
  accruals: DepositAccrual[];
  principalMinor: number;
  currentValueMinor: number;
  capitalizedGrossMinor: number;
  capitalizedTaxMinor: number;
};

// The step-by-step recap-ON deposit engine. Interest each period is computed on
// the LAST CAPITALIZED balance (accrued-but-uncapitalized interest does not
// earn): every capital tranche earns actual/365 from the day after it lands, so
// the period gross is the sum over tranches of amount * rate * days / 365,
// rounded to the minor unit. Tax is withheld as two separately-rounded levies
// (18% + 5%). On a capitalization instant the net interest accrued since the
// last capitalization is folded into the balance as a new tranche (earning from
// the next day), so the following periods compound on it. The current value is
// the last capitalized balance plus contributions landed by `now`.
export const depositLedger = (
  contributions: DepositContributionMinor[],
  annualRatePct: number,
  frequency: CompoundingFrequency,
  termMonths: number,
  now: number,
): DepositLedger => {
  const sorted = [...contributions].sort((a, b) => a.date - b.date);
  const start = sorted[0]?.date ?? now;
  const maturity = addMonths(start, termMonths);
  const rate = annualRatePct / 100;

  const tranches: { amountMinor: number; earnFrom: number }[] = sorted.map((c) => ({
    amountMinor: c.amountMinor,
    earnFrom: dayAfter(c.date),
  }));
  const contributedBy = (at: number): number =>
    sorted.filter((c) => c.date <= at).reduce((sum, c) => sum + c.amountMinor, 0);

  const accruals: DepositAccrual[] = [];
  let capitalizedInterestMinor = 0;
  // The gross interest withheld against so far, across the deposit's whole life.
  // The bank withholds each levy on this running cumulative basis (see
  // `splitInterestTaxMinor`), which is what makes every ledger line match the
  // statement to the kopeck rather than drifting ±1.
  let cumulativeGrossMinor = 0;
  let pendingGrossMinor = 0;
  let pendingTaxMinor = 0;
  let pendingNetMinor = 0;
  let capitalizedGrossMinor = 0;
  let capitalizedTaxMinor = 0;
  let capitalizedNetMinor = 0;

  for (const { periodStart, periodEnd, capitalize } of depositPeriods(start, maturity, frequency)) {
    let grossExact = 0;

    for (const tranche of tranches) {
      const days = daysBetween(Math.max(tranche.earnFrom, periodStart), periodEnd);
      grossExact += (tranche.amountMinor * rate * days) / DAYS_PER_YEAR;
    }
    const grossMinor = Math.round(grossExact);
    const { incomeMinor, militaryMinor, totalMinor } = splitInterestTaxMinor(
      grossMinor,
      cumulativeGrossMinor,
    );
    cumulativeGrossMinor += grossMinor;
    const netMinor = grossMinor - totalMinor;
    pendingGrossMinor += grossMinor;
    pendingTaxMinor += totalMinor;
    pendingNetMinor += netMinor;

    let capitalizationMinor = 0;

    if (capitalize) {
      capitalizationMinor = pendingNetMinor;
      capitalizedInterestMinor += pendingNetMinor;
      tranches.push({ amountMinor: pendingNetMinor, earnFrom: dayAfter(periodEnd) });

      if (periodEnd <= now) {
        capitalizedGrossMinor += pendingGrossMinor;
        capitalizedTaxMinor += pendingTaxMinor;
        capitalizedNetMinor += pendingNetMinor;
      }
      pendingGrossMinor = 0;
      pendingTaxMinor = 0;
      pendingNetMinor = 0;
    }

    accruals.push({
      date: periodEnd,
      periodStart,
      grossMinor,
      incomeTaxMinor: incomeMinor,
      militaryLevyMinor: militaryMinor,
      netMinor,
      capitalized: capitalize,
      capitalizationMinor,
      balanceAfterMinor: contributedBy(periodEnd) + capitalizedInterestMinor,
    });
  }

  const principalMinor = contributedBy(now);

  return {
    accruals,
    principalMinor,
    currentValueMinor: principalMinor + capitalizedNetMinor,
    capitalizedGrossMinor,
    capitalizedTaxMinor,
  };
};

// Recap-off deposits pay interest out each period rather than compounding it.
// We surface the CUMULATIVE simple interest earned to date: each contribution
// accrues actual/365 from the day AFTER it lands to `end` (now, capped at the
// single maturity anchored to the earliest contribution). Future-dated
// contributions are excluded. No per-period reset — a matured or
// multi-contribution deposit no longer collapses to zero.
//
// The day-after start (`dayAfter(c.date)`, not `c.date`) matches the
// statement-validated recap-ON engine (`depositLedger`), where every capital
// tranche earns from `dayAfter` its landing: a deposit opened on the 11th earns
// from the 12th. Accruing from the contribution date itself counted one extra
// day, so recap-OFF and recap-ON disagreed on the first-period accrual.
export const depositAccruedMajor = (
  contributions: ContributionMajor[],
  annualRatePct: number,
  termMonths: number,
  now: number,
): number => {
  const active = contributions.filter((c) => c.date <= now);

  if (active.length === 0) {
    return 0;
  }
  const maturity = depositMaturity(active, termMonths);
  const end = Math.min(now, maturity);

  return active.reduce(
    (sum, c) =>
      sum + accruedMajor(c.amountMajor, annualRatePct, daysBetween(dayAfter(c.date), end)),
    0,
  );
};

// How many calendar months one bond coupon period spans.
const MONTHS_PER_COUPON_PERIOD: Record<BondCouponFrequency, number> = {
  monthly: 1,
  quarterly: 3,
  semiannually: 6,
  annually: 12,
};

export const monthsPerCouponPeriod = (frequency: BondCouponFrequency): number =>
  MONTHS_PER_COUPON_PERIOD[frequency];

// The 15th ("middle") of the calendar month that `instant` falls in.
const midMonth = (instant: number): number => {
  const d = new Date(instant);

  return atDay(d.getFullYear(), d.getMonth(), 15);
};

// The coupon payment dates for a bond, in ascending order. Coupons are anchored
// to the MATURITY date: step back from maturity by the coupon interval; each
// regular coupon lands on the 15th of its month, and the coupon in the maturity
// month lands on the exact maturity date. Only coupons strictly after the
// purchase date are returned. This matches the user's bank statement (e.g. a
// semiannual bond maturing 14 Oct 2026 pays on 15 Oct 2025, 15 Apr 2026, and
// 14 Oct 2026).
export const bondCouponDates = (
  purchaseDate: number,
  maturityDate: number,
  frequency: BondCouponFrequency,
): number[] => {
  const months = monthsPerCouponPeriod(frequency);
  const dates: number[] = [];

  for (let k = 0; k < 2000; k += 1) {
    const stepped = addMonths(maturityDate, -k * months);
    const couponDate = k === 0 ? maturityDate : midMonth(stepped);

    if (couponDate <= purchaseDate) {
      break;
    }
    dates.push(couponDate);
  }

  // A month-end maturity can step onto the same 15th twice once `addMonths`
  // clamps two different `k` steps onto the same calendar day, so de-dup via
  // `Set` before sorting into ascending coupon-date order.
  return [...new Set(dates)].sort((a, b) => a - b);
};

/**
 * One coupon a bond's issuer schedules (the NBU register's payments): the
 * exact decimal amount paid for ONE bond on `date`.
 */
export type BondCouponPayment = Pick<BondPayment, 'date' | 'amount'>;

/**
 * The scheduled coupon a ledger coupon date stands for, or undefined without
 * one. The ledger books a coupon on the 15th of its month (the bank
 * statement's day) while the issuer lists it a few days away, never half a
 * period away, so the closest payment is the one paid on that date. A closest
 * payment more than half a period away belongs to another date, so the caller
 * falls back to the saved coupon for this one.
 */
export const couponPaymentOn = (
  payments: readonly BondCouponPayment[],
  date: number,
  frequency: BondCouponFrequency,
): BondCouponPayment | undefined => {
  const halfPeriodMs = (monthsPerCouponPeriod(frequency) * DAYS_PER_YEAR * DAY_MS) / 24;
  const closest = payments.reduce<BondCouponPayment | undefined>(
    (nearest, payment) =>
      nearest === undefined || Math.abs(payment.date - date) < Math.abs(nearest.date - date)
        ? payment
        : nearest,
    undefined,
  );

  return closest !== undefined && Math.abs(closest.date - date) <= halfPeriodMs
    ? closest
    : undefined;
};

// The amount of a single coupon (major units): nominal * couponPct/100 divided
// by the number of coupons per year (12 / months-per-period).
export const bondCouponMajor = (
  nominalMajor: number,
  couponPct: number,
  frequency: BondCouponFrequency,
): number => (nominalMajor * (couponPct / 100)) / (12 / monthsPerCouponPeriod(frequency));
