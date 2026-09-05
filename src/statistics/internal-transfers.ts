import type { Currency } from '../currency/currency';

/**
 * The maximum time gap between the two legs of one internal transfer.
 *
 * A transfer between two of the user's OWN holdings surfaces as TWO separate
 * transaction rows — a debit on the source holding and a credit on the
 * destination — and the data model has no column linking them, so they must be
 * paired structurally. Genuine legs are near-simultaneous (both clocked from
 * the same operation), so the window is deliberately TIGHT: two minutes. A
 * wider window risks folding two unrelated equal-and-opposite transactions
 * (e.g. a refund mirroring an unrelated charge that hour) into a false pair and
 * silently dropping real spending from the category chart; two minutes keeps
 * that false-positive risk very low while tolerating a few seconds of clock
 * skew between the legs.
 */
export const TRANSFER_MATCH_WINDOW_MS = 2 * 60 * 1000;

/**
 * The minimal transaction shape the matcher needs. `currency` is the parent
 * HOLDING's currency (a transaction row carries no currency of its own), joined
 * in by the caller so a cross-currency pair — whose minor units never line up —
 * is never mistaken for one transfer.
 */
type InternalTransferTx = {
  id: string;
  holdingId: string;
  time: number;
  amountMinorUnits: number;
  currency: Currency;
};

// True when `credit` is the matching destination leg for `debit`: an
// equal-and-opposite amount in the SAME currency, on a DIFFERENT holding, and
// within the pairing window. `debit` is assumed negative and `credit` positive
// by the caller, so equal magnitude reduces to `credit === -debit`.
const isMatchingCredit = (debit: InternalTransferTx, credit: InternalTransferTx): boolean =>
  credit.amountMinorUnits === -debit.amountMinorUnits &&
  credit.currency === debit.currency &&
  credit.holdingId !== debit.holdingId &&
  Math.abs(debit.time - credit.time) <= TRANSFER_MATCH_WINDOW_MS;

/**
 * Identify both legs of every INTERNAL transfer (a matched -X / +X pair across
 * two of the user's own holdings) and return their transaction ids as a Set.
 *
 * For each DEBIT (negative amount) the first still-unmatched CREDIT (positive
 * amount) that satisfies `isMatchingCredit` is claimed; matching is greedy and
 * each transaction is consumed at most once, so one credit can never cancel two
 * debits and a lone leg whose partner is absent stays unmatched (and therefore
 * counted). Zero-amount rows are never legs. The returned ids let a caller drop
 * these rows from a spending view without mutating the ledger.
 */
export const internalTransferTxIds = (transactions: InternalTransferTx[]): Set<string> => {
  const matchedIds = new Set<string>();
  const consumedCredits = new Set<number>();

  for (const debit of transactions) {
    if (debit.amountMinorUnits >= 0) {
      continue;
    }

    for (let index = 0; index < transactions.length; index += 1) {
      const credit = transactions[index];
      if (consumedCredits.has(index) || credit.amountMinorUnits <= 0) {
        continue;
      }
      if (isMatchingCredit(debit, credit)) {
        consumedCredits.add(index);
        matchedIds.add(debit.id);
        matchedIds.add(credit.id);
        break;
      }
    }
  }

  return matchedIds;
};
