// op-sqlite's open() calls a native module unavailable under Jest; the
// repo modules import ../db/client, which opens the connection at load.
// Mocking open() with a minimal handle lets Drizzle build query builders
// (the unit under test here) without a live native database. Only
// `.toSQL()` shape is asserted, so no execute behavior is needed.
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

import { captureSetTx } from './capture-set-tx';
import { holdingsRepo } from './holdings.repo';

// A fake write-transaction handle for the create paths. `create` (and the
// insert branch of `upsertMonobank`) first read the account's current max
// `sort_order` via `select(...).from(holdings).where(...)` (to append at
// `max + 1`), then insert. This answers that max query with `maxSortOrder` and
// captures every insert payload in issue order.
const makeCreateTx = (maxSortOrder = -1): { tx: unknown; inserts: Record<string, unknown>[] } => {
  const inserts: Record<string, unknown>[] = [];
  const tx = {
    select: () => ({ from: () => ({ where: () => Promise.resolve([{ value: maxSortOrder }]) }) }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        inserts.push(values);
        return Promise.resolve();
      },
    }),
  };
  return { tx, inserts };
};

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
  const keyOf = (table: unknown): keyof Store => {
    return table === holdings ? 'holdings' : 'transactions';
  };
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

  it('builds a single-holding query filtered by id', () => {
    const { sql, params } = holdingsRepo.byIdQuery('h1').toSQL();
    expect(sql).toContain('holdings');
    expect(params).toContain('h1');
  });

  it('allQuery orders by sortOrder', () => {
    expect(holdingsRepo.allQuery().toSQL().sql.toLowerCase()).toContain('order by');
    expect(holdingsRepo.allQuery().toSQL().sql).toContain('sort_order');
  });

  it('listByAccountQuery orders by sortOrder', () => {
    const { sql } = holdingsRepo.listByAccountQuery('acc-1').toSQL();
    expect(sql.toLowerCase()).toContain('order by');
    expect(sql).toContain('sort_order');
  });

  it('create inserts the holding and resolves to the generated id', async () => {
    const { tx, inserts } = makeCreateTx();
    mockTx = tx;

    const result = await holdingsRepo.create({
      accountId: 'acc-1',
      name: 'Card',
      type: 'card',
      currency: 'EUR',
    });

    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    expect(result).toBe(inserts[0].id);
  });

  it('create persists the chosen color on the inserted row', async () => {
    const { tx, inserts } = makeCreateTx();
    mockTx = tx;

    await holdingsRepo.create({
      accountId: 'acc-1',
      name: 'Card',
      type: 'card',
      currency: 'EUR',
      color: '#FFD60A',
    });

    expect(inserts[0]).toMatchObject({ color: '#FFD60A' });
  });

  it("create appends the holding at the account's sortOrder = max + 1", async () => {
    const { tx, inserts } = makeCreateTx(1);
    mockTx = tx;

    await holdingsRepo.create({ accountId: 'acc-1', name: 'Card', type: 'card', currency: 'EUR' });

    expect(inserts[0]).toMatchObject({ sortOrder: 2 });
  });

  it("create uses sortOrder 0 for an account's first holding", async () => {
    const { tx, inserts } = makeCreateTx(-1);
    mockTx = tx;

    await holdingsRepo.create({ accountId: 'acc-1', name: 'Card', type: 'card', currency: 'EUR' });

    expect(inserts[0]).toMatchObject({ sortOrder: 0 });
  });

  it('updateName writes the new name for the given holding id', async () => {
    const { captured, tx } = captureSetTx();
    mockTx = tx;

    await holdingsRepo.updateName('h1', 'Renamed card');

    expect(captured.set).toEqual({ name: 'Renamed card' });
    expect(captured.whereCalled).toBe(true);
  });

  it('update writes the given partial patch for the holding id', async () => {
    const { captured, tx } = captureSetTx();
    mockTx = tx;

    await holdingsRepo.update('h1', {
      name: 'Renamed',
      color: '#BF5AF2',
      balanceMinorUnits: 5000,
    });

    expect(captured.set).toEqual({ name: 'Renamed', color: '#BF5AF2', balanceMinorUnits: 5000 });
    expect(captured.whereCalled).toBe(true);
  });

  it('update can clear the color back to null (kind/type default)', async () => {
    const { captured, tx } = captureSetTx();
    mockTx = tx;

    await holdingsRepo.update('h1', { color: null });

    expect(captured.set).toEqual({ color: null });
  });
});

describe('holdingsRepo.reorder', () => {
  it('rewrites each holding sortOrder to its 0-based index in the new order', async () => {
    const sortOrders: unknown[] = [];
    mockTx = {
      update: () => ({
        set: (set: Record<string, unknown>) => ({
          where: () => {
            sortOrders.push(set.sortOrder);
            return Promise.resolve();
          },
        }),
      }),
    };

    await holdingsRepo.reorder(['h3', 'h1', 'h2']);

    expect(sortOrders).toEqual([0, 1, 2]);
  });
});

