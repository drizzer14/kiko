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
import { accountsRepo } from './accounts.repo';

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
