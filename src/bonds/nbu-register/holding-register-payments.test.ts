import type { BondMeta } from '@kiko/holdings/holding-metadata';

import {
  holdingRegisterCoupons,
  cachedRegisterPayments,
  holdingRegisterPayments,
} from './holding-register-payments';
import type { BondTerms } from './nbu-register';

const local = (year: number, month: number, day: number): number =>
  new Date(year, month - 1, day).getTime();

const terms: BondTerms = {
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

const meta: BondMeta = {
  quantity: 98,
  faceValueMinorUnits: 100_000,
  couponPct: 15.18,
  purchaseDate: local(2026, 9, 10),
  purchasePriceMinorUnits: 10_551_856,
  maturityDate: local(2027, 9, 15),
  bondKind: 'government',
  couponFrequency: 'semiannually',
  isin: 'UA4000239115',
};

describe('holdingRegisterPayments', () => {
  it("reads every register payment for the holding's own ISIN, nominal and currency", () => {
    expect(holdingRegisterPayments(meta, 'UAH', terms)).toEqual(terms.payments);
  });

  it('reads none without cached terms', () => {
    expect(holdingRegisterPayments(meta, 'UAH', null)).toBeNull();
  });

  it('reads none from cached terms without payments', () => {
    expect(holdingRegisterPayments(meta, 'UAH', { ...terms, payments: undefined })).toBeNull();
  });

  it('reads none for a Manual bond, which has no ISIN', () => {
    expect(holdingRegisterPayments({ ...meta, isin: undefined }, 'UAH', terms)).toBeNull();
  });

  it("reads none for another ISIN's terms", () => {
    expect(holdingRegisterPayments({ ...meta, isin: 'UA4000234215' }, 'UAH', terms)).toBeNull();
  });

  it("reads none for a face value other than the register's nominal", () => {
    expect(
      holdingRegisterPayments({ ...meta, faceValueMinorUnits: 50_000 }, 'UAH', terms),
    ).toBeNull();
  });

  it("reads none for a currency other than the register's", () => {
    expect(holdingRegisterPayments(meta, 'USD', terms)).toBeNull();
  });

  describe('with the schedule kept in the metadata', () => {
    const stored = [
      { date: local(2026, 9, 16), kind: 'coupon' as const, amount: '70' },
      { date: local(2027, 9, 15), kind: 'redemption' as const, amount: '1000' },
    ];

    it('reads the kept schedule once the ISIN has left the cache', () => {
      expect(holdingRegisterPayments({ ...meta, payments: stored }, 'UAH', null)).toEqual(stored);
    });

    it('reads the kept schedule before the cached one', () => {
      expect(holdingRegisterPayments({ ...meta, payments: stored }, 'UAH', terms)).toEqual(stored);
    });

    it("reads none for an empty schedule (the user's own coupon), even with a matching cache", () => {
      expect(holdingRegisterPayments({ ...meta, payments: [] }, 'UAH', terms)).toBeNull();
    });
  });
});

describe('cachedRegisterPayments', () => {
  it('reads the cache even for a bond with a kept schedule', () => {
    const kept: BondMeta = { ...meta, payments: [] };

    expect(cachedRegisterPayments(kept, 'UAH', terms)).toEqual(terms.payments);
  });

  it('reads none for a schedule that would not parse back from the metadata', () => {
    const negative = { ...terms, payments: [{ date: 1, kind: 'coupon' as const, amount: '-1' }] };

    expect(cachedRegisterPayments(meta, 'UAH', negative)).toBeNull();
  });
});

describe('holdingRegisterCoupons', () => {
  it('keeps only the coupons, never the redemption', () => {
    expect(holdingRegisterCoupons(meta, 'UAH', terms)).toEqual(terms.payments?.slice(0, 3));
  });

  it('reads no coupons for unparsable metadata', () => {
    expect(holdingRegisterCoupons({ quantity: 'many' }, 'UAH', terms)).toEqual([]);
  });

  it('reads no coupons when the register does not describe the holding', () => {
    expect(holdingRegisterCoupons({ ...meta, isin: undefined }, 'UAH', terms)).toEqual([]);
  });
});
