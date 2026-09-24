// src/data-transfer/snapshot/restore-legacy-balance-set-at.test.ts
//
// FIX-restore-backfill-brief.md's core scenario, end to end across BOTH
// write paths that share `db/client`'s `write`: restoring a build-25-shaped
// `.kiko` snapshot (exported before `holdings.balance_set_at` existed) must
// leave a hand-set holding in exactly the state migration 0036
// (`drizzle/migrations/0036_add_balance_set_at.sql`) would have produced
// on-device, so a LATER statement import applies the real boundary rule
// (`transactionsRepo.importRows`'s doc comment,
// `transactions/repo/transactions.repo.ts`) instead of treating every row
// as boundary-less — the same outcome `import-statement.test.ts`'s "treats
// an entirely OLDER statement as history" test proves for a holding whose
// `balanceSetAt` was already live in the database, not recovered from a
// legacy restore.
let mockDatabaseTransaction: unknown;
jest.mock('../../db/client', () => {
  const actual = jest.requireActual('../../db/client');
  return { ...actual, write: (work: (db: unknown) => unknown) => work(mockDatabaseTransaction) };
});

import { transactionsRepo } from '@kiko/transactions/repo';

import { accounts, categoryOverrides, holdings, transactions } from '../../db/schema';

import type { DataSnapshot } from './data-snapshot';
import { restoreDataSnapshot } from './restore-snapshot';

type Row = Record<string, unknown>;

/** A combined fake transaction handle spanning BOTH `restoreDataSnapshot`
 * (delete-then-insert every table) and `transactionsRepo.importRows`
 * (select holding/account/sync-boundary, upsert, conditional balance
 * update) against ONE persistent in-memory store — the same
 * `store`-spanning-two-calls trick `import-statement.test.ts`'s
 * `makeImportDatabaseTransaction` uses for its own re-import test, extended here to also
 * drive a restore first. Single holding, so table identity alone (no
 * `.where()` clause interpretation) is enough to route each call, mirroring
 * `transactions.repo.test.ts`'s and `import-statement.test.ts`'s own fakes. */
const makeRestoreThenImportDatabaseTransaction = (store: {
  holdings: Row[];
  transactions: Row[];
}): { databaseTransaction: unknown; captured: { holdingSet?: Record<string, unknown> } } => {
  let sequence = 0;
  const nextId = (): string => `row-${++sequence}`;
  const captured: { holdingSet?: Record<string, unknown> } = {};
  const resolveRows = (rows: unknown[]) =>
    Object.assign(Promise.resolve(rows), { limit: () => Promise.resolve(rows) });

  const resolveSelect = (
    table: unknown,
    fields: Record<string, unknown> | undefined,
  ): unknown[] => {
    if (table === categoryOverrides) {
      return [];
    }

    if (table === holdings) {
      return store.holdings;
    }

    if (table === accounts) {
      return [{ institution: null }];
    }

    if (table === transactions && fields && 'time' in fields) {
      const syncTimes = store.transactions
        .filter((row) => row.source !== 'manual' && row.source !== 'import')
        .map((row) => row.time as number);

      return syncTimes.length > 0 ? [{ time: Math.max(...syncTimes) }] : [{ time: null }];
    }

    return store.transactions.map((row) => ({ source: row.source, externalId: row.externalId }));
  };

  const databaseTransaction = {
    delete: () => Promise.resolve(),
    select: (fields?: Record<string, unknown>) => ({
      from: (table: unknown) => ({
        where: () => resolveRows(resolveSelect(table, fields)),
      }),
    }),
    insert: (table: unknown) => ({
      values: (rows: Row[]) => {
        if (table === holdings) {
          store.holdings.push(...rows);
        }

        if (table === transactions) {
          store.transactions.push(...rows.map((row) => ({ id: row.id ?? nextId(), ...row })));
        }

        return { onConflictDoUpdate: () => Promise.resolve() };
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          if (table === holdings) {
            captured.holdingSet = values;
            Object.assign(store.holdings[0], values);
          }

          return Promise.resolve();
        },
      }),
    }),
  };

  return { databaseTransaction, captured };
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

describe('restoring a build-25-shaped snapshot, then importing an older statement', () => {
  it('backfills the hand-set boundary on restore, then treats an OLDER import as history (0 balance move)', async () => {
    const store: { holdings: Row[]; transactions: Row[] } = { holdings: [], transactions: [] };
    const { databaseTransaction } = makeRestoreThenImportDatabaseTransaction(store);
    mockDatabaseTransaction = databaseTransaction;

    const handSetAt = Date.UTC(2025, 0, 1); // the pre-migration hand-set instant
    const legacyHolding = {
      id: 'hold-1',
      accountId: 'acc-1',
      name: 'Card',
      type: 'card',
      currency: 'UAH',
      icon: null,
      color: null,
      balanceMinorUnits: 500_000,
      syncedBalanceMinorUnits: null,
      // NO balanceSetAt key at all — the exact shape a build-25 `.kiko`
      // export carries (exported before the column existed).
      metadata: null,
      sortOrder: 0,
      closedAt: null,
      createdAt: 0,
    } as never;
    const handSetTransaction = {
      id: 'txn-hand-set',
      holdingId: 'hold-1',
      amountMinorUnits: 500_000,
      time: handSetAt,
      description: '',
      category: null,
      mcc: null,
      hold: null,
      counterIban: null,
      exchangeCounterpartHoldingId: null,
      changeGroupId: null,
      comment: null,
      source: 'manual',
      externalId: null,
      createdAt: handSetAt,
    } as never;

    await restoreDataSnapshot({
      ...emptySnapshot,
      holdings: [legacyHolding],
      transactions: [handSetTransaction],
    });

    // The restore itself recovered the same boundary migration 0036 would
    // have backfilled on-device.
    expect(store.holdings[0].balanceSetAt).toBe(handSetAt);

    const { databaseTransaction: importDatabaseTransaction, captured } =
      makeRestoreThenImportDatabaseTransaction(store);
    mockDatabaseTransaction = importDatabaseTransaction;

    const imported = await transactionsRepo.importRows({
      holdingId: 'hold-1',
      rows: [
        {
          holdingId: 'hold-1',
          amountMinorUnits: -1_000,
          // Strictly BEFORE the restored boundary — an older statement.
          time: handSetAt - 1_000,
          source: 'import',
          description: 'Coffee',
        },
      ],
    });

    // The row still lands as real ledger history...
    expect(imported).toBe(1);
    expect(store.transactions).toHaveLength(2);
    // ...but contributes 0 to the balance — no holdings update at all —
    // exactly matching post-migration behavior for a holding whose
    // `balanceSetAt` was always live.
    expect(captured.holdingSet).toBeUndefined();
    expect(store.holdings[0].balanceMinorUnits).toBe(500_000);
  });
});
