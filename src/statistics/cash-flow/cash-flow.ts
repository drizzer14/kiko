import { sumOf } from '@kiko/numbers';
import { Money } from '@kiko/currency/money';
import type { CalendarMonth } from '@kiko/dates';
import { canConvert } from '@kiko/rates/net-worth-view';
import type { Currency } from '@kiko/currency/currency';
import { convert, type RateTable } from '@kiko/rates/conversion';
import type { CategoryDisplay } from '@kiko/categories/category-display';

import { averageOverComplete } from '../table-period';
import { buildCategoryByMonth } from '../category-by-month';
import type { LedgerRow, SpendingLedger } from '../spending-ledger';

export type CashFlowLine = {
  /** One amount per month, in base-currency minor units. */
  cells: number[];
  total: number;
  /** The mean of the complete months; null when none is complete. */
  average: number | null;
};

type CashFlow = {
  income: CashFlowLine;
  expenses: CashFlowLine;
  net: CashFlowLine;
  /** Net over income; a null where income is zero. */
  savingsRate: { cells: (number | null)[]; total: number | null; average: number | null };
};

// Only the month's summed amounts are read from the table, never a slice color, so the scheme the
// breakdown resolves colors in cannot show in the cash flow.
const SPENDING_SCHEME = 'dark';

/** Net over income: null at zero income, so a rate is never zero-for-nothing or infinity. */
const rateOf = (net: number | null, income: number | null): number | null =>
  net === null || income === null || income === 0 ? null : net / income;

/**
 * Whether a row is income: a credit that no exclusion rule caught (the ledger's union, which
 * holds the matchers, the loan rule and the balance-set mark), that is not a change return
 * (already netted from the expenses) and does not set a balance. The mark is read on the row
 * too, so the rule does not lean on the union alone.
 *
 * The rules were written for spending and some are blind to the sign, so this is only as good as
 * they are: a refund counts as income, and a coupon payout described as a deposit does not.
 */
export const isIncomeRow = (
  row: Pick<LedgerRow, 'id' | 'amountMinorUnits' | 'changeGroupId' | 'setsBalance'>,
  excludedIds: ReadonlySet<string>,
): boolean =>
  row.amountMinorUnits > 0 &&
  row.changeGroupId === null &&
  !row.setsBalance &&
  !excludedIds.has(row.id);

type CashFlowInput = {
  ledger: SpendingLedger;
  months: readonly CalendarMonth[];
  rateTable: RateTable;
  baseCurrency: Currency;
  categoryDisplay: ReadonlyMap<string, CategoryDisplay>;
  defaultCategoryKey: string;
  /** The first column of a complete month, from `firstCompleteMonthIndex`. */
  firstCompleteIndex: number | null;
  /** Whether the last column is the month that is still running. */
  currentIsPartial: boolean;
};

const lineOf = (cells: number[], total: number, input: CashFlowInput): CashFlowLine => ({
  cells,
  total,
  average: averageOverComplete(cells, input.firstCompleteIndex, input.currentIsPartial),
});

const incomeCellsOf = (input: CashFlowInput): number[] => {
  const { ledger, months, rateTable, baseCurrency } = input;
  const cells = months.map(() => 0);

  for (const row of ledger.shownRows) {
    if (
      !isIncomeRow(row, ledger.excludedTransactionIds) ||
      !canConvert(row.currency, baseCurrency, rateTable)
    ) {
      continue;
    }

    const index = months.findIndex((month) => row.time >= month.start && row.time <= month.end);

    if (index !== -1) {
      cells[index] += convert(
        Money.of(row.currency, row.amountMinorUnits),
        baseCurrency,
        rateTable,
      ).minorUnits;
    }
  }

  return cells;
};

/**
 * The cash flow of each month. Expenses are the donut's slices of the month, summed (the category
 * table's `All` row), so a transfer whose legs fall in two months stays out of both sides.
 * Income is the month's credit rows that `isIncomeRow` takes, each converted at today's rate. Net
 * is income less expenses, and the savings rate is net over income. A Total takes the period's
 * donut for the expenses, as the category table does, and its rate is total net over total
 * income; the Average is over the complete months, and so is the rate of the Average.
 */
export const buildCashFlow = (input: CashFlowInput): CashFlow => {
  const { ledger, months, rateTable, baseCurrency, categoryDisplay, defaultCategoryKey } = input;
  const spending = buildCategoryByMonth({
    ledger,
    months,
    categoryDisplay,
    rateTable,
    baseCurrency,
    defaultCategoryKey,
    scheme: SPENDING_SCHEME,
  });
  const incomeCells = incomeCellsOf(input);
  const incomeTotal = sumOf(incomeCells);
  const netCells = incomeCells.map((income, index) => income - spending.allCells[index]);
  const netTotal = incomeTotal - spending.allTotal;
  const income = lineOf(incomeCells, incomeTotal, input);
  const net = lineOf(netCells, netTotal, input);

  return {
    income,
    expenses: lineOf(spending.allCells, spending.allTotal, input),
    net,
    savingsRate: {
      cells: netCells.map((cell, index) => rateOf(cell, incomeCells[index])),
      total: rateOf(netTotal, incomeTotal),
      average: rateOf(net.average, income.average),
    },
  };
};
