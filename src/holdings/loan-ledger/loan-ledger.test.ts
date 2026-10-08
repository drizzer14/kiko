import type { Currency } from '@kiko/currency/currency';
import { holdingInstrument } from '@kiko/prices/instrument';
import { buildPriceBook, dayKeyOf, type PriceBook } from '@kiko/prices/price-book';

import { addMonths } from '../interest';
import type { LoanMeta } from '../holding-metadata';
import { loanInstallments, loanOutstandingMinorAt, type LoanInstallment } from '../loan-schedule';

import { loanLedgerOutstandingMinorAt, loanLedgerSummary } from './loan-ledger';

const LOAN = { id: 'loan-1', currency: 'UAH' as const };

// A DEVICE-LOCAL instant — every loan boundary (`addMonths`, `dayKeyOf`) is
// built from local Y/M/D fields, so an epoch literal would drift a day on a
// non-UTC device.
const local = (year: number, monthIndex: number, day: number, hour = 0): number =>
  new Date(year, monthIndex, day, hour).getTime();

const addDays = (instant: number, days: number): number => {
  const date = new Date(instant);

  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days).getTime();
};

const annuityMeta: LoanMeta = {
  kind: 'car_loan',
  principalMinorUnits: 12_000_000,
  startDate: local(2024, 0, 15),
  annualRatePct: 12,
  termMonths: 12,
  schedule: 'annuity',
};

const noneMeta: LoanMeta = {
  kind: 'personal',
  principalMinorUnits: 5_000_000,
  startDate: local(2024, 0, 15),
  schedule: 'none',
};

const installments = loanInstallments(annuityMeta);

type PaymentInput = { time: number; amountMinorUnits: number; currency?: Currency };

const bookWith = (
  payments: readonly PaymentInput[],
  corrections: readonly { day: number; price: string }[] = [],
): PriceBook =>
  buildPriceBook(
    corrections.map((correction) => ({
      instrument: holdingInstrument(LOAN.id),
      day: dayKeyOf(correction.day),
      price: correction.price,
      currency: 'UAH' as const,
      source: 'manual' as const,
    })),
    payments.map((payment) => ({
      loanHoldingId: LOAN.id,
      time: payment.time,
      amountMinorUnits: payment.amountMinorUnits,
      currency: payment.currency ?? 'UAH',
    })),
  );

// Pays installment `index` (0-based) in full on its own due date.
const onSchedule = (index: number): PaymentInput => ({
  time: installments[index].dueDate,
  amountMinorUnits: -installments[index].paymentMinorUnits,
});

