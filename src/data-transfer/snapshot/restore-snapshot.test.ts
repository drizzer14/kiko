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
  pricePoints,
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
  if (table === pricePoints) return 'pricePoints';
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
  pricePoints: [],
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
      'pricePoints',
    ]);
    expect(insertedTables).toEqual(['accounts', 'holdings', 'transactions']);
    expect(insertedRows.accounts).toEqual([{ id: 'a1' }]);
    // `{ id: 'h1' }` carries no `balanceSetAt` key — the legacy-backfill path
    // (see the dedicated tests below) stamps `null` since `t1` (this test's
    // only transaction row) has no matching `holdingId`/shape.
    expect(insertedRows.holdings).toEqual([{ id: 'h1', balanceSetAt: null }]);
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

  it('inserts a snapshot pricePoints row into the price_points table', async () => {
    const insertedRows: Record<string, unknown[]> = {};
    mockTx = {
      delete: () => Promise.resolve(),
      insert: (table: unknown) => ({
        values: (rows: unknown[]) => {
          const name = tableNameOf(table);
          insertedRows[name] = [...(insertedRows[name] ?? []), ...rows];
          return Promise.resolve();
        },
      }),
    };

    await restoreDataSnapshot({
      ...emptySnapshot,
      pricePoints: [
        { instrument: 'share:AAPL', day: 1, price: '190.00', currency: 'USD', source: 'eodhd' },
      ] as never,
    });

    expect(insertedRows.pricePoints).toEqual([
      { instrument: 'share:AAPL', day: 1, price: '190.00', currency: 'USD', source: 'eodhd' },
    ]);
  });

  it('restores an empty price_points table for a legacy snapshot with no pricePoints field', async () => {
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
    // Simulates a `.kiko` file exported before T11 — the JS object literally
    // carries no `pricePoints` key, despite `DataSnapshot` declaring it
    // required.
    const {
      accounts: legacyAccounts,
      holdings: legacyHoldings,
      transactions: legacyTransactions,
      currencyRates: legacyCurrencyRates,
      currencyRateHistory: legacyCurrencyRateHistory,
      settings: legacySettings,
      syncState: legacySyncState,
      categories: legacyCategories,
      categoryOverrides: legacyCategoryOverrides,
    } = emptySnapshot;
    const legacySnapshot = {
      accounts: legacyAccounts,
      holdings: legacyHoldings,
      transactions: legacyTransactions,
      currencyRates: legacyCurrencyRates,
      currencyRateHistory: legacyCurrencyRateHistory,
      settings: legacySettings,
      syncState: legacySyncState,
      categories: legacyCategories,
      categoryOverrides: legacyCategoryOverrides,
    } as unknown as DataSnapshot;

    await restoreDataSnapshot(legacySnapshot);

    expect(insertedTables).not.toContain('pricePoints');
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

  // FIX-restore-backfill-brief.md: a build-25-shaped `.kiko` export (before
  // `holdings.balance_set_at` existed) carries holdings rows with NO
  // `balanceSetAt` key at all. Restoring one must backfill it the SAME way
  // migration 0036 (`drizzle/migrations/0036_add_balance_set_at.sql`) did
  // on-device, so a later statement import applies the real boundary rule
  // (`transactionsRepo.importRows`'s doc comment,
  // `transactions/repo/transactions.repo.ts`) instead of treating every row
  // as boundary-less.
  describe('legacy balanceSetAt backfill (build-25-shaped snapshot)', () => {
    const captureHoldingsInsert = (): {
      mockTx: unknown;
      insertedHoldings: () => Record<string, unknown>[];
    } => {
      const insertedRows: Record<string, unknown[]> = {};
      const tx = {
        delete: () => Promise.resolve(),
        insert: (table: unknown) => ({
          values: (rows: unknown[]) => {
            const name = tableNameOf(table);
            insertedRows[name] = [...(insertedRows[name] ?? []), ...rows];
            return Promise.resolve();
          },
        }),
      };

      return {
        mockTx: tx,
        insertedHoldings: () => (insertedRows.holdings ?? []) as Record<string, unknown>[],
      };
    };

    it("backfills a legacy holding's balanceSetAt from the LATEST matching manual balance-set-shaped row", async () => {
      const { mockTx: tx, insertedHoldings } = captureHoldingsInsert();
      mockTx = tx;

      await restoreDataSnapshot({
        ...emptySnapshot,
        holdings: [{ id: 'h1', balanceMinorUnits: 5_000 }] as never,
        transactions: [
          {
            id: 't1',
            holdingId: 'h1',
            source: 'manual',
            description: '',
            category: null,
            exchangeCounterpartHoldingId: null,
            changeGroupId: null,
            time: 100,
          },
          {
            id: 't2',
            holdingId: 'h1',
            source: 'manual',
            description: '',
            category: null,
            exchangeCounterpartHoldingId: null,
            changeGroupId: null,
            time: 300,
          },
        ] as never,
      });

      expect(insertedHoldings()).toEqual([
        { id: 'h1', balanceMinorUnits: 5_000, balanceSetAt: 300 },
      ]);
    });

    it('backfills null when no manual row matches the balance-set shape', async () => {
      const { mockTx: tx, insertedHoldings } = captureHoldingsInsert();
      mockTx = tx;

      await restoreDataSnapshot({
        ...emptySnapshot,
        holdings: [{ id: 'h1', balanceMinorUnits: 5_000 }] as never,
        transactions: [
          // A real spend: carries a description, so it's not a hand-set-shaped row.
          {
            id: 't1',
            holdingId: 'h1',
            source: 'manual',
            description: 'Coffee',
            category: null,
            exchangeCounterpartHoldingId: null,
            changeGroupId: null,
            time: 100,
          },
          // An exchange leg: carries the structural marker.
          {
            id: 't2',
            holdingId: 'h1',
            source: 'manual',
            description: '',
            category: null,
            exchangeCounterpartHoldingId: 'h2',
            changeGroupId: null,
            time: 200,
          },
        ] as never,
      });

      expect(insertedHoldings()).toEqual([
        { id: 'h1', balanceMinorUnits: 5_000, balanceSetAt: null },
      ]);
    });

    it('leaves a snapshot that ALREADY carries balanceSetAt unchanged, even when a manual row would compute differently', async () => {
      const { mockTx: tx, insertedHoldings } = captureHoldingsInsert();
      mockTx = tx;

      await restoreDataSnapshot({
        ...emptySnapshot,
        holdings: [{ id: 'h1', balanceMinorUnits: 5_000, balanceSetAt: 999 }] as never,
        transactions: [
          {
            id: 't1',
            holdingId: 'h1',
            source: 'manual',
            description: '',
            category: null,
            exchangeCounterpartHoldingId: null,
            changeGroupId: null,
            time: 100,
          },
        ] as never,
      });

      expect(insertedHoldings()).toEqual([
        { id: 'h1', balanceMinorUnits: 5_000, balanceSetAt: 999 },
      ]);
    });

    it('leaves a snapshot that already carries a NULL balanceSetAt unchanged (not recomputed from a matching row)', async () => {
      const { mockTx: tx, insertedHoldings } = captureHoldingsInsert();
      mockTx = tx;

      await restoreDataSnapshot({
        ...emptySnapshot,
        holdings: [{ id: 'h1', balanceMinorUnits: 5_000, balanceSetAt: null }] as never,
        transactions: [
          {
            id: 't1',
            holdingId: 'h1',
            source: 'manual',
            description: '',
            category: null,
            exchangeCounterpartHoldingId: null,
            changeGroupId: null,
            time: 100,
          },
        ] as never,
      });

      expect(insertedHoldings()).toEqual([
        { id: 'h1', balanceMinorUnits: 5_000, balanceSetAt: null },
      ]);
    });
  });
});
