import type { BondTerms } from '@kiko/bonds/nbu-register';
import type { BondMeta, BondPayment } from '@kiko/holdings/holding-metadata';

import { bondPaymentsOnSave, keepsSavedSchedule, type BondToSave } from './bond-payments-on-save';

const local = (year: number, month: number, day: number): number =>
  new Date(year, month - 1, day).getTime();

// XS2895055981: 0.0225 per 1-dollar bond up to 2027-02, 0.03 from 2027-08.
const registerPayments: BondPayment[] = [
  { date: local(2027, 2, 1), kind: 'coupon', amount: '0.0225' },
  { date: local(2027, 8, 1), kind: 'coupon', amount: '0.03' },
  { date: local(2029, 2, 1), kind: 'coupon', amount: '0.03' },
  { date: local(2029, 2, 1), kind: 'redemption', amount: '1' },
];

const registerTerms: BondTerms = {
  isin: 'XS2895055981',
  currency: 'USD',
  faceValueMinorUnits: 100,
  couponPct: 6,
  maturityDate: local(2029, 2, 1),
  couponFrequency: 'semiannually',
  name: 'OЗДП-середньострокова XS2895055981',
  payments: registerPayments,
};

const next: BondToSave = {
  isin: 'XS2895055981',
  currency: 'USD',
  faceValueMinorUnits: 100,
  couponPct: 4.5,
  couponFrequency: 'semiannually',
};

const keptPayments: BondPayment[] = [
  { date: local(2027, 2, 1), kind: 'coupon', amount: '0.0225' },
  { date: local(2029, 2, 1), kind: 'redemption', amount: '1' },
];

const savedMeta: BondMeta = {
  quantity: 1000,
  faceValueMinorUnits: 100,
  couponPct: 4.5,
  purchaseDate: local(2026, 9, 26),
  purchasePriceMinorUnits: 98_000,
  maturityDate: local(2029, 2, 1),
  bondKind: 'government',
  couponFrequency: 'semiannually',
  isin: 'XS2895055981',
  payments: keptPayments,
};

const saved = { meta: savedMeta, currency: 'USD' as const };

describe('bondPaymentsOnSave on create', () => {
  it('copies the matched register schedule, redemption included, in ISIN mode', () => {
    expect(bondPaymentsOnSave({ bondMode: 'isin', registerTerms, saved: null, next })).toEqual(
      registerPayments,
    );
  });

  it('copies nothing when the register terms no longer describe the bond', () => {
    expect(
      bondPaymentsOnSave({
        bondMode: 'isin',
        registerTerms,
        saved: null,
        next: { ...next, currency: 'EUR' },
      }),
    ).toBeUndefined();
    expect(
      bondPaymentsOnSave({ bondMode: 'isin', registerTerms: null, saved: null, next }),
    ).toBeUndefined();
  });

  it('keeps an empty schedule for a Manual coupon typed over the matched one, so it is booked', () => {
    expect(bondPaymentsOnSave({ bondMode: 'manual', registerTerms, saved: null, next })).toEqual(
      [],
    );
    expect(
      bondPaymentsOnSave({
        bondMode: 'manual',
        registerTerms,
        saved: null,
        next: { ...next, couponPct: 6, couponFrequency: 'quarterly' },
      }),
    ).toEqual([]);
    expect(
      bondPaymentsOnSave({ bondMode: 'manual', registerTerms: null, saved: null, next }),
    ).toEqual([]);
  });

  it("copies the matched register schedule in Manual mode while its coupon is still the register's", () => {
    const filled = { ...next, couponPct: 6 };
    const unmapped = { ...registerTerms, couponFrequency: null };

    expect(
      bondPaymentsOnSave({ bondMode: 'manual', registerTerms, saved: null, next: filled }),
    ).toEqual(registerPayments);
    expect(
      bondPaymentsOnSave({
        bondMode: 'manual',
        registerTerms: unmapped,
        saved: null,
        next: { ...filled, couponFrequency: 'quarterly' },
      }),
    ).toEqual(registerPayments);
  });

  it('keeps nothing for a Manual bond without an ISIN', () => {
    expect(
      bondPaymentsOnSave({
        bondMode: 'manual',
        registerTerms: null,
        saved: null,
        next: { ...next, isin: undefined },
      }),
    ).toBeUndefined();
  });
});

