// The reminders migration proven three ways: its generated SQL text, its
// registration where the count-based runner resolves it, and its behavior on a
// real `node:sqlite` engine (op-sqlite is a native module unavailable under
// Jest) — both the constraints it creates and the real `runMigrations` applying
// it once over a pre-reminders database, then doing nothing on a relaunch.
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

type SqlParameter = string | number | null;
type ExecuteResult = { rows: Record<string, unknown>[] };
type TransactionHandle = { execute: (sql: string, params?: SqlParameter[]) => ExecuteResult };

// jest's mock-hoisting guard lets the factory below reference only `mock`-prefixed
// bindings; each test assigns the engine the mocked client runs against.
let mockDatabase: DatabaseSync;

const mockExecute = (sql: string, params: SqlParameter[] = []): ExecuteResult => {
  if (/^\s*SELECT/i.test(sql)) {
    return { rows: mockDatabase.prepare(sql).all(...params) as Record<string, unknown>[] };
  }

  if (params.length === 0) {
    mockDatabase.exec(sql);
  } else {
    mockDatabase.prepare(sql).run(...params);
  }

  return { rows: [] };
};

jest.mock('./client', () => ({
  rawDatabase: {
    execute: async (sql: string, params?: SqlParameter[]) => mockExecute(sql, params),
    // `transaction` is op-sqlite's own method name, mirrored here.
    transaction: async (work: (databaseTransaction: TransactionHandle) => Promise<void>) => {
      mockDatabase.exec('BEGIN');

      try {
        await work({ execute: mockExecute });
        mockDatabase.exec('COMMIT');
      } catch (error) {
        mockDatabase.exec('ROLLBACK');
        throw error;
      }
    },
  },
}));

const MIGRATION_TAG = '0045_add_reminders';
const MIGRATIONS_ROOT = join(__dirname, '../../drizzle/migrations');
const STATEMENT_BREAKPOINT = '--> statement-breakpoint';
// drizzle-kit's own journal key, read by name so no identifier abbreviates it;
// the runner resolves an entry's SQL from this value, not from the tag.
const JOURNAL_INDEX_KEY = 'idx';

type JournalEntry = { when: number; tag: string; [key: string]: unknown };

const readJournal = (): JournalEntry[] =>
  (
    JSON.parse(readFileSync(join(MIGRATIONS_ROOT, 'meta/_journal.json'), 'utf8')) as {
      entries: JournalEntry[];
    }
  ).entries;

const migrationSql = (): string =>
  readFileSync(join(MIGRATIONS_ROOT, `${MIGRATION_TAG}.sql`), 'utf8');

// A fresh `require` after `jest.resetModules` is the only way past
// `runMigrations`' in-process memo, so each call behaves like a new launch.
const launchRunMigrations = async (): Promise<void> => {
  jest.resetModules();

  await (require('./run-migrations') as typeof import('./run-migrations')).runMigrations();
};

const openMigratedDatabase = (): DatabaseSync => {
  const database = new DatabaseSync(':memory:');

  database.exec('PRAGMA foreign_keys = ON');
  applyAllMigrations(database);

  return database;
};

// Every journal entry except the reminders one, applied and recorded the way
// the runner records them: the state of a device on the build before this one.
const openPreRemindersDatabase = (): DatabaseSync => {
  const database = new DatabaseSync(':memory:');
  const earlierEntries = readJournal().filter((entry) => entry.tag !== MIGRATION_TAG);

  database.exec('PRAGMA foreign_keys = ON');
  database.exec(
    'CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric)',
  );

  for (const entry of earlierEntries) {
    const statements = readFileSync(join(MIGRATIONS_ROOT, `${entry.tag}.sql`), 'utf8')
      .split(STATEMENT_BREAKPOINT)
      .filter((statement) => statement.trim() !== '');

    for (const statement of statements) {
      database.exec(statement);
    }

    database
      .prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
      .run('', entry.when);
  }

  return database;
};

const insertAccount = (database: DatabaseSync, id: string): void => {
  database.prepare("INSERT INTO accounts (id, name, kind) VALUES (?, 'Account', 'bank')").run(id);
};

const insertReminder = (
  database: DatabaseSync,
  reminder: { id: string; accountId: string; kind: string },
): void => {
  database
    .prepare(
      'INSERT INTO reminders (id, account_id, kind, schedule, active_since) VALUES (?, ?, ?, ?, ?)',
    )
    .run(
      reminder.id,
      reminder.accountId,
      reminder.kind,
      JSON.stringify({ frequency: 'daily', minuteOfDay: 1200 }),
      1_790_000_000_000,
    );
};

const tableColumns = (database: DatabaseSync, table: string): string[] =>
  (database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
    (column) => column.name,
  );

const appliedCount = (database: DatabaseSync): number =>
  Number(
    (
      database.prepare('SELECT COUNT(*) AS count FROM __drizzle_migrations').get() as {
        count: number;
      }
    ).count,
  );

