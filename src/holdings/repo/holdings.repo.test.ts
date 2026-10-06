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
let mockDatabaseTransaction: unknown;
jest.mock('@kiko/db/client', () => {
  const actual = jest.requireActual('@kiko/db/client');

  return {
    ...actual,
    // A jest.fn wrapper (not a bare function): `upsertExchangeMany`'s own test
    // asserts on the CALL COUNT (one `write` per batch, not one per holding),
    // which only a mock function tracks.
    write: jest.fn((work: (db: unknown) => unknown) => work(mockDatabaseTransaction)),
  };
});

import { DAY_MS } from '@kiko/dates';
import maybe, { foldMap } from 'fnts/maybe';
import { Money } from '@kiko/currency/money';
import { accountsRepo } from '@kiko/accounts';
import { createHoldingValuer } from '@kiko/statistics/holding-value-at';
import { captureSetDatabaseTransaction } from '@kiko/db/capture-set-tx';
import { write, accounts, holdings, pricePoints, transactions } from '@kiko/db';

import { holdingsRepo, type LoanPricePointOp } from './holdings.repo';

// The NAME of the schema table an operation targeted. The name, not the drizzle
// table object: a failed `toBe(table)` assertion makes Jest serialize that
// object, which is circular and crashes the worker instead of printing a diff.
const tableNameOf = (table: unknown): string => {
  if (table === holdings) {
    return 'holdings';
  }

  if (table === accounts) {
    return 'accounts';
  }

  return table === pricePoints ? 'price_points' : 'transactions';
};

// A fake write-transaction handle for the create paths. `create` (and the
// insert branch of `upsertMonobank`) first read the account's current max
// `sort_order` via `select(...).from(holdings).where(...)` (to append at
// `max + 1`), then insert. This answers that max query with `maxSortOrder` and
// captures every insert payload in issue order, alongside the name of the table
// each one targeted (index-aligned) — a create with an opening balance writes
// to `holdings` AND `transactions`.
const makeCreateDatabaseTransaction = (
  maxSortOrder = -1,
): { databaseTransaction: unknown; inserts: Record<string, unknown>[]; insertTables: string[] } => {
  const inserts: Record<string, unknown>[] = [];
  const insertTables: string[] = [];
  const databaseTransaction = {
    select: () => ({ from: () => ({ where: () => Promise.resolve([{ value: maxSortOrder }]) }) }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        inserts.push(values);
        insertTables.push(tableNameOf(table));

        return Promise.resolve();
      },
    }),
  };

  return { databaseTransaction, inserts, insertTables };
};

// A minimal in-memory fake for the transaction handle `write` hands the repo.
// It keys operations off the drizzle table reference
// (`accounts`/`holdings`/`transactions`) and mutates plain arrays, so the
// read-modify-write and cascade-delete paths can be exercised against real
// seeded rows without a native database. `remove` reads the holding's ACCOUNT
// row (its `institution` gates `isSyncedHolding`), so the store carries that
// table too. The per-test seed is small (the rows under test), so `.where(...)`
// clauses need not be interpreted — select returns the table's rows and delete
// clears them.
type Store = {
  accounts: Record<string, unknown>[];
  holdings: Record<string, unknown>[];
  transactions: Record<string, unknown>[];
  pricePoints: Record<string, unknown>[];
};