describe('bondPaymentsOnSave on edit', () => {
  it('carries the kept schedule through an unchanged Manual save, with or without a cache', () => {
    expect(bondPaymentsOnSave({ bondMode: 'manual', registerTerms: null, saved, next })).toBe(
      keptPayments,
    );
    expect(bondPaymentsOnSave({ bondMode: 'manual', registerTerms, saved, next })).toBe(
      keptPayments,
    );
  });

  it('captures the matched register schedule for a bond saved without one', () => {
    const legacy = { ...saved, meta: { ...savedMeta, payments: undefined } };

    expect(bondPaymentsOnSave({ bondMode: 'manual', registerTerms, saved: legacy, next })).toEqual(
      registerPayments,
    );
  });

  it.each([
    ['coupon %', { couponPct: 6 }],
    ['coupon frequency', { couponFrequency: 'quarterly' as const }],
  ])('drops the schedule for an edited %s, so the edited coupon wins', (_label, edit) => {
    expect(
      bondPaymentsOnSave({ bondMode: 'manual', registerTerms, saved, next: { ...next, ...edit } }),
    ).toEqual([]);
  });

  it.each([
    ['ISIN', { isin: 'UA4000239115' }],
    ['face value', { faceValueMinorUnits: 1000 }],
    ['currency', { currency: 'EUR' as const }],
  ])('drops the schedule for an edited %s, leaving the new bond to the cache', (_label, edit) => {
    expect(
      bondPaymentsOnSave({ bondMode: 'manual', registerTerms, saved, next: { ...next, ...edit } }),
    ).toBeUndefined();
  });

  it('keeps nothing for an edited coupon on a bond without an ISIN', () => {
    const manual = { ...saved, meta: { ...savedMeta, isin: undefined, payments: undefined } };

    expect(
      bondPaymentsOnSave({
        bondMode: 'manual',
        registerTerms: null,
        saved: manual,
        next: { ...next, isin: undefined, couponPct: 6 },
      }),
    ).toBeUndefined();
  });

  it("takes the register's schedule in ISIN mode, and keeps the saved one when the register has none", () => {
    const filled = { ...next, couponPct: 6 };
    const withoutPayments = { ...registerTerms, payments: undefined };

    expect(bondPaymentsOnSave({ bondMode: 'isin', registerTerms, saved, next: filled })).toEqual(
      registerPayments,
    );
    expect(
      bondPaymentsOnSave({
        bondMode: 'isin',
        registerTerms: withoutPayments,
        saved,
        next: filled,
      }),
    ).toBe(keptPayments);
  });
});

describe('keepsSavedSchedule', () => {
  it('holds for the bond as saved with a non-empty schedule, as its Manual save keeps it', () => {
    expect(keepsSavedSchedule(saved, next)).toBe(true);
    expect(bondPaymentsOnSave({ bondMode: 'manual', registerTerms: null, saved, next })).toBe(
      keptPayments,
    );
  });

  it('does not hold on create, or for a bond saved without a schedule or with its own coupon', () => {
    expect(keepsSavedSchedule(null, next)).toBe(false);
    expect(
      keepsSavedSchedule({ ...saved, meta: { ...savedMeta, payments: undefined } }, next),
    ).toBe(false);
    expect(keepsSavedSchedule({ ...saved, meta: { ...savedMeta, payments: [] } }, next)).toBe(
      false,
    );
  });

  it.each([
    ['ISIN', { isin: 'UA4000239115' }],
    ['face value', { faceValueMinorUnits: 1000 }],
    ['currency', { currency: 'EUR' as const }],
    ['coupon %', { couponPct: 6 }],
    ['coupon frequency', { couponFrequency: 'quarterly' as const }],
  ])('does not hold once the %s changed, as the save then drops the schedule', (_label, edit) => {
    const edited = { ...next, ...edit };

    expect(keepsSavedSchedule(saved, edited)).toBe(false);
    expect(
      bondPaymentsOnSave({ bondMode: 'manual', registerTerms: null, saved, next: edited }),
    ).not.toBe(keptPayments);
  });
});
