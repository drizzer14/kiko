import type { Currency } from '../currency/currency';
import { DAY_MS } from '../dates/duration';
import { holdingValueAt, type SeriesHolding, type SeriesTransaction } from './holding-value-at';

// Re-exported from their new shared home so existing importers of these types
// (the screen, the line chart, the tests) keep their `./currency-series` path.
export type { SeriesHolding, SeriesTransaction };

/** A single point on a currency's line: `pct` = percent change vs the range start. */
export type SeriesPoint = { t: number; pct: number };

/** One line: a currency and its day-bucketed, start-indexed percent-change points. */
export type CurrencySeries = { currency: Currency; points: SeriesPoint[] };

// Past this line-window span the daily bucket count would grow unbounded, so
// the series coarsens to a weekly bucket to keep the point count sane.
const COARSE_BUCKET_THRESHOLD_DAYS = 180;
const WEEKLY_BUCKET_DAYS = 7;
const DAILY_BUCKET_DAYS = 1;

// The bucket width (in days) for a line window of `spanMs`: daily for short
// ranges, weekly once the span passes the coarsening threshold so a multi-year
// window renders a bounded number of buckets instead of ~one per day.
export const bucketDaysForSpan = (spanMs: number): number =>
  spanMs > COARSE_BUCKET_THRESHOLD_DAYS * DAY_MS ? WEEKLY_BUCKET_DAYS : DAILY_BUCKET_DAYS;

// The bucket instants across the range: `from`, then one per `bucketDays` step,
// always closing on `to` so the window's start and end are both represented.
// Exported so the converted net-worth series buckets on the exact same instants.
export const bucketTimes = (from: number, to: number, bucketDays: number): number[] => {
  const step = bucketDays * DAY_MS;
  const times: number[] = [];
  for (let t = from; t < to; t += step) {
    times.push(t);
  }
  times.push(to);

  return times;
};

// Convert a currency's per-bucket absolute totals into percent change vs the
// range start. Divide-by-zero guard: when the range-start value is 0 the index
// is undefined, so we baseline against the FIRST NON-ZERO bucket instead; every
// leading zero bucket reports 0% (the flat baseline until money first appears),
// and an all-zero series stays flat at 0%.
//
// The percent divides by |baseline|, not the signed baseline: dividing by a
// negative range-start value (an overdraft total, say) would flip the line's
// direction, reading an improving negative balance as a fall. The magnitude
// baseline keeps "closer to zero" rising for both signs.
const indexToStart = (values: number[]): number[] => {
  const baselineIndex = values.findIndex((value) => value !== 0);
  if (baselineIndex === -1) {
    return values.map(() => 0);
  }
  const baseline = values[baselineIndex];
  const baselineMagnitude = Math.abs(baseline);

  return values.map((value, index) =>
    index < baselineIndex ? 0 : ((value - baseline) / baselineMagnitude) * 100,
  );
};

// Distinct currencies in first-appearance order, so the output line order is
// deterministic and stable for the caller/legend.
const currenciesInOrder = (holdings: SeriesHolding[]): Currency[] => {
  const order: Currency[] = [];
  for (const holding of holdings) {
    if (!order.includes(holding.currency)) {
      order.push(holding.currency);
    }
  }

  return order;
};

/**
 * Build one indexed time series per currency for the line chart. Each currency's
 * line sums the value of all its holdings at each day bucket across `range`, then
 * indexes those totals to the range-start value (start = 0%). No currency
 * conversion — every line stands in its own currency, comparable in shape only.
 */
export const buildCurrencySeries = (input: {
  holdings: SeriesHolding[];
  txByHolding: Map<string, SeriesTransaction[]>;
  range: { from: number; to: number };
  bucketDays?: number;
}): CurrencySeries[] => {
  const { holdings, txByHolding, range, bucketDays = 1 } = input;
  const times = bucketTimes(range.from, range.to, bucketDays);

  return currenciesInOrder(holdings).map((currency) => {
    const currencyHoldings = holdings.filter((holding) => holding.currency === currency);
    const totals = times.map((t) =>
      currencyHoldings.reduce(
        (sum, holding) => sum + holdingValueAt(holding, txByHolding.get(holding.id) ?? [], t),
        0,
      ),
    );
    const pcts = indexToStart(totals);

    return { currency, points: times.map((t, index) => ({ t, pct: pcts[index] })) };
  });
};
