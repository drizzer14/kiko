import {
  buildPriceBook,
  dayKeyOf,
  EMPTY_PRICE_BOOK,
  type PriceBook,
} from '@kiko/prices/price-book';
import { holdingInstrument } from '@kiko/prices/instrument';

import { addMonths } from '../interest';
import type { LoanMeta } from '../holding-metadata';
import { loanLedgerOutstandingMinorAt } from '../loan-ledger';

import {
  loanPlanOf,
  loanInstallments,
  installmentIndexOf,
  loanOutstandingMinorAt,
  loanInterestPerPaymentMinor,
  type LoanInstallment,
} from './loan-schedule';

const LOAN = { id: 'loan-property', currency: 'UAH' as const };

// Every date is built from local Y/M/D fields: `jest.config.js` pins the zone
// to Europe/Kyiv, so the DST days below are real 23- and 25-hour days.
const local = (year: number, monthIndex: number, day: number): number =>
  new Date(year, monthIndex, day).getTime();

const shiftDays = (instant: number, days: number): number => {
  const date = new Date(instant);

  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days).getTime();
};

const atTime = (instant: number, hour: number, minute: number): number => {
  const date = new Date(instant);

  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute).getTime();
};

const daysInMonth = (year: number, monthIndex: number): number =>
  new Date(year, monthIndex + 1, 0).getDate();

// A probe sampled at local midnight, noon and the last minute of its day, so
// the gap between "now" and a payment's own time of day varies.
const CLOCK_TIMES: readonly (readonly [number, number])[] = [
  [0, 0],
  [12, 0],
  [23, 59],
];

const PAYMENT_HOUR = 12;

const MONTH_END_DATES = [
  local(2027, 0, 31),
  local(2027, 2, 31),
  local(2027, 4, 31),
  local(2027, 7, 31),
];
const LEAP_DATES = [local(2028, 1, 29), local(2028, 0, 29), local(2028, 0, 30)];
const DST_DATES = [local(2027, 2, 28), local(2027, 9, 31), local(2027, 2, 27), local(2027, 9, 30)];
const FIRST_AND_FIFTEENTH_DATES = Array.from({ length: 12 }, (_, monthIndex) => monthIndex).flatMap(
  (monthIndex) => [local(2027, monthIndex, 1), local(2027, monthIndex, 15)],
);

const START_DATES = [...MONTH_END_DATES, ...LEAP_DATES, ...DST_DATES, ...FIRST_AND_FIFTEENTH_DATES];
const SCHEDULES = ['annuity', 'differentiated'] as const;
const TERMS = [1, 12, 13] as const;

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

// The rows a case pays through the ledger: the first, a middle one and the last.
const paidRowNumbers = (length: number): number[] => [
  ...new Set([1, Math.ceil(length / 2), length]),
];

const principalThrough = (rows: readonly LoanInstallment[], count: number): number =>
  rows.slice(0, count).reduce((sum, row) => sum + row.principalMinorUnits, 0);

const bookWithPayment = (time: number, amountMinorUnits: number): PriceBook =>
  buildPriceBook(
    [],
    [{ loanHoldingId: LOAN.id, time, amountMinorUnits: -amountMinorUnits, currency: 'UAH' }],
  );

// A failed property names its case and probe instead of a bare mismatch.
const mismatchesOf = (
  cases: readonly Case[],
  check: (found: string[], loanCase: Case) => void,
): string[] =>
  cases.flatMap((loanCase) => {
    const found: string[] = [];

    check(found, loanCase);

    return found.map((message) => `${loanCase.label}: ${message}`);
  });

const expectEqual = (found: string[], what: string, actual: unknown, expected: unknown): void => {
  if (actual !== expected) {
    found.push(`${what} was ${String(actual)}, expected ${String(expected)}`);
  }
};

