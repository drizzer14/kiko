import { Money, toMajor } from '@kiko/currency/money';
import type { CurrencyRateHistoryRow } from '@kiko/db';
import { canConvert } from '@kiko/rates/net-worth-view';
import type { Currency } from '@kiko/currency/currency';
import { convert, type RateTable } from '@kiko/rates/conversion';
import { FIAT_RATE_SEED_TABLE } from '@kiko/rates/fiat-rate-seed';
import { asBondMeta, type BondMeta } from '@kiko/holdings/holding-metadata';
import { earliestRateTable, rateTableAt } from '@kiko/rates/rate-history-repo';
import { dayKeyOf, EMPTY_PRICE_BOOK, type PriceBook } from '@kiko/prices/price-book';

import {
  createHoldingValuer,
  type SeriesHolding,
  type SeriesTransaction,
} from '../holding-value-at';
import { bucketTimes } from '../buckets';
import { reconcileBondFunding } from '../reconcile-bond-funding';

type HistoryRow = Pick<CurrencyRateHistoryRow, 'base' | 'quote' | 'day' | 'rate'>;

/** One point on the net-worth line: `amount` is total net worth in base MAJOR units. */
export type NetWorthPoint = { t: number; amount: number };

/**
 * The converted net-worth line plus the horizontal reference. `startReference`
 * is the net worth at the range start (the dashed baseline the chart draws).
 */
export type NetWorthSeries = { points: NetWorthPoint[]; startReference: number };

/**
 * Reconciles every bond's held-cost start against the DAY the funding money
 * actually left, NOT the typed `purchaseDate`, so a cross-day card->bond move
 * does not dip (or bump). The bond keeps its typed price, the value Home shows.
 * See `reconcileBondFunding` for the currency + debit + near-price match.
 *
 * Every bond shares ONE `claimed` set across the whole run (see
 * `reconcileBondFunding`), so two bonds priced the same week never both claim
 * the same funding debit. Which bond claims it is order-dependent (a greedy,
 * per-bond nearest-day match — not a global optimum over every bond at once),
 * so bonds are reconciled in a FIXED order: typed `purchaseDate`, then `id` —
 * deterministic regardless of the holdings array's own (user-controlled sort
 * order) order.
 */
const bondRecognitionsFor = (
  holdings: SeriesHolding[],
  transactionsByHolding: Map<string, SeriesTransaction[]>,
): Map<string, number> => {
  const bonds = holdings
    .map((holding) => ({
      holding,
      meta: holding.type === 'bond' ? asBondMeta(holding.metadata) : null,
    }))
    .filter((entry): entry is { holding: SeriesHolding; meta: BondMeta } => entry.meta !== null)
    .sort(
      (a, b) => a.meta.purchaseDate - b.meta.purchaseDate || (a.holding.id < b.holding.id ? -1 : 1),
    );

  const claimed = new Set<string>();

  return new Map(
    bonds.map(({ holding, meta }) => [
      holding.id,
      reconcileBondFunding(meta, holding.currency, holdings, transactionsByHolding, claimed),
    ]),
  );
};

/**
 * Build the single converted net-worth line over `range`. For each day bucket
 * `t`, every holding is valued at `t` (via `createHoldingValuer`, so past
 * deposit interest / bond coupons are correct) and converted to the base
 * currency at that day's rate table. Each point's `amount` is the absolute
 * total in base MAJOR units.
 *
 * `holdings` must include CLOSED holdings too, not just currently-open ones —
 * the caller applies its own account/name filter, but never a `closedAt`
 * filter, before calling this. A closed holding's value is zeroed only for
 * buckets at or after the exact instant it closed (see the
 * `holdingsWithValuer` build below); every earlier bucket still reconstructs
 * its real historical value.
 *
 * The rate table for a bucket is resolved so the line reconciles end-to-end:
 * - lookups are keyed by the bucket's LOCAL calendar day (`dayKeyOf`): history
 *   `day` is the UTC-midnight stand-in for a calendar date, the same shape
 *   `dayKeyOf` returns, so the two compare as plain day keys. A bucket is the
 *   END of its local day (the valuer reads it so), and a UTC-day floor would
 *   send every Kyiv bucket at 00:00-03:00 local to the PREVIOUS day's row;
 * - the nearest row AT OR BEFORE that day is used (`rateTableAt`, carrying
 *   weekends/holidays forward), backstopped by each pair's EARLIEST stored row
 *   (`earliestRateTable`) so buckets before a pair's first history day still
 *   value foreign holdings instead of silently dropping them, which is in turn
 *   backstopped by the live `rateTable` (a currency with NO history row at all,
 *   such as a crypto holding, is valued flat at today's rate in every past
 *   bucket, so the line has no step at its right edge) and then by the bundled
 *   static `FIAT_RATE_SEED_TABLE` so a fiat currency with no history row and
 *   no live rate yet (the backfill only fetches the currencies actually used)
 *   never drops a holding out of a past bucket — precedence, weakest first:
 *   seed < live < earliest < at-or-before, then live on top for today;
 * - the CURRENT-day bucket(s) are valued at the live `rateTable` when supplied,
 *   so the line's rightmost "now" point matches the headline / bar / pie, which
 *   use the same live (monobank BUY) rates rather than the day's NBU official one.
 *
 * Known limits: a currency missing from history AND the live table
 * (a failed all-or-nothing crypto fetch, or a closed crypto holding with no
 * stored rate) drops out of every bucket, today's included, so the line agrees
 * with the headline; a past bucket of a currency with no history moves when its
 * live rate moves.
 *
 * Holdings with no rate for their currency at `t` are skipped (guarded), never
 * crashing the sum.
 *
 * With no history stored yet, only a base-currency-only user (no holding
 * ever needs a cross-rate) still gets points; any other holder returns an
 * empty series rather than a partial line missing its foreign holdings.
 */
