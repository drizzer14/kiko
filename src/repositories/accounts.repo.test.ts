jest.mock('@op-engineering/op-sqlite', () => ({
  open: () => ({ execute: () => ({ rows: [] }) }),
}));

// `createAndReturn` runs its insert through the `write` helper (one op-sqlite
// transaction). Override `write` to run the callback against a fake
// transaction handle so the test can capture what was inserted and confirm
// the returned id matches the id written to the row.
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

  it('createAndReturn inserts a new account and returns the generated id', async () => {
    const captured: { insert?: Record<string, unknown> } = {};
    mockTx = {
      insert: () => ({
        values: (values: Record<string, unknown>) => {
          captured.insert = values;
          return Promise.resolve();
        },
      }),
    };

    const returnedId = await accountsRepo.createAndReturn({ name: 'Wallet', kind: 'cash' });

    expect(typeof returnedId).toBe('string');
    expect(returnedId.length).toBeGreaterThan(0);
    expect(captured.insert).toMatchObject({ id: returnedId, name: 'Wallet', kind: 'cash' });
  });
});
