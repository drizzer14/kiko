import { startOfLocalDay } from '@kiko/dates';
import { holdingsRepo } from '@kiko/holdings/repo';
import { holdingValueBreakdown } from '@kiko/holdings/holding-value';
import { EMPTY_PRICE_BOOK, type PriceBook } from '@kiko/prices/price-book';
import { isLedgerlessHoldingType } from '@kiko/holdings/holding-descriptor';

import {
  createHoldingValuer,
  type SeriesHolding,
  type SeriesTransaction,
} from './holding-value-at';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);

// The original, un-optimized single-call implementation `createHoldingValuer`
// replaced (a linear filter/reduce over the whole ledger per call), kept here
// ONLY as the parity oracle — trivially correct by inspection, so comparing
// the optimized implementation against it at many buckets proves the
// per-holding prefix-sum rewrite kept identical output.
const referenceHoldingValueAt = (
  holding: SeriesHolding,
  transactions: SeriesTransaction[],
  t: number,
  book: PriceBook = EMPTY_PRICE_BOOK,
): number => {
  if (isLedgerlessHoldingType(holding.type)) {
    return holdingValueBreakdown(holding, t, book).net.minorUnits;
  }

  const targetDay = startOfLocalDay(t);
  const openingBalance =
    holdingsRepo.balanceOf(holding).minorUnits -
    transactions.reduce((sum, transaction) => sum + transaction.amountMinorUnits, 0);
  const applied = transactions
    .filter((transaction) => startOfLocalDay(transaction.time) <= targetDay)
    .reduce((sum, transaction) => sum + transaction.amountMinorUnits, 0);

  return openingBalance + applied;
};

const cashHolding = (balanceMinorUnits: number): SeriesHolding => ({
  id: 'h1',
  currency: 'UAH',
  type: 'cash',
  balanceMinorUnits,
  metadata: null,
  closedAt: null,
});

const transaction = (dayOffset: number, amountMinorUnits: number): SeriesTransaction => ({
  time: T0 + dayOffset * DAY + 12 * 60 * 60 * 1000,
  amountMinorUnits,
});

/**
 * A row whose OWN `time`/`amountMinorUnits` fields count every read through a
 * shared counter — the guards below prove a bounded read count from OUTSIDE
 * `createHoldingValuer`, on the exact row the production code is handed,
 * rather than trusting an injected work-counter parameter production would
 * otherwise have to carry purely for the tests' benefit.
 */
const countedTransaction = (
  dayOffset: number,
  amountMinorUnits: number,
  readCounter: { reads: number },
): SeriesTransaction => {
  const time = transaction(dayOffset, amountMinorUnits).time;

  return {
    get time() {
      readCounter.reads += 1;

      return time;
    },
    get amountMinorUnits() {
      readCounter.reads += 1;

      return amountMinorUnits;
    },
  };
};