const makeDatabaseTransaction = (store: Store) => {
  const keyOf = (table: unknown): keyof Store => {
    if (table === accounts) {
      return 'accounts';
    }

    if (table === holdings) {
      return 'holdings';
    }

    return table === pricePoints ? 'pricePoints' : 'transactions';
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

  it("balanceOf converts a stored row to Money in the row's own currency", () => {
    const money = holdingsRepo.balanceOf({ currency: 'UAH', balanceMinorUnits: 250_00 });

    expect(money.currency).toBe('UAH');
    expect(money.minorUnits).toBe(250_00);
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

  it('builds a distinct-open-currencies query, excluding closed holdings and archived accounts', () => {
    const { sql } = holdingsRepo.openCurrenciesQuery().toSQL();
    expect(sql.toLowerCase()).toContain('distinct');
    expect(sql).toContain('holdings');
    expect(sql.toLowerCase()).toContain('closed_at');
    expect(sql).toContain('accounts');
    expect(sql.toLowerCase()).toContain('archived_at');
  });

  it('builds a distinct-currencies query over EVERY holding, open and closed, with no join', () => {
    const { sql } = holdingsRepo.historyCurrenciesQuery().toSQL();
    expect(sql.toLowerCase()).toContain('distinct');
    expect(sql).toContain('holdings');
    expect(sql.toLowerCase()).not.toContain('closed_at');
    expect(sql.toLowerCase()).not.toContain('accounts');
  });

  // The loan-payment matcher's own gate query (P-NOWORK): every OPEN loan
  // holding, so a caller can return early — before ever reading the (larger)
  // transaction table — the moment this is empty.
  it('builds an open-loan-holdings query, scoped to type "loan" and excluding closed holdings', () => {
    const { sql, params } = holdingsRepo.loanHoldingsQuery().toSQL();

    expect(sql).toContain('holdings');
    expect(sql.toLowerCase()).toContain('closed_at');
    expect(params).toContain('loan');
  });

  it('create inserts the holding and resolves to the generated id', async () => {
    const { databaseTransaction, inserts } = makeCreateDatabaseTransaction();
    mockDatabaseTransaction = databaseTransaction;

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

  it('create seeds an opening transaction for a non-zero opening balance', async () => {
    const { databaseTransaction, inserts, insertTables } = makeCreateDatabaseTransaction();
    mockDatabaseTransaction = databaseTransaction;

    const holdingId = await holdingsRepo.create({
      accountId: 'acc-1',
      name: 'Wallet',
      type: 'cash',
      currency: 'UAH',
      openingBalance: Money.of('UAH', 250_00),
    });

    // Same rule the cash-account path follows: an opening balance is a manual
    // adjustment, so it gets its own ledger row inside the SAME transaction.
    // Without it `createHoldingValuer` back-derives an opening balance no
    // ledger row explains, and the historical net-worth series carries an
    // unexplained step.
    expect(insertTables).toEqual(['holdings', 'transactions']);
    expect(inserts[1]).toMatchObject({
      holdingId,
      amountMinorUnits: 250_00,
      source: 'manual',
      description: '',
      category: null,
      setsBalance: true,
    });
    expect(typeof inserts[1].time).toBe('number');
    // A non-zero opening balance also stamps the holding's own
    // `balanceSetAt`, at the SAME instant as the ledger row's `time` —
    // `transactionsRepo.importRows`'s boundary reads it directly.
    expect(inserts[0].balanceSetAt).toBe(inserts[1].time);
    expect(inserts[0].balanceSetRowId).toBe(inserts[1].id);
  });

  it('create seeds no transaction for a zero opening balance', async () => {
    const { databaseTransaction, insertTables, inserts } = makeCreateDatabaseTransaction();
    mockDatabaseTransaction = databaseTransaction;

    await holdingsRepo.create({
      accountId: 'acc-1',
      name: 'Wallet',
      type: 'cash',
      currency: 'UAH',
      openingBalance: Money.of('UAH', 0),
    });

    expect(insertTables).toEqual(['holdings']);
    expect(inserts[0].balanceSetAt).toBeNull();
    expect(inserts[0].balanceSetRowId).toBeNull();
  });

  it('create seeds no transaction when no opening balance is given', async () => {
    const { databaseTransaction, insertTables, inserts } = makeCreateDatabaseTransaction();
    mockDatabaseTransaction = databaseTransaction;

    await holdingsRepo.create({ accountId: 'acc-1', name: 'Card', type: 'card', currency: 'EUR' });

    expect(insertTables).toEqual(['holdings']);
    expect(inserts[0].balanceSetAt).toBeNull();
  });

  it('create persists the chosen color on the inserted row', async () => {
    const { databaseTransaction, inserts } = makeCreateDatabaseTransaction();
    mockDatabaseTransaction = databaseTransaction;

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
    const { databaseTransaction, inserts } = makeCreateDatabaseTransaction(1);
    mockDatabaseTransaction = databaseTransaction;

    await holdingsRepo.create({ accountId: 'acc-1', name: 'Card', type: 'card', currency: 'EUR' });

    expect(inserts[0]).toMatchObject({ sortOrder: 2 });
  });

  it("create uses sortOrder 0 for an account's first holding", async () => {
    const { databaseTransaction, inserts } = makeCreateDatabaseTransaction(-1);
    mockDatabaseTransaction = databaseTransaction;

    await holdingsRepo.create({ accountId: 'acc-1', name: 'Card', type: 'card', currency: 'EUR' });

    expect(inserts[0]).toMatchObject({ sortOrder: 0 });
  });

  // A priced holding (property_item) writes its first `manual` price
  // point on `holding:<id>` in the SAME transaction as the insert, so it
  // never reads as "no price yet" the moment it is created.
  it('create writes the first price point in the same transaction, keyed on the new holding id', async () => {
    const { databaseTransaction, inserts, insertTables } = makeCreateDatabaseTransaction();
    mockDatabaseTransaction = databaseTransaction;

    const holdingId = await holdingsRepo.create({
      accountId: 'acc-1',
      name: 'Apartment',
      type: 'property_item',
      currency: 'UAH',
      openingBalance: Money.of('UAH', 0),
      metadata: {
        category: 'real_estate',
        lots: [{ day: 1000, quantityDelta: '1', costMinorUnits: 500000 }],
      },
      firstPricePoint: { day: 1000, price: '5000.00' },
    });

    expect(insertTables).toEqual(['holdings', 'price_points']);
    expect(inserts[1]).toEqual({
      instrument: `holding:${holdingId}`,
      day: 1000,
      price: '5000.00',
      currency: 'UAH',
      source: 'manual',
    });
  });

  it('create writes no price point when firstPricePoint is omitted', async () => {
    const { databaseTransaction, insertTables } = makeCreateDatabaseTransaction();
    mockDatabaseTransaction = databaseTransaction;

    await holdingsRepo.create({ accountId: 'acc-1', name: 'Card', type: 'card', currency: 'EUR' });

    expect(insertTables).toEqual(['holdings']);
  });

  it('create throws when the opening balance currency does not match the holding currency', async () => {
    const { databaseTransaction } = makeCreateDatabaseTransaction();
    mockDatabaseTransaction = databaseTransaction;

    await expect(
      holdingsRepo.create({
        accountId: 'acc-1',
        name: 'Wallet',
        type: 'cash',
        currency: 'UAH',
        openingBalance: Money.of('USD', 100_00),
      }),
    ).rejects.toThrow(/currency/);
  });

  it('create rejects a cash holding in a crypto currency and writes nothing', async () => {
    const { databaseTransaction, insertTables } = makeCreateDatabaseTransaction();
    mockDatabaseTransaction = databaseTransaction;

    await expect(
      holdingsRepo.create({ accountId: 'acc-1', name: 'Wallet', type: 'cash', currency: 'BTC' }),
    ).rejects.toThrow(/cash holding.*BTC/);
    expect(insertTables).toEqual([]);
  });

  it('updateName writes the new name for the given holding id', async () => {
    const { captured, databaseTransaction } = captureSetDatabaseTransaction();
    mockDatabaseTransaction = databaseTransaction;

    await holdingsRepo.updateName('h1', 'Renamed card');

    expect(captured.set).toEqual({ name: 'Renamed card' });
    expect(captured.whereCalled).toBe(true);
  });

  it('update writes the given partial patch for the holding id', async () => {
    const { captured, databaseTransaction } = captureSetDatabaseTransaction();
    mockDatabaseTransaction = databaseTransaction;

    await holdingsRepo.update('h1', {
      name: 'Renamed',
      color: '#BF5AF2',
      balanceMinorUnits: 5000,
    });

    expect(captured.set).toEqual({ name: 'Renamed', color: '#BF5AF2', balanceMinorUnits: 5000 });
    expect(captured.whereCalled).toBe(true);
  });

  it('update can clear the color back to null (kind/type default)', async () => {
    const { captured, databaseTransaction } = captureSetDatabaseTransaction();
    mockDatabaseTransaction = databaseTransaction;

    await holdingsRepo.update('h1', { color: null });

    expect(captured.set).toEqual({ color: null });
  });
});

describe('holdingsRepo.reorder', () => {
  it('rewrites each holding sortOrder to its 0-based index in the new order', async () => {
    const sortOrders: unknown[] = [];
    mockDatabaseTransaction = {
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
    const { captured, databaseTransaction } = captureSetDatabaseTransaction();
    mockDatabaseTransaction = databaseTransaction;

    await holdingsRepo.setIcon('h1', 'star');

    expect(captured.set).toEqual({ icon: 'star' });
    expect(captured.whereCalled).toBe(true);
  });

  it('clears the icon when passed null', async () => {
    const { captured, databaseTransaction } = captureSetDatabaseTransaction();
    mockDatabaseTransaction = databaseTransaction;

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
      accounts: [],
      holdings: [{ id: 'h1', type: 'term_deposit', metadata: { ...depositMeta } }],
      transactions: [],
      pricePoints: [],
    };
    mockDatabaseTransaction = makeDatabaseTransaction(store);

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
      accounts: [],
      holdings: [
        {
          id: 'h1',
          type: 'term_deposit',
          metadata: { ...depositMeta, principalMinorUnits: 100000, startDate: 1000 },
        },
      ],
      transactions: [],
      pricePoints: [],
    };
    mockDatabaseTransaction = makeDatabaseTransaction(store);

    await holdingsRepo.appendDepositContribution('h1', { amountMinorUnits: 500, date: 2000 });

    expect(store.holdings[0].metadata).not.toHaveProperty('principalMinorUnits');
    expect(store.holdings[0].metadata).not.toHaveProperty('startDate');
  });

  it('refuses a non-deposit holding', async () => {
    const store: Store = {
      accounts: [],
      holdings: [{ id: 'h1', type: 'card', metadata: null }],
      transactions: [],
      pricePoints: [],
    };
    mockDatabaseTransaction = makeDatabaseTransaction(store);

    await expect(
      holdingsRepo.appendDepositContribution('h1', { amountMinorUnits: 500, date: 500 }),
    ).rejects.toThrow(/not a term deposit/);
    expect(store.holdings[0].metadata).toBeNull();
  });

  it('refuses a contribution with a non-finite date and does not mutate the holding', async () => {
    const store: Store = {
      accounts: [],
      holdings: [{ id: 'h1', type: 'term_deposit', metadata: { ...depositMeta } }],
      transactions: [],
      pricePoints: [],
    };
    mockDatabaseTransaction = makeDatabaseTransaction(store);

    await expect(
      holdingsRepo.appendDepositContribution('h1', { amountMinorUnits: 500, date: Number.NaN }),
    ).rejects.toThrow(/invalid contribution/);
    expect(store.holdings[0].metadata).toEqual(depositMeta);
  });

  it('refuses a deposit with invalid metadata', async () => {
    const store: Store = {
      accounts: [],
      holdings: [{ id: 'h1', type: 'term_deposit', metadata: { nonsense: true } }],
      transactions: [],
      pricePoints: [],
    };
    mockDatabaseTransaction = makeDatabaseTransaction(store);

    await expect(
      holdingsRepo.appendDepositContribution('h1', { amountMinorUnits: 500, date: 500 }),
    ).rejects.toThrow(/invalid deposit metadata/);
  });
});

describe('ownership change edits', () => {
  const day1 = Date.UTC(2025, 0, 1);
  const day10 = day1 + 9 * DAY_MS;
  const lots = [{ day: day1, quantityDelta: '1', costMinorUnits: 100_000 }];
  const propertyStore = (metadata: Record<string, unknown>): Store => ({
    accounts: [],
    holdings: [{ id: 'h1', type: 'property_item', metadata }],
    transactions: [],
    pricePoints: [],
  });

  it('edits the share and day of one change from the stored row', async () => {
    const store = propertyStore({
      category: 'real_estate',
      lots,
      ownership: [
        { day: day1, numerator: 1, denominator: 2 },
        { day: day10, numerator: 1, denominator: 3 },
      ],
      ownershipInput: 'percent',
    });
    mockDatabaseTransaction = makeDatabaseTransaction(store);

    await holdingsRepo.editOwnershipChange(
      'h1',
      day10,
      { day: day10 + DAY_MS, numerator: 1, denominator: 4 },
      'fraction',
    );

    expect(store.holdings[0].metadata).toEqual({
      category: 'real_estate',
      lots,
      ownership: [
        { day: day1, numerator: 1, denominator: 2 },
        { day: day10 + DAY_MS, numerator: 1, denominator: 4 },
      ],
      ownershipInput: 'fraction',
    });
  });

  it('replaces the change already on the day an edit moves to', async () => {
    const store = propertyStore({
      category: 'vehicle',
      lots,
      ownership: [
        { day: day1, numerator: 1, denominator: 2 },
        { day: day10, numerator: 1, denominator: 3 },
      ],
    });
    mockDatabaseTransaction = makeDatabaseTransaction(store);

    await holdingsRepo.editOwnershipChange(
      'h1',
      day1,
      { day: day10, numerator: 1, denominator: 4 },
      'percent',
    );

    expect(store.holdings[0].metadata).toMatchObject({
      ownership: [{ day: day10, numerator: 1, denominator: 4 }],
    });
  });

  it('removes one change and keeps the input form', async () => {
    const store = propertyStore({
      category: 'real_estate',
      lots,
      ownership: [
        { day: day1, numerator: 1, denominator: 2 },
        { day: day10, numerator: 1, denominator: 3 },
      ],
      ownershipInput: 'fraction',
    });
    mockDatabaseTransaction = makeDatabaseTransaction(store);

    await holdingsRepo.removeOwnershipChange('h1', day10);

    expect(store.holdings[0].metadata).toEqual({
      category: 'real_estate',
      lots,
      ownership: [{ day: day1, numerator: 1, denominator: 2 }],
      ownershipInput: 'fraction',
    });
  });

  it('writes no ownership keys once the last change is removed', async () => {
    const store = propertyStore({
      category: 'real_estate',
      lots,
      ownership: [{ day: day1, numerator: 1, denominator: 2 }],
      ownershipInput: 'percent',
    });
    mockDatabaseTransaction = makeDatabaseTransaction(store);

    await holdingsRepo.removeOwnershipChange('h1', day1);

    expect(store.holdings[0].metadata).toEqual({ category: 'real_estate', lots });
  });

  it('never resurrects a change a stale cached row still shows', async () => {
    // The screen's cached row still lists a change on day 10 that another
    // write already deleted; a delete passes only the day key.
    const day20 = day1 + 19 * DAY_MS;
    const store = propertyStore({
      category: 'real_estate',
      lots,
      ownership: [
        { day: day1, numerator: 1, denominator: 2 },
        { day: day20, numerator: 1, denominator: 4 },
      ],
      ownershipInput: 'percent',
    });
    mockDatabaseTransaction = makeDatabaseTransaction(store);

    await holdingsRepo.removeOwnershipChange('h1', day1);

    expect(store.holdings[0].metadata).toMatchObject({
      ownership: [{ day: day20, numerator: 1, denominator: 4 }],
    });
  });

  it('refuses a holding that is not a property', async () => {
    const store: Store = {
      accounts: [],
      holdings: [{ id: 'h1', type: 'card', metadata: null }],
      transactions: [],
      pricePoints: [],
    };
    mockDatabaseTransaction = makeDatabaseTransaction(store);

    await expect(holdingsRepo.removeOwnershipChange('h1', day1)).rejects.toThrow(/not a property/);
    expect(store.holdings[0].metadata).toBeNull();
  });

  it('refuses a property with invalid metadata', async () => {
    const store = propertyStore({ nonsense: true });
    mockDatabaseTransaction = makeDatabaseTransaction(store);

    await expect(
      holdingsRepo.editOwnershipChange(
        'h1',
        day1,
        { day: day1, numerator: 1, denominator: 2 },
        'percent',
      ),
    ).rejects.toThrow(/invalid property metadata/);
    expect(store.holdings[0].metadata).toEqual({ nonsense: true });
  });
});

// A fake write-transaction handle for the metadata-key upserts. The helper
// first selects the matching holding (`select(...).from().where().limit(1)`),
// then — on a miss — reads the account's max `sort_order` (`where()` awaited
// directly) and inserts; on a hit it updates. `selectResults` answers the two
// reads in that order; every insert/update payload is captured.
const makeUpsertDatabaseTransaction = (
  matchRows: { id: string; name?: string }[],
  maxSortOrder = -1,
): {
  databaseTransaction: unknown;
  inserts: Record<string, unknown>[];
  updates: Record<string, unknown>[];
} => {
  const inserts: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const selectResults: unknown[][] = [matchRows, [{ value: maxSortOrder }]];
  const databaseTransaction = {
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

  return { databaseTransaction, inserts, updates };
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
    const { databaseTransaction, inserts, updates } = makeUpsertDatabaseTransaction([
      { id: 'h-existing' },
    ]);
    mockDatabaseTransaction = databaseTransaction;

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
    const { databaseTransaction, inserts, updates } = makeUpsertDatabaseTransaction([], 2);
    mockDatabaseTransaction = databaseTransaction;

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
    const { databaseTransaction, inserts } = makeUpsertDatabaseTransaction([]);
    mockDatabaseTransaction = databaseTransaction;

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
    const { databaseTransaction, updates } = makeUpsertDatabaseTransaction([{ id: 'h-existing' }]);
    mockDatabaseTransaction = databaseTransaction;

    const { balanceMinorUnits: _omitted, ...withoutBalance } = walletHolding;
    await holdingsRepo.upsertExchange(withoutBalance);

    expect(updates[0]).toMatchObject({ balanceMinorUnits: 0 });
  });

  // The one-time transition rename: when `renameFromDefault` is set and the
  // matched holding's name STILL equals that old default, the update rewrites
  // the name; a user-edited name never matches and is left untouched.
  it('renames a matched holding whose name is still the old default', async () => {
    const { databaseTransaction, updates } = makeUpsertDatabaseTransaction([
      { id: 'h-legacy', name: 'Binance BTC' },
    ]);
    mockDatabaseTransaction = databaseTransaction;

    await holdingsRepo.upsertExchange({
      ...walletHolding,
      name: 'Binance Spot',
      metadataField: 'binanceAsset',
      metadataKey: 'BTC',
      renameFromDefault: 'Binance BTC',
    });

    expect(updates[0]).toMatchObject({ name: 'Binance Spot' });
  });

  it('preserves a user-edited name even when renameFromDefault is set', async () => {
    const { databaseTransaction, updates } = makeUpsertDatabaseTransaction([
      { id: 'h-legacy', name: 'My Binance stack' },
    ]);
    mockDatabaseTransaction = databaseTransaction;

    await holdingsRepo.upsertExchange({
      ...walletHolding,
      name: 'Binance Spot',
      metadataField: 'binanceAsset',
      metadataKey: 'BTC',
      renameFromDefault: 'Binance BTC',
    });

    expect(updates[0]).not.toHaveProperty('name');
  });
});

describe('holdingsRepo.upsertExchangeMany', () => {
  const balanceHolding = (metadataKey: string) => ({
    accountId: 'acc-crypto',
    name: 'BTC Wallet',
    type: 'crypto_asset' as const,
    currency: 'BTC' as const,
    balanceMinorUnits: 1,
    metadata: { syncedAt: 1_704_326_400_000 },
    metadataField: 'walletAddress' as const,
    metadataKey,
  });

  // Calling `upsertExchange` once per returned balance would cost
  // N separate op-sqlite transactions in one run. `upsertExchangeMany` mirrors
  // `upsertMonobankMany`: every balance upserts inside ONE transaction, so the
  // reactive `holdings` callback fires once per sync, not once per balance.
  it('upserts every balance in ONE write transaction, not one per balance', async () => {
    (write as jest.Mock).mockClear();
    const updates: Record<string, unknown>[] = [];
    const databaseTransaction = {
      select: () => ({
        from: () => ({
          where: () => {
            const rows = [{ id: 'h-existing' }];

            return Object.assign(Promise.resolve(rows), { limit: () => Promise.resolve(rows) });
          },
        }),
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
    mockDatabaseTransaction = databaseTransaction;

    await holdingsRepo.upsertExchangeMany([balanceHolding('addr-1'), balanceHolding('addr-2')]);

    expect(write).toHaveBeenCalledTimes(1);
    expect(updates).toHaveLength(2);
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
    const { databaseTransaction, inserts, updates } = makeUpsertDatabaseTransaction([
      { id: 'h-card' },
    ]);
    mockDatabaseTransaction = databaseTransaction;

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
    const { databaseTransaction, inserts } = makeUpsertDatabaseTransaction([], 0);
    mockDatabaseTransaction = databaseTransaction;

    await holdingsRepo.upsertMonobank(cardHolding);

    expect(inserts[0]).toMatchObject({
      type: 'card',
      sortOrder: 1,
      metadata: { iban: 'UA123', maskedPan: ['537541******1234'], monobankId: 'mono-card-1' },
    });
  });
});

describe('holdingsRepo.resetBinanceHistoryCursor', () => {
  it('resets binanceHistoryCursor to the given floor on holdings that have it, and leaves every other metadata key untouched', async () => {
    const rows = [
      {
        id: 'h-spot',
        metadata: { binanceAsset: 'BTC', binanceHistoryCursor: 1_000, syncedAt: 500 },
      },
      { id: 'h-funding', metadata: { binanceAsset: 'BTC:funding', syncedAt: 500 } },
    ];
    const updates: Record<string, unknown>[] = [];
    mockDatabaseTransaction = {
      select: () => ({
        from: () => ({
          where: async () => rows,
        }),
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

    await holdingsRepo.resetBinanceHistoryCursor('acc-1', 100);

    // Only the holding that actually carried the key is written, to the floor.
    expect(updates).toEqual([
      { metadata: { binanceAsset: 'BTC', binanceHistoryCursor: 100, syncedAt: 500 } },
    ]);
  });

  it('writes nothing when no holding under the account carries the key', async () => {
    const update = jest.fn();
    mockDatabaseTransaction = {
      select: () => ({
        from: () => ({
          where: async () => [{ id: 'h-wallet', metadata: { walletAddress: 'bc1q' } }],
        }),
      }),
      update,
    };

    await holdingsRepo.resetBinanceHistoryCursor('acc-1', 100);

    expect(update).not.toHaveBeenCalled();
  });
});

describe('holdingsRepo.setBinanceHistoryCursor', () => {
  // The write joins `accounts` to gate on `institution = 'binance'` (a walk
  // holds the account's credentials for its whole run, so a disconnect
  // can commit while it is still in flight) — the fake transaction below
  // chains `.innerJoin` between `.from` and `.where`, mirroring the real query.
  const makeJoinedTransaction = (
    row: { metadata: unknown; institution: string | null } | undefined,
  ): { transaction: unknown; updates: Record<string, unknown>[] } => {
    const updates: Record<string, unknown>[] = [];
    const transaction = {
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            where: async () => foldMap(maybe(row), (value) => [value]) ?? [],
          }),
        }),
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

    return { transaction, updates };
  };

  it('merges the cursor into the stored metadata, preserving every other key, for a still-connected Binance account', async () => {
    const { transaction, updates } = makeJoinedTransaction({
      metadata: { binanceAsset: 'BTC', syncedAt: 500 },
      institution: 'binance',
    });
    mockDatabaseTransaction = transaction;

    await holdingsRepo.setBinanceHistoryCursor('h-spot', 1_704_326_400_000);

    expect(updates).toEqual([
      { metadata: { binanceAsset: 'BTC', syncedAt: 500, binanceHistoryCursor: 1_704_326_400_000 } },
    ]);
  });

  it('writes the cursor alone when the holding had no metadata yet', async () => {
    const { transaction, updates } = makeJoinedTransaction({
      metadata: null,
      institution: 'binance',
    });
    mockDatabaseTransaction = transaction;

    await holdingsRepo.setBinanceHistoryCursor('h-spot', 1_000);

    expect(updates).toEqual([{ metadata: { binanceHistoryCursor: 1_000 } }]);
  });

  it('is a no-op when the holding’s account is no longer connected to Binance', async () => {
    const { transaction, updates } = makeJoinedTransaction({
      metadata: { binanceAsset: 'BTC', syncedAt: 500 },
      institution: null,
    });
    mockDatabaseTransaction = transaction;

    await holdingsRepo.setBinanceHistoryCursor('h-spot', 1_000);

    expect(updates).toEqual([]);
  });

  it('is a no-op when the holding no longer exists', async () => {
    const { transaction, updates } = makeJoinedTransaction(undefined);
    mockDatabaseTransaction = transaction;

    await holdingsRepo.setBinanceHistoryCursor('h-spot', 1_000);

    expect(updates).toEqual([]);
  });
});

// A shared in-memory store fake spanning BOTH repos, so one test can run the
// real `accountsRepo.disconnect` and the real `holdingsRepo.upsertMonobank`
// against the same rows. Only the upsert's match query
// (`accountId = ? AND json_extract(metadata, '$.<field>') = ?` LIMIT 1) has
// semantics this test depends on, so `.limit(1)` resolves the rows a `matches`
// predicate mirroring exactly that clause selects; a plain awaited
// `.where(...)` (the holdings read in `disconnect`, and the `max(sort_order)`
// probe, which finds no `value` column here and so appends at 0) resolves the
// table's rows. A single holding is seeded, so update `.where(...)` clauses
// need not be interpreted either.
const makeSharedDatabaseTransaction = (
  store: Store,
  matches: (row: Record<string, unknown>) => boolean,
) => {
  const keyOf = (table: unknown): keyof Store => (table === accounts ? 'accounts' : 'holdings');

  return {
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          const rows = store[keyOf(table)];

          return Object.assign(Promise.resolve(rows), {
            limit: () => Promise.resolve(store.holdings.filter(matches)),
          });
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: async (values: Record<string, unknown>) => {
        store[keyOf(table)].push(values);
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          store[keyOf(table)] = store[keyOf(table)].map((row) => ({ ...row, ...values }));
        },
      }),
    }),
  };
};

