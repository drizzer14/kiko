// `createCashAccount` runs its inserts through the `write` helper (one
// op-sqlite transaction). Override `write` to run the callback against a
// fake transaction handle so the test can capture every insert issued
// inside that single transaction.
let mockDatabaseTransaction: unknown;
jest.mock('@kiko/db/client', () => {
  const actual = jest.requireActual('@kiko/db/client');

  return {
    ...actual,
    write: (work: (db: unknown) => unknown) => work(mockDatabaseTransaction),
  };
});

// A deleted account's own Keychain items go with it, after the commit.
const mockClearToken = jest.fn();
jest.mock('@kiko/monobank/token', () => ({
  clearToken: (accountId: string) => mockClearToken(accountId),
}));

const mockClearCredentials = jest.fn();
jest.mock('@kiko/crypto-sync/binance', () => ({
  clearCredentials: (accountId: string) => mockClearCredentials(accountId),
}));

import { Money } from '@kiko/currency/money';
import { captureSetDatabaseTransaction } from '@kiko/db/capture-set-tx';
import { renderCondition } from '@kiko/db/render-condition-test-helper';
import { isSyncedAccount, isSyncedHolding } from '@kiko/holdings/deletable';
import { accounts, holdings, reminders, syncState, transactions } from '@kiko/db';
import { inArrayClauseFromCondition } from '@kiko/db/in-array-clause-test-helper';

import { accountsRepo } from './accounts.repo';

// A fake write-transaction handle for the create paths. Both `create` and
// `createCashAccount` first read the current max `sort_order` via
// `select(...).from(accounts)` (to append the new row at `max + 1`), then
// insert. This answers that max query with `maxSortOrder` and captures every
// insert payload in issue order, alongside the NAME of the table each one
// targeted (index-aligned) — `createCashAccount` writes to three different
// tables. The name, not the drizzle table object: a failed `toBe(table)`
// assertion makes Jest serialize that object, which is circular.
const tableNameOf = (table: unknown): string => {
  if (table === accounts) {
    return 'accounts';
  }

  return table === holdings ? 'holdings' : 'transactions';
};

// `assetMax`/`debtMin`/`allMax` answer `nextSortOrder`'s ONE combined select
// (`{ assetMax, debtMin, allMax }`, see accounts.repo.ts): `debtMin` default
// null means "no debt account exists yet" so the shift-debts branch never
// fires, and `allMax` defaults to `assetMax` — matching every fixture below
// that has no debt rows, where the two are the same number anyway. Passing
// `debtMin` explicitly builds the "an asset would collide with the debt
// block" fixtures below; `update` captures a shift, if one is issued.
const makeCreateDatabaseTransaction = (
  assetMax = -1,
  debtMin: number | null = null,
  allMax: number = assetMax,
): {
  databaseTransaction: unknown;
  inserts: Record<string, unknown>[];
  insertTables: string[];
  updates: { set: Record<string, unknown>; whereCalled: boolean }[];
} => {
  const inserts: Record<string, unknown>[] = [];
  const insertTables: string[] = [];
  const updates: { set: Record<string, unknown>; whereCalled: boolean }[] = [];
  const databaseTransaction = {
    select: () => ({ from: () => Promise.resolve([{ assetMax, debtMin, allMax }]) }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        inserts.push(values);
        insertTables.push(tableNameOf(table));

        return Promise.resolve();
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        const entry = { set: values, whereCalled: false };
        updates.push(entry);

        return {
          where: () => {
            entry.whereCalled = true;

            return Promise.resolve();
          },
        };
      },
    }),
  };

  return { databaseTransaction, inserts, insertTables, updates };
};

