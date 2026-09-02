import type { BondCouponFrequency, CompoundingFrequency } from './holding-metadata';

const DAY_MS = 86_400_000;
const DAYS_PER_YEAR = 365;

// Calendar-anniversary compounding frequencies. `bi-weekly` is excluded: it is
// opening-day-anchored semi-monthly, handled by its own engine
// (`depositBiweeklyMajor`) rather than the whole-month `periodBoundary` path.
type CalendarCompounding = Exclude<CompoundingFrequency, 'bi-weekly'>;

export const periodsPerYear = (frequency: CompoundingFrequency): number => {
  switch (frequency) {
    case 'bi-weekly':
      return 24;
    case 'monthly':
      return 12;
    case 'quarterly':
      return 4;
    case 'annually':
      return 1;
  }
};

// How many calendar months one compounding period spans.
const monthsPerPeriod = (frequency: CalendarCompounding): number => {
  switch (frequency) {
    case 'monthly':
      return 1;
    case 'quarterly':
      return 3;
    case 'annually':
      return 12;
  }
};

export const addMonths = (start: number, months: number): number => {
  const date = new Date(start);
  date.setMonth(date.getMonth() + months);
  return date.getTime();
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

// The value of a single contribution valued at `end`, compounded on the deposit
// schedule anchored at `start` (the earliest contribution). A whole completed
// period earns the nominal periodic rate (annualRatePct / periodsPerYear); the
// trailing incomplete period — and the partial first period of a mid-term
// top-up — accrues simple interest actual/365 (`accruedMajor`). A contribution
// dated exactly on a boundary joins that period at full rate (no partial stub).
const contributionValue = (
  amountMajor: number,
  contribDate: number,
  start: number,
  annualRatePct: number,
  frequency: CalendarCompounding,
  end: number,
): number => {
  if (end <= contribDate) {
    return amountMajor;
  }
  const nominalPeriodRate = annualRatePct / 100 / periodsPerYear(frequency);

  // The period that contains the contribution: `prevBoundary` opens it,
  // `firstBoundary` is the first boundary strictly after the contribution.
  let k = 1;
  while (periodBoundary(start, frequency, k) <= contribDate) {
    k += 1;
  }
  const firstBoundary = periodBoundary(start, frequency, k);
  const prevBoundary = periodBoundary(start, frequency, k - 1);

  let balance = amountMajor;
  // `compoundFrom` is the boundary index from which whole periods compound.
  let compoundFrom = k;
  if (contribDate > prevBoundary) {
    // Mid-period top-up: accrue the partial first period simple, actual/365.
    const stubEnd = Math.min(firstBoundary, end);
    balance += accruedMajor(amountMajor, annualRatePct, daysBetween(contribDate, stubEnd));
    if (end <= firstBoundary) {
      return balance;
    }
  } else {
    // Dated exactly on a boundary: it opens a full period, so compound from it.
    compoundFrom = k - 1;
  }

  let idx = compoundFrom;
  while (periodBoundary(start, frequency, idx + 1) <= end) {
    balance *= 1 + nominalPeriodRate;
    idx += 1;
  }
  const trailingDays = daysBetween(periodBoundary(start, frequency, idx), end);
  return balance * (1 + (annualRatePct / 100) * (trailingDays / DAYS_PER_YEAR));
};

type ContributionMajor = { amountMajor: number; date: number };

export const depositMaturity = (contributions: { date: number }[], termMonths: number): number =>
  addMonths(Math.min(...contributions.map((c) => c.date)), termMonths);

export const depositCompoundedMajor = (
  contributions: ContributionMajor[],
  annualRatePct: number,
  frequency: CalendarCompounding,
  termMonths: number,
  now: number,
): number => {
  // A contribution dated after `now` is not yet credited — exclude it so a
  // future top-up never inflates the present value.
  const active = contributions.filter((c) => c.date <= now);
  if (active.length === 0) {
    return 0;
  }
  const maturity = depositMaturity(active, termMonths);
  const start = Math.min(...active.map((c) => c.date));
  const end = Math.min(now, maturity);
  return active.reduce(
    (sum, c) =>
      sum + contributionValue(c.amountMajor, c.date, start, annualRatePct, frequency, end),
    0,
  );
};

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

// The ordered capitalization ("credit") instants for an opening-day-anchored
// semi-monthly ("bi-weekly") deposit that are strictly after `start` and at or
// before `end`. Boundaries alternate between each month's mid-month credit (the
// day after the opening day-of-month) and the 1st of the next month. The first
// entry is always start + 1 day — the day accrual begins — because the deposit
// opened on the opening day itself earns from the next day.
export const biweeklyCreditDates = (start: number, end: number): number[] => {
  const openingDay = new Date(start).getDate();
  const first = new Date(start);
  let year = first.getFullYear();
  let month = first.getMonth();
  const dates: number[] = [];
  // Walk month by month; each month contributes its mid-month credit and the
  // following 1st. A generous guard bounds the loop for any realistic term.
  for (let guard = 0; guard < 2400; guard += 1) {
    const mid = midCredit(year, month, openingDay);
    const nextFirst = atDay(year, month + 1, 1);
    for (const instant of [mid, nextFirst]) {
      if (instant > start && instant <= end) {
        dates.push(instant);
      }
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
  // The clamp case makes `mid === nextFirst`; de-dup and sort to a clean stream.
  return [...new Set(dates)].sort((a, b) => a - b);
};

type BiweeklyResult = {
  principalMajor: number;
  grossInterestMajor: number;
  taxMajor: number;
  netValueMajor: number;
};

// Opening-day-anchored semi-monthly ("bi-weekly") compounding. Walks the credit
// dates from `start` to `end`; each period accrues simple actual/365 interest on
// the running balance (plus any mid-period contribution weighted from its
// landing date), withholds `taxRatePct` of that interest, and capitalizes the
// NET remainder into the balance on the credit date — matching a Ukrainian bank
// statement, which pays and compounds interest net of the 23% withholding. The
// trailing partial period accrues to `end` (the current, not-yet-credited
// interest). Returns principal, cumulative gross interest, cumulative tax, and
// the net value (= principal + gross - tax = the running balance).
export const depositBiweeklyMajor = (
  contributions: ContributionMajor[],
  annualRatePct: number,
  taxRatePct: number,
  start: number,
  end: number,
): BiweeklyResult => {
  const credits = biweeklyCreditDates(start, end);
  const points =
    credits.length > 0 && end > credits[credits.length - 1] ? [...credits, end] : credits;
  const sorted = [...contributions].sort((a, b) => a.date - b.date);
  const firstAccrual = points[0] ?? end;
  const rate = annualRatePct / 100;

  let balance = 0;
  let principal = 0;
  let grossInterest = 0;
  let tax = 0;
  let idx = 0;

  // Opening principal: contributions deposited before the first accrual instant
  // (i.e. on/before the opening day) join the balance and earn the first period.
  while (idx < sorted.length && sorted[idx].date < firstAccrual) {
    balance += sorted[idx].amountMajor;
    principal += sorted[idx].amountMajor;
    idx += 1;
  }

  for (let i = 0; i < points.length - 1; i += 1) {
    const pStart = points[i];
    const pEnd = points[i + 1];
    let periodGross = balance * rate * (daysBetween(pStart, pEnd) / DAYS_PER_YEAR);
    // Contributions landing inside [pStart, pEnd) earn from their own date and
    // then join the running balance for subsequent periods.
    while (idx < sorted.length && sorted[idx].date < pEnd) {
      const c = sorted[idx];
      const heldDays = daysBetween(Math.max(c.date, pStart), pEnd);
      periodGross += c.amountMajor * rate * (heldDays / DAYS_PER_YEAR);
      balance += c.amountMajor;
      principal += c.amountMajor;
      idx += 1;
    }
    const periodTax = taxRatePct > 0 ? periodGross * (taxRatePct / 100) : 0;
    grossInterest += periodGross;
    tax += periodTax;
    balance += periodGross - periodTax;
  }

  // Any remaining active contributions (dated at/after `end`, or after maturity)
  // are still real deposits: count them as principal, but they earn no interest.
  while (idx < sorted.length) {
    balance += sorted[idx].amountMajor;
    principal += sorted[idx].amountMajor;
    idx += 1;
  }

  return {
    principalMajor: principal,
    grossInterestMajor: grossInterest,
    taxMajor: tax,
    netValueMajor: balance,
  };
};

// Recap-off deposits pay interest out each period rather than compounding it.
// We surface the CUMULATIVE simple interest earned to date: each contribution
// accrues actual/365 from its own date to `end` (now, capped at the single
// maturity anchored to the earliest contribution). Future-dated contributions
// are excluded. No per-period reset — a matured or multi-contribution deposit
// no longer collapses to zero.
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
    (sum, c) => sum + accruedMajor(c.amountMajor, annualRatePct, daysBetween(c.date, end)),
    0,
  );
};

// How many calendar months one bond coupon period spans.
export const monthsPerCouponPeriod = (frequency: BondCouponFrequency): number => {
  switch (frequency) {
    case 'monthly':
      return 1;
    case 'quarterly':
      return 3;
    case 'semiannually':
      return 6;
    case 'annually':
      return 12;
  }
};

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
  return dates.sort((a, b) => a - b);
};

