// drizzle/migrations/0050-implicit-property-debt-accounts.test.ts
//
// Runs the shipped SQL on a real `node:sqlite` engine seeded as a device's
// database stood before it, so the merge and the partial unique index are
// proven against real rows, not a restated predicate.
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { IMPLICIT_ACCOUNT_STORED_NAME } from '@kiko/holdings/implicit-account';
import { applyAllMigrations, applyMigrationsThrough } from '@kiko/test-support/real-sqlite';

const STATEMENT_BREAKPOINT = '--> statement-breakpoint';

const MIGRATION_SQL = readFileSync(
  join(__dirname, '0050_implicit_property_debt_accounts.sql'),
  'utf8',
);

type Row = Record<string, unknown>;

const databaseBefore = (): DatabaseSync => {
  const database = new DatabaseSync(':memory:');

  applyMigrationsThrough(database, '0049_bank_accounts_other_bank');

  return database;
};

const migrationStatements = (): string[] =>
  MIGRATION_SQL.split(STATEMENT_BREAKPOINT)
    .map((statement) => statement.trim())
    .filter((statement) => statement !== '');

const applyMigration = (database: DatabaseSync): void => {
  for (const statement of migrationStatements()) {
    database.exec(statement);
  }
};

// Every statement but the unique index: what a second run of the data part
// does to a database the migration already ran on.
const applyDataStatements = (database: DatabaseSync): void => {
  for (const statement of migrationStatements()) {
    if (!statement.startsWith('CREATE UNIQUE INDEX')) {
      database.exec(statement);
    }
  }
};

type AccountSeed = {
  id: string;
  kind: 'property' | 'debt' | 'bank';
  name?: string;
  sortOrder?: number;
  createdAt?: number;
  archivedAt?: number | null;
  icon?: string | null;
  color?: string | null;
};

const insertAccount = (database: DatabaseSync, seed: AccountSeed): void => {
  database
    .prepare(
      `INSERT INTO accounts (id, name, kind, sort_order, created_at, archived_at, icon, color)
       VALUES (:id, :name, :kind, :sortOrder, :createdAt, :archivedAt, :icon, :color)`,
    )
    .run({
      name: seed.id,
      sortOrder: 0,
      createdAt: 1,
      archivedAt: null,
      icon: 'custom-glyph',
      color: '#112233',
      ...seed,
    });
};

type HoldingSeed = {
  id: string;
  accountId: string;
  type?: string;
  sortOrder?: number;
  createdAt?: number;
  closedAt?: number | null;
  balanceMinorUnits?: number;
  metadata?: string | null;
};

const insertHolding = (database: DatabaseSync, seed: HoldingSeed): void => {
  database
    .prepare(
      `INSERT INTO holdings
         (id, account_id, name, type, currency, balance_minor_units, metadata, sort_order, closed_at, created_at)
       VALUES (:id, :accountId, :id, :type, 'UAH', :balanceMinorUnits, :metadata, :sortOrder, :closedAt, :createdAt)`,
    )
    .run({
      type: 'property_item',
      sortOrder: 0,
      createdAt: 1,
      closedAt: null,
      balanceMinorUnits: 100,
      metadata: '{"note":"kept"}',
      ...seed,
    });
};

type ReminderSeed = {
  id: string;
  accountId: string;
  kind: 'statement_import' | 'add_transactions';
  createdAt: number;
  schedule?: string;
  pausedAt?: number | null;
  pauseReason?: 'user' | 'backoff' | null;
  activeSince?: number;
  lastEngagedAt?: number | null;
  lastSnoozedAt?: number | null;
  updatedAt?: number;
};

const insertReminder = (database: DatabaseSync, seed: ReminderSeed): void => {
  database
    .prepare(
      `INSERT INTO reminders
         (id, account_id, kind, schedule, paused_at, pause_reason, active_since,
          last_engaged_at, last_snoozed_at, created_at, updated_at)
       VALUES (:id, :accountId, :kind, :schedule, :pausedAt, :pauseReason, :activeSince,
               :lastEngagedAt, :lastSnoozedAt, :createdAt, :updatedAt)`,
    )
    .run({
      schedule: `{"frequency":"daily","minuteOfDay":${seed.createdAt}}`,
      pausedAt: null,
      pauseReason: null,
      activeSince: seed.createdAt + 1,
      lastEngagedAt: null,
      lastSnoozedAt: null,
      updatedAt: seed.createdAt + 2,
      ...seed,
    });
};

