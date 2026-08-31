jest.mock('@op-engineering/op-sqlite', () => ({
  open: () => ({ execute: () => ({ rows: [] }) }),
}));

// `recordManual` runs its insert + balance read + balance update through
// the `write` helper (one op-sqlite transaction). Override `write` to run
// the callback against a fake transaction handle so the test can capture
// what was inserted and what balance was written, proving the read-modify-
// write of the balance happens inside the same unit and uses the DB-read
// base (5000) + amount, not a caller-supplied snapshot.
let mockTx: unknown;
jest.mock('../db/client', () => {
  const actual = jest.requireActual('../db/client');
  return {
    ...actual,
    write: (work: (db: unknown) => unknown) => work(mockTx),
  };
});

import { transactionsRepo } from './transactions.repo';

describe('transactionsRepo', () => {
  it('builds a query filtered by holding id', () => {
    const { sql, params } = transactionsRepo.listByHoldingQuery('hold-1').toSQL();
    expect(sql).toContain('transactions');
    expect(params).toContain('hold-1');
  });

  it('exposes a joined all-transactions query with account and holding labels', () => {
    const query = transactionsRepo.listAllWithContextQuery();
    const sql = query.toSQL().sql.toLowerCase();
    expect(sql).toContain('from "transactions"');
    expect(sql).toContain('join "holdings"');
    expect(sql).toContain('join "accounts"');
    expect(sql).toContain('order by');
  });

  it('records a manual transaction and adjusts the balance atomically', async () => {
    const captured: { insert?: Record<string, unknown>; set?: Record<string, unknown> } = {};
    mockTx = {
      insert: () => ({
        values: (values: Record<string, unknown>) => {
          captured.insert = values;
          return Promise.resolve();
        },
      }),
      select: () => ({
        from: () => ({
          where: () => ({ limit: () => Promise.resolve([{ balanceMinorUnits: 5000 }]) }),
        }),
      }),
      update: () => ({
        set: (values: Record<string, unknown>) => {
          captured.set = values;
          return { where: () => Promise.resolve() };
        },
      }),
    };

    await transactionsRepo.recordManual({
      holdingId: 'hold-1',
      amountMinorUnits: -1000,
      time: 42,
      description: 'Coffee',
    });

    expect(captured.insert).toMatchObject({
      holdingId: 'hold-1',
      amountMinorUnits: -1000,
      time: 42,
      description: 'Coffee',
      source: 'manual',
    });
    // base read inside the tx (5000) + amount (-1000)
    expect(captured.set).toEqual({ balanceMinorUnits: 4000 });
  });
});