// The amount of a single coupon (major units): nominal * couponPct/100 divided
// by the number of coupons per year (12 / months-per-period).
export const bondCouponMajor = (
  nominalMajor: number,
  couponPct: number,
  frequency: BondCouponFrequency,
): number => (nominalMajor * (couponPct / 100)) / (12 / monthsPerCouponPeriod(frequency));

// Dirty-price coupon accrual (gross, major units): the portion of the next
// coupon earned so far, pro-rated by days within the CURRENT coupon period. The
// current period runs from the last coupon date at/before `now` (or the purchase
// date, before the first coupon) to the next coupon date (or maturity). Accrues
// nothing before purchase or at/after maturity — at maturity the nominal is
// redeemed, so the held value drops to zero.
export const bondAccruedGrossMajor = (
  nominalMajor: number,
  couponPct: number,
  frequency: BondCouponFrequency,
  purchaseDate: number,
  maturityDate: number,
  now: number,
): number => {
  if (purchaseDate > now || now >= maturityDate) {
    return 0;
  }
  const coupons = bondCouponDates(purchaseDate, maturityDate, frequency);
  const prior = coupons.filter((c) => c <= now);
  const lastCoupon = prior.length > 0 ? prior[prior.length - 1] : purchaseDate;
  const nextCoupon = coupons.find((c) => c > now) ?? maturityDate;
  const periodDays = daysBetween(lastCoupon, nextCoupon);
  if (periodDays === 0) {
    return 0;
  }
  const sinceDays = daysBetween(lastCoupon, now);
  return bondCouponMajor(nominalMajor, couponPct, frequency) * (sinceDays / periodDays);
};
