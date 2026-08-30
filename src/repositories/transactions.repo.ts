import { eq } from 'drizzle-orm';
import { database, write } from '../db/client';
import { id } from '../db/id';
import { type TransactionRow, transactions } from '../db/schema';

type NewTransaction = Pick<TransactionRow, 'holdingId' | 'amountMinorUnits' | 'time' | 'source'> &
  Partial<Pick<TransactionRow, 'description' | 'category' | 'mcc' | 'comment' | 'externalId'>>;

export const transactionsRepo = {
  listByHoldingQuery: (holdingId: string) =>
    database.select().from(transactions).where(eq(transactions.holdingId, holdingId)),
  add: (input: NewTransaction) =>
    write(tx => tx.insert(transactions).values({ id: id(), ...input })),
  addManyDedup: (inputs: NewTransaction[]) =>
    write(async tx => {
      if (inputs.length === 0) {
        return;
      }
      // Dedup re-imported statement items against the (source, external_id)
      // unique index — a repeated Monobank statement id is skipped, not
      // duplicated. Manual rows with a null externalId are never conflated.
      await tx
        .insert(transactions)
        .values(inputs.map(input => ({ id: id(), ...input })))
        .onConflictDoNothing();
    }),
};
