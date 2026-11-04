import type { CalendarMonth } from '@kiko/dates';
import type { Currency } from '@kiko/currency/currency';
import type { RateTable } from '@kiko/rates/conversion';
import type { CategoryDisplay } from '@kiko/categories/category-display';

import { buildCategoryBreakdown } from '../category-breakdown';
import { type SpendingLedger, spendingRowsIn } from '../spending-ledger';

type CategoryByMonthRow = {
  /** The stable category key. */
  key: string;
  title: string;
  /** One amount per month, in base-currency minor units; zero for a month with no spend. */
  cells: number[];
  total: number;
};

type CategoryByMonth = {
  /** Largest period total first. */
  rows: CategoryByMonthRow[];
  /** The sum of every row, per month. */
  allCells: number[];
  allTotal: number;
};

const sumOf = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0);

/** Largest total first; equal totals by key, so the order never moves between renders. */
const byTotalThenKey = (left: CategoryByMonthRow, right: CategoryByMonthRow): number => {
  if (left.total !== right.total) {
    return right.total - left.total;
  }

  if (left.key === right.key) {
    return 0;
  }

  return left.key < right.key ? -1 : 1;
};

/**
 * Spending by category, one column per month. A cell IS the donut's slice for that month: the
 * ledger's rows in the month's range go through `buildCategoryBreakdown` with the ledger's
 * excluded ids, so the exclusion by id (a transfer whose legs fall in two months stays out on
 * both sides) and the change-return netting (a payment and its return share a time, so they fall
 * in one month) are the donut's own. Amounts stay in minor units, as the donut's.
 */
export const buildCategoryByMonth = (input: {
  ledger: SpendingLedger;
  months: readonly CalendarMonth[];
  categoryDisplay: ReadonlyMap<string, CategoryDisplay>;
  rateTable: RateTable;
  baseCurrency: Currency;
  defaultCategoryKey: string;
  excludedCategories?: ReadonlySet<string>;
}): CategoryByMonth => {
  const { ledger, months, categoryDisplay, rateTable, baseCurrency, defaultCategoryKey } = input;
  const slicesByMonth = months.map((month) =>
    buildCategoryBreakdown({
      transactions: spendingRowsIn(ledger, month.start, month.end),
      categoryDisplay,
      rateTable,
      baseCurrency,
      defaultCategoryKey,
      excludedCategories: input.excludedCategories,
      excludedTransactionIds: ledger.excludedTransactionIds,
    }),
  );
  const amountsByMonth = slicesByMonth.map(
    (slices) => new Map(slices.map((slice) => [slice.key, slice.amount])),
  );
  const titleByKey = new Map(
    slicesByMonth.flatMap((slices) => slices.map((slice) => [slice.key, slice.title] as const)),
  );
  const rows = Array.from(titleByKey, ([key, title]) => {
    const cells = amountsByMonth.map((amounts) => amounts.get(key) ?? 0);

    return { key, title, cells, total: sumOf(cells) };
  }).sort(byTotalThenKey);
  const allCells = slicesByMonth.map((slices) => sumOf(slices.map((slice) => slice.amount)));

  return { rows, allCells, allTotal: sumOf(allCells) };
};
