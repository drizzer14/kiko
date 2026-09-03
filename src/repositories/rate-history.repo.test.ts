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
import { rateHistoryRepo, rateTableAt } from './rate-history.repo';

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
