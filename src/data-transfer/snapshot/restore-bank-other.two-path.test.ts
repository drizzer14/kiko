// src/data-transfer/snapshot/restore-bank-other.two-path.test.ts
//
// A `.kiko` file exported before "Other bank" became a stored bank id must
// restore with the same bank ids as a live device's own migration 0049
// upgrade. Path 1 runs the real migration SQL on a real engine; path 2 reads
// an identically seeded pre-0049 database the way that older build's export
// did, then restores it through `restoreDataSnapshot`.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { database: client.database, write: client.write };
});

import { join } from 'node:path';
import { asc } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import {
  applyAllMigrations,
  applyMigrationsThrough,
  executingDrizzle,
} from '@kiko/test-support/real-sqlite';
import { DatabaseSync } from 'node:sqlite';
import { type database, accounts } from '@kiko/db';

import type { DataSnapshot } from './data-snapshot';
import { restoreDataSnapshot } from './restore-snapshot';

const MIGRATION_0049_SQL = readFileSync(
  join(__dirname, '..', '..', '..', 'drizzle', 'migrations', '0049_bank_accounts_other_bank.sql'),
  'utf8',
);

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

const insertAccount = (
  target: DatabaseSync,
  id: string,
  kind: string,
  bankId: string | null,
): void => {
  target
    .prepare('INSERT INTO accounts (id, name, kind, bank_id) VALUES (?, ?, ?, ?)')
    .run(id, id, kind, bankId);
};

// Every case migration 0049's own test pins: a bank with no bank, a bank that
// names one (listed or since removed), and a NULL on a broker and each other
// kind, which stays NULL.
const seedAccounts = (target: DatabaseSync): void => {
  insertAccount(target, 'free-bank', 'bank', null);
  insertAccount(target, 'monobank', 'bank', 'monobank');
  insertAccount(target, 'removed-bank', 'bank', 'a-since-removed-bank');
  insertAccount(target, 'broker-no-pick', 'broker', null);
  insertAccount(target, 'broker-picked', 'broker', 'ibkr');
  insertAccount(target, 'cash', 'cash', null);
  insertAccount(target, 'crypto', 'crypto', null);
  insertAccount(target, 'property', 'property', null);
  insertAccount(target, 'metals', 'metals', null);
  insertAccount(target, 'debt', 'debt', null);
};

const bankIds = (target: DatabaseSync): Record<string, string | null> =>
  Object.fromEntries(
    (
      target.prepare('SELECT id, bank_id AS bankId FROM accounts ORDER BY id').all() as {
        id: string;
        bankId: string | null;
      }[]
    ).map((row) => [row.id, row.bankId]),
  );

const snapshotOf = async (source: DatabaseSync): Promise<DataSnapshot> => ({
  ...emptySnapshot,
  accounts: await executingDrizzle<typeof database>(source)
    .select()
    .from(accounts)
    .orderBy(asc(accounts.id)),
});

const freshDatabase = (): DatabaseSync => {
  const target = new DatabaseSync(':memory:');

  applyAllMigrations(target);

  return target;
};

describe('restoring a .kiko file exported before Other bank was a stored bank id', () => {
  it('gives a bank account its other bank id exactly as the live migration 0049 upgrade does', async () => {
    const live = new DatabaseSync(':memory:');

    applyMigrationsThrough(live, '0048_add_lots_recosted');
    seedAccounts(live);
    live.exec(MIGRATION_0049_SQL.split('--> statement-breakpoint').join('\n'));

    const exported = new DatabaseSync(':memory:');

    applyMigrationsThrough(exported, '0048_add_lots_recosted');
    seedAccounts(exported);
    const snapshot = await snapshotOf(exported);

    mockDatabase = freshDatabase();
    await restoreDataSnapshot(snapshot);

    expect(bankIds(live)).toEqual({
      'broker-no-pick': null,
      'broker-picked': 'ibkr',
      cash: null,
      crypto: null,
      debt: null,
      'free-bank': 'other',
      metals: null,
      monobank: 'monobank',
      property: null,
      'removed-bank': 'a-since-removed-bank',
    });
    expect(bankIds(mockDatabase)).toEqual(bankIds(live));
  });
});

describe('restoring a .kiko file exported before accounts.bank_id existed (migration 0033)', () => {
  it('gives a bank account that carries no bankId key at all the other bank id, and leaves other kinds unset', async () => {
    const exported = freshDatabase();

    insertAccount(exported, 'free-bank', 'bank', null);
    insertAccount(exported, 'cash', 'cash', null);
    const withBankId = await snapshotOf(exported);
    const snapshot: DataSnapshot = {
      ...withBankId,
      accounts: withBankId.accounts.map(
        (account) =>
          Object.fromEntries(
            Object.entries(account).filter(([key]) => key !== 'bankId'),
          ) as DataSnapshot['accounts'][number],
      ),
    };

    expect(snapshot.accounts.every((account) => !('bankId' in account))).toBe(true);

    mockDatabase = freshDatabase();
    await restoreDataSnapshot(snapshot);

    expect(bankIds(mockDatabase)).toEqual({ cash: null, 'free-bank': 'other' });
  });
});

describe('restoring a .kiko file exported after Other bank was a stored bank id', () => {
  it('keeps every bank id as exported', async () => {
    const exported = freshDatabase();

    insertAccount(exported, 'other-bank', 'bank', 'other');
    insertAccount(exported, 'broker-other', 'broker', 'other');
    insertAccount(exported, 'monobank', 'bank', 'monobank');
    const snapshot = await snapshotOf(exported);

    mockDatabase = freshDatabase();
    await restoreDataSnapshot(snapshot);

    expect(bankIds(mockDatabase)).toEqual({
      'broker-other': 'other',
      monobank: 'monobank',
      'other-bank': 'other',
    });
  });
});
