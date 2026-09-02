// op-sqlite's open() calls a native module unavailable under Jest; the
// repo modules import ../db/client, which opens the connection at load.
// Mocking open() with a minimal handle lets Drizzle build query builders
// (the unit under test here) without a live native database. Only
// `.toSQL()` shape is asserted, so no execute behavior is needed.
jest.mock('@op-engineering/op-sqlite', () => ({
  open: () => ({ execute: () => ({ rows: [] }) }),
}));

// `updateName` runs its update through the `write` helper (one op-sqlite
// transaction). Override `write` to run the callback against a fake transaction
// handle so the test can capture the update payload issued inside that single
// transaction. The query-builder tests below use `database` directly, which the
// spread of the real module leaves untouched.
let mockTx: unknown;
jest.mock('../db/client', () => {
  const actual = jest.requireActual('../db/client');
  return {
    ...actual,
    write: (work: (db: unknown) => unknown) => work(mockTx),
  };
});

import { holdings } from '../db/schema';
import { holdingsRepo } from './holdings.repo';

// A minimal in-memory fake for the transaction handle `write` hands the repo.
// It keys operations off the drizzle table reference (`holdings`/`transactions`)
// and mutates plain arrays, so the read-modify-write and cascade-delete paths
// can be exercised against real seeded rows without a native database. The
// per-test seed is small (the rows under test), so `.where(...)` clauses need
// not be interpreted — select returns the table's rows and delete clears them.
type Store = {
  holdings: Record<string, unknown>[];
  transactions: Record<string, unknown>[];
};

const makeTx = (store: Store) => {
  const keyOf = (table: unknown): keyof Store => (table === holdings ? 'holdings' : 'transactions');
  return {
    select: () => ({
      from: (table: unknown) => ({
        where: async () => store[keyOf(table)],
      }),
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          store[keyOf(table)] = store[keyOf(table)].map((row) => ({ ...row, ...values }));
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: async () => {
        store[keyOf(table)] = [];
      },
    }),
  };
};

describe('holdingsRepo', () => {
  it('builds a query filtered by account id', () => {
    const { sql, params } = holdingsRepo.listByAccountQuery('acc-1').toSQL();
    expect(sql).toContain('holdings');
    expect(params).toContain('acc-1');
  });

  it('builds an all-holdings query', () => {
    expect(holdingsRepo.allQuery().toSQL().sql).toContain('holdings');
  });

  it('updateName writes the new name for the given holding id', async () => {
    const captured: { set?: Record<string, unknown>; whereCalled: boolean } = {
      whereCalled: false,
    };
    mockTx = {
      update: () => ({
        set: (values: Record<string, unknown>) => {
          captured.set = values;
          return {
            where: () => {
              captured.whereCalled = true;
              return Promise.resolve();
            },
          };
        },
      }),
    };

    await holdingsRepo.updateName('h1', 'Renamed card');

    expect(captured.set).toEqual({ name: 'Renamed card' });
    expect(captured.whereCalled).toBe(true);
  });
});

const depositMeta = {
  contributions: [{ amountMinorUnits: 100000, date: 1000 }],
  annualRatePct: 10,
  termMonths: 12,
  recapitalization: true,
  compounding: 'monthly',
};

describe('appendDepositContribution', () => {
  it('appends a contribution and keeps them sorted by date', async () => {
    const store: Store = {
      holdings: [{ id: 'h1', type: 'term_deposit', metadata: { ...depositMeta } }],
      transactions: [],
    };
    mockTx = makeTx(store);

    await holdingsRepo.appendDepositContribution('h1', { amountMinorUnits: 500, date: 500 });

    expect(store.holdings[0].metadata).toEqual({
      contributions: [
        { amountMinorUnits: 500, date: 500 },
        { amountMinorUnits: 100000, date: 1000 },
      ],
      annualRatePct: 10,
      termMonths: 12,
      recapitalization: true,
      compounding: 'monthly',
    });
  });

  it('rebuilds clean metadata, dropping stale principal/startDate keys', async () => {
    const store: Store = {
      holdings: [
        {
          id: 'h1',
          type: 'term_deposit',
          metadata: { ...depositMeta, principalMinorUnits: 100000, startDate: 1000 },
        },
      ],
      transactions: [],
    };
    mockTx = makeTx(store);

    await holdingsRepo.appendDepositContribution('h1', { amountMinorUnits: 500, date: 2000 });

    expect(store.holdings[0].metadata).not.toHaveProperty('principalMinorUnits');
    expect(store.holdings[0].metadata).not.toHaveProperty('startDate');
  });

  it('refuses a non-deposit holding', async () => {
    const store: Store = {
      holdings: [{ id: 'h1', type: 'card', metadata: null }],
      transactions: [],
    };
    mockTx = makeTx(store);

    await expect(
      holdingsRepo.appendDepositContribution('h1', { amountMinorUnits: 500, date: 500 }),
    ).rejects.toThrow(/not a term deposit/);
    expect(store.holdings[0].metadata).toBeNull();
  });

  it('refuses a contribution with a non-finite date and does not mutate the holding', async () => {
    const store: Store = {
      holdings: [{ id: 'h1', type: 'term_deposit', metadata: { ...depositMeta } }],
      transactions: [],
    };
    mockTx = makeTx(store);

    await expect(
      holdingsRepo.appendDepositContribution('h1', { amountMinorUnits: 500, date: Number.NaN }),
    ).rejects.toThrow(/invalid contribution/);
    expect(store.holdings[0].metadata).toEqual(depositMeta);
  });

  it('refuses a deposit with invalid metadata', async () => {
    const store: Store = {
      holdings: [{ id: 'h1', type: 'term_deposit', metadata: { nonsense: true } }],
      transactions: [],
    };
    mockTx = makeTx(store);

    await expect(
      holdingsRepo.appendDepositContribution('h1', { amountMinorUnits: 500, date: 500 }),
    ).rejects.toThrow(/invalid deposit metadata/);
  });
});

describe('holdings remove', () => {
  it('deletes a manual holding and its transactions in one transaction', async () => {
    const store: Store = {
      holdings: [{ id: 'h1', type: 'card', metadata: null }],
      transactions: [
        { id: 't1', holdingId: 'h1' },
        { id: 't2', holdingId: 'h1' },
      ],
    };
    mockTx = makeTx(store);

    await holdingsRepo.remove('h1');

    expect(store.holdings).toEqual([]);
    expect(store.transactions).toEqual([]);
  });

  it('refuses a synced holding (monobankId in metadata) and leaves the row', async () => {
    const store: Store = {
      holdings: [{ id: 'h1', type: 'card', metadata: { monobankId: 'mono-1' } }],
      transactions: [{ id: 't1', holdingId: 'h1' }],
    };
    mockTx = makeTx(store);

    await expect(holdingsRepo.remove('h1')).rejects.toThrow(/synced holding/);
    expect(store.holdings).toHaveLength(1);
    expect(store.transactions).toHaveLength(1);
  });
});