describe('loan schedule property: due dates', () => {
  it('puts payment 1 on the start date and each next payment on its calendar anniversary', () => {
    const violations = mismatchesOf(CASES, (found, { meta, rows }) => {
      const start = new Date(meta.startDate);

      expectEqual(found, 'row count', rows.length, meta.termMonths);
      expectEqual(found, 'row 1 due date', rows[0].dueDate, meta.startDate);

      rows.forEach((row, position) => {
        const target = new Date(start.getFullYear(), start.getMonth() + position, 1);
        const expectedDay = Math.min(
          start.getDate(),
          daysInMonth(target.getFullYear(), target.getMonth()),
        );
        const due = new Date(row.dueDate);

        expectEqual(found, `row ${row.index} index`, row.index, position + 1);
        expectEqual(found, `row ${row.index} year`, due.getFullYear(), target.getFullYear());
        expectEqual(found, `row ${row.index} month`, due.getMonth(), target.getMonth());
        expectEqual(found, `row ${row.index} day`, due.getDate(), expectedDay);
        expectEqual(found, `row ${row.index} hours`, due.getHours(), 0);
        expectEqual(
          found,
          `row ${row.index} against addMonths`,
          row.dueDate,
          addMonths(meta.startDate, position),
        );
        expectEqual(
          found,
          `row ${row.index} after the row before it`,
          position === 0 || row.dueDate > rows[position - 1].dueDate,
          true,
        );
      });
    });

    expect(violations).toEqual([]);
  });
});

describe('loan schedule property: outstanding', () => {
  it('reads principal less the rows due through the probe day, at any time of day', () => {
    const violations = mismatchesOf(CASES, (found, { meta, rows }) => {
      const read = (instant: number): number =>
        loanOutstandingMinorAt(meta, LOAN.id, EMPTY_PRICE_BOOK, instant);

      rows.forEach((row) => {
        CLOCK_TIMES.forEach(([hour, minute]) => {
          expectEqual(
            found,
            `outstanding on due day ${row.index} at ${hour}:${minute}`,
            read(atTime(row.dueDate, hour, minute)),
            meta.principalMinorUnits - principalThrough(rows, row.index),
          );
          expectEqual(
            found,
            `outstanding the day before due day ${row.index} at ${hour}:${minute}`,
            read(atTime(shiftDays(row.dueDate, -1), hour, minute)),
            row.index === 1 ? 0 : meta.principalMinorUnits - principalThrough(rows, row.index - 1),
          );
        });
      });

      const lastDueDate = rows[rows.length - 1].dueDate;

      [0, 1, 45].forEach((daysAfter) => {
        expectEqual(
          found,
          `outstanding ${daysAfter} day(s) after the last due day`,
          read(atTime(shiftDays(lastDueDate, daysAfter), 12, 0)),
          0,
        );
      });
    });

    expect(violations).toEqual([]);
  });

  it('counts down from a correction without counting the row due on the correction day again', () => {
    const violations = mismatchesOf(CASES, (found, { meta, rows }) => {
      const row = rows[Math.floor(rows.length / 2)];
      const corrected = buildPriceBook([
        {
          instrument: holdingInstrument(LOAN.id),
          day: dayKeyOf(row.dueDate),
          price: '1000.00',
          currency: 'UAH',
          source: 'manual',
        },
      ]);

      expectEqual(
        found,
        `outstanding on the correction day, due day ${row.index}`,
        loanOutstandingMinorAt(meta, LOAN.id, corrected, atTime(row.dueDate, 12, 0)),
        100_000,
      );
    });

    expect(violations).toEqual([]);
  });
});

describe('loan schedule property: the ledger agrees with the schedule', () => {
  it('equals the schedule at every probe when no payment is linked', () => {
    const violations = mismatchesOf(CASES, (found, { meta, rows }) => {
      const probeDays = rows.flatMap((row) => [
        shiftDays(row.dueDate, -1),
        row.dueDate,
        shiftDays(row.dueDate, 1),
      ]);

      probeDays.forEach((probeDay) => {
        CLOCK_TIMES.forEach(([hour, minute]) => {
          const instant = atTime(probeDay, hour, minute);

          expectEqual(
            found,
            `ledger at ${new Date(instant).toISOString()}`,
            loanLedgerOutstandingMinorAt(meta, LOAN, EMPTY_PRICE_BOOK, instant),
            loanOutstandingMinorAt(meta, LOAN.id, EMPTY_PRICE_BOOK, instant),
          );
        });
      });
    });

    expect(violations).toEqual([]);
  });

  it('equals the schedule once a row is paid in full on its due day: no double count, no stuck row', () => {
    const violations = mismatchesOf(CASES, (found, { meta, rows }) => {
      paidRowNumbers(rows.length).forEach((rowNumber) => {
        const row = rows[rowNumber - 1];
        const book = bookWithPayment(atTime(row.dueDate, PAYMENT_HOUR, 0), row.paymentMinorUnits);
        const dayBeforeNextRow = rows
          .slice(rowNumber, rowNumber + 1)
          .map((next) => shiftDays(next.dueDate, -1));

        [row.dueDate, ...dayBeforeNextRow].forEach((probeDay) => {
          CLOCK_TIMES.forEach(([hour, minute]) => {
            const instant = atTime(probeDay, hour, minute);

            expectEqual(
              found,
              `ledger with row ${rowNumber} paid, at ${new Date(instant).toISOString()}`,
              loanLedgerOutstandingMinorAt(meta, LOAN, book, instant),
              loanOutstandingMinorAt(meta, LOAN.id, EMPTY_PRICE_BOOK, instant),
            );
          });
        });
      });
    });

    expect(violations).toEqual([]);
  });
});

