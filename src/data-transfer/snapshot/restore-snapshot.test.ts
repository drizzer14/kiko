// src/data-transfer/snapshot/restore-snapshot.test.ts
let mockDatabaseTransaction: unknown;
jest.mock('@kiko/db/client', () => {
  const actual = jest.requireActual('@kiko/db/client');

  return { ...actual, write: (work: (db: unknown) => unknown) => work(mockDatabaseTransaction) };
});

import {
  accounts,
  bondRegister,
  categories,
  categoryOverrides,
  currencyRateHistory,
  currencyRates,
  holdings,
  pricePoints,
  reminders,
  settings,
  syncState,
  transactions,
} from '@kiko/db';
import { getTableColumns } from 'drizzle-orm';
import { holdingValue } from '@kiko/holdings/holding-value';
import { holdingRegisterCoupons } from '@kiko/bonds/nbu-register';
import { computeDedupKeyBase } from '@kiko/statement-import/mapping';
import { rezoneImportTime } from '@kiko/statement-import/rezone-import-times';
import { asBondMeta, binanceHistoryCursorOf } from '@kiko/holdings/holding-metadata';

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

  if (table === reminders) return 'reminders';
  throw new Error('unknown table');
};

// The restore reads the live settings row's quote quota and lock before it deletes it;
// these fakes start from no settings row.
const noLiveSettings = {
  select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
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
    ...noLiveSettings,
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

const NOW = Date.UTC(2026, 0, 1);

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
  reminders: [],
};

