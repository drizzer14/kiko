import { Money } from '../currency/money';
import type { BondMeta, TermDepositMeta } from './holding-metadata';
import type { ValuableHolding } from './holding-value';
import { holdingValueBreakdown } from './holding-value';
import { addMonths } from './interest';
import { bondSchedule, depositSchedule } from './schedule';

// A term_deposit holding wrapper so a schedule row can be reconciled against the
// headline value model at any period end.
const depositHolding = (meta: TermDepositMeta): ValuableHolding => ({
  type: 'term_deposit',
  currency: 'UAH',
  balanceMinorUnits: 0,
  metadata: meta,
});

// Closing majors and headline nets are compared on the exact minor-unit basis,
// so a row can never disagree with the Value by even a cent.
const closingMinor = (closingMajor: number): number =>
  Money.fromMajor('UAH', closingMajor).minorUnits;

const START = Date.UTC(2024, 0, 1);

// Local-midnight instant, matching the local Date arithmetic the bi-weekly and
// bond-coupon helpers use.
const local = (year: number, monthIndex: number, day: number): number =>
  new Date(year, monthIndex, day).getTime();

const deposit = (over: Partial<TermDepositMeta> = {}): TermDepositMeta => ({
  contributions: [{ amountMinorUnits: 1_000_000, date: START }], // 10,000.00
  annualRatePct: 12,
  termMonths: 3,
  recapitalization: true,
  compounding: 'monthly',
  ...over,
});

describe('depositSchedule — recap on', () => {
  const rows = depositSchedule(deposit(), 'UAH', addMonths(START, 3));

  it('emits one row per calendar period from the start to maturity', () => {
    expect(rows).toHaveLength(3);
    expect(rows[0].periodEnd).toBe(addMonths(START, 1));
    expect(rows[1].periodEnd).toBe(addMonths(START, 2));
    expect(rows[2].periodEnd).toBe(addMonths(START, 3));
    expect(rows.every((row) => row.isFuture === false)).toBe(true);
  });

  it('rolls each period NET of tax: opening + net interest = closing on the anniversary', () => {
    // Recap-on calendar closing is net of the 23% withholding, on the same
    // minor-unit basis as the headline Value (gross rounded, tax floored):
    // month 1 gross 10,100 - 23.00 tax = 10,077.00; month 2 gross 10,201.00 -
    // 46.23 = 10,154.77; month 3 gross 10,303.01 - 69.69 = 10,233.32.
    expect(rows[0].openingMajor).toBeCloseTo(10000, 2);
    expect(rows[0].contributionMajor).toBeCloseTo(0, 2);
    expect(rows[0].interestMajor).toBeCloseTo(77, 2);
    expect(rows[0].closingMajor).toBeCloseTo(10077, 2);

    expect(rows[1].openingMajor).toBeCloseTo(10077, 2);
    expect(rows[1].interestMajor).toBeCloseTo(77.77, 2);
    expect(rows[1].closingMajor).toBeCloseTo(10154.77, 2);

    expect(rows[2].closingMajor).toBeCloseTo(10233.32, 2);
  });

  it('never disagrees with the value model: each closing equals the headline net Value at its period end', () => {
    const holding = depositHolding(deposit());
    for (const row of rows) {
      const headline = holdingValueBreakdown(holding, row.periodEnd);
      expect(closingMinor(row.closingMajor)).toBe(headline.net.minorUnits);
    }
  });

  it("last row's closing equals the headline net Value (recap-on calendar, taxed)", () => {
    const meta = deposit();
    const maturity = addMonths(START, 3);
    const scheduled = depositSchedule(meta, 'UAH', maturity);
    const headline = holdingValueBreakdown(depositHolding(meta), maturity);
    // A non-degenerate case: interest is actually taxed, so gross != net.
    expect(headline.tax.minorUnits).toBeGreaterThan(0);
    // The gross close would be 10,303.01; the headline net is ~10,233.32.
    expect(scheduled.at(-1)?.closingMajor).toBeCloseTo(10233.32, 2);
    expect(closingMinor(scheduled.at(-1)?.closingMajor ?? 0)).toBe(headline.net.minorUnits);
  });

  it('credits a mid-term top-up in the period that contains its date', () => {
    const meta = deposit({
      contributions: [
        { amountMinorUnits: 1_000_000, date: START }, // 10,000.00
        { amountMinorUnits: 500_000, date: Date.UTC(2024, 3, 10) }, // +5,000.00 on 2024-04-10
      ],
      termMonths: 24,
    });
    const schedule = depositSchedule(meta, 'UAH', Date.UTC(2025, 0, 1));
    // The top-up falls in the [Apr 1, May 1) period, so it is the contribution
    // of the row that closes on the May-1 anniversary — nowhere earlier.
    const mayRow = schedule.find((row) => row.periodEnd === addMonths(START, 4));
    expect(mayRow?.contributionMajor).toBeCloseTo(5000, 2);
    const earlier = schedule.filter((row) => row.periodEnd < addMonths(START, 4));
    expect(earlier.every((row) => row.contributionMajor === 0)).toBe(true);
  });

  it('marks periods after now as future (projected, greyed in the UI)', () => {
    const schedule = depositSchedule(deposit({ termMonths: 6 }), 'UAH', addMonths(START, 2));
    expect(schedule.some((row) => row.isFuture)).toBe(true);
    expect(schedule.filter((row) => !row.isFuture).length).toBeGreaterThan(0);
    // The final row is maturity, in the future here.
    expect(schedule[schedule.length - 1].periodEnd).toBe(addMonths(START, 6));
    expect(schedule[schedule.length - 1].isFuture).toBe(true);
  });
});

