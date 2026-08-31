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

import { accountsRepo } from './accounts.repo';

describe('accountsRepo', () => {
  it('builds a list query against the accounts table', () => {
    expect(accountsRepo.listQuery().toSQL().sql).toContain('accounts');
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
