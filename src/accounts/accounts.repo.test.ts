// `createCashAccount` runs its inserts through the `write` helper (one
// op-sqlite transaction). Override `write` to run the callback against a
// fake transaction handle so the test can capture every insert issued
// inside that single transaction.
let mockTx: unknown;
jest.mock('../db/client', () => {
  const actual = jest.requireActual('../db/client');
  return {
    ...actual,
    write: (work: (db: unknown) => unknown) => work(mockTx),
  };
});

import { captureSetTx } from '@kiko/db/capture-set-tx';

import { accounts, holdings, transactions } from '../db/schema';
import { isSyncedAccount, isSyncedHolding } from '../holdings/deletable';

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

const makeCreateTx = (
  maxSortOrder = -1,
): { tx: unknown; inserts: Record<string, unknown>[]; insertTables: string[] } => {
  const inserts: Record<string, unknown>[] = [];
  const insertTables: string[] = [];
  const tx = {
    select: () => ({ from: () => Promise.resolve([{ value: maxSortOrder }]) }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        inserts.push(values);
        insertTables.push(tableNameOf(table));
        return Promise.resolve();
      },
    }),
  };
  return { tx, inserts, insertTables };
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
    const { tx, inserts } = makeCreateTx();
    mockTx = tx;

    const result = await accountsRepo.create({ name: 'Savings', kind: 'bank' });

    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    expect(result).toBe(inserts[0].id);
  });

  it('create persists the chosen color on the inserted account row', async () => {
    const { tx, inserts } = makeCreateTx();
    mockTx = tx;

    await accountsRepo.create({ name: 'Savings', kind: 'bank', color: '#FFFFFF' });

    expect(inserts[0]).toMatchObject({ color: '#FFFFFF' });
  });

  it('create appends the new account at sortOrder = max + 1', async () => {
    const { tx, inserts } = makeCreateTx(4);
    mockTx = tx;

    await accountsRepo.create({ name: 'Savings', kind: 'bank' });

    expect(inserts[0]).toMatchObject({ sortOrder: 5 });
  });

  it('create uses sortOrder 0 for the first account (no existing rows)', async () => {
    const { tx, inserts } = makeCreateTx(-1);
    mockTx = tx;

    await accountsRepo.create({ name: 'First', kind: 'bank' });

    expect(inserts[0]).toMatchObject({ sortOrder: 0 });
  });

  it('create honors an explicitly provided id (a caller that pre-generated it)', async () => {
    // The create form pre-generates the future crypto account's id so the shared
    // sync fields (which bind to an existing account id) can key their Keychain
    // write and sync to it BEFORE the row is inserted. `create` must persist that
    // exact id and resolve to it, rather than minting a fresh one.
    const { tx, inserts } = makeCreateTx();
    mockTx = tx;

    const result = await accountsRepo.create({
      id: 'pre-generated-id',
      name: 'Cold',
      kind: 'crypto',
    });

    expect(result).toBe('pre-generated-id');
    expect(inserts[0]).toMatchObject({ id: 'pre-generated-id' });
  });

  it('create honors an explicitly provided sortOrder', async () => {
    const { tx, inserts } = makeCreateTx(4);
    mockTx = tx;

    await accountsRepo.create({ name: 'Pinned', kind: 'bank', sortOrder: 0 });

    expect(inserts[0]).toMatchObject({ sortOrder: 0 });
  });

  it('listQuery orders by sortOrder', () => {
    expect(accountsRepo.listQuery().toSQL().sql.toLowerCase()).toContain('order by');
    expect(accountsRepo.listQuery().toSQL().sql).toContain('sort_order');
  });

  it('createCashAccount persists the chosen color on the account row', async () => {
    const { tx, inserts } = makeCreateTx();
    mockTx = tx;

    await accountsRepo.createCashAccount({
      name: 'Wallet',
      currency: 'EUR',
      initialBalanceMinorUnits: 25050,
      color: '#BDB76B',
    });

    const [accountInsert] = inserts as [Record<string, unknown>];
    expect(accountInsert).toMatchObject({ kind: 'cash', color: '#BDB76B' });
  });

  it('createCashAccount appends the account at sortOrder = max + 1', async () => {
    const { tx, inserts } = makeCreateTx(2);
    mockTx = tx;

    await accountsRepo.createCashAccount({
      name: 'Wallet',
      currency: 'EUR',
      initialBalanceMinorUnits: 1000,
    });

    expect(inserts[0]).toMatchObject({ kind: 'cash', sortOrder: 3 });
  });

  it('createCashAccount inserts the account and its cash holding in one transaction', async () => {
    const { tx, inserts } = makeCreateTx();
    mockTx = tx;

    await accountsRepo.createCashAccount({
      name: 'Wallet',
      currency: 'EUR',
      initialBalanceMinorUnits: 25050,
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
    const { tx, inserts, insertTables } = makeCreateTx();
    mockTx = tx;

    await accountsRepo.createCashAccount({
      name: 'Wallet',
      currency: 'UAH',
      initialBalanceMinorUnits: 250_00,
    });

    // The initial balance is a manual adjustment like any other: without its own
    // ledger row, `holdingValueAt` back-derives an opening balance the ledger
    // cannot explain, and the whole historical net-worth series carries a step.
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
    });
    expect(typeof openingRow.time).toBe('number');
  });

  it('seeds no transaction for a zero initial balance', async () => {
    const { tx, inserts, insertTables } = makeCreateTx();
    mockTx = tx;

    await accountsRepo.createCashAccount({
      name: 'Wallet',
      currency: 'UAH',
      initialBalanceMinorUnits: 0,
    });

    expect(inserts).toHaveLength(2);
    expect(insertTables).toEqual(['accounts', 'holdings']);
  });
});