describe('disconnect then reconnect', () => {
  const metadataOf = (row: Record<string, unknown>): Record<string, unknown> =>
    (row.metadata ?? {}) as Record<string, unknown>;

  it('re-adopts the same holding instead of inserting a duplicate', async () => {
    const store: Store = {
      accounts: [{ id: 'acc-1', institution: 'monobank' }],
      holdings: [],
      transactions: [],
      pricePoints: [],
    };
    mockDatabaseTransaction = makeSharedDatabaseTransaction(
      store,
      (row) => row.accountId === 'acc-1' && metadataOf(row).monobankId === 'mono-1',
    );

    const sync = () =>
      holdingsRepo.upsertMonobank({
        accountId: 'acc-1',
        name: '1234',
        type: 'card',
        currency: 'UAH',
        balanceMinorUnits: 500_00,
        monobankId: 'mono-1',
      });

    await sync();
    await accountsRepo.disconnect('acc-1');
    await sync();

    // One row, one balance: the sync key survives a disconnect, because
    // stripping it would make the second sync miss and insert a SECOND holding
    // carrying the same balance, double-counting net worth.
    expect(store.holdings).toHaveLength(1);
    expect(store.holdings[0]).toMatchObject({
      balanceMinorUnits: 500_00,
      metadata: { monobankId: 'mono-1' },
    });
  });
});

