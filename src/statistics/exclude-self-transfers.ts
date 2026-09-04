/**
 * The maximum time gap between the two legs of a card-to-card self-transfer.
 *
 * A transfer between two of the user's own holdings surfaces as TWO separate
 * transaction rows (a debit on the source holding, a credit on the destination),
 * and the data model has no column linking them — they must be paired
 * structurally. Synced legs are near-simultaneous (the bank timestamps both from
 * the same operation), so the window is deliberately TIGHT: two minutes. A
 * tighter window risks missing a genuine pair whose legs were clocked a few
 * seconds apart across a day boundary of processing; a wider one risks folding
 * two unrelated equal-and-opposite transactions (e.g. a refund that happens to
 * mirror an unrelated charge that hour) into a false pair and silently dropping
 * real spending from the category chart. Two minutes keeps the false-negative
 * risk low while making a false-positive pairing very unlikely.
 */
export const SELF_TRANSFER_WINDOW_MS = 120_000;

type PairableTransaction = {
  holdingId: string;
  amountMinorUnits: number;
  time: number;
};

// True when `a` and `b` are the two legs of one self-transfer: different
// holdings, equal-and-opposite non-zero amounts, and near-simultaneous. `a` is
// assumed already non-zero by the caller (a zero amount can never be the debit
// leg), which keeps the "both non-zero" rule satisfied — if `a` is non-zero and
// `b === -a`, then `b` is non-zero too.
const isSelfTransferPair = (a: PairableTransaction, b: PairableTransaction): boolean =>
  a.holdingId !== b.holdingId &&
  a.amountMinorUnits === -b.amountMinorUnits &&
  Math.abs(a.time - b.time) <= SELF_TRANSFER_WINDOW_MS;

/**
 * Return `transactions` with every matched card-to-card self-transfer PAIR
 * removed (both legs). A pair is two transactions that are ALL of:
 *
 * - on DIFFERENT holdings (`holdingId`),
 * - exactly equal in magnitude and opposite in sign
 *   (`a.amountMinorUnits === -b.amountMinorUnits`), both non-zero,
 * - within `SELF_TRANSFER_WINDOW_MS` of each other in `time`.
 *
 * Matching is greedy and each transaction is consumed at most once: scanning in
 * input order, the first still-unmatched transaction claims the first
 * still-unmatched partner that satisfies the rule, and both are dropped. Every
 * unmatched transaction — including a lone leg whose partner is absent — is kept
 * unchanged. The rule is intentionally conservative: when in doubt it keeps a
 * transaction rather than risk dropping real spending.
 *
 * Generic over the row shape so callers pass their own transaction objects
 * through untouched (the returned rows are the very same references, filtered).
 */
export const excludeSelfTransfers = <T extends PairableTransaction>(transactions: T[]): T[] => {
  const matched = new Set<number>();

  for (let i = 0; i < transactions.length; i += 1) {
    if (matched.has(i)) {
      continue;
    }

    const a = transactions[i];
    if (a.amountMinorUnits === 0) {
      continue;
    }

    for (let j = i + 1; j < transactions.length; j += 1) {
      if (!matched.has(j) && isSelfTransferPair(a, transactions[j])) {
        matched.add(i);
        matched.add(j);
        break;
      }
    }
  }

  return transactions.filter((_, index) => !matched.has(index));
};
