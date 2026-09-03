import type { Currency } from '../currency/currency';
import { Money, toMajor } from '../currency/money';
import type { CurrencyRateHistoryRow } from '../db/schema';
import { convert } from '../rates/conversion';
import { canConvert } from '../rates/net-worth-view';
import { rateTableAt } from '../repositories/rate-history.repo';
import { bucketTimes } from './currency-series';
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
 * that day's HISTORICAL rate table (`rateTableAt`, nearest row at or before `t`,
 * carrying weekends/holidays forward). Holdings with no rate for their currency
 * at `t` are skipped (guarded), never crashing the sum. Each point's `amount` is
 * the absolute total in base MAJOR units.
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
}): NetWorthSeries => {
  const { holdings, txByHolding, historyRows, baseCurrency, range, bucketDays = 1 } = input;

  if (historyRows.length === 0) {
    return { points: [], startReference: 0 };
  }

  const points = bucketTimes(range.from, range.to, bucketDays).map((t) => {
    const table = rateTableAt(historyRows, t);
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