describe('accountsRepo.reorder', () => {
  it('rewrites each account sortOrder to its 0-based index in the new order', async () => {
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

    await accountsRepo.reorder(['c', 'a', 'b']);

    expect(sortOrders).toEqual([0, 1, 2]);
  });
});

describe('accountsRepo.setIcon', () => {
  it('sets the icon for the given account id', async () => {
    const { captured, tx } = captureSetTx();
    mockTx = tx;

    await accountsRepo.setIcon('a1', 'star');

    expect(captured.set).toEqual({ icon: 'star' });
    expect(captured.whereCalled).toBe(true);
  });

  it('clears the icon when passed null', async () => {
    const { captured, tx } = captureSetTx();
    mockTx = tx;

    await accountsRepo.setIcon('a1', null);

    expect(captured.set).toEqual({ icon: null });
  });
});

// Build a fake transaction handle for `remove`. `select(...).from(...).where(...)`
// resolves queued rows in call order (first the account row, then the account's
// holdings); each `delete(table)` records the table it targeted, in order, so a
// test can prove the cascade deletes transactions, then holdings, then the account
// itself — all inside the single transaction the `write` mock runs the work in.
const makeRemoveTx = (opts: {
  account: Record<string, unknown> | null;
  holdings: Record<string, unknown>[];
}): { tx: unknown; captured: { deletedFrom: unknown[] } } => {
  const selectQueue: unknown[][] = [opts.account ? [opts.account] : [], opts.holdings];
  const captured: { deletedFrom: unknown[] } = { deletedFrom: [] };
  const tx = {
    select: () => ({
      from: () => ({ where: () => Promise.resolve(selectQueue.shift() ?? []) }),
    }),
    delete: (table: unknown) => {
      captured.deletedFrom.push(table);
      return { where: () => Promise.resolve() };
    },
  };
  return { tx, captured };
};

