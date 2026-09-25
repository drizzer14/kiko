// src/data-transfer/snapshot/restore-snapshot.test.ts
let mockDatabaseTransaction: unknown;
jest.mock('../../db/client', () => {
  const actual = jest.requireActual('../../db/client');
  return { ...actual, write: (work: (db: unknown) => unknown) => work(mockDatabaseTransaction) };
});

import { getTableColumns } from 'drizzle-orm';

import {
  accounts,
  bondRegister,
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
  if (table === bondRegister) return 'bondRegister';
  throw new Error('unknown table');
};

// Shared by every test below that only cares WHAT got inserted (not
// deletion order) — a no-op `delete`, and an `insert` that accumulates
// every table's rows by name so a test can assert on one table's own list.
const makeRowCapturingDatabaseTransaction = (): {
  databaseTransaction: unknown;
  insertedRows: Record<string, unknown[]>;
} => {
  const insertedRows: Record<string, unknown[]> = {};
  const databaseTransaction = {
    delete: () => Promise.resolve(),
    insert: (table: unknown) => ({
      values: (rows: unknown[]) => {
        const name = tableNameOf(table);
        insertedRows[name] = [...(insertedRows[name] ?? []), ...rows];
        return Promise.resolve();
      },
    }),
  };

  return { databaseTransaction, insertedRows };
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
  bondRegister: [],
};

