import { resolveCategoryDisplay } from '../categories/category-display';
import type { Currency } from '../currency/currency';
import { Money, toMajor } from '../currency/money';
import { convert, type RateTable } from '../rates/conversion';
import { canConvert } from '../rates/net-worth-view';

import { type BreakdownTransaction, resolveCategoryColor } from './category-breakdown';

/**
 * One point on a category's spending line: `amount` is that category's total
 * EXPENSE for the point's month bucket, in the base currency's MAJOR units (a
 * positive magnitude, per-period — NOT a running/cumulative total). `t` is the
 * bucket's UTC-midnight-first-of-month instant.
 */
export type CategoryTrendPoint = { t: number; amount: number };

/**
 * One category's spending line across the shared month buckets. `key` is the
 * stable category slug; `title` is its resolved display title; `color` is the
 * category's stored color when set, else its stable categorical-palette hue (see
 * resolveCategoryColor). `points` is ordered by `t` ascending and carries a
 * point at EVERY month bucket in the series' span (0 where that category had no
 * spend that month), so every line shares one set of X positions.
 */
export type CategoryTrendSeries = {
  key: string;
  title: string;
  color: string;
  points: CategoryTrendPoint[];
};

/**
 * A transaction as the spending-trend needs it: the donut's `BreakdownTransaction`
 * (its stored `category`, its signed `amountMinorUnits`, and its holding's
 * currency) plus the transaction's `time` (unix ms), which decides its month
 * bucket. The amount's currency is the parent HOLDING's currency, so the caller
 * joins it in before building — exactly as `buildCategoryBreakdown` requires.
 */
export type TrendTransaction = BreakdownTransaction & { time: number };

// The normalized grouping key for a transaction's category: lowercased to match
// `resolveCategoryDisplay`'s own lookup convention, with a null/empty category
// folding into the DEFAULT category key so uncategorized spending merges into
// the default's line rather than a separate one. Mirrors category-breakdown.ts.
const groupKey = (category: string | null, defaultKey: string): string => {
  return category?.toLowerCase() || defaultKey;
};

// The month bucket instant for a timestamp: UTC-midnight of the first day of the
// calendar month it falls in. Matches the `toUtcMidnight` convention (UTC, never
// the local day) so buckets do not drift by a day in a positive-UTC-offset
// locale.
const monthBucket = (time: number): number => {
  const date = new Date(time);

  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
};

// The full ordered set of month buckets from `earliest` to `latest` inclusive,
// one per calendar month — so a series can carry a point at every month even
// where a category had no spend, and every line shares the same X positions.
const monthsBetween = (earliest: number, latest: number): number[] => {
  const months: number[] = [];
  const end = new Date(latest);
  const endYear = end.getUTCFullYear();
  const endMonth = end.getUTCMonth();
  let year = new Date(earliest).getUTCFullYear();
  let month = new Date(earliest).getUTCMonth();

  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push(Date.UTC(year, month, 1));
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }

  return months;
};

// Per category key: the running spend total (base minor units, for the series
// sort), a representative raw category value (so the display resolves off the
// same key the Home screen stored), and the per-month spend map (base minor
// units) the points are read from.
type TrendAccumulator = {
  representative: string | null;
  total: number;
  byMonth: Map<number, number>;
};

// The accumulated per-category, per-month spend plus the min/max month seen, so
// the caller can build the shared bucket set. Extracted from the builder to keep
// each function under the cognitive-complexity cap.
type TrendTotals = { totals: Map<string, TrendAccumulator>; minMonth: number; maxMonth: number };

