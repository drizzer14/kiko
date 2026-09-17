import { categoryForMcc } from '../../monobank/mcc-category';
import { normalizeTransactionName } from '../../transactions/normalize-name';
import type { TransactionRow } from '../../db/schema';
import type { ParsedTransaction } from '../parser';

/**
 * The identical `NewTransaction` field set `mapStatementItem`
 * (`src/monobank/sync/sync.ts`) writes, minus `hold` — an exported statement
 * row is always settled, there is no pending-authorization concept in a file
 * export, so this type carries no `hold` field at all.
 */
export type NewTransaction = Pick<
  TransactionRow,
  'holdingId' | 'amountMinorUnits' | 'time' | 'source'
> &
  Partial<
    Pick<
      TransactionRow,
      'description' | 'category' | 'mcc' | 'counterIban' | 'comment' | 'externalId'
    >
  >;

/**
 * Deterministic, order-stable dedup key for a row with no bank-issued id —
 * see `docs/plans/statement-import.md` section D for the full algorithm and
 * its accepted limitation. Every format studied for this plan needs this:
 * NONE carries a unique per-row id.
 *
 * `occurrenceIndex` is the Nth time this exact (holding, time, amount,
 * normalized-description) tuple has been seen so far in this parse — `0` is
 * omitted from the key so the common (unique) case's key is stable.
 */
export const computeDedupKey = (
  holdingId: string,
  transaction: ParsedTransaction,
  occurrenceIndex: number,
): string => {
  const normalizedDescription = normalizeTransactionName(transaction.description);
  const base = [
    holdingId,
    String(transaction.timeSeconds),
    String(transaction.amountMinorUnits),
    normalizedDescription,
  ].join(' ');

  return occurrenceIndex === 0 ? base : `${base} ${occurrenceIndex}`;
};

export const mapParsedTransaction = (
  transaction: ParsedTransaction,
  holdingId: string,
  occurrenceIndex: number,
): NewTransaction => ({
  holdingId,
  amountMinorUnits: transaction.amountMinorUnits,
  time: transaction.timeSeconds * 1000,
  description: transaction.description,
  mcc: transaction.mcc,
  category: transaction.mcc !== undefined ? categoryForMcc(transaction.mcc) : null,
  counterIban: transaction.counterIban ?? null,
  comment: transaction.comment ?? null,
  source: 'import',
  externalId: transaction.externalId ?? computeDedupKey(holdingId, transaction, occurrenceIndex),
});