// A fake write-transaction handle for `updateWithBalanceDelta`. The repo reads
// the STORED balance inside the transaction (`select(...).where(...).limit(1)`),
// writes the patch, and inserts a ledger row only for a non-zero balance delta —
// this captures all three, so a test can prove exactly what each write carried.
// `stored` is the holding row that read resolves to, or `null` for a missing id.
// An update of `transactions` is captured apart from the holding's own
// `.set(...)`, in issue order.
type BalanceDeltaCapture = {
  holdingSet?: Record<string, unknown>;
  transactionSets: Record<string, unknown>[];
  inserts: Record<string, unknown>[];
};

const makeBalanceDeltaDatabaseTransaction = (
  stored: Record<string, unknown> | null,
): { databaseTransaction: unknown; captured: BalanceDeltaCapture } => {
  const captured: BalanceDeltaCapture = { transactionSets: [], inserts: [] };
  const databaseTransaction = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(foldMap(maybe(stored), (row) => [row]) ?? []),
        }),
      }),
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => {
        if (table === transactions) {
          captured.transactionSets.push(values);
        } else {
          captured.holdingSet = values;
        }

        return { where: () => Promise.resolve() };
      },
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        captured.inserts.push(values);

        return Promise.resolve();
      },
    }),
  };

  return { databaseTransaction, captured };
};