describe('holdingsRepo.setIcon', () => {
  it('sets the icon for the given holding id', async () => {
    const { captured, tx } = captureSetTx();
    mockTx = tx;

    await holdingsRepo.setIcon('h1', 'star');

    expect(captured.set).toEqual({ icon: 'star' });
    expect(captured.whereCalled).toBe(true);
  });

  it('clears the icon when passed null', async () => {
    const { captured, tx } = captureSetTx();
    mockTx = tx;

    await holdingsRepo.setIcon('h1', null);

    expect(captured.set).toEqual({ icon: null });
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

// A fake write-transaction handle for the metadata-key upserts. The helper
// first selects the matching holding (`select(...).from().where().limit(1)`),
// then — on a miss — reads the account's max `sort_order` (`where()` awaited
// directly) and inserts; on a hit it updates. `selectResults` answers the two
// reads in that order; every insert/update payload is captured.
const makeUpsertTx = (
  matchRows: { id: string }[],
  maxSortOrder = -1,
): { tx: unknown; inserts: Record<string, unknown>[]; updates: Record<string, unknown>[] } => {
  const inserts: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const selectResults: unknown[][] = [matchRows, [{ value: maxSortOrder }]];
  const tx = {
    select: () => ({
      from: () => ({
        where: () => {
          const rows = selectResults.shift() ?? [];
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
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          updates.push(values);
          return Promise.resolve();
        },
      }),
    }),
  };
  return { tx, inserts, updates };
};

describe('holdingsRepo.upsertExchange', () => {
  const walletHolding = {
    accountId: 'acc-crypto',
    name: 'BTC Wallet',
    type: 'crypto_asset' as const,
    currency: 'BTC' as const,
    balanceMinorUnits: 12_345_678,
    metadata: { syncedAt: 1_704_326_400_000 },
    metadataField: 'walletAddress' as const,
    metadataKey: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
  };

  it('updates balance and metadata in place when a holding with the key exists', async () => {
    const { tx, inserts, updates } = makeUpsertTx([{ id: 'h-existing' }]);
    mockTx = tx;

    await holdingsRepo.upsertExchange(walletHolding);

    expect(inserts).toHaveLength(0);
    expect(updates).toEqual([
      {
        balanceMinorUnits: 12_345_678,
        metadata: {
          syncedAt: 1_704_326_400_000,
          walletAddress: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
        },
      },
    ]);
  });

  it('inserts a crypto_asset holding with the key merged into metadata and a fresh sortOrder on a miss', async () => {
    const { tx, inserts, updates } = makeUpsertTx([], 2);
    mockTx = tx;

    await holdingsRepo.upsertExchange(walletHolding);

    expect(updates).toHaveLength(0);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      accountId: 'acc-crypto',
      name: 'BTC Wallet',
      type: 'crypto_asset',
      currency: 'BTC',
      balanceMinorUnits: 12_345_678,
      sortOrder: 3,
      metadata: {
        syncedAt: 1_704_326_400_000,
        walletAddress: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
      },
    });
    expect(typeof inserts[0].id).toBe('string');
  });

  it('keys a Binance holding on binanceAsset', async () => {
    const { tx, inserts } = makeUpsertTx([]);
    mockTx = tx;

    await holdingsRepo.upsertExchange({
      ...walletHolding,
      name: 'Binance BTC',
      metadataField: 'binanceAsset',
      metadataKey: 'BTC',
    });

    expect(inserts[0]).toMatchObject({
      metadata: { binanceAsset: 'BTC', syncedAt: 1_704_326_400_000 },
    });
  });

  it('defaults a missing balance to 0 on update', async () => {
    const { tx, updates } = makeUpsertTx([{ id: 'h-existing' }]);
    mockTx = tx;

    const { balanceMinorUnits: _omitted, ...withoutBalance } = walletHolding;
    await holdingsRepo.upsertExchange(withoutBalance);

    expect(updates[0]).toMatchObject({ balanceMinorUnits: 0 });
  });
});

describe('holdingsRepo.upsertMonobank (via the shared metadata-key helper)', () => {
  const cardHolding = {
    accountId: 'acc-bank',
    name: 'Black card',
    type: 'card' as const,
    currency: 'UAH' as const,
    balanceMinorUnits: 100_000,
    metadata: { iban: 'UA123', maskedPan: ['537541******1234'] },
    monobankId: 'mono-card-1',
  };

  it('updates an existing card in place, merging monobankId into its metadata', async () => {
    const { tx, inserts, updates } = makeUpsertTx([{ id: 'h-card' }]);
    mockTx = tx;

    await holdingsRepo.upsertMonobank(cardHolding);

    expect(inserts).toHaveLength(0);
    expect(updates).toEqual([
      {
        balanceMinorUnits: 100_000,
        metadata: { iban: 'UA123', maskedPan: ['537541******1234'], monobankId: 'mono-card-1' },
      },
    ]);
  });

  it('inserts a new card with monobankId merged and sortOrder = max + 1 on a miss', async () => {
    const { tx, inserts } = makeUpsertTx([], 0);
    mockTx = tx;

    await holdingsRepo.upsertMonobank(cardHolding);

    expect(inserts[0]).toMatchObject({
      type: 'card',
      sortOrder: 1,
      metadata: { iban: 'UA123', maskedPan: ['537541******1234'], monobankId: 'mono-card-1' },
    });
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
