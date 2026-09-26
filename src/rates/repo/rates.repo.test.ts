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

// The connection is now opened lazily behind `initDatabase()` (the SQLCipher
// key is async), so the executing reads below need a live connection. Mock the
// encrypted-open to hand back the same op-sqlite fake this file already models,
// then `initDatabase()` once so `rawDatabase` forwards `executeRaw` to the mock.
jest.mock('@kiko/db/encrypted-database', () => ({
  openEncryptedDatabase: async () => ({
    execute: async () => ({ rows: [], rowsAffected: 0 }),
    executeRaw: (...args: unknown[]) => mockExecuteRaw(...args),
  }),
}));

// `upsertMany` runs its insert(s) through the `write` helper (one op-sqlite
// transaction). Override `write` to run the callback against a fake
// transaction handle and count invocations, so a test can prove every chunk
// of a large batch runs inside the SAME transaction — the same pattern
// `rateHistoryRepo`'s own chunking test uses (`rate-history.repo.test.ts`).
let mockDatabaseTransaction: unknown;
let writeCalls = 0;
jest.mock('@kiko/db/client', () => {
  const actual = jest.requireActual('@kiko/db/client');

  return {
    ...actual,
    write: (work: (db: unknown) => unknown) => {
      writeCalls += 1;

      return work(mockDatabaseTransaction);
    },
  };
});

import { initDatabase, type CurrencyRateRow } from '@kiko/db';

import { currencyOptions } from '../../currency/currency';

import { ratesRepo } from './rates.repo';

const rawResult = (rawRows: unknown[][]) => ({
  rawRows,
  columnNames: ['fetchedAt'],
  rowsAffected: 0,
});

// currency_rates binds 5 params/row (base, quote, rate, source, fetchedAt).
// SQLITE_MAX_VARIABLE_NUMBER is 32766 — a fake `.values(...)` call that
// receives more rows than that fits models op-sqlite's real rejection, so
// an unchunked insert fails this test the same way it fails on device.
const PARAMS_PER_ROW = 5;
const SQLITE_MAX_VARIABLE_NUMBER = 32_766;

type NewRate = Pick<CurrencyRateRow, 'base' | 'quote' | 'rate' | 'source' | 'fetchedAt'>;

// A fake `insert(...).values(...).onConflictDoUpdate(...)` chain backed by a
// plain array, recording each `.values(...)` call's row count so a test can
// assert every executed statement stays under the bound-parameter ceiling.
const makeUpsertDatabaseTransaction = (store: NewRate[], chunkSizes: number[]): unknown => ({
  insert: () => ({
    values: (rows: NewRate[]) => {
      if (rows.length * PARAMS_PER_ROW > SQLITE_MAX_VARIABLE_NUMBER) {
        throw new Error('too many SQL variables');
      }
      chunkSizes.push(rows.length);

      return {
        onConflictDoUpdate: () => {
          for (const row of rows) {
            const index = store.findIndex(
              (existing) => existing.base === row.base && existing.quote === row.quote,
            );

            if (index >= 0) {
              store[index] = { ...row };
            } else {
              store.push({ ...row });
            }
          }

          return Promise.resolve();
        },
      };
    },
  }),
});

// 110 currencies x 109 cross pairs each = 11,990 rows — the legacy cross-join
// shape a live Monobank sync stored before the UAH-star rewrite (a live sync
// now writes ~109 rows, one `X:UAH` per priced currency); still the largest
// batch `upsertMany`'s chunking must survive, since a `.kiko` restore of a
// pre-star export can still hand it a legacy-shaped batch this size.
const buildRates = (): NewRate[] => {
  const rows: NewRate[] = [];

  for (const base of currencyOptions) {
    for (const quote of currencyOptions) {
      if (base === quote) {
        continue;
      }
      rows.push({ base, quote, rate: '1.5', source: 'monobank', fetchedAt: 1_700_000_000_000 });
    }
  }

  return rows;
};

describe('ratesRepo', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  it('builds an all-rates query against the currency_rates table', () => {
    expect(ratesRepo.allQuery().toSQL().sql).toContain('currency_rates');
  });

  it('builds a distinct-currency presence query against the currency_rates table', () => {
    const sql = ratesRepo.presentCurrenciesQuery().toSQL().sql;
    expect(sql).toContain('currency_rates');
    expect(sql.toLowerCase()).toContain('distinct');
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

  describe('upsertMany', () => {
    beforeEach(() => {
      writeCalls = 0;
    });

    it('chunks a full-sync batch under the SQLite bound-parameter limit, in one transaction', async () => {
      const store: NewRate[] = [];
      const chunkSizes: number[] = [];
      mockDatabaseTransaction = makeUpsertDatabaseTransaction(store, chunkSizes);

      const rates = buildRates();
      expect(rates).toHaveLength(11_990);

      await ratesRepo.upsertMany(rates);

      // Every chunk stayed under the bound-parameter ceiling (the fake
      // transaction above throws otherwise), more than one chunk was needed, and no
      // row was lost or duplicated across the chunk boundaries.
      expect(chunkSizes.length).toBeGreaterThan(1);

      for (const size of chunkSizes) {
        expect(size * PARAMS_PER_ROW).toBeLessThanOrEqual(SQLITE_MAX_VARIABLE_NUMBER);
      }
      expect(chunkSizes.reduce((sum, size) => sum + size, 0)).toBe(11_990);
      expect(store).toHaveLength(11_990);
      // All chunks ran inside the same single write (one op-sqlite transaction).
      expect(writeCalls).toBe(1);
    });

    it('issues no insert for an empty batch', async () => {
      const store: NewRate[] = [];
      const chunkSizes: number[] = [];
      mockDatabaseTransaction = makeUpsertDatabaseTransaction(store, chunkSizes);

      await ratesRepo.upsertMany([]);

      expect(chunkSizes).toHaveLength(0);
      expect(store).toHaveLength(0);
    });
  });
});
