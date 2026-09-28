import type { HoldingRow } from '@kiko/db';
import { startOfLocalDay } from '@kiko/dates';
import { holdingsRepo } from '@kiko/holdings/repo';
import { holdingValueBreakdown } from '@kiko/holdings/holding-value';
import { EMPTY_PRICE_BOOK, type PriceBook } from '@kiko/prices/price-book';
import { isLedgerlessHoldingType } from '@kiko/holdings/holding-descriptor';

/** A holding as the series builders need it: identity, currency, and value inputs. */
export type SeriesHolding = Pick<
  HoldingRow,
  'id' | 'currency' | 'type' | 'balanceMinorUnits' | 'metadata'
>;

/** One transaction as the reconstruction needs it: when, and how much (signed). */
export type SeriesTransaction = { time: number; amountMinorUnits: number };

/**
 * A holding's value at instant `t`, in its own currency's minor units. Shared by
 * the per-currency indexed series and the converted net-worth series so the
 * reconstruction lives in exactly one place.
 *
 * - a ledgerless type (`isLedgerlessHoldingType` — term_deposit, bond,
 *   property_item): computed via `holdingValueBreakdown(holding, t, book)` so
 *   accrued interest / coupons / a `PriceBook` lookup are correct at each past
 *   date (no ledger needed).
 * - everything else (card / cash / jar / crypto_asset): the running balance,
 *   reconstructed as opening balance + every transaction whose LOCAL DAY is at
 *   or before `t`'s local day. Comparing by local day (not raw instant) matches
 *   the daily buckets, which production samples at LOCAL MIDNIGHT: a mid-day
 *   debit and a same-local-day bond purchase (the bond's cost turns on by local
 *   day) then land in the SAME bucket, so a card->bond move stays net-worth
 *   neutral instead of spiking or dipping across the midnight boundary.
 *   Opening balance = current balance - sum(all transactions), since the stored
 *   `balanceMinorUnits` is the CURRENT balance, not the range-start balance.
 */
export const holdingValueAt = (
  holding: SeriesHolding,
  transactions: SeriesTransaction[],
  t: number,
  book: PriceBook = EMPTY_PRICE_BOOK,
): number => {
  if (isLedgerlessHoldingType(holding.type)) {
    return holdingValueBreakdown(holding, t, book).net.minorUnits;
  }

  // A single pass (not a `.reduce` + `.filter().reduce()` chain) so each
  // row's local-day key is derived directly in the loop body, never inside an
  // array callback — see kiko-domain's statistics performance note.
  const targetDay = startOfLocalDay(t);
  let totalAmount = 0;
  let appliedAmount = 0;

  for (const transaction of transactions) {
    totalAmount += transaction.amountMinorUnits;

    if (startOfLocalDay(transaction.time) <= targetDay) {
      appliedAmount += transaction.amountMinorUnits;
    }
  }

  const openingBalance = holdingsRepo.balanceOf(holding).minorUnits - totalAmount;

  return openingBalance + appliedAmount;
};

// The last cumulative-sum entry whose `day` is <= `targetDay`, or -1 when
// every entry is after it (nothing applied yet).
const lastIndexAtOrBefore = (days: number[], targetDay: number): number => {
  let low = 0;
  let high = days.length - 1;
  let result = -1;

  while (low <= high) {
    const mid = (low + high) >>> 1;

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
 * Same result as calling `holdingValueAt(holding, transactions, t, book)` once
 * per bucket, but pays the per-transaction cost (deriving each row's local-day
 * key, and summing the whole ledger for the opening balance) exactly ONCE per
 * holding instead of once per bucket. A multi-year net-worth line values every
 * holding at dozens/hundreds of buckets, so that per-bucket re-scan was
 * loop-invariant work repeated at every point.
 *
 * The per-holding one-time setup groups transactions by local-day key and
 * builds a running (prefix) sum per distinct day; each call then binary
 * searches that sorted day list instead of re-filtering/re-reducing the whole
 * transaction list.
 */
export const createHoldingValuer = (
  holding: SeriesHolding,
  transactions: SeriesTransaction[],
  book: PriceBook = EMPTY_PRICE_BOOK,
): ((t: number) => number) => {
  if (isLedgerlessHoldingType(holding.type)) {
    return (t: number): number => holdingValueBreakdown(holding, t, book).net.minorUnits;
  }

  const sumByDay = new Map<number, number>();

  for (const transaction of transactions) {
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
    const matched = lastIndexAtOrBefore(days, startOfLocalDay(t));

    return openingBalance + (matched === -1 ? 0 : cumulativeSums[matched]);
  };
};
