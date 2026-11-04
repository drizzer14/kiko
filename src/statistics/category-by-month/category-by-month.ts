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
 * both sides) and the change-return netting are the donut's own. Amounts stay in minor units, as
 * the donut's.
 *
 * A Total is the slice of the donut over the whole period, not the sum of the cells. A payment and
 * its return share a time when they are made, but a date edit moves one row only, so a group can
 * split across two months: each month nets what falls in it, and the period nets the whole group.
 * The cells then differ from the total by what the split group nets across months.
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

  if (months.length === 0) {
    return { rows: [], allCells: [], allTotal: 0 };
  }

  const breakdownOf = (from: number, to: number) =>
    buildCategoryBreakdown({
      transactions: spendingRowsIn(ledger, from, to),
      categoryDisplay,
      rateTable,
      baseCurrency,
      defaultCategoryKey,
      excludedCategories: input.excludedCategories,
      excludedTransactionIds: ledger.excludedTransactionIds,
    });
  const slicesByMonth = months.map((month) => breakdownOf(month.start, month.end));
  const periodSlices = breakdownOf(months[0].start, months[months.length - 1].end);
  const periodAmounts = new Map(periodSlices.map((slice) => [slice.key, slice.amount]));
  const amountsByMonth = slicesByMonth.map(
    (slices) => new Map(slices.map((slice) => [slice.key, slice.amount])),
  );
  const titleByKey = new Map(
    slicesByMonth.flatMap((slices) => slices.map((slice) => [slice.key, slice.title] as const)),
  );
  const rows = Array.from(titleByKey, ([key, title]) => {
    const cells = amountsByMonth.map((amounts) => amounts.get(key) ?? 0);

    // A month can spend on a category that the whole period nets out: no period slice, a total of
    // zero, and the row stays for its cells.
    return { key, title, cells, total: periodAmounts.get(key) ?? 0 };
  }).sort(byTotalThenKey);
  const allCells = slicesByMonth.map((slices) => sumOf(slices.map((slice) => slice.amount)));

  return { rows, allCells, allTotal: sumOf(periodSlices.map((slice) => slice.amount)) };
};