describe('loanLedgerOutstandingMinorAt', () => {
  it('equals the schedule exactly when the loan has no linked payment', () => {
    const book = bookWith([], [{ day: installments[2].dueDate, price: '100000.00' }]);

    for (const instant of [
      addDays(annuityMeta.startDate, -1),
      annuityMeta.startDate,
      installments[1].dueDate,
      installments[4].dueDate,
      addDays(installments[11].dueDate, 30),
    ]) {
      expect(loanLedgerOutstandingMinorAt(annuityMeta, LOAN, book, instant)).toBe(
        loanOutstandingMinorAt(annuityMeta, LOAN.id, book, instant),
      );
    }
  });

  it('subtracts the principal part of each linked payment from the principal', () => {
    const book = bookWith([onSchedule(0), onSchedule(1)]);
    const repaid = installments[0].principalMinorUnits + installments[1].principalMinorUnits;

    expect(loanLedgerOutstandingMinorAt(annuityMeta, LOAN, book, installments[5].dueDate)).toBe(
      annuityMeta.principalMinorUnits - repaid,
    );
  });

  // Each net-worth bucket sees only the payments dated at or before it.
  it('counts only the payments whose local day is on or before the instant', () => {
    const book = bookWith([onSchedule(0), onSchedule(1)]);

    expect(
      loanLedgerOutstandingMinorAt(annuityMeta, LOAN, book, addDays(installments[1].dueDate, -1)),
    ).toBe(annuityMeta.principalMinorUnits - installments[0].principalMinorUnits);
  });

  // A bucket sampled at local midnight counts a payment made later that
  // same local day, the same local-day rule the payer card's running balance
  // uses, so the card's debit and the loan's drop land in one bucket.
  it('counts a payment made later on the same local day as the instant', () => {
    const afternoon = local(2024, 1, 15, 14);
    const book = bookWith([
      { time: afternoon, amountMinorUnits: -installments[0].paymentMinorUnits },
    ]);

    expect(loanLedgerOutstandingMinorAt(annuityMeta, LOAN, book, local(2024, 1, 15))).toBe(
      annuityMeta.principalMinorUnits - installments[0].principalMinorUnits,
    );
  });

  // The loan form reads one book with the old and the new terms.
  it('reads the same book with different terms as two different loans', () => {
    const freshBook = (): PriceBook => bookWith([onSchedule(0), onSchedule(1)]);
    const book = freshBook();
    const cheaperMeta: LoanMeta = { ...annuityMeta, annualRatePct: 6 };
    const instant = installments[5].dueDate;

    expect(loanLedgerOutstandingMinorAt(annuityMeta, LOAN, book, instant)).toBe(
      loanLedgerOutstandingMinorAt(annuityMeta, LOAN, freshBook(), instant),
    );
    expect(loanLedgerOutstandingMinorAt(cheaperMeta, LOAN, book, instant)).toBe(
      loanLedgerOutstandingMinorAt(cheaperMeta, LOAN, freshBook(), instant),
    );
    expect(loanLedgerOutstandingMinorAt(cheaperMeta, LOAN, book, instant)).not.toBe(
      loanLedgerOutstandingMinorAt(annuityMeta, LOAN, book, instant),
    );
  });

  it('counts the interest once when the first installment is paid in two halves', () => {
    const twoYearMeta: LoanMeta = { ...annuityMeta, termMonths: 24 };
    const first = loanInstallments(twoYearMeta)[0];
    const half = first.paymentMinorUnits / 2;
    const book = bookWith([
      { time: local(2024, 1, 9, 10), amountMinorUnits: -half },
      { time: local(2024, 1, 10, 10), amountMinorUnits: -half },
    ]);
    const summary = loanLedgerSummary(twoYearMeta, LOAN, book, local(2024, 1, 20));

    expect(first.paymentMinorUnits).toBe(564_882);
    expect(summary.interestPaidMinorUnits).toBe(120_000);
    expect(summary.outstandingMinorUnits).toBe(11_555_118);
  });

  it('clamps an overpaid loan to 0', () => {
    const book = bookWith([{ time: installments[0].dueDate, amountMinorUnits: -20_000_000 }]);

    expect(loanLedgerOutstandingMinorAt(annuityMeta, LOAN, book, installments[1].dueDate)).toBe(0);
  });

  it('re-anchors on a correction recorded after the payments', () => {
    const correctionDay = addDays(installments[1].dueDate, 5);
    const book = bookWith(
      [onSchedule(0), onSchedule(1), onSchedule(2)],
      [{ day: correctionDay, price: '90000.00' }],
    );

    expect(loanLedgerOutstandingMinorAt(annuityMeta, LOAN, book, correctionDay)).toBe(9_000_000);
    expect(loanLedgerOutstandingMinorAt(annuityMeta, LOAN, book, installments[3].dueDate)).toBe(
      9_000_000 - installments[2].principalMinorUnits,
    );
  });

  it('counts the whole payment as principal for a "none" schedule loan', () => {
    const book = bookWith(
      [{ time: local(2024, 2, 1), amountMinorUnits: -1_000_000 }],
      [{ day: noneMeta.startDate, price: '50000.00' }],
    );

    expect(loanLedgerOutstandingMinorAt(noneMeta, LOAN, book, local(2024, 3, 1))).toBe(4_000_000);
  });

  describe('a loan whose early payments were never linked', () => {
    const mortgageMeta: LoanMeta = {
      kind: 'mortgage',
      principalMinorUnits: 60_000_000,
      startDate: local(2021, 0, 15),
      annualRatePct: 10,
      termMonths: 120,
      schedule: 'annuity',
    };
    const schedule = loanInstallments(mortgageMeta);
    const [firstLinked, secondLinked] = [schedule[48], schedule[49]];
    // Each linked payment is 1000.00 above the scheduled one, so the ledger
    // and the schedule disagree after the first link.
    const extra = 100_000;
    const book = bookWith([
      { time: firstLinked.dueDate, amountMinorUnits: -(firstLinked.paymentMinorUnits + extra) },
      { time: secondLinked.dueDate, amountMinorUnits: -(secondLinked.paymentMinorUnits + extra) },
    ]);
    const dayBeforeFirstLink = addDays(firstLinked.dueDate, -1);
    const scheduleBeforeFirstLink = loanOutstandingMinorAt(
      mortgageMeta,
      LOAN.id,
      bookWith([]),
      dayBeforeFirstLink,
    );

    it('anchors on the schedule outstanding the day before the first link', () => {
      const linkedPrincipal =
        firstLinked.principalMinorUnits + secondLinked.principalMinorUnits + 2 * extra;

      expect(loanLedgerOutstandingMinorAt(mortgageMeta, LOAN, book, secondLinked.dueDate)).toBe(
        scheduleBeforeFirstLink - linkedPrincipal,
      );
    });

    it('never steps the history up at the first link', () => {
      const before = loanLedgerOutstandingMinorAt(mortgageMeta, LOAN, book, dayBeforeFirstLink);
      const onLink = loanLedgerOutstandingMinorAt(mortgageMeta, LOAN, book, firstLinked.dueDate);

      expect(before).toBe(scheduleBeforeFirstLink);
      expect(onLink).toBe(before - firstLinked.principalMinorUnits - extra);
    });

    it('still re-anchors on a correction dated after the first link', () => {
      const correctionDay = addDays(firstLinked.dueDate, 3);
      const corrected = bookWith(
        [
          {
            time: firstLinked.dueDate,
            amountMinorUnits: -(firstLinked.paymentMinorUnits + extra),
          },
          {
            time: secondLinked.dueDate,
            amountMinorUnits: -(secondLinked.paymentMinorUnits + extra),
          },
        ],
        [{ day: correctionDay, price: '300000.00' }],
      );

      expect(
        loanLedgerOutstandingMinorAt(mortgageMeta, LOAN, corrected, secondLinked.dueDate),
      ).toBe(30_000_000 - secondLinked.principalMinorUnits - extra);
    });

    it.each([1, 2, 3, 7])(
      'matches the schedule with no step when the first link lands %d day(s) after its due date',
      (daysLate) => {
        const latePaymentTime = addDays(firstLinked.dueDate, daysLate);
        const lateBook = bookWith([
          { time: latePaymentTime, amountMinorUnits: -firstLinked.paymentMinorUnits },
        ]);

        expect(loanLedgerOutstandingMinorAt(mortgageMeta, LOAN, lateBook, latePaymentTime)).toBe(
          firstLinked.balanceMinorUnits,
        );
      },
    );

    it('matches the schedule with no step when the first link lands before its due date', () => {
      const earlyPaymentTime = addDays(firstLinked.dueDate, -2);
      const earlyBook = bookWith([
        { time: earlyPaymentTime, amountMinorUnits: -firstLinked.paymentMinorUnits },
      ]);

      expect(loanLedgerOutstandingMinorAt(mortgageMeta, LOAN, earlyBook, earlyPaymentTime)).toBe(
        firstLinked.balanceMinorUnits,
      );
    });
  });

  // Both payments map to the first installment, so they share its interest
  // once and everything else they paid is principal.
  it('anchors on the principal when the first link is on the start day', () => {
    const startDayPaid = 100_000;
    const book = bookWith([
      { time: annuityMeta.startDate, amountMinorUnits: -startDayPaid },
      onSchedule(0),
    ]);

    expect(loanLedgerOutstandingMinorAt(annuityMeta, LOAN, book, installments[0].dueDate)).toBe(
      annuityMeta.principalMinorUnits - installments[0].principalMinorUnits - startDayPaid,
    );
  });

  it('anchors a "none" schedule loan with no correction on its principal', () => {
    const book = bookWith([{ time: local(2024, 2, 1), amountMinorUnits: -1_000_000 }]);

    expect(loanLedgerOutstandingMinorAt(noneMeta, LOAN, book, local(2024, 3, 1))).toBe(4_000_000);
  });

  it('is 0 before the loan start date', () => {
    const book = bookWith([onSchedule(0)]);

    expect(
      loanLedgerOutstandingMinorAt(annuityMeta, LOAN, book, addDays(annuityMeta.startDate, -1)),
    ).toBe(0);
  });

  // The same rule the spending pie's loan-payment exclusion applies: only a
  // debit in the loan's own currency pays it down.
  it('ignores a payment in another currency and a credit', () => {
    const book = bookWith([
      { time: installments[0].dueDate, amountMinorUnits: -500_000, currency: 'USD' },
      { time: installments[0].dueDate, amountMinorUnits: 500_000 },
    ]);

    expect(loanLedgerOutstandingMinorAt(annuityMeta, LOAN, book, installments[1].dueDate)).toBe(
      loanOutstandingMinorAt(annuityMeta, LOAN.id, book, installments[1].dueDate),
    );
  });
});

