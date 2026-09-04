const mockExecuteRaw = jest.fn();

// Model op-sqlite 18.1.4 faithfully: its read primitive is `executeRaw`,
// which resolves to a `RawQueryResult` OBJECT (`{ rawRows, columnNames,
// rowsAffected }`). The drizzle client wrapper in `db/client.ts` calls this
// and hands drizzle the unwrapped `rawRows`. (An earlier fixture stubbed a
// bare-array `executeRawAsync`, the incorrect shape that hid the app-wide
// read bug.)
jest.mock('@op-engineering/op-sqlite', () => ({
  open: () => ({
    execute: () => ({ rows: [] }),
    executeRaw: (...args: unknown[]) => mockExecuteRaw(...args),
    // client.ts runs the legacy-db migration at module load; executeSync
    // reports one existing table so it treats kiko.db as already populated
    // and no-ops (its own branches are covered by migrate-legacy-db.test.ts).
    executeSync: () => ({ rows: [{ n: 1 }] }),
    getDbPath: () => '/mock/Documents/kiko.db',
    close: () => {},
    delete: () => {},
  }),
}));

import { ratesRepo } from './rates.repo';

const rawResult = (rawRows: unknown[][]) => ({
  rawRows,
  columnNames: ['fetchedAt'],
  rowsAffected: 0,
});

describe('ratesRepo', () => {
  it('builds an all-rates query against the currency_rates table', () => {
    expect(ratesRepo.allQuery().toSQL().sql).toContain('currency_rates');
  });

  it('reads the latest stored fetchedAt via a max aggregate', async () => {
    mockExecuteRaw.mockResolvedValue(rawResult([[1_700_000_000_000]]));
    const latest = await ratesRepo.latestFetchedAt();
    expect(latest).toBe(1_700_000_000_000);
    expect(mockExecuteRaw.mock.calls[0][0]).toMatch(/max/i);
  });

  it('returns null when no rate has been stored yet', async () => {
    mockExecuteRaw.mockResolvedValue(rawResult([[null]]));
    expect(await ratesRepo.latestFetchedAt()).toBeNull();
  });
});