describe('restoreDataSnapshot', () => {
  it('deletes every table child-first, then inserts every table parent-first', async () => {
    const deletedTables: string[] = [];
    const insertedTables: string[] = [];
    const insertedRows: Record<string, unknown[]> = {};

    mockDatabaseTransaction = {
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
      'bondRegister',
    ]);
    // `categories` appears here even though this snapshot carries none: the
    // `loan_interest` reseed (below) always runs, even into an empty table.
    expect(insertedTables).toEqual(['accounts', 'holdings', 'categories', 'transactions']);
    expect(insertedRows.accounts).toEqual([{ id: 'a1' }]);
    // `{ id: 'h1' }` carries no `balanceSetAt` key — the legacy-backfill path
    // (see the dedicated tests below) stamps `null` since `t1` (this test's
    // only transaction row) has no matching `holdingId`/shape.
    expect(insertedRows.holdings).toEqual([{ id: 'h1', balanceSetAt: null }]);
    expect(insertedRows.transactions).toEqual([{ id: 't1' }]);
  });

  it('skips the insert entirely for every OTHER table with no rows (no empty .values([]) call)', async () => {
    const { databaseTransaction, insertedRows } = makeRowCapturingDatabaseTransaction();
    mockDatabaseTransaction = databaseTransaction;

    await restoreDataSnapshot(emptySnapshot);

    // `categories` is the one exception: the `loan_interest` reseed always
    // inserts, even from an otherwise-empty snapshot.
    expect(Object.keys(insertedRows)).toEqual(['categories']);
  });

  // A pre-0039 `.kiko` file was exported before `loan_interest` existed, and
  // REPLACE deletes the whole `categories` table before re-inserting the
  // snapshot's own rows, so nothing re-seeds it afterward the way migration
  // 0039 does on a fresh install — a restored user's linked-payment interest
  // would silently land under "Other" and the category would vanish from
  // the picker.
  describe('loan_interest category reseed (a pre-0039 snapshot never had it)', () => {
    it('appends loan_interest at one past every OTHER category, when the snapshot has none', async () => {
      const { databaseTransaction, insertedRows } = makeRowCapturingDatabaseTransaction();
      mockDatabaseTransaction = databaseTransaction;

      await restoreDataSnapshot({
        ...emptySnapshot,
        categories: [
          { key: 'groceries', title: 'Groceries', icon: 'cart', color: null, sortOrder: 0 },
        ] as never,
      });

      expect(insertedRows.categories).toEqual([
        { key: 'groceries', title: 'Groceries', icon: 'cart', color: null, sortOrder: 0 },
        {
          key: 'loan_interest',
          title: 'Loan interest',
          icon: 'percent',
          color: '#5E5CE6',
          sortOrder: 1,
        },
      ]);
    });

    it('does not duplicate or overwrite the snapshot own loan_interest row when it already has one', async () => {
      const { databaseTransaction, insertedRows } = makeRowCapturingDatabaseTransaction();
      mockDatabaseTransaction = databaseTransaction;
      // A post-0039 export, carrying the user's OWN edited title/color.
      const ownLoanInterest = {
        key: 'loan_interest',
        title: 'Interest expense',
        icon: 'percent',
        color: '#123456',
        sortOrder: 7,
      };

      await restoreDataSnapshot({
        ...emptySnapshot,
        categories: [ownLoanInterest] as never,
      });

      expect(insertedRows.categories).toEqual([ownLoanInterest]);
    });
  });

  it('inserts a snapshot pricePoints row into the price_points table', async () => {
    const { databaseTransaction, insertedRows } = makeRowCapturingDatabaseTransaction();
    mockDatabaseTransaction = databaseTransaction;

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
    const { databaseTransaction, insertedRows } = makeRowCapturingDatabaseTransaction();
    mockDatabaseTransaction = databaseTransaction;
    // Simulates a `.kiko` file exported before `price_points` existed — the
    // JS object literally carries no `pricePoints` key, despite
    // `DataSnapshot` declaring it required.
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

    expect(Object.keys(insertedRows)).not.toContain('pricePoints');
  });

  it('inserts a snapshot bondRegister row into the bond_register table', async () => {
    const { databaseTransaction, insertedRows } = makeRowCapturingDatabaseTransaction();
    mockDatabaseTransaction = databaseTransaction;

    await restoreDataSnapshot({
      ...emptySnapshot,
      bondRegister: [
        {
          isin: 'UA4000234215',
          terms: { isin: 'UA4000234215', currency: 'UAH' },
          fetchedAt: 1,
        },
      ] as never,
    });

    expect(insertedRows.bondRegister).toEqual([
      { isin: 'UA4000234215', terms: { isin: 'UA4000234215', currency: 'UAH' }, fetchedAt: 1 },
    ]);
  });

  it('restores an empty bond_register table for a legacy (pre-T24) snapshot with no bondRegister field', async () => {
    const { databaseTransaction, insertedRows } = makeRowCapturingDatabaseTransaction();
    mockDatabaseTransaction = databaseTransaction;
    // Simulates a `.kiko` file exported before `bond_register` existed — the
    // JS object literally carries no `bondRegister` key, despite
    // `DataSnapshot` declaring it required.
    const legacySnapshot = { ...emptySnapshot } as unknown as Record<string, unknown>;
    delete legacySnapshot.bondRegister;

    await restoreDataSnapshot(legacySnapshot as unknown as DataSnapshot);

    expect(Object.keys(insertedRows)).not.toContain('bondRegister');
  });

  // A chunk size fixed in rows (2000), rather than derived from a table's
  // column count, broke silently the moment a later migration added 3
  // columns to `transactions` (15 -> 18): 2000 rows x 18 columns = 36000
  // bound parameters, over SQLite's 32766 ceiling, so a real backup with
  // >= 1821 transactions failed to restore. This test binds a FULL-SHAPED
  // transaction row (every column `transactions` actually declares, via
  // `getTableColumns`) so the assertion exercises the real per-row
  // parameter count, not a 1-key stub — it would have failed against the
  // old fixed 2000-row chunk size.
  it('chunks a large table at a size derived from its OWN column count (SQLite bound-parameter safety)', async () => {
    const insertedChunkSizes: number[] = [];
    mockDatabaseTransaction = {
      delete: () => Promise.resolve(),
      insert: (table: unknown) => ({
        values: (rows: unknown[]) => {
          // Scoped to `transactions`: the `loan_interest` reseed also
          // inserts into `categories` on every restore, which would
          // otherwise inflate this table's own row-count total below.
          if (table === transactions) {
            insertedChunkSizes.push(rows.length);
          }
          return Promise.resolve();
        },
      }),
    };

    const transactionColumnNames = Object.keys(getTableColumns(transactions));
    const fullShapedRow = (id: string): Record<string, unknown> =>
      Object.fromEntries(transactionColumnNames.map((name) => [name, name === 'id' ? id : null]));
    const bigTransactions = Array.from({ length: 4500 }, (_, i) => fullShapedRow(`t${i}`));

    await restoreDataSnapshot({ ...emptySnapshot, transactions: bigTransactions as never });

    // Every chunk must bind well under SQLite's 32766-parameter ceiling —
    // the old fixed 2000-row chunk bound 2000 * 18 = 36000 and would fail
    // this assertion.
    const boundParametersPerChunk = insertedChunkSizes.map(
      (size) => size * transactionColumnNames.length,
    );
    for (const bound of boundParametersPerChunk) {
      expect(bound).toBeLessThanOrEqual(32766);
    }
    expect(insertedChunkSizes.reduce((sum, size) => sum + size, 0)).toBe(4500);
    expect(insertedChunkSizes.length).toBeGreaterThan(1);
  });

  // A `.kiko` exported before the loan-link columns existed carries
  // transaction rows with NO `loanHoldingId`/`loanLinkSource`/`loanLinkRejected`
  // keys at all. `restoreDataSnapshot` inserts every transaction row verbatim
  // (unlike `holdings`, it applies no per-row backfill), so such a row must
  // still restore untouched rather than throw or gain injected `undefined`
  // keys — SQLite then defaults the missing columns itself (null / false),
  // exactly like every other nullable column added after `transactions` first
  // shipped (`counterIban`, `changeGroupId`).
  it('restores a legacy transaction row with no loan-link keys unchanged', async () => {
    const { databaseTransaction, insertedRows } = makeRowCapturingDatabaseTransaction();
    mockDatabaseTransaction = databaseTransaction;
    const legacyTransaction = { id: 't1', holdingId: 'h1', source: 'manual' };

    await restoreDataSnapshot({
      ...emptySnapshot,
      transactions: [legacyTransaction] as never,
    });

    expect(insertedRows.transactions).toEqual([legacyTransaction]);
    expect(insertedRows.transactions?.[0]).not.toHaveProperty('loanHoldingId');
  });

  // A build-25-shaped `.kiko` export (before `holdings.balance_set_at`
  // existed) carries holdings rows with NO `balanceSetAt` key at all.
  // Restoring one must backfill it the SAME way migration 0036
  // (`drizzle/migrations/0036_add_balance_set_at.sql`) did
  // on-device, so a later statement import applies the real boundary rule
  // (`transactionsRepo.importRows`'s doc comment,
  // `transactions/repo/transactions.repo.ts`) instead of treating every row
  // as boundary-less.
  describe('legacy balanceSetAt backfill (build-25-shaped snapshot)', () => {
    const captureHoldingsInsert = (): {
      mockDatabaseTransaction: unknown;
      insertedHoldings: () => Record<string, unknown>[];
    } => {
      const { databaseTransaction, insertedRows } = makeRowCapturingDatabaseTransaction();

      return {
        mockDatabaseTransaction: databaseTransaction,
        insertedHoldings: () => (insertedRows.holdings ?? []) as Record<string, unknown>[],
      };
    };

    it("backfills a legacy holding's balanceSetAt from the LATEST matching manual balance-set-shaped row", async () => {
      const { mockDatabaseTransaction: databaseTransaction, insertedHoldings } =
        captureHoldingsInsert();
      mockDatabaseTransaction = databaseTransaction;

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
      const { mockDatabaseTransaction: databaseTransaction, insertedHoldings } =
        captureHoldingsInsert();
      mockDatabaseTransaction = databaseTransaction;

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
      const { mockDatabaseTransaction: databaseTransaction, insertedHoldings } =
        captureHoldingsInsert();
      mockDatabaseTransaction = databaseTransaction;

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

    // Pins EVERY predicate clause in `isBalanceSetShapedRow` plus the map's
    // per-holding bucketing, one near-miss row at a time — each row is
    // IDENTICAL to a real hand-set-shaped match except for exactly ONE
    // field, so deleting any single clause makes exactly that row spuriously
    // qualify and the `null` expectation below goes red. Manually verified
    // for `source` and `category`: temporarily deleting either clause from
    // `isBalanceSetShapedRow` turns this test red.
    it('excludes a row that differs from a real match in exactly ONE predicate field, for every field', async () => {
      const { mockDatabaseTransaction: databaseTransaction, insertedHoldings } =
        captureHoldingsInsert();
      mockDatabaseTransaction = databaseTransaction;

      await restoreDataSnapshot({
        ...emptySnapshot,
        holdings: [{ id: 'h1', balanceMinorUnits: 5_000 }] as never,
        transactions: [
          // Wrong source (a synced row can't be a hand-set balance).
          {
            id: 't-source',
            holdingId: 'h1',
            source: 'monobank',
            description: '',
            category: null,
            exchangeCounterpartHoldingId: null,
            changeGroupId: null,
            time: 100,
          },
          // Wrong description (a real, named spend).
          {
            id: 't-description',
            holdingId: 'h1',
            source: 'manual',
            description: 'Coffee',
            category: null,
            exchangeCounterpartHoldingId: null,
            changeGroupId: null,
            time: 200,
          },
          // Wrong category (a categorized manual entry).
          {
            id: 't-category',
            holdingId: 'h1',
            source: 'manual',
            description: '',
            category: 'food',
            exchangeCounterpartHoldingId: null,
            changeGroupId: null,
            time: 300,
          },
          // Wrong exchangeCounterpartHoldingId (an exchange leg).
          {
            id: 't-exchange',
            holdingId: 'h1',
            source: 'manual',
            description: '',
            category: null,
            exchangeCounterpartHoldingId: 'h2',
            changeGroupId: null,
            time: 400,
          },
          // Wrong changeGroupId (a change-return row).
          {
            id: 't-change-group',
            holdingId: 'h1',
            source: 'manual',
            description: '',
            category: null,
            exchangeCounterpartHoldingId: null,
            changeGroupId: 'g1',
            time: 500,
          },
          // Wrong holdingId (a real hand-set-shaped row, but on a DIFFERENT
          // holding — must not backfill h1).
          {
            id: 't-holding',
            holdingId: 'h2',
            source: 'manual',
            description: '',
            category: null,
            exchangeCounterpartHoldingId: null,
            changeGroupId: null,
            time: 600,
          },
        ] as never,
      });

      expect(insertedHoldings()).toEqual([
        { id: 'h1', balanceMinorUnits: 5_000, balanceSetAt: null },
      ]);
    });

    it('leaves a snapshot that already carries a NULL balanceSetAt unchanged (not recomputed from a matching row)', async () => {
      const { mockDatabaseTransaction: databaseTransaction, insertedHoldings } =
        captureHoldingsInsert();
      mockDatabaseTransaction = databaseTransaction;

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
