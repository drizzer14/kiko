import type { HoldingRow } from '@kiko/db';
import { startOfLocalDay } from '@kiko/dates';
import { holdingsRepo } from '@kiko/holdings/repo';
import { holdingValueBreakdown } from '@kiko/holdings/holding-value';
import { EMPTY_PRICE_BOOK, type PriceBook } from '@kiko/prices/price-book';
import { isLedgerlessHoldingType } from '@kiko/holdings/holding-descriptor';

/**
 * A holding as the series builders need it: identity, currency, and value
 * inputs, plus `closedAt` — a null/closed-instant marker `buildNetWorthSeries`
 * reads to zero out a closed holding's value for buckets AFTER its close (see
 * that builder's own doc comment); `createHoldingValuer` itself never reads
 * it — reconstructing a holding's value has no opinion on whether it is
 * currently closed.
 */
export type SeriesHolding = Pick<
  HoldingRow,
  'id' | 'currency' | 'type' | 'balanceMinorUnits' | 'metadata' | 'closedAt'
>;

/** One transaction as the reconstruction needs it: when, and how much (signed). */
export type SeriesTransaction = { time: number; amountMinorUnits: number };

/**
 * Test-only instrumentation: counts each row `createHoldingValuer` touches
 * (a setup pass over the ledger, or a binary-search step per bucket), so a
 * regression back to a per-bucket full-ledger scan is provable by a
 * deterministic count instead of a wall-clock timing — coverage
 * instrumentation and machine load skew the two sides of a timed comparison
 * by different amounts, which makes a wall-clock guard flaky by design.
 */
export type ValuerWorkCounter = { rowVisits: number };

// The last cumulative-sum entry whose `day` is <= `targetDay`, or -1 when
// every entry is after it (nothing applied yet).
const lastIndexAtOrBefore = (
  days: number[],
  targetDay: number,
  workCounter?: ValuerWorkCounter,
): number => {
  let low = 0;
  let high = days.length - 1;
  let result = -1;

  while (low <= high) {
    const mid = (low + high) >>> 1;

    if (workCounter) {
      workCounter.rowVisits += 1;
    }

    if (days[mid] <= targetDay) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return result;
};

/**
 * A holding's value at instant `t`, in its own currency's minor units,
 * answered for MANY buckets against the SAME holding — `buildNetWorthSeries`
 * values every holding at every bucket a multi-year line samples, so
 * anything loop-invariant per holding (not per bucket) is paid exactly ONCE
 * here, before the bucket loop, rather than re-derived at every point:
 *
 * - a ledgerless type (`isLedgerlessHoldingType` — term_deposit, bond,
 *   property_item): the returned closure calls
 *   `holdingValueBreakdown(holding, t, book)` per bucket (accrued interest /
 *   coupons / a `PriceBook` lookup genuinely depend on `t`, so there is no
 *   loop-invariant part to hoist here) — the net worth in minor units.
 * - everything else (card / cash / jar / crypto_asset): the running balance,
 *   reconstructed as opening balance + every transaction whose LOCAL DAY is
 *   at or before `t`'s local day. Comparing by local day (not raw instant)
 *   matches the daily buckets, which production samples at LOCAL MIDNIGHT: a
 *   mid-day debit and a same-local-day bond purchase (the bond's cost turns
 *   on by local day) then land in the SAME bucket, so a card->bond move stays
 *   net-worth neutral instead of spiking or dipping across the midnight
 *   boundary. Opening balance = current balance - sum(all transactions),
 *   since the stored `balanceMinorUnits` is the CURRENT balance, not the
 *   range-start balance. The per-holding one-time setup groups transactions
 *   by local-day key and builds a running (prefix) sum per distinct day;
 *   each call then binary searches that sorted day list instead of
 *   re-filtering/re-reducing the whole transaction list per bucket.
 */
export const createHoldingValuer = (
  holding: SeriesHolding,
  transactions: SeriesTransaction[],
  book: PriceBook = EMPTY_PRICE_BOOK,
  workCounter?: ValuerWorkCounter,
): ((t: number) => number) => {
  if (isLedgerlessHoldingType(holding.type)) {
    return (t: number): number => holdingValueBreakdown(holding, t, book).net.minorUnits;
  }

  const sumByDay = new Map<number, number>();

  for (const transaction of transactions) {
    if (workCounter) {
      workCounter.rowVisits += 1;
    }

    const day = startOfLocalDay(transaction.time);

    sumByDay.set(day, (sumByDay.get(day) ?? 0) + transaction.amountMinorUnits);
  }

  const days = [...sumByDay.keys()].sort((a, b) => a - b);
  const cumulativeSums: number[] = [];
  let runningTotal = 0;

  for (const day of days) {
    runningTotal += sumByDay.get(day) ?? 0;
    cumulativeSums.push(runningTotal);
  }

  const openingBalance = holdingsRepo.balanceOf(holding).minorUnits - runningTotal;

  return (t: number): number => {
    const matched = lastIndexAtOrBefore(days, startOfLocalDay(t), workCounter);

    return openingBalance + (matched === -1 ? 0 : cumulativeSums[matched]);
  };
};
