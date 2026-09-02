import { Money } from '../currency/money';
import {
  holdingValue,
  type HoldingValueBreakdown,
  holdingValueBreakdown,
  type ValuableHolding,
} from './holding-value';

const base = { currency: 'UAH' as const, balanceMinorUnits: 0, metadata: null };
const START = Date.UTC(2026, 0, 1);
const day = 86_400_000;
const AFTER_1Y = START + 365 * day;

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

  it('keeps a recapitalization-OFF deposit at its contributions sum', () => {
    const holding: ValuableHolding = {
      ...base,
      type: 'term_deposit',
      balanceMinorUnits: 0,
      metadata: {
        contributions: [{ amountMinorUnits: 100_000, date: START }],
        annualRatePct: 12,
        termMonths: 24,
        recapitalization: false,
        compounding: 'monthly',
      },
    };
    const value = holdingValue(holding, START + 200 * day);
    expect(value.equals(Money.of('UAH', 100_000))).toBe(true);
  });

  it('values a bond as nominal plus accrued coupon', () => {
    const holding: ValuableHolding = {
      ...base,
      type: 'bond',
      balanceMinorUnits: 0,
      metadata: {
        quantity: 10,
        faceValueMinorUnits: 100_000, // 1000.00 each => nominal 10000.00
        couponPct: 10,
        purchaseDate: START,
        maturityDate: START + 730 * day,
      },
    };
    // 365 days => a full year of 10% coupon on 10000 => +1000.00.
    // Government bond by default => no tax.
    const value = holdingValue(holding, START + 365 * day);
    expect(value.equals(Money.of('UAH', 1_100_000))).toBe(true);
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
    faceValueMinorUnits: 10000,
    couponPct: 10,
    purchaseDate: START,
    maturityDate: AFTER_1Y + day,
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

  it('keeps a non-recapitalizing deposit value at the contributions sum', () => {
    const b = holdingValueBreakdown(deposit({ recapitalization: false }), AFTER_1Y);
    expect(b.gross.minorUnits).toBe(100000);
    expect(b.net.minorUnits).toBe(100000);
  });

  it('does not tax a government bond', () => {
    const b = holdingValueBreakdown(bond('government'), AFTER_1Y);
    expect(b.gross.minorUnits).toBe(110000);
    expect(b.tax.minorUnits).toBe(0);
    expect(b.net.minorUnits).toBe(110000);
  });

  it('taxes a corporate bond coupon at 23%', () => {
    const b = holdingValueBreakdown(bond('corporate'), AFTER_1Y);
    expect(b.gross.minorUnits).toBe(110000);
    expect(b.tax.minorUnits).toBe(2300);
    expect(b.net.minorUnits).toBe(107700);
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
