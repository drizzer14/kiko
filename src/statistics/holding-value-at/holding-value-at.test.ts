import type { SeriesTransaction } from './holding-value-at';
import { createHoldingValuer, holdingValueAt, type SeriesHolding } from './holding-value-at';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);

const cashHolding = (balanceMinorUnits: number): SeriesHolding => ({
  id: 'h1',
  currency: 'UAH',
  type: 'cash',
  balanceMinorUnits,
  metadata: null,
});

const transaction = (dayOffset: number, amountMinorUnits: number): SeriesTransaction => ({
  time: T0 + dayOffset * DAY + 12 * 60 * 60 * 1000,
  amountMinorUnits,
});

describe('createHoldingValuer', () => {
  it('matches holdingValueAt at every bucket for a ledgered holding', () => {
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

      expect(valueAt(t)).toBe(holdingValueAt(holding, transactions, t));
    }
  });

  it('matches holdingValueAt for a holding with no transactions (opening balance only)', () => {
    const holding = cashHolding(5_000_00);
    const valueAt = createHoldingValuer(holding, []);

    expect(valueAt(T0)).toBe(holdingValueAt(holding, [], T0));
    expect(valueAt(T0 + 30 * DAY)).toBe(holdingValueAt(holding, [], T0 + 30 * DAY));
  });

  it('collapses several same-day transactions into one prefix-sum step, matching holdingValueAt', () => {
    const holding = cashHolding(1_000_00);
    const transactions = [transaction(3, 100_00), transaction(3, -50_00), transaction(3, 25_00)];
    const valueAt = createHoldingValuer(holding, transactions);

    expect(valueAt(T0 + 2 * DAY)).toBe(holdingValueAt(holding, transactions, T0 + 2 * DAY));
    expect(valueAt(T0 + 3 * DAY)).toBe(holdingValueAt(holding, transactions, T0 + 3 * DAY));
    expect(valueAt(T0 + 4 * DAY)).toBe(holdingValueAt(holding, transactions, T0 + 4 * DAY));
  });

  it('delegates a ledgerless holding type straight to holdingValueBreakdown, same as holdingValueAt', () => {
    // `metal` is `ledgerless: true` regardless of metadata validity — the
    // point here is only that both functions delegate identically, not what
    // a real metal breakdown looks like.
    const holding: SeriesHolding = {
      id: 'metal1',
      currency: 'UAH',
      type: 'metal',
      balanceMinorUnits: 0,
      metadata: null,
    };
    const valueAt = createHoldingValuer(holding, []);

    expect(valueAt(T0 + 10 * DAY)).toBe(holdingValueAt(holding, [], T0 + 10 * DAY));
  });

  it('stays well within budget across many buckets for one large-ledger holding', () => {
    const holding = cashHolding(0);
    const transactions = Array.from({ length: 5_000 }, (_, index) =>
      transaction(index % 400, index % 2 === 0 ? 1_000 : -700),
    );
    const valueAt = createHoldingValuer(holding, transactions);
    const started = performance.now();

    for (let day = 0; day < 400; day += 1) {
      valueAt(T0 + day * DAY);
    }

    expect(performance.now() - started).toBeLessThan(200);
  });
});
