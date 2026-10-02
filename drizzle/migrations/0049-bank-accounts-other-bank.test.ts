// drizzle/migrations/0049-bank-accounts-other-bank.test.ts
//
// Runs the shipped SQL on a real `node:sqlite` engine seeded as a device's
// database stood before it, so the backfill is proven against real rows, not
// a restated predicate.
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { applyMigrationsThrough } from '@kiko/test-support/real-sqlite';

const MIGRATION_SQL = readFileSync(join(__dirname, '0049_bank_accounts_other_bank.sql'), 'utf8');

const databaseBefore = (): DatabaseSync => {
  const database = new DatabaseSync(':memory:');

  applyMigrationsThrough(database, '0048_add_lots_recosted');

  return database;
};

const insertAccount = (
  database: DatabaseSync,
  id: string,
  kind: string,
  bankId: string | null,
): void => {
  database
    .prepare('INSERT INTO accounts (id, name, kind, bank_id) VALUES (?, ?, ?, ?)')
    .run(id, id, kind, bankId);
};

const applyMigration = (database: DatabaseSync): void => {
  database.exec(MIGRATION_SQL.split('--> statement-breakpoint').join('\n'));
};

const bankIds = (database: DatabaseSync): Record<string, string | null> =>
  Object.fromEntries(
    (
      database.prepare('SELECT id, bank_id AS bankId FROM accounts ORDER BY id').all() as {
        id: string;
        bankId: string | null;
      }[]
    ).map((row) => [row.id, row.bankId]),
  );

describe('migration 0049: a bank account with no bank becomes "other"', () => {
  it('gives every bank account whose bank_id is NULL the value other', () => {
    const database = databaseBefore();

    insertAccount(database, 'free-bank', 'bank', null);
    insertAccount(database, 'another-free-bank', 'bank', null);
    applyMigration(database);

    expect(bankIds(database)).toEqual({ 'another-free-bank': 'other', 'free-bank': 'other' });
  });

  it('keeps a bank account that already names a bank, listed or not', () => {
    const database = databaseBefore();

    insertAccount(database, 'monobank', 'bank', 'monobank');
    insertAccount(database, 'removed-bank', 'bank', 'a-since-removed-bank');
    insertAccount(database, 'already-other', 'bank', 'other');
    applyMigration(database);

    expect(bankIds(database)).toEqual({
      'already-other': 'other',
      monobank: 'monobank',
      'removed-bank': 'a-since-removed-bank',
    });
  });

  it('leaves a NULL bank_id on every other kind unchanged, a broker with no pick included', () => {
    const database = databaseBefore();

    for (const kind of ['broker', 'cash', 'crypto', 'property', 'metals', 'debt']) {
      insertAccount(database, kind, kind, null);
    }
    insertAccount(database, 'picked-broker', 'broker', 'ibkr');
    applyMigration(database);

    expect(bankIds(database)).toEqual({
      broker: null,
      cash: null,
      crypto: null,
      debt: null,
      metals: null,
      'picked-broker': 'ibkr',
      property: null,
    });
  });

  it('is idempotent: a second run changes nothing', () => {
    const database = databaseBefore();

    insertAccount(database, 'free-bank', 'bank', null);
    insertAccount(database, 'broker', 'broker', null);
    applyMigration(database);
    const afterFirstRun = bankIds(database);

    applyMigration(database);

    expect(bankIds(database)).toEqual(afterFirstRun);
  });

  it('leaves every other column of the row as it was', () => {
    const database = databaseBefore();

    database
      .prepare(
        `INSERT INTO accounts (id, name, kind, institution, color, icon, sort_order)
         VALUES ('free-bank', 'Card', 'bank', 'monobank', '#112233', 'banknote', 7)`,
      )
      .run();
    applyMigration(database);

    expect(
      database
        .prepare(
          'SELECT name, kind, institution, color, icon, sort_order AS sortOrder FROM accounts',
        )
        .get(),
    ).toEqual({
      name: 'Card',
      kind: 'bank',
      institution: 'monobank',
      color: '#112233',
      icon: 'banknote',
      sortOrder: 7,
    });
  });
});