describe('accountsRepo', () => {
  it('builds a list query against the accounts table', () => {
    expect(accountsRepo.listQuery().toSQL().sql).toContain('accounts');
  });

  it('builds a single-account query filtered by id', () => {
    const query = accountsRepo.byIdQuery('a1').toSQL();
    expect(query.sql).toContain('accounts');
    expect(query.params).toContain('a1');
  });

  it('builds a connected query filtered on institution=monobank by default', () => {
    const query = accountsRepo.connectedQuery().toSQL();
    expect(query.sql).toContain('accounts');
    expect(query.sql).toContain('institution');
    expect(query.params).toContain('monobank');
  });

  it('builds a connected query for a balance-provider institution', () => {
    expect(accountsRepo.connectedQuery('btc_wallet').toSQL().params).toContain('btc_wallet');
    expect(accountsRepo.connectedQuery('binance').toSQL().params).toContain('binance');
  });

  it('create inserts the account and resolves to the generated id', async () => {
    const { databaseTransaction, inserts } = makeCreateDatabaseTransaction();
    mockDatabaseTransaction = databaseTransaction;

    const result = await accountsRepo.create({ name: 'Savings', kind: 'bank' });

    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    expect(result).toBe(inserts[0].id);
  });

  it('create persists the chosen color on the inserted account row', async () => {
    const { databaseTransaction, inserts } = makeCreateDatabaseTransaction();
    mockDatabaseTransaction = databaseTransaction;

    await accountsRepo.create({ name: 'Savings', kind: 'bank', color: '#FFFFFF' });

    expect(inserts[0]).toMatchObject({ color: '#FFFFFF' });
  });

  it('create persists the chosen icon on the inserted account row', async () => {
    const { databaseTransaction, inserts } = makeCreateDatabaseTransaction();
    mockDatabaseTransaction = databaseTransaction;

    await accountsRepo.create({ name: 'Savings', kind: 'bank', icon: 'banknote' });

    expect(inserts[0]).toMatchObject({ icon: 'banknote' });
  });

  it('create appends the new account at sortOrder = max + 1', async () => {
    const { databaseTransaction, inserts } = makeCreateDatabaseTransaction(4);
    mockDatabaseTransaction = databaseTransaction;

    await accountsRepo.create({ name: 'Savings', kind: 'bank' });

    expect(inserts[0]).toMatchObject({ sortOrder: 5 });
  });

  it('create uses sortOrder 0 for the first account (no existing rows)', async () => {
    const { databaseTransaction, inserts } = makeCreateDatabaseTransaction(-1);
    mockDatabaseTransaction = databaseTransaction;

    await accountsRepo.create({ name: 'First', kind: 'bank' });

    expect(inserts[0]).toMatchObject({ sortOrder: 0 });
  });

  it('create inserts a new ASSET account before an existing debt block, shifting every debt sortOrder up by one', async () => {
    // Two asset accounts at sortOrder 0-1, one debt account at sortOrder 2
    // (allMax === debtMin here — the debt account is the current maximum).
    // A naive max+1 would give the new asset account sortOrder 2 too,
    // colliding with (and sorting no earlier than) the existing debt account.
    // candidate(2) - debtMin(2) + 1 = 1: the contiguous case still shifts by
    // exactly one, same as before this became gap-aware.
    const { databaseTransaction, inserts, updates } = makeCreateDatabaseTransaction(1, 2, 2);
    mockDatabaseTransaction = databaseTransaction;

    await accountsRepo.create({ name: 'Savings', kind: 'bank' });

    expect(inserts[0]).toMatchObject({ sortOrder: 2 });
    expect(updates).toHaveLength(1);
    expect(updates[0].whereCalled).toBe(true);
    expect(renderCondition(updates[0].set.sortOrder).params).toEqual([1]);
  });

  it('create shifts every debt by the exact gap needed when an asset already sorts at or after the first debt (non-contiguous)', async () => {
    // An archived asset (never touched by `reorder`, which rewrites only
    // active ids) can sit at the SAME sortOrder as the first debt account —
    // assetMax and debtMin both land on 2, so the new asset's candidate slot
    // (3) is already past the naive +1 shift a contiguous block would need.
    // candidate(3) - debtMin(2) + 1 = 2.
    const { databaseTransaction, inserts, updates } = makeCreateDatabaseTransaction(2, 2, 2);
    mockDatabaseTransaction = databaseTransaction;

    await accountsRepo.create({ name: 'Checking', kind: 'bank' });

    expect(inserts[0]).toMatchObject({ sortOrder: 3 });
    expect(renderCondition(updates[0].set.sortOrder).params).toEqual([2]);
  });

  it('create inserts a new asset account at max(asset) + 1 with no shift when it does not reach the debt block', async () => {
    // Three asset accounts (max sortOrder 2) and a debt account already
    // further out at sortOrder 5 — the fresh 3 lands well short of it, so no
    // shift is needed.
    const { databaseTransaction, inserts, updates } = makeCreateDatabaseTransaction(2, 5, 5);
    mockDatabaseTransaction = databaseTransaction;

    await accountsRepo.create({ name: 'Savings', kind: 'bank' });

    expect(inserts[0]).toMatchObject({ sortOrder: 3 });
    expect(updates).toEqual([]);
  });

  // A real archive-then-reorder flow: `reorder` rewrites only the ACTIVE ids
  // it is given, so an archived account keeps its old `sortOrder` and can end
  // up tied with (or past) the first debt account's own slot — the shape the
  // mock-shape-only tests above cannot exercise. This drives the real
  // aggregate + shift SQL against a fake store (applying the update's actual
  // delta, not a stubbed one) and asserts the FINAL `listQuery` order —
  // `orderBy(sortOrder, createdAt)` — rather than the shift's shape.
  describe('a new asset always sorts before every debt in the real resulting order', () => {
    type StoreAccount = { id: string; kind: string; sortOrder: number; archived: boolean };

    const makeRealOrderDatabaseTransaction = (store: StoreAccount[]): unknown => ({
      select: (fields: Record<string, unknown>) => ({
        from: () => {
          if (!('assetMax' in fields)) {
            return Promise.resolve([]);
          }
          const assetRows = store.filter((row) => row.kind !== 'debt');
          const debtRows = store.filter((row) => row.kind === 'debt');
          const assetMax = assetRows.reduce((max, row) => Math.max(max, row.sortOrder), -1);
          const allMax = store.reduce((max, row) => Math.max(max, row.sortOrder), -1);
          const debtMin =
            debtRows.length > 0 ? Math.min(...debtRows.map((row) => row.sortOrder)) : null;

          return Promise.resolve([{ assetMax, debtMin, allMax }]);
        },
      }),
      insert: () => ({
        values: (values: Record<string, unknown>) => {
          store.push({
            id: values.id as string,
            kind: values.kind as string,
            sortOrder: values.sortOrder as number,
            archived: false,
          });

          return Promise.resolve();
        },
      }),
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: () => {
            const delta = renderCondition(values.sortOrder).params[0] as number;

            for (const row of store) {
              if (row.kind === 'debt') {
                row.sortOrder += delta;
              }
            }

            return Promise.resolve();
          },
        }),
      }),
    });

    it('lands strictly before the debt block even with an archived account interleaved at the same sortOrder', async () => {
      // Account B at sortOrder 0, A at sortOrder 1, debt account D at
      // sortOrder 2, and archived asset X tied with D at sortOrder 2 (never
      // rewritten by `reorder`): exactly the shape a real
      // archive-then-reorder flow leaves behind.
      const store: StoreAccount[] = [
        { id: 'B', kind: 'bank', sortOrder: 0, archived: false },
        { id: 'A', kind: 'bank', sortOrder: 1, archived: false },
        { id: 'D', kind: 'debt', sortOrder: 2, archived: false },
        { id: 'X', kind: 'bank', sortOrder: 2, archived: true },
      ];
      mockDatabaseTransaction = makeRealOrderDatabaseTransaction(store);

      await accountsRepo.create({ id: 'C', name: 'Checking', kind: 'bank' });

      const activeOrder = store
        .filter((row) => !row.archived)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((row) => row.id);

      expect(activeOrder).toEqual(['B', 'A', 'C', 'D']);
    });
  });

  it('create honors an explicitly provided id (a caller that pre-generated it)', async () => {
    // The create form pre-generates the future crypto account's id so the shared
    // sync fields (which bind to an existing account id) can key their Keychain
    // write and sync to it BEFORE the row is inserted. `create` must persist that
    // exact id and resolve to it, rather than minting a fresh one.
    const { databaseTransaction, inserts } = makeCreateDatabaseTransaction();
    mockDatabaseTransaction = databaseTransaction;

    const result = await accountsRepo.create({
      id: 'pre-generated-id',
      name: 'Cold',
      kind: 'crypto',
    });

    expect(result).toBe('pre-generated-id');
    expect(inserts[0]).toMatchObject({ id: 'pre-generated-id' });
  });

  it('create honors an explicitly provided sortOrder', async () => {
    const { databaseTransaction, inserts } = makeCreateDatabaseTransaction(4);
    mockDatabaseTransaction = databaseTransaction;

    await accountsRepo.create({ name: 'Pinned', kind: 'bank', sortOrder: 0 });

    expect(inserts[0]).toMatchObject({ sortOrder: 0 });
  });

  it('listQuery orders by sortOrder', () => {
    expect(accountsRepo.listQuery().toSQL().sql.toLowerCase()).toContain('order by');
    expect(accountsRepo.listQuery().toSQL().sql).toContain('sort_order');
  });

  it('createCashAccount persists the chosen color on the account row', async () => {
    const { databaseTransaction, inserts } = makeCreateDatabaseTransaction();
    mockDatabaseTransaction = databaseTransaction;

    await accountsRepo.createCashAccount({
      name: 'Wallet',
      currency: 'EUR',
      initialBalance: Money.of('EUR', 25050),
      color: '#BDB76B',
    });

    const [accountInsert] = inserts as [Record<string, unknown>];
    expect(accountInsert).toMatchObject({ kind: 'cash', color: '#BDB76B' });
  });

  it('createCashAccount appends the account at sortOrder = max + 1', async () => {
    const { databaseTransaction, inserts } = makeCreateDatabaseTransaction(2);
    mockDatabaseTransaction = databaseTransaction;

    await accountsRepo.createCashAccount({
      name: 'Wallet',
      currency: 'EUR',
      initialBalance: Money.of('EUR', 1000),
    });

    expect(inserts[0]).toMatchObject({ kind: 'cash', sortOrder: 3 });
  });

  it('createCashAccount inserts the account and its cash holding in one transaction', async () => {
    const { databaseTransaction, inserts } = makeCreateDatabaseTransaction();
    mockDatabaseTransaction = databaseTransaction;

    await accountsRepo.createCashAccount({
      name: 'Wallet',
      currency: 'EUR',
      initialBalance: Money.of('EUR', 25050),
    });

    // Account, holding, and the holding's opening ledger row — one transaction.
    expect(inserts).toHaveLength(3);
    const [accountInsert, holdingInsert] = inserts as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(accountInsert).toMatchObject({ name: 'Wallet', kind: 'cash' });
    expect(holdingInsert).toMatchObject({
      accountId: accountInsert.id,
      name: 'Wallet',
      type: 'cash',
      currency: 'EUR',
      balanceMinorUnits: 25050,
    });
    expect(typeof accountInsert.id).toBe('string');
    expect((accountInsert.id as string).length).toBeGreaterThan(0);
  });

  it('seeds an opening transaction for the initial balance', async () => {
    const { databaseTransaction, inserts, insertTables } = makeCreateDatabaseTransaction();
    mockDatabaseTransaction = databaseTransaction;

    await accountsRepo.createCashAccount({
      name: 'Wallet',
      currency: 'UAH',
      initialBalance: Money.of('UAH', 250_00),
    });

    // The initial balance is a manual adjustment like any other: without its own
    // ledger row, `createHoldingValuer` back-derives an opening balance the
    // ledger cannot explain, and the whole historical net-worth series
    // carries a step.
    const [, holdingInsert, openingRow] = inserts as [
      Record<string, unknown>,
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(insertTables).toEqual(['accounts', 'holdings', 'transactions']);
    expect(openingRow).toMatchObject({
      holdingId: holdingInsert.id,
      amountMinorUnits: 250_00,
      source: 'manual',
      // No persisted sentence and no category: the label resolves at render time.
      description: '',
      category: null,
      setsBalance: true,
    });
    expect(typeof openingRow.time).toBe('number');
    // A typed starting balance IS a hand-set
    // balance — it must stamp `balanceSetAt`, at the SAME instant as the
    // opening ledger row's `time`, or `transactionsRepo.importRows` never
    // sees this holding as ever hand-set.
    expect(holdingInsert.balanceSetAt).toBe(openingRow.time);
    expect(holdingInsert.balanceSetRowId).toBe(openingRow.id);
  });

  it('seeds no transaction for a zero initial balance, and does not stamp balanceSetAt', async () => {
    const { databaseTransaction, inserts, insertTables } = makeCreateDatabaseTransaction();
    mockDatabaseTransaction = databaseTransaction;

    await accountsRepo.createCashAccount({
      name: 'Wallet',
      currency: 'UAH',
      initialBalance: Money.of('UAH', 0),
    });

    expect(inserts).toHaveLength(2);
    expect(insertTables).toEqual(['accounts', 'holdings']);
    expect(inserts[1].balanceSetAt).toBeNull();
  });

  it('createCashAccount throws when the initial balance currency does not match the account currency', async () => {
    const { databaseTransaction } = makeCreateDatabaseTransaction();
    mockDatabaseTransaction = databaseTransaction;

    await expect(
      accountsRepo.createCashAccount({
        name: 'Wallet',
        currency: 'UAH',
        initialBalance: Money.of('USD', 100_00),
      }),
    ).rejects.toThrow(/currency/);
  });

  it('createCashAccount rejects a crypto currency and writes nothing', async () => {
    const { databaseTransaction, insertTables } = makeCreateDatabaseTransaction();
    mockDatabaseTransaction = databaseTransaction;

    await expect(
      accountsRepo.createCashAccount({
        name: 'Wallet',
        currency: 'USDT',
        initialBalance: Money.of('USDT', 0),
      }),
    ).rejects.toThrow(/cash holding.*USDT/);
    expect(insertTables).toEqual([]);
  });
});