describe('loanLedgerSummary', () => {
  it('reads zero paid for a loan with no linked payment, and the schedule outstanding', () => {
    const book = bookWith([]);
    const now = installments[3].dueDate;

    expect(loanLedgerSummary(annuityMeta, LOAN, book, now)).toEqual({
      principalMinorUnits: 12_000_000,
      paidSoFarMinorUnits: 0,
      interestPaidMinorUnits: 0,
      principalRepaidMinorUnits: 0,
      outstandingMinorUnits: loanOutstandingMinorAt(annuityMeta, LOAN.id, book, now),
    });
  });

  it('splits partial annuity payments into interest and principal', () => {
    const partial = { time: installments[1].dueDate, amountMinorUnits: -50_000 };
    const book = bookWith([onSchedule(0), partial]);
    const paid = installments[0].paymentMinorUnits + 50_000;
    // A partial payment never counts more interest than it paid.
    const interest = installments[0].interestMinorUnits + 50_000;

    expect(loanLedgerSummary(annuityMeta, LOAN, book, installments[2].dueDate)).toEqual({
      principalMinorUnits: 12_000_000,
      paidSoFarMinorUnits: paid,
      interestPaidMinorUnits: interest,
      principalRepaidMinorUnits: paid - interest,
      outstandingMinorUnits: 12_000_000 - (paid - interest),
    });
  });

  it('reads an overpaid loan as paid off', () => {
    const book = bookWith([{ time: installments[0].dueDate, amountMinorUnits: -20_000_000 }]);

    expect(
      loanLedgerSummary(annuityMeta, LOAN, book, installments[1].dueDate).outstandingMinorUnits,
    ).toBe(0);
  });

  it('counts no interest for a "none" schedule loan', () => {
    const book = bookWith(
      [{ time: local(2024, 2, 1), amountMinorUnits: -1_000_000 }],
      [{ day: noneMeta.startDate, price: '50000.00' }],
    );

    expect(loanLedgerSummary(noneMeta, LOAN, book, local(2024, 3, 1))).toEqual({
      principalMinorUnits: 5_000_000,
      paidSoFarMinorUnits: 1_000_000,
      interestPaidMinorUnits: 0,
      principalRepaidMinorUnits: 1_000_000,
      outstandingMinorUnits: 4_000_000,
    });
  });

  it('counts no interest for a payment more than one period outside the schedule', () => {
    const late = addMonths(annuityMeta.startDate, installments.length + 2);
    const book = bookWith([{ time: late, amountMinorUnits: -100_000 }]);
    const summary = loanLedgerSummary(annuityMeta, LOAN, book, late);

    expect(summary.interestPaidMinorUnits).toBe(0);
    expect(summary.principalRepaidMinorUnits).toBe(100_000);
  });

  it('ignores a payment dated after now', () => {
    const book = bookWith([onSchedule(0), onSchedule(1)]);
    const summary = loanLedgerSummary(annuityMeta, LOAN, book, installments[0].dueDate);

    expect(summary.paidSoFarMinorUnits).toBe(installments[0].paymentMinorUnits);
    expect(summary.outstandingMinorUnits).toBe(
      annuityMeta.principalMinorUnits - installments[0].principalMinorUnits,
    );
  });
});

