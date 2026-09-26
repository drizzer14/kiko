import { Money, toMajor } from '@kiko/currency/money';
import { canConvert } from '@kiko/rates/net-worth-view';
import type { Currency } from '@kiko/currency/currency';
import { convert, type RateTable } from '@kiko/rates/conversion';
import { resolveCategoryDisplay } from '@kiko/categories/category-display';

import {
  type BreakdownTransaction,
  netMagnitudeOf,
  resolveCategoryColor,
  sumReturnsByGroup,
} from '../category-breakdown';
import { bucketTimes } from '../buckets';

/**
 * One point on a category's spending line: `amount` is that category's total
 * EXPENSE for the point's bucket, in the base currency's MAJOR units (a
 * positive magnitude, per-period — NOT a running/cumulative total). `t` is the
 * bucket's own instant, one of the shared range-derived bucket positions (see
 * `CategoryTrendSeries`).
 */
export type CategoryTrendPoint = { t: number; amount: number };

/**
 * One category's spending line across the shared range buckets. `key` is the
 * stable category slug; `title` is its resolved display title; `color` is the
 * category's stored color when set, else its stable categorical-palette hue (see
 * resolveCategoryColor). `points` is ordered by `t` ascending and carries a
 * point at EVERY bucket in the active range (0 where that category had no
 * spend in that bucket), so every line shares one set of X positions — the
 * SAME positions `buildNetWorthSeries` plots for the same `range`/`bucketDays`
 * (see `bucketTimes`).
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
 * currency) plus the transaction's `time` (unix ms), which decides its bucket.
 * The amount's currency is the parent HOLDING's currency, so the caller
 * joins it in before building — exactly as `buildCategoryBreakdown` requires.
 */
export type TrendTransaction = BreakdownTransaction & { time: number };

// Assign a transaction's `time` to the bucket PERIOD that CONTAINS it: the
// LARGEST bucket instant at or before `time`. `bucketTimes` returns each
// bucket's PERIOD-START marker for every entry except the last, which is
// forced to `range.to` (a period-END marker, closing the final — possibly
// short — period). Walking from the end and returning the first
// `buckets[i] <= time` finds the bucket whose `[buckets[i], nextBucket)`
// period actually contains `time`, so a mid-period expense stays in its own
// bucket rather than being shifted forward into the NEXT one (a ceiling
// search would do that: it would match the period-start marker AHEAD of the
// expense instead of the one it actually falls after). The last bucket
// (`range.to`) still catches everything up to and including the range's own
// end, since it is the largest instant a valid (already range-filtered) time
// can be. A time before `buckets[0]` (unreachable — every caller filters
// `time` into `[buckets[0], buckets[buckets.length - 1]]` first) falls back
// to bucket 0.
const bucketIndexFor = (time: number, buckets: readonly number[]): number => {
  for (let i = buckets.length - 1; i >= 0; i -= 1) {
    if (buckets[i] <= time) {
      return i;
    }
  }

  return 0;
};

// Whether a transaction's time falls within the inclusive [rangeFrom, rangeTo]
// range. Extracted so the accumulation loop reads one predicate rather than a
// two-sided range comparison inline.
const isInRange = (time: number, rangeFrom: number, rangeTo: number): boolean =>
  time >= rangeFrom && time <= rangeTo;

// The normalized grouping key for a transaction's category: lowercased to match
// `resolveCategoryDisplay`'s own lookup convention, with a null/empty category
// folding into the DEFAULT category key so uncategorized spending merges into
// the default's line rather than a separate one. Mirrors category-breakdown.ts.
const groupKey = (category: string | null, defaultKey: string): string => {
  return category?.toLowerCase() || defaultKey;
};

// Per category key: the running spend total (base minor units, for the series
// sort), a representative raw category value (so the display resolves off the
// same key the Home screen stored), the count of kept expense rows (the
// Frequency ranking measure), and the per-bucket spend map (base minor units)
// the points and the Rising slope are read from.
type TrendAccumulator = {
  representative: string | null;
  total: number;
  count: number;
  byBucket: Map<number, number>;
};

