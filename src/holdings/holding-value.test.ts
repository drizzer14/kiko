import { Money } from '../currency/money';
import { asBondMeta } from './holding-metadata';
import {
  bondExpectedProfitMinor,
  holdingValue,
  type HoldingValueBreakdown,
  holdingValueBreakdown,
  type ValuableHolding,
} from './holding-value';

const base = { currency: 'UAH' as const, balanceMinorUnits: 0, metadata: null };
const START = Date.UTC(2026, 0, 1);
const day = 86_400_000;
const AFTER_1Y = START + 365 * day;

// Local-midnight instant, matching the local Date arithmetic the coupon-date
// helpers use.
const local = (year: number, monthIndex: number, dayOfMonth: number): number =>
  new Date(year, monthIndex, dayOfMonth).getTime();

// The Monobank screenshot bond: 100 bonds of 1,000.00 nominal each (100,000.00
// nominal), bought 18 Sep 2025 for 107,868.00, 16.35% semiannual coupons,
// matures 14 Oct 2026. Coupons 8,175.00 on 15 Oct 2025 / 15 Apr 2026 / 14 Oct
// 2026; redemption 100,000.00; expected profit 16,657.00.
const screenshotBond = (over: Record<string, unknown> = {}): ValuableHolding => ({
  ...base,
  type: 'bond',
  balanceMinorUnits: 0,
  metadata: {
    quantity: 100,
    faceValueMinorUnits: 100_000, // 1,000.00 each
    couponPct: 16.35,
    couponFrequency: 'semiannually',
    bondKind: 'government',
    purchaseDate: local(2025, 8, 18),
    purchasePriceMinorUnits: 10_786_800, // 107,868.00
    maturityDate: local(2026, 9, 14),
    ...over,
  },
});

