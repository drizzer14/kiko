import type { Currency } from '@kiko/currency/currency';

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
type InternalTransferTransaction = {
  id: string;
  holdingId: string;
  time: number;
  amountMinorUnits: number;
  currency: Currency;
};

// One CREDIT candidate, indexed by its position in the original `transactions`
// array (so "first still-unmatched" below means earliest ORIGINAL position,
// exactly as the array-order scan it replaces) and sorted by `time` within its
// (currency, amount) bucket, so a debit only ever has to look at the handful
// of credits actually within `TRANSFER_MATCH_WINDOW_MS` of it.
type CreditCandidate = {
  index: number;
  time: number;
  holdingId: string;
  consumed: boolean;
};

const creditBucketKey = (currency: Currency, amountMinorUnits: number): string =>
  `${currency}:${amountMinorUnits}`;

// Every positive-amount row, grouped by (currency, amount) and time-sorted, so
// a debit's matching credits are a single binary-searchable slice instead of
// the whole ledger.
const buildCreditBuckets = (
  transactions: InternalTransferTransaction[],
): Map<string, CreditCandidate[]> => {
  const buckets = new Map<string, CreditCandidate[]>();

  transactions.forEach((transaction, index) => {
    if (transaction.amountMinorUnits <= 0) {
      return;
    }

    const key = creditBucketKey(transaction.currency, transaction.amountMinorUnits);
    const bucket = buckets.get(key) ?? [];

    bucket.push({
      index,
      time: transaction.time,
      holdingId: transaction.holdingId,
      consumed: false,
    });
    buckets.set(key, bucket);
  });

  for (const bucket of buckets.values()) {
    bucket.sort((a, b) => a.time - b.time);
  }

  return buckets;
};

// First index in a time-sorted bucket whose `time` is >= `lowTime`.
const lowerBoundByTime = (bucket: CreditCandidate[], lowTime: number): number => {
  let low = 0;
  let high = bucket.length;

  while (low < high) {
    const mid = (low + high) >>> 1;

    if (bucket[mid].time < lowTime) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
};

/**
 * Test-only instrumentation: counts each credit candidate the matcher
 * actually visits, so a regression back to a full-array scan is provable by
 * a deterministic count instead of a wall-clock timing — coverage
 * instrumentation and machine load skew the two sides of a timed comparison
 * by different amounts, which makes a wall-clock guard flaky by design.
 */
export type CandidateVisitCounter = { candidateVisits: number };

// The earliest-original-position, still-unmatched, different-holding credit
// within the pairing window of `debit` — the same candidate the quadratic scan
// would have found first, restricted up front to the handful of candidates the
// window and the (currency, amount) bucket admit.
const findMatchingCredit = (
  bucket: CreditCandidate[],
  debit: InternalTransferTransaction,
  visitCounter?: CandidateVisitCounter,
): CreditCandidate | undefined => {
  const lowTime = debit.time - TRANSFER_MATCH_WINDOW_MS;
  const highTime = debit.time + TRANSFER_MATCH_WINDOW_MS;
  let best: CreditCandidate | undefined;

  for (let cursor = lowerBoundByTime(bucket, lowTime); cursor < bucket.length; cursor += 1) {
    const candidate = bucket[cursor];

    if (candidate.time > highTime) {
      break;
    }

    if (visitCounter) {
      visitCounter.candidateVisits += 1;
    }

    if (
      !candidate.consumed &&
      candidate.holdingId !== debit.holdingId &&
      (best === undefined || candidate.index < best.index)
    ) {
      best = candidate;
    }
  }

  return best;
};

/**
 * Identify both legs of every INTERNAL transfer (a matched -X / +X pair across
 * two of the user's own holdings) and return their transaction ids as a Set.
 *
 * For each DEBIT (negative amount), in ORIGINAL array order, the first
 * still-unmatched CREDIT (positive amount, same currency and magnitude,
 * different holding, within `TRANSFER_MATCH_WINDOW_MS`) is claimed; matching
 * is greedy and each transaction is consumed at most once, so one credit can
 * never cancel two debits and a lone leg whose partner is absent stays
 * unmatched (and therefore counted). Zero-amount rows are never legs.
 *
 * Credits are grouped by (currency, amount) and time-sorted up front
 * (`buildCreditBuckets`), so each debit's search is a binary-searched slice of
 * its own bucket instead of a scan over the whole ledger — near-linear instead
 * of quadratic in the transaction count, with the same result and the same
 * greedy claim order as the original full-array scan.
 */
export const internalTransferTransactionIds = (
  transactions: InternalTransferTransaction[],
  visitCounter?: CandidateVisitCounter,
): Set<string> => {
  const matchedIds = new Set<string>();
  const creditBuckets = buildCreditBuckets(transactions);

  for (const debit of transactions) {
    if (debit.amountMinorUnits >= 0) {
      continue;
    }

    const bucket =
      creditBuckets.get(creditBucketKey(debit.currency, -debit.amountMinorUnits)) ?? [];
    const match = findMatchingCredit(bucket, debit, visitCounter);

    if (match !== undefined) {
      match.consumed = true;
      matchedIds.add(debit.id);
      matchedIds.add(transactions[match.index].id);
    }
  }

  return matchedIds;
};
