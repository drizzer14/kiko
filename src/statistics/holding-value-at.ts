import type { HoldingRow } from '../db/schema';
import { holdingValueBreakdown } from '../holdings/holding-value';

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
 * - term_deposit / bond: computed via `holdingValueBreakdown(holding, t)` so
 *   accrued interest / coupons are correct at each past date (no ledger needed).
 * - everything else (card / cash / jar / crypto_asset): the running balance,
 *   reconstructed as opening balance + every transaction dated at or before `t`.
 *   Opening balance = current balance - sum(all transactions), since the stored
 *   `balanceMinorUnits` is the CURRENT balance, not the range-start balance.
 */
export const holdingValueAt = (
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