describe('restoreDataSnapshot', () => {
  it('deletes every table child-first, then inserts every table parent-first', async () => {
    const deletedTables: string[] = [];
    const insertedTables: string[] = [];
    const insertedRows: Record<string, unknown[]> = {};

    mockDatabaseTransaction = {
      ...noLiveSettings,
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
      'reminders',
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
    expect(insertedRows.holdings).toEqual([
      { id: 'h1', balanceSetAt: null, balanceSetRowId: null },
    ]);
    // `{ id: 't1' }` carries no `setsBalance` key either, and is not a
    // balance-set row, so the migration 0047 mirror leaves it unmarked and
    // the holding with no current balance-set row.
    expect(insertedRows.transactions).toEqual([{ id: 't1', setsBalance: false }]);
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

  describe('property ownership share (carried inside metadata, no restore mirror)', () => {
    const propertyHolding = (metadata: Record<string, unknown>) => ({
      id: 'prop',
      type: 'property_item',
      currency: 'UAH',
      balanceMinorUnits: 0,
      balanceSetAt: null,
      metadata,
    });
    const lots = [{ day: Date.UTC(2024, 0, 1), quantityDelta: '1', costMinorUnits: 900_000 }];

    it('restores a stored ownership list byte-identical', async () => {
      const { databaseTransaction, insertedRows } = makeRowCapturingDatabaseTransaction();
      mockDatabaseTransaction = databaseTransaction;
      const metadata = {
        category: 'real_estate',
        lots,
        ownership: [{ day: Date.UTC(2024, 0, 1), numerator: 1, denominator: 3 }],
        ownershipInput: 'fraction',
      };

      await restoreDataSnapshot({
        ...emptySnapshot,
        holdings: [propertyHolding(metadata)] as never,
      });

      expect(JSON.stringify(insertedRows.holdings)).toBe(
        JSON.stringify([propertyHolding(metadata)]),
      );
      expect(holdingValue(insertedRows.holdings?.[0] as never, NOW).minorUnits).toBe(300_000);
    });

    it('values a pre-share snapshot property as the whole asset', async () => {
      const { databaseTransaction, insertedRows } = makeRowCapturingDatabaseTransaction();
      mockDatabaseTransaction = databaseTransaction;

      await restoreDataSnapshot({
        ...emptySnapshot,
        holdings: [propertyHolding({ category: 'real_estate', lots })] as never,
      });

      expect(holdingValue(insertedRows.holdings?.[0] as never, NOW).minorUnits).toBe(900_000);
    });
  });

  it('restores an empty bond_register table for a legacy snapshot with no bondRegister field', async () => {
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

  it('inserts a snapshot reminders row after its account', async () => {
    const insertedTables: string[] = [];
    const insertedRows: Record<string, unknown[]> = {};

    mockDatabaseTransaction = {
      ...noLiveSettings,
      delete: () => Promise.resolve(),
      insert: (table: unknown) => ({
        values: (rows: unknown[]) => {
          insertedTables.push(tableNameOf(table));
          insertedRows[tableNameOf(table)] = rows;

          return Promise.resolve();
        },
      }),
    };

    await restoreDataSnapshot({
      ...emptySnapshot,
      accounts: [{ id: 'a1' }] as never,
      reminders: [{ id: 'reminder-1', accountId: 'a1', lastSnoozedAt: 5 }] as never,
    });

    expect(insertedRows.reminders).toEqual([
      { id: 'reminder-1', accountId: 'a1', lastSnoozedAt: 5 },
    ]);
    expect(insertedTables.indexOf('reminders')).toBeGreaterThan(insertedTables.indexOf('accounts'));
  });

  // Known limit: an export made before reminders existed restores with no
  // reminders at all.
  it('restores an empty reminders table for a legacy snapshot with no reminders field', async () => {
    const { databaseTransaction, insertedRows } = makeRowCapturingDatabaseTransaction();
    mockDatabaseTransaction = databaseTransaction;
    const legacySnapshot = { ...emptySnapshot } as unknown as Record<string, unknown>;
    delete legacySnapshot.reminders;

    await restoreDataSnapshot(legacySnapshot as unknown as DataSnapshot);

    expect(Object.keys(insertedRows)).not.toContain('reminders');
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
      ...noLiveSettings,
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
  // Mirrors migration 0044: a cash holding in a crypto currency moves onto
  // a new crypto account, the same as a live device upgrade.
  it('moves a cash holding in a crypto currency onto a new crypto account, deleting and inserting every table', async () => {
    const deletedTables: string[] = [];
    const insertedTables: string[] = [];
    const insertedRows: Record<string, unknown[]> = {};

    mockDatabaseTransaction = {
      ...noLiveSettings,
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

    const sourceAccount = {
      id: 'a1',
      name: 'Wallet',
      kind: 'cash',
      institution: null,
      bankId: null,
      icon: null,
      color: null,
      sortOrder: 0,
      archivedAt: null,
      createdAt: 1_700_000_000_000,
    };
    const fiatHolding = {
      id: 'h1',
      accountId: 'a1',
      name: 'Cash',
      type: 'cash',
      currency: 'UAH',
      icon: null,
      color: null,
      balanceMinorUnits: 0,
      syncedBalanceMinorUnits: null,
      balanceSetAt: null,
      metadata: null,
      sortOrder: 0,
      closedAt: null,
      createdAt: 1_700_000_000_000,
    };
    const cryptoCashHolding = {
      ...fiatHolding,
      id: 'h2',
      name: 'Tether',
      currency: 'BTC',
      balanceMinorUnits: 12_345,
    };

    await restoreDataSnapshot({
      ...emptySnapshot,
      accounts: [sourceAccount] as never,
      holdings: [fiatHolding, cryptoCashHolding] as never,
    });

    expect(deletedTables).toEqual([
      'transactions',
      'syncState',
      'reminders',
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
    expect(insertedTables).toEqual(['accounts', 'holdings', 'categories']);
    expect(insertedRows.accounts).toEqual([
      sourceAccount,
      {
        id: 'crypto-from-a1',
        name: 'Wallet',
        kind: 'crypto',
        institution: null,
        bankId: null,
        icon: null,
        color: null,
        sortOrder: 0,
        archivedAt: null,
        createdAt: 1_700_000_000_000,
      },
    ]);
    expect(insertedRows.holdings).toEqual([
      fiatHolding,
      { ...cryptoCashHolding, accountId: 'crypto-from-a1', type: 'crypto_asset' },
    ]);
  });

  // Ruling: an archived source account's holding never joins a LIVE reuse
  // target — it would resurface under an account the user cannot see it
  // moved out of. It gets its own `crypto-from-<source id>` account,
  // carrying the source's own archivedAt, exactly like the no-eligible-
  // target case, even though an eligible reuse target exists elsewhere.
  it('never moves an archived source holding onto a live reuse target', async () => {
    const { databaseTransaction, insertedRows } = makeRowCapturingDatabaseTransaction();
    mockDatabaseTransaction = databaseTransaction;

    const reuseTargetAccount = {
      id: 'cold',
      name: 'Cold',
      kind: 'crypto',
      institution: null,
      bankId: null,
      icon: null,
      color: null,
      sortOrder: 0,
      archivedAt: null,
      createdAt: 1_700_000_000_000,
    };
    const archivedSourceAccount = {
      id: 'old-wallet',
      name: 'Old wallet',
      kind: 'cash',
      institution: null,
      bankId: null,
      icon: null,
      color: null,
      sortOrder: 5,
      archivedAt: 1_690_000_000_000,
      createdAt: 1_600_000_000_000,
    };
    const archivedSourceHolding = {
      id: 'h-usdt',
      accountId: 'old-wallet',
      name: 'Tether',
      type: 'cash',
      currency: 'USDT',
      icon: null,
      color: null,
      balanceMinorUnits: 100,
      syncedBalanceMinorUnits: null,
      balanceSetAt: null,
      metadata: null,
      sortOrder: 0,
      closedAt: null,
      createdAt: 1_600_000_000_000,
    };

    await restoreDataSnapshot({
      ...emptySnapshot,
      accounts: [reuseTargetAccount, archivedSourceAccount] as never,
      holdings: [archivedSourceHolding] as never,
    });

    expect(insertedRows.accounts).toEqual([
      reuseTargetAccount,
      archivedSourceAccount,
      {
        id: 'crypto-from-old-wallet',
        name: 'Old wallet',
        kind: 'crypto',
        institution: null,
        bankId: null,
        icon: null,
        color: null,
        sortOrder: 5,
        archivedAt: 1_690_000_000_000,
        createdAt: 1_600_000_000_000,
      },
    ]);
    expect(insertedRows.holdings).toEqual([
      { ...archivedSourceHolding, accountId: 'crypto-from-old-wallet', type: 'crypto_asset' },
    ]);
  });

  it('restores a crypto currency on a crypto_asset holding', async () => {
    const { databaseTransaction, insertedRows } = makeRowCapturingDatabaseTransaction();
    mockDatabaseTransaction = databaseTransaction;
    const cryptoHolding = { id: 'h1', accountId: 'a1', type: 'crypto_asset', currency: 'BTC' };

    await restoreDataSnapshot({ ...emptySnapshot, holdings: [cryptoHolding] as never });

    expect(insertedRows.holdings).toEqual([expect.objectContaining(cryptoHolding)]);
  });

  it('restores a legacy transaction row with no loan-link keys, adding none', async () => {
    const { databaseTransaction, insertedRows } = makeRowCapturingDatabaseTransaction();
    mockDatabaseTransaction = databaseTransaction;
    const legacyTransaction = { id: 't1', holdingId: 'h1', source: 'manual' };

    await restoreDataSnapshot({
      ...emptySnapshot,
      transactions: [legacyTransaction] as never,
    });

    // Older than the balance-set mark too, which the 0047 mirror derives.
    expect(insertedRows.transactions).toEqual([{ ...legacyTransaction, setsBalance: false }]);
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
        { id: 'h1', balanceMinorUnits: 5_000, balanceSetAt: 300, balanceSetRowId: 't2' },
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
        { id: 'h1', balanceMinorUnits: 5_000, balanceSetAt: null, balanceSetRowId: null },
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
        { id: 'h1', balanceMinorUnits: 5_000, balanceSetAt: 999, balanceSetRowId: null },
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
        { id: 'h1', balanceMinorUnits: 5_000, balanceSetAt: null, balanceSetRowId: null },
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
        { id: 'h1', balanceMinorUnits: 5_000, balanceSetAt: null, balanceSetRowId: null },
      ]);
    });
  });

  // Migration 0040's cleanup (`drizzle/migrations/0040_cleanup_stray_deposit_
  // bond_balance.sql`), mirrored here for a `.kiko` restore: a term_deposit/
  // bond holding carrying a stray create-time opening balance (fixed in
  // 63f9073) restores with that balance zeroed and its one matching
  // transaction dropped — real data (a different type, an edited row, or
  // extra rows) restores byte-identical.
  describe('stray deposit/bond opening-balance cleanup (migration 0040)', () => {
    const strayHolding = (overrides: Partial<Record<string, unknown>> = {}) => ({
      id: 'h1',
      type: 'term_deposit',
      balanceMinorUnits: 50_000,
      balanceSetAt: 1_000,
      ...overrides,
    });

    const strayTransaction = (overrides: Partial<Record<string, unknown>> = {}) => ({
      id: 't1',
      holdingId: 'h1',
      source: 'manual',
      description: '',
      category: null,
      exchangeCounterpartHoldingId: null,
      changeGroupId: null,
      amountMinorUnits: 50_000,
      time: 1_000,
      ...overrides,
    });

    it('zeroes the holding and drops the one matching transaction', async () => {
      const { databaseTransaction, insertedRows } = makeRowCapturingDatabaseTransaction();
      mockDatabaseTransaction = databaseTransaction;

      await restoreDataSnapshot({
        ...emptySnapshot,
        holdings: [strayHolding()] as never,
        transactions: [strayTransaction()] as never,
      });

      expect(insertedRows.holdings).toEqual([
        { id: 'h1', type: 'term_deposit', balanceMinorUnits: 0, balanceSetAt: null },
      ]);
      expect(insertedRows.transactions ?? []).toEqual([]);
    });

    it('applies the identical cleanup to the bond twin', async () => {
      const { databaseTransaction, insertedRows } = makeRowCapturingDatabaseTransaction();
      mockDatabaseTransaction = databaseTransaction;

      await restoreDataSnapshot({
        ...emptySnapshot,
        holdings: [strayHolding({ type: 'bond' })] as never,
        transactions: [strayTransaction()] as never,
      });

      expect(insertedRows.holdings).toEqual([
        { id: 'h1', type: 'bond', balanceMinorUnits: 0, balanceSetAt: null },
      ]);
      expect(insertedRows.transactions ?? []).toEqual([]);
    });

    it('never touches a non-ledgerless holding with the identical numeric shape', async () => {
      const { databaseTransaction, insertedRows } = makeRowCapturingDatabaseTransaction();
      mockDatabaseTransaction = databaseTransaction;
      const cardHolding = strayHolding({ type: 'card' });

      await restoreDataSnapshot({
        ...emptySnapshot,
        holdings: [cardHolding] as never,
        transactions: [strayTransaction()] as never,
      });

      // A card's own opening row: the 0047 mirror marks it as one, and as
      // the holding's current balance-set row.
      expect(insertedRows.holdings).toEqual([{ ...cardHolding, balanceSetRowId: 't1' }]);
      expect(insertedRows.transactions).toEqual([{ ...strayTransaction(), setsBalance: true }]);
    });

    it('leaves a deposit/bond holding whose opening row was edited (a real, differently-shaped row)', async () => {
      const { databaseTransaction, insertedRows } = makeRowCapturingDatabaseTransaction();
      mockDatabaseTransaction = databaseTransaction;
      const editedTransaction = strayTransaction({ description: 'Edited note' });

      await restoreDataSnapshot({
        ...emptySnapshot,
        holdings: [strayHolding()] as never,
        transactions: [editedTransaction] as never,
      });

      expect(insertedRows.holdings).toEqual([strayHolding({ balanceSetRowId: null })]);
      expect(insertedRows.transactions).toEqual([{ ...editedTransaction, setsBalance: false }]);
    });

    it('leaves a deposit/bond holding untouched when more than one transaction row exists', async () => {
      const { databaseTransaction, insertedRows } = makeRowCapturingDatabaseTransaction();
      mockDatabaseTransaction = databaseTransaction;
      const secondTransaction = strayTransaction({ id: 't2', amountMinorUnits: 1, time: 5_000 });

      await restoreDataSnapshot({
        ...emptySnapshot,
        holdings: [strayHolding()] as never,
        transactions: [strayTransaction(), secondTransaction] as never,
      });

      expect(insertedRows.holdings).toEqual([strayHolding({ balanceSetRowId: 't1' })]);
      expect(insertedRows.transactions).toEqual([
        { ...strayTransaction(), setsBalance: true },
        { ...secondTransaction, setsBalance: false },
      ]);
    });

    it('cleans a LEGACY (pre-0036) snapshot too, once the balanceSetAt backfill fills in the boundary the cleanup then matches', async () => {
      const { databaseTransaction, insertedRows } = makeRowCapturingDatabaseTransaction();
      mockDatabaseTransaction = databaseTransaction;
      // No `balanceSetAt` key at all — a build-25-shaped export.
      const legacyHolding = { id: 'h1', type: 'term_deposit', balanceMinorUnits: 50_000 };

      await restoreDataSnapshot({
        ...emptySnapshot,
        holdings: [legacyHolding] as never,
        transactions: [strayTransaction()] as never,
      });

      expect(insertedRows.holdings).toEqual([
        { id: 'h1', type: 'term_deposit', balanceMinorUnits: 0, balanceSetAt: null },
      ]);
      expect(insertedRows.transactions ?? []).toEqual([]);
    });

    it('leaves an already-clean (post-fix) deposit/bond holding untouched (no-op)', async () => {
      const { databaseTransaction, insertedRows } = makeRowCapturingDatabaseTransaction();
      mockDatabaseTransaction = databaseTransaction;
      const cleanHolding = strayHolding({ balanceMinorUnits: 0, balanceSetAt: null });

      await restoreDataSnapshot({
        ...emptySnapshot,
        holdings: [cleanHolding] as never,
      });

      expect(insertedRows.holdings).toEqual([cleanHolding]);
    });
  });

  // Migration 0041's flag (`settings.dedupKeysUpgraded`) and the launch-time
  // rewrite it gates (`upgradeStoredDedupKeys`) only run on LIVE data — a
  // `.kiko` restore REPLACES the whole `transactions`/`settings` tables, so a
  // pre-0041 export's legacy keys must be upgraded HERE too, mirroring
  // migration 0036's `withLegacyBalanceSetAtBackfilled` above:
  // `Object.hasOwn` on the settings row detects an entirely absent
  // `dedupKeysUpgraded` key (a pre-0041 export), not its value — an
  // already-0041-shaped snapshot's `false` (a device that hadn't run its own
  // upgrade yet) is left for THAT device's next launch to handle, the same
  // as any other live `false`.
  describe('legacy dedup-key upgrade (a pre-0041 snapshot has no dedupKeysUpgraded key)', () => {
    const legacyBase = computeDedupKeyBase('h1', 100, 5_000, 'Top up');
    const legacyImportTransaction = (overrides: Partial<Record<string, unknown>> = {}) => ({
      id: 't1',
      holdingId: 'h1',
      time: 100_000,
      amountMinorUnits: 5_000,
      description: 'Top up',
      source: 'import',
      externalId: `${legacyBase} 1`,
      // Carried, so the separate balance-set mark mirror leaves the row alone.
      setsBalance: false,
      ...overrides,
    });

    it('rewrites a legacy occurrence key and marks the settings row upgraded', async () => {
      const { databaseTransaction, insertedRows } = makeRowCapturingDatabaseTransaction();
      mockDatabaseTransaction = databaseTransaction;
      // No `dedupKeysUpgraded` key at all — a pre-0041 export. Already
      // `importTimesRezoned: true`, so this section stays isolated from the
      // separate import-time rezone (its own describe block below).
      const legacySettingsRow = { id: 1, baseCurrency: 'UAH', importTimesRezoned: true };

      await restoreDataSnapshot({
        ...emptySnapshot,
        settings: [legacySettingsRow] as never,
        transactions: [legacyImportTransaction()] as never,
      });

      expect(insertedRows.transactions).toEqual([
        legacyImportTransaction({ externalId: `${legacyBase}␟1` }),
      ]);
      expect(insertedRows.settings).toEqual([
        {
          id: 1,
          baseCurrency: 'UAH',
          importTimesRezoned: true,
          dedupKeysUpgraded: true,
          lockEnabled: false,
          quoteQuota: null,
        },
      ]);
    });

    it("leaves a row that isn't shaped like a legacy key unchanged, even while upgrading the settings row", async () => {
      const { databaseTransaction, insertedRows } = makeRowCapturingDatabaseTransaction();
      mockDatabaseTransaction = databaseTransaction;
      const editedTransaction = legacyImportTransaction({ description: 'Top up (edited note)' });

      await restoreDataSnapshot({
        ...emptySnapshot,
        settings: [{ id: 1, baseCurrency: 'UAH', importTimesRezoned: true }] as never,
        transactions: [editedTransaction] as never,
      });

      expect(insertedRows.transactions).toEqual([editedTransaction]);
      expect(insertedRows.settings).toEqual([
        {
          id: 1,
          baseCurrency: 'UAH',
          importTimesRezoned: true,
          dedupKeysUpgraded: true,
          lockEnabled: false,
          quoteQuota: null,
        },
      ]);
    });

    it('leaves a snapshot that ALREADY carries dedupKeysUpgraded unchanged (a post-0041 export)', async () => {
      const { databaseTransaction, insertedRows } = makeRowCapturingDatabaseTransaction();
      mockDatabaseTransaction = databaseTransaction;
      const alreadyMigratedSettingsRow = {
        id: 1,
        baseCurrency: 'UAH',
        importTimesRezoned: true,
        dedupKeysUpgraded: false,
      };
      const legacyShapedTransaction = legacyImportTransaction();

      await restoreDataSnapshot({
        ...emptySnapshot,
        settings: [alreadyMigratedSettingsRow] as never,
        transactions: [legacyShapedTransaction] as never,
      });

      expect(insertedRows.transactions).toEqual([legacyShapedTransaction]);
      expect(insertedRows.settings).toEqual([
        { ...alreadyMigratedSettingsRow, lockEnabled: false, quoteQuota: null },
      ]);
    });
  });

  // Migration 0043's flag and its own restore mirror (`withImportTimesRezoned`
  // in `restore-snapshot.ts`) — a pre-0043 snapshot's legacy import rows need
  // the same rewrite a live device's launch-time rezone applies, and unlike
  // the dedup-key upgrade above this ALSO rewrites an explicit `false`, since
  // a restore replaces the whole database rather than leaving a live device's
  // own next launch to retry.
  describe('import time rezone (migration 0043 restore mirror)', () => {
    const legacyTime = Date.UTC(2026, 5, 10, 8, 15, 0);
    const legacyImportRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
      id: 't1',
      holdingId: 'h1',
      time: legacyTime,
      amountMinorUnits: -500,
      description: 'coffee',
      source: 'import',
      externalId: `h1 ${legacyTime / 1000} -500 coffee`,
      // Carried, so the separate balance-set mark mirror leaves the row alone.
      setsBalance: false,
      ...overrides,
    });
    const stampedHolding = { id: 'h1', balanceSetAt: legacyTime };

    it('rezones every import row and holding stamp, and marks the settings row rezoned, when the flag is explicit false', async () => {
      const { databaseTransaction, insertedRows } = makeRowCapturingDatabaseTransaction();
      mockDatabaseTransaction = databaseTransaction;

      await restoreDataSnapshot({
        ...emptySnapshot,
        // `dedupKeysUpgraded: true` keeps this section isolated from the
        // separate dedup-key upgrade above, the same way that section pins
        // `importTimesRezoned: true` to stay isolated from this one.
        settings: [
          { id: 1, baseCurrency: 'UAH', dedupKeysUpgraded: true, importTimesRezoned: false },
        ] as never,
        holdings: [stampedHolding] as never,
        transactions: [legacyImportRow()] as never,
      });

      const rezonedTime = rezoneImportTime(legacyTime);

      expect(insertedRows.transactions).toEqual([
        legacyImportRow({ time: rezonedTime, externalId: `h1 ${rezonedTime / 1000} -500 coffee` }),
      ]);
      expect(insertedRows.holdings).toEqual([{ id: 'h1', balanceSetAt: rezonedTime }]);
      expect(insertedRows.settings).toEqual([
        {
          id: 1,
          baseCurrency: 'UAH',
          dedupKeysUpgraded: true,
          importTimesRezoned: true,
          lockEnabled: false,
          quoteQuota: null,
        },
      ]);
    });

    it('leaves every row and the flag unchanged when importTimesRezoned is already true', async () => {
      const { databaseTransaction, insertedRows } = makeRowCapturingDatabaseTransaction();
      mockDatabaseTransaction = databaseTransaction;

      await restoreDataSnapshot({
        ...emptySnapshot,
        settings: [
          { id: 1, baseCurrency: 'UAH', dedupKeysUpgraded: true, importTimesRezoned: true },
        ] as never,
        holdings: [stampedHolding] as never,
        transactions: [legacyImportRow()] as never,
      });

      expect(insertedRows.transactions).toEqual([legacyImportRow()]);
      expect(insertedRows.holdings).toEqual([stampedHolding]);
      expect(insertedRows.settings).toEqual([
        {
          id: 1,
          baseCurrency: 'UAH',
          dedupKeysUpgraded: true,
          importTimesRezoned: true,
          lockEnabled: false,
          quoteQuota: null,
        },
      ]);
    });

    it('rezones and marks the flag true when the settings row carries no importTimesRezoned key at all', async () => {
      const { databaseTransaction, insertedRows } = makeRowCapturingDatabaseTransaction();
      mockDatabaseTransaction = databaseTransaction;

      await restoreDataSnapshot({
        ...emptySnapshot,
        settings: [{ id: 1, baseCurrency: 'UAH', dedupKeysUpgraded: true }] as never,
        holdings: [stampedHolding] as never,
        transactions: [legacyImportRow()] as never,
      });

      const rezonedTime = rezoneImportTime(legacyTime);

      expect(insertedRows.transactions).toEqual([
        legacyImportRow({ time: rezonedTime, externalId: `h1 ${rezonedTime / 1000} -500 coffee` }),
      ]);
      expect(insertedRows.holdings).toEqual([{ id: 'h1', balanceSetAt: rezonedTime }]);
      expect(insertedRows.settings).toEqual([
        {
          id: 1,
          baseCurrency: 'UAH',
          dedupKeysUpgraded: true,
          importTimesRezoned: true,
          lockEnabled: false,
          quoteQuota: null,
        },
      ]);
    });
  });

  // A pre-star-model `.kiko` export can carry the legacy cross/inverse rows
  // migration 0042 removes from a live device — the SAME predicate applies
  // here, so a restore normalizes exactly like a live upgrade rather than
  // reintroducing dead cross rows `rateTableFromRows`/`rateTableAt` already
  // ignore.
  describe('rate normalization to UAH-star rows (migration 0042 restore mirror)', () => {
    it('keeps only a star row per currency, dropping every cross/inverse row, rate text unchanged', async () => {
      const { databaseTransaction, insertedRows } = makeRowCapturingDatabaseTransaction();
      mockDatabaseTransaction = databaseTransaction;

      await restoreDataSnapshot({
        ...emptySnapshot,
        currencyRates: [
          { base: 'USD', quote: 'UAH', rate: '40', source: 'monobank', fetchedAt: 1 },
          { base: 'EUR', quote: 'UAH', rate: '43', source: 'monobank', fetchedAt: 1 },
          { base: 'BTC', quote: 'UAH', rate: '2600000', source: 'coingecko', fetchedAt: 1 },
          { base: 'UAH', quote: 'USD', rate: '0.025', source: 'monobank', fetchedAt: 1 },
          { base: 'USD', quote: 'EUR', rate: '0.93', source: 'monobank', fetchedAt: 1 },
        ] as never,
      });

      expect(insertedRows.currencyRates).toEqual([
        { base: 'USD', quote: 'UAH', rate: '40', source: 'monobank', fetchedAt: 1 },
        { base: 'EUR', quote: 'UAH', rate: '43', source: 'monobank', fetchedAt: 1 },
        { base: 'BTC', quote: 'UAH', rate: '2600000', source: 'coingecko', fetchedAt: 1 },
      ]);
    });

    it('derives a star row from an inverse UAH:X row when X has none of its own (JS predicate: String(1 / Number(rate)))', async () => {
      const { databaseTransaction, insertedRows } = makeRowCapturingDatabaseTransaction();
      mockDatabaseTransaction = databaseTransaction;

      await restoreDataSnapshot({
        ...emptySnapshot,
        currencyRates: [
          { base: 'UAH', quote: 'GBP', rate: '0.02', source: 'monobank', fetchedAt: 5 },
        ] as never,
      });

      expect(insertedRows.currencyRates).toEqual([
        { base: 'GBP', quote: 'UAH', rate: String(1 / 0.02), source: 'monobank', fetchedAt: 5 },
      ]);
    });

    it('derives a star row from a legacy cross pair (X:Y product with Y:UAH)', async () => {
      const { databaseTransaction, insertedRows } = makeRowCapturingDatabaseTransaction();
      mockDatabaseTransaction = databaseTransaction;

      await restoreDataSnapshot({
        ...emptySnapshot,
        currencyRates: [
          { base: 'USD', quote: 'UAH', rate: '40', source: 'monobank', fetchedAt: 1 },
          { base: 'GBP', quote: 'USD', rate: '1.3', source: 'monobank', fetchedAt: 1 },
        ] as never,
      });

      expect(insertedRows.currencyRates).toEqual([
        { base: 'USD', quote: 'UAH', rate: '40', source: 'monobank', fetchedAt: 1 },
        { base: 'GBP', quote: 'UAH', rate: String(1.3 * 40), source: 'monobank', fetchedAt: 1 },
      ]);
    });

    it('restores a star-only snapshot byte-identical', async () => {
      const { databaseTransaction, insertedRows } = makeRowCapturingDatabaseTransaction();
      mockDatabaseTransaction = databaseTransaction;
      const starRows = [
        { base: 'USD', quote: 'UAH', rate: '40', source: 'monobank', fetchedAt: 1 },
        { base: 'BTC', quote: 'UAH', rate: '2600000', source: 'coingecko', fetchedAt: 1 },
      ];

      await restoreDataSnapshot({ ...emptySnapshot, currencyRates: starRows as never });

      expect(insertedRows.currencyRates).toEqual(starRows);
    });

    it('restores an empty currencyRates table unchanged', async () => {
      const { databaseTransaction, insertedRows } = makeRowCapturingDatabaseTransaction();
      mockDatabaseTransaction = databaseTransaction;

      await restoreDataSnapshot(emptySnapshot);

      expect(insertedRows.currencyRates ?? []).toEqual([]);
    });

    it('applies the identical three-case normalization to currencyRateHistory, scoped per day', async () => {
      const { databaseTransaction, insertedRows } = makeRowCapturingDatabaseTransaction();
      mockDatabaseTransaction = databaseTransaction;

      await restoreDataSnapshot({
        ...emptySnapshot,
        currencyRateHistory: [
          // Day 1: a full legacy pair set — only the star rows should survive.
          { base: 'USD', quote: 'UAH', day: 1, rate: '40', source: 'nbu' },
          { base: 'BTC', quote: 'USD', day: 1, rate: '65000', source: 'coingecko' },
          // Day 2: only an inverse UAH:GBP row.
          { base: 'UAH', quote: 'GBP', day: 2, rate: '0.02', source: 'nbu' },
        ] as never,
      });

      expect(insertedRows.currencyRateHistory).toEqual([
        { base: 'USD', quote: 'UAH', day: 1, rate: '40', source: 'nbu' },
        {
          base: 'BTC',
          quote: 'UAH',
          day: 1,
          rate: String(65_000 * 40),
          source: 'coingecko',
        },
        { base: 'GBP', quote: 'UAH', day: 2, rate: String(1 / 0.02), source: 'nbu' },
      ]);
    });

    it('restores an empty currencyRateHistory table unchanged', async () => {
      const { databaseTransaction, insertedRows } = makeRowCapturingDatabaseTransaction();
      mockDatabaseTransaction = databaseTransaction;

      await restoreDataSnapshot(emptySnapshot);

      expect(insertedRows.currencyRateHistory ?? []).toEqual([]);
    });
  });

  it("keeps a bond's own coupon schedule when its ISIN is no longer in the restored register", async () => {
    const { databaseTransaction, insertedRows } = makeRowCapturingDatabaseTransaction();
    mockDatabaseTransaction = databaseTransaction;
    const payments = [
      { date: Date.UTC(2027, 1, 1), kind: 'coupon', amount: '0.0225' },
      { date: Date.UTC(2027, 7, 1), kind: 'coupon', amount: '0.03' },
      { date: Date.UTC(2029, 1, 1), kind: 'redemption', amount: '1' },
    ];
    const bond = {
      id: 'h1',
      type: 'bond',
      currency: 'USD',
      balanceMinorUnits: 0,
      balanceSetAt: null,
      metadata: {
        quantity: 1000,
        faceValueMinorUnits: 100,
        couponPct: 4.5,
        purchaseDate: Date.UTC(2026, 8, 26),
        maturityDate: Date.UTC(2029, 1, 1),
        isin: 'XS2895055981',
        payments,
      },
    };

    await restoreDataSnapshot(
      JSON.parse(JSON.stringify({ ...emptySnapshot, holdings: [bond] })) as DataSnapshot,
    );

    const [restored] = insertedRows.holdings as { metadata: unknown }[];

    expect(holdingRegisterCoupons(restored.metadata, 'USD', null)).toEqual(payments.slice(0, 2));
  });

  it('restores the mode a bond was saved from', async () => {
    const { databaseTransaction, insertedRows } = makeRowCapturingDatabaseTransaction();
    mockDatabaseTransaction = databaseTransaction;
    const bond = {
      id: 'h1',
      type: 'bond',
      currency: 'UAH',
      balanceMinorUnits: 0,
      balanceSetAt: null,
      metadata: {
        quantity: 10,
        faceValueMinorUnits: 100_000,
        couponPct: 15.18,
        purchaseDate: Date.UTC(2026, 8, 10),
        maturityDate: Date.UTC(2027, 8, 15),
        isin: 'UA4000239115',
        entryMode: 'isin',
      },
    };

    await restoreDataSnapshot(
      JSON.parse(JSON.stringify({ ...emptySnapshot, holdings: [bond] })) as DataSnapshot,
    );

    const [restored] = insertedRows.holdings as { metadata: unknown }[];

    expect(asBondMeta(restored.metadata)?.entryMode).toBe('isin');
  });

  it("keeps a Binance holding's history-walk cursor through a restore", async () => {
    const { databaseTransaction, insertedRows } = makeRowCapturingDatabaseTransaction();
    mockDatabaseTransaction = databaseTransaction;
    const spot = {
      id: 'h1',
      type: 'crypto_asset',
      currency: 'BTC',
      balanceMinorUnits: 50_000_000,
      balanceSetAt: null,
      metadata: {
        binanceAsset: 'BTC',
        binanceHistoryCursor: 1_704_326_400_000,
        syncedAt: 1_704_326_400_000,
      },
    };

    await restoreDataSnapshot(
      JSON.parse(JSON.stringify({ ...emptySnapshot, holdings: [spot] })) as DataSnapshot,
    );

    const [restored] = insertedRows.holdings as { metadata: unknown }[];

    expect(binanceHistoryCursorOf(restored.metadata)).toBe(1_704_326_400_000);
  });
});
