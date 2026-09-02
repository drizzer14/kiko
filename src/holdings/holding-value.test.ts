import { Money } from '../currency/money';
import { accruedInterest, holdingValue, type ValuableHolding } from './holding-value';

const base = { currency: 'UAH' as const, balanceMinorUnits: 0, metadata: null };
const START = Date.UTC(2026, 0, 1);
const day = 86_400_000;

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

  it('compounds a recapitalization-ON term deposit', () => {
    const holding: ValuableHolding = {
      ...base,
      type: 'term_deposit',
      balanceMinorUnits: 100_000,
      metadata: {
        principalMinorUnits: 100_000, // 1000.00 UAH
        annualRatePct: 12,
        startDate: START,
        termMonths: 24,
        recapitalization: true,
        compounding: 'monthly',
      },
    };
    // One year elapsed, 12 complete monthly periods at 1%.
    const value = holdingValue(holding, START + 365 * day);
    const expected = Money.fromMajor('UAH', 1000 * 1.01 ** 12);
    expect(value.equals(expected)).toBe(true);
  });

  it('caps a term deposit at maturity', () => {
    const holding: ValuableHolding = {
      ...base,
      type: 'term_deposit',
      balanceMinorUnits: 100_000,
      metadata: {
        principalMinorUnits: 100_000,
        annualRatePct: 12,
        startDate: START,
        termMonths: 12,
        recapitalization: true,
        compounding: 'monthly',
      },
    };
    const atMaturity = holdingValue(holding, addMonthsMs(START, 12));
    const wayPast = holdingValue(holding, addMonthsMs(START, 60));
    expect(wayPast.equals(atMaturity)).toBe(true);
  });

  it('keeps a recapitalization-OFF deposit at its principal', () => {
    const holding: ValuableHolding = {
      ...base,
      type: 'term_deposit',
      balanceMinorUnits: 0,
      metadata: {
        principalMinorUnits: 100_000,
        annualRatePct: 12,
        startDate: START,
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

describe('accruedInterest', () => {
  it('returns the current-period accrual for a recapitalization-OFF deposit', () => {
    const holding: ValuableHolding = {
      ...base,
      type: 'term_deposit',
      metadata: {
        principalMinorUnits: 100_000,
        annualRatePct: 12,
        startDate: START,
        termMonths: 24,
        recapitalization: false,
        compounding: 'monthly',
      },
    };
    // 10 days into the first monthly period.
    const accrued = accruedInterest(holding, START + 10 * day);
    expect(accrued).not.toBeNull();
    expect(accrued?.minorUnits).toBeGreaterThan(0);
  });

  it('returns null for a recapitalization-ON deposit', () => {
    const holding: ValuableHolding = {
      ...base,
      type: 'term_deposit',
      metadata: {
        principalMinorUnits: 100_000,
        annualRatePct: 12,
        startDate: START,
        termMonths: 24,
        recapitalization: true,
        compounding: 'monthly',
      },
    };
    expect(accruedInterest(holding, START + 10 * day)).toBeNull();
  });

  it('returns null for a cash holding', () => {
    expect(accruedInterest({ ...base, type: 'cash' }, START)).toBeNull();
  });
});

// Local helper mirrors interest.addMonths so the test states its own expectation.
function addMonthsMs(start: number, months: number): number {
  const date = new Date(start);
  date.setMonth(date.getMonth() + months);
  return date.getTime();
}
