import { holdingInstrument } from '@kiko/prices/instrument';
import { buildPriceBook, dayKeyOf, EMPTY_PRICE_BOOK } from '@kiko/prices/price-book';

import { addMonths } from '../interest';
import type { LoanMeta } from '../holding-metadata';

import {
  loanInstallments,
  loanOutstandingMinorAt,
  loanPaymentSplitsMinor,
  loanInterestPerPaymentMinor,
  withinInstallmentTolerance,
  type LoanInstallment,
} from './loan-schedule';

const HOLDING_ID = 'loan-1';

// A DEVICE-LOCAL midnight instant, mirroring `src/holdings/interest/
// interest.test.ts`'s own `local(...)` helper — every loan-schedule boundary
// (`addMonths`, `dayKeyOf`) is built from local Y/M/D fields (kiko-domain's
// "Dates" section), so a raw `Date.UTC(...)`/epoch literal would drift a day
// on a non-UTC device.
const local = (year: number, monthIndex: number, day: number): number =>
  new Date(year, monthIndex, day).getTime();

// Winter dates (no Kyiv DST in play), one month apart, so a raw `+3 days`
// offset never crosses a DST transition.
const addDays = (instant: number, days: number): number => {
  const d = new Date(instant);

  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days).getTime();
};

const annuityMeta: LoanMeta = {
  kind: 'mortgage',
  principalMinorUnits: 120_000_000, // 1,200,000.00 UAH
  startDate: local(2020, 0, 15),
  annualRatePct: 12,
  termMonths: 240,
  schedule: 'annuity',
};

const differentiatedMeta: LoanMeta = {
  ...annuityMeta,
  schedule: 'differentiated',
};

const noneMeta: LoanMeta = {
  kind: 'personal',
  principalMinorUnits: 50_000_00,
  startDate: local(2020, 0, 15),
  schedule: 'none',
};

describe('loanInstallments — annuity', () => {
  const installments: LoanInstallment[] = loanInstallments(annuityMeta);

  it('produces one installment per term month', () => {
    expect(installments).toHaveLength(240);
  });

  it('matches a known amortization table on the first row', () => {
    expect(installments[0]).toEqual({
      index: 1,
      dueDate: local(2020, 1, 15),
      interestMinorUnits: 1_200_000,
      principalMinorUnits: 121_303,
      paymentMinorUnits: 1_321_303,
      balanceMinorUnits: 119_878_697,
    });
  });

  it('matches a known amortization table on the last row, absorbing rounding', () => {
    expect(installments[239]).toEqual({
      index: 240,
      dueDate: local(2040, 0, 15),
      interestMinorUnits: 13_086,
      principalMinorUnits: 1_308_553,
      paymentMinorUnits: 1_321_639,
      balanceMinorUnits: 0,
    });
  });

  it('sums every installment principal back to the original principal exactly', () => {
    const totalPrincipal = installments.reduce((sum, row) => sum + row.principalMinorUnits, 0);
    expect(totalPrincipal).toBe(annuityMeta.principalMinorUnits);
  });

  it('produces equal-principal, zero-interest installments for a zero-rate loan', () => {
    const zeroRate = loanInstallments({ ...annuityMeta, annualRatePct: 0 });
    expect(zeroRate[0]).toMatchObject({ interestMinorUnits: 0, principalMinorUnits: 500_000 });
    expect(zeroRate[239]).toMatchObject({ interestMinorUnits: 0, balanceMinorUnits: 0 });
  });
});