describe('accountsRepo.reorder', () => {
  it('rewrites each account sortOrder to its 0-based index in the new order', async () => {
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

    await accountsRepo.reorder(['c', 'a', 'b']);

    expect(sortOrders).toEqual([0, 1, 2]);
  });
});

describe('accountsRepo.setIcon', () => {
  it('sets the icon for the given account id', async () => {
    const { captured, databaseTransaction } = captureSetDatabaseTransaction();
    mockDatabaseTransaction = databaseTransaction;

    await accountsRepo.setIcon('a1', 'star');

    expect(captured.set).toEqual({ icon: 'star' });
    expect(captured.whereCalled).toBe(true);
  });

  it('clears the icon when passed null', async () => {
    const { captured, databaseTransaction } = captureSetDatabaseTransaction();
    mockDatabaseTransaction = databaseTransaction;

    await accountsRepo.setIcon('a1', null);

    expect(captured.set).toEqual({ icon: null });
  });
});

// Build a fake transaction handle for `remove`. `select(...).from(...).where(...)`
// resolves queued rows in call order (first the account row, then the account's
// holdings); each `delete(table)` records the table it targeted, in order, and
// its `where` arg, so a test can prove the cascade deletes transactions, then
// `sync_state`, then holdings, then the account itself — all inside the single
// transaction the `write` mock runs the work in.
// `update(transactions).set(...).where(...)` (`clearLoanLinksForHoldingsDatabaseTransaction`)
// records its `set` payload and `where` arg the
// same way, so a test can prove the loan-link cascade ran, and with which ids.
const makeRemoveDatabaseTransaction = (options: {
  account: Record<string, unknown> | null;
  holdings: Record<string, unknown>[];
}): {
  databaseTransaction: unknown;
  captured: {
    deletedFrom: unknown[];
    deleteWhereArgs: { table: unknown; whereArg: unknown }[];
    linkClearSet?: Record<string, unknown>;
    linkClearWhereArg?: unknown;
  };
} => {
  const selectQueue: unknown[][] = [options.account ? [options.account] : [], options.holdings];
  const captured: {
    deletedFrom: unknown[];
    deleteWhereArgs: { table: unknown; whereArg: unknown }[];
    linkClearSet?: Record<string, unknown>;
    linkClearWhereArg?: unknown;
  } = { deletedFrom: [], deleteWhereArgs: [] };
  const databaseTransaction = {
    select: () => ({
      from: () => ({ where: () => Promise.resolve(selectQueue.shift() ?? []) }),
    }),
    delete: (table: unknown) => {
      captured.deletedFrom.push(table);

      return {
        where: (whereArg: unknown) => {
          captured.deleteWhereArgs.push({ table, whereArg });

          return Promise.resolve();
        },
      };
    },
    update: (_table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: (whereArg: unknown) => {
          captured.linkClearSet = values;
          captured.linkClearWhereArg = whereArg;

          return Promise.resolve();
        },
      }),
    }),
  };

  return { databaseTransaction, captured };
};

