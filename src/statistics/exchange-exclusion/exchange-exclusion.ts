import type { Currency } from '@kiko/currency/currency';

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
 *
 * A row with an `untrackedCounterpart` code is the same kind of movement, to a
 * Binance wallet Kiko does not track: it has no counterpart holding to name, so
 * the code is its marker.
 */
export const exchangeExcludedTransactionIds = (
  transactions: readonly {
    id: string;
    exchangeCounterpartHoldingId: string | null;
    untrackedCounterpart: string | null;
  }[],
): Set<string> => {
  const ids = new Set<string>();

  for (const transaction of transactions) {
    if (
      transaction.exchangeCounterpartHoldingId !== null ||
      transaction.untrackedCounterpart !== null
    ) {
      ids.add(transaction.id);
    }
  }

  return ids;
};

type MoveLeg = {
  id: string;
  holdingId: string;
  amountMinorUnits: number;
  currency: Currency;
  exchangePairId: string | null;
};

/**
 * The ids of both legs of a SAME-CURRENCY Exchange/Convert whose two sides are equal and opposite
 * on two holdings. It exists for the leg the marker rule cannot see: a Convert marks a bank-owned
 * (synced) row with the pair id only, so a synced debit moved to an own holding of its currency
 * carries no `exchangeCounterpartHoldingId`, and the 2-minute matcher never sees a row with a
 * pair id (`rowsForTransferMatch`), so nothing else would take it out of spending.
 *
 * The partner is found by the pair id itself, never by time: a leg can only pair with a row of
 * its own movement, so an unmarked same-amount row (a Pay send) is never consumed. A pair that
 * crosses currencies, or whose amounts differ (a fee, an edited amount), stays in spending: the
 * user ruled that a synced debit a Convert sent into another currency still counts.
 *
 * The caller passes the unfiltered ledger, so a partner on an account the filter hides still
 * counts as the partner.
 */
export const sameCurrencyMoveTransactionIds = (transactions: readonly MoveLeg[]): Set<string> => {
  const legsByPairId = new Map<string, MoveLeg[]>();

  for (const transaction of transactions) {
    if (transaction.exchangePairId !== null) {
      legsByPairId.set(transaction.exchangePairId, [
        ...(legsByPairId.get(transaction.exchangePairId) ?? []),
        transaction,
      ]);
    }
  }

  const ids = new Set<string>();

  for (const legs of legsByPairId.values()) {
    for (const debit of legs.filter((leg) => leg.amountMinorUnits < 0)) {
      const credit = legs.find(
        (candidate) =>
          !ids.has(candidate.id) &&
          candidate.currency === debit.currency &&
          candidate.holdingId !== debit.holdingId &&
          candidate.amountMinorUnits === -debit.amountMinorUnits,
      );

      if (credit !== undefined) {
        ids.add(debit.id);
        ids.add(credit.id);
      }
    }
  }

  return ids;
};
