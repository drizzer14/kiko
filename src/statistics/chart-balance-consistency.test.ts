// Chart-reactivity invariant guard (audit F3): the by-type bar
// (statistics/type-breakdown) and the account-contribution pie
// (statistics/account-contribution) read each holding's stored BALANCE, never
// the transactions table — so they refresh after a transaction ONLY because the
// same write updates the balance. This guard proves every money-moving writer
// pairs each transaction insert with a matching holding balance update inside
// the one write(...), so a future balance-less writer can never silently desync
// those charts. Modeled on transactions.repo.test.ts's makeExchangeDatabaseTransaction seam.
let mockDatabaseTransaction: unknown;
jest.mock('../db/client', () => {
  const actual = jest.requireActual('../db/client');
  return {
    ...actual,
    write: (work: (db: unknown) => unknown) => work(mockDatabaseTransaction),
  };
});

import { holdings } from '../db/schema';
import { transactionsRepo } from '../transactions/repo/transactions.repo';

// A fake database-transaction handle capturing inserts + balance updates in call order, answering
// both the chained `.where(...).limit(1)` and the bare `await where(...)`
// conventions — same shape as transactions.repo.test.ts's makeExchangeDatabaseTransaction.
const makeDatabaseTransaction = (
  selectQueue: unknown[][],
): {
  databaseTransaction: unknown;
  inserts: Record<string, unknown>[];
  updates: { table: unknown; values: Record<string, unknown> }[];
} => {
  const inserts: Record<string, unknown>[] = [];
  const updates: { table: unknown; values: Record<string, unknown> }[] = [];
  const queue = [...selectQueue];
  const databaseTransaction = {
    select: () => ({
      from: () => ({
        where: () => {
          const rows = queue.shift() ?? [];
          return Object.assign(Promise.resolve(rows), { limit: () => Promise.resolve(rows) });
        },
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        inserts.push(values);
        return Promise.resolve();
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => {
        updates.push({ table, values });
        return { where: () => Promise.resolve() };
      },
    }),
  };

  return { databaseTransaction, inserts, updates };
};

describe('chart balance-consistency invariant', () => {
  it('recordManual pairs its single transaction insert with a holding balance update', async () => {
    const { databaseTransaction, inserts, updates } = makeDatabaseTransaction([
      [{ balanceMinorUnits: 5_000 }],
    ]);
    mockDatabaseTransaction = databaseTransaction;

    await transactionsRepo.recordManual({
      holdingId: 'h-1',
      amountMinorUnits: -1_200,
      time: 1,
      category: 'groceries',
    });

    const balanceUpdates = updates.filter((update) => update.table === holdings);

    expect(inserts).toHaveLength(1);
    expect(balanceUpdates).toHaveLength(1);
    // base 5_000 - 1_200 = 3_800: the insert never lands without its balance move.
    expect(balanceUpdates[0].values).toEqual({ balanceMinorUnits: 3_800 });
  });

  it('recordManualWithReturns pairs EVERY inserted row with its own holding balance update', async () => {
    const { databaseTransaction, inserts, updates } = makeDatabaseTransaction([
      [{ balanceMinorUnits: 50_000 }], // payer read
      [{ balanceMinorUnits: 1_000 }], // return B read
      [{ balanceMinorUnits: 2_000 }], // return C read
    ]);
    mockDatabaseTransaction = databaseTransaction;

    await transactionsRepo.recordManualWithReturns({
      payment: { holdingId: 'payer-1', amountMinorUnits: -21_200, time: 1, category: 'groceries' },
      returns: [
        { holdingId: 'hold-b', amountMinorUnits: 20 },
        { holdingId: 'hold-c', amountMinorUnits: 8 },
      ],
    });

    const balanceUpdates = updates.filter((update) => update.table === holdings);

    // One transaction insert AND one holding balance update per money movement —
    // the payment plus each return. Never an insert without its balance move, so
    // the type/contribution charts (which read balance, not ledger) stay in sync.
    expect(inserts).toHaveLength(3);
    expect(balanceUpdates).toHaveLength(3);
    expect(balanceUpdates.map((update) => update.values)).toEqual([
      { balanceMinorUnits: 28_800 }, // 50_000 - 21_200
      { balanceMinorUnits: 1_020 }, // 1_000 + 20
      { balanceMinorUnits: 2_008 }, // 2_000 + 8
    ]);
  });
});
