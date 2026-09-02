import {
  accruedMajor,
  addMonths,
  compoundedMajor,
  daysBetween,
  depositAccruedMajor,
  depositCompoundedMajor,
  depositMaturity,
  periodDays,
  periodsPerYear,
} from './interest';

const DAY = 86_400_000;
const START = Date.UTC(2024, 0, 1);
const AFTER_1Y = START + 365 * DAY;

describe('periodsPerYear', () => {
  it('maps each frequency', () => {
    expect(periodsPerYear('daily')).toBe(365);
    expect(periodsPerYear('monthly')).toBe(12);
    expect(periodsPerYear('quarterly')).toBe(4);
    expect(periodsPerYear('annually')).toBe(1);
  });
});

describe('periodDays', () => {
  it('derives the day length of one compounding period', () => {
    expect(periodDays('monthly')).toBeCloseTo(365 / 12, 6);
    expect(periodDays('daily')).toBe(1);
    expect(periodDays('annually')).toBe(365);
  });
});

describe('daysBetween', () => {
  const day = 86_400_000;
  it('floors to whole days', () => {
    expect(daysBetween(0, 10 * day + 500)).toBe(10);
  });
  it('never returns a negative count', () => {
    expect(daysBetween(10 * day, 0)).toBe(0);
  });
});

describe('addMonths', () => {
  it('advances the calendar month', () => {
    const start = Date.UTC(2026, 0, 15); // 2026-01-15
    expect(addMonths(start, 12)).toBe(Date.UTC(2027, 0, 15));
  });
});

describe('compoundedMajor', () => {
  it('compounds one full year monthly at 12%', () => {
    // 12% annual, monthly => 1% per month, 12 complete periods.
    const value = compoundedMajor(1000, 12, 'monthly', 365);
    expect(value).toBeCloseTo(1000 * 1.01 ** 12, 6);
  });
  it('returns the principal before the first period completes', () => {
    expect(compoundedMajor(1000, 12, 'monthly', 20)).toBeCloseTo(1000, 6);
  });
});

describe('accruedMajor', () => {
  it('accrues simple interest over the elapsed days', () => {
    // 10% of 1000 over half a year (182.5 days) ~ 50.
    expect(accruedMajor(1000, 10, 182.5)).toBeCloseTo(50, 6);
  });
});

describe('deposit contributions', () => {
  it('anchors maturity to the earliest contribution date', () => {
    const later = Date.UTC(2024, 5, 1);
    expect(depositMaturity([{ date: later }, { date: START }], 12)).toBe(
      new Date(START).setMonth(new Date(START).getMonth() + 12),
    );
  });

  it('sums compounded value over contributions (0% rate = sum of amounts)', () => {
    const value = depositCompoundedMajor(
      [
        { amountMajor: 1000, date: START },
        { amountMajor: 500, date: START },
      ],
      0,
      'monthly',
      12,
      AFTER_1Y,
    );
    expect(value).toBeCloseTo(1500, 6);
  });

  it('compounds each contribution from its own date (annually, one year)', () => {
    const value = depositCompoundedMajor(
      [{ amountMajor: 1000, date: START }],
      10,
      'annually',
      12,
      AFTER_1Y,
    );
    expect(value).toBeCloseTo(1100, 6);
  });

  it('doubles when two equal contributions share a date', () => {
    const one = depositCompoundedMajor(
      [{ amountMajor: 1000, date: START }],
      10,
      'annually',
      12,
      AFTER_1Y,
    );
    const two = depositCompoundedMajor(
      [
        { amountMajor: 1000, date: START },
        { amountMajor: 1000, date: START },
      ],
      10,
      'annually',
      12,
      AFTER_1Y,
    );
    expect(two).toBeCloseTo(one * 2, 6);
  });

  it('accrues per-contribution over the current period (recap-off)', () => {
    const accrued = depositAccruedMajor(
      [{ amountMajor: 1000, date: START }],
      12,
      'monthly',
      24,
      START + 10 * DAY,
    );
    expect(accrued).toBeGreaterThan(0);
  });
});
