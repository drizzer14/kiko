/**
 * The ids of every transaction that is one leg of an Exchange/Convert — an
 * internal money movement between two of the user's own holdings, never
 * spending. Unioned by the caller with the mcc/IBAN ids, the description ids
 * and the matched-pair ids.
 *
 * Keyed on the structural `exchangeCounterpartHoldingId` marker
 * (`transactions.exchange_counterpart_holding_id`), so it catches what no
 * other rule can: the debit leg carries a null `mcc` (the mcc rule bails), an
 * empty description (the description patterns are Ukrainian merchant
 * wordings), and a DIFFERENT currency from its credit leg (the matched-pair
 * matcher requires the same currency). It also catches the single-legged case
 * — an exchange into a term deposit writes a metadata contribution instead of
 * a credit row, so there is no counterpart row to pair against at all.
 */
export const exchangeExcludedTxIds = (
  transactions: readonly { id: string; exchangeCounterpartHoldingId: string | null }[],
): Set<string> => {
  const ids = new Set<string>();

  for (const transaction of transactions) {
    if (transaction.exchangeCounterpartHoldingId !== null) {
      ids.add(transaction.id);
    }
  }

  return ids;
};
