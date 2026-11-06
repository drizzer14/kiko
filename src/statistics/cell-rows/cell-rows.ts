import maybe, { foldMap } from 'fnts/maybe';
import { Money } from '@kiko/currency/money';
import type { CalendarMonth } from '@kiko/dates';
import { canConvert } from '@kiko/rates/net-worth-view';
import type { Currency } from '@kiko/currency/currency';
import { convert, type RateTable } from '@kiko/rates/conversion';
import type { CategoryDisplay } from '@kiko/categories/category-display';

import { isIncomeRow } from '../cash-flow';
import { loanPaymentIdOf } from '../loan-payments';
import { spendingContributionsOf } from '../category-breakdown';
import { type SpendingLedger, spendingRowsIn } from '../spending-ledger';

/** One row of the list a table cell opens; the rows' base amounts add up to the cell. */
export type CellRow = {
  id: string;
  time: number;
  description: string;
  /** In the row's own currency. For a payment with change returned, what is left of it. */
  native: Money;
  /** The same in the base currency, converted as the table converts it. */
  base: Money;
  /** For an entry derived from a loan payment (its interest, its fee), the payment's id. */
  paymentId?: string;
};

type CellRange = Pick<CalendarMonth, 'start' | 'end'>;

type ExpenseDisplay = {
  categoryDisplay: ReadonlyMap<string, CategoryDisplay>;
  rateTable: RateTable;
  baseCurrency: Currency;
  defaultCategoryKey: string;
};

/** Newest first; rows of one time by id, so the order never moves between renders. */
const newestFirst = (left: CellRow, right: CellRow): number => {
  if (left.time !== right.time) {
    return right.time - left.time;
  }

  return left.id < right.id ? -1 : 1;
};

/**
 * The rows of an expense cell: the rows the donut sums for the range, each through the donut's own
 * conversion, so they add up to the cell. A `categoryKey` is a category row's cell; none is an
 * All cell, which `excludedCategories` (the pick its table was built with) narrows. The cash
 * flow's expense cell passes neither, since a category pick never changes it. A derived loan entry
 * names its payment and takes the payment's description, which it has none of itself.
 */
export const expenseRowsOf = (
  ledger: SpendingLedger,
  range: CellRange,
  held: { categoryKey?: string; excludedCategories?: ReadonlySet<string> },
  display: ExpenseDisplay,
): CellRow[] => {
  const descriptionById = new Map(ledger.shownRows.map((row) => [row.id, row.description]));

  return spendingContributionsOf({
    ...display,
    transactions: spendingRowsIn(ledger, range.start, range.end),
    excludedCategories: held.excludedCategories,
    excludedTransactionIds: ledger.excludedTransactionIds,
  })
    .filter(({ key }) => held.categoryKey === undefined || key === held.categoryKey)
    .map(({ transaction, netMagnitude, baseMinorUnits }): CellRow => {
      const paymentId = loanPaymentIdOf(transaction.id);

      return {
        id: transaction.id,
        time: transaction.time,
        description:
          foldMap(maybe(paymentId), (id) => descriptionById.get(id) ?? '') ??
          transaction.description,
        native: Money.of(transaction.currency, netMagnitude),
        base: Money.of(display.baseCurrency, baseMinorUnits),
        ...foldMap(maybe(paymentId), (id) => ({ paymentId: id })),
      };
    })
    .sort(newestFirst);
};

/**
 * The rows of an income cell: the shown credits in the range that `isIncomeRow` takes, each
 * converted at today's rate as the cash flow's income cell converts it.
 */
export const incomeRowsOf = (
  ledger: SpendingLedger,
  range: CellRange,
  rateTable: RateTable,
  baseCurrency: Currency,
): CellRow[] =>
  ledger.shownRows
    .filter(
      (row) =>
        row.time >= range.start &&
        row.time <= range.end &&
        isIncomeRow(row, ledger.excludedTransactionIds) &&
        canConvert(row.currency, baseCurrency, rateTable),
    )
    .map((row) => {
      const native = Money.of(row.currency, row.amountMinorUnits);

      return {
        id: row.id,
        time: row.time,
        description: row.description,
        native,
        base: convert(native, baseCurrency, rateTable),
      };
    })
    .sort(newestFirst);