describe('holdingValue', () => {
  it('returns the stored balance for a cash holding', () => {
    const holding: ValuableHolding = { ...base, type: 'cash', balanceMinorUnits: 5_000 };
    expect(holdingValue(holding, START).equals(Money.of('UAH', 5_000))).toBe(true);
  });

  it('returns the stored balance for a crypto asset', () => {
    const holding: ValuableHolding = {
      ...base,
      type: 'crypto_asset',
      currency: 'BTC',
      balanceMinorUnits: 200_000_000,
    };
    expect(holdingValue(holding, START).equals(Money.of('BTC', 200_000_000)).valueOf()).toBe(true);
  });

  it('compounds a recapitalization-ON term deposit, net of tax', () => {
    const holding: ValuableHolding = {
      ...base,
      type: 'term_deposit',
      balanceMinorUnits: 100_000,
      metadata: {
        contributions: [{ amountMinorUnits: 100_000, date: START }], // 1000.00 UAH
        annualRatePct: 12,
        termMonths: 24,
        recapitalization: true,
        compounding: 'monthly',
      },
    };
    // One year elapsed, 12 complete monthly periods at 1%.
    const value = holdingValue(holding, START + 365 * day);
    const grossMinor = Money.fromMajor('UAH', 1000 * 1.01 ** 12).minorUnits;
    const taxMinor = Math.floor(((grossMinor - 100_000) * 23) / 100);
    expect(value.equals(Money.of('UAH', grossMinor - taxMinor))).toBe(true);
  });

  it('caps a term deposit at maturity', () => {
    const holding: ValuableHolding = {
      ...base,
      type: 'term_deposit',
      balanceMinorUnits: 100_000,
      metadata: {
        contributions: [{ amountMinorUnits: 100_000, date: START }],
        annualRatePct: 12,
        termMonths: 12,
        recapitalization: true,
        compounding: 'monthly',
      },
    };
    const atMaturity = holdingValue(holding, addMonthsMs(START, 12));
    const wayPast = holdingValue(holding, addMonthsMs(START, 60));
    expect(wayPast.equals(atMaturity)).toBe(true);
  });

  it('counts cumulative accrued interest, net of tax, in a recap-OFF deposit value', () => {
    const holding: ValuableHolding = {
      ...base,
      type: 'term_deposit',
      balanceMinorUnits: 0,
      metadata: {
        // 10,000.00 UAH contribution, 10% annual, monthly compounding.
        contributions: [{ amountMinorUnits: 1_000_000, date: START }],
        annualRatePct: 10,
        termMonths: 24,
        recapitalization: false,
        compounding: 'monthly',
      },
    };
    // Held a full year => 1000.00 cumulative interest, tax 230.00, net 10,770.00.
    const value = holdingValue(holding, AFTER_1Y);
    expect(value.equals(Money.of('UAH', 1_077_000))).toBe(true);
  });

  it('accrues cumulative interest for a recap-OFF daily-compounding deposit', () => {
    const holding: ValuableHolding = {
      ...base,
      type: 'term_deposit',
      balanceMinorUnits: 0,
      metadata: {
        contributions: [{ amountMinorUnits: 1_000_000, date: START }],
        annualRatePct: 10,
        termMonths: 24,
        recapitalization: false,
        compounding: 'daily',
      },
    };
    // Daily compounding used to collapse to exactly 0; now it accrues.
    const value = holdingValue(holding, START + 200 * day);
    expect(value.minorUnits).toBeGreaterThan(1_000_000);
  });

  it('values the screenshot bond at nominal plus the coupon accrued this period', () => {
    // Current period purchase (18 Sep 2025) -> first coupon (15 Oct 2025) = 27
    // days. Valued 9 days in => 9/27 of the 8,175.00 coupon = 2,725.00 accrued on
    // top of the 100,000.00 nominal. Government bond => no tax.
    const value = holdingValue(screenshotBond(), local(2025, 8, 18) + 9 * day);
    expect(value.equals(Money.of('UAH', 10_272_500))).toBe(true);
  });

  it('drops the value back to nominal on a coupon date (coupon paid out)', () => {
    // Exactly on the 15 Oct 2025 coupon date the accrual resets to ~0 => nominal.
    const value = holdingValue(screenshotBond(), local(2025, 9, 15));
    expect(value.equals(Money.of('UAH', 10_000_000))).toBe(true);
  });

  it('reports zero once the bond has matured (nominal redeemed as a transaction)', () => {
    const value = holdingValue(screenshotBond(), local(2026, 9, 14) + day);
    expect(value.minorUnits).toBe(0);
  });

  it('excludes a future-dated deposit contribution from principal and value (D2)', () => {
    const holding: ValuableHolding = {
      ...base,
      type: 'term_deposit',
      balanceMinorUnits: 0,
      metadata: {
        // 10,000.00 opened at START, a 5,000.00 top-up scheduled 30 days out.
        contributions: [
          { amountMinorUnits: 1_000_000, date: START },
          { amountMinorUnits: 500_000, date: START + 30 * day },
        ],
        annualRatePct: 12,
        termMonths: 24,
        recapitalization: true,
        compounding: 'monthly',
      },
    };
    // Valued the day after START, before the top-up: principal is only the
    // first contribution, not 15,000.
    const b = holdingValueBreakdown(holding, START + day);
    expect(b.principalOrCost.minorUnits).toBe(1_000_000);
    expect(b.gross.minorUnits).toBeLessThan(1_010_000);
    expect(b.gross.minorUnits).toBeGreaterThanOrEqual(1_000_000);
  });

  it('reports no value for a bond purchased in the future (guard)', () => {
    const holding = screenshotBond({ purchaseDate: local(2025, 8, 18) });
    const before = local(2025, 8, 17); // the day before purchase
    const b = holdingValueBreakdown(holding, before);
    expect(b.gross.minorUnits).toBe(0);
    expect(b.principalOrCost.minorUnits).toBe(0);
    expect(b.net.minorUnits).toBe(0);
    expect(holdingValue(holding, before).minorUnits).toBe(0);
  });

  it('values a recap-on bi-weekly deposit net of the per-period withholding', () => {
    // Opened 11 Jan 2024 with 10,000.00; the bi-weekly engine capitalizes each
    // period net of the 23% tax. Net value is below the untaxed gross line.
    const holding: ValuableHolding = {
      ...base,
      type: 'term_deposit',
      balanceMinorUnits: 0,
      metadata: {
        contributions: [{ amountMinorUnits: 1_000_000, date: local(2024, 0, 11) }],
        annualRatePct: 12,
        termMonths: 24,
        recapitalization: true,
        compounding: 'bi-weekly',
      },
    };
    const b = holdingValueBreakdown(holding, local(2024, 2, 12));
    expect(b.principalOrCost.minorUnits).toBe(1_000_000);
    expect(b.interest.minorUnits).toBeGreaterThan(0);
    expect(b.tax.minorUnits).toBeGreaterThan(0);
    // Net = principal + gross interest - tax, and below the gross value.
    expect(b.net.minorUnits).toBe(b.gross.minorUnits - b.tax.minorUnits);
    expect(b.net.minorUnits).toBeLessThan(b.gross.minorUnits);
  });

  it('reproduces the screenshot expected profit (16,657.00)', () => {
    const meta = asBondMeta(screenshotBond().metadata);
    expect(meta).not.toBeNull();
    if (meta !== null) {
      // 3 * 8,175.00 net coupons + 100,000.00 nominal - 107,868.00 paid.
      expect(bondExpectedProfitMinor(meta, 'UAH')).toBe(1_665_700);
    }
  });

  it('falls back to the cached balance when metadata is malformed', () => {
    const holding: ValuableHolding = {
      ...base,
      type: 'term_deposit',
      balanceMinorUnits: 42_000,
      metadata: { junk: true },
    };
    expect(holdingValue(holding, START).equals(Money.of('UAH', 42_000))).toBe(true);
  });
});

