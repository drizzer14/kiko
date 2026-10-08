// src/data-transfer/snapshot/restore-deleted-import-keys.test.ts
//
// The keys of deleted import rows travel in the backup: a file exported after a
// delete and restored on another device brings the row back WITH its amount when
// the same statement is imported again, exactly as on the device that deleted it.
// A file from before the table (or a hand-built one) restores with none, and a
// key whose holding the restore does not insert is skipped, not a failed restore.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { database: client.database, write: client.write };
});

import { DatabaseSync } from 'node:sqlite';
import { transactionsRepo } from '@kiko/transactions/repo';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

import { readDataSnapshot } from './read-snapshot';
import type { DataSnapshot } from './data-snapshot';
import { restoreDataSnapshot } from './restore-snapshot';

const BOUNDARY = Date.UTC(2026, 9, 1);
const SEPTEMBER_FIFTEENTH = Date.UTC(2026, 8, 15, 9);

const run = (statement: string, ...parameters: (string | number | null)[]): void => {
  mockDatabase.prepare(statement).run(...parameters);
};

const scalarOf = (statement: string): unknown =>
  (mockDatabase.prepare(statement).get() as { value: unknown }).value;

const balanceOf = (): number =>
  scalarOf("SELECT balance_minor_units AS value FROM holdings WHERE id = 'card'") as number;

const keysOf = (): { holdingId: string; externalId: string; deletedAt: number }[] =>
  (
    mockDatabase
      .prepare(
        'SELECT holding_id AS holdingId, external_id AS externalId, deleted_at AS deletedAt FROM deleted_import_keys ORDER BY holding_id, external_id',
      )
      .all() as { holdingId: string; externalId: string; deletedAt: number }[]
  ).map(({ holdingId, externalId, deletedAt }) => ({ holdingId, externalId, deletedAt }));

const freshDatabase = (): DatabaseSync => {
  const target = new DatabaseSync(':memory:');

  applyAllMigrations(target);
  target.exec('PRAGMA foreign_keys = ON');

  return target;
};

const insertCard = (balanceMinorUnits: number): void => {
  run("INSERT INTO accounts (id, name, kind) VALUES ('account', 'Bank', 'bank')");
  run(
    `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units, balance_set_at)
     VALUES ('card', 'account', 'Card', 'card', 'UAH', ?, ?)`,
    balanceMinorUnits,
    BOUNDARY,
  );
};

const statementRow = {
  holdingId: 'card',
  source: 'import' as const,
  externalId: 'k-300',
  amountMinorUnits: -300,
  time: SEPTEMBER_FIFTEENTH,
};

// A device that imported one history row over a hand-set balance of 5,000 and
// then deleted it, taking its amount back (5,300).
const exportAfterDelete = async (): Promise<DataSnapshot> => {
  mockDatabase = freshDatabase();
  insertCard(5000);
  await transactionsRepo.importRows({ holdingId: 'card', rows: [statementRow] });
  await transactionsRepo.remove(
    scalarOf("SELECT id AS value FROM transactions WHERE external_id = 'k-300'") as string,
  );

  return readDataSnapshot();
};

describe('restoring the keys of deleted import rows', () => {
  it('reads the keys into the export', async () => {
    const snapshot = await exportAfterDelete();

    expect(snapshot.deletedImportKeys).toEqual([
      expect.objectContaining({ holdingId: 'card', externalId: 'k-300' }),
    ]);
  });

  it('brings the row back with its amount on the restored device', async () => {
    const snapshot = await exportAfterDelete();
    const exportedKeys = keysOf();

    mockDatabase = freshDatabase();
    await restoreDataSnapshot(snapshot);

    expect(keysOf()).toEqual(exportedKeys);
    expect(balanceOf()).toBe(5300);

    await transactionsRepo.importRows({ holdingId: 'card', rows: [statementRow] });

    expect(balanceOf()).toBe(5000);
    expect(keysOf()).toEqual([]);
  });

  it('restores a file with no key for them, and the row comes back as history', async () => {
    const { deletedImportKeys: _omitted, ...fileWithoutKeys } = await exportAfterDelete();

    mockDatabase = freshDatabase();
    await restoreDataSnapshot(fileWithoutKeys);

    expect(keysOf()).toEqual([]);

    await transactionsRepo.importRows({ holdingId: 'card', rows: [statementRow] });

    expect(balanceOf()).toBe(5300);
  });

  it('skips a key whose holding the file does not carry, and keeps the others', async () => {
    const snapshot = await exportAfterDelete();

    mockDatabase = freshDatabase();
    await restoreDataSnapshot({
      ...snapshot,
      deletedImportKeys: [
        ...(snapshot.deletedImportKeys ?? []),
        { holdingId: 'vanished', externalId: 'k-1', deletedAt: SEPTEMBER_FIFTEENTH },
      ],
    });

    expect(keysOf().map(({ holdingId, externalId }) => `${holdingId}:${externalId}`)).toEqual([
      'card:k-300',
    ]);
  });

  it('replaces the keys of the device it restores onto', async () => {
    const snapshot = await exportAfterDelete();

    mockDatabase = freshDatabase();
    insertCard(0);
    run("INSERT INTO deleted_import_keys (holding_id, external_id) VALUES ('card', 'stale')");

    await restoreDataSnapshot({ ...snapshot, deletedImportKeys: [] });

    expect(keysOf()).toEqual([]);
  });
});