describe('holdingsRepo.updateMetadataFromStored', () => {
  it('builds the metadata from the row stored at the time of the write', async () => {
    const stored = { couponPct: 4.5, payments: [] };
    const store: Store = {
      accounts: [],
      holdings: [{ id: 'h1', type: 'bond', name: 'Old', color: null, metadata: stored }],
      transactions: [],
      pricePoints: [],
    };
    mockDatabaseTransaction = makeDatabaseTransaction(store);
    const buildMetadata = jest.fn(() => ({ couponPct: 6 }));

    await holdingsRepo.updateMetadataFromStored(
      'h1',
      { name: 'New', color: '#FF0000' },
      buildMetadata,
    );

    expect(buildMetadata).toHaveBeenCalledWith(stored);
    expect(store.holdings[0]).toMatchObject({
      name: 'New',
      color: '#FF0000',
      metadata: { couponPct: 6 },
    });
    expect(store.transactions).toEqual([]);
  });
});

describe('holdingsRepo.updateWithBalanceDelta', () => {
  it('writes the balance difference as a manual transaction', async () => {
    const { databaseTransaction, captured } = makeBalanceDeltaDatabaseTransaction({
      currency: 'UAH',
      balanceMinorUnits: 100_00,
    });
    mockDatabaseTransaction = databaseTransaction;

    await holdingsRepo.updateWithBalanceDelta(
      'h-1',
      { balance: Money.of('UAH', 500_00) },
      1_700_000_000_000,
    );

    // A non-zero delta also stamps `balanceSetAt` at this edit's own
    // `time`, in the SAME `.set(...)` as the balance patch.
    expect(captured.holdingSet).toEqual({
      balanceMinorUnits: 500_00,
      balanceSetAt: 1_700_000_000_000,
      balanceSetRowId: captured.inserts[0]?.id,
    });
    expect(captured.inserts).toHaveLength(1);
    expect(captured.inserts[0]).toMatchObject({
      holdingId: 'h-1',
      // The DIFFERENCE against the STORED balance (read inside this same
      // transaction), never the absolute new balance.
      amountMinorUnits: 400_00,
      source: 'manual',
      time: 1_700_000_000_000,
    });
  });

  // An earlier set's row keeps its mark: its amount is part of a balance that
  // was set, so its re-date or delete must never move the balance either.
  it('marks the new adjustment row as the current set, and leaves earlier marks', async () => {
    const { databaseTransaction, captured } = makeBalanceDeltaDatabaseTransaction({
      currency: 'UAH',
      balanceMinorUnits: 100_00,
    });
    mockDatabaseTransaction = databaseTransaction;

    await holdingsRepo.updateWithBalanceDelta('h-1', { balance: Money.of('UAH', 500_00) }, 1);

    expect(captured.transactionSets).toEqual([]);
    expect(captured.inserts[0]).toMatchObject({ setsBalance: true });
    expect(captured.holdingSet).toMatchObject({ balanceSetRowId: captured.inserts[0]?.id });
  });

  it('leaves the adjustment row unlabelled and uncategorised', async () => {
    const { databaseTransaction, captured } = makeBalanceDeltaDatabaseTransaction({
      currency: 'UAH',
      balanceMinorUnits: 100_00,
    });
    mockDatabaseTransaction = databaseTransaction;

    await holdingsRepo.updateWithBalanceDelta('h-1', { balance: Money.of('UAH', 500_00) }, 1);

    // No persisted sentence: the list resolves this row's label at render time
    // through `t` (transactions/row-description.ts), so it follows a language
    // switch and a holding rename. No category either — the user owns that.
    expect(captured.inserts[0]).toMatchObject({ description: '', category: null });
  });

  it('writes a negative delta for a decrease', async () => {
    const { databaseTransaction, captured } = makeBalanceDeltaDatabaseTransaction({
      currency: 'UAH',
      balanceMinorUnits: 500_00,
    });
    mockDatabaseTransaction = databaseTransaction;

    await holdingsRepo.updateWithBalanceDelta('h-1', { balance: Money.of('UAH', 100_00) }, 1);

    expect(captured.inserts[0]).toMatchObject({ amountMinorUnits: -400_00 });
    expect(captured.holdingSet).toEqual({
      balanceMinorUnits: 100_00,
      balanceSetAt: 1,
      balanceSetRowId: captured.inserts[0]?.id,
    });
  });

  it('writes no transaction for a name-only edit', async () => {
    const { databaseTransaction, captured } = makeBalanceDeltaDatabaseTransaction({
      currency: 'UAH',
      balanceMinorUnits: 100_00,
    });
    mockDatabaseTransaction = databaseTransaction;

    await holdingsRepo.updateWithBalanceDelta('h-1', { name: 'Renamed' }, 1);

    expect(captured.inserts).toHaveLength(0);
    expect(captured.holdingSet).toEqual({ name: 'Renamed' });
  });

  it('writes no transaction for a zero delta, and does not stamp balanceSetAt', async () => {
    const { databaseTransaction, captured } = makeBalanceDeltaDatabaseTransaction({
      currency: 'UAH',
      balanceMinorUnits: 100_00,
    });
    mockDatabaseTransaction = databaseTransaction;

    await holdingsRepo.updateWithBalanceDelta('h-1', { balance: Money.of('UAH', 100_00) }, 1);

    expect(captured.inserts).toHaveLength(0);
    expect(captured.transactionSets).toEqual([]);
    expect(captured.holdingSet).toEqual({ balanceMinorUnits: 100_00 });
  });

  it('writes no transaction when no holding carries the id', async () => {
    const { databaseTransaction, captured } = makeBalanceDeltaDatabaseTransaction(null);
    mockDatabaseTransaction = databaseTransaction;

    await holdingsRepo.updateWithBalanceDelta('missing', { balance: Money.of('UAH', 500_00) }, 1);

    expect(captured.inserts).toHaveLength(0);
  });

  // The throw guards a caller bug (a Money built in the wrong currency) before
  // it can silently mislabel a delta; it never fires for a valid caller, which
  // always builds the patch's `balance` in the holding's own (locked, in the
  // form) currency.
  it('throws when the balance currency does not match the holding currency', async () => {
    const { databaseTransaction } = makeBalanceDeltaDatabaseTransaction({
      currency: 'UAH',
      balanceMinorUnits: 100_00,
    });
    mockDatabaseTransaction = databaseTransaction;

    await expect(
      holdingsRepo.updateWithBalanceDelta('h-1', { balance: Money.of('USD', 100_00) }, 1),
    ).rejects.toThrow(/currency/);
  });

  // The regression this function exists to prevent: `createHoldingValuer`
  // back-derives the opening balance as `currentBalance - sum(transactions)`,
  // so a bare balance write shifted every PAST point of the net-worth series
  // by the delta. With the delta on the ledger, the past is unchanged and
  // only the edit instant moves. `createHoldingValuer` applies transactions
  // by LOCAL DAY (to match the local-midnight daily buckets), so the edit and
  // the past point it must not shift are dated on DIFFERENT calendar days
  // here — a same-day pair would (by design) land in the same bucket.
  it('leaves the reconstructed history unshifted after a balance edit', async () => {
    const base = Date.UTC(2026, 0, 1);
    const pastDay = base + DAY_MS; // the earlier point the edit must not shift
    const editDay = base + 2 * DAY_MS; // the edit lands a later calendar day
    const holding = {
      id: 'h-1',
      currency: 'UAH',
      type: 'cash',
      balanceMinorUnits: 100_00,
      metadata: null,
      closedAt: null,
    } as const;
    const earlier = { time: base, amountMinorUnits: 10_00 };
    const before = createHoldingValuer(holding, [earlier])(pastDay);
    const { databaseTransaction, captured } = makeBalanceDeltaDatabaseTransaction({
      currency: holding.currency,
      balanceMinorUnits: holding.balanceMinorUnits,
    });
    mockDatabaseTransaction = databaseTransaction;

    await holdingsRepo.updateWithBalanceDelta('h-1', { balance: Money.of('UAH', 500_00) }, editDay);

    const edited = {
      ...holding,
      balanceMinorUnits: captured.holdingSet?.balanceMinorUnits as number,
    };
    const ledger = [
      earlier,
      { time: editDay, amountMinorUnits: captured.inserts[0].amountMinorUnits as number },
    ];

    expect(createHoldingValuer(edited, ledger)(pastDay)).toBe(before);
    expect(createHoldingValuer(edited, ledger)(editDay)).toBe(500_00);
  });
});

