import type { Currency } from '../currency/currency';
import { Money, toMajor } from '../currency/money';
import type { CurrencyRateHistoryRow } from '../db/schema';
import { convert, type RateTable } from '../rates/conversion';
import { toUtcMidnight } from '../rates/history-entry';
import { canConvert } from '../rates/net-worth-view';
import { earliestRateTable, rateTableAt } from '../repositories/rate-history.repo';

import { bucketTimes } from './buckets';
import { holdingValueAt, type SeriesHolding, type SeriesTransaction } from './holding-value-at';

type HistoryRow = Pick<CurrencyRateHistoryRow, 'base' | 'quote' | 'day' | 'rate'>;

/** One point on the net-worth line: `amount` is total net worth in base MAJOR units. */
export type NetWorthPoint = { t: number; amount: number };

/**
 * The converted net-worth line plus the horizontal reference. `startReference`
 * is the net worth at the range start (the dashed baseline the chart draws).
 */
export type NetWorthSeries = { points: NetWorthPoint[]; startReference: number };

/**
 * Build the single converted net-worth line over `range`. For each day bucket
 * `t`, every holding is valued at `t` (via `holdingValueAt`, so past deposit
 * interest / bond coupons are correct) and converted to the base currency at
 * that day's rate table. Each point's `amount` is the absolute total in base
 * MAJOR units.
 *
 * The rate table for a bucket is resolved so the line reconciles end-to-end:
 * - lookups are normalized to the bucket's UTC day (`toUtcMidnight`), since
 *   history `day` is UTC-midnight — without this a positive-UTC-offset locale
 *   would read the previous day's rate;
 * - the nearest row AT OR BEFORE that day is used (`rateTableAt`, carrying
 *   weekends/holidays forward), backstopped by each pair's EARLIEST stored row
 *   (`earliestRateTable`) so buckets before a pair's first history day still
 *   value foreign holdings instead of silently dropping them;
 * - the CURRENT-day bucket(s) are valued at the live `rateTable` when supplied,
 *   so the line's rightmost "now" point matches the headline / bar / pie, which
 *   use the same live (monobank BUY) rates rather than the day's NBU official one.
 *
 * Holdings with no rate for their currency at `t` are skipped (guarded), never
 * crashing the sum.
 *
 * With no history stored yet (backfill pending) there is nothing accurate to
 * draw, so an empty series is returned for the screen to show as a loading /
 * empty state.
 */
export const buildNetWorthSeries = (input: {
  holdings: SeriesHolding[];
  txByHolding: Map<string, SeriesTransaction[]>;
  historyRows: HistoryRow[];
  baseCurrency: Currency;
  range: { from: number; to: number };
  bucketDays?: number;
  liveRateTable?: RateTable;
  today?: number;
}): NetWorthSeries => {
  const {
    holdings,
    txByHolding,
    historyRows,
    baseCurrency,
    range,
    bucketDays = 1,
    liveRateTable,
    today,
  } = input;

  if (historyRows.length === 0) {
    return { points: [], startReference: 0 };
  }

  const earliest = earliestRateTable(historyRows);
  const todayKey = toUtcMidnight(today ?? Date.now());

  const tableAt = (t: number): RateTable => {
    const dayKey = toUtcMidnight(t);
    const historical = { ...earliest, ...rateTableAt(historyRows, dayKey) };
    // The current (and any future) bucket reconciles with the live app rates.
    return liveRateTable !== undefined && dayKey >= todayKey
      ? { ...historical, ...liveRateTable }
      : historical;
  };

  const points = bucketTimes(range.from, range.to, bucketDays).map((t) => {
    const table = tableAt(t);
    const total = holdings
      .filter((holding) => canConvert(holding.currency, baseCurrency, table))
      .reduce(
        (sum, holding) => {
          const value = holdingValueAt(holding, txByHolding.get(holding.id) ?? [], t);
          return sum.add(convert(Money.of(holding.currency, value), baseCurrency, table));
        },
        Money.of(baseCurrency, 0),
      );

    return { t, amount: toMajor(total.minorUnits, baseCurrency) };
  });

  return { points, startReference: points[0]?.amount ?? 0 };
};