describe('loanInstallments — differentiated', () => {
  const installments = loanInstallments(differentiatedMeta);

  it('keeps the principal portion constant across every installment but the last', () => {
    const firstPrincipal = installments[0].principalMinorUnits;

    for (const row of installments.slice(0, -1)) {
      expect(row.principalMinorUnits).toBe(firstPrincipal);
    }
  });

  it('matches a known amortization table on the first and last rows', () => {
    expect(installments[0]).toEqual({
      index: 1,
      dueDate: local(2020, 1, 15),
      interestMinorUnits: 1_200_000,
      principalMinorUnits: 500_000,
      paymentMinorUnits: 1_700_000,
      balanceMinorUnits: 119_500_000,
    });
    expect(installments[239]).toEqual({
      index: 240,
      dueDate: local(2040, 0, 15),
      interestMinorUnits: 5_000,
      principalMinorUnits: 500_000,
      paymentMinorUnits: 505_000,
      balanceMinorUnits: 0,
    });
  });
});

describe('loanInstallments — none', () => {
  it('produces no installments (informal debt has no schedule)', () => {
    expect(loanInstallments(noneMeta)).toEqual([]);
  });
});

describe('loanOutstandingMinorAt', () => {
  it('reads the manual price-point series for a none-schedule (informal) loan', () => {
    const point = { day: dayKeyOf(local(2021, 0, 1)), price: '30000.00', currency: 'UAH' as const };
    const book = buildPriceBook([
      { instrument: holdingInstrument(HOLDING_ID), ...point, source: 'manual' as const },
    ]);
    expect(loanOutstandingMinorAt(noneMeta, HOLDING_ID, book, local(2021, 0, 1))).toBe(30_000_00);
  });

  it('is 0 for a none-schedule loan with no manual point yet', () => {
    expect(loanOutstandingMinorAt(noneMeta, HOLDING_ID, EMPTY_PRICE_BOOK, local(2020, 0, 15))).toBe(
      0,
    );
  });

  it('clamps an overpaid (negative) none-schedule correction to 0', () => {
    const book = buildPriceBook([
      {
        instrument: holdingInstrument(HOLDING_ID),
        day: dayKeyOf(local(2021, 0, 1)),
        price: '-100.00',
        currency: 'UAH',
        source: 'manual',
      },
    ]);
    expect(loanOutstandingMinorAt(noneMeta, HOLDING_ID, book, local(2021, 0, 1))).toBe(0);
  });

  it('with no correction, equals the principal minus every scheduled installment principal due so far', () => {
    const installments = loanInstallments(annuityMeta);
    const tenthDueDate = installments[9].dueDate;
    const principalDueByTenth = installments
      .slice(0, 10)
      .reduce((sum, row) => sum + row.principalMinorUnits, 0);

    expect(loanOutstandingMinorAt(annuityMeta, HOLDING_ID, EMPTY_PRICE_BOOK, tenthDueDate)).toBe(
      annuityMeta.principalMinorUnits - principalDueByTenth,
    );
  });

  it('is 0 right after the last scheduled installment, with no correction', () => {
    const installments = loanInstallments(annuityMeta);
    const lastDueDate = installments[239].dueDate;
    expect(loanOutstandingMinorAt(annuityMeta, HOLDING_ID, EMPTY_PRICE_BOOK, lastDueDate)).toBe(0);
  });

  it('N10a: a correction point of 900,000 on day X gives 900,000 minus the principal due after X', () => {
    const installments = loanInstallments(annuityMeta);
    const correctionDay = installments[49].dueDate;
    const book = buildPriceBook([
      {
        instrument: holdingInstrument(HOLDING_ID),
        day: dayKeyOf(correctionDay),
        price: '900000.00',
        currency: 'UAH',
        source: 'manual',
      },
    ]);

    // Queried on the correction day itself: no installment is due AFTER it yet,
    // so the subtracted principal is 0 and the outstanding is the correction
    // value verbatim.
    expect(loanOutstandingMinorAt(annuityMeta, HOLDING_ID, book, correctionDay)).toBe(900_000_00);

    // Queried five installments later: the correction anchors a fresh
    // baseline, and only the principal due strictly AFTER the correction day
    // is subtracted from it — never the principal that was already due
    // before the correction.
    const laterDueDate = installments[54].dueDate;
    const principalAfterCorrection = installments
      .slice(50, 55)
      .reduce((sum, row) => sum + row.principalMinorUnits, 0);
    expect(loanOutstandingMinorAt(annuityMeta, HOLDING_ID, book, laterDueDate)).toBe(
      90_000_000 - principalAfterCorrection,
    );
  });

  it('a correction dated AFTER the queried instant never anchors it — the pure schedule applies instead', () => {
    // A correction recorded on installment 50's due date (~4 years in) must
    // not retroactively apply to a query from BEFORE that day — `priceAt`'s
    // own earliest-point fallback would otherwise hand back this later
    // point for an earlier query, which is wrong for a scheduled loan
    // (unlike the `none` branch, which matches Property's convention).
    const installments = loanInstallments(annuityMeta);
    const correctionDay = installments[49].dueDate;
    const book = buildPriceBook([
      {
        instrument: holdingInstrument(HOLDING_ID),
        day: dayKeyOf(correctionDay),
        price: '900000.00',
        currency: 'UAH',
        source: 'manual',
      },
    ]);

    const twelfthDueDate = installments[11].dueDate;
    expect(loanOutstandingMinorAt(annuityMeta, HOLDING_ID, book, twelfthDueDate)).toBe(118_461_574);
  });

  it('is 0 before the loan start date, the none-schedule branch, even with a later correction', () => {
    const point = { day: dayKeyOf(local(2021, 0, 1)), price: '30000.00', currency: 'UAH' as const };
    const book = buildPriceBook([
      { instrument: holdingInstrument(HOLDING_ID), ...point, source: 'manual' as const },
    ]);
    const dayBeforeStart = addDays(noneMeta.startDate, -1);
    expect(loanOutstandingMinorAt(noneMeta, HOLDING_ID, book, dayBeforeStart)).toBe(0);
  });

  it('is 0 before the loan start date, the SCHEDULED (annuity) branch — not the full principal', () => {
    const dayBeforeStart = addDays(annuityMeta.startDate, -1);
    expect(loanOutstandingMinorAt(annuityMeta, HOLDING_ID, EMPTY_PRICE_BOOK, dayBeforeStart)).toBe(
      0,
    );
  });

  it('an overpaid correction clamps to 0 in the SCHEDULED (annuity/differentiated) branch too', () => {
    const installments = loanInstallments(annuityMeta);
    const correctionDay = installments[234].dueDate;
    const book = buildPriceBook([
      {
        instrument: holdingInstrument(HOLDING_ID),
        day: dayKeyOf(correctionDay),
        price: '100.00',
        currency: 'UAH',
        source: 'manual',
      },
    ]);

    // The correction (100.00 = 10,000 minor units) is far smaller than the
    // principal due over the next 5 installments, so the un-clamped
    // subtraction would go deeply negative.
    const lastDueDate = installments[239].dueDate;
    expect(loanOutstandingMinorAt(annuityMeta, HOLDING_ID, book, lastDueDate)).toBe(0);
  });
});

