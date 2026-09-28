import { startOfLocalDay } from '@kiko/dates';
import { holdingsRepo } from '@kiko/holdings/repo';
import { holdingValueBreakdown } from '@kiko/holdings/holding-value';
import { EMPTY_PRICE_BOOK, type PriceBook } from '@kiko/prices/price-book';
import { isLedgerlessHoldingType } from '@kiko/holdings/holding-descriptor';

import { createHoldingValuer, type SeriesHolding } from './holding-value-at';
import type { SeriesTransaction, ValuerWorkCounter } from './holding-value-at';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);

const recordVisit = (workCounter: ValuerWorkCounter | undefined): void => {
  if (workCounter) {
    workCounter.rowVisits += 1;
  }
};

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
  workCounter?: ValuerWorkCounter,
): number => {
  if (isLedgerlessHoldingType(holding.type)) {
    return holdingValueBreakdown(holding, t, book).net.minorUnits;
  }

  const targetDay = startOfLocalDay(t);
  const openingBalance =
    holdingsRepo.balanceOf(holding).minorUnits -
    transactions.reduce((sum, transaction) => {
      recordVisit(workCounter);

      return sum + transaction.amountMinorUnits;
    }, 0);
  const applied = transactions
    .filter((transaction) => {
      recordVisit(workCounter);

      return startOfLocalDay(transaction.time) <= targetDay;
    })
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

  // A DETERMINISTIC work-count guard, not a wall-clock timing — coverage
  // instrumentation and machine load skew the two timed sides of a speed
  // comparison by different, unpredictable amounts, so a wall-clock ratio is
  // inherently unreliable under Stryker. Counting each row the valuer
  // actually touches (its one-time setup pass, plus each bucket's
  // binary-search step) is immune to both.
  it('touches a near-linear number of rows as the transaction count grows, for a fixed bucket count', () => {
    const holding = cashHolding(0);
    const buckets = Array.from({ length: 100 }, (_, day) => T0 + day * DAY);

    const rowVisitsFor = (transactionCount: number): number => {
      const workCounter: ValuerWorkCounter = { rowVisits: 0 };
      const transactions = Array.from({ length: transactionCount }, (_, index) =>
        transaction(index % 400, index % 2 === 0 ? 1_000 : -700),
      );
      const valueAt = createHoldingValuer(holding, transactions, EMPTY_PRICE_BOOK, workCounter);

      for (const t of buckets) {
        valueAt(t);
      }

      return workCounter.rowVisits;
    };

    const base = rowVisitsFor(2_500);
    const doubled = rowVisitsFor(5_000);
    const quadrupled = rowVisitsFor(10_000);

    expect(doubled).toBeLessThan(base * 3);
    expect(quadrupled).toBeLessThan(doubled * 3);
  });

  it('touches far fewer rows than the reference implementation, which re-scans every transaction per bucket', () => {
    const holding = cashHolding(0);
    const transactions = Array.from({ length: 10_000 }, (_, index) =>
      transaction(index % 400, index % 2 === 0 ? 1_000 : -700),
    );
    const buckets = Array.from({ length: 100 }, (_, day) => T0 + day * DAY);
    const optimizedWork: ValuerWorkCounter = { rowVisits: 0 };
    const referenceWork: ValuerWorkCounter = { rowVisits: 0 };
    const valueAt = createHoldingValuer(holding, transactions, EMPTY_PRICE_BOOK, optimizedWork);

    for (const t of buckets) {
      valueAt(t);
    }

    for (const t of buckets) {
      referenceHoldingValueAt(holding, transactions, t, EMPTY_PRICE_BOOK, referenceWork);
    }

    expect(optimizedWork.rowVisits).toBeLessThan(referenceWork.rowVisits * 0.05);
  });
});
