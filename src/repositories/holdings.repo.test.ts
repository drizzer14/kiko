// op-sqlite's open() calls a native module unavailable under Jest; the
// repo modules import ../db/client, which opens the connection at load.
// Mocking open() with a minimal handle lets Drizzle build query builders
// (the unit under test here) without a live native database. Only
// `.toSQL()` shape is asserted, so no execute behavior is needed.
jest.mock('@op-engineering/op-sqlite', () => ({
  open: () => ({ execute: () => ({ rows: [] }) }),
}));

import { holdingsRepo } from './holdings.repo';

describe('holdingsRepo', () => {
  it('builds a query filtered by account id', () => {
    const { sql, params } = holdingsRepo.listByAccountQuery('acc-1').toSQL();
    expect(sql).toContain('holdings');
    expect(params).toContain('acc-1');
  });

  it('builds an all-holdings query', () => {
    expect(holdingsRepo.allQuery().toSQL().sql).toContain('holdings');
  });
});
