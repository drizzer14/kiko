import { i18n } from '@kiko/i18n/init';
import { Money } from '@kiko/currency/money';
import { calendarMonthsBetween } from '@kiko/dates';
import type { HoldingRow, TransactionRow } from '@kiko/db';
import { buildCategoryDisplayMap } from '@kiko/categories/category-display';
import {
  BASE_TIME,
  CARD,
  CASH,
  COUNTED,
  EXCLUDED_BY_ONE_RULE_EACH,
  LOAN_PAYMENT,
  MINUTE,
  transactionRow,
  worldInput,
} from '@kiko/statistics/spending-ledger/__fixtures__/spending-ledger-world';

import { buildSpendingLedger } from '../spending-ledger';

import { expenseRowsOf, incomeRowsOf, rowDescriberOf } from '.';

const DISPLAY = buildCategoryDisplayMap([
  { key: 'groceries', title: 'Groceries', icon: 'cart' },
  { key: 'transport', title: 'Transport', icon: 'car' },
  { key: 'other', title: 'Other', icon: 'square.grid.2x2' },
]);
const RATE_TABLE = { USDT: 40 };
// 2.5 USDT, which is UAH 100 at the rate above.
const TWO_AND_A_HALF_USDT = 250_000_000;
const UAH_100 = 10_000;

// January 2024, which holds BASE_TIME.
const [JANUARY, FEBRUARY] = calendarMonthsBetween(BASE_TIME, new Date(2024, 1, 10).getTime());

const ledgerOf = (
  transactions: readonly TransactionRow[],
  shownHoldings: readonly HoldingRow[] = worldInput().shownHoldings,
) => buildSpendingLedger(worldInput({ transactions, shownHoldings }));

// The language is read when a row is described, so a test that switches it needs no new describer.
const DESCRIBE = rowDescriberOf(worldInput().holdings, i18n.t);

const expenseRows = (
  transactions: readonly TransactionRow[],
  pick: Parameters<typeof expenseRowsOf>[2] = {},
  range = JANUARY,
  rateTable: Parameters<typeof incomeRowsOf>[2] = RATE_TABLE,
) =>
  expenseRowsOf(ledgerOf(transactions), range, pick, {
    categoryDisplay: DISPLAY,
    rateTable,
    baseCurrency: 'UAH',
    defaultCategoryKey: 'other',
    describe: DESCRIBE,
  });

const incomeRows = (
  transactions: readonly TransactionRow[],
  range = JANUARY,
  rateTable: Parameters<typeof incomeRowsOf>[2] = RATE_TABLE,
) => incomeRowsOf(ledgerOf(transactions), range, rateTable, 'UAH', DESCRIBE);

const rowOf = (id: string, amountMinorUnits: number, overrides: Partial<TransactionRow> = {}) =>
  transactionRow({ id, holdingId: 'card', amountMinorUnits, time: BASE_TIME, ...overrides });

const idsOf = (rows: readonly { id: string }[]): string[] => rows.map((row) => row.id);

