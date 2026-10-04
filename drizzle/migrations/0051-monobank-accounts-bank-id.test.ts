// drizzle/migrations/0051-monobank-accounts-bank-id.test.ts
//
// Runs the shipped SQL on a real `node:sqlite` engine seeded as a device's
// database stood before it, so the correction is proven against real rows,
// not a restated predicate.
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { applyMigrationsThrough } from '@kiko/test-support/real-sqlite';

const MIGRATION_SQL = readFileSync(join(__dirname, '0051_monobank_accounts_bank_id.sql'), 'utf8');

const databaseBefore = (): DatabaseSync => {
  const database = new DatabaseSync(':memory:');

  applyMigrationsThrough(database, '0050_implicit_property_debt_accounts');

  return database;
};

const insertAccount = (
  database: DatabaseSync,
  id: string,
  kind: string,
  bankId: string | null,
  institution: string | null,
): void => {
  database
    .prepare('INSERT INTO accounts (id, name, kind, bank_id, institution) VALUES (?, ?, ?, ?, ?)')
    .run(id, id, kind, bankId, institution);
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

describe('migration 0051: a connected Monobank account stored as "other" becomes "monobank"', () => {
  it('gives a bank account that is connected to Monobank and stored as other the id monobank', () => {
    const database = databaseBefore();

    insertAccount(database, 'connected-card', 'bank', 'other', 'monobank');
    applyMigration(database);

    expect(bankIds(database)).toEqual({ 'connected-card': 'monobank' });
  });

  it('keeps a bank account stored as other that is not connected', () => {
    const database = databaseBefore();

    insertAccount(database, 'disconnected-card', 'bank', 'other', null);
    insertAccount(database, 'other-institution', 'bank', 'other', 'some-other-provider');
    applyMigration(database);

    expect(bankIds(database)).toEqual({
      'disconnected-card': 'other',
      'other-institution': 'other',
    });
  });

  it('keeps a bank account that names another bank, connected or not', () => {
    const database = databaseBefore();

    insertAccount(database, 'privat', 'bank', 'privatbank', 'monobank');
    insertAccount(database, 'removed-bank', 'bank', 'a-since-removed-bank', 'monobank');
    insertAccount(database, 'monobank-picked', 'bank', 'monobank', 'monobank');
    insertAccount(database, 'free-bank', 'bank', null, 'monobank');
    applyMigration(database);

    expect(bankIds(database)).toEqual({
      'free-bank': null,
      'monobank-picked': 'monobank',
      privat: 'privatbank',
      'removed-bank': 'a-since-removed-bank',
    });
  });

  it('leaves every other kind unchanged', () => {
    const database = databaseBefore();

    for (const kind of ['broker', 'cash', 'crypto', 'property', 'metals', 'debt']) {
      insertAccount(database, kind, kind, 'other', 'monobank');
    }
    applyMigration(database);

    expect(bankIds(database)).toEqual({
      broker: 'other',
      cash: 'other',
      crypto: 'other',
      debt: 'other',
      metals: 'other',
      property: 'other',
    });
  });

  it('is idempotent: a second run changes nothing', () => {
    const database = databaseBefore();

    insertAccount(database, 'connected-card', 'bank', 'other', 'monobank');
    insertAccount(database, 'disconnected-card', 'bank', 'other', null);
    applyMigration(database);
    const afterFirstRun = bankIds(database);

    applyMigration(database);

    expect(bankIds(database)).toEqual(afterFirstRun);
  });

  it('leaves every other column of the row as it was', () => {
    const database = databaseBefore();

    database
      .prepare(
        `INSERT INTO accounts (id, name, kind, bank_id, institution, color, icon, sort_order)
         VALUES ('card', 'Card', 'bank', 'other', 'monobank', '#112233', 'banknote', 7)`,
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
