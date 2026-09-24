// `upsertMany` runs its insert through the `write` helper (one op-sqlite
// transaction). Override `write` to run the callback against a fake
// transaction handle backed by an in-memory store, so a test can prove the
// (instrument, day) conflict target replaces an existing row in place rather
// than inserting a duplicate — mirrors
// `src/rates/rate-history-repo/rate-history.repo.test.ts`.
let mockDatabaseTransaction: unknown;
jest.mock('../../db/client', () => {
  const actual = jest.requireActual('../../db/client');
  return {
    ...actual,
    write: (work: (db: unknown) => unknown) => work(mockDatabaseTransaction),
  };
});

import type { PricePointRow } from '../../db/schema';

import { pricePointsRepo } from './price-points.repo';

type Row = Pick<PricePointRow, 'instrument' | 'day' | 'price' | 'currency' | 'source'>;

const makeUpsertDatabaseTransaction = (store: Row[]): unknown => ({
  insert: () => ({
    values: (rows: Row[]) => ({
      onConflictDoUpdate: () => {
        for (const row of rows) {
          const index = store.findIndex(
            (existing) => existing.instrument === row.instrument && existing.day === row.day,
          );
          if (index >= 0) {
            store[index] = { ...row };
          } else {
            store.push({ ...row });
          }
        }
        return Promise.resolve();
      },
    }),
  }),
});

const DAY = 24 * 60 * 60 * 1000;
const day1 = Date.UTC(2026, 8, 4);
const day2 = day1 + DAY;

describe('pricePointsRepo', () => {
  it('builds a whole-table query against the price_points table', () => {
    expect(pricePointsRepo.allQuery().toSQL().sql).toContain('price_points');
  });

  it('overwrites price and source on a repeat (instrument, day) upsert', async () => {
    const store: Row[] = [];
    mockDatabaseTransaction = makeUpsertDatabaseTransaction(store);

    await pricePointsRepo.upsertMany([
      { instrument: 'share:AAPL', day: day1, price: '190.00', currency: 'USD', source: 'eodhd' },
    ]);
    await pricePointsRepo.upsertMany([
      { instrument: 'share:AAPL', day: day1, price: '195.50', currency: 'USD', source: 'manual' },
    ]);

    expect(store).toHaveLength(1);
    expect(store[0].price).toBe('195.50');
    expect(store[0].source).toBe('manual');
  });

  it('keeps a distinct row per (instrument, day)', async () => {
    const store: Row[] = [];
    mockDatabaseTransaction = makeUpsertDatabaseTransaction(store);

    await pricePointsRepo.upsertMany([
      { instrument: 'share:AAPL', day: day1, price: '190.00', currency: 'USD', source: 'eodhd' },
      { instrument: 'share:AAPL', day: day2, price: '191.00', currency: 'USD', source: 'eodhd' },
    ]);

    expect(store).toHaveLength(2);
  });

  it('chunks a large batch into insert statements under the SQLite variable limit', async () => {
    const store: Row[] = [];
    const chunkSizes: number[] = [];
    const upsertStore = makeUpsertDatabaseTransaction(store);
    mockDatabaseTransaction = {
      insert: () => ({
        values: (rows: Row[]) => {
          chunkSizes.push(rows.length);
          return (upsertStore as { insert: () => { values: (r: Row[]) => unknown } })
            .insert()
            .values(rows);
        },
      }),
    };

    const rows: Row[] = Array.from({ length: 5000 }, (_, index) => ({
      instrument: 'share:AAPL',
      day: day1 + index * DAY,
      price: String(190 + index),
      currency: 'USD',
      source: 'eodhd',
    }));

    await pricePointsRepo.upsertMany(rows);

    expect(chunkSizes.length).toBeGreaterThan(1);
    for (const size of chunkSizes) {
      expect(size).toBeLessThanOrEqual(2000);
    }
    expect(chunkSizes.reduce((sum, size) => sum + size, 0)).toBe(5000);
    expect(store).toHaveLength(5000);
  });

  it('issues no insert for an empty batch', async () => {
    let insertCalled = false;
    mockDatabaseTransaction = {
      insert: () => {
        insertCalled = true;
        return { values: () => ({ onConflictDoUpdate: () => Promise.resolve() }) };
      },
    };

    await pricePointsRepo.upsertMany([]);

    expect(insertCalled).toBe(false);
  });

  it('deletes every row for one instrument', async () => {
    const deleted: { instrument: string }[] = [];
    mockDatabaseTransaction = {
      delete: () => ({
        where: () => {
          deleted.push({ instrument: 'called' });
          return Promise.resolve();
        },
      }),
    };

    await pricePointsRepo.removeInstrument('share:AAPL');

    expect(deleted).toHaveLength(1);
  });
});
