import { portfolioYieldToMaturity, yieldToMaturity } from './yield-to-maturity';

// Local instants, so each calendar day holds under any host timezone.
const local = (year: number, month: number, day: number, hour = 0): number =>
  new Date(year, month - 1, day, hour).getTime();

const percentText = (rate: number | null): string | undefined => rate?.toFixed(4);

// UA4000239115's register flows for 98 bonds bought at 1,076.72 each on
// 2026-09-10: 75.90 coupons on 2026-09-16 and 2027-03-17, then 75.90 plus
// the 1,000 nominal on 2027-09-15. The seller shows 15.40%.
const registerFlows = [
  { date: local(2026, 9, 16), amountMinorUnits: 743_820 },
  { date: local(2027, 3, 17), amountMinorUnits: 743_820 },
  { date: local(2027, 9, 15), amountMinorUnits: 743_820 },
  { date: local(2027, 9, 15), amountMinorUnits: 9_800_000 },
];
const paidMinorUnits = 10_551_856;
const purchaseDate = local(2026, 9, 10, 14);

describe('yieldToMaturity', () => {
  it("reproduces the seller's 15.40% for the pinned purchase", () => {
    const rate = yieldToMaturity(registerFlows, paidMinorUnits, purchaseDate);

    expect(percentText(rate)).toBe('0.1540');
    expect(Math.abs((rate ?? 0) - 0.154)).toBeLessThan(0.00005);
  });

  it('returns no yield for a lot without a price', () => {
    expect(yieldToMaturity(registerFlows, null, purchaseDate)).toBeNull();
    expect(yieldToMaturity(registerFlows, 0, purchaseDate)).toBeNull();
  });

  it('does not count a coupon paid on the lot day itself', () => {
    const withSameDayCoupon = [
      { date: local(2026, 9, 10), amountMinorUnits: 743_820 },
      ...registerFlows,
    ];

    expect(yieldToMaturity(withSameDayCoupon, paidMinorUnits, purchaseDate)).toBe(
      yieldToMaturity(registerFlows, paidMinorUnits, purchaseDate),
    );
  });

  it('returns no yield when no flow is left after the lot day', () => {
    expect(yieldToMaturity(registerFlows, paidMinorUnits, local(2027, 9, 15))).toBeNull();
  });

  it('matches the closed form for one remaining flow', () => {
    const flows = [{ date: local(2027, 9, 10), amountMinorUnits: 110_000 }];
    const rate = yieldToMaturity(flows, 100_000, local(2026, 9, 10));

    expect(rate).toBeCloseTo(1.1 ** (365 / 365) - 1, 10);
  });

  it('converges for a price far above par (a negative yield)', () => {
    const flows = [{ date: local(2027, 9, 10), amountMinorUnits: 110_000 }];
    const rate = yieldToMaturity(flows, 500_000, local(2026, 9, 10));

    expect(rate).toBeCloseTo(110_000 / 500_000 - 1, 10);
  });

  it('converges for a price far below par', () => {
    const flows = [{ date: local(2027, 9, 10), amountMinorUnits: 100_000 }];
    const rate = yieldToMaturity(flows, 100, local(2026, 9, 10));

    expect(rate).toBeCloseTo(999, 6);
  });

  it('converges for one flow six days out', () => {
    const flows = [{ date: local(2026, 9, 16), amountMinorUnits: 101_000 }];
    const rate = yieldToMaturity(flows, 100_000, local(2026, 9, 10));

    expect(rate).toBeCloseTo(1.01 ** (365 / 6) - 1, 8);
  });
});

describe('portfolioYieldToMaturity', () => {
  const lotDate = local(2025, 1, 1);
  const oneYearLater = local(2026, 1, 1);
  const tenPercentLot = {
    date: lotDate,
    paidMinorUnits: 100_000,
    cashFlows: [{ date: oneYearLater, amountMinorUnits: 110_000 }],
  };
  const twentyPercentLot = {
    date: lotDate,
    paidMinorUnits: 300_000,
    cashFlows: [{ date: oneYearLater, amountMinorUnits: 360_000 }],
  };

  it("weights each lot's yield by the amount paid", () => {
    const rate = portfolioYieldToMaturity([tenPercentLot, twentyPercentLot]);

    expect(rate).toBeCloseTo((0.1 * 100_000 + 0.2 * 300_000) / 400_000, 10);
  });

  it('leaves a lot without a price out of the weighting', () => {
    const unpricedLot = { ...twentyPercentLot, paidMinorUnits: null };

    expect(portfolioYieldToMaturity([tenPercentLot, unpricedLot])).toBeCloseTo(0.1, 10);
  });

  it('returns no yield when no lot has a price', () => {
    expect(portfolioYieldToMaturity([{ ...tenPercentLot, paidMinorUnits: null }])).toBeNull();
  });
});
