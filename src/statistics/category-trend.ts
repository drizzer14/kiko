import { resolveCategoryDisplay } from '../categories/category-display';
import type { Currency } from '../currency/currency';
import { Money, toMajor } from '../currency/money';
import { convert, type RateTable } from '../rates/conversion';
import { canConvert } from '../rates/net-worth-view';

import { type BreakdownTransaction, resolveCategoryColor } from './category-breakdown';

/**
 * One point on a category's spending line: `amount` is that category's total
 * EXPENSE for the point's UTC-day bucket, in the base currency's MAJOR units (a
 * positive magnitude, per-period — NOT a running/cumulative total). `t` is the
 * bucket's UTC-midnight-of-day instant.
 */
export type CategoryTrendPoint = { t: number; amount: number };

/**
 * One category's spending line across the shared day buckets. `key` is the
 * stable category slug; `title` is its resolved display title; `color` is the
 * category's stored color when set, else its stable categorical-palette hue (see
 * resolveCategoryColor). `points` is ordered by `t` ascending and carries a
 * point at EVERY day in the last-30-days window (0 where that category had no
 * spend that day), so every line shares one set of exactly 30 X positions.
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
 * currency) plus the transaction's `time` (unix ms), which decides its UTC-day
 * bucket. The amount's currency is the parent HOLDING's currency, so the caller
 * joins it in before building — exactly as `buildCategoryBreakdown` requires.
 */
export type TrendTransaction = BreakdownTransaction & { time: number };

// The trend spans a fixed relative window: the last 30 days ending on `now`,
// inclusive of both ends. A shorter or longer horizon is a single-constant edit.
const TREND_WINDOW_DAYS = 30;
const MS_PER_DAY = 86_400_000;

// The normalized grouping key for a transaction's category: lowercased to match
// `resolveCategoryDisplay`'s own lookup convention, with a null/empty category
// folding into the DEFAULT category key so uncategorized spending merges into
// the default's line rather than a separate one. Mirrors category-breakdown.ts.
const groupKey = (category: string | null, defaultKey: string): string => {
  return category?.toLowerCase() || defaultKey;
};

// The day bucket instant for a timestamp: UTC-midnight of the calendar day it
// falls in. Matches the `toUtcMidnight` convention (UTC, never the local day) so
// buckets do not drift by a day in a positive-UTC-offset locale.
const dayBucket = (time: number): number => {
  const date = new Date(time);

  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
};

// The fixed last-30-days window as an ordered set of UTC-day instants, ending on
// the day `now` falls in and reaching back TREND_WINDOW_DAYS - 1 days — so a
// series carries a point at every day even where a category had no spend, and
// every line shares the same 30 X positions regardless of the data.
const daysWindow = (now: number): number[] => {
  const endDay = dayBucket(now);
  const startDay = endDay - (TREND_WINDOW_DAYS - 1) * MS_PER_DAY;

  return Array.from({ length: TREND_WINDOW_DAYS }, (_, index) => startDay + index * MS_PER_DAY);
};

// Per category key: the running spend total (base minor units, for the series
// sort), a representative raw category value (so the display resolves off the
// same key the Home screen stored), the count of kept expense rows (the
// Frequency ranking measure), and the per-day spend map (base minor units) the
// points and the Rising slope are read from.
type TrendAccumulator = {
  representative: string | null;
  total: number;
  count: number;
  byDay: Map<number, number>;
};

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
  startDay: number;
  endDay: number;
}): Map<string, TrendAccumulator> => {
  const {
    transactions,
    rateTable,
    baseCurrency,
    defaultCategoryKey,
    excluded,
    excludedIds,
    startDay,
    endDay,
  } = input;
  const totals = new Map<string, TrendAccumulator>();

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

    // Drop any expense whose day falls outside the fixed last-30-days window;
    // it must not affect a series' points NOR its sort total.
    const day = dayBucket(transaction.time);
    if (day < startDay || day > endDay) {
      continue;
    }

    const spend = convert(
      Money.of(transaction.currency, -transaction.amountMinorUnits),
      baseCurrency,
      rateTable,
    ).minorUnits;

    const entry = totals.get(key) ?? {
      representative: transaction.category,
      total: 0,
      count: 0,
      byDay: new Map<number, number>(),
    };
    entry.total += spend;
    entry.count += 1;
    entry.byDay.set(day, (entry.byDay.get(day) ?? 0) + spend);
    totals.set(key, entry);
  }

  return totals;
};

