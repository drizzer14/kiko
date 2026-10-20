import { eq } from 'drizzle-orm';
import { DatabaseSync } from 'node:sqlite';
import { accounts, type database, holdings } from '@kiko/db';

import {
  addAccountCurrencyColumn,
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
