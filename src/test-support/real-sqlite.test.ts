import { eq } from 'drizzle-orm';
import { DatabaseSync } from 'node:sqlite';
import { accounts, type database, holdings } from '@kiko/db';

import {
  addAccountCurrencyColumn,
  addFundingMatchRowsTable,
  addMccCategoriesBackfilledColumn,
  addTransactionOperationColumn,
  applyAllMigrations,
  applyMigrationsThrough,
  executingDrizzle,
} from './real-sqlite';

const seededDatabase = (): DatabaseSync => {
  const rawDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(rawDatabase);
  rawDatabase
    .prepare("INSERT INTO accounts (id, name, kind) VALUES ('a-1', 'Monobank', 'bank')")
    .run();
  rawDatabase
    .prepare(
      "INSERT INTO holdings (id, account_id, name, type, currency) VALUES ('h-1', 'a-1', 'Card', 'card', 'UAH')",
    )
    .run();

  return rawDatabase;
};

describe('addAccountCurrencyColumn', () => {
  it('adds the column to a database below 0062 and nothing else', () => {
    const rawDatabase = new DatabaseSync(':memory:');

    applyMigrationsThrough(rawDatabase, '0061_exchange_state');
    rawDatabase
      .prepare("INSERT INTO accounts (id, name, kind) VALUES ('a-1', 'Cash', 'cash')")
      .run();
    addAccountCurrencyColumn(rawDatabase);

    expect(rawDatabase.prepare('SELECT id, currency FROM accounts').all()).toEqual([
      { id: 'a-1', currency: 'UAH' },
    ]);
  });
});

describe('addTransactionOperationColumn', () => {
  it('adds the column to a database below 0063 and nothing else', () => {
    const rawDatabase = new DatabaseSync(':memory:');

    applyMigrationsThrough(rawDatabase, '0062_add_account_currency');
    rawDatabase
      .prepare("INSERT INTO accounts (id, name, kind) VALUES ('a-1', 'Cash', 'cash')")
      .run();
    rawDatabase
      .prepare(
        "INSERT INTO holdings (id, account_id, name, type, currency) VALUES ('h-1', 'a-1', 'Cash', 'cash', 'UAH')",
      )
      .run();
    rawDatabase
      .prepare(
        "INSERT INTO transactions (id, holding_id, amount_minor_units, time, source) VALUES ('t-1', 'h-1', -100, 1, 'manual')",
      )
      .run();
    addTransactionOperationColumn(rawDatabase);

    expect(rawDatabase.prepare('SELECT id, operation FROM transactions').all()).toEqual([
      { id: 't-1', operation: null },
    ]);
  });
});

describe('addMccCategoriesBackfilledColumn', () => {
  it('adds the column to a database below the mark and nothing else', () => {
    const rawDatabase = new DatabaseSync(':memory:');

    applyMigrationsThrough(rawDatabase, '0064_seed_travel_category');
    rawDatabase.prepare('INSERT INTO settings (id) VALUES (1)').run();
    addMccCategoriesBackfilledColumn(rawDatabase);

    expect(
      rawDatabase.prepare('SELECT id, mcc_categories_backfilled AS mark FROM settings').all(),
    ).toEqual([{ id: 1, mark: 0 }]);
  });
});

describe('addFundingMatchRowsTable', () => {
  it('adds the empty table to a database below 0066 and nothing else', () => {
    const rawDatabase = new DatabaseSync(':memory:');

    applyMigrationsThrough(rawDatabase, '0065_add_mcc_categories_backfilled');
    rawDatabase
      .prepare("INSERT INTO accounts (id, name, kind) VALUES ('a-1', 'Cash', 'cash')")
      .run();
    addFundingMatchRowsTable(rawDatabase);

    expect(rawDatabase.prepare('SELECT id FROM accounts').all()).toEqual([{ id: 'a-1' }]);
    expect(rawDatabase.prepare('SELECT COUNT(*) AS total FROM funding_match_rows').get()).toEqual({
      total: 0,
    });
  });
});

describe('executingDrizzle', () => {
  it('keeps each column of a join in its own place when two columns share a name', async () => {
    const drizzleDatabase = executingDrizzle<typeof database>(seededDatabase());

    const rows = await drizzleDatabase
      .select({
        accountId: accounts.id,
        holdingId: holdings.id,
        accountName: accounts.name,
        holdingName: holdings.name,
      })
      .from(holdings)
      .innerJoin(accounts, eq(accounts.id, holdings.accountId));

    expect(rows).toEqual([
      { accountId: 'a-1', holdingId: 'h-1', accountName: 'Monobank', holdingName: 'Card' },
    ]);
  });

  it('reads no row from a get that matches nothing', async () => {
    const drizzleDatabase = executingDrizzle<typeof database>(seededDatabase());

    const row = await drizzleDatabase
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.id, 'missing'))
      .get();

    expect(row).toBeUndefined();
  });
});
