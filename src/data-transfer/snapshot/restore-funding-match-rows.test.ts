// src/data-transfer/snapshot/restore-funding-match-rows.test.ts
//
// The stored funding match rows travel in the backup as an optional key: a file exported with
// rows restores them, a file from before the table (or a hand-built one) restores with none, a
// row whose account the restore does not insert is skipped, and a restore over a device that
// holds rows deletes them before their account (the foreign key has no cascade).
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { database: client.database, write: client.write };
});

import { DatabaseSync } from 'node:sqlite';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

import { EXPORT_VERSION } from '../crypto/envelope';

import { readDataSnapshot } from './read-snapshot';
import type { DataSnapshot } from './data-snapshot';
import { restoreDataSnapshot } from './restore-snapshot';

type StoredRow = {
  accountId: string;
  side: string;
  recordKey: string;
  series: string | null;
  coin: string;
  direction: string;
  amount: string;
  fee: string | null;
  tax: string | null;
  timeStart: number;
  timeEnd: number;
  earnPrincipal: number;
};

const run = (statement: string, ...parameters: (string | number | null)[]): void => {
  mockDatabase.prepare(statement).run(...parameters);
};

const storedRows = (): StoredRow[] =>
  mockDatabase
    .prepare(
      `SELECT account_id AS accountId, side, record_key AS recordKey, series, coin, direction,
              amount, fee, tax, time_start AS timeStart, time_end AS timeEnd,
              earn_principal AS earnPrincipal
       FROM funding_match_rows ORDER BY account_id, side, record_key`,
    )
    .all() as StoredRow[];

const freshDatabase = (): DatabaseSync => {
  const target = new DatabaseSync(':memory:');

  applyAllMigrations(target);
  target.exec('PRAGMA foreign_keys = ON');

  return target;
};

const insertRow = (
  accountId: string,
  side: string,
  recordKey: string,
  fields: { series: string | null; fee: string | null; earnPrincipal: number },
): void => {
  run(
    `INSERT INTO funding_match_rows
       (account_id, side, record_key, series, coin, direction, amount, fee, tax, time_start,
        time_end, earn_principal)
     VALUES (?, ?, ?, ?, 'USDT', 'I', '100.5', ?, NULL, 1000, 2000, ?)`,
    accountId,
    side,
    recordKey,
    fields.series,
    fields.fee,
    fields.earnPrincipal,
  );
};

const seedAccountWithRows = (accountId: string): void => {
  run('INSERT INTO accounts (id, name, kind) VALUES (?, ?, ?)', accountId, 'Exchange', 'crypto');
  insertRow(accountId, 'ledger', 'ledger-1', { series: null, fee: null, earnPrincipal: 1 });
  insertRow(accountId, 'source', 'source-1', { series: 'deposit', fee: '0.5', earnPrincipal: 0 });
};

const exportWithRows = async (): Promise<DataSnapshot> => {
  mockDatabase = freshDatabase();
  seedAccountWithRows('account');

  return readDataSnapshot();
};

describe('restoring the stored funding match rows', () => {
  it('reads the rows into the export, by account, side and key', async () => {
    const snapshot = await exportWithRows();

    expect(snapshot.fundingMatchRows).toEqual([
      expect.objectContaining({ accountId: 'account', side: 'ledger', recordKey: 'ledger-1' }),
      expect.objectContaining({ accountId: 'account', side: 'source', recordKey: 'source-1' }),
    ]);
  });

  it('brings every row and every column back on the restored device', async () => {
    const snapshot = await exportWithRows();
    const exportedRows = storedRows();

    mockDatabase = freshDatabase();
    await restoreDataSnapshot(snapshot, EXPORT_VERSION);

    expect(storedRows()).toEqual(exportedRows);
    expect(exportedRows).toHaveLength(2);
    expect(exportedRows.map((row) => row.earnPrincipal)).toEqual([1, 0]);
  });

  it('restores a file with no key for them, and the table stays empty', async () => {
    const { fundingMatchRows: _omitted, ...fileWithoutRows } = await exportWithRows();

    mockDatabase = freshDatabase();
    await restoreDataSnapshot(fileWithoutRows, EXPORT_VERSION);

    expect(storedRows()).toEqual([]);
  });

  it('deletes the rows of the device first, so the replaced account leaves no orphan', async () => {
    const snapshot = await exportWithRows();

    mockDatabase = freshDatabase();
    seedAccountWithRows('account');
    seedAccountWithRows('other');

    await restoreDataSnapshot(snapshot, EXPORT_VERSION);

    expect(storedRows().map((row) => row.accountId)).toEqual(['account', 'account']);
  });

  it('skips a row whose account the restore does not insert, and restores the rest', async () => {
    const snapshot = await exportWithRows();
    const exportedRows = snapshot.fundingMatchRows ?? [];

    mockDatabase = freshDatabase();
    await restoreDataSnapshot(
      {
        ...snapshot,
        fundingMatchRows: [
          ...exportedRows,
          ...exportedRows.map((row) => ({ ...row, accountId: 'gone' })),
        ],
      },
      EXPORT_VERSION,
    );

    expect(storedRows().map((row) => row.accountId)).toEqual(['account', 'account']);
  });
});
