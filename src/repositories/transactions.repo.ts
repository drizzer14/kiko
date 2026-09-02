import { desc, eq } from 'drizzle-orm';
import { database, write } from '../db/client';
import { id } from '../db/id';
import { accounts, holdings, type TransactionRow, transactions } from '../db/schema';
import { isSyncedTransaction } from '../holdings/deletable';
import type { Repository } from './repository';

type NewTransaction = Pick<TransactionRow, 'holdingId' | 'amountMinorUnits' | 'time' | 'source'> &
  Partial<Pick<TransactionRow, 'description' | 'category' | 'mcc' | 'comment' | 'externalId'>>;

type ManualTransaction = Pick<TransactionRow, 'holdingId' | 'amountMinorUnits' | 'time'> &
  Partial<Pick<TransactionRow, 'description'>>;

type TransactionEdit = Pick<TransactionRow, 'amountMinorUnits' | 'time'> &
  Partial<Pick<TransactionRow, 'description'>> & { transactionId: string };

export const transactionsRepo = {
  listByHoldingQuery: (holdingId: string) =>
    database.select().from(transactions).where(eq(transactions.holdingId, holdingId)),
  // Every transaction row, newest first, carrying its `holdingId` — the
  // Statistics line chart groups the whole ledger by holding to reconstruct
  // each holding's balance over time, which `listAllWithContextQuery` (a
  // display projection without `holdingId`) cannot feed.
  listAllQuery: () => database.select().from(transactions).orderBy(desc(transactions.time)),
  getByIdQuery: (transactionId: string) =>
    database.select().from(transactions).where(eq(transactions.id, transactionId)).limit(1),
  listAllWithContextQuery: () =>
    database
      .select({
        id: transactions.id,
        amountMinorUnits: transactions.amountMinorUnits,
        currency: holdings.currency,
        time: transactions.time,
        description: transactions.description,
        category: transactions.category,
        accountId: accounts.id,
        accountName: accounts.name,
        holdingName: holdings.name,
      })
      .from(transactions)
      .innerJoin(holdings, eq(transactions.holdingId, holdings.id))
      .innerJoin(accounts, eq(holdings.accountId, accounts.id))
      .orderBy(desc(transactions.time)),
  add: (input: NewTransaction) =>
    write((tx) => tx.insert(transactions).values({ id: id(), ...input })),
  /**
   * Record a manual transaction and adjust its holding's balance in ONE
   * op-sqlite transaction, so the ledger and the balance can never desync
   * on a partial failure. The balance base is read from the DB *inside*
   * the same transaction — not from a render snapshot — so concurrent
   * writes cannot clobber each other with a stale read-modify-write.
   */
  recordManual: ({ holdingId, amountMinorUnits, time, description }: ManualTransaction) =>
    write(async (tx) => {
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
  /**
   * Edit an existing MANUAL transaction and keep its holding's stored balance
   * consistent, all in ONE op-sqlite transaction. The row is re-read *inside*
   * the transaction so the balance delta is computed against the amount that is
   * actually persisted, never a stale render snapshot. Only the difference
   * (newAmount - oldAmount) moves the balance, so a description/time-only edit
   * (zero delta) leaves the balance untouched. A synced (monobank) transaction
   * is never mutated by this path — its amount is owned by the bank import — and
   * a missing id is a no-op rather than an error.
   */
  update: ({ transactionId, amountMinorUnits, time, description }: TransactionEdit) =>
    write(async (tx) => {
      const existingRows = await tx
        .select({
          holdingId: transactions.holdingId,
          amountMinorUnits: transactions.amountMinorUnits,
          source: transactions.source,
        })
        .from(transactions)
        .where(eq(transactions.id, transactionId))
        .limit(1);
      const existing = existingRows.at(0);
      if (existing?.source !== 'manual') {
        return;
      }
      await tx
        .update(transactions)
        .set({ amountMinorUnits, time, description: description ?? '' })
        .where(eq(transactions.id, transactionId));
      const delta = amountMinorUnits - existing.amountMinorUnits;
      if (delta === 0) {
        return;
      }
      const current = await tx
        .select({ balanceMinorUnits: holdings.balanceMinorUnits })
        .from(holdings)
        .where(eq(holdings.id, existing.holdingId))
        .limit(1);
      const base = current.at(0)?.balanceMinorUnits ?? 0;
      await tx
        .update(holdings)
        .set({ balanceMinorUnits: base + delta })
        .where(eq(holdings.id, existing.holdingId));
    }),
  /**
   * Delete a MANUAL transaction and reverse its effect on the holding's stored
   * balance, all in ONE op-sqlite transaction so the ledger and the balance can
   * never desync on a partial failure. The reversal is the exact inverse of
   * `recordManual`/`update`: `balance -= amountMinorUnits`, read *inside* the
   * transaction so it never clobbers a concurrent write with a stale snapshot. A
   * synced (monobank) transaction is owned by the bank import and is refused with
   * a typed error; a missing id is a no-op rather than an error.
   */
  remove: (transactionId: string) =>
    write(async (tx) => {
      const rows = await tx.select().from(transactions).where(eq(transactions.id, transactionId));
      const row = rows.at(0);
      if (!row) {
        return;
      }
      if (isSyncedTransaction(row)) {
        throw new Error('transactionsRepo.remove: cannot delete a synced transaction');
      }
      await tx.delete(transactions).where(eq(transactions.id, transactionId));
      const holdingRows = await tx.select().from(holdings).where(eq(holdings.id, row.holdingId));
      const holding = holdingRows.at(0);
      if (holding) {
        await tx
          .update(holdings)
          .set({ balanceMinorUnits: holding.balanceMinorUnits - row.amountMinorUnits })
          .where(eq(holdings.id, row.holdingId));
      }
    }),
  addManyDedup: (inputs: NewTransaction[]) =>
    write(async (tx) => {
      if (inputs.length === 0) {
        return;
      }
      // Dedup re-imported statement items against the (source, external_id)
      // unique index — a repeated Monobank statement id is skipped, not
      // duplicated. Manual rows with a null externalId are never conflated.
      await tx
        .insert(transactions)
        .values(inputs.map((input) => ({ id: id(), ...input })))
        .onConflictDoNothing();
    }),
} satisfies Repository;