const insertSettings = (database: DatabaseSync, dismissals: string | null): void => {
  database
    .prepare('INSERT INTO settings (id, reminder_offer_dismissals) VALUES (1, ?)')
    .run(dismissals);
};

const insertSyncState = (database: DatabaseSync, accountId: string): void => {
  database
    .prepare('INSERT INTO sync_state (account_id, last_sync_at) VALUES (?, 5)')
    .run(accountId);
};

const insertTransaction = (
  database: DatabaseSync,
  id: string,
  holdingId: string,
  loanHoldingId: string | null,
): void => {
  database
    .prepare(
      `INSERT INTO transactions (id, holding_id, amount_minor_units, time, source, loan_holding_id)
       VALUES (?, ?, -50, 10, 'manual', ?)`,
    )
    .run(id, holdingId, loanHoldingId);
};

const insertPricePoint = (database: DatabaseSync, holdingId: string): void => {
  database
    .prepare(
      `INSERT INTO price_points (instrument, day, price, currency, source)
       VALUES (?, '2026-01-01', 1.5, 'UAH', 'manual')`,
    )
    .run(`holding:${holdingId}`);
};

const rows = (database: DatabaseSync, sql: string, ...parameters: string[]): Row[] =>
  database.prepare(sql).all(...parameters) as Row[];

const tableNames = (database: DatabaseSync): string[] =>
  rows(
    database,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).map((row) => row.name as string);

// Every table's full contents, as the exact text a byte comparison needs.
const dumpEveryTable = (database: DatabaseSync): string =>
  JSON.stringify(
    tableNames(database).map((table) => [
      table,
      rows(database, `SELECT * FROM ${table} ORDER BY rowid`),
    ]),
  );

const accountRow = (database: DatabaseSync, id: string): Row | undefined =>
  rows(database, 'SELECT * FROM accounts WHERE id = ?', id)[0];

const accountIds = (database: DatabaseSync): string[] =>
  rows(database, 'SELECT id FROM accounts ORDER BY id').map((row) => row.id as string);

const holdingPlacements = (database: DatabaseSync): Row[] =>
  rows(
    database,
    'SELECT id, account_id AS accountId, sort_order AS sortOrder FROM holdings ORDER BY id',
  );

const holdingsOrdered = (database: DatabaseSync, accountId: string): string[] =>
  rows(
    database,
    'SELECT id FROM holdings WHERE account_id = ? ORDER BY sort_order, id',
    accountId,
  ).map((row) => row.id as string);

const reminderRow = (database: DatabaseSync, id: string): Row | undefined =>
  rows(database, 'SELECT * FROM reminders WHERE id = ?', id)[0];

const reminderIds = (database: DatabaseSync): string[] =>
  rows(database, 'SELECT id FROM reminders ORDER BY id').map((row) => row.id as string);

const dismissals = (database: DatabaseSync): Record<string, string[]> | null => {
  const stored = (rows(database, 'SELECT reminder_offer_dismissals AS stored FROM settings')[0] ??
    {}) as { stored?: string | null };

  if (stored.stored === undefined || stored.stored === null) {
    return null;
  }

  return Object.fromEntries(
    Object.entries(JSON.parse(stored.stored) as Record<string, string[]>).map(([key, kinds]) => [
      key,
      [...kinds].sort(),
    ]),
  );
};

const unrelatedTables = (database: DatabaseSync): string =>
  JSON.stringify([
    rows(database, 'SELECT * FROM transactions ORDER BY id'),
    rows(database, 'SELECT * FROM price_points ORDER BY instrument'),
    rows(
      database,
      `SELECT id, type, currency, balance_minor_units, metadata, closed_at, created_at, name
         FROM holdings ORDER BY id`,
    ),
  ]);

