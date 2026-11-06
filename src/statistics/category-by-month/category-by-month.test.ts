import { Money } from '@kiko/currency/money';
import { convert } from '@kiko/rates/conversion';
import { calendarMonthsBetween } from '@kiko/dates';
import { buildCategoryDisplayMap } from '@kiko/categories/category-display';
import {
  CARD,
  CASH,
  transactionRow,
  worldInput,
} from '@kiko/statistics/spending-ledger/__fixtures__/spending-ledger-world';

import { buildCategoryBreakdown } from '../category-breakdown';
import { buildSpendingLedger, spendingRowsIn, type SpendingLedger } from '../spending-ledger';

import { buildCategoryByMonth, categorySlicesOfMonths } from '.';

const DISPLAY = buildCategoryDisplayMap([
  { key: 'groceries', title: 'Groceries', icon: 'cart' },
  { key: 'transport', title: 'Transport', icon: 'car' },
  { key: 'other', title: 'Other', icon: 'square.grid.2x2' },
]);

const MONTHS = calendarMonthsBetween(
  new Date(2025, 0, 10).getTime(),
  new Date(2025, 2, 10).getTime(),
);
const [JANUARY, FEBRUARY, MARCH] = MONTHS;

const ledgerOf = (transactions: ReturnType<typeof transactionRow>[]): SpendingLedger =>
  buildSpendingLedger(worldInput({ transactions, shownHoldings: [CARD, CASH] }));

const byCategory = (
  ledger: SpendingLedger,
  overrides: Partial<Parameters<typeof buildCategoryByMonth>[0]> = {},
) =>
  buildCategoryByMonth({
    ledger,
    months: MONTHS,
    categoryDisplay: DISPLAY,
    rateTable: {},
    baseCurrency: 'UAH',
    defaultCategoryKey: 'other',
    ...overrides,
  });

const expense = (
  id: string,
  category: string,
  amountMinorUnits: number,
  time: number,
  holdingId = 'card',
) => transactionRow({ id, holdingId, category, amountMinorUnits, time });

const SPREAD_WORLD = [
  expense('g-jan', 'groceries', -12_34, JANUARY.start + 1_000),
  expense('g-mar', 'groceries', -50_00, MARCH.end - 1_000),
  expense('t-feb', 'transport', -400_00, FEBRUARY.start + 1_000),
  expense('t-feb-2', 'transport', -100_00, FEBRUARY.end - 1_000),
];