const interestOfOnePayment = (meta: LoanMeta, time: number, paidMinorUnits: number): number =>
  loanInterestPerPaymentMinor(meta, [{ time, amountMinorUnits: -paidMinorUnits }])[0];

describe('loanInterestPerPaymentMinor', () => {
  it('is 0 for a none-schedule (informal) loan', () => {
    expect(interestOfOnePayment(noneMeta, local(2021, 0, 1), 10_000_00)).toBe(0);
  });

  it('N10b: maps a payment 3 days after a due date to that installment, capped by the payment amount', () => {
    const installments = loanInstallments(annuityMeta);
    const fifth = installments[4];
    const paymentDay = addDays(fifth.dueDate, 3);

    // The payment comfortably covers the scheduled interest: the full
    // installment interest counts.
    expect(interestOfOnePayment(annuityMeta, paymentDay, fifth.interestMinorUnits + 50_000)).toBe(
      fifth.interestMinorUnits,
    );

    // A partial payment smaller than the scheduled interest caps at the
    // payment amount itself.
    const partial = Math.floor(fifth.interestMinorUnits / 2);
    expect(interestOfOnePayment(annuityMeta, paymentDay, partial)).toBe(partial);
  });

  it('picks the NEAREST installment by due date, not the first or last', () => {
    const installments = loanInstallments(annuityMeta);
    const hundredth = installments[99];
    const paymentDay = addDays(hundredth.dueDate, -2);
    expect(interestOfOnePayment(annuityMeta, paymentDay, 10_000_000)).toBe(
      hundredth.interestMinorUnits,
    );
  });

  // A payment more than ONE PERIOD outside the schedule counts 0 interest,
  // rather than mapping to the nearest
  // (first/last) installment regardless of distance. "One period" is the
  // same monthly cadence `loanInstallments` builds each due date from
  // (`addMonths(startDate, k)`): one period before the first installment is
  // `addMonths(startDate, 0)` (= `startDate` itself), one period after the
  // last is `addMonths(startDate, termMonths + 1)`.
  it('a payment more than one period before the first installment counts 0 interest', () => {
    const beforeLowerBound = addDays(annuityMeta.startDate, -1);
    expect(interestOfOnePayment(annuityMeta, beforeLowerBound, 10_000_000)).toBe(0);
  });

  it('a payment more than one period after the last installment counts 0 interest', () => {
    const installments = loanInstallments(annuityMeta);
    const upperBound = addMonths(annuityMeta.startDate, installments.length + 1);
    const afterUpperBound = addDays(upperBound, 1);
    expect(interestOfOnePayment(annuityMeta, afterUpperBound, 10_000_000)).toBe(0);
  });

  it('a payment exactly one period before the first installment still maps to it (boundary is inclusive)', () => {
    const installments = loanInstallments(annuityMeta);
    expect(interestOfOnePayment(annuityMeta, annuityMeta.startDate, 10_000_000)).toBe(
      installments[0].interestMinorUnits,
    );
  });

  it('a payment exactly one period after the last installment still maps to it (boundary is inclusive)', () => {
    const installments = loanInstallments(annuityMeta);
    const upperBound = addMonths(annuityMeta.startDate, installments.length + 1);
    expect(interestOfOnePayment(annuityMeta, upperBound, 10_000_000)).toBe(
      installments[installments.length - 1].interestMinorUnits,
    );
  });

  // One installment paid in two halves carries its scheduled interest once:
  // the earlier half takes it, the later half is all principal.
  it('counts an installment paid in two halves as interest only once, earliest half first', () => {
    const twoYearMeta: LoanMeta = { ...annuityMeta, termMonths: 24 };
    const first = loanInstallments(twoYearMeta)[0];
    const half = Math.round(first.paymentMinorUnits / 2);
    const earlier = { time: addDays(first.dueDate, -6), amountMinorUnits: -half };
    const later = { time: addDays(first.dueDate, -5), amountMinorUnits: -half };

    expect(half).toBeGreaterThan(first.interestMinorUnits);
    expect(loanInterestPerPaymentMinor(twoYearMeta, [later, earlier])).toEqual([
      0,
      first.interestMinorUnits,
    ]);
  });

  it('lets a later part take the interest an earlier, smaller part could not cover', () => {
    const first = loanInstallments(annuityMeta)[0];
    const small = Math.floor(first.interestMinorUnits / 3);
    const payments = [
      { time: addDays(first.dueDate, -1), amountMinorUnits: -small },
      { time: first.dueDate, amountMinorUnits: -first.paymentMinorUnits },
    ];

    expect(loanInterestPerPaymentMinor(annuityMeta, payments)).toEqual([
      small,
      first.interestMinorUnits - small,
    ]);
  });

  it('keeps each installment interest separate when the parts map to different installments', () => {
    const [first, second] = loanInstallments(annuityMeta);
    const payments = [
      { time: first.dueDate, amountMinorUnits: -first.paymentMinorUnits },
      { time: second.dueDate, amountMinorUnits: -second.paymentMinorUnits },
    ];

    expect(loanInterestPerPaymentMinor(annuityMeta, payments)).toEqual([
      first.interestMinorUnits,
      second.interestMinorUnits,
    ]);
  });
});

