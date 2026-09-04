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

import { categoryOverrides, holdings, transactions } from '../db/schema';
import { transactionsRepo } from './transactions.repo';

// Build a fake transaction handle for `update`. `select(...).from(...).where
// (...).limit(...)` resolves the queued rows in call order (first the existing
// transaction row, then the holding balance); each `update(table).set(values)`
// is captured keyed by the schema table object it targeted, so a test can prove
// exactly what was written to `transactions` vs to `holdings`.
const makeUpdateTx = (opts: {
  existing: Record<string, unknown> | null;
  holdingBalance: number;
}): {
  tx: unknown;
  captured: {
    transactionSet?: Record<string, unknown>;
    holdingSet?: Record<string, unknown>;
  };
} => {
  const selectQueue: unknown[][] = [
    opts.existing ? [opts.existing] : [],
    [{ balanceMinorUnits: opts.holdingBalance }],
  ];
  const captured: {
    transactionSet?: Record<string, unknown>;
    holdingSet?: Record<string, unknown>;
  } = {};
  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve(selectQueue.shift() ?? []) }),
      }),
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => {
        if (table === transactions) {
          captured.transactionSet = values;
        } else if (table === holdings) {
          captured.holdingSet = values;
        }

        return { where: () => Promise.resolve() };
      },
    }),
    insert: () => ({ values: () => Promise.resolve() }),
  };

  return { tx, captured };
};

describe('transactionsRepo', () => {
  it('builds a query filtered by holding id', () => {
    const { sql, params } = transactionsRepo.listByHoldingQuery('hold-1').toSQL();
    expect(sql).toContain('transactions');
    expect(params).toContain('hold-1');
  });

  it('builds a single-row query filtered by transaction id', () => {
    const { sql, params } = transactionsRepo.getByIdQuery('txn-1').toSQL();
    expect(sql).toContain('transactions');
    expect(params).toContain('txn-1');
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

  it('updates a manual transaction and moves the balance by the amount delta when it grows', async () => {
    const { tx, captured } = makeUpdateTx({
      existing: { holdingId: 'hold-1', amountMinorUnits: 1000, source: 'manual' },
      holdingBalance: 5000,
    });
    mockTx = tx;

    await transactionsRepo.update({
      transactionId: 'txn-1',
      amountMinorUnits: 3000,
      time: 42,
      description: 'Raise',
    });

    expect(captured.transactionSet).toMatchObject({
      amountMinorUnits: 3000,
      time: 42,
      description: 'Raise',
    });
    // delta = 3000 - 1000 = +2000; base 5000 -> 7000
    expect(captured.holdingSet).toEqual({ balanceMinorUnits: 7000 });
  });

  it('updates a manual transaction and moves the balance by the amount delta when it shrinks', async () => {
    const { tx, captured } = makeUpdateTx({
      existing: { holdingId: 'hold-1', amountMinorUnits: 3000, source: 'manual' },
      holdingBalance: 5000,
    });
    mockTx = tx;

    await transactionsRepo.update({
      transactionId: 'txn-1',
      amountMinorUnits: 1000,
      time: 42,
      description: 'Cut',
    });

    // delta = 1000 - 3000 = -2000; base 5000 -> 3000
    expect(captured.holdingSet).toEqual({ balanceMinorUnits: 3000 });
  });

  it('leaves the balance untouched when only the description changes (amount unchanged)', async () => {
    const { tx, captured } = makeUpdateTx({
      existing: { holdingId: 'hold-1', amountMinorUnits: 1000, source: 'manual' },
      holdingBalance: 5000,
    });
    mockTx = tx;

    await transactionsRepo.update({
      transactionId: 'txn-1',
      amountMinorUnits: 1000,
      time: 99,
      description: 'Renamed',
    });

    // The transaction row still updates its description/time...
    expect(captured.transactionSet).toMatchObject({ description: 'Renamed', time: 99 });
    // ...but a zero delta never touches the holding balance.
    expect(captured.holdingSet).toBeUndefined();
  });

  it('never updates a synced (monobank) transaction and never moves the balance', async () => {
    const { tx, captured } = makeUpdateTx({
      existing: { holdingId: 'hold-1', amountMinorUnits: 1000, source: 'monobank' },
      holdingBalance: 5000,
    });
    mockTx = tx;

    await transactionsRepo.update({
      transactionId: 'txn-1',
      amountMinorUnits: 9999,
      time: 42,
      description: 'Tampered',
    });

    expect(captured.transactionSet).toBeUndefined();
    expect(captured.holdingSet).toBeUndefined();
  });

  it('does nothing when the target transaction does not exist', async () => {
    const { tx, captured } = makeUpdateTx({ existing: null, holdingBalance: 5000 });
    mockTx = tx;

    await transactionsRepo.update({
      transactionId: 'missing',
      amountMinorUnits: 1000,
      time: 42,
      description: 'Ghost',
    });

    expect(captured.transactionSet).toBeUndefined();
    expect(captured.holdingSet).toBeUndefined();
  });
});

// Build a fake transaction handle for `remove`. `select(...).from(...).where(...)`
// resolves queued rows in call order (first the transaction row, then the holding
// row); each `delete(table)` records the table it targeted (so a test can prove
// the transaction row was deleted) and each `update(holdings).set(values)` captures
// the reversed balance written back.
const makeRemoveTx = (opts: {
  transaction: Record<string, unknown> | null;
  holding: Record<string, unknown> | null;
}): {
  tx: unknown;
  captured: { deletedFrom: unknown[]; holdingSet?: Record<string, unknown> };
} => {
  const selectQueue: unknown[][] = [
    opts.transaction ? [opts.transaction] : [],
    opts.holding ? [opts.holding] : [],
  ];
  const captured: { deletedFrom: unknown[]; holdingSet?: Record<string, unknown> } = {
    deletedFrom: [],
  };
  const tx = {
    select: () => ({
      from: () => ({ where: () => Promise.resolve(selectQueue.shift() ?? []) }),
    }),
    delete: (table: unknown) => {
      captured.deletedFrom.push(table);
      return { where: () => Promise.resolve() };
    },
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => {
        if (table === holdings) {
          captured.holdingSet = values;
        }
        return { where: () => Promise.resolve() };
      },
    }),
  };
  return { tx, captured };
};

