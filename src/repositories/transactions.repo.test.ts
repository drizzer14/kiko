jest.mock('@op-engineering/op-sqlite', () => ({
  open: () => ({ execute: () => ({ rows: [] }) }),
}));

import { transactionsRepo } from './transactions.repo';

describe('transactionsRepo', () => {
  it('builds a query filtered by holding id', () => {
    const { sql, params } = transactionsRepo.listByHoldingQuery('hold-1').toSQL();
    expect(sql).toContain('transactions');
    expect(params).toContain('hold-1');
  });
});