describe('holdingsRepo.setSyncedBalance', () => {
  // A fake write-transaction handle for `setSyncedBalance`: it reads the
  // holding's own stored currency (to guard against a mismatched `Money`,
  // mirroring `updateWithBalanceDelta`), then writes the crash-safe marker.
  // `stored` is what that read resolves to, or `null` for a missing id.
  const makeSetSyncedBalanceDatabaseTransaction = (
    stored: { currency: string } | null,
  ): {
    databaseTransaction: unknown;
    captured: { set?: Record<string, unknown> };
  } => {
    const captured: { set?: Record<string, unknown> } = {};
    const databaseTransaction = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve(foldMap(maybe(stored), (row) => [row]) ?? []),
          }),
        }),
      }),
      update: () => ({
        set: (values: Record<string, unknown>) => {
          captured.set = values;

          return { where: () => Promise.resolve() };
        },
      }),
    };

    return { databaseTransaction, captured };
  };

  it("advances the crash-safe marker to the given Money's minor units", async () => {
    const { databaseTransaction, captured } = makeSetSyncedBalanceDatabaseTransaction({
      currency: 'UAH',
    });
    mockDatabaseTransaction = databaseTransaction;

    await holdingsRepo.setSyncedBalance('h-1', Money.of('UAH', 500_00));

    expect(captured.set).toEqual({ syncedBalanceMinorUnits: 500_00 });
  });

  // Never fires for a valid caller — every real caller (the Monobank sync)
  // builds the balance in the holding's own currency.
  it('throws when the balance currency does not match the holding currency', async () => {
    const { databaseTransaction } = makeSetSyncedBalanceDatabaseTransaction({ currency: 'UAH' });
    mockDatabaseTransaction = databaseTransaction;

    await expect(holdingsRepo.setSyncedBalance('h-1', Money.of('USD', 500_00))).rejects.toThrow(
      /currency/,
    );
  });

  it('writes through when no holding is found for the id', async () => {
    const { databaseTransaction, captured } = makeSetSyncedBalanceDatabaseTransaction(null);
    mockDatabaseTransaction = databaseTransaction;

    await holdingsRepo.setSyncedBalance('missing', Money.of('UAH', 500_00));

    expect(captured.set).toEqual({ syncedBalanceMinorUnits: 500_00 });
  });
});

