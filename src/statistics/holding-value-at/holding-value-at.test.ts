import { startOfLocalDay } from '@kiko/dates';
import { holdingsRepo } from '@kiko/holdings/repo';
import { holdingValueBreakdown } from '@kiko/holdings/holding-value';
import { EMPTY_PRICE_BOOK, type PriceBook } from '@kiko/prices/price-book';
import { isLedgerlessHoldingType } from '@kiko/holdings/holding-descriptor';

import type { SeriesTransaction } from './holding-value-at';
import { createHoldingValuer, type SeriesHolding } from './holding-value-at';

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

  it('is at least 20x faster than the reference implementation across many buckets for one large-ledger holding', () => {
    const holding = cashHolding(0);
    const transactions = Array.from({ length: 5_000 }, (_, index) =>
      transaction(index % 400, index % 2 === 0 ? 1_000 : -700),
    );
    const buckets = Array.from({ length: 400 }, (_, day) => T0 + day * DAY);

    const optimizedStarted = performance.now();
    const valueAt = createHoldingValuer(holding, transactions);

    for (const t of buckets) {
      valueAt(t);
    }
    const optimizedElapsed = performance.now() - optimizedStarted;

    const referenceStarted = performance.now();

    for (const t of buckets) {
      referenceHoldingValueAt(holding, transactions, t);
    }
    const referenceElapsed = performance.now() - referenceStarted;

    // A RELATIVE guard, not a wall-clock SLA — an absolute millisecond budget
    // is only ever as tight as the SLOWEST machine it must tolerate, so it
    // either flakes on a busy one or stops guarding anything on a fast one
    // (the reference implementation itself ran in under the old budget here).
    // The naive per-bucket reduce/filter is O(buckets * transactions); the
    // precompute-once-then-binary-search shape is
    // O(transactions log transactions + buckets log transactions) — at this
    // scale that ratio is dramatic on ANY machine, so asserting it directly
    // catches a regression back to the per-bucket shape regardless of
    // absolute speed.
    expect(optimizedElapsed).toBeLessThan(referenceElapsed / 20);
  });
});