// A bank debit a little above the scheduled payment is a fee, not a part of
// the principal: the loan drops by the scheduled principal only.
describe('a within-tolerance over-payment', () => {
  const FEE = 3_000;
  const mortgageMeta: LoanMeta = {
    kind: 'mortgage',
    principalMinorUnits: 200_000_000,
    startDate: local(2024, 0, 15),
    annualRatePct: 15,
    termMonths: 240,
    schedule: 'annuity',
  };
  const schedule = loanInstallments(mortgageMeta);
  const withFee = (index: number, extraMinorUnits = FEE): PaymentInput => ({
    time: schedule[index].dueDate,
    amountMinorUnits: -(schedule[index].paymentMinorUnits + extraMinorUnits),
  });
  const sixWithFee = [0, 1, 2, 3, 4, 5].map((index) => withFee(index));

  it('keeps the ledger equal to the schedule after six payments of the scheduled amount plus the fee', () => {
    const book = bookWith(sixWithFee);

    expect(schedule[5].balanceMinorUnits).toBe(199_173_059);
    expect(loanLedgerOutstandingMinorAt(mortgageMeta, LOAN, book, schedule[5].dueDate)).toBe(
      schedule[5].balanceMinorUnits,
    );
  });

  it('caps a manual link the same way, because the amount decides and not the link source', () => {
    const book = bookWith([withFee(0)]);

    expect(loanLedgerOutstandingMinorAt(mortgageMeta, LOAN, book, schedule[0].dueDate)).toBe(
      schedule[0].balanceMinorUnits,
    );
  });

  it('leaves an under-payment short by what was not paid', () => {
    const book = bookWith([withFee(0, -FEE)]);

    expect(loanLedgerOutstandingMinorAt(mortgageMeta, LOAN, book, schedule[0].dueDate)).toBe(
      schedule[0].balanceMinorUnits + FEE,
    );
  });

  it('still counts a prepayment above the tolerance as principal', () => {
    const book = bookWith([withFee(0, 10_000_000)]);

    expect(loanLedgerOutstandingMinorAt(mortgageMeta, LOAN, book, schedule[0].dueDate)).toBe(
      schedule[0].balanceMinorUnits - 10_000_000,
    );
  });

  it('caps only the payments after a correction, the ones on or before it are already inside it', () => {
    const correctionDay = schedule[1].dueDate;
    const book = bookWith(
      [withFee(0), withFee(1), withFee(2)],
      [{ day: correctionDay, price: '1900000.00' }],
    );

    expect(loanLedgerOutstandingMinorAt(mortgageMeta, LOAN, book, schedule[2].dueDate)).toBe(
      190_000_000 - schedule[2].principalMinorUnits,
    );
  });

  it('leaves the paid total as the bank total and the principal repaid without the fee', () => {
    const book = bookWith(sixWithFee);
    const summary = loanLedgerSummary(mortgageMeta, LOAN, book, schedule[5].dueDate);
    const scheduled = schedule.slice(0, 6);
    const sumOf = (pick: (row: LoanInstallment) => number): number =>
      scheduled.reduce((sum, row) => sum + pick(row), 0);

    expect(summary).toEqual({
      principalMinorUnits: 200_000_000,
      paidSoFarMinorUnits: sumOf((row) => row.paymentMinorUnits) + 6 * FEE,
      interestPaidMinorUnits: sumOf((row) => row.interestMinorUnits),
      principalRepaidMinorUnits: sumOf((row) => row.principalMinorUnits),
      outstandingMinorUnits: schedule[5].balanceMinorUnits,
    });
  });

  // The last installment absorbs the rounding, so its payment differs from the
  // regular one; the fee above it is still excess, never principal.
  it('pays a loan off to exactly 0 when the last installment is paid with the fee', () => {
    const last = installments[installments.length - 1];
    const book = bookWith([
      ...installments.slice(0, -1).map((_, index) => onSchedule(index)),
      { time: last.dueDate, amountMinorUnits: -(last.paymentMinorUnits + FEE) },
    ]);

    expect(last.paymentMinorUnits).not.toBe(installments[0].paymentMinorUnits);
    expect(loanLedgerOutstandingMinorAt(annuityMeta, LOAN, book, last.dueDate)).toBe(0);
    // The outstanding clamps at 0, so the unclamped principal repaid shows the fee stayed out.
    expect(loanLedgerSummary(annuityMeta, LOAN, book, last.dueDate).principalRepaidMinorUnits).toBe(
      annuityMeta.principalMinorUnits,
    );
  });

  it('ignores a within-tolerance payment in another currency', () => {
    const book = bookWith([{ ...withFee(0), currency: 'USD' }]);

    expect(loanLedgerOutstandingMinorAt(mortgageMeta, LOAN, book, schedule[1].dueDate)).toBe(
      loanOutstandingMinorAt(mortgageMeta, LOAN.id, book, schedule[1].dueDate),
    );
  });
});