describe('expenseRowsOf', () => {
  it('lists the spending of the month, newest first, with the loan payment as its interest', () => {
    const rows = expenseRows(worldInput().transactions);

    expect(idsOf(rows)).toEqual(['loan-interest:loan-payment', COUNTED.id]);
  });

  it.each(EXCLUDED_BY_ONE_RULE_EACH)('never shows the row %s, which a rule excludes', (id) => {
    const rows = expenseRows(worldInput().transactions);

    expect(idsOf(rows)).not.toContain(id);
  });

  it('shows the id, time, description and amount of a row', () => {
    const [row] = expenseRows([
      rowOf('coffee', -1_500, { description: 'Coffee', category: 'groceries' }),
    ]);

    expect(row).toEqual({
      id: 'coffee',
      transactionId: 'coffee',
      time: BASE_TIME,
      description: 'Coffee',
      native: Money.of('UAH', 1_500),
      base: Money.of('UAH', 1_500),
    });
  });

  it('names the row itself as the transaction of a plain expense row', () => {
    const [row] = expenseRows([rowOf('coffee', -1_500)]);

    expect(row.transactionId).toBe('coffee');
  });

  it('converts a foreign amount at the rate, as the breakdown does', () => {
    const [row] = expenseRows([rowOf('coin-spend', -TWO_AND_A_HALF_USDT, { holdingId: 'coin' })]);

    expect(row.native).toEqual(Money.of('USDT', TWO_AND_A_HALF_USDT));
    expect(row.base).toEqual(Money.of('UAH', UAH_100));
  });

  it('leaves out an amount whose currency has no rate', () => {
    const rows = expenseRows(
      [rowOf('coin-spend', -TWO_AND_A_HALF_USDT, { holdingId: 'coin' }), rowOf('coffee', -1_500)],
      {},
      JANUARY,
      {},
    );

    expect(idsOf(rows)).toEqual(['coffee']);
  });

  describe('a loan payment', () => {
    const payment = { ...LOAN_PAYMENT, description: 'Mortgage payment' };

    it('shows the interest it is derived into', () => {
      const rows = expenseRows([payment]);

      // The loan's one installment: 900_000 at 1% a month is 9_000 of interest.
      expect(rows).toEqual([
        {
          id: 'loan-interest:loan-payment',
          transactionId: 'loan-payment',
          time: payment.time,
          description: 'Mortgage payment',
          native: Money.of('UAH', 9_000),
          base: Money.of('UAH', 9_000),
          loanPart: 'interest',
        },
      ]);
    });

    it('never shows the raw payment, whose principal is no spending', () => {
      expect(idsOf(expenseRows([payment]))).not.toContain('loan-payment');
    });

    it('splits a payment that exceeds its installment into its fee and its interest', () => {
      const withFee = { ...payment, amountMinorUnits: -(909_000 + 300) };

      expect(expenseRows([withFee]).map((row) => [row.id, row.base.minorUnits])).toEqual([
        // Both entries take the payment's time, so they are ordered by id.
        ['loan-excess:loan-payment', 300],
        ['loan-interest:loan-payment', 9_000],
      ]);
    });

    it('tells the interest of a payment from its fee', () => {
      const withFee = { ...payment, amountMinorUnits: -(909_000 + 300) };

      expect(expenseRows([withFee]).map((row) => [row.id, row.loanPart])).toEqual([
        ['loan-excess:loan-payment', 'fee'],
        ['loan-interest:loan-payment', 'interest'],
      ]);
    });

    it('names the payment as the transaction of a loan interest row', () => {
      const [row] = expenseRows([payment]);

      expect(row.id).toBe('loan-interest:loan-payment');
      expect(row.transactionId).toBe('loan-payment');
    });

    it('names the payment as the transaction of a loan fee row', () => {
      const withFee = { ...payment, amountMinorUnits: -(909_000 + 300) };
      const fee = expenseRows([withFee]).find((row) => row.loanPart === 'fee');

      expect(fee?.id).toBe('loan-excess:loan-payment');
      expect(fee?.transactionId).toBe('loan-payment');
    });

    it('has no loanPart on a row that is no part of a loan payment', () => {
      const [row] = expenseRows([rowOf('coffee', -1_500)]);

      expect(row).not.toHaveProperty('loanPart');
    });

    it('reads as its payment reads on Home when the payment has no description', () => {
      const rows = expenseRows([{ ...LOAN_PAYMENT, description: '' }]);

      expect(rows.map((row) => row.description)).toEqual([
        i18n.t('transactions.defaultDescriptionExpense', { name: CARD.name }),
      ]);
    });
  });

  describe('a row with no description', () => {
    const cashExpense = rowOf('cash-coffee', -1_500, { holdingId: 'cash', description: '' });
    const defaultLabel = (language: string) =>
      i18n.t('transactions.defaultDescriptionExpense', { name: CASH.name, lng: language });

    it('reads as Home reads it: the default label of its holding', () => {
      const [row] = expenseRows([cashExpense]);

      expect(row.description).toBe(defaultLabel('en'));
    });

    it('keeps a description the row has', () => {
      const [row] = expenseRows([{ ...cashExpense, description: 'Coffee' }]);

      expect(row.description).toBe('Coffee');
    });

    describe('in Ukrainian', () => {
      beforeEach(async () => {
        await i18n.changeLanguage('uk');
      });

      afterEach(async () => {
        await i18n.changeLanguage('en');
      });

      it('reads in the language, as it does on Home', () => {
        const [row] = expenseRows([cashExpense]);

        expect(row.description).toBe(defaultLabel('uk'));
        expect(row.description).not.toBe(defaultLabel('en'));
      });
    });
  });

  describe('a payment with change returned', () => {
    const payment = (overrides: Partial<TransactionRow> = {}) =>
      rowOf('payment', -50_000, { changeGroupId: 'group', ...overrides });
    const change = (
      id: string,
      amountMinorUnits: number,
      overrides: Partial<TransactionRow> = {},
    ) => rowOf(id, amountMinorUnits, { changeGroupId: 'group', ...overrides });

    it('shows the payment at its net amount and not the returns', () => {
      const rows = expenseRows([payment(), change('change-1', 5_000), change('change-2', 3_000)]);

      expect(rows.map((row) => [row.id, row.native.minorUnits, row.base.minorUnits])).toEqual([
        ['payment', 42_000, 42_000],
      ]);
    });

    it('shows no row for a payment that is returned in full', () => {
      expect(expenseRows([payment(), change('change', 50_000)])).toEqual([]);
    });

    it('shows no row for a payment that is returned more than in full', () => {
      expect(expenseRows([payment(), change('change', 60_000)])).toEqual([]);
    });

    // A date edit moves one row only, so a group can split across two months: each month nets what
    // falls in it, and the period nets the whole group, as the table's cells do.
    it('nets the returns that fall in the range and no others', () => {
      const split = [payment(), change('change', 50_000, { time: FEBRUARY.start + MINUTE })];
      const periodRange = { start: JANUARY.start, end: FEBRUARY.end };

      expect(expenseRows(split, {}, JANUARY).map((row) => row.base.minorUnits)).toEqual([50_000]);
      expect(expenseRows(split, {}, FEBRUARY)).toEqual([]);
      expect(expenseRows(split, {}, periodRange)).toEqual([]);
    });
  });

  describe('the category of a cell', () => {
    const spending = [
      rowOf('milk', -1_000, { category: 'groceries' }),
      rowOf('bus', -2_000, { category: 'transport', time: BASE_TIME + MINUTE }),
      rowOf('unfiled', -4_000, { category: null, time: BASE_TIME + 2 * MINUTE }),
      rowOf('gone', -8_000, { category: 'a-deleted-category', time: BASE_TIME + 3 * MINUTE }),
    ];

    it('lists only the rows of the category key', () => {
      expect(idsOf(expenseRows(spending, { categoryKey: 'transport' }))).toEqual(['bus']);
    });

    it('folds a missing and an unknown category into the default key, as the breakdown does', () => {
      expect(idsOf(expenseRows(spending, { categoryKey: 'other' }))).toEqual(['gone', 'unfiled']);
    });

    it('lists every row of every category with no key', () => {
      expect(idsOf(expenseRows(spending))).toEqual(['gone', 'unfiled', 'bus', 'milk']);
    });

    it('leaves out the categories a held pick excludes', () => {
      expect(
        idsOf(expenseRows(spending, { excludedCategories: new Set(['groceries', 'other']) })),
      ).toEqual(['bus']);
    });
  });

  describe('the range', () => {
    it('takes a row on either bound and none a millisecond outside', () => {
      const rows = expenseRows([
        rowOf('before', -100, { time: JANUARY.start - 1 }),
        rowOf('first', -200, { time: JANUARY.start }),
        rowOf('last', -300, { time: JANUARY.end }),
        rowOf('after', -400, { time: JANUARY.end + 1 }),
      ]);

      expect(idsOf(rows)).toEqual(['last', 'first']);
    });

    it('orders rows of the same time by id', () => {
      const rows = expenseRows([rowOf('b', -100), rowOf('c', -100), rowOf('a', -100)]);

      expect(idsOf(rows)).toEqual(['a', 'b', 'c']);
    });
  });
});