describe('createHoldingValuer', () => {
  it('matches the reference implementation at every bucket for a ledgered holding', () => {
    const holding = cashHolding(10_000_00);
    const transactions = [
      transaction(0, 1_000_00),
      transaction(2, -500_00),
      transaction(2, 200_00),
      transaction(5, 3_000_00),
      transaction(5, -100_00),
      transaction(9, 250_00),
    ];
    const valueAt = createHoldingValuer(holding, transactions);

    for (let day = -2; day <= 12; day += 1) {
      const t = T0 + day * DAY;

      expect(valueAt(t)).toBe(referenceHoldingValueAt(holding, transactions, t));
    }
  });

  it('matches the reference implementation for a holding with no transactions (opening balance only)', () => {
    const holding = cashHolding(5_000_00);
    const valueAt = createHoldingValuer(holding, []);

    expect(valueAt(T0)).toBe(referenceHoldingValueAt(holding, [], T0));
    expect(valueAt(T0 + 30 * DAY)).toBe(referenceHoldingValueAt(holding, [], T0 + 30 * DAY));
  });

  it('collapses several same-day transactions into one prefix-sum step, matching the reference implementation', () => {
    const holding = cashHolding(1_000_00);
    const transactions = [transaction(3, 100_00), transaction(3, -50_00), transaction(3, 25_00)];
    const valueAt = createHoldingValuer(holding, transactions);

    expect(valueAt(T0 + 2 * DAY)).toBe(
      referenceHoldingValueAt(holding, transactions, T0 + 2 * DAY),
    );
    expect(valueAt(T0 + 3 * DAY)).toBe(
      referenceHoldingValueAt(holding, transactions, T0 + 3 * DAY),
    );
    expect(valueAt(T0 + 4 * DAY)).toBe(
      referenceHoldingValueAt(holding, transactions, T0 + 4 * DAY),
    );
  });

  it('delegates a ledgerless holding type straight to holdingValueBreakdown, same as the reference implementation', () => {
    // `metal` is `ledgerless: true` regardless of metadata validity — the
    // point here is only that both functions delegate identically, not what
    // a real metal breakdown looks like.
    const holding: SeriesHolding = {
      id: 'metal1',
      currency: 'UAH',
      type: 'metal',
      balanceMinorUnits: 0,
      metadata: null,
      closedAt: null,
    };
    const valueAt = createHoldingValuer(holding, []);

    expect(valueAt(T0 + 10 * DAY)).toBe(referenceHoldingValueAt(holding, [], T0 + 10 * DAY));
  });

  // A DETERMINISTIC work-count guard, not a wall-clock timing — coverage
  // instrumentation and machine load skew the two timed sides of a speed
  // comparison by different, unpredictable amounts, so a wall-clock ratio is
  // inherently unreliable under Stryker. Counting each read of an
  // INSTRUMENTED input row's own `time`/`amountMinorUnits` — observed from
  // outside `createHoldingValuer`, with no hook of any kind in production —
  // is immune to both, and still catches a regression back to a per-bucket
  // full-ledger re-scan: the one-time setup pass touches each row a bounded
  // number of times regardless of how many buckets are sampled afterward,
  // while a re-scan would touch every row again on every bucket.
  it('reads a near-linear number of row fields as the transaction count grows, for a fixed bucket count', () => {
    const holding = cashHolding(0);
    const buckets = Array.from({ length: 100 }, (_, day) => T0 + day * DAY);

    const rowReadsFor = (transactionCount: number): number => {
      const readCounter = { reads: 0 };
      const transactions = Array.from({ length: transactionCount }, (_, index) =>
        countedTransaction(index % 400, index % 2 === 0 ? 1_000 : -700, readCounter),
      );
      const valueAt = createHoldingValuer(holding, transactions);

      for (const t of buckets) {
        valueAt(t);
      }

      return readCounter.reads;
    };

    const base = rowReadsFor(2_500);
    const doubled = rowReadsFor(5_000);
    const quadrupled = rowReadsFor(10_000);

    expect(doubled).toBeLessThan(base * 3);
    expect(quadrupled).toBeLessThan(doubled * 3);
  });

  it('reads far fewer row fields than the reference implementation, which re-scans every transaction per bucket', () => {
    const holding = cashHolding(0);
    const buckets = Array.from({ length: 100 }, (_, day) => T0 + day * DAY);
    const optimizedReadCounter = { reads: 0 };
    const optimizedTransactions = Array.from({ length: 10_000 }, (_, index) =>
      countedTransaction(index % 400, index % 2 === 0 ? 1_000 : -700, optimizedReadCounter),
    );
    const valueAt = createHoldingValuer(holding, optimizedTransactions);

    for (const t of buckets) {
      valueAt(t);
    }

    const referenceReadCounter = { reads: 0 };
    const referenceTransactions = Array.from({ length: 10_000 }, (_, index) =>
      countedTransaction(index % 400, index % 2 === 0 ? 1_000 : -700, referenceReadCounter),
    );

    for (const t of buckets) {
      referenceHoldingValueAt(holding, referenceTransactions, t);
    }

    expect(optimizedReadCounter.reads).toBeLessThan(referenceReadCounter.reads * 0.05);
  });
});
