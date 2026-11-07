import type { SeriesTransaction } from '../holding-value-at';

/**
 * Group the whole ledger by holding id so a series can reconstruct each holding's running balance
 * over time. Keyed by holding, not account, because a holding's balance is what a series values at
 * each instant.
 */
export const transactionsByHolding = (
  transactions: readonly { holdingId: string; time: number; amountMinorUnits: number }[],
): Map<string, SeriesTransaction[]> => {
  const byHolding = new Map<string, SeriesTransaction[]>();

  for (const transaction of transactions) {
    const list = byHolding.get(transaction.holdingId) ?? [];
    list.push({ time: transaction.time, amountMinorUnits: transaction.amountMinorUnits });
    byHolding.set(transaction.holdingId, list);
  }

  return byHolding;
};