// Three property accounts and two debt accounts, with holdings (one closed),
// reminders on several of them, a dismissal map, and a stray `sync_state` row
// on a merged-away account.
//
// property: kept = `property-oldest` (created_at 50). Section order by
// sort_order: property-oldest (0), property-middle (1), property-newest (2).
// debt: kept = `debt-oldest` (created_at 10); `debt-newest` (sort_order 0)
// sits before it in the section.
const seedMergeScenario = (database: DatabaseSync): void => {
  insertAccount(database, {
    id: 'property-newest',
    kind: 'property',
    sortOrder: 2,
    createdAt: 100,
  });
  insertAccount(database, { id: 'property-oldest', kind: 'property', sortOrder: 0, createdAt: 50 });
  insertAccount(database, {
    id: 'property-middle',
    kind: 'property',
    sortOrder: 1,
    createdAt: 200,
  });
  insertAccount(database, { id: 'debt-oldest', kind: 'debt', sortOrder: 1, createdAt: 10 });
  insertAccount(database, { id: 'debt-newest', kind: 'debt', sortOrder: 0, createdAt: 20 });
  insertAccount(database, { id: 'bank', kind: 'bank', sortOrder: 0, createdAt: 5 });

  insertHolding(database, { id: 'bank-card', accountId: 'bank', type: 'card' });
  insertHolding(database, {
    id: 'newest-a',
    accountId: 'property-newest',
    sortOrder: 0,
    createdAt: 5,
  });
  insertHolding(database, {
    id: 'newest-closed',
    accountId: 'property-newest',
    sortOrder: 1,
    createdAt: 6,
    closedAt: 99,
    balanceMinorUnits: 0,
  });
  insertHolding(database, {
    id: 'oldest-a',
    accountId: 'property-oldest',
    sortOrder: 1,
    createdAt: 7,
  });
  insertHolding(database, {
    id: 'oldest-b',
    accountId: 'property-oldest',
    sortOrder: 0,
    createdAt: 8,
  });
  insertHolding(database, {
    id: 'middle-a',
    accountId: 'property-middle',
    sortOrder: 0,
    createdAt: 1,
  });
  insertHolding(database, {
    id: 'debt-oldest-a',
    accountId: 'debt-oldest',
    type: 'loan',
    sortOrder: 0,
  });
  insertHolding(database, {
    id: 'debt-newest-a',
    accountId: 'debt-newest',
    type: 'loan',
    sortOrder: 0,
    createdAt: 9,
  });
  insertHolding(database, {
    id: 'debt-newest-b',
    accountId: 'debt-newest',
    type: 'loan',
    sortOrder: 1,
    createdAt: 3,
  });

  insertReminder(database, {
    id: 'newest-import',
    accountId: 'property-newest',
    kind: 'statement_import',
    createdAt: 30,
  });
  insertReminder(database, {
    id: 'newest-add',
    accountId: 'property-newest',
    kind: 'add_transactions',
    createdAt: 31,
  });
  insertReminder(database, {
    id: 'oldest-import',
    accountId: 'property-oldest',
    kind: 'statement_import',
    createdAt: 40,
  });
  insertReminder(database, {
    id: 'middle-import',
    accountId: 'property-middle',
    kind: 'statement_import',
    createdAt: 20,
    schedule: '{"frequency":"weekly","minuteOfDay":540,"weekdays":[1,3]}',
    pausedAt: 777,
    pauseReason: 'user',
    lastEngagedAt: 555,
    lastSnoozedAt: 666,
  });
  insertReminder(database, {
    id: 'middle-add',
    accountId: 'property-middle',
    kind: 'add_transactions',
    createdAt: 90,
  });
  insertReminder(database, {
    id: 'debt-newest-import',
    accountId: 'debt-newest',
    kind: 'statement_import',
    createdAt: 15,
    pausedAt: 888,
    pauseReason: 'backoff',
  });
  insertReminder(database, {
    id: 'bank-import',
    accountId: 'bank',
    kind: 'statement_import',
    createdAt: 1,
  });

  insertSettings(
    database,
    JSON.stringify({
      'property-newest': ['statement_import'],
      'property-middle': ['add_transactions'],
      'property-oldest': ['statement_import'],
      'debt-newest': ['add_transactions'],
      'debt-oldest': [],
      bank: ['statement_import'],
    }),
  );

  insertSyncState(database, 'bank');
  insertSyncState(database, 'property-newest');
  insertSyncState(database, 'property-middle');
  insertSyncState(database, 'property-oldest');

  insertTransaction(database, 'payment', 'bank-card', 'debt-oldest-a');
  insertTransaction(database, 'on-property', 'oldest-a', null);
  insertPricePoint(database, 'oldest-a');
  insertPricePoint(database, 'middle-a');
};