// Fake tx for addManyDedup: a rule lookup (select->from->where resolving the
// rules) then an insert (values captured, onConflictDoNothing).
const makeAddManyTx = (
  rules: { normalizedName: string; category: string }[],
): {
  tx: unknown;
  captured: { inserted?: Record<string, unknown>[] };
} => {
  const captured: { inserted?: Record<string, unknown>[] } = {};
  const tx = {
    select: () => ({ from: () => ({ where: () => Promise.resolve(rules) }) }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>[]) => {
        if (table !== categoryOverrides) {
          captured.inserted = values;
        }

        return { onConflictDoNothing: () => Promise.resolve() };
      },
    }),
  };

  return { tx, captured };
};

describe('transactionsRepo.addManyDedup category overrides', () => {
  it('applies a matching rule to an incoming synced row at insert time', async () => {
    const { tx, captured } = makeAddManyTx([
      { normalizedName: 'atb market', category: 'groceries' },
    ]);
    mockTx = tx;

    await transactionsRepo.addManyDedup([
      {
        holdingId: 'h1',
        amountMinorUnits: -500,
        time: 1,
        source: 'monobank',
        description: 'ATB Market',
        category: 'Other',
        externalId: 'e1',
      },
      {
        holdingId: 'h1',
        amountMinorUnits: -700,
        time: 2,
        source: 'monobank',
        description: 'Coffee',
        category: 'Dining',
        externalId: 'e2',
      },
    ]);

    const inserted = captured.inserted ?? [];
    expect(inserted[0]).toMatchObject({ description: 'ATB Market', category: 'groceries' });
    // no rule for Coffee — its mapped category is left untouched
    expect(inserted[1]).toMatchObject({ description: 'Coffee', category: 'Dining' });
  });

  it('matches a Cyrillic case-variant name against its rule', async () => {
    const { tx, captured } = makeAddManyTx([{ normalizedName: 'атб', category: 'groceries' }]);
    mockTx = tx;

    await transactionsRepo.addManyDedup([
      {
        holdingId: 'h1',
        amountMinorUnits: -500,
        time: 1,
        source: 'monobank',
        description: 'АТБ',
        category: 'Other',
        externalId: 'e1',
      },
    ]);

    const inserted = captured.inserted ?? [];
    expect(inserted[0]).toMatchObject({ description: 'АТБ', category: 'groceries' });
  });

  it('skips empty-description rows and inserts nothing when the input is empty', async () => {
    const { tx, captured } = makeAddManyTx([]);
    mockTx = tx;

    await transactionsRepo.addManyDedup([]);
    expect(captured.inserted).toBeUndefined();
  });
});

describe('transactionsRepo.remove', () => {
  it('deletes a manual transaction and reverses its balance effect', async () => {
    // Holding balance is 102500 after a +2500 manual top-up; removing the
    // transaction must reverse the effect, restoring 102500 - 2500 = 100000.
    const { tx, captured } = makeRemoveTx({
      transaction: {
        id: 'txn-1',
        holdingId: 'hold-1',
        amountMinorUnits: 2500,
        source: 'manual',
      },
      holding: { id: 'hold-1', balanceMinorUnits: 102500 },
    });
    mockTx = tx;

    await transactionsRepo.remove('txn-1');

    expect(captured.deletedFrom).toContain(transactions);
    expect(captured.holdingSet).toEqual({ balanceMinorUnits: 100000 });
  });

  it('reverses a negative-amount transaction by adding the amount back', async () => {
    const { tx, captured } = makeRemoveTx({
      transaction: {
        id: 'txn-1',
        holdingId: 'hold-1',
        amountMinorUnits: -1000,
        source: 'manual',
      },
      holding: { id: 'hold-1', balanceMinorUnits: 4000 },
    });
    mockTx = tx;

    await transactionsRepo.remove('txn-1');

    // balance - amount = 4000 - (-1000) = 5000
    expect(captured.holdingSet).toEqual({ balanceMinorUnits: 5000 });
  });

  it('refuses a synced (monobank) transaction and leaves it in place', async () => {
    const { tx, captured } = makeRemoveTx({
      transaction: {
        id: 'txn-1',
        holdingId: 'hold-1',
        amountMinorUnits: 2500,
        source: 'monobank',
      },
      holding: { id: 'hold-1', balanceMinorUnits: 102500 },
    });
    mockTx = tx;

    await expect(transactionsRepo.remove('txn-1')).rejects.toThrow(/synced/);
    expect(captured.deletedFrom).toEqual([]);
    expect(captured.holdingSet).toBeUndefined();
  });

  it('does nothing when the target transaction does not exist', async () => {
    const { tx, captured } = makeRemoveTx({ transaction: null, holding: null });
    mockTx = tx;

    await transactionsRepo.remove('missing');

    expect(captured.deletedFrom).toEqual([]);
    expect(captured.holdingSet).toBeUndefined();
  });
});
