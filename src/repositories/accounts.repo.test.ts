jest.mock('@op-engineering/op-sqlite', () => ({
  open: () => ({ execute: () => ({ rows: [] }) }),
}));

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

import { accounts, holdings, transactions } from '../db/schema';
import { isSyncedAccount, isSyncedHolding } from '../holdings/deletable';
import { accountsRepo } from './accounts.repo';
import { captureSetTx } from './capture-set-tx';

describe('accountsRepo', () => {
  it('builds a list query against the accounts table', () => {
    expect(accountsRepo.listQuery().toSQL().sql).toContain('accounts');
  });

  it('builds a single-account query filtered by id', () => {
    const query = accountsRepo.byIdQuery('a1').toSQL();
    expect(query.sql).toContain('accounts');
    expect(query.params).toContain('a1');
  });

  it('builds a connected query filtered on institution=monobank', () => {
    const query = accountsRepo.connectedQuery().toSQL();
    expect(query.sql).toContain('accounts');
    expect(query.sql).toContain('institution');
    expect(query.params).toContain('monobank');
  });

  it('createCashAccount inserts the account and its cash holding in one transaction', async () => {
    const inserts: Record<string, unknown>[] = [];
    mockTx = {
      insert: () => ({
        values: (values: Record<string, unknown>) => {
          inserts.push(values);
          return Promise.resolve();
        },
      }),
    };

    await accountsRepo.createCashAccount({
      name: 'Wallet',
      currency: 'EUR',
      initialBalanceMinorUnits: 25050,
    });

    expect(inserts).toHaveLength(2);
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

// Build a fake transaction handle for `disconnectMonobank`. The first
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

describe('accountsRepo.disconnectMonobank', () => {
  it('clears the account institution and strips monobankId from each synced holding', async () => {
    const { tx, captured } = makeDisconnectTx([
      { id: 'card-1', metadata: { monobankId: 'mono-card', iban: 'UA123', maskedPan: ['1234'] } },
      { id: 'jar-1', metadata: { monobankId: 'mono-jar' } },
    ]);
    mockTx = tx;

    await accountsRepo.disconnectMonobank('acc-1');

    // First write clears the account's institution.
    expect(captured.updates[0]).toEqual({ table: accounts, set: { institution: null } });
    // The card holding keeps its other metadata but loses monobankId.
    expect(captured.updates[1]).toEqual({
      table: holdings,
      set: { metadata: { iban: 'UA123', maskedPan: ['1234'] } },
    });
    // The jar holding had only monobankId, so its metadata is emptied to null.
    expect(captured.updates[2]).toEqual({ table: holdings, set: { metadata: null } });
    expect(captured.updates).toHaveLength(3);
  });

  it('leaves a manual holding (no monobankId) under the account untouched', async () => {
    const { tx, captured } = makeDisconnectTx([
      { id: 'manual-1', metadata: { contributions: [] } },
      { id: 'card-1', metadata: { monobankId: 'mono-card' } },
    ]);
    mockTx = tx;

    await accountsRepo.disconnectMonobank('acc-1');

    // Only the institution clear and the synced-holding rewrite are issued.
    expect(captured.updates).toEqual([
      { table: accounts, set: { institution: null } },
      { table: holdings, set: { metadata: null } },
    ]);
  });

  it('clears the institution even when the account has no holdings', async () => {
    const { tx, captured } = makeDisconnectTx([]);
    mockTx = tx;

    await accountsRepo.disconnectMonobank('acc-1');

    expect(captured.updates).toEqual([{ table: accounts, set: { institution: null } }]);
  });

  it('produces rows that no longer read as synced, so remove then accepts them and cascades', async () => {
    const { tx, captured } = makeDisconnectTx([
      { id: 'card-1', metadata: { monobankId: 'mono-card', iban: 'UA123' } },
      { id: 'jar-1', metadata: { monobankId: 'mono-jar' } },
    ]);
    mockTx = tx;

    await accountsRepo.disconnectMonobank('acc-1');

    // Reconstruct the account and holdings as disconnect left them, then prove
    // the deletability predicates flip to false — the exact contract remove relies on.
    const [accountUpdate, ...holdingUpdates] = captured.updates;
    const disconnectedAccount = { institution: accountUpdate.set.institution as string | null };
    expect(isSyncedAccount(disconnectedAccount)).toBe(false);
    for (const holdingUpdate of holdingUpdates) {
      expect(isSyncedHolding({ metadata: holdingUpdate.set.metadata })).toBe(false);
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