describe('withinInstallmentTolerance', () => {
  it('links up to 1% of the installment either side, the bounds inclusive', () => {
    expect(withinInstallmentTolerance(1_000_000, 1_010_000, 'UAH')).toBe(true);
    expect(withinInstallmentTolerance(1_000_000, 1_010_001, 'UAH')).toBe(false);
    expect(withinInstallmentTolerance(1_000_000, 990_000, 'UAH')).toBe(true);
    expect(withinInstallmentTolerance(1_000_000, 989_999, 'UAH')).toBe(false);
  });

  it('lets the 1.00 floor of the loan currency beat 1% on a small installment', () => {
    expect(withinInstallmentTolerance(5_000, 5_100, 'UAH')).toBe(true);
    expect(withinInstallmentTolerance(5_000, 5_101, 'UAH')).toBe(false);
  });

  it('scales the floor by the currency decimals', () => {
    expect(withinInstallmentTolerance(5_000_000, 105_000_000, 'BTC')).toBe(true);
    expect(withinInstallmentTolerance(5_000_000, 105_000_001, 'BTC')).toBe(false);
  });
});

const payAbove = (installment: LoanInstallment, extraMinorUnits: number, daysFromDue = 0) => ({
  time: addDays(installment.dueDate, daysFromDue),
  amountMinorUnits: -(installment.paymentMinorUnits + extraMinorUnits),
});