describe('holdingsRepo.closeMany', () => {
  it('stamps closedAt on the given holdings in one write', async () => {
    const { captured, databaseTransaction } = captureSetDatabaseTransaction();
    mockDatabaseTransaction = databaseTransaction;

    await holdingsRepo.closeMany(['h1', 'h2']);

    // The write sets `closedAt` (to the current time via SQL) and scopes with a
    // where clause, so only the passed ids are closed.
    expect(Object.keys(captured.set ?? {})).toEqual(['closedAt']);
    expect(captured.whereCalled).toBe(true);
  });

  it('writes nothing for an empty id set', async () => {
    const update = jest.fn();
    mockDatabaseTransaction = { update };

    await holdingsRepo.closeMany([]);

    expect(update).not.toHaveBeenCalled();
  });
});

// A fake write-transaction handle for `updateLoan`. Captures the metadata
// patch, the item-1 auto-links clear (a SECOND, table-distinguished
// `update` call — `tableNameOf` tells it apart from the metadata patch's own
// `update(holdings)`), whether `delete(pricePoints)` ran, and every
// `insert(pricePoints)` payload — enough to prove the three `LoanPricePointOp`
// kinds each touch exactly the tables each op promises, all inside the SAME
// transaction (`mockDatabaseTransaction` is shared by every call the
// function makes).
const makeUpdateLoanDatabaseTransaction = (): {
  databaseTransaction: unknown;
  captured: {
    holdingSet?: Record<string, unknown>;
    transactionsSet?: Record<string, unknown>;
    deleteCalls: number;
    inserts: Record<string, unknown>[];
  };
} => {
  const captured: {
    holdingSet?: Record<string, unknown>;
    transactionsSet?: Record<string, unknown>;
    deleteCalls: number;
    inserts: Record<string, unknown>[];
  } = { deleteCalls: 0, inserts: [] };
  const databaseTransaction = {
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => {
        if (tableNameOf(table) === 'transactions') {
          captured.transactionsSet = values;
        } else {
          captured.holdingSet = values;
        }

        return { where: () => Promise.resolve() };
      },
    }),
    delete: () => ({
      where: () => {
        captured.deleteCalls += 1;

        return Promise.resolve();
      },
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoUpdate: () => {
          captured.inserts.push(values);

          return Promise.resolve();
        },
      }),
    }),
  };

  return { databaseTransaction, captured };
};

