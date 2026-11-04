import type { CalendarMonth } from '@kiko/dates';
import type { Currency } from '@kiko/currency/currency';
import type { RateTable } from '@kiko/rates/conversion';
import type { CategoryDisplay } from '@kiko/categories/category-display';

import { type SpendingLedger, spendingRowsIn } from '../spending-ledger';
import { buildCategoryBreakdown, type CategorySlice } from '../category-breakdown';

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

  // Row keys come from a Map, so two rows never share one.
  return left.key < right.key ? -1 : 1;
};

type CategoryTableSources = {
  ledger: SpendingLedger;
  months: readonly CalendarMonth[];
  categoryDisplay: ReadonlyMap<string, CategoryDisplay>;
  rateTable: RateTable;
  baseCurrency: Currency;
  defaultCategoryKey: string;
};

const breakdownIn = (
  sources: CategoryTableSources,
  from: number,
  to: number,
  excludedCategories?: ReadonlySet<string>,
) =>
  buildCategoryBreakdown({
    transactions: spendingRowsIn(sources.ledger, from, to),
    categoryDisplay: sources.categoryDisplay,
    rateTable: sources.rateTable,
    baseCurrency: sources.baseCurrency,
    defaultCategoryKey: sources.defaultCategoryKey,
    excludedCategories,
    excludedTransactionIds: sources.ledger.excludedTransactionIds,
  });

/**
 * Every category the table can have a cell for: the donut's slices over each month. The category
 * menu lists these and a pick excludes by them, so a pick removes every row it does not cover.
 * The whole period's slices add no category: one that nets above zero over the period does so in
 * some month too. The months do add one the period misses, a category that a month spends on and
 * the whole period nets out (a split change group).
 */
export const categorySlicesOfMonths = (sources: CategoryTableSources): CategorySlice[] =>
  sources.months.flatMap((month) => breakdownIn(sources, month.start, month.end));

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
export const buildCategoryByMonth = (
  input: CategoryTableSources & { excludedCategories?: ReadonlySet<string> },
): CategoryByMonth => {
  const { months } = input;

  if (months.length === 0) {
    return { rows: [], allCells: [], allTotal: 0 };
  }

  const breakdownOf = (from: number, to: number) =>
    breakdownIn(input, from, to, input.excludedCategories);
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