describe('depositSchedule — recap off', () => {
  const recapOff = (): TermDepositMeta =>
    deposit({
      termMonths: 12,
      recapitalization: false,
      contributions: [{ amountMinorUnits: 1_000_000, date: START }], // 10,000.00
      annualRatePct: 10,
    });

  it('grows the closing balance by the cumulative interest accrued to each period end', () => {
    const meta = recapOff();
    const rows = depositSchedule(meta, 'UAH', addMonths(START, 12));
    // The closing now counts the net-of-tax interest paid out to date, so it
    // rises above principal and is monotonically non-decreasing period to period.
    expect(rows[0].closingMajor).toBeGreaterThan(10000);
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i].closingMajor).toBeGreaterThanOrEqual(rows[i - 1].closingMajor);
    }
    // Each period still reports the interest earned that period.
    expect(rows.every((row) => row.interestMajor > 0)).toBe(true);
  });

  it("last row's closing equals the headline Value from holdingValueBreakdown (recap-off, taxed)", () => {
    const meta = recapOff();
    const maturity = addMonths(START, 12);
    const rows = depositSchedule(meta, 'UAH', maturity);
    const holding: ValuableHolding = {
      type: 'term_deposit',
      currency: 'UAH',
      balanceMinorUnits: 0,
      metadata: meta,
    };
    const headline = holdingValueBreakdown(holding, maturity);
    // A meaningful (non-degenerate) case: interest is actually taxed.
    expect(headline.tax.minorUnits).toBeGreaterThan(0);
    // The schedule's final closing must not disagree with the headline Value.
    expect(rows.at(-1)?.closingMajor).toBeCloseTo(headline.net.minorUnits / 100, 2);
  });
});

describe('depositSchedule — bi-weekly (opening-day-anchored semi-monthly)', () => {
  // Opened 11 Jan 2024 (D=11): two credit dates per month, at the 1st and the
  // 12th, so a bi-weekly term produces ~twice-monthly rows.
  const biweekly = (): TermDepositMeta =>
    deposit({
      contributions: [{ amountMinorUnits: 1_000_000, date: local(2024, 0, 11) }],
      annualRatePct: 12,
      termMonths: 3,
      recapitalization: true,
      compounding: 'bi-weekly',
    });

  it('lands rows on the bi-weekly credit dates (Feb 1/12, Mar 1/12, ...)', () => {
    const rows = depositSchedule(biweekly(), 'UAH', local(2024, 3, 11));
    const dates = rows.map((row) => row.periodEnd);
    expect(dates).toContain(local(2024, 1, 1)); // Feb 1
    expect(dates).toContain(local(2024, 1, 12)); // Feb 12
    expect(dates).toContain(local(2024, 2, 1)); // Mar 1
    expect(dates).toContain(local(2024, 2, 12)); // Mar 12
    // No phantom row on the first accrual date (12 Jan) — that is the start, not
    // a period end.
    expect(dates).not.toContain(local(2024, 0, 12));
  });

  it('closes each row on the net-of-tax bi-weekly value at that credit date (cent-exact)', () => {
    const meta = biweekly();
    const holding = depositHolding(meta);
    const rows = depositSchedule(meta, 'UAH', local(2024, 3, 11));
    for (const row of rows) {
      const headline = holdingValueBreakdown(holding, row.periodEnd);
      expect(closingMinor(row.closingMajor)).toBe(headline.net.minorUnits);
    }
  });

  it("last row's closing equals the headline net Value from holdingValueBreakdown (cent-exact)", () => {
    const meta = biweekly();
    const maturity = local(2024, 3, 11);
    const rows = depositSchedule(meta, 'UAH', maturity);
    const headline = holdingValueBreakdown(depositHolding(meta), maturity);
    expect(headline.tax.minorUnits).toBeGreaterThan(0);
    // Cent-exact: the schedule closing rounds gross interest and tax to minor
    // units the same way the headline does (Finding 4), so no 1-cent gap.
    expect(closingMinor(rows.at(-1)?.closingMajor ?? 0)).toBe(headline.net.minorUnits);
  });
});

