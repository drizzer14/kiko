const mockExecuteRawAsync = jest.fn();

jest.mock('@op-engineering/op-sqlite', () => ({
  open: () => ({
    execute: () => ({ rows: [] }),
    executeRawAsync: (...args: unknown[]) => mockExecuteRawAsync(...args),
  }),
}));

import { ratesRepo } from './rates.repo';

describe('ratesRepo', () => {
  it('builds an all-rates query against the currency_rates table', () => {
    expect(ratesRepo.allQuery().toSQL().sql).toContain('currency_rates');
  });

  it('reads the latest stored fetchedAt via a max aggregate', async () => {
    mockExecuteRawAsync.mockResolvedValue([[1_700_000_000_000]]);
    const latest = await ratesRepo.latestFetchedAt();
    expect(latest).toBe(1_700_000_000_000);
    expect(mockExecuteRawAsync.mock.calls[0][0]).toMatch(/max/i);
  });

  it('returns null when no rate has been stored yet', async () => {
    mockExecuteRawAsync.mockResolvedValue([[null]]);
    expect(await ratesRepo.latestFetchedAt()).toBeNull();
  });
});
