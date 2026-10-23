import { buildPriceBook, dayKeyOf, type PriceBook } from '@kiko/prices/price-book';

import type { LoanMeta } from '../holding-metadata';
import { isScheduledPayment, loanInstallments, type LoanInstallment } from '../loan-schedule';

import { loanLedgerOutstandingMinorAt, loanRemaindersAfterMinor } from './loan-ledger';

const LOAN = { id: 'loan-ledger-property', currency: 'UAH' as const };

// Every date is built from local Y/M/D fields: `jest.config.js` pins the zone to Europe/Kyiv.
const local = (year: number, monthIndex: number, day: number, hour = 0): number =>
  new Date(year, monthIndex, day, hour).getTime();

const START_DATES = [
  local(2027, 0, 31),
  local(2028, 1, 29),
  local(2027, 2, 28),
  local(2027, 5, 15),
];
const SCHEDULES = ['annuity', 'differentiated'] as const;
const TERMS = [1, 12, 13] as const;

// What a counted payment of one row pays: nothing, part of it, exactly it, and more than it.
const PAID_FRACTIONS = [0, 0.5, 1, 1.5] as const;

type Case = { label: string; meta: LoanMeta; rows: readonly LoanInstallment[] };

const CASES: readonly Case[] = START_DATES.flatMap((startDate) =>
  SCHEDULES.flatMap((schedule) =>
    TERMS.map((termMonths) => {
      const meta: LoanMeta = {
        kind: 'personal',
        principalMinorUnits: 1_234_567,
        startDate,
        annualRatePct: 12,
        termMonths,
        schedule,
      };

      return {
        label: `${schedule} ${new Date(startDate).toDateString()} x${termMonths}`,
        meta,
        rows: loanInstallments(meta),
      };
    }),
  ),
);

const principalThrough = (rows: readonly LoanInstallment[], count: number): number =>
  rows.slice(0, count).reduce((sum, row) => sum + row.principalMinorUnits, 0);

const bookPaying = (time: number, amountMinorUnits: number): PriceBook =>
  buildPriceBook(
    [],
    amountMinorUnits === 0
      ? []
      : [{ loanHoldingId: LOAN.id, time, amountMinorUnits: -amountMinorUnits, currency: 'UAH' }],
  );

// The first listed row is the paid one. Its unpaid principal is what the header did not take off
// the balance before it; every later row is whole. The header less those, clamped at 0, is each
// remainder.
const expectedRemainders = (
  listed: readonly LoanInstallment[],
  header: number,
  unpaidOfFirstRow: number,
): number[] =>
  listed.map((_, position) =>
    Math.max(
      0,
      header -
        unpaidOfFirstRow -
        (principalThrough(listed, position + 1) - listed[0].principalMinorUnits),
    ),
  );

const mismatchesOf = (
  meta: LoanMeta,
  rows: readonly LoanInstallment[],
  paidRow: LoanInstallment,
  fraction: number,
): string[] => {
  const due = new Date(paidRow.dueDate);
  const now = local(due.getFullYear(), due.getMonth(), due.getDate(), 12);
  const book = bookPaying(now, Math.round(paidRow.paymentMinorUnits * fraction));
  const listed = rows.filter(
    (row) => isScheduledPayment(row) && dayKeyOf(row.dueDate) >= dayKeyOf(now),
  );
  const header = loanLedgerOutstandingMinorAt(meta, LOAN, book, now);
  const balanceBefore = meta.principalMinorUnits - principalThrough(rows, paidRow.index - 1);
  const unpaid = Math.max(0, paidRow.principalMinorUnits - (balanceBefore - header));
  const remainders = loanRemaindersAfterMinor(meta, LOAN, book, now, listed);
  const expected = expectedRemainders(listed, header, unpaid);

  return [
    ...(remainders.join() === expected.join()
      ? []
      : [`remainders ${remainders.join()}, expected ${expected.join()}`]),
    ...(remainders.every((value, position) => position === 0 || value <= remainders[position - 1])
      ? []
      : ['a remainder rose above the one before it']),
    ...(remainders[remainders.length - 1] === 0
      ? []
      : [`last remainder was ${remainders[remainders.length - 1]}, expected 0`]),
  ];
};

describe('loan ledger property: remainders after each upcoming installment', () => {
  it('keeps the unpaid principal of every listed row, whatever one row was paid', () => {
    const violations = CASES.flatMap(({ label, meta, rows }) =>
      rows
        .filter(isScheduledPayment)
        .flatMap((paidRow) =>
          PAID_FRACTIONS.flatMap((fraction) =>
            mismatchesOf(meta, rows, paidRow, fraction).map(
              (message) => `${label} row ${paidRow.index} paid x${fraction}: ${message}`,
            ),
          ),
        ),
    );

    expect(violations).toEqual([]);
  });
});
