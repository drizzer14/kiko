import type { TFunction } from 'i18next';
import type { HoldingRow } from '@kiko/db';
import maybe, { foldMap } from 'fnts/maybe';
import { Money } from '@kiko/currency/money';
import type { CalendarMonth } from '@kiko/dates';
import type { RateTable } from '@kiko/rates/conversion';
import type { Currency } from '@kiko/currency/currency';
import type { CategoryDisplay } from '@kiko/categories/category-display';
import { transactionRowDescription } from '@kiko/transactions/row-description';

import { incomeAmountOf } from '../cash-flow';
import { spendingContributionsOf } from '../category-breakdown';
import { type LoanEntryPart, loanEntryPartOf, loanPaymentIdOf } from '../loan-payments';
import { type LedgerRow, type SpendingLedger, spendingRowsIn } from '../spending-ledger';

/** One row of the list a table cell opens; the rows' base amounts add up to the cell. */
export type CellRow = {
  id: string;
  /** The stored transaction a tap opens: a derived loan entry's payment, else the row itself. */
  transactionId: string;
  time: number;
  description: string;
  /** In the row's own currency. For a payment with change returned, what is left of it. */
  native: Money;
  /** The same in the base currency, converted as the table converts it. */
  base: Money;
  /** Set on an entry derived from a loan payment: which part of the payment it is. */
  loanPart?: LoanEntryPart;
};

/** The time span a table cell covers: a month's, or the whole period's for a Total. */
export type CellRange = Pick<CalendarMonth, 'start' | 'end'>;

/** The label a row shows, as the lists on Home and in a holding show it. */
export type RowDescriber = (row: LedgerRow) => string;

/**
 * Describes a row the way Home does (`transactionRowDescription`): its own description, else the
 * default label of its holding, so a cash expense with none reads "Cash expense" in a sheet too.
 */
export const rowDescriberOf = (
  holdings: readonly Pick<HoldingRow, 'id' | 'name' | 'currency'>[],
  t: TFunction,
): RowDescriber => {
  const holdingNameById = new Map(holdings.map((holding) => [holding.id, holding.name]));
  const holdingCurrencyById = new Map(holdings.map((holding) => [holding.id, holding.currency]));

  return (row) =>
    transactionRowDescription({
      transaction: row,
      holdingName: holdingNameById.get(row.holdingId) ?? '',
      holdingNameById,
      holdingCurrencyById,
      t,
    });
};

type ExpenseDisplay = {
  categoryDisplay: ReadonlyMap<string, CategoryDisplay>;
  rateTable: RateTable;
  baseCurrency: Currency;
  defaultCategoryKey: string;
  describe: RowDescriber;
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
 * names its payment and which part of it the entry is, and takes the payment's label, which it
 * has none of itself.
 */
export const expenseRowsOf = (
  ledger: SpendingLedger,
  range: CellRange,
  held: { categoryKey?: string; excludedCategories?: ReadonlySet<string> },
  display: ExpenseDisplay,
): CellRow[] => {
  const { describe, ...conversion } = display;
  const sourceById = new Map(ledger.shownRows.map((row) => [row.id, row]));

  return spendingContributionsOf({
    ...conversion,
    transactions: spendingRowsIn(ledger, range.start, range.end),
    excludedCategories: held.excludedCategories,
    excludedTransactionIds: ledger.excludedTransactionIds,
  })
    .filter(({ key }) => held.categoryKey === undefined || key === held.categoryKey)
    .map(({ transaction, netMagnitude, baseMinorUnits }): CellRow => {
      const paymentId = loanPaymentIdOf(transaction.id);

      return {
        id: transaction.id,
        transactionId: paymentId ?? transaction.id,
        time: transaction.time,
        description:
          foldMap(maybe(sourceById.get(paymentId ?? transaction.id)), describe) ??
          transaction.description,
        native: Money.of(transaction.currency, netMagnitude),
        base: Money.of(display.baseCurrency, baseMinorUnits),
        ...foldMap(maybe(loanEntryPartOf(transaction.id)), (part) => ({ loanPart: part })),
      };
    })
    .sort(newestFirst);
};

/**
 * The rows of an income cell: the shown credits in the range that `incomeAmountOf` takes, each
 * converted at today's rate as the cash flow's income cell converts it.
 */
export const incomeRowsOf = (
  ledger: SpendingLedger,
  range: CellRange,
  rateTable: RateTable,
  baseCurrency: Currency,
  describe: RowDescriber,
): CellRow[] =>
  ledger.shownRows
    .filter((row) => row.time >= range.start && row.time <= range.end)
    .flatMap(
      (row): CellRow[] =>
        foldMap(
          maybe(incomeAmountOf(row, ledger.excludedTransactionIds, rateTable, baseCurrency)),
          (base) => [
            {
              id: row.id,
              transactionId: row.id,
              time: row.time,
              description: describe(row),
              native: Money.of(row.currency, row.amountMinorUnits),
              base,
            },
          ],
        ) ?? [],
    )
    .sort(newestFirst);
