// src/data-transfer/snapshot/restore-snapshot.test.ts
let mockTx: unknown;
jest.mock('../../db/client', () => {
  const actual = jest.requireActual('../../db/client');
  return { ...actual, write: (work: (db: unknown) => unknown) => work(mockTx) };
});

import {
  accounts,
  categories,
  categoryOverrides,
  currencyRateHistory,
  currencyRates,
  holdings,
  settings,
  syncState,
  transactions,
} from '../../db/schema';
import type { DataSnapshot } from './data-snapshot';

import { restoreDataSnapshot } from './restore-snapshot';

const tableNameOf = (table: unknown): string => {
  if (table === accounts) return 'accounts';
  if (table === holdings) return 'holdings';
  if (table === transactions) return 'transactions';
  if (table === currencyRates) return 'currencyRates';
  if (table === currencyRateHistory) return 'currencyRateHistory';
  if (table === settings) return 'settings';
  if (table === syncState) return 'syncState';
  if (table === categories) return 'categories';
  if (table === categoryOverrides) return 'categoryOverrides';
  throw new Error('unknown table');
};

const emptySnapshot: DataSnapshot = {
  accounts: [],
  holdings: [],
  transactions: [],
  currencyRates: [],
  currencyRateHistory: [],
  settings: [],
  syncState: [],
  categories: [],
  categoryOverrides: [],
};

describe('restoreDataSnapshot', () => {
  it('deletes every table child-first, then inserts every table parent-first', async () => {
    const deletedTables: string[] = [];
    const insertedTables: string[] = [];
    const insertedRows: Record<string, unknown[]> = {};

    mockTx = {
      delete: (table: unknown) => {
        deletedTables.push(tableNameOf(table));
        return Promise.resolve();
      },
      insert: (table: unknown) => ({
        values: (rows: unknown[]) => {
          const name = tableNameOf(table);
          insertedTables.push(name);
          insertedRows[name] = [...(insertedRows[name] ?? []), ...rows];
          return Promise.resolve();
        },
      }),
    };

    await restoreDataSnapshot({
      ...emptySnapshot,
      accounts: [{ id: 'a1' }] as never,
      holdings: [{ id: 'h1' }] as never,
      transactions: [{ id: 't1' }] as never,
    });

    expect(deletedTables).toEqual([
      'transactions',
      'syncState',
      'holdings',
      'accounts',
      'categoryOverrides',
      'categories',
      'currencyRateHistory',
      'currencyRates',
      'settings',
    ]);
    expect(insertedTables).toEqual(['accounts', 'holdings', 'transactions']);
    expect(insertedRows.accounts).toEqual([{ id: 'a1' }]);
    expect(insertedRows.holdings).toEqual([{ id: 'h1' }]);
    expect(insertedRows.transactions).toEqual([{ id: 't1' }]);
  });

  it('skips the insert entirely for a table with no rows (no empty .values([]) call)', async () => {
    const insertedTables: string[] = [];
    mockTx = {
      delete: () => Promise.resolve(),
      insert: (table: unknown) => ({
        values: (rows: unknown[]) => {
          insertedTables.push(tableNameOf(table));
          return Promise.resolve(rows);
        },
      }),
    };

    await restoreDataSnapshot(emptySnapshot);

    expect(insertedTables).toEqual([]);
  });

  it('chunks a large table into inserts of at most 2000 rows (SQLite bound-parameter safety)', async () => {
    const insertedChunkSizes: number[] = [];
    mockTx = {
      delete: () => Promise.resolve(),
      insert: () => ({
        values: (rows: unknown[]) => {
          insertedChunkSizes.push(rows.length);
          return Promise.resolve();
        },
      }),
    };

    const bigTransactions = Array.from({ length: 4500 }, (_, i) => ({ id: `t${i}` }));

    await restoreDataSnapshot({ ...emptySnapshot, transactions: bigTransactions as never });

    expect(insertedChunkSizes).toEqual([2000, 2000, 500]);
  });
});
