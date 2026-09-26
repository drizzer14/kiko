import { holdingsRepo } from '@kiko/holdings/repo';
import { holdingValueBreakdown } from '@kiko/holdings/holding-value';
import { EMPTY_PRICE_BOOK, type PriceBook } from '@kiko/prices/price-book';
import { isLedgerlessHoldingType } from '@kiko/holdings/holding-descriptor';

import type { HoldingRow } from '../../db/schema';
import { startOfLocalDay } from '../../dates/local-day';

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
  const openingBalance =
    holdingsRepo.balanceOf(holding).minorUnits -
    transactions.reduce((sum, transaction) => sum + transaction.amountMinorUnits, 0);
  const applied = transactions
    .filter((transaction) => startOfLocalDay(transaction.time) <= startOfLocalDay(t))
    .reduce((sum, transaction) => sum + transaction.amountMinorUnits, 0);

  return openingBalance + applied;
};