describe('reminders migration SQL', () => {
  it('creates the reminders table with every column', () => {
    const sql = migrationSql();

    expect(sql).toContain('CREATE TABLE `reminders`');
    expect(sql).toContain('`id` text PRIMARY KEY NOT NULL');
    expect(sql).toContain('`account_id` text NOT NULL');
    expect(sql).toContain('`kind` text NOT NULL');
    expect(sql).toContain('`schedule` text NOT NULL');
    expect(sql).toContain('`paused_at` integer');
    expect(sql).toContain('`pause_reason` text');
    expect(sql).toContain('`active_since` integer NOT NULL');
    expect(sql).toContain('`last_engaged_at` integer');
    expect(sql).toContain('`last_snoozed_at` integer,');
    expect(sql).toContain('`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL');
    expect(sql).toContain('`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL');
  });

  it('references accounts from account_id', () => {
    expect(migrationSql()).toContain('FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`)');
  });

  it('creates the (account_id, kind) unique index', () => {
    expect(migrationSql()).toContain(
      'CREATE UNIQUE INDEX `reminders_account_kind` ON `reminders` (`account_id`,`kind`);',
    );
  });

  it('adds the nullable reminder_offer_dismissals column to settings', () => {
    expect(migrationSql()).toContain(
      'ALTER TABLE `settings` ADD `reminder_offer_dismissals` text;',
    );
  });

  it('is purely additive: every statement creates a table or index, or adds a column', () => {
    const statements = migrationSql()
      .split(STATEMENT_BREAKPOINT)
      .map((statement) => statement.trim())
      .filter((statement) => statement !== '');

    expect(statements).toHaveLength(3);

    for (const statement of statements) {
      expect(statement).toMatch(/^(CREATE TABLE|CREATE UNIQUE INDEX|ALTER TABLE `\w+` ADD) `/);
    }
  });
});

describe('reminders migration registration', () => {
  it('is the last journal entry, so the count-based runner applies it after every earlier one', () => {
    expect(readJournal().at(-1)?.tag).toBe(MIGRATION_TAG);
  });

  it('resolves its journal index to the bundle key that imports its SQL file', () => {
    const entry = readJournal().find((candidate) => candidate.tag === MIGRATION_TAG);
    const bundle = readFileSync(join(MIGRATIONS_ROOT, 'migrations.js'), 'utf8');
    const key = `m${String(entry?.[JOURNAL_INDEX_KEY]).padStart(4, '0')}`;

    expect(key).toBe('m0045');
    expect(bundle).toContain(`import ${key} from './${MIGRATION_TAG}.sql';`);
    expect(bundle).toMatch(new RegExp(`\\b${key},`));
  });
});

describe('reminders table constraints on a migrated database', () => {
  it('stores a reminder for an existing account with its defaults', () => {
    const database = openMigratedDatabase();

    insertAccount(database, 'account-1');
    insertReminder(database, {
      id: 'reminder-1',
      accountId: 'account-1',
      kind: 'statement_import',
    });

    const row = database.prepare('SELECT * FROM reminders').get() as Record<string, unknown>;

    expect(row.paused_at).toBeNull();
    expect(row.pause_reason).toBeNull();
    expect(row.last_engaged_at).toBeNull();
    expect(row.last_snoozed_at).toBeNull();
    expect(row.created_at).toEqual(expect.any(Number));
    expect(row.updated_at).toEqual(expect.any(Number));
  });

  it('rejects a reminder for an unknown account', () => {
    const database = openMigratedDatabase();

    expect(() =>
      insertReminder(database, {
        id: 'reminder-1',
        accountId: 'missing',
        kind: 'statement_import',
      }),
    ).toThrow(/FOREIGN KEY/);
  });

  it('rejects a second reminder of the same kind on one account', () => {
    const database = openMigratedDatabase();

    insertAccount(database, 'account-1');
    insertReminder(database, {
      id: 'reminder-1',
      accountId: 'account-1',
      kind: 'add_transactions',
    });

    expect(() =>
      insertReminder(database, {
        id: 'reminder-2',
        accountId: 'account-1',
        kind: 'add_transactions',
      }),
    ).toThrow(/UNIQUE/);
  });

  it('allows one reminder of each kind on one account', () => {
    const database = openMigratedDatabase();

    insertAccount(database, 'account-1');
    insertReminder(database, {
      id: 'reminder-1',
      accountId: 'account-1',
      kind: 'add_transactions',
    });
    insertReminder(database, {
      id: 'reminder-2',
      accountId: 'account-1',
      kind: 'statement_import',
    });

    expect(database.prepare('SELECT COUNT(*) AS count FROM reminders').get()).toEqual({ count: 2 });
  });
});

describe('runMigrations over a pre-reminders database', () => {
  it('applies the reminders migration once and keeps the existing data', async () => {
    mockDatabase = openPreRemindersDatabase();
    insertAccount(mockDatabase, 'account-1');

    await launchRunMigrations();

    expect(appliedCount(mockDatabase)).toBe(readJournal().length);
    expect(tableColumns(mockDatabase, 'reminders')).toContain('account_id');
    expect(tableColumns(mockDatabase, 'settings')).toContain('reminder_offer_dismissals');
    expect(mockDatabase.prepare('SELECT id FROM accounts').all()).toEqual([{ id: 'account-1' }]);
  });

  it('is a no-op on the next launch', async () => {
    mockDatabase = openPreRemindersDatabase();

    await launchRunMigrations();
    insertAccount(mockDatabase, 'account-1');
    insertReminder(mockDatabase, {
      id: 'reminder-1',
      accountId: 'account-1',
      kind: 'statement_import',
    });

    await launchRunMigrations();

    expect(appliedCount(mockDatabase)).toBe(readJournal().length);
    expect(mockDatabase.prepare('SELECT id FROM reminders').all()).toEqual([{ id: 'reminder-1' }]);
  });
});
