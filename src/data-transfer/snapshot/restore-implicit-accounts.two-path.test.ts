// src/data-transfer/snapshot/restore-implicit-accounts.two-path.test.ts
//
// A `.kiko` file exported before Property and Loans became implicit accounts
// must restore to the same rows as a live device's own migration 0050 upgrade.
// One database is seeded as that older build left it. Path 1 runs the real
// 0050 SQL on it. Path 2 reads it back first, the way that build exported it,
// then restores that snapshot into a fresh database.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { database: client.database, write: client.write };
});

import {
  type database,
  accounts,
  holdings,
  pricePoints,
  reminders,
  settings,
  syncState,
  transactions,
} from '@kiko/db';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import {
  applyAllMigrations,
  applyMigrationsThrough,
  columnsWithout,
  executingDrizzle,
} from '@kiko/test-support/real-sqlite';
import { DatabaseSync } from 'node:sqlite';
import maybe, { foldMap } from 'fnts/maybe';
import { asc, getTableColumns } from 'drizzle-orm';

import { readDataSnapshot } from './read-snapshot';
import { restoreDataSnapshot } from './restore-snapshot';

const MIGRATION_0050_SQL = readFileSync(
  join(
    __dirname,
    '..',
    '..',
    '..',
    'drizzle',
    'migrations',
    '0050_implicit_property_debt_accounts.sql',
  ),
  'utf8',
);

const databaseBefore0050 = (): DatabaseSync => {
  const target = new DatabaseSync(':memory:');

  applyMigrationsThrough(target, '0049_bank_accounts_other_bank');
  target.exec('PRAGMA foreign_keys = ON;');

  return target;
};

const freshDatabase = (): DatabaseSync => {
  const target = new DatabaseSync(':memory:');

  applyAllMigrations(target);
  target.exec('PRAGMA foreign_keys = ON;');

  return target;
};

type AccountSeed = {
  id: string;
  kind: string;
  sortOrder?: number;
  createdAt?: number;
  archivedAt?: number | null;
};

const insertAccount = (target: DatabaseSync, seed: AccountSeed): void => {
  target
    .prepare(
      `INSERT INTO accounts (id, name, kind, sort_order, created_at, archived_at, icon, color)
       VALUES (?, ?, ?, ?, ?, ?, 'custom-glyph', '#112233')`,
    )
    .run(
      seed.id,
      seed.id,
      seed.kind,
      seed.sortOrder ?? 0,
      seed.createdAt ?? 1,
      seed.archivedAt ?? null,
    );
};

type HoldingSeed = {
  id: string;
  accountId: string;
  type?: string;
  sortOrder?: number;
  createdAt?: number;
  closedAt?: number | null;
};

const insertHolding = (target: DatabaseSync, seed: HoldingSeed): void => {
  target
    .prepare(
      `INSERT INTO holdings
         (id, account_id, name, type, currency, balance_minor_units, metadata, sort_order, closed_at, created_at)
       VALUES (?, ?, ?, ?, 'UAH', 100, '{"note":"kept"}', ?, ?, ?)`,
    )
    .run(
      seed.id,
      seed.accountId,
      seed.id,
      seed.type ?? 'property_item',
      seed.sortOrder ?? 0,
      seed.closedAt ?? null,
      seed.createdAt ?? 1,
    );
};

type ReminderSeed = {
  id: string;
  accountId: string;
  kind: 'statement_import' | 'add_transactions';
  createdAt: number;
  pausedAt?: number;
  lastEngagedAt?: number;
};