// Fold every EXPENSE (negative amount) into its category's per-bucket spend,
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
  buckets: readonly number[];
}): Map<string, TrendAccumulator> => {
  const {
    transactions,
    rateTable,
    baseCurrency,
    defaultCategoryKey,
    excluded,
    excludedIds,
    buckets,
  } = input;
  const rangeFrom = buckets[0];
  const rangeTo = buckets[buckets.length - 1];
  const totals = new Map<string, TrendAccumulator>();
  // Sum the POSITIVE change-returns per group so a split payment's trend value is
  // netted by its change, exactly as buildCategoryBreakdown nets the pie.
  // Returns share the payment's currency AND time for v1, so a payment
  // and its returns always land in the same bucket — netting raw minor units
  // in the payment's own currency here is safe. Shares the pie's own helpers.
  const returnsByGroup = sumReturnsByGroup(transactions);

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

    // Drop any expense whose time falls outside the active range; it must not
    // affect a series' points NOR its sort total.
    if (!isInRange(transaction.time, rangeFrom, rangeTo)) {
      continue;
    }

    const netMagnitude = netMagnitudeOf(transaction, returnsByGroup);

    if (netMagnitude <= 0) {
      continue;
    }

    const spend = convert(
      Money.of(transaction.currency, netMagnitude),
      baseCurrency,
      rateTable,
    ).minorUnits;

    const bucket = buckets[bucketIndexFor(transaction.time, buckets)];
    const entry = totals.get(key) ?? {
      representative: transaction.category,
      total: 0,
      count: 0,
      byBucket: new Map<number, number>(),
    };
    entry.total += spend;
    entry.count += 1;
    entry.byBucket.set(bucket, (entry.byBucket.get(bucket) ?? 0) + spend);
    totals.set(key, entry);
  }

  return totals;
};

/**
 * Build one spending line per category for the "Spending Trend by Category"
 * chart. Only EXPENSES count (a negative `amountMinorUnits`; income and zero
 * adjustments are ignored), each converted to the base currency at the current
 * `rateTable`. Every kept expense folds into the bucket its `time` falls in
 * (see `bucketIndexFor`), and each category's point for a bucket is that
 * bucket's summed spend magnitude in base MAJOR units — a per-period figure,
 * never cumulative. The bucket set is `bucketTimes(range.from, range.to,
 * bucketDays)` — the SAME positions `buildNetWorthSeries` plots for the same
 * `range`/`bucketDays`, so both charts share one X-axis convention. Every
 * returned series carries a point at every bucket (0 where that category had
 * no spend there). An expense whose `time` falls OUTSIDE `range` is dropped
 * entirely — it affects neither a series' points nor its sort total. Each
 * series' points are sorted by `t` ascending; the series array is sorted by
 * total spend descending. Exclusion, default-fold, and conversion rules match
 * `buildCategoryBreakdown` exactly. Empty input (or every row excluded / out of
 * range) returns `[]`.
 */
