jest.mock('@op-engineering/op-sqlite', () => ({
  open: () => ({ execute: () => ({ rows: [] }) }),
}));

import { ratesRepo } from './rates.repo';

describe('ratesRepo', () => {
  it('builds an all-rates query against the currency_rates table', () => {
    expect(ratesRepo.allQuery().toSQL().sql).toContain('currency_rates');
  });
});
