import maybe, { foldMap } from 'fnts/maybe';
import type { TransactionRow } from '@kiko/db';
import { categoryForMcc } from '@kiko/monobank/mcc-category';
import { normalizeTransactionName } from '@kiko/transactions/normalize-name';

import type { ParsedTransaction } from '../parser';

/**
 * The identical `NewTransaction` field set `mapStatementItem`
 * (`src/monobank/sync/sync.ts`) writes, minus `hold` — an exported statement
 * row is always settled, there is no pending-authorization concept in a file
 * export, so this type carries no `hold` field at all. Not exported (matches
 * `transactions.repo.ts`'s own identically-shaped local `NewTransaction`) —
 * nothing outside this
 * module needs the type name, only the function it shapes.
 */
type NewTransaction = Pick<TransactionRow, 'holdingId' | 'amountMinorUnits' | 'time' | 'source'> &
  Partial<
    Pick<
      TransactionRow,
      'description' | 'category' | 'mcc' | 'counterIban' | 'comment' | 'externalId'
    >
  >;

// U+241F (SYMBOL FOR UNIT SEPARATOR) joins `base` to its occurrence suffix —
// a character that can never appear in a real, normalized description,
// unlike the plain space the key used before. `normalizeTransactionName` is
// JS-only (never in SQL), so SQL alone cannot tell an occurrence suffix from
// a description that itself ends in a digit; a plain-space join made
// occurrence 1 of "Top up" collide with occurrence 0 of "Top up 1" (review
// :2321) — both produced the literal string "... top up 1". The upgrade
// path for a key an old build already wrote lives in `upgrade-dedup-key.ts`.
export const DEDUP_OCCURRENCE_SEPARATOR = '␟';

/**
 * The (holding, time, amount, normalized-description) part of a dedup key,
 * shared by `computeDedupKey` below and `upgradeLegacyDedupKey`
 * (`upgrade-dedup-key.ts`), which recomputes the identical value from a
 * STORED row rather than a freshly parsed one.
 */
export const computeDedupKeyBase = (
  holdingId: string,
  timeSeconds: number,
  amountMinorUnits: number,
  description: string,
): string =>
  [
    holdingId,
    String(timeSeconds),
    String(amountMinorUnits),
    normalizeTransactionName(description),
  ].join(' ');

/**
 * Deterministic, order-stable, INJECTIVE dedup key for a row with no
 * bank-issued id — see `docs/plans/statement-import.md` section D for the
 * full algorithm and its accepted limitation. Every format studied for this
 * plan needs this: NONE carries a unique per-row id.
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
  const base = computeDedupKeyBase(
    holdingId,
    transaction.timeSeconds,
    transaction.amountMinorUnits,
    transaction.description,
  );

  return occurrenceIndex === 0 ? base : `${base}${DEDUP_OCCURRENCE_SEPARATOR}${occurrenceIndex}`;
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
  category: foldMap(maybe(transaction.mcc), categoryForMcc) ?? null,
  counterIban: transaction.counterIban ?? null,
  comment: transaction.comment ?? null,
  source: 'import',
  externalId: transaction.externalId ?? computeDedupKey(holdingId, transaction, occurrenceIndex),
});
