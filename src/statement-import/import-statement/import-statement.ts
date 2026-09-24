import { holdingsRepo } from '@kiko/holdings/repo';
import type { Currency } from '@kiko/currency/currency';
import { transactionsRepo } from '@kiko/transactions/repo';

import { detectFormat } from '../registry';
import { computeDedupKey, mapParsedTransaction } from '../mapping';
import { StatementParseError, type ParsedStatement, type ParsedStatementSource } from '../parser';

export type ImportResult = {
  formatId: ParsedStatementSource;
  imported: number;
  total: number;
  /** Parsed rows excluded because their OWN currency (section C.1's per-row
   * `currency`) didn't match the target holding's — Kiko has no FX, so a
   * mismatched row is excluded rather than converted or written verbatim
   * (Task 3 review, CRITICAL: a PrivatBank multi-card export can mix
   * currencies per row; writing e.g. a $50.00 row's raw minor units into a
   * UAH holding would silently post +₴50.00 instead of +$50.00). */
  skippedWrongCurrency: number;
  /** The DISTINCT skipped rows' own currency codes, alphabetically sorted
   * (F4 item 9: the result names WHICH currencies were skipped, not just how
   * many rows) — empty when `skippedWrongCurrency` is 0. */
  skippedWrongCurrencyCodes: Currency[];
};

/**
 * Exclude any row whose currency doesn't match the TARGET HOLDING's own
 * currency (see `ImportResult.skippedWrongCurrency` above), build the
 * per-parse dedup occurrence map over the remaining rows, map each through
 * `mapParsedTransaction`, and hand the whole batch — plus the parsed
 * statement's own `closingBalance`, when it has one — to
 * `transactionsRepo.importRows` in one call, which upserts the rows AND
 * moves the target holding's `balanceMinorUnits` in a SINGLE db transaction
 * (see that function's own doc comment, and `kiko-domain`'s "Statement
 * import" section, for the exact balance rule). See
 * `docs/plans/statement-import.md` section A.4 for the row-mapping shape.
 * Takes an already-parsed `ParsedStatement` — shared by `importStatement`
 * (a shipped bank format) and the generic column-mapping import path
 * (T1-T2 brief), which builds its own `ParsedStatement` with
 * `formatId: 'column-mapping'` and has no dedicated `StatementFormat` to
 * detect/parse through.
 */
export const importParsedStatement = async (
  parsed: ParsedStatement,
  holdingId: string,
): Promise<ImportResult> => {
  const holdingRows = await holdingsRepo.byIdQuery(holdingId);
  const holding = holdingRows.at(0);

  if (!holding) {
    throw new Error(`Target holding not found: ${holdingId}`);
  }

  const matchingTransactions = parsed.transactions.filter(
    (transaction) => transaction.currency === holding.currency,
  );
  const skippedTransactions = parsed.transactions.filter(
    (transaction) => transaction.currency !== holding.currency,
  );
  const skippedWrongCurrency = skippedTransactions.length;
  const skippedWrongCurrencyCodes = Array.from(
    new Set(skippedTransactions.map((transaction) => transaction.currency)),
  ).sort();

  // dedup-key -> occurrence count so far. Keyed on the SAME (holding, time,
  // amount, normalized-description) tuple `computeDedupKey` folds on —
  // `computeDedupKey(holdingId, transaction, 0)` returns exactly that
  // un-suffixed base string. Keying on `JSON.stringify(transaction)` instead
  // (the whole row, including mcc/counterIban/comment) would count two rows
  // that `computeDedupKey` treats as the SAME equivalence class as distinct
  // occurrences of DIFFERENT ones, so both would get occurrenceIndex 0 and
  // collide onto the same synthesized externalId.
  const seenKeys = new Map<string, number>();
  const rows = matchingTransactions.map((transaction) => {
    const raw = transaction.externalId ?? computeDedupKey(holdingId, transaction, 0);
    const occurrenceIndex = seenKeys.get(raw) ?? 0;
    seenKeys.set(raw, occurrenceIndex + 1);

    return mapParsedTransaction(transaction, holdingId, occurrenceIndex);
  });
  const imported = await transactionsRepo.importRows({
    holdingId,
    rows,
    closingBalance: parsed.closingBalance,
  });

  return {
    formatId: parsed.formatId,
    imported,
    total: parsed.transactions.length,
    skippedWrongCurrency,
    skippedWrongCurrencyCodes,
  };
};

/**
 * Detect the format, parse it, and hand the result to `importParsedStatement`
 * — see that function's doc comment for the shared import logic. Takes
 * already-read file TEXT, not a path; file reading is the caller's job.
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

  return importParsedStatement(parsed, holdingId);
};
