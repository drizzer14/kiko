let mockDatabaseTransaction: unknown;
jest.mock('../../db/client', () => {
  const actual = jest.requireActual('../../db/client');

  return {
    ...actual,
    write: (work: (databaseTransaction: unknown) => unknown) => work(mockDatabaseTransaction),
  };
});

import { settings, transactions } from '../../db/schema';
import { renderCondition } from '../../db/render-condition-test-helper';

import { upgradeStoredDedupKeys } from './upgrade-stored-dedup-keys';

type CapturedUpdate = { table: unknown; set: Record<string, unknown>; whereArg: unknown };

const makeDatabaseTransaction = (
  settingsRows: Record<string, unknown>[],
  transactionRows: Record<string, unknown>[],
): { databaseTransaction: unknown; captured: CapturedUpdate[] } => {
  const captured: CapturedUpdate[] = [];
  const databaseTransaction = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => Promise.resolve(table === settings ? settingsRows : transactionRows),
      }),
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: (whereArg: unknown) => {
          captured.push({ table, set: values, whereArg });

          return Promise.resolve();
        },
      }),
    }),
  };

  return { databaseTransaction, captured };
};

const IMPORT_ROW_FIELDS = {
  holdingId: 'holding-1',
  time: 1_700_000_000_000,
  amountMinorUnits: -4_599,
  source: 'import',
};

describe('upgradeStoredDedupKeys', () => {
  it('is a no-op when the flag is already set', async () => {
    const { databaseTransaction, captured } = makeDatabaseTransaction(
      [{ dedupKeysUpgraded: true }],
      [],
    );
    mockDatabaseTransaction = databaseTransaction;

    await upgradeStoredDedupKeys();

    expect(captured).toEqual([]);
  });

  it('rewrites only the legacy-shaped import rows and flips the flag', async () => {
    const legacyRow = {
      id: 'txn-legacy',
      ...IMPORT_ROW_FIELDS,
      description: 'Top up',
      externalId: 'holding-1 1700000000 -4599 top up 1',
    };
    const stableRow = {
      id: 'txn-stable',
      ...IMPORT_ROW_FIELDS,
      description: 'Top up',
      externalId: 'holding-1 1700000000 -4599 top up',
    };
    const editedRow = {
      id: 'txn-edited',
      ...IMPORT_ROW_FIELDS,
      description: 'Top up (edited note)',
      externalId: 'holding-1 1700000000 -4599 top up 1',
    };
    const bankIdRow = {
      id: 'txn-bank-id',
      ...IMPORT_ROW_FIELDS,
      description: 'Top up',
      externalId: 'bank-issued-id-42',
    };
    const { databaseTransaction, captured } = makeDatabaseTransaction(
      [{ dedupKeysUpgraded: false }],
      [legacyRow, stableRow, editedRow, bankIdRow],
    );
    mockDatabaseTransaction = databaseTransaction;

    await upgradeStoredDedupKeys();

    const rowUpdates = captured.filter((update) => update.table === transactions);
    expect(rowUpdates).toHaveLength(1);
    expect(rowUpdates[0]?.set).toEqual({
      externalId: 'holding-1 1700000000 -4599 top up␟1',
    });
    expect(renderCondition(rowUpdates[0]?.whereArg)).toEqual({
      sql: '"transactions"."id" = ?',
      params: ['txn-legacy'],
    });

    const flagUpdates = captured.filter((update) => update.table === settings);
    expect(flagUpdates).toHaveLength(1);
    expect(flagUpdates[0]?.set).toEqual({ dedupKeysUpgraded: true });
  });

  it('sets the flag even when nothing needs rewriting', async () => {
    const stableRow = {
      id: 'txn-stable',
      ...IMPORT_ROW_FIELDS,
      description: 'Top up',
      externalId: 'holding-1 1700000000 -4599 top up',
    };
    const { databaseTransaction, captured } = makeDatabaseTransaction(
      [{ dedupKeysUpgraded: false }],
      [stableRow],
    );
    mockDatabaseTransaction = databaseTransaction;

    await upgradeStoredDedupKeys();

    expect(captured.filter((update) => update.table === transactions)).toEqual([]);
    expect(captured.filter((update) => update.table === settings)).toHaveLength(1);
  });

  it('selects only import-source transaction rows', async () => {
    let capturedWhereArg: unknown;
    const databaseTransaction = {
      select: () => ({
        from: (table: unknown) => ({
          where: (whereArg: unknown) => {
            if (table === transactions) {
              capturedWhereArg = whereArg;
            }

            return Promise.resolve(table === settings ? [{ dedupKeysUpgraded: false }] : []);
          },
        }),
      }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    };
    mockDatabaseTransaction = databaseTransaction;

    await upgradeStoredDedupKeys();

    expect(renderCondition(capturedWhereArg)).toEqual({
      sql: '"transactions"."source" = ?',
      params: ['import'],
    });
  });
});