// Fold every EXPENSE (negative amount) into its category's per-month spend,
// applying the SAME exclusion rules `buildCategoryBreakdown` applies: income and
// zero adjustments are ignored, `excludedTransactionIds` rows are dropped by id,
// an unconvertible currency is skipped (so one bad row never voids its category),
// `excludedCategories` are dropped after the default-fold, and each kept row is
// converted to the base currency at the current `rateTable`.
const accumulateSpend = (input: {
  transactions: TrendTransaction[];
  rateTable: RateTable;
  baseCurrency: Currency;
  defaultCategoryKey: string;
  excluded: ReadonlySet<string>;
  excludedIds: ReadonlySet<string>;
}): TrendTotals => {
  const { transactions, rateTable, baseCurrency, defaultCategoryKey, excluded, excludedIds } =
    input;
  const totals = new Map<string, TrendAccumulator>();
  let minMonth = Number.POSITIVE_INFINITY;
  let maxMonth = Number.NEGATIVE_INFINITY;

  for (const transaction of transactions) {
    if (transaction.amountMinorUnits >= 0) {
      continue;
    }
    if (excludedIds.has(transaction.id)) {
      continue;
    }
    if (!canConvert(transaction.currency, baseCurrency, rateTable)) {
      continue;
    }

    const key = groupKey(transaction.category, defaultCategoryKey);
    if (excluded.has(key)) {
      continue;
    }

    const spend = convert(
      Money.of(transaction.currency, -transaction.amountMinorUnits),
      baseCurrency,
      rateTable,
    ).minorUnits;
    const month = monthBucket(transaction.time);
    minMonth = Math.min(minMonth, month);
    maxMonth = Math.max(maxMonth, month);

    const entry = totals.get(key) ?? {
      representative: transaction.category,
      total: 0,
      byMonth: new Map<number, number>(),
    };
    entry.total += spend;
    entry.byMonth.set(month, (entry.byMonth.get(month) ?? 0) + spend);
    totals.set(key, entry);
  }

  return { totals, minMonth, maxMonth };
};

/**
 * Build one spending line per category for the "Spending Trend by Category"
 * chart. Only EXPENSES count (a negative `amountMinorUnits`; income and zero
 * adjustments are ignored), each converted to the base currency at the current
 * `rateTable`. Every kept expense folds into the month bucket its `time` falls
 * in (UTC-midnight of the first of that month), and each category's point for a
 * month is that month's summed spend magnitude in base MAJOR units — a
 * per-period figure, never cumulative. The full ordered set of month buckets
 * spans the earliest to latest kept expense, so EVERY returned series has a
 * point at EVERY month (0 where that category had no spend that month) and all
 * lines share the same X positions. Each series' points are sorted by `t`
 * ascending; the series array is sorted by total spend descending. Exclusion,
 * default-fold, and conversion rules match `buildCategoryBreakdown` exactly.
 * Empty input (or every row excluded) returns `[]`.
 */
export const buildCategoryTrend = (input: {
  transactions: TrendTransaction[];
  categoryDisplay: ReadonlyMap<string, { title: string; icon: string; color: string | null }>;
  rateTable: RateTable;
  baseCurrency: Currency;
  defaultCategoryKey: string;
  excludedCategories?: ReadonlySet<string>;
  excludedTransactionIds?: ReadonlySet<string>;
}): CategoryTrendSeries[] => {
  const { transactions, categoryDisplay, rateTable, baseCurrency, defaultCategoryKey } = input;
  const excluded = input.excludedCategories ?? new Set<string>();
  const excludedIds = input.excludedTransactionIds ?? new Set<string>();

  const { totals, minMonth, maxMonth } = accumulateSpend({
    transactions,
    rateTable,
    baseCurrency,
    defaultCategoryKey,
    excluded,
    excludedIds,
  });

  if (totals.size === 0) {
    return [];
  }

  const months = monthsBetween(minMonth, maxMonth);

  return Array.from(totals.entries())
    .map(([key, entry]) => {
      const display = resolveCategoryDisplay(
        entry.representative,
        categoryDisplay,
        defaultCategoryKey,
      );
      const points = months.map((t) => ({
        t,
        amount: toMajor(entry.byMonth.get(t) ?? 0, baseCurrency),
      }));

      return {
        key,
        title: display.title,
        color: resolveCategoryColor(display.color, key),
        total: entry.total,
        points,
      };
    })
    .filter((series) => series.total > 0)
    .sort((a, b) => b.total - a.total)
    .map((series) => ({
      key: series.key,
      title: series.title,
      color: series.color,
      points: series.points,
    }));
};
