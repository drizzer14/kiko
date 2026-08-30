jest.mock('@op-engineering/op-sqlite', () => ({
  open: () => ({ execute: () => ({ rows: [] }) }),
}));

import { accountsRepo } from './accounts.repo';

describe('accountsRepo', () => {
  it('builds a list query against the accounts table', () => {
    expect(accountsRepo.listQuery().toSQL().sql).toContain('accounts');
  });
});
