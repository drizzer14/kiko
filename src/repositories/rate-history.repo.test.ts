jest.mock('@op-engineering/op-sqlite', () => ({
  open: () => ({ execute: () => ({ rows: [] }) }),
}));

// `upsertMany` runs its insert through the `write` helper (one op-sqlite
// transaction). Override `write` to run the callback against a fake
// transaction handle backed by an in-memory store, so a test can prove the
// (base, quote, day) conflict target replaces an existing row in place rather
// than inserting a duplicate.
let mockTx: unknown;
jest.mock('../db/client', () => {
  const actual = jest.requireActual('../db/client');
  return {
    ...actual,
    write: (work: (db: unknown) => unknown) => work(mockTx),
  };
});

import type { CurrencyRateHistoryRow } from '../db/schema';
import { earliestRateTable, rateHistoryRepo, rateTableAt } from './rate-history.repo';

type HistoryRow = Pick<CurrencyRateHistoryRow, 'base' | 'quote' | 'day' | 'rate' | 'source'>;

// A fake `insert(...).values(...).onConflictDoUpdate(...)` chain backed by a
// plain array. The `excluded.*` set clause means "overwrite with the incoming
// row's values", so the fake simply upserts each incoming row by the composite
// (base, quote, day) key — replacing on match, appending otherwise.
const makeUpsertTx = (store: HistoryRow[]): unknown => ({
  insert: () => ({
    values: (rows: HistoryRow[]) => ({
      onConflictDoUpdate: () => {
        for (const row of rows) {
          const index = store.findIndex(
            (existing) =>
              existing.base === row.base &&
              existing.quote === row.quote &&
              existing.day === row.day,
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
const friday = Date.UTC(2026, 8, 4); // 2026-09-04, a Friday, UTC midnight
const saturday = friday + DAY;
const sunday = friday + 2 * DAY;
const monday = friday + 3 * DAY;

describe('rateHistoryRepo', () => {
  it('builds a whole-history query against the currency_rate_history table', () => {
    expect(rateHistoryRepo.historyRowsQuery().toSQL().sql).toContain('currency_rate_history');
  });

  it('replaces an existing (base, quote, day) row on a repeat upsert', async () => {
    const store: HistoryRow[] = [];
    mockTx = makeUpsertTx(store);

    await rateHistoryRepo.upsertMany([
      { base: 'USD', quote: 'UAH', day: friday, rate: '41.5', source: 'nbu' },
    ]);
    await rateHistoryRepo.upsertMany([
      { base: 'USD', quote: 'UAH', day: friday, rate: '42.0', source: 'nbu' },
    ]);

    expect(store).toHaveLength(1);
    expect(store[0].rate).toBe('42.0');
  });

  it('chunks a large batch into insert statements under the SQLite variable limit', async () => {
    // 12 cross pairs/day at 5 params each: a multi-year span produces tens of
    // thousands of rows. A single insert would blow past SQLITE_MAX_VARIABLE_NUMBER
    // (32766), so upsertMany must split the rows into bounded chunks.
    const store: HistoryRow[] = [];
    const chunkSizes: number[] = [];
    const upsertStore = makeUpsertTx(store);
    mockTx = {
      insert: () => ({
        values: (rows: HistoryRow[]) => {
          chunkSizes.push(rows.length);
          return (upsertStore as { insert: () => { values: (r: HistoryRow[]) => unknown } })
            .insert()
            .values(rows);
        },
      }),
    };

    const rows: HistoryRow[] = Array.from({ length: 5000 }, (_, index) => ({
      base: 'USD',
      quote: 'UAH',
      day: friday + index * DAY,
      rate: String(40 + index),
      source: 'nbu',
    }));

    await rateHistoryRepo.upsertMany(rows);

    // Every chunk stays well under the 32766 variable ceiling (chunk * 5 params).
    expect(chunkSizes.length).toBeGreaterThan(1);
    for (const size of chunkSizes) {
      expect(size).toBeLessThanOrEqual(2000);
      expect(size * 5).toBeLessThan(32_766);
    }
    // No row is lost or duplicated across the chunk boundaries.
    expect(chunkSizes.reduce((sum, size) => sum + size, 0)).toBe(5000);
    expect(store).toHaveLength(5000);
  });

  it('issues no insert for an empty batch', async () => {
    const store: HistoryRow[] = [];
    let insertCalled = false;
    mockTx = {
      insert: () => {
        insertCalled = true;
        return { values: () => ({ onConflictDoUpdate: () => Promise.resolve() }) };
      },
    };

    await rateHistoryRepo.upsertMany([]);

    expect(insertCalled).toBe(false);
    expect(store).toHaveLength(0);
  });
});

describe('rateTableAt', () => {
  it('uses an exact-day row when one exists', () => {
    const rows: HistoryRow[] = [
      { base: 'USD', quote: 'UAH', day: friday, rate: '41.5', source: 'nbu' },
    ];
    expect(rateTableAt(rows, friday)).toEqual({ 'USD:UAH': 41.5 });
  });

  it('carries a Friday rate forward across a weekend gap (Saturday, Sunday)', () => {
    const rows: HistoryRow[] = [
      { base: 'USD', quote: 'UAH', day: friday, rate: '41.5', source: 'nbu' },
      { base: 'USD', quote: 'UAH', day: monday, rate: '43.0', source: 'nbu' },
    ];
    expect(rateTableAt(rows, saturday)).toEqual({ 'USD:UAH': 41.5 });
    expect(rateTableAt(rows, sunday)).toEqual({ 'USD:UAH': 41.5 });
    // Monday has its own row again.
    expect(rateTableAt(rows, monday)).toEqual({ 'USD:UAH': 43.0 });
  });

  it('omits a pair that has no row at or before the requested day', () => {
    const rows: HistoryRow[] = [
      { base: 'USD', quote: 'UAH', day: monday, rate: '43.0', source: 'nbu' },
    ];
    expect(rateTableAt(rows, friday)).toEqual({});
  });

  it('resolves multiple pairs independently, each to its own nearest prior day', () => {
    const rows: HistoryRow[] = [
      { base: 'USD', quote: 'UAH', day: friday, rate: '41.5', source: 'nbu' },
      { base: 'EUR', quote: 'UAH', day: monday, rate: '48.0', source: 'nbu' },
      { base: 'BTC', quote: 'USD', day: saturday, rate: '65000', source: 'coingecko' },
    ];
    // At Sunday: USD carried from Friday, BTC carried from Saturday, EUR not yet
    // present (its only row is Monday, after Sunday).
    expect(rateTableAt(rows, sunday)).toEqual({
      'USD:UAH': 41.5,
      'BTC:USD': 65000,
    });
    // At Monday: all three resolve.
    expect(rateTableAt(rows, monday)).toEqual({
      'USD:UAH': 41.5,
      'EUR:UAH': 48.0,
      'BTC:USD': 65000,
    });
  });
});

describe('earliestRateTable', () => {
  it('resolves each pair to its earliest stored day', () => {
    const rows: HistoryRow[] = [
      { base: 'USD', quote: 'UAH', day: monday, rate: '43.0', source: 'nbu' },
      { base: 'USD', quote: 'UAH', day: friday, rate: '41.5', source: 'nbu' },
      { base: 'EUR', quote: 'UAH', day: sunday, rate: '48.0', source: 'nbu' },
    ];
    // USD's earliest is Friday (not the later Monday row); EUR's only day is Sunday.
    expect(earliestRateTable(rows)).toEqual({
      'USD:UAH': 41.5,
      'EUR:UAH': 48.0,
    });
  });

  it('skips a row whose stored rate does not parse to a finite number', () => {
    const rows: HistoryRow[] = [
      { base: 'USD', quote: 'UAH', day: friday, rate: 'not-a-number', source: 'nbu' },
    ];
    expect(earliestRateTable(rows)).toEqual({});
  });

  it('is empty for no rows', () => {
    expect(earliestRateTable([])).toEqual({});
  });
});
