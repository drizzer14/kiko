import { inArray } from 'drizzle-orm';

import { write } from '../../src/db/client';
import { holdings, transactions } from '../../src/db/schema';

// Semgrep fixture (POSITIVE): a `write` callback holds the single op-sqlite
// writer, so a where-less select of a whole table inside it stalls every other
// read and write for as long as the scan and the JS filter take.
// `kiko-no-full-table-select-in-write` MUST report a finding on every pinned
// line below — see kiko-architecture's "No full-table select inside a write".
export const recategorize = (matches: (description: string) => boolean, category: string) =>
  write(async (databaseTransaction) => {
    // EXPECT-FINDING
    const rows = await databaseTransaction
      .select({ id: transactions.id, description: transactions.description })
      .from(transactions);
    const matchingIds = rows.filter((row) => matches(row.description)).map((row) => row.id);

    await databaseTransaction
      .update(transactions)
      .set({ category })
      .where(inArray(transactions.id, matchingIds));
  });

export const countHoldings = () =>
  // EXPECT-FINDING
  write((databaseTransaction) => databaseTransaction.select().from(holdings));