describe('incomeRowsOf', () => {
  it('lists the credits of the month, newest first, and never a debit', () => {
    const rows = incomeRows([
      rowOf('salary', 50_000, { description: 'Salary' }),
      rowOf('gift', 2_000, { time: BASE_TIME + MINUTE }),
      rowOf('coffee', -1_500),
    ]);

    expect(rows).toEqual([
      {
        id: 'gift',
        transactionId: 'gift',
        time: BASE_TIME + MINUTE,
        // No description of its own: the default label of its holding, as Home reads it.
        description: i18n.t('transactions.defaultDescriptionIncome', { name: CARD.name }),
        native: Money.of('UAH', 2_000),
        base: Money.of('UAH', 2_000),
      },
      {
        id: 'salary',
        transactionId: 'salary',
        time: BASE_TIME,
        description: 'Salary',
        native: Money.of('UAH', 50_000),
        base: Money.of('UAH', 50_000),
      },
    ]);
  });

  it('names the credit itself as the transaction of an income row', () => {
    const [row] = incomeRows([rowOf('salary', 50_000)]);

    expect(row.transactionId).toBe('salary');
  });

  it('never shows a credit that a rule excludes: a transfer, a move or a coin purchase', () => {
    const rows = incomeRows([...worldInput().transactions, rowOf('salary', 50_000)]);

    expect(idsOf(rows)).toEqual(['salary']);
  });

  it('shows the default label of its holding for a credit with no description, as Home does', () => {
    const [row] = incomeRows([rowOf('cash-in', 100, { holdingId: 'cash', description: '' })]);

    expect(row.description).toBe(
      i18n.t('transactions.defaultDescriptionIncome', { name: CASH.name }),
    );
  });

  it('never shows a change return, which is netted from the expenses', () => {
    const rows = incomeRows([
      rowOf('payment', -50_000, { changeGroupId: 'group' }),
      rowOf('change', 5_000, { changeGroupId: 'group' }),
    ]);

    expect(rows).toEqual([]);
  });

  it('never shows a credit that sets a balance', () => {
    expect(incomeRows([rowOf('opening', 90_000, { setsBalance: true })])).toEqual([]);
  });

  it('converts a foreign credit at the rate and leaves out one with no rate', () => {
    const credits = [rowOf('coin-in', TWO_AND_A_HALF_USDT, { holdingId: 'coin' })];
    const [row] = incomeRows(credits);

    expect(row.native).toEqual(Money.of('USDT', TWO_AND_A_HALF_USDT));
    expect(row.base).toEqual(Money.of('UAH', UAH_100));
    expect(incomeRows(credits, JANUARY, {})).toEqual([]);
  });

  it('takes a row on either bound of the range and none outside it', () => {
    const rows = incomeRows([
      rowOf('before', 100, { time: JANUARY.start - 1 }),
      rowOf('first', 200, { time: JANUARY.start }),
      rowOf('last', 300, { time: JANUARY.end }),
      rowOf('after', 400, { time: JANUARY.end + 1 }),
    ]);

    expect(idsOf(rows)).toEqual(['last', 'first']);
  });

  it('leaves out a credit of a holding the account filter does not show', () => {
    const rows = incomeRowsOf(
      ledgerOf([rowOf('salary', 50_000), rowOf('cash-in', 100, { holdingId: 'cash' })], [CARD]),
      JANUARY,
      RATE_TABLE,
      'UAH',
      DESCRIBE,
    );

    expect(idsOf(rows)).toEqual(['salary']);
  });
});