// Build a fake transaction handle for `disconnect`. The first
// `update(...).set(...).where(...)` clears the account's institution; a
// `select(holdings).from().where()` yields the account's holdings; each
// subsequent `update(holdings).set({ metadata }).where()` rewrites one
// holding's metadata. Every call is captured in issue order so a test can
// prove the account is un-synced and each synced holding's `monobankId` is
// stripped, all inside the single write transaction.
const makeDisconnectTx = (
  holdingRows: Record<string, unknown>[],
): { tx: unknown; captured: { updates: { table: unknown; set: Record<string, unknown> }[] } } => {
  const captured: { updates: { table: unknown; set: Record<string, unknown> }[] } = {
    updates: [],
  };
  const tx = {
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
  return { tx, captured };
};

describe('accountsRepo.disconnect', () => {
  it('clears the account institution and KEEPS each holding sync key', async () => {
    const { tx, captured } = makeDisconnectTx([
      { id: 'card-1', metadata: { monobankId: 'mono-card', iban: 'UA123', maskedPan: ['1234'] } },
      { id: 'jar-1', metadata: { monobankId: 'mono-jar' } },
    ]);
    mockTx = tx;

    await accountsRepo.disconnect('acc-1');

    // The only write is the institution clear: the sync keys stay on the
    // holdings so a later reconnect re-adopts these very rows (the
    // metadata-key upsert matches on them) instead of inserting duplicates
    // that double-count the balance. Neither holding carries a `syncedAt`
    // stamp, so no metadata rewrite is issued at all.
    expect(captured.updates).toEqual([{ table: accounts, set: { institution: null } }]);
  });

  it('leaves a manual holding (no sync key) under the account untouched', async () => {
    const { tx, captured } = makeDisconnectTx([
      { id: 'manual-1', metadata: { contributions: [] } },
      { id: 'card-1', metadata: { monobankId: 'mono-card' } },
    ]);
    mockTx = tx;

    await accountsRepo.disconnect('acc-1');

    expect(captured.updates).toEqual([{ table: accounts, set: { institution: null } }]);
  });

  it('empties metadata to null when the syncedAt stamp was its only key', async () => {
    const { tx, captured } = makeDisconnectTx([{ id: 'btc-1', metadata: { syncedAt: 1 } }]);
    mockTx = tx;

    await accountsRepo.disconnect('acc-crypto');

    expect(captured.updates[1]).toEqual({ table: holdings, set: { metadata: null } });
  });

  it('skips a holding whose metadata is not a record rather than throwing', async () => {
    const { tx, captured } = makeDisconnectTx([
      { id: 'odd-1', metadata: 'legacy-string' },
      { id: 'card-1', metadata: null },
    ]);
    mockTx = tx;

    await accountsRepo.disconnect('acc-1');

    expect(captured.updates).toEqual([{ table: accounts, set: { institution: null } }]);
  });

  it('clears the institution even when the account has no holdings', async () => {
    const { tx, captured } = makeDisconnectTx([]);
    mockTx = tx;

    await accountsRepo.disconnect('acc-1');

    expect(captured.updates).toEqual([{ table: accounts, set: { institution: null } }]);
  });

  it('leaves rows that no longer read as synced, so remove then accepts them and cascades', async () => {
    const holdingRows = [
      { id: 'card-1', metadata: { monobankId: 'mono-card', iban: 'UA123' } },
      { id: 'jar-1', metadata: { monobankId: 'mono-jar' } },
    ];
    const { tx, captured } = makeDisconnectTx(holdingRows);
    mockTx = tx;

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
    const { tx: removeTx, captured: removeCaptured } = makeRemoveTx({
      account: { id: 'acc-1', ...disconnectedAccount },
      holdings: [{ id: 'card-1' }, { id: 'jar-1' }],
    });
    mockTx = removeTx;

    await accountsRepo.remove('acc-1');

    expect(removeCaptured.deletedFrom).toEqual([transactions, transactions, holdings, accounts]);
  });

  it('drops the stale syncedAt stamp from a wallet-synced holding but keeps its address', async () => {
    const { tx, captured } = makeDisconnectTx([
      {
        id: 'btc-1',
        metadata: {
          walletAddress: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
          syncedAt: 1_704_326_400_000,
        },
      },
    ]);
    mockTx = tx;

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
    const { tx, captured } = makeDisconnectTx([
      { id: 'bnb-1', metadata: { binanceAsset: 'BTC', syncedAt: 1_704_326_400_000, note: 'spot' } },
    ]);
    mockTx = tx;

    await accountsRepo.disconnect('acc-crypto');

    expect(captured.updates[1]).toEqual({
      table: holdings,
      set: { metadata: { binanceAsset: 'BTC', note: 'spot' } },
    });
  });
});

describe('accountsRepo.remove', () => {
  it('cascades to holdings and their transactions in one transaction', async () => {
    const { tx, captured } = makeRemoveTx({
      account: { id: 'acc-1', institution: null },
      holdings: [{ id: 'hold-1' }],
    });
    mockTx = tx;

    await accountsRepo.remove('acc-1');

    // The holding's transactions are deleted first, then the holdings, then the
    // account row — proving the full cascade runs inside the one transaction.
    expect(captured.deletedFrom).toEqual([transactions, holdings, accounts]);
  });

  it('deletes each holding’s transactions before removing holdings and the account', async () => {
    const { tx, captured } = makeRemoveTx({
      account: { id: 'acc-1', institution: null },
      holdings: [{ id: 'hold-1' }, { id: 'hold-2' }],
    });
    mockTx = tx;

    await accountsRepo.remove('acc-1');

    // One transactions delete per holding, then the holdings, then the account.
    expect(captured.deletedFrom).toEqual([transactions, transactions, holdings, accounts]);
  });

  it('refuses a synced (monobank) account and leaves it in place', async () => {
    const { tx, captured } = makeRemoveTx({
      account: { id: 'acc-1', institution: 'monobank' },
      holdings: [{ id: 'hold-1' }],
    });
    mockTx = tx;

    await expect(accountsRepo.remove('acc-1')).rejects.toThrow(/synced/);
    expect(captured.deletedFrom).toEqual([]);
  });

  it('does nothing when the target account does not exist', async () => {
    const { tx, captured } = makeRemoveTx({ account: null, holdings: [] });
    mockTx = tx;

    await accountsRepo.remove('missing');

    expect(captured.deletedFrom).toEqual([]);
  });
});
