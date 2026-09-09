import type { CategoryMeasure } from './category-trend';

/** The two trend-filter modes: an explicit manual pick, or a live "Top N". */
export type TrendMode = 'manual' | 'top';

/** The three "Top N" ranking measures. Each maps to a `CategoryMeasure` field. */
export type TrendMeasure = 'contribution' | 'frequency' | 'rising';

/**
 * The Statistics trend chart's saved filter. `manual` stores explicit category
 * keys (empty = every category). `top` stores only the amount and measure and
 * re-selects the top N from live data on each render. Persisted as JSON in
 * `settings.trendFilter`; `null` there means "no saved filter" and resolves to
 * `DEFAULT_TREND_FILTER`.
 */
export type TrendFilter =
  | { mode: 'manual'; keys: string[] }
  | { mode: 'top'; amount: number; by: TrendMeasure };

/** The lowest and highest "Top N" amount the picker offers. */
export const MIN_TOP_AMOUNT = 1;
export const MAX_TOP_AMOUNT = 5;

/** The fallback filter when nothing is saved: the top 3 by contribution. */
export const DEFAULT_TREND_FILTER: TrendFilter = { mode: 'top', amount: 3, by: 'contribution' };

// Clamp a "Top N" amount into the picker's 1..5 range, flooring a non-integer.
const clampAmount = (amount: number): number =>
  Math.min(MAX_TOP_AMOUNT, Math.max(MIN_TOP_AMOUNT, Math.floor(amount)));

// The `CategoryMeasure` field a measure ranks on.
const measureValue = (measure: CategoryMeasure, by: TrendMeasure): number => {
  if (by === 'contribution') {
    return measure.total;
  }
  if (by === 'frequency') {
    return measure.count;
  }

  return measure.risingSlope;
};

/**
 * Select the top-N category keys for "Top N" mode from live measures. Ranks by
 * the chosen measure descending, breaking a tie by key ascending so the result
 * is deterministic. Clamps `amount` into 1..5, and returns every category when
 * fewer exist than the amount. Returns a Set (the caller feeds it through the
 * existing category-exclusion path).
 */
export const selectTopCategories = (input: {
  measures: CategoryMeasure[];
  amount: number;
  by: TrendMeasure;
}): Set<string> => {
  const amount = clampAmount(input.amount);
  const ranked = [...input.measures].sort((a, b) => {
    const delta = measureValue(b, input.by) - measureValue(a, input.by);

    return delta !== 0 ? delta : a.key.localeCompare(b.key);
  });

  return new Set(ranked.slice(0, amount).map((measure) => measure.key));
};

/**
 * Resolve the stored filter into the effective one the chart renders. A `null`
 * stored value falls back to `DEFAULT_TREND_FILTER`. A `manual` selection is
 * pruned to the categories that still exist (Decision D5) — a prune to empty
 * stays a valid empty manual (every category). A `top` amount is clamped into
 * 1..5.
 */
export const resolveTrendFilter = (
  stored: TrendFilter | null,
  existingCategoryKeys: ReadonlySet<string>,
): TrendFilter => {
  if (stored === null) {
    return DEFAULT_TREND_FILTER;
  }
  if (stored.mode === 'manual') {
    return { mode: 'manual', keys: stored.keys.filter((key) => existingCategoryKeys.has(key)) };
  }

  return { mode: 'top', amount: clampAmount(stored.amount), by: stored.by };
};