describe('loan schedule property: index bounds', () => {
  it('maps a payment one period before the first row to it and a day earlier to nothing', () => {
    const violations = mismatchesOf(CASES, (found, { meta }) => {
      const plan = loanPlanOf(meta);
      const lowerBound = addMonths(meta.startDate, -1);

      CLOCK_TIMES.forEach(([hour, minute]) => {
        expectEqual(
          found,
          `index on the lower bound at ${hour}:${minute}`,
          installmentIndexOf(meta, plan, atTime(lowerBound, hour, minute)),
          0,
        );
        expectEqual(
          found,
          `index a day before the lower bound at ${hour}:${minute}`,
          installmentIndexOf(meta, plan, atTime(shiftDays(lowerBound, -1), hour, minute)),
          undefined,
        );
      });
    });

    expect(violations).toEqual([]);
  });

  it('maps a payment one period after the last row to it and a day later to nothing', () => {
    const violations = mismatchesOf(CASES, (found, { meta, rows }) => {
      const plan = loanPlanOf(meta);
      const upperBound = addMonths(meta.startDate, rows.length);

      CLOCK_TIMES.forEach(([hour, minute]) => {
        expectEqual(
          found,
          `index on the upper bound at ${hour}:${minute}`,
          installmentIndexOf(meta, plan, atTime(upperBound, hour, minute)),
          rows.length - 1,
        );
        expectEqual(
          found,
          `index a day after the upper bound at ${hour}:${minute}`,
          installmentIndexOf(meta, plan, atTime(shiftDays(upperBound, 1), hour, minute)),
          undefined,
        );
      });
    });

    expect(violations).toEqual([]);
  });

  it('maps a payment on due day k to row k', () => {
    const violations = mismatchesOf(CASES, (found, { meta, rows }) => {
      const plan = loanPlanOf(meta);

      rows.forEach((row) => {
        CLOCK_TIMES.forEach(([hour, minute]) => {
          expectEqual(
            found,
            `index of a payment on due day ${row.index} at ${hour}:${minute}`,
            installmentIndexOf(meta, plan, atTime(row.dueDate, hour, minute)),
            row.index - 1,
          );
        });
      });
    });

    expect(violations).toEqual([]);
  });
});

describe('loan schedule property: interest', () => {
  it('attributes row k interest to a payment on due day k, capped at the payment', () => {
    const violations = mismatchesOf(CASES, (found, { meta, rows }) => {
      const plan = loanPlanOf(meta);
      const interestOf = (time: number, paidMinorUnits: number): number =>
        loanInterestPerPaymentMinor(meta, [{ time, amountMinorUnits: -paidMinorUnits }], plan)[0];

      rows.forEach((row) => {
        const time = atTime(row.dueDate, PAYMENT_HOUR, 0);

        expectEqual(
          found,
          `interest of a full payment on due day ${row.index}`,
          interestOf(time, row.paymentMinorUnits),
          row.interestMinorUnits,
        );
        expectEqual(
          found,
          `interest of a 1-unit payment on due day ${row.index}`,
          interestOf(time, 1),
          Math.min(row.interestMinorUnits, 1),
        );
      });
    });

    expect(violations).toEqual([]);
  });
});
