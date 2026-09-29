import { eq } from 'drizzle-orm';
import { DatabaseSync } from 'node:sqlite';
import { accounts, type database, holdings } from '@kiko/db';

import { applyAllMigrations, executingDrizzle } from './real-sqlite';

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
