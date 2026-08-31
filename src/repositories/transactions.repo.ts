import { eq } from 'drizzle-orm';
import { database, write } from '../db/client';
import { id } from '../db/id';
import { holdings, type TransactionRow, transactions } from '../db/schema';
import type { Repository } from './repository';

type NewTransaction = Pick<TransactionRow, 'holdingId' | 'amountMinorUnits' | 'time' | 'source'> &
  Partial<Pick<TransactionRow, 'description' | 'category' | 'mcc' | 'comment' | 'externalId'>>;

type ManualTransaction = Pick<TransactionRow, 'holdingId' | 'amountMinorUnits' | 'time'> &
  Partial<Pick<TransactionRow, 'description'>>;

export const transactionsRepo = {
  listByHoldingQuery: (holdingId: string) =>
    database.select().from(transactions).where(eq(transactions.holdingId, holdingId)),
  add: (input: NewTransaction) =>
    write(tx => tx.insert(transactions).values({ id: id(), ...input })),
  /**
   * Record a manual transaction and adjust its holding's balance in ONE
   * op-sqlite transaction, so the ledger and the balance can never desync
   * on a partial failure. The balance base is read from the DB *inside*
   * the same transaction — not from a render snapshot — so concurrent
   * writes cannot clobber each other with a stale read-modify-write.
   */
  recordManual: ({ holdingId, amountMinorUnits, time, description }: ManualTransaction) =>
    write(async tx => {
      await tx.insert(transactions).values({
        id: id(),
        holdingId,
        amountMinorUnits,
        time,
        description: description ?? '',
        source: 'manual',
      });
      const current = await tx
        .select({ balanceMinorUnits: holdings.balanceMinorUnits })
        .from(holdings)
        .where(eq(holdings.id, holdingId))
        .limit(1);
      const base = current.at(0)?.balanceMinorUnits ?? 0;
      await tx
        .update(holdings)
        .set({ balanceMinorUnits: base + amountMinorUnits })
        .where(eq(holdings.id, holdingId));
    }),
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
} satisfies Repository;
