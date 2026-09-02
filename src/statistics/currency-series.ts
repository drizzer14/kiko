import type { Currency } from '../currency/currency';
import type { HoldingRow } from '../db/schema';
import { holdingValueBreakdown } from '../holdings/holding-value';

/** A holding as the line chart needs it: identity, currency, and value inputs. */
export type SeriesHolding = Pick<
  HoldingRow,
  'id' | 'currency' | 'type' | 'balanceMinorUnits' | 'metadata'
>;

/** One transaction as the reconstruction needs it: when, and how much (signed). */
export type SeriesTransaction = { time: number; amountMinorUnits: number };

/** A single point on a currency's line: `pct` = percent change vs the range start. */
export type SeriesPoint = { t: number; pct: number };

/** One line: a currency and its day-bucketed, start-indexed percent-change points. */
export type CurrencySeries = { currency: Currency; points: SeriesPoint[] };

const DAY_MS = 86_400_000;

// The bucket instants across the range: `from`, then one per `bucketDays` step,
// always closing on `to` so the window's start and end are both represented.
const bucketTimes = (from: number, to: number, bucketDays: number): number[] => {
  const step = bucketDays * DAY_MS;
  const times: number[] = [];
  for (let t = from; t < to; t += step) {
    times.push(t);
  }
  times.push(to);

  return times;
};

// A holding's value at instant `t`, in its own currency's minor units.
// - term_deposit / bond: computed via `holdingValueBreakdown(holding, t)` so
//   accrued interest / coupons are correct at each past date (no ledger needed).
// - everything else (card / cash / jar / crypto_asset): the running balance,
//   reconstructed as opening balance + every transaction dated at or before `t`.
//   Opening balance = current balance - sum(all transactions), since the stored
//   `balanceMinorUnits` is the CURRENT balance, not the range-start balance.
const holdingValueAt = (
  holding: SeriesHolding,
  transactions: SeriesTransaction[],
  t: number,
): number => {
  if (holding.type === 'term_deposit' || holding.type === 'bond') {
    return holdingValueBreakdown(holding, t).net.minorUnits;
  }
  const openingBalance =
    holding.balanceMinorUnits -
    transactions.reduce((sum, transaction) => sum + transaction.amountMinorUnits, 0);
  const applied = transactions
    .filter((transaction) => transaction.time <= t)
    .reduce((sum, transaction) => sum + transaction.amountMinorUnits, 0);

  return openingBalance + applied;
};

// Convert a currency's per-bucket absolute totals into percent change vs the
// range start. Divide-by-zero guard: when the range-start value is 0 the index
// is undefined, so we baseline against the FIRST NON-ZERO bucket instead; every
// leading zero bucket reports 0% (the flat baseline until money first appears),
// and an all-zero series stays flat at 0%.
const indexToStart = (values: number[]): number[] => {
  const baselineIndex = values.findIndex((value) => value !== 0);
  if (baselineIndex === -1) {
    return values.map(() => 0);
  }
  const baseline = values[baselineIndex];

  return values.map((value, index) => (index < baselineIndex ? 0 : (value / baseline - 1) * 100));
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