const deposit = (over: Record<string, unknown>): ValuableHolding => ({
  type: 'term_deposit' as const,
  currency: 'UAH' as const,
  balanceMinorUnits: 0,
  metadata: {
    contributions: [{ amountMinorUnits: 100000, date: START }],
    annualRatePct: 10,
    termMonths: 12,
    recapitalization: true,
    compounding: 'annually',
    ...over,
  },
});

const bond = (bondKind: string): ValuableHolding => ({
  type: 'bond' as const,
  currency: 'UAH' as const,
  balanceMinorUnits: 0,
  metadata: {
    quantity: 10,
    faceValueMinorUnits: 10000, // 100.00 each => nominal 1,000.00 (100,000 minor)
    couponPct: 10,
    couponFrequency: 'annually',
    purchaseDate: local(2026, 0, 1),
    purchasePriceMinorUnits: 100_000, // paid at par
    maturityDate: local(2027, 0, 1),
    bondKind,
  },
});

describe('holdingValueBreakdown', () => {
  it('taxes a recapitalizing deposit at 23% of interest', () => {
    const b: HoldingValueBreakdown = holdingValueBreakdown(deposit({}), AFTER_1Y);
    expect(b.gross.minorUnits).toBe(110000);
    expect(b.principalOrCost.minorUnits).toBe(100000);
    expect(b.interest.minorUnits).toBe(10000);
    expect(b.tax.minorUnits).toBe(2300);
    expect(b.net.minorUnits).toBe(107700);
  });

  it('surfaces cumulative accrued interest, net of tax, for a non-recapitalizing deposit', () => {
    // deposit(): 100000 minor (1000.00) at 10% annual, held one year => 100.00
    // cumulative interest (10000 minor), tax floor(10000 * 23%) = 2300.
    const b = holdingValueBreakdown(deposit({ recapitalization: false }), AFTER_1Y);
    expect(b.principalOrCost.minorUnits).toBe(100000);
    expect(b.interest.minorUnits).toBe(10000);
    expect(b.tax.minorUnits).toBe(2300);
    expect(b.gross.minorUnits).toBe(110000);
    expect(b.net.minorUnits).toBe(107700);
  });

  // The first coupon period runs purchase (1 Jan 2026) -> first coupon
  // (15 Jan 2026) = 14 days. Valued 7 days in => 7/14 = half of the 100.00
  // annual coupon = 50.00 accrued (5000 minor), dirty-price. Cost is the price
  // paid (par = 100,000 minor here).
  const BOND_AT = local(2026, 0, 1) + 7 * day;

  it('does not tax a government bond', () => {
    const b = holdingValueBreakdown(bond('government'), BOND_AT);
    expect(b.gross.minorUnits).toBe(105000);
    expect(b.principalOrCost.minorUnits).toBe(100000);
    expect(b.interest.minorUnits).toBe(5000);
    expect(b.tax.minorUnits).toBe(0);
    expect(b.net.minorUnits).toBe(105000);
  });

  it('taxes a corporate bond coupon at 23%', () => {
    const b = holdingValueBreakdown(bond('corporate'), BOND_AT);
    expect(b.gross.minorUnits).toBe(105000);
    expect(b.interest.minorUnits).toBe(5000);
    expect(b.tax.minorUnits).toBe(1150); // floor(5000 * 23 / 100)
    expect(b.net.minorUnits).toBe(103850);
  });

  it('holdingValue returns the net value', () => {
    expect(holdingValue(deposit({}), AFTER_1Y).minorUnits).toBe(107700);
  });
});

// Local helper mirrors interest.addMonths so the test states its own expectation.
function addMonthsMs(start: number, months: number): number {
  const date = new Date(start);
  date.setMonth(date.getMonth() + months);
  return date.getTime();
}