describe('migration 0050: one live Property and one live Debt account', () => {
  it('changes nothing on a database with no property or debt account', () => {
    const database = databaseBefore();

    insertAccount(database, { id: 'bank', kind: 'bank' });
    insertHolding(database, { id: 'bank-card', accountId: 'bank', type: 'card' });
    insertReminder(database, {
      id: 'bank-import',
      accountId: 'bank',
      kind: 'statement_import',
      createdAt: 3,
    });
    insertSettings(database, '{"bank":["statement_import"]}');
    const before = dumpEveryTable(database);

    applyMigration(database);

    expect(dumpEveryTable(database)).toBe(before);
  });

  it('leaves the holdings, reminders and dismissals of a lone account of each kind in place, and gives it the sentinel name with no icon or color', () => {
    const database = databaseBefore();

    insertAccount(database, { id: 'only-property', kind: 'property', name: 'My flat' });
    insertAccount(database, { id: 'only-debt', kind: 'debt', name: 'Mortgage' });
    insertHolding(database, { id: 'flat', accountId: 'only-property', sortOrder: 4 });
    insertHolding(database, { id: 'mortgage', accountId: 'only-debt', type: 'loan', sortOrder: 7 });
    insertReminder(database, {
      id: 'flat-import',
      accountId: 'only-property',
      kind: 'statement_import',
      createdAt: 3,
    });
    insertReminder(database, {
      id: 'debt-add',
      accountId: 'only-debt',
      kind: 'add_transactions',
      createdAt: 4,
    });
    insertSettings(database, '{"only-property":["statement_import"],"only-debt":[]}');
    const reminderBefore = [
      reminderRow(database, 'flat-import'),
      reminderRow(database, 'debt-add'),
    ];
    const holdingsBefore = holdingPlacements(database);

    applyMigration(database);

    expect(holdingPlacements(database)).toEqual(holdingsBefore);
    expect([reminderRow(database, 'flat-import'), reminderRow(database, 'debt-add')]).toEqual(
      reminderBefore,
    );
    expect(
      rows(database, 'SELECT reminder_offer_dismissals AS stored FROM settings')[0]?.stored,
    ).toBe('{"only-property":["statement_import"],"only-debt":[]}');
    expect(accountRow(database, 'only-property')).toMatchObject({
      name: IMPLICIT_ACCOUNT_STORED_NAME.property,
      icon: null,
      color: null,
    });
    expect(accountRow(database, 'only-debt')).toMatchObject({
      name: IMPLICIT_ACCOUNT_STORED_NAME.debt,
      icon: null,
      color: null,
    });
  });

  describe('merging several live accounts of one kind into the oldest', () => {
    it('keeps the oldest account of each kind and deletes the others', () => {
      const database = databaseBefore();

      seedMergeScenario(database);
      applyMigration(database);

      expect(accountIds(database)).toEqual(['bank', 'debt-oldest', 'property-oldest']);
    });

    it('moves every holding, closed ones included, to the kept account in the old visible order', () => {
      const database = databaseBefore();

      seedMergeScenario(database);
      applyMigration(database);

      expect(holdingPlacements(database)).toEqual([
        { id: 'bank-card', accountId: 'bank', sortOrder: 0 },
        { id: 'debt-newest-a', accountId: 'debt-oldest', sortOrder: 0 },
        { id: 'debt-newest-b', accountId: 'debt-oldest', sortOrder: 1 },
        { id: 'debt-oldest-a', accountId: 'debt-oldest', sortOrder: 2 },
        { id: 'middle-a', accountId: 'property-oldest', sortOrder: 2 },
        { id: 'newest-a', accountId: 'property-oldest', sortOrder: 3 },
        { id: 'newest-closed', accountId: 'property-oldest', sortOrder: 4 },
        { id: 'oldest-a', accountId: 'property-oldest', sortOrder: 1 },
        { id: 'oldest-b', accountId: 'property-oldest', sortOrder: 0 },
      ]);
    });

    it('keeps, per reminder kind, only the earliest-created reminder, re-pointed with its state unchanged', () => {
      const database = databaseBefore();

      seedMergeScenario(database);
      const survivors = ['middle-import', 'newest-add', 'debt-newest-import'].map((id) =>
        reminderRow(database, id),
      );
      const bankBefore = reminderRow(database, 'bank-import');

      applyMigration(database);

      expect(reminderIds(database)).toEqual([
        'bank-import',
        'debt-newest-import',
        'middle-import',
        'newest-add',
      ]);
      expect(reminderRow(database, 'middle-import')).toEqual({
        ...survivors[0],
        account_id: 'property-oldest',
      });
      expect(reminderRow(database, 'newest-add')).toEqual({
        ...survivors[1],
        account_id: 'property-oldest',
      });
      expect(reminderRow(database, 'debt-newest-import')).toEqual({
        ...survivors[2],
        account_id: 'debt-oldest',
      });
      expect(reminderRow(database, 'bank-import')).toEqual(bankBefore);
    });

    it('unions the dismissed kinds onto the kept account and removes the deleted accounts keys', () => {
      const database = databaseBefore();

      seedMergeScenario(database);
      applyMigration(database);

      expect(dismissals(database)).toEqual({
        'property-oldest': ['add_transactions', 'statement_import'],
        'debt-oldest': ['add_transactions'],
        bank: ['statement_import'],
      });
    });

    it('deletes the sync_state rows of the merged-away accounts and keeps the others', () => {
      const database = databaseBefore();

      seedMergeScenario(database);
      applyMigration(database);

      expect(rows(database, 'SELECT account_id FROM sync_state ORDER BY account_id')).toEqual([
        { account_id: 'bank' },
        { account_id: 'property-oldest' },
      ]);
    });

    it('leaves transactions, price points, balances, metadata and the holding count of each kind unchanged', () => {
      const database = databaseBefore();

      seedMergeScenario(database);
      const before = unrelatedTables(database);
      const countsBefore = rows(
        database,
        `SELECT a.kind AS kind, COUNT(*) AS total FROM holdings h
           JOIN accounts a ON a.id = h.account_id GROUP BY a.kind ORDER BY a.kind`,
      );

      applyMigration(database);

      expect(unrelatedTables(database)).toBe(before);
      expect(
        rows(
          database,
          `SELECT a.kind AS kind, COUNT(*) AS total FROM holdings h
             JOIN accounts a ON a.id = h.account_id GROUP BY a.kind ORDER BY a.kind`,
        ),
      ).toEqual(countsBefore);
    });

    it('leaves every holding of a merged account reachable: none points at a deleted account', () => {
      const database = databaseBefore();

      seedMergeScenario(database);
      applyMigration(database);

      expect(
        rows(
          database,
          `SELECT h.id FROM holdings h LEFT JOIN accounts a ON a.id = h.account_id WHERE a.id IS NULL`,
        ),
      ).toEqual([]);
      expect(rows(database, 'PRAGMA foreign_key_check')).toEqual([]);
    });

    it('leaves a NULL dismissal map NULL', () => {
      const database = databaseBefore();

      insertAccount(database, { id: 'first', kind: 'property', createdAt: 1 });
      insertAccount(database, { id: 'second', kind: 'property', createdAt: 2 });
      insertSettings(database, null);
      applyMigration(database);

      expect(dismissals(database)).toBeNull();
    });

    it('drops an account whose only dismissals were an empty list, but keeps the map an object', () => {
      const database = databaseBefore();

      insertAccount(database, { id: 'first', kind: 'property', createdAt: 1 });
      insertAccount(database, { id: 'second', kind: 'property', createdAt: 2 });
      insertSettings(database, '{"first":[],"second":[]}');
      applyMigration(database);

      expect(dismissals(database)).toEqual({});
    });
  });

  describe('which account is kept on a created_at tie', () => {
    it('breaks the tie by sort_order', () => {
      const database = databaseBefore();

      insertAccount(database, { id: 'a', kind: 'property', createdAt: 10, sortOrder: 1 });
      insertAccount(database, { id: 'b', kind: 'property', createdAt: 10, sortOrder: 0 });
      insertHolding(database, { id: 'held-by-a', accountId: 'a' });
      applyMigration(database);

      expect(accountIds(database)).toEqual(['b']);
      expect(holdingPlacements(database)).toEqual([
        { id: 'held-by-a', accountId: 'b', sortOrder: 0 },
      ]);
    });

    it('breaks a created_at and sort_order tie by id', () => {
      const database = databaseBefore();

      insertAccount(database, { id: 'z', kind: 'debt', createdAt: 10, sortOrder: 0 });
      insertAccount(database, { id: 'a', kind: 'debt', createdAt: 10, sortOrder: 0 });
      applyMigration(database);

      expect(accountIds(database)).toEqual(['a']);
    });

    it('orders tied holdings, and the holdings of tied accounts, by id', () => {
      const database = databaseBefore();

      insertAccount(database, { id: 'z', kind: 'property', createdAt: 10, sortOrder: 0 });
      insertAccount(database, { id: 'a', kind: 'property', createdAt: 10, sortOrder: 0 });
      insertHolding(database, { id: 'h-z-2', accountId: 'z', sortOrder: 0, createdAt: 4 });
      insertHolding(database, { id: 'h-z-1', accountId: 'z', sortOrder: 0, createdAt: 4 });
      insertHolding(database, { id: 'h-a-1', accountId: 'a', sortOrder: 5, createdAt: 9 });
      applyMigration(database);

      expect(holdingsOrdered(database, 'a')).toEqual(['h-a-1', 'h-z-1', 'h-z-2']);
    });

    it('keeps the earliest reminder by id when two share created_at', () => {
      const database = databaseBefore();

      insertAccount(database, { id: 'first', kind: 'property', createdAt: 1 });
      insertAccount(database, { id: 'second', kind: 'property', createdAt: 2 });
      insertReminder(database, {
        id: 'r-b',
        accountId: 'first',
        kind: 'statement_import',
        createdAt: 7,
      });
      insertReminder(database, {
        id: 'r-a',
        accountId: 'second',
        kind: 'statement_import',
        createdAt: 7,
      });
      applyMigration(database);

      expect(reminderIds(database)).toEqual(['r-a']);
      expect(reminderRow(database, 'r-a')).toMatchObject({ account_id: 'first' });
    });
  });

  describe('an archived property or debt account', () => {
    it('is untouched by the merge and by the sentinel rename, next to live accounts', () => {
      const database = databaseBefore();

      insertAccount(database, {
        id: 'archived',
        kind: 'property',
        name: 'Old flat',
        createdAt: 1,
        sortOrder: 0,
        archivedAt: 500,
      });
      insertAccount(database, { id: 'live-first', kind: 'property', createdAt: 20 });
      insertAccount(database, { id: 'live-second', kind: 'property', createdAt: 30 });
      insertHolding(database, { id: 'archived-held', accountId: 'archived', sortOrder: 9 });
      insertHolding(database, { id: 'live-held', accountId: 'live-second', sortOrder: 3 });
      insertReminder(database, {
        id: 'archived-import',
        accountId: 'archived',
        kind: 'statement_import',
        createdAt: 2,
      });
      insertReminder(database, {
        id: 'live-import',
        accountId: 'live-second',
        kind: 'statement_import',
        createdAt: 3,
      });
      insertSettings(
        database,
        '{"archived":["statement_import"],"live-second":["add_transactions"]}',
      );
      const archivedBefore = accountRow(database, 'archived');
      const archivedReminderBefore = reminderRow(database, 'archived-import');

      applyMigration(database);

      expect(accountRow(database, 'archived')).toEqual(archivedBefore);
      expect(reminderRow(database, 'archived-import')).toEqual(archivedReminderBefore);
      expect(
        rows(database, "SELECT account_id, sort_order FROM holdings WHERE id = 'archived-held'"),
      ).toEqual([{ account_id: 'archived', sort_order: 9 }]);
      expect(accountIds(database)).toEqual(['archived', 'live-first']);
      expect(reminderRow(database, 'live-import')).toMatchObject({ account_id: 'live-first' });
      expect(dismissals(database)).toEqual({
        archived: ['statement_import'],
        'live-first': ['add_transactions'],
      });
    });

    it('is never the kept account, however early it was created', () => {
      const database = databaseBefore();

      insertAccount(database, { id: 'archived-debt', kind: 'debt', createdAt: 1, archivedAt: 5 });
      insertAccount(database, { id: 'live-debt', kind: 'debt', createdAt: 9 });
      applyMigration(database);

      expect(accountIds(database)).toEqual(['archived-debt', 'live-debt']);
      expect(accountRow(database, 'live-debt')).toMatchObject({
        name: IMPLICIT_ACCOUNT_STORED_NAME.debt,
        icon: null,
        color: null,
      });
      expect(accountRow(database, 'archived-debt')).toMatchObject({
        name: 'archived-debt',
        icon: 'custom-glyph',
        color: '#112233',
      });
    });
  });

  describe('the partial unique index', () => {
    const migratedDatabase = (): DatabaseSync => {
      const database = databaseBefore();

      insertAccount(database, { id: 'property', kind: 'property' });
      insertAccount(database, { id: 'debt', kind: 'debt' });
      applyMigration(database);

      return database;
    };

    it.each(['property', 'debt'] as const)('rejects a second live %s account', (kind) => {
      const database = migratedDatabase();

      expect(() => insertAccount(database, { id: 'second', kind })).toThrow(
        /UNIQUE constraint failed/,
      );
    });

    it.each(['property', 'debt'] as const)('accepts a second ARCHIVED %s account', (kind) => {
      const database = migratedDatabase();

      insertAccount(database, { id: 'archived', kind, archivedAt: 5 });
      insertAccount(database, { id: 'archived-again', kind, archivedAt: 6 });

      expect(accountRow(database, 'archived')).toBeDefined();
    });

    it('accepts any number of live accounts of every other kind', () => {
      const database = migratedDatabase();

      insertAccount(database, { id: 'bank-one', kind: 'bank' });
      insertAccount(database, { id: 'bank-two', kind: 'bank' });

      expect(accountRow(database, 'bank-two')).toBeDefined();
    });

    it('is declared WHERE the kind is property or debt and the account is not archived', () => {
      const database = migratedDatabase();

      expect(
        rows(
          database,
          "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'accounts_implicit_kind'",
        )[0]?.sql,
      ).toMatch(/UNIQUE INDEX .*accounts_implicit_kind.* \(`?kind`?\) WHERE .*'property', 'debt'/);
    });
  });

  it('is idempotent: running the data statements again changes nothing', () => {
    const database = databaseBefore();

    seedMergeScenario(database);
    applyMigration(database);
    const afterFirstRun = dumpEveryTable(database);

    applyDataStatements(database);

    expect(dumpEveryTable(database)).toBe(afterFirstRun);
  });

  it('drops every temp table it derives from', () => {
    const database = databaseBefore();

    seedMergeScenario(database);
    applyMigration(database);

    expect(rows(database, 'SELECT name FROM sqlite_temp_master')).toEqual([]);
  });

  it('applies on an empty database through the runner path', () => {
    const database = new DatabaseSync(':memory:');

    expect(() => applyAllMigrations(database)).not.toThrow();
    expect(
      rows(database, "SELECT name FROM sqlite_master WHERE name = 'accounts_implicit_kind'"),
    ).toEqual([{ name: 'accounts_implicit_kind' }]);
  });
});