/**
 * Build one spending line per category for the "Spending Trend by Category"
 * chart. Only EXPENSES count (a negative `amountMinorUnits`; income and zero
 * adjustments are ignored), each converted to the base currency at the current
 * `rateTable`. Every kept expense folds into the UTC-day bucket its `time` falls
 * in, and each category's point for a day is that day's summed spend magnitude
 * in base MAJOR units — a per-period figure, never cumulative. The window is
 * FIXED: the last 30 days ending on `now` (a unix-ms reference "today"), so
 * EVERY returned series has exactly 30 points, one per day (0 where that
 * category had no spend that day) and all lines share the same X positions. An
 * expense whose day falls OUTSIDE that window (older than 30 days, or in the
 * future) is dropped entirely — it affects neither a series' points nor its
 * sort total. Each series' points are sorted by `t` ascending; the series array
 * is sorted by total spend descending. Exclusion, default-fold, and conversion
 * rules match `buildCategoryBreakdown` exactly. Empty input (or every row
 * excluded / out of window) returns `[]`.
 */
export const buildCategoryTrend = (input: {
  transactions: TrendTransaction[];
  categoryDisplay: ReadonlyMap<string, { title: string; icon: string; color: string | null }>;
  rateTable: RateTable;
  baseCurrency: Currency;
  defaultCategoryKey: string;
  now: number;
  excludedCategories?: ReadonlySet<string>;
  excludedTransactionIds?: ReadonlySet<string>;
}): CategoryTrendSeries[] => {
  const { transactions, categoryDisplay, rateTable, baseCurrency, defaultCategoryKey, now } = input;
  const excluded = input.excludedCategories ?? new Set<string>();
  const excludedIds = input.excludedTransactionIds ?? new Set<string>();

  const days = daysWindow(now);
  const startDay = days[0];
  const endDay = days[days.length - 1];

  const totals = accumulateSpend({
    transactions,
    rateTable,
    baseCurrency,
    defaultCategoryKey,
    excluded,
    excludedIds,
    startDay,
    endDay,
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
      const points = days.map((t) => ({
        t,
        amount: toMajor(entry.byDay.get(t) ?? 0, baseCurrency),
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
 * One category's three ranking measures over the SAME fixed last-30-days window
 * `buildCategoryTrend` uses, feeding the "Top N" trend filter mode. `total` is
 * that category's summed spend (base minor units) — the Contribution measure.
 * `count` is the number of kept expense rows — the Frequency measure.
 * `risingSlope` is the least-squares slope of daily spend across the window's 30
 * daily points — the Rising measure (a positive value climbs, a negative value
 * falls).
 */
export type CategoryMeasure = {
  key: string;
  total: number;
  count: number;
  risingSlope: number;
};

// The least-squares (ordinary linear regression) slope of `ys` against its own
// index positions x = 0, 1, …, n-1 (one point per window day, 0 on a no-spend
// day). With the standard closed form
//   slope = (n·Σ(x·y) − Σx·Σy) / (n·Σ(x²) − (Σx)²)
// the denominator depends only on n (a positive constant for n = 30), so the
// slope's SIGN and the cross-category ORDERING follow the numerator alone — the
// base-currency minor-units scale of y cancels out of any comparison. Fewer than
// two points, or a zero-variance x (unreachable at n = 30), yields 0.
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
 * over the SAME fixed last-30-days window and the SAME expense/exclusion/
 * default-fold/conversion rules as `buildCategoryTrend` (it shares
 * `accumulateSpend`). It applies `excludedTransactionIds` (internal transfers,
 * exchange legs) but NEVER a category exclusion — Top mode ranks over EVERY
 * category to pick the top N. Each returned measure carries the category's
 * `total` (Contribution), `count` (Frequency), and `risingSlope` (Rising). The
 * result order is not significant — `selectTopCategories` re-ranks by the chosen
 * measure, and the exclusion path reads it as a set. Empty input (or every row
 * excluded / out of window) returns `[]`.
 */
export const buildCategoryMeasures = (input: {
  transactions: TrendTransaction[];
  rateTable: RateTable;
  baseCurrency: Currency;
  defaultCategoryKey: string;
  now: number;
  excludedTransactionIds?: ReadonlySet<string>;
}): CategoryMeasure[] => {
  const { transactions, rateTable, baseCurrency, defaultCategoryKey, now } = input;
  const excludedIds = input.excludedTransactionIds ?? new Set<string>();

  const days = daysWindow(now);
  const startDay = days[0];
  const endDay = days[days.length - 1];

  const totals = accumulateSpend({
    transactions,
    rateTable,
    baseCurrency,
    defaultCategoryKey,
    excluded: new Set<string>(),
    excludedIds,
    startDay,
    endDay,
  });

  return Array.from(totals.entries())
    .filter(([, entry]) => entry.total > 0)
    .map(([key, entry]) => ({
      key,
      total: entry.total,
      count: entry.count,
      risingSlope: linearRegressionSlope(days.map((t) => entry.byDay.get(t) ?? 0)),
    }));
};
