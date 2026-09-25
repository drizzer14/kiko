import { addMonths } from '../interest';
import type { LoanMeta } from '../holding-metadata';
import { holdingInstrument } from '../../prices/instrument';
import { buildPriceBook, dayKeyOf, EMPTY_PRICE_BOOK } from '../../prices/price-book';

import {
  loanInstallments,
  loanInterestForPaymentMinor,
  loanOutstandingMinorAt,
} from './loan-schedule';
import type { LoanInstallment } from './loan-schedule';

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

  it('I1: a correction dated AFTER the queried instant never anchors it — the pure schedule applies instead', () => {
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

  it('M4: is 0 before the loan start date, the none-schedule branch, even with a later correction', () => {
    const point = { day: dayKeyOf(local(2021, 0, 1)), price: '30000.00', currency: 'UAH' as const };
    const book = buildPriceBook([
      { instrument: holdingInstrument(HOLDING_ID), ...point, source: 'manual' as const },
    ]);
    const dayBeforeStart = addDays(noneMeta.startDate, -1);
    expect(loanOutstandingMinorAt(noneMeta, HOLDING_ID, book, dayBeforeStart)).toBe(0);
  });

  it('M4: is 0 before the loan start date, the SCHEDULED (annuity) branch — not the full principal', () => {
    const dayBeforeStart = addDays(annuityMeta.startDate, -1);
    expect(loanOutstandingMinorAt(annuityMeta, HOLDING_ID, EMPTY_PRICE_BOOK, dayBeforeStart)).toBe(
      0,
    );
  });

  it('M5: an overpaid correction clamps to 0 in the SCHEDULED (annuity/differentiated) branch too', () => {
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

describe('loanInterestForPaymentMinor', () => {
  it('is 0 for a none-schedule (informal) loan', () => {
    expect(loanInterestForPaymentMinor(noneMeta, local(2021, 0, 1), 10_000_00)).toBe(0);
  });

  it('N10b: maps a payment 3 days after a due date to that installment, capped by the payment amount', () => {
    const installments = loanInstallments(annuityMeta);
    const fifth = installments[4];
    const paymentDay = addDays(fifth.dueDate, 3);

    // The payment comfortably covers the scheduled interest: the full
    // installment interest counts.
    expect(
      loanInterestForPaymentMinor(annuityMeta, paymentDay, fifth.interestMinorUnits + 50_000),
    ).toBe(fifth.interestMinorUnits);

    // A partial payment smaller than the scheduled interest caps at the
    // payment amount itself.
    const partial = Math.floor(fifth.interestMinorUnits / 2);
    expect(loanInterestForPaymentMinor(annuityMeta, paymentDay, partial)).toBe(partial);
  });

  it('picks the NEAREST installment by due date, not the first or last', () => {
    const installments = loanInstallments(annuityMeta);
    const hundredth = installments[99];
    const paymentDay = addDays(hundredth.dueDate, -2);
    expect(loanInterestForPaymentMinor(annuityMeta, paymentDay, 10_000_000)).toBe(
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
  it('M2: a payment more than one period before the first installment counts 0 interest', () => {
    const beforeLowerBound = addDays(annuityMeta.startDate, -1);
    expect(loanInterestForPaymentMinor(annuityMeta, beforeLowerBound, 10_000_000)).toBe(0);
  });

  it('M2: a payment more than one period after the last installment counts 0 interest', () => {
    const installments = loanInstallments(annuityMeta);
    const upperBound = addMonths(annuityMeta.startDate, installments.length + 1);
    const afterUpperBound = addDays(upperBound, 1);
    expect(loanInterestForPaymentMinor(annuityMeta, afterUpperBound, 10_000_000)).toBe(0);
  });

  it('M2: a payment exactly one period before the first installment still maps to it (boundary is inclusive)', () => {
    const installments = loanInstallments(annuityMeta);
    expect(loanInterestForPaymentMinor(annuityMeta, annuityMeta.startDate, 10_000_000)).toBe(
      installments[0].interestMinorUnits,
    );
  });

  it('M2: a payment exactly one period after the last installment still maps to it (boundary is inclusive)', () => {
    const installments = loanInstallments(annuityMeta);
    const upperBound = addMonths(annuityMeta.startDate, installments.length + 1);
    expect(loanInterestForPaymentMinor(annuityMeta, upperBound, 10_000_000)).toBe(
      installments[installments.length - 1].interestMinorUnits,
    );
  });
});
