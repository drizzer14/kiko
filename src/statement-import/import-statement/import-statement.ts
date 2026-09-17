import { transactionsRepo } from '@kiko/transactions/repo';

import { detectFormat } from '../registry';
import { StatementParseError } from '../parser';
import { computeDedupKey, mapParsedTransaction } from '../mapping';

export type ImportResult = { formatId: string; imported: number; total: number };

/**
 * Detect the format, parse it, build the per-parse dedup occurrence map, map
 * every row through `mapParsedTransaction`, and hand the whole batch to the
 * EXISTING `transactionsRepo.addManyDedup` in one call — see
 * `docs/plans/statement-import.md` section A.4. Takes already-read file TEXT,
 * not a path; file reading is the caller's job.
 */
export const importStatement = async (
  input: { text: string; fileName: string },
  holdingId: string,
): Promise<ImportResult> => {
  const format = detectFormat(input);

  if (!format) {
    throw new StatementParseError('No known statement format matched this file');
  }

  const parsed = format.parse(input);
  // dedup-key -> occurrence count so far. Keyed on the SAME (holding, time,
  // amount, normalized-description) tuple `computeDedupKey` folds on —
  // `computeDedupKey(holdingId, transaction, 0)` returns exactly that
  // un-suffixed base string. Keying on `JSON.stringify(transaction)` instead
  // (the whole row, including mcc/counterIban/comment) would count two rows
  // that `computeDedupKey` treats as the SAME equivalence class as distinct
  // occurrences of DIFFERENT ones, so both would get occurrenceIndex 0 and
  // collide onto the same synthesized externalId.
  const seenKeys = new Map<string, number>();
  const rows = parsed.transactions.map((transaction) => {
    const raw = transaction.externalId ?? computeDedupKey(holdingId, transaction, 0);
    const occurrenceIndex = seenKeys.get(raw) ?? 0;
    seenKeys.set(raw, occurrenceIndex + 1);

    return mapParsedTransaction(transaction, holdingId, occurrenceIndex);
  });
  const imported = await transactionsRepo.addManyDedup(rows);

  return { formatId: format.id, imported, total: rows.length };
};