// A paused reminder also carries a snooze, so the two columns a restore
// restarts hold a value to restart.
const insertReminder = (target: DatabaseSync, seed: ReminderSeed): void => {
  target
    .prepare(
      `INSERT INTO reminders
         (id, account_id, kind, schedule, paused_at, pause_reason, active_since,
          last_engaged_at, last_snoozed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      seed.id,
      seed.accountId,
      seed.kind,
      `{"frequency":"daily","minuteOfDay":${seed.createdAt}}`,
      seed.pausedAt ?? null,
      seed.pausedAt === undefined ? null : 'user',
      seed.createdAt + 1,
      seed.lastEngagedAt ?? null,
      seed.pausedAt === undefined ? null : seed.createdAt + 3,
      seed.createdAt,
      seed.createdAt + 2,
    );
};

const insertSettings = (target: DatabaseSync, dismissals: string): void => {
  target
    .prepare('INSERT INTO settings (id, reminder_offer_dismissals) VALUES (1, ?)')
    .run(dismissals);
};

const insertSyncState = (target: DatabaseSync, accountId: string): void => {
  target.prepare('INSERT INTO sync_state (account_id, last_sync_at) VALUES (?, 5)').run(accountId);
};

const insertTransaction = (
  target: DatabaseSync,
  id: string,
  holdingId: string,
  loanHoldingId: string | null,
): void => {
  target
    .prepare(
      `INSERT INTO transactions (id, holding_id, amount_minor_units, time, source, loan_holding_id)
       VALUES (?, ?, -50, 10, 'manual', ?)`,
    )
    .run(id, holdingId, loanHoldingId);
};

const insertPricePoint = (target: DatabaseSync, holdingId: string): void => {
  target
    .prepare(
      `INSERT INTO price_points (instrument, day, price, currency, source)
       VALUES (?, '2026-01-01', 1.5, 'UAH', 'manual')`,
    )
    .run(`holding:${holdingId}`);
};

// Several accounts of each kind, with ties. property: `property-oldest` is the
// kept one. debt: three accounts tie on created_at AND sort_order, and their
// ids differ by case, so the kept one is `debt-B` by UTF-16 code unit
// (SQLite BINARY collation) and would be `debt-a` by locale order. An archived
// account of each kind stays out of the merge.
const seedSeveralAccountsOfEachKind = (target: DatabaseSync): void => {
  insertAccount(target, { id: 'wallet', kind: 'cash' });
  insertAccount(target, { id: 'property-newest', kind: 'property', sortOrder: 2, createdAt: 100 });
  insertAccount(target, { id: 'property-oldest', kind: 'property', sortOrder: 0, createdAt: 50 });
  insertAccount(target, { id: 'property-middle', kind: 'property', sortOrder: 1, createdAt: 200 });
  insertAccount(target, { id: 'debt-c', kind: 'debt', createdAt: 10 });
  insertAccount(target, { id: 'debt-a', kind: 'debt', createdAt: 10 });
  insertAccount(target, { id: 'debt-B', kind: 'debt', createdAt: 10 });
  insertAccount(target, {
    id: 'property-archived',
    kind: 'property',
    createdAt: 1,
    archivedAt: 500,
  });
  insertAccount(target, { id: 'debt-archived', kind: 'debt', createdAt: 1, archivedAt: 500 });

  insertHolding(target, { id: 'wallet-cash', accountId: 'wallet', type: 'cash' });
  insertHolding(target, { id: 'newest-a', accountId: 'property-newest', createdAt: 5 });
  insertHolding(target, {
    id: 'newest-closed',
    accountId: 'property-newest',
    sortOrder: 1,
    createdAt: 6,
    closedAt: 99,
  });
  insertHolding(target, {
    id: 'oldest-a',
    accountId: 'property-oldest',
    sortOrder: 1,
    createdAt: 7,
  });
  insertHolding(target, { id: 'oldest-b', accountId: 'property-oldest', createdAt: 8 });
  insertHolding(target, { id: 'middle-a', accountId: 'property-middle' });
  insertHolding(target, { id: 'archived-held', accountId: 'property-archived', sortOrder: 9 });
  insertHolding(target, { id: 'debt-c-loan', accountId: 'debt-c', type: 'loan', createdAt: 4 });
  insertHolding(target, { id: 'debt-a-loan', accountId: 'debt-a', type: 'loan', createdAt: 4 });
  insertHolding(target, { id: 'debt-B-loan', accountId: 'debt-B', type: 'loan', createdAt: 4 });
  insertHolding(target, { id: 'debt-b-loan', accountId: 'debt-B', type: 'loan', createdAt: 4 });
  insertHolding(target, { id: 'debt-archived-loan', accountId: 'debt-archived', type: 'loan' });

  insertReminder(target, {
    id: 'newest-import',
    accountId: 'property-newest',
    kind: 'statement_import',
    createdAt: 30,
  });
  insertReminder(target, {
    id: 'newest-add',
    accountId: 'property-newest',
    kind: 'add_transactions',
    createdAt: 31,
  });
  insertReminder(target, {
    id: 'oldest-import',
    accountId: 'property-oldest',
    kind: 'statement_import',
    createdAt: 40,
  });
  insertReminder(target, {
    id: 'middle-import',
    accountId: 'property-middle',
    kind: 'statement_import',
    createdAt: 20,
    pausedAt: 777,
    lastEngagedAt: 555,
  });
  insertReminder(target, {
    id: 'middle-add',
    accountId: 'property-middle',
    kind: 'add_transactions',
    createdAt: 90,
  });
  insertReminder(target, {
    id: 'r-a',
    accountId: 'debt-a',
    kind: 'statement_import',
    createdAt: 7,
  });
  insertReminder(target, {
    id: 'r-B',
    accountId: 'debt-c',
    kind: 'statement_import',
    createdAt: 7,
    pausedAt: 888,
  });
  insertReminder(target, {
    id: 'archived-import',
    accountId: 'property-archived',
    kind: 'statement_import',
    createdAt: 2,
  });
  insertReminder(target, {
    id: 'wallet-import',
    accountId: 'wallet',
    kind: 'statement_import',
    createdAt: 1,
  });

  insertSettings(
    target,
    JSON.stringify({
      'property-newest': ['statement_import'],
      'property-middle': ['add_transactions'],
      'property-oldest': ['statement_import'],
      'property-archived': ['statement_import'],
      'debt-a': ['add_transactions'],
      'debt-c': ['statement_import'],
      'debt-B': [],
      wallet: ['statement_import'],
    }),
  );

  insertSyncState(target, 'wallet');
  insertSyncState(target, 'property-newest');
  insertSyncState(target, 'property-oldest');
  insertSyncState(target, 'debt-a');

  insertTransaction(target, 'payment', 'wallet-cash', 'debt-B-loan');
  insertTransaction(target, 'on-property', 'oldest-a', null);
  insertPricePoint(target, 'oldest-a');
  insertPricePoint(target, 'middle-a');
};

// A lone live account of each kind, which only gets the sentinel name.
const seedOneAccountOfEachKind = (target: DatabaseSync): void => {
  insertAccount(target, { id: 'only-property', kind: 'property' });
  insertAccount(target, { id: 'only-debt', kind: 'debt', createdAt: 3 });
  insertAccount(target, { id: 'debt-archived', kind: 'debt', createdAt: 1, archivedAt: 5 });
  insertHolding(target, { id: 'flat', accountId: 'only-property', sortOrder: 4 });
  insertHolding(target, { id: 'mortgage', accountId: 'only-debt', type: 'loan', sortOrder: 7 });
  insertReminder(target, {
    id: 'flat-import',
    accountId: 'only-property',
    kind: 'statement_import',
    createdAt: 3,
  });
  insertSettings(target, '{"only-property":["statement_import"],"only-debt":[]}');
};

const rowsOf = async (source: DatabaseSync) => {
  const drizzleOf = executingDrizzle<typeof database>(source);
  const dismissals = (await drizzleOf.select().from(settings))[0]?.reminderOfferDismissals;

  return {
    accounts: await drizzleOf.select().from(accounts).orderBy(asc(accounts.id)),
    holdings: await drizzleOf.select().from(holdings).orderBy(asc(holdings.id)),
    transactions: await drizzleOf.select().from(transactions).orderBy(asc(transactions.id)),
    // A restore restarts `activeSince` and `lastSnoozedAt` on every reminder, by design.
    reminders: await drizzleOf
      .select(columnsWithout(getTableColumns(reminders), 'activeSince', 'lastSnoozedAt'))
      .from(reminders)
      .orderBy(asc(reminders.id)),
    pricePoints: await drizzleOf.select().from(pricePoints).orderBy(asc(pricePoints.instrument)),
    syncState: await drizzleOf.select().from(syncState).orderBy(asc(syncState.accountId)),
    // The kinds in one account's list may come out in either order.
    dismissals:
      foldMap(maybe(dismissals), (map) =>
        Object.fromEntries(Object.entries(map).map(([key, kinds]) => [key, [...kinds].sort()])),
      ) ?? null,
  };
};

const bothPaths = async (seed: (target: DatabaseSync) => void) => {
  const seeded = databaseBefore0050();

  seed(seeded);
  mockDatabase = seeded;
  const exportedSnapshot = await readDataSnapshot();

  seeded.exec(MIGRATION_0050_SQL.split('--> statement-breakpoint').join('\n'));

  mockDatabase = freshDatabase();
  await restoreDataSnapshot(exportedSnapshot);

  return { live: await rowsOf(seeded), restored: await rowsOf(mockDatabase) };
};

describe('restoring a .kiko file exported before Property and Loans became implicit accounts', () => {
  describe.each([
    ['several accounts of each kind, with ties', seedSeveralAccountsOfEachKind],
    ['one account of each kind', seedOneAccountOfEachKind],
  ])('with %s', (_name, seed) => {
    it('ends with the same accounts as the live migration 0050 upgrade', async () => {
      const { live, restored } = await bothPaths(seed);

      expect(restored.accounts).toEqual(live.accounts);
    });

    it('ends with the same holdings as the live migration 0050 upgrade', async () => {
      const { live, restored } = await bothPaths(seed);

      expect(restored.holdings).toEqual(live.holdings);
    });

    it('ends with the same transactions, price points and sync state as the live migration 0050 upgrade', async () => {
      const { live, restored } = await bothPaths(seed);

      expect(restored.transactions).toEqual(live.transactions);
      expect(restored.pricePoints).toEqual(live.pricePoints);
      expect(restored.syncState).toEqual(live.syncState);
    });

    it('ends with the same reminders as the live migration 0050 upgrade, apart from the two columns a restore restarts', async () => {
      const { live, restored } = await bothPaths(seed);

      expect(restored.reminders).toEqual(live.reminders);
    });

    it('ends with the same dismissed reminder offers as the live migration 0050 upgrade', async () => {
      const { live, restored } = await bothPaths(seed);

      expect(restored.dismissals).toEqual(live.dismissals);
    });
  });

  it('keeps the account the UTF-16 code unit order picks on a three-way created_at tie, on both paths', async () => {
    const { live, restored } = await bothPaths(seedSeveralAccountsOfEachKind);
    const liveDebtIds = live.accounts.filter((row) => row.kind === 'debt').map((row) => row.id);

    expect(liveDebtIds).toEqual(['debt-B', 'debt-archived']);
    expect(restored.accounts.filter((row) => row.kind === 'debt').map((row) => row.id)).toEqual(
      liveDebtIds,
    );
  });
});