// Build a fake transaction handle for `disconnect`. The first
// `update(...).set(...).where(...)` clears the account's institution; a
// `select(holdings).from().where()` yields the account's holdings; each
// subsequent `update(holdings).set({ metadata }).where()` rewrites one
// holding's metadata. Every call is captured in issue order so a test can
// prove the account is un-synced and each synced holding's `monobankId` is
// stripped, all inside the single write transaction.
const makeDisconnectDatabaseTransaction = (
  holdingRows: Record<string, unknown>[],
): {
  databaseTransaction: unknown;
  captured: { updates: { table: unknown; set: Record<string, unknown> }[] };
} => {
  const captured: { updates: { table: unknown; set: Record<string, unknown> }[] } = {
    updates: [],
  };
  const databaseTransaction = {
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          captured.updates.push({ table, set: values });

          return Promise.resolve();
        },
      }),
    }),
    select: () => ({
      from: () => ({ where: () => Promise.resolve(holdingRows) }),
    }),
  };

  return { databaseTransaction, captured };
};

describe('accountsRepo.disconnect', () => {
  it('clears the account institution and KEEPS each holding sync key', async () => {
    const { databaseTransaction, captured } = makeDisconnectDatabaseTransaction([
      { id: 'card-1', metadata: { monobankId: 'mono-card', iban: 'UA123', maskedPan: ['1234'] } },
      { id: 'jar-1', metadata: { monobankId: 'mono-jar' } },
    ]);
    mockDatabaseTransaction = databaseTransaction;

    await accountsRepo.disconnect('acc-1');

    // The only write is the institution clear: the sync keys stay on the
    // holdings so a later reconnect re-adopts these very rows (the
    // metadata-key upsert matches on them) instead of inserting duplicates
    // that double-count the balance. Neither holding carries a `syncedAt`
    // stamp, so no metadata rewrite is issued at all.
    expect(captured.updates).toEqual([{ table: accounts, set: { institution: null } }]);
  });

  it('leaves a manual holding (no sync key) under the account untouched', async () => {
    const { databaseTransaction, captured } = makeDisconnectDatabaseTransaction([
      { id: 'manual-1', metadata: { contributions: [] } },
      { id: 'card-1', metadata: { monobankId: 'mono-card' } },
    ]);
    mockDatabaseTransaction = databaseTransaction;

    await accountsRepo.disconnect('acc-1');

    expect(captured.updates).toEqual([{ table: accounts, set: { institution: null } }]);
  });

  it('empties metadata to null when the syncedAt stamp was its only key', async () => {
    const { databaseTransaction, captured } = makeDisconnectDatabaseTransaction([
      { id: 'btc-1', metadata: { syncedAt: 1 } },
    ]);
    mockDatabaseTransaction = databaseTransaction;

    await accountsRepo.disconnect('acc-crypto');

    expect(captured.updates[1]).toEqual({ table: holdings, set: { metadata: null } });
  });

  it('skips a holding whose metadata is not a record rather than throwing', async () => {
    const { databaseTransaction, captured } = makeDisconnectDatabaseTransaction([
      { id: 'odd-1', metadata: 'legacy-string' },
      { id: 'card-1', metadata: null },
    ]);
    mockDatabaseTransaction = databaseTransaction;

    await accountsRepo.disconnect('acc-1');

    expect(captured.updates).toEqual([{ table: accounts, set: { institution: null } }]);
  });

  it('clears the institution even when the account has no holdings', async () => {
    const { databaseTransaction, captured } = makeDisconnectDatabaseTransaction([]);
    mockDatabaseTransaction = databaseTransaction;

    await accountsRepo.disconnect('acc-1');

    expect(captured.updates).toEqual([{ table: accounts, set: { institution: null } }]);
  });

  it('leaves rows that no longer read as synced, so remove then accepts them and cascades', async () => {
    const holdingRows = [
      { id: 'card-1', metadata: { monobankId: 'mono-card', iban: 'UA123' } },
      { id: 'jar-1', metadata: { monobankId: 'mono-jar' } },
    ];
    const { databaseTransaction, captured } = makeDisconnectDatabaseTransaction(holdingRows);
    mockDatabaseTransaction = databaseTransaction;

    await accountsRepo.disconnect('acc-1');

    // Reconstruct the account as disconnect left it, then prove the
    // deletability predicates flip to false — the exact contract remove relies
    // on. Each holding KEEPS its sync key; it is the cleared institution alone
    // that makes it read as manual.
    const [accountUpdate] = captured.updates;
    const disconnectedAccount = { institution: accountUpdate.set.institution as string | null };
    expect(isSyncedAccount(disconnectedAccount)).toBe(false);

    for (const holdingRow of holdingRows) {
      expect(typeof holdingRow.metadata.monobankId).toBe('string');
      expect(isSyncedHolding(holdingRow, disconnectedAccount)).toBe(false);
    }

    // The now-manual account is accepted by remove and cascades to holdings/transactions.
    const { databaseTransaction: removeDatabaseTransaction, captured: removeCaptured } =
      makeRemoveDatabaseTransaction({
        account: { id: 'acc-1', ...disconnectedAccount },
        holdings: [{ id: 'card-1' }, { id: 'jar-1' }],
      });
    mockDatabaseTransaction = removeDatabaseTransaction;

    await accountsRepo.remove('acc-1');

    expect(removeCaptured.deletedFrom).toEqual([
      transactions,
      transactions,
      syncState,
      reminders,
      holdings,
      accounts,
    ]);
  });

  it('drops the stale syncedAt stamp from a wallet-synced holding but keeps its address', async () => {
    const { databaseTransaction, captured } = makeDisconnectDatabaseTransaction([
      {
        id: 'btc-1',
        metadata: {
          walletAddress: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
          syncedAt: 1_704_326_400_000,
        },
      },
    ]);
    mockDatabaseTransaction = databaseTransaction;

    await accountsRepo.disconnect('acc-crypto');

    expect(captured.updates).toEqual([
      { table: accounts, set: { institution: null } },
      {
        table: holdings,
        set: { metadata: { walletAddress: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq' } },
      },
    ]);
  });

  it('drops syncedAt from a Binance holding but keeps binanceAsset and unrelated keys', async () => {
    const { databaseTransaction, captured } = makeDisconnectDatabaseTransaction([
      { id: 'bnb-1', metadata: { binanceAsset: 'BTC', syncedAt: 1_704_326_400_000, note: 'spot' } },
    ]);
    mockDatabaseTransaction = databaseTransaction;

    await accountsRepo.disconnect('acc-crypto');

    expect(captured.updates[1]).toEqual({
      table: holdings,
      set: { metadata: { binanceAsset: 'BTC', note: 'spot' } },
    });
  });
});

describe('accountsRepo.remove', () => {
  it('cascades to holdings and their transactions in one transaction', async () => {
    const { databaseTransaction, captured } = makeRemoveDatabaseTransaction({
      account: { id: 'acc-1', institution: null },
      holdings: [{ id: 'hold-1' }],
    });
    mockDatabaseTransaction = databaseTransaction;

    await accountsRepo.remove('acc-1');

    // The holding's transactions are deleted first, then the account's own
    // sync_state row and reminders (FK NO ACTION references — deleting the
    // account first would fail with a foreign key constraint error on any
    // account that ever ran a Monobank sync, even a failed first one, or has a
    // reminder), then the holdings, then the account row — proving the full
    // cascade runs inside the one transaction.
    expect(captured.deletedFrom).toEqual([transactions, syncState, reminders, holdings, accounts]);
  });

  it('deletes each holding’s transactions before removing holdings and the account', async () => {
    const { databaseTransaction, captured } = makeRemoveDatabaseTransaction({
      account: { id: 'acc-1', institution: null },
      holdings: [{ id: 'hold-1' }, { id: 'hold-2' }],
    });
    mockDatabaseTransaction = databaseTransaction;

    await accountsRepo.remove('acc-1');

    // One transactions delete per holding, then sync_state and reminders, then
    // the holdings, then the account.
    expect(captured.deletedFrom).toEqual([
      transactions,
      transactions,
      syncState,
      reminders,
      holdings,
      accounts,
    ]);
  });

  it('deletes the account’s reminders scoped to that account id', async () => {
    const { databaseTransaction, captured } = makeRemoveDatabaseTransaction({
      account: { id: 'acc-1', institution: null },
      holdings: [],
    });
    mockDatabaseTransaction = databaseTransaction;

    await accountsRepo.remove('acc-1');

    const remindersDelete = captured.deleteWhereArgs.find((entry) => entry.table === reminders);
    expect(renderCondition(remindersDelete?.whereArg)).toEqual({
      sql: '"reminders"."account_id" = ?',
      params: ['acc-1'],
    });
  });

  it('deletes the account’s sync_state row scoped to that account id', async () => {
    const { databaseTransaction, captured } = makeRemoveDatabaseTransaction({
      account: { id: 'acc-1', institution: null },
      holdings: [{ id: 'hold-1' }],
    });
    mockDatabaseTransaction = databaseTransaction;

    await accountsRepo.remove('acc-1');

    const syncStateDelete = captured.deleteWhereArgs.find((entry) => entry.table === syncState);
    expect(renderCondition(syncStateDelete?.whereArg)).toEqual({
      sql: '"sync_state"."account_id" = ?',
      params: ['acc-1'],
    });
  });

  // A debt account can hold a loan among its
  // holdings, and OTHER holdings' payment rows (possibly on a different
  // account entirely) can point back at that loan via `loanHoldingId`.
  // `remove` must clear those links, for every holding the deleted account
  // owned, in the SAME transaction as the delete — not just delete the loan
  // holding and leave a dangling id behind.
  it('clears loan links for every deleted holding, in the same transaction', async () => {
    const { databaseTransaction, captured } = makeRemoveDatabaseTransaction({
      account: { id: 'acc-1', institution: null },
      holdings: [{ id: 'hold-1' }, { id: 'loan-1' }],
    });
    mockDatabaseTransaction = databaseTransaction;

    await accountsRepo.remove('acc-1');

    expect(captured.linkClearSet).toEqual({ loanHoldingId: null, loanLinkSource: null });
    expect(inArrayClauseFromCondition(captured.linkClearWhereArg)).toEqual({
      column: 'loan_holding_id',
      ids: ['hold-1', 'loan-1'],
    });
  });

  it('refuses a synced (monobank) account and leaves it in place', async () => {
    const { databaseTransaction, captured } = makeRemoveDatabaseTransaction({
      account: { id: 'acc-1', institution: 'monobank' },
      holdings: [{ id: 'hold-1' }],
    });
    mockDatabaseTransaction = databaseTransaction;

    await expect(accountsRepo.remove('acc-1')).rejects.toThrow(/synced/);
    expect(captured.deletedFrom).toEqual([]);
  });

  it('does nothing when the target account does not exist', async () => {
    const { databaseTransaction, captured } = makeRemoveDatabaseTransaction({
      account: null,
      holdings: [],
    });
    mockDatabaseTransaction = databaseTransaction;

    await accountsRepo.remove('missing');

    expect(captured.deletedFrom).toEqual([]);
    expect(mockClearToken).not.toHaveBeenCalled();
    expect(mockClearCredentials).not.toHaveBeenCalled();
  });

  // A failed first Connect leaves a manual-looking account whose Keychain item
  // (Monobank token or Binance key pair, keyed by the account id) the delete
  // would otherwise orphan for good.
  it('clears the account’s own Keychain items after the delete commits', async () => {
    const { databaseTransaction, captured } = makeRemoveDatabaseTransaction({
      account: { id: 'acc-1', institution: null },
      holdings: [{ id: 'hold-1' }],
    });
    mockDatabaseTransaction = databaseTransaction;
    const order: string[] = [];
    mockClearToken.mockImplementation(async () => {
      order.push(`token after ${captured.deletedFrom.length} deletes`);
    });
    mockClearCredentials.mockImplementation(async () => {
      order.push(`credentials after ${captured.deletedFrom.length} deletes`);
    });

    await accountsRepo.remove('acc-1');

    expect(mockClearToken).toHaveBeenCalledWith('acc-1');
    expect(mockClearCredentials).toHaveBeenCalledWith('acc-1');
    expect(order).toEqual(['token after 5 deletes', 'credentials after 5 deletes']);
  });

  // The account is already gone when the clear runs, so a failed clear is not a
  // failed delete: a rejection would show the save error and skip the
  // reminders re-plan the delete needs.
  it('still resolves, and tries the other item, when a Keychain clear fails after the commit', async () => {
    const { databaseTransaction } = makeRemoveDatabaseTransaction({
      account: { id: 'acc-1', institution: null },
      holdings: [],
    });
    mockDatabaseTransaction = databaseTransaction;
    mockClearToken.mockRejectedValueOnce(new Error('keychain delete failed SECRET'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(accountsRepo.remove('acc-1')).resolves.toBeUndefined();

    expect(mockClearCredentials).toHaveBeenCalledWith('acc-1');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('SECRET');

    warn.mockRestore();
  });

  it('also resolves when the key pair clear is the one that fails', async () => {
    const { databaseTransaction } = makeRemoveDatabaseTransaction({
      account: { id: 'acc-1', institution: null },
      holdings: [],
    });
    mockDatabaseTransaction = databaseTransaction;
    mockClearCredentials.mockRejectedValueOnce(new Error('keychain delete failed'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(accountsRepo.remove('acc-1')).resolves.toBeUndefined();

    expect(mockClearToken).toHaveBeenCalledWith('acc-1');

    warn.mockRestore();
  });

  it('keeps the Keychain items of an account whose delete fails', async () => {
    const { databaseTransaction } = makeRemoveDatabaseTransaction({
      account: { id: 'acc-1', institution: 'monobank' },
      holdings: [],
    });
    mockDatabaseTransaction = databaseTransaction;

    await expect(accountsRepo.remove('acc-1')).rejects.toThrow(/synced/);

    expect(mockClearToken).not.toHaveBeenCalled();
    expect(mockClearCredentials).not.toHaveBeenCalled();
  });
});