export const buildNetWorthSeries = (input: {
  holdings: SeriesHolding[];
  transactionsByHolding: Map<string, SeriesTransaction[]>;
  historyRows: HistoryRow[];
  baseCurrency: Currency;
  range: { from: number; to: number };
  bucketDays?: number;
  liveRateTable?: RateTable;
  today?: number;
  book?: PriceBook;
}): NetWorthSeries => {
  const {
    holdings,
    transactionsByHolding,
    historyRows,
    baseCurrency,
    range,
    bucketDays = 1,
    liveRateTable,
    today,
    book = EMPTY_PRICE_BOOK,
  } = input;

  // Empty with no holdings (nothing to plot), or with no history rows yet
  // while some holding is foreign (a misleading partial line otherwise); a
  // base-currency-only user still gets points with no history rows.
  if (
    holdings.length === 0 ||
    (historyRows.length === 0 && holdings.some((holding) => holding.currency !== baseCurrency))
  ) {
    return { points: [], startReference: 0 };
  }

  // This is a pure valuation shift on a THROWAWAY copy: it rewrites only
  // `purchaseDate` (the cost-on threshold `bondBreakdown` reads). Coupons,
  // maturity, and the redemption ledger read the REAL holding's untouched
  // `purchaseDate` elsewhere — the series never derives them from this copy. The
  // pairing needs cross-holding transactions, which only this builder holds, so it
  // happens once here before the bucket loop rather than inside `bondBreakdown`.
  // See `bondRecognitionsFor` above for the claim/order rules.
  const bondRecognitions = bondRecognitionsFor(holdings, transactionsByHolding);

  const valuationHoldings: SeriesHolding[] = holdings.map((holding) => {
    if (holding.type !== 'bond') {
      return holding;
    }
    const meta = asBondMeta(holding.metadata);
    const recognitionDay = bondRecognitions.get(holding.id);

    if (meta === null || recognitionDay === undefined) {
      return holding;
    }

    return {
      ...holding,
      metadata: { ...meta, purchaseDate: recognitionDay },
    };
  });

  // Built ONCE per holding, not once per (holding, bucket) — see
  // `createHoldingValuer`'s own doc comment for why a per-bucket reduce/filter
  // would be loop-invariant work repeated at every point. A closed
  // holding's value is zeroed for every bucket AT OR AFTER its own
  // `closedAt` instant — a raw instant compare, not a local-day one, keeps
  // the rightmost "now" bucket consistent with the screen's other
  // now-snapshots (open holdings only) even when the holding closed earlier
  // the SAME day. `holdings` carries every holding regardless of `closedAt`
  // (kiko-pricing: the history chart needs a closed holding's own past
  // prices the same way it needs its own past lots).
  const holdingsWithValuer: { holding: SeriesHolding; valueAt: (t: number) => number }[] = [];

  for (const holding of valuationHoldings) {
    const rawValueAt = createHoldingValuer(
      holding,
      transactionsByHolding.get(holding.id) ?? [],
      book,
    );
    const closedAt = holding.closedAt;

    holdingsWithValuer.push({
      holding,
      valueAt: (t: number): number => (closedAt !== null && t >= closedAt ? 0 : rawValueAt(t)),
    });
  }

  const earliest = earliestRateTable(historyRows);
  const todayKey = dayKeyOf(today ?? Date.now());

  const tableAt = (t: number): RateTable => {
    const dayKey = dayKeyOf(t);
    // Precedence, weakest first: the bundled static seed (covers every fiat
    // currency, so one with no history row yet never drops a holding out of
    // a past bucket), then the live table (prices a currency with no stored
    // history at all — a crypto holding, or a fiat the seed only roughly
    // knows — flat at today's rate instead of dropping it from every past
    // bucket and stepping up at today), then each pair's earliest stored row
    // (backfills before its own first history day), then the day's own
    // nearest-at-or-before row — a real historical rate always wins over both
    // the flat seed and the live rate.
    const historical = {
      ...FIAT_RATE_SEED_TABLE,
      ...liveRateTable,
      ...earliest,
      ...rateTableAt(historyRows, dayKey),
    };
    // Every bucket on today's local day (or later) reconciles with the live app
    // rates, whatever the time of day.
    return liveRateTable !== undefined && dayKey >= todayKey
      ? { ...historical, ...liveRateTable }
      : historical;
  };

  const points = bucketTimes(range.from, range.to, bucketDays).map((t) => {
    const table = tableAt(t);
    const total = holdingsWithValuer
      .filter(({ holding }) => canConvert(holding.currency, baseCurrency, table))
      .reduce(
        (sum, { holding, valueAt }) =>
          sum.add(convert(Money.of(holding.currency, valueAt(t)), baseCurrency, table)),
        Money.of(baseCurrency, 0),
      );

    return { t, amount: toMajor(total.minorUnits, baseCurrency) };
  });

  return { points, startReference: points[0]?.amount ?? 0 };
};
