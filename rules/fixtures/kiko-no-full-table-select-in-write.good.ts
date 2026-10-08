import { eq, inArray } from 'drizzle-orm';
import { database, holdings, settings, transactions, write } from '@kiko/db';

// Semgrep fixture (NEGATIVE): inside a `write`, every select is filtered in
// SQL (`where`) or bounded (`limit`), or reads the one-row `settings` table.
// A where-less select OUTSIDE a write (a plain read) and a `selectDistinct` of
// one column must not match `kiko-no-full-table-select-in-write` either.
export const recategorize = (descriptions: string[], category: string) =>
  write(async (databaseTransaction) => {
    const settingsRows = await databaseTransaction.select().from(settings);
    const distinctDescriptions = await databaseTransaction
      .selectDistinct({ description: transactions.description })
      .from(transactions);
    const firstHolding = await databaseTransaction.select().from(holdings).limit(1);
    const matching = await databaseTransaction
      .select({ id: transactions.id })
      .from(transactions)
      .where(inArray(transactions.description, descriptions));

    await databaseTransaction
      .update(transactions)
      .set({ category })
      .where(eq(transactions.category, category));

    return [settingsRows, distinctDescriptions, firstHolding, matching];
  });

export const listHoldings = () => database.select().from(holdings);
