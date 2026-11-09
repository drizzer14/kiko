import type { SeriesTransaction } from '../holding-value-at';

/**
 * Group the whole ledger by holding id so a series can reconstruct each holding's running balance
 * over time. Keyed by holding, not account, because a holding's balance is what a series values at
 * each instant. Each row keeps its id and source: a dated balance reads both.
 */
export const transactionsByHolding = (
  transactions: readonly (Required<SeriesTransaction> & { holdingId: string })[],
): Map<string, SeriesTransaction[]> => {
  const byHolding = new Map<string, SeriesTransaction[]>();

  for (const transaction of transactions) {
    const list = byHolding.get(transaction.holdingId) ?? [];
    list.push({
      id: transaction.id,
      time: transaction.time,
      amountMinorUnits: transaction.amountMinorUnits,
      source: transaction.source,
    });
    byHolding.set(transaction.holdingId, list);
  }

  return byHolding;
};
