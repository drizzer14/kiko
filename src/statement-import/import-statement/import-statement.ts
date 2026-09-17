import { transactionsRepo } from '@kiko/transactions/repo';

import { mapParsedTransaction } from '../mapping';
import { StatementParseError } from '../parser';
import { detectFormat } from '../registry';

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
  // dedup-key -> occurrence count so far, for computeDedupKey's occurrenceIndex.
  const seenKeys = new Map<string, number>();
  const rows = parsed.transactions.map((transaction) => {
    const raw = transaction.externalId ?? JSON.stringify(transaction);
    const occurrenceIndex = seenKeys.get(raw) ?? 0;
    seenKeys.set(raw, occurrenceIndex + 1);

    return mapParsedTransaction(transaction, holdingId, occurrenceIndex);
  });
  const imported = await transactionsRepo.addManyDedup(rows);

  return { formatId: format.id, imported, total: rows.length };
};