export const buildCategoryTrend = (input: {
  transactions: TrendTransaction[];
  categoryDisplay: ReadonlyMap<string, { title: string; icon: string; color: string | null }>;
  rateTable: RateTable;
  baseCurrency: Currency;
  defaultCategoryKey: string;
  range: { from: number; to: number };
  bucketDays: number;
  excludedCategories?: ReadonlySet<string>;
  excludedTransactionIds?: ReadonlySet<string>;
}): CategoryTrendSeries[] => {
  const {
    transactions,
    categoryDisplay,
    rateTable,
    baseCurrency,
    defaultCategoryKey,
    range,
    bucketDays,
  } = input;
  const excluded = input.excludedCategories ?? new Set<string>();
  const excludedIds = input.excludedTransactionIds ?? new Set<string>();

  const buckets = bucketTimes(range.from, range.to, bucketDays);

  const totals = accumulateSpend({
    transactions,
    rateTable,
    baseCurrency,
    defaultCategoryKey,
    excluded,
    excludedIds,
    buckets,
  });

  if (totals.size === 0) {
    return [];
  }

  return Array.from(totals.entries())
    .map(([key, entry]) => {
      const display = resolveCategoryDisplay(
        entry.representative,
        categoryDisplay,
        defaultCategoryKey,
      );
      const points = buckets.map((t) => ({
        t,
        amount: toMajor(entry.byBucket.get(t) ?? 0, baseCurrency),
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

/**
 * One category's three ranking measures over the SAME range/bucket set
 * `buildCategoryTrend` uses, feeding the "Top N" trend filter mode. `total` is
 * that category's summed spend (base minor units) — the Contribution measure.
 * `count` is the number of kept expense rows — the Frequency measure.
 * `risingSlope` is the least-squares slope of per-bucket spend across the
 * range's buckets — the Rising measure (a positive value climbs, a negative
 * value falls). The number of buckets (and so the regression's `n`) varies
 * with the range and `bucketDays`.
 */
export type CategoryMeasure = {
  key: string;
  total: number;
  count: number;
  risingSlope: number;
};

// The least-squares (ordinary linear regression) slope of `ys` against its own
// index positions x = 0, 1, …, n-1 (one point per range bucket, 0 on a no-spend
// bucket). With the standard closed form
//   slope = (n·Σ(x·y) − Σx·Σy) / (n·Σ(x²) − (Σx)²)
// the denominator depends only on n (constant within a single build, though it
// varies build-to-build with the active range/bucketDays), so the slope's SIGN
// and the cross-category ORDERING follow the numerator alone — the
// base-currency minor-units scale of y cancels out of any comparison. Fewer
// than two points, or a zero-variance x (unreachable for n >= 2), yields 0.
const linearRegressionSlope = (ys: number[]): number => {
  const n = ys.length;

  if (n < 2) {
    return 0;
  }

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  for (let i = 0; i < n; i += 1) {
    sumX += i;
    sumY += ys[i];
    sumXY += i * ys[i];
    sumXX += i * i;
  }

  const denominator = n * sumXX - sumX * sumX;

  return denominator === 0 ? 0 : (n * sumXY - sumX * sumY) / denominator;
};

/**
 * Build the per-category ranking measures for the trend filter's "Top N" mode,
 * over the SAME range/bucket set and the SAME expense/exclusion/
 * default-fold/conversion rules as `buildCategoryTrend` (it shares
 * `accumulateSpend`). It applies `excludedTransactionIds` (internal transfers,
 * exchange legs) but NEVER a category exclusion — Top mode ranks over EVERY
 * category to pick the top N. Each returned measure carries the category's
 * `total` (Contribution), `count` (Frequency), and `risingSlope` (Rising). The
 * result order is not significant — `selectTopCategories` re-ranks by the
 * chosen measure, and the exclusion path reads it as a set. Empty input (or
 * every row excluded / out of range) returns `[]`.
 */
export const buildCategoryMeasures = (input: {
  transactions: TrendTransaction[];
  rateTable: RateTable;
  baseCurrency: Currency;
  defaultCategoryKey: string;
  range: { from: number; to: number };
  bucketDays: number;
  excludedTransactionIds?: ReadonlySet<string>;
}): CategoryMeasure[] => {
  const { transactions, rateTable, baseCurrency, defaultCategoryKey, range, bucketDays } = input;
  const excludedIds = input.excludedTransactionIds ?? new Set<string>();

  const buckets = bucketTimes(range.from, range.to, bucketDays);

  const totals = accumulateSpend({
    transactions,
    rateTable,
    baseCurrency,
    defaultCategoryKey,
    excluded: new Set<string>(),
    excludedIds,
    buckets,
  });

  return Array.from(totals.entries())
    .filter(([, entry]) => entry.total > 0)
    .map(([key, entry]) => ({
      key,
      total: entry.total,
      count: entry.count,
      risingSlope: linearRegressionSlope(buckets.map((t) => entry.byBucket.get(t) ?? 0)),
    }));
};