// The Monobank screenshot bond: 100,000.00 nominal, 16.35% semiannual, bought
// 18 Sep 2025, matures 14 Oct 2026. Government => coupons untaxed = 8,175.00.
const bond = (over: Partial<BondMeta> = {}): BondMeta => ({
  quantity: 100,
  faceValueMinorUnits: 100_000, // 1,000.00 each
  couponPct: 16.35,
  purchaseDate: local(2025, 8, 18),
  purchasePriceMinorUnits: 10_786_800,
  maturityDate: local(2026, 9, 14),
  bondKind: 'government',
  couponFrequency: 'semiannually',
  ...over,
});

describe('bondSchedule', () => {
  const NOW = local(2025, 11, 1); // 1 Dec 2025, after the first coupon
  const rows = bondSchedule(bond(), 'UAH', NOW);

  it('emits one row per coupon date (15 Oct 2025, 15 Apr 2026, 14 Oct 2026)', () => {
    expect(rows.map((row) => row.couponDate)).toEqual([
      local(2025, 9, 15),
      local(2026, 3, 15),
      local(2026, 9, 14),
    ]);
  });

  it('pays the full net coupon each period (8,175.00, government => untaxed)', () => {
    expect(rows.every((row) => Math.round(row.couponMajor) === 8175)).toBe(true);
    expect(rows[0].cumulativeMajor).toBeCloseTo(8175, 2);
  });

  it('withholds 23% on a corporate bond coupon', () => {
    const corp = bondSchedule(bond({ bondKind: 'corporate' }), 'UAH', NOW);
    // 8,175.00 gross - floor(23%) => 6,294.75 net.
    expect(corp[0].couponMajor).toBeCloseTo(6294.75, 2);
  });

  it('accumulates cumulative coupon across the rows', () => {
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i].cumulativeMajor).toBeCloseTo(
        rows[i - 1].cumulativeMajor + rows[i].couponMajor,
        6,
      );
    }
  });

  it('marks coupon dates after now as future', () => {
    // The first coupon (15 Oct 2025) is past; the later two are future.
    expect(rows[0].isFuture).toBe(false);
    expect(rows[1].isFuture).toBe(true);
    expect(rows[2].isFuture).toBe(true);
  });

  it('handles monthly and annual coupon frequencies under the same rule', () => {
    const monthly = bondSchedule(
      bond({ couponFrequency: 'monthly', maturityDate: local(2026, 0, 20) }),
      'UAH',
      NOW,
    );
    // Monthly coupon = 100,000 * 16.35% / 12 = 1,362.50; final lands on maturity.
    expect(monthly.every((row) => Math.abs(row.couponMajor - 1362.5) < 0.01)).toBe(true);
    expect(monthly.at(-1)?.couponDate).toBe(local(2026, 0, 20));

    const annual = bondSchedule(
      bond({ couponFrequency: 'annually', maturityDate: local(2027, 9, 14) }),
      'UAH',
      NOW,
    );
    // Annual coupon = full 16,350.00; final lands on the maturity date.
    expect(annual.every((row) => Math.round(row.couponMajor) === 16350)).toBe(true);
    expect(annual.at(-1)?.couponDate).toBe(local(2027, 9, 14));
  });

  it('returns no schedule for a bond purchased in the future (guard)', () => {
    expect(
      bondSchedule(bond({ purchaseDate: local(2025, 8, 18) }), 'UAH', local(2025, 8, 17)),
    ).toEqual([]);
  });
});