describe('holdingsRepo.updateLoan', () => {
  it("writes only the metadata patch for a 'none' op — no price-point write", async () => {
    const { databaseTransaction, captured } = makeUpdateLoanDatabaseTransaction();
    mockDatabaseTransaction = databaseTransaction;

    await holdingsRepo.updateLoan('h-1', { name: 'Renamed' }, { kind: 'none' });

    expect(captured.holdingSet).toEqual({ name: 'Renamed' });
    expect(captured.deleteCalls).toBe(0);
    expect(captured.inserts).toHaveLength(0);
  });

  // Annuity/differentiated -> 'none' upserts today's outstanding so
  // the debt never silently reads as 0.
  it("(a) upserts a point for an 'upsert' op, with no delete", async () => {
    const { databaseTransaction, captured } = makeUpdateLoanDatabaseTransaction();
    mockDatabaseTransaction = databaseTransaction;
    const op: LoanPricePointOp = {
      kind: 'upsert',
      day: 19_000,
      price: '350000.00',
      currency: 'UAH',
    };

    await holdingsRepo.updateLoan('h-1', { metadata: { schedule: 'none' } }, op);

    expect(captured.deleteCalls).toBe(0);
    expect(captured.inserts).toEqual([
      {
        instrument: 'holding:h-1',
        day: 19_000,
        price: '350000.00',
        currency: 'UAH',
        source: 'manual',
      },
    ]);
  });

  // A 'none' loan's principal/start-date edit moves the start-day
  // point — delete the old day, insert the new one.
  it("(b) deletes the old day and inserts the new one for a 'move' op", async () => {
    const { databaseTransaction, captured } = makeUpdateLoanDatabaseTransaction();
    mockDatabaseTransaction = databaseTransaction;
    const op: LoanPricePointOp = {
      kind: 'move',
      oldDay: 18_000,
      newDay: 18_500,
      price: '10000.00',
      currency: 'UAH',
    };

    await holdingsRepo.updateLoan('h-1', { metadata: { schedule: 'none' } }, op);

    expect(captured.deleteCalls).toBe(1);
    expect(captured.inserts).toEqual([
      {
        instrument: 'holding:h-1',
        day: 18_500,
        price: '10000.00',
        currency: 'UAH',
        source: 'manual',
      },
    ]);
  });

  // A 'none' loan moving to a schedule drops its start-day point, which would
  // otherwise anchor the schedule as a correction.
  it("(c) deletes the day and inserts nothing for a 'delete' op", async () => {
    const { databaseTransaction, captured } = makeUpdateLoanDatabaseTransaction();
    mockDatabaseTransaction = databaseTransaction;

    await holdingsRepo.updateLoan(
      'h-1',
      { metadata: { schedule: 'annuity' } },
      { kind: 'delete', day: 18_000 },
    );

    expect(captured.deleteCalls).toBe(1);
    expect(captured.inserts).toHaveLength(0);
  });

  // A loan edit that changes its amortization schedule or a third-signal
  // input can invalidate an already-computed AUTO link's own rules 1/2
  // against the NEW schedule — the caller (`use-loan-fields.ts`'s `saveEdit`) detects
  // this and asks `updateLoan` to clear this loan's own auto links, in the
  // SAME transaction as the metadata patch, before the fire-and-forget
  // matcher re-run that follows.
  it('never clears auto links when clearAutoLinks is omitted (unchanged 3-arg call)', async () => {
    const { databaseTransaction, captured } = makeUpdateLoanDatabaseTransaction();
    mockDatabaseTransaction = databaseTransaction;

    await holdingsRepo.updateLoan('h-1', { name: 'Renamed' }, { kind: 'none' });

    expect(captured.transactionsSet).toBeUndefined();
  });

  it('clears this loan holding’s own auto links (manual and rejected untouched) when clearAutoLinks is true', async () => {
    const { databaseTransaction, captured } = makeUpdateLoanDatabaseTransaction();
    mockDatabaseTransaction = databaseTransaction;

    await holdingsRepo.updateLoan('h-1', { name: 'Renamed' }, { kind: 'none' }, true);

    expect(captured.transactionsSet).toEqual({ loanHoldingId: null, loanLinkSource: null });
  });
});