describe('buildCategoryByMonth', () => {
  it('gives each cell the category slice of that month, in minor units', () => {
    const ledger = ledgerOf(SPREAD_WORLD);
    const { rows } = byCategory(ledger);

    MONTHS.forEach((month, index) => {
      const slices = buildCategoryBreakdown({
        transactions: spendingRowsIn(ledger, month.start, month.end),
        categoryDisplay: DISPLAY,
        rateTable: {},
        baseCurrency: 'UAH',
        defaultCategoryKey: 'other',
        excludedTransactionIds: ledger.excludedTransactionIds,
      });

      for (const row of rows) {
        expect(row.cells[index]).toBe(slices.find((slice) => slice.key === row.key)?.amount ?? 0);
      }
    });
    expect(rows.find((row) => row.key === 'groceries')?.cells).toEqual([12_34, 0, 50_00]);
    expect(rows.find((row) => row.key === 'transport')?.cells).toEqual([0, 500_00, 0]);
  });

  it('orders the rows by the period total, largest first, with the display title', () => {
    const { rows } = byCategory(ledgerOf(SPREAD_WORLD));

    expect(rows.map((row) => [row.key, row.title, row.total])).toEqual([
      ['transport', 'Transport', 500_00],
      ['groceries', 'Groceries', 62_34],
    ]);
  });

  it('breaks a tie of totals by the category key, so the order never moves', () => {
    const { rows } = byCategory(
      ledgerOf([
        expense('t', 'transport', -10_00, JANUARY.start + 1_000),
        expense('g', 'groceries', -10_00, FEBRUARY.start + 1_000),
      ]),
    );

    expect(rows.map((row) => row.key)).toEqual(['groceries', 'transport']);
  });

  it('adds every row up into the All cells and the All total', () => {
    const { allCells, allTotal } = byCategory(ledgerOf(SPREAD_WORLD));

    expect(allCells).toEqual([12_34, 500_00, 50_00]);
    expect(allTotal).toBe(562_34);
  });

  it('puts a zero in the cell of a month with no spend, never an absent cell', () => {
    const { rows, allCells } = byCategory(
      ledgerOf([expense('g-jan', 'groceries', -10_00, JANUARY.start + 1_000)]),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].cells).toEqual([10_00, 0, 0]);
    expect(allCells).toEqual([10_00, 0, 0]);
  });

  it('has no row and a zero All with no spend in the period', () => {
    expect(byCategory(ledgerOf([]))).toEqual({
      rows: [],
      allCells: [0, 0, 0],
      allTotal: 0,
    });
  });

  it('counts the first and the last millisecond of a month in that month', () => {
    const { rows } = byCategory(
      ledgerOf([
        expense('first', 'groceries', -1_00, FEBRUARY.start),
        expense('last', 'groceries', -2_00, FEBRUARY.end),
        expense('before', 'groceries', -4_00, FEBRUARY.start - 1),
        expense('after', 'groceries', -8_00, FEBRUARY.end + 1),
      ]),
    );

    expect(rows[0].cells).toEqual([4_00, 3_00, 8_00]);
  });

  it('leaves out a row outside every month of the period', () => {
    const { allTotal } = byCategory(
      ledgerOf([
        expense('inside', 'groceries', -1_00, JANUARY.start + 1_000),
        expense('earlier', 'groceries', -9_00, JANUARY.start - 1),
        expense('later', 'groceries', -9_00, MARCH.end + 1),
      ]),
    );

    expect(allTotal).toBe(1_00);
  });

  it('folds an uncategorised row into the default category', () => {
    const { rows } = byCategory(
      ledgerOf([
        transactionRow({
          id: 'plain',
          holdingId: 'card',
          category: null,
          amountMinorUnits: -3_00,
          time: JANUARY.start + 1_000,
        }),
      ]),
    );

    expect(rows.map((row) => [row.key, row.title])).toEqual([['other', 'Other']]);
  });

  it('leaves income out', () => {
    const { allTotal } = byCategory(
      ledgerOf([
        expense('salary', 'groceries', 5_000_00, JANUARY.start + 1_000),
        expense('spend', 'groceries', -1_00, JANUARY.start + 2_000),
      ]),
    );

    expect(allTotal).toBe(1_00);
  });

  it('converts a foreign amount at the one rate table, whatever the month', () => {
    const tenTether = Money.fromMajor('USDT', 10).minorUnits;
    const ledger = buildSpendingLedger(
      worldInput({
        transactions: [
          expense('coin-jan', 'groceries', -tenTether, JANUARY.start + 1_000, 'coin'),
          expense('coin-mar', 'groceries', -tenTether, MARCH.start + 1_000, 'coin'),
        ],
      }),
    );
    const converted = convert(Money.of('USDT', tenTether), 'UAH', { USDT: 40 }).minorUnits;

    expect(converted).toBe(400_00);

    const table = byCategory(ledger, { rateTable: { USDT: 40 } });

    expect(table.allCells).toEqual([converted, 0, converted]);
    expect(table.allTotal).toBe(2 * converted);
    expect(table.rows.map((row) => [row.key, row.cells, row.total])).toEqual([
      ['groceries', [converted, 0, converted], 2 * converted],
    ]);
  });

  it('drops a foreign amount with no rate, as the donut does', () => {
    const ledger = buildSpendingLedger(
      worldInput({
        transactions: [
          expense(
            'coin-jan',
            'groceries',
            -Money.fromMajor('USDT', 10).minorUnits,
            JANUARY.start + 1_000,
            'coin',
          ),
        ],
      }),
    );

    expect(byCategory(ledger).allTotal).toBe(0);
  });

  describe('a transfer between two own holdings', () => {
    const EDGE = JANUARY.end;
    const debit = expense('debit', 'groceries', -5_000_00, EDGE, 'card');
    const credit = expense('credit', 'groceries', 5_000_00, EDGE + 1_000, 'cash');

    it('stays out on both sides when its legs fall in two months', () => {
      const ledger = ledgerOf([debit, credit]);

      expect(new Date(debit.time).getMonth()).not.toBe(new Date(credit.time).getMonth());
      expect(ledger.excludedTransactionIds.has('debit')).toBe(true);
      expect(byCategory(ledger)).toEqual({ rows: [], allCells: [0, 0, 0], allTotal: 0 });
    });

    it('counts the debit when its credit is not in the ledger, so the exclusion is the pair', () => {
      const { allCells } = byCategory(ledgerOf([debit]));

      expect(allCells).toEqual([5_000_00, 0, 0]);
    });

    it('stays out when the account filter shows only the debit side', () => {
      const ledger = buildSpendingLedger(
        worldInput({ transactions: [debit, credit], shownHoldings: [CARD] }),
      );

      expect(byCategory(ledger).allTotal).toBe(0);
    });
  });

  describe('a change return', () => {
    const payment = transactionRow({
      id: 'payment',
      holdingId: 'card',
      category: 'groceries',
      amountMinorUnits: -212_00,
      changeGroupId: 'group',
      time: JANUARY.end,
    });
    const returned = transactionRow({
      id: 'returned',
      holdingId: 'card',
      category: null,
      amountMinorUnits: 20_00,
      changeGroupId: 'group',
      time: JANUARY.end,
    });

    it('nets a payment and its return that share the last millisecond of a month', () => {
      const { rows, allTotal } = byCategory(ledgerOf([payment, returned]));

      expect(rows.map((row) => [row.key, row.cells])).toEqual([['groceries', [192_00, 0, 0]]]);
      expect(allTotal).toBe(192_00);
    });

    it('gives the total the single donut of the whole period, where partition by month nets alike', () => {
      const ledger = ledgerOf([payment, returned, expense('g', 'groceries', -8_00, MARCH.start)]);
      const donut = buildCategoryBreakdown({
        transactions: spendingRowsIn(ledger, JANUARY.start, MARCH.end),
        categoryDisplay: DISPLAY,
        rateTable: {},
        baseCurrency: 'UAH',
        defaultCategoryKey: 'other',
        excludedTransactionIds: ledger.excludedTransactionIds,
      });
      const { rows, allTotal } = byCategory(ledger);

      expect(rows[0].total).toBe(donut[0].amount);
      expect(allTotal).toBe(donut.reduce((sum, slice) => sum + slice.amount, 0));
    });
  });

  // The repo's date edit moves one row's `time` only, so a payment can leave its group's month.
  describe('a payment whose date was edited apart from its group', () => {
    const payment = transactionRow({
      id: 'payment',
      holdingId: 'card',
      category: 'groceries',
      amountMinorUnits: -212_00,
      changeGroupId: 'group',
      time: FEBRUARY.start,
    });
    const returned = transactionRow({
      id: 'returned',
      holdingId: 'card',
      category: null,
      amountMinorUnits: 20_00,
      changeGroupId: 'group',
      time: JANUARY.end,
    });

    it('keeps the month cell as that month’s donut and the total as the period donut', () => {
      const { rows, allCells, allTotal } = byCategory(ledgerOf([payment, returned]));

      expect(rows).toEqual([
        { key: 'groceries', title: 'Groceries', cells: [0, 212_00, 0], total: 192_00 },
      ]);
      expect(allCells).toEqual([0, 212_00, 0]);
      expect(allTotal).toBe(192_00);
    });

    it('keeps a row whose period nets out, with a total of zero', () => {
      const { rows, allTotal } = byCategory(
        ledgerOf([
          { ...payment, amountMinorUnits: -20_00 },
          { ...returned, amountMinorUnits: 30_00 },
        ]),
      );

      expect(rows.map((row) => [row.key, row.cells, row.total])).toEqual([
        ['groceries', [0, 20_00, 0], 0],
      ]);
      expect(allTotal).toBe(0);
    });

    it('orders the rows by the period total', () => {
      const { rows } = byCategory(
        ledgerOf([payment, returned, expense('t', 'transport', -200_00, MARCH.start)]),
      );

      expect(rows.map((row) => [row.key, row.total])).toEqual([
        ['transport', 200_00],
        ['groceries', 192_00],
      ]);
    });
  });

  // The category menu and a pick's exclusion read one key list. A category that a month spends on
  // and the whole period nets out has no period slice, so a list of the period's slices alone
  // would miss it: a pick could not remove its row, and the menu would not offer it.
  describe('the categories the months spent on', () => {
    const payment = transactionRow({
      id: 'payment',
      holdingId: 'card',
      category: 'groceries',
      amountMinorUnits: -20_00,
      changeGroupId: 'group',
      time: FEBRUARY.start,
    });
    const returned = transactionRow({
      id: 'returned',
      holdingId: 'card',
      category: null,
      amountMinorUnits: 30_00,
      changeGroupId: 'group',
      time: JANUARY.end,
    });
    const keysOf = (transactions: ReturnType<typeof transactionRow>[]) =>
      categorySlicesOfMonths({
        ledger: ledgerOf(transactions),
        months: MONTHS,
        categoryDisplay: DISPLAY,
        rateTable: {},
        baseCurrency: 'UAH',
        defaultCategoryKey: 'other',
      }).map((slice) => slice.key);

    it('lists a category that a month spends on and its period nets out', () => {
      const ledger = ledgerOf([payment, returned]);

      expect(
        buildCategoryBreakdown({
          transactions: spendingRowsIn(ledger, JANUARY.start, MARCH.end),
          categoryDisplay: DISPLAY,
          rateTable: {},
          baseCurrency: 'UAH',
          defaultCategoryKey: 'other',
          excludedTransactionIds: ledger.excludedTransactionIds,
        }),
      ).toEqual([]);
      expect(keysOf([payment, returned])).toEqual(['groceries']);
    });

    it('lists the categories of the whole period and of every month', () => {
      expect(new Set(keysOf(SPREAD_WORLD))).toEqual(new Set(['groceries', 'transport']));
    });

    it('lists none with no month', () => {
      expect(
        categorySlicesOfMonths({
          ledger: ledgerOf(SPREAD_WORLD),
          months: [],
          categoryDisplay: DISPLAY,
          rateTable: {},
          baseCurrency: 'UAH',
          defaultCategoryKey: 'other',
        }),
      ).toEqual([]);
    });
  });

  describe('a held category pick', () => {
    it('drops the excluded category from the rows and from the All cells', () => {
      const { rows, allCells, allTotal } = byCategory(ledgerOf(SPREAD_WORLD), {
        excludedCategories: new Set(['transport']),
      });

      expect(rows.map((row) => row.key)).toEqual(['groceries']);
      expect(allCells).toEqual([12_34, 0, 50_00]);
      expect(allTotal).toBe(62_34);
    });
  });
});