const splitsOf = (meta: LoanMeta, payments: Parameters<typeof loanPaymentSplitsMinor>[1]) =>
  loanPaymentSplitsMinor(meta, payments, 'UAH');

describe('loanPaymentSplitsMinor', () => {
  const installments = loanInstallments(annuityMeta);
  const [first] = installments;

  it('an exact match carries no excess', () => {
    expect(splitsOf(annuityMeta, [payAbove(first, 0)])).toEqual([
      { interestMinorUnits: first.interestMinorUnits, excessMinorUnits: 0 },
    ]);
  });

  it('an over-payment within tolerance books the difference as excess, the interest unchanged', () => {
    expect(splitsOf(annuityMeta, [payAbove(first, 3_000)])).toEqual([
      { interestMinorUnits: first.interestMinorUnits, excessMinorUnits: 3_000 },
    ]);
  });

  it('an under-payment within tolerance carries no excess', () => {
    expect(splitsOf(annuityMeta, [payAbove(first, -3_000)])).toEqual([
      { interestMinorUnits: first.interestMinorUnits, excessMinorUnits: 0 },
    ]);
  });

  it('a payment above the tolerance is a prepayment with no excess, one unit above it too', () => {
    const tolerance = Math.round(first.paymentMinorUnits * 0.01);

    expect(splitsOf(annuityMeta, [payAbove(first, tolerance)])[0].excessMinorUnits).toBe(tolerance);
    expect(splitsOf(annuityMeta, [payAbove(first, tolerance + 1)])[0].excessMinorUnits).toBe(0);
    expect(splitsOf(annuityMeta, [payAbove(first, 2_000_000)])[0].excessMinorUnits).toBe(0);
  });

  it('a partial payment carries no excess and never more interest than it paid', () => {
    const partial = Math.floor(first.interestMinorUnits / 2);

    expect(splitsOf(annuityMeta, [{ time: first.dueDate, amountMinorUnits: -partial }])).toEqual([
      { interestMinorUnits: partial, excessMinorUnits: 0 },
    ]);
  });

  it('a prepayment that took the interest leaves the regular payment its whole scheduled amount as principal', () => {
    const prepayment = payAbove(first, 2_000_000, -2);
    const regular = payAbove(first, 3_000);

    expect(splitsOf(annuityMeta, [regular, prepayment])).toEqual([
      { interestMinorUnits: 0, excessMinorUnits: 3_000 },
      { interestMinorUnits: first.interestMinorUnits, excessMinorUnits: 0 },
    ]);
  });

  it('gives every within-tolerance payment mapped to one installment its own excess', () => {
    const earlier = payAbove(first, 3_000, -1);
    const later = payAbove(first, 2_000, 1);

    expect(splitsOf(annuityMeta, [earlier, later])).toEqual([
      { interestMinorUnits: first.interestMinorUnits, excessMinorUnits: 3_000 },
      { interestMinorUnits: 0, excessMinorUnits: 2_000 },
    ]);
  });

  it('checks the last installment against its own scheduled payment', () => {
    const last = installments[239];
    const regular = { time: last.dueDate, amountMinorUnits: -first.paymentMinorUnits };

    expect(first.paymentMinorUnits).toBeLessThan(last.paymentMinorUnits);
    expect(splitsOf(annuityMeta, [payAbove(last, 3_000)])).toEqual([
      { interestMinorUnits: last.interestMinorUnits, excessMinorUnits: 3_000 },
    ]);
    expect(splitsOf(annuityMeta, [regular])[0].excessMinorUnits).toBe(0);
  });

  it('counts no excess for a payment outside the schedule', () => {
    const early = { time: addDays(annuityMeta.startDate, -1), amountMinorUnits: -1_323_303 };

    expect(splitsOf(annuityMeta, [early])).toEqual([
      { interestMinorUnits: 0, excessMinorUnits: 0 },
    ]);
  });

  it('books the excess of a zero-rate loan the same way', () => {
    const zeroRate: LoanMeta = { ...annuityMeta, annualRatePct: 0 };
    const [zeroFirst] = loanInstallments(zeroRate);

    expect(splitsOf(zeroRate, [payAbove(zeroFirst, 3_000)])).toEqual([
      { interestMinorUnits: 0, excessMinorUnits: 3_000 },
    ]);
  });

  it('measures a differentiated loan against each installment own scheduled payment', () => {
    const scheduled = loanInstallments(differentiatedMeta);
    const [early, late] = [scheduled[0], scheduled[99]];

    expect(splitsOf(differentiatedMeta, [payAbove(late, 3_000)])[0].excessMinorUnits).toBe(3_000);
    expect(
      splitsOf(differentiatedMeta, [
        { time: late.dueDate, amountMinorUnits: -early.paymentMinorUnits },
      ])[0].excessMinorUnits,
    ).toBe(0);
  });

  it('counts no interest and no excess for a none-schedule loan', () => {
    expect(
      splitsOf(noneMeta, [{ time: local(2020, 1, 15), amountMinorUnits: -1_000_000 }]),
    ).toEqual([{ interestMinorUnits: 0, excessMinorUnits: 0 }]);
  });

  it('uses the 1.00 floor of the loan currency on a small installment', () => {
    const small: LoanMeta = { ...annuityMeta, principalMinorUnits: 60_000, annualRatePct: 0 };
    const [smallFirst] = loanInstallments(small);

    expect(splitsOf(small, [payAbove(smallFirst, 100)])[0].excessMinorUnits).toBe(100);
    expect(splitsOf(small, [payAbove(smallFirst, 101)])[0].excessMinorUnits).toBe(0);
  });

  it('keeps the result in the order the payments are given', () => {
    const [, second] = installments;

    expect(
      splitsOf(annuityMeta, [payAbove(second, 3_000), payAbove(first, 1_000)]).map(
        (split) => split.excessMinorUnits,
      ),
    ).toEqual([3_000, 1_000]);
  });
});
