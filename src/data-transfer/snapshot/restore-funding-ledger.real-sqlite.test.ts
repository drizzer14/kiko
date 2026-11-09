// A listed Funding ledger row carries the user's note and category, so a restore that took it
// away would lose both with no trace. The reconcile runs after a restore on the real path: a
// backup with the stored set, and a file of an older build with no `fundingMatchRows` key, where
// a key with no stored ledger row is never removed.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const actual = jest.requireActual('@kiko/db/client');
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { ...actual, database: client.database, write: client.write };
});
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly' },
}));

import { DAY_MS } from '@kiko/dates';
import { DatabaseSync } from 'node:sqlite';
import { seedWalkMarks } from '@kiko/test-support/walk-marks';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import { reconcileBybitFundingLedger } from '@kiko/crypto-sync/bybit';

import { EXPORT_VERSION } from '../crypto/envelope';

import { readDataSnapshot } from './read-snapshot';
import { restoreDataSnapshot } from './restore-snapshot';

const ACCOUNT = 'acc-1';
const NOW = Date.UTC(2026, 9, 1);
const LEDGER_KEY = `${ACCOUNT}:funding:a:USDT`;

const migratedDatabase = (): DatabaseSync => {
  const target = new DatabaseSync(':memory:');

  applyAllMigrations(target);
  target.exec('PRAGMA foreign_keys = ON;');

  return target;
};

const reconcile = () =>
  reconcileBybitFundingLedger({ targetAccountId: ACCOUNT }, { now: () => NOW });

// One stored ledger row with no source: the reconcile lists it as a row of the Funding holding.
const accountWithOneListedRow = async (): Promise<void> => {
  mockDatabase = migratedDatabase();
  mockDatabase
    .prepare('INSERT INTO accounts (id, name, kind, institution) VALUES (?, ?, ?, ?)')
    .run(ACCOUNT, 'Bybit', 'crypto', 'bybit');

  for (const walk of ['capital', 'transfer', 'convert'] as const) {
    seedWalkMarks(mockDatabase, ACCOUNT, walk, { cursor: NOW, pending: [] });
  }

  mockDatabase
    .prepare(
      `INSERT INTO funding_match_rows
         (account_id, side, record_key, series, coin, direction, amount, fee, tax, time_start,
          time_end, earn_principal)
       VALUES (?, 'ledger', ?, NULL, 'USDT', 'I', '100.5', NULL, NULL, ?, ?, 0)`,
    )
    .run(ACCOUNT, LEDGER_KEY, NOW - 20 * DAY_MS, NOW - 20 * DAY_MS);

  await reconcile();
};

const listedKeys = (): string[] =>
  (
    mockDatabase.prepare('SELECT external_id FROM transactions ORDER BY external_id').all() as {
      external_id: string;
    }[]
  ).map((row) => row.external_id);

const storedLedgerKeys = (): string[] =>
  (
    mockDatabase
      .prepare("SELECT record_key FROM funding_match_rows WHERE side = 'ledger'")
      .all() as { record_key: string }[]
  ).map((row) => row.record_key);

describe('restoring a Bybit account that has a listed Funding ledger row', () => {
  it('a restore of the backup, with the stored set or from a file without it, removes no listed row', async () => {
    await accountWithOneListedRow();
    expect(listedKeys()).toEqual([LEDGER_KEY]);

    const snapshot = await readDataSnapshot();
    const { fundingMatchRows: _omitted, ...fileWithoutStoredSet } = snapshot;

    mockDatabase = migratedDatabase();
    await restoreDataSnapshot(snapshot, EXPORT_VERSION);
    await reconcile();

    expect(listedKeys()).toEqual([LEDGER_KEY]);
    expect(storedLedgerKeys()).toEqual([LEDGER_KEY]);

    mockDatabase = migratedDatabase();
    await restoreDataSnapshot(fileWithoutStoredSet, EXPORT_VERSION);
    await reconcile();

    expect(listedKeys()).toEqual([LEDGER_KEY]);
    expect(storedLedgerKeys()).toEqual([]);
  });
});
