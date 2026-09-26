import type { BondTerms } from '../nbu-register';

import { bondYieldToMaturity } from './bond-yield';

const local = (year: number, month: number, day: number, hour = 0): number =>
  new Date(year, month - 1, day, hour).getTime();

// 98 x UA4000239115 bought at 1,076.72 each on 2026-09-10; the seller shows
// a 15.40% yield to maturity.
const pinnedBond = {
  quantity: 98,
  faceValueMinorUnits: 100_000,
  couponPct: 15.18,
  purchaseDate: local(2026, 9, 10, 14),
  purchasePriceMinorUnits: 10_551_856,
  maturityDate: local(2027, 9, 15),
  bondKind: 'government',
  couponFrequency: 'semiannually',
  isin: 'UA4000239115',
};

const registerTerms: BondTerms = {
  isin: 'UA4000239115',
  currency: 'UAH',
  faceValueMinorUnits: 100_000,
  couponPct: 15.18,
  maturityDate: local(2027, 9, 15),
  couponFrequency: 'semiannually',
  name: 'Середньострокові UA4000239115',
  payments: [
    { date: local(2026, 9, 16), kind: 'coupon', amount: '75.9' },
    { date: local(2027, 3, 17), kind: 'coupon', amount: '75.9' },
    { date: local(2027, 9, 15), kind: 'coupon', amount: '75.9' },
    { date: local(2027, 9, 15), kind: 'redemption', amount: '1000' },
  ],
};

// Doubled coupons: a yield read from these could never equal the pin.
const inflatedPayments = registerTerms.payments?.map((payment) =>
  payment.kind === 'coupon' ? { ...payment, amount: '151.8' } : payment,
);

describe('bondYieldToMaturity', () => {
  it('reads 15.40% from the register payments', () => {
    const rate = bondYieldToMaturity(pinnedBond, 'UAH', registerTerms);

    expect(rate?.toFixed(4)).toBe('0.1540');
    expect(Math.abs((rate ?? 0) - 0.154)).toBeLessThan(0.00005);
  });

  it('reads the same 15.40% from the schedule generated for a Manual bond', () => {
    const rate = bondYieldToMaturity({ ...pinnedBond, isin: undefined }, 'UAH', null);

    expect(rate?.toFixed(4)).toBe('0.1540');
    expect(Math.abs((rate ?? 0) - 0.154)).toBeLessThan(0.00005);
  });

  it('generates the schedule when the cached terms carry no payments', () => {
    const olderCache = { ...registerTerms, payments: undefined };

    expect(bondYieldToMaturity(pinnedBond, 'UAH', olderCache)?.toFixed(4)).toBe('0.1540');
  });

  it("ignores register payments for a different face value than the holding's", () => {
    const otherNominal = {
      ...registerTerms,
      faceValueMinorUnits: 50_000,
      payments: inflatedPayments,
    };

    expect(bondYieldToMaturity(pinnedBond, 'UAH', otherNominal)?.toFixed(4)).toBe('0.1540');
  });

  it("ignores register payments in a different currency than the holding's", () => {
    const otherCurrency = {
      ...registerTerms,
      currency: 'USD' as const,
      payments: inflatedPayments,
    };

    expect(bondYieldToMaturity(pinnedBond, 'UAH', otherCurrency)?.toFixed(4)).toBe('0.1540');
  });

  it('shows no yield for a bond stored before it carried a price', () => {
    const { purchasePriceMinorUnits: _, ...legacyBond } = pinnedBond;

    expect(bondYieldToMaturity(legacyBond, 'UAH', registerTerms)).toBeNull();
  });

  it('shows no yield for unparsable metadata', () => {
    expect(bondYieldToMaturity({ quantity: 'ten' }, 'UAH', null)).toBeNull();
  });

  it('shows no yield once nothing is left to receive after the purchase day', () => {
    const boughtAtMaturity = { ...pinnedBond, purchaseDate: local(2027, 9, 15, 9) };

    expect(bondYieldToMaturity(boughtAtMaturity, 'UAH', null)).toBeNull();
  });
});
