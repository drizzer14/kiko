import { settingsRepo } from '@kiko/settings';
import { holdingsRepo } from '@kiko/holdings/repo';
import type { Currency } from '@kiko/currency/currency';
import { transactionsRepo } from '@kiko/transactions/repo';
import { runLoanAutoLink } from '@kiko/loans/use-loan-auto-link';

import {
  StatementParseError,
  type ParsedStatement,
  type ParsedTransaction,
  type ParsedStatementSource,
} from '../parser';
import { detectFormat } from '../registry';
import { rezoneImportTimes } from '../rezone-import-times';
import { upgradeStoredDedupKeys } from '../upgrade-stored-dedup-keys';
import { computeDedupKey, noonAliasDedupKey, mapParsedTransaction } from '../mapping';

export type ImportResult = {
  formatId: ParsedStatementSource;
  imported: number;
  total: number;
  /** Parsed rows excluded because their OWN currency (a multi-card export's
   * per-row `currency`) didn't match the target holding's — Kiko has no FX, so a
   * mismatched row is excluded rather than converted or written verbatim
   * (a PrivatBank multi-card export can mix currencies per row; writing
   * e.g. a $50.00 row's raw minor units into a UAH holding would silently
   * post +₴50.00 instead of +$50.00). */
  skippedWrongCurrency: number;
  /** The DISTINCT skipped rows' own currency codes, alphabetically sorted —
   * names WHICH currencies were skipped, not just how many rows — empty
   * when `skippedWrongCurrency` is 0. */
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
 * `docs/plans/statement-import.md` for the row-mapping shape.
 * Takes an already-parsed `ParsedStatement` — shared by `importStatement`
 * (a shipped bank format) and the generic column-mapping import path, which
 * builds its own `ParsedStatement` with
 * `formatId: 'column-mapping'` and has no dedicated `StatementFormat` to
 * detect/parse through.
 */
export const importParsedStatement = async (
  parsed: ParsedStatement,
  holdingId: string,
): Promise<ImportResult> => {
  // Both one-shot statement-import rewrites are no-ops once their own flag
  // is already `true` (the common case, after the FIRST import following
  // launch). Running them here too — not just from `MigrationsGate`, which
  // already awaits both before the app becomes usable — covers the device
  // whose gate-time rezone FAILED (its own `write()` failed, caught by the
  // gate's own `.catch`, leaving the flag `false`): this gives it one more
  // chance right before writing any new import row. If the rezone step
  // still hasn't flipped its flag afterward, refuse the import outright
  // rather than writing new-convention rows next to not-yet-rezoned
  // old-convention ones — the screen's existing generic import-failure copy
  // covers this, so no new i18n key is needed. The dedup-key upgrade has no
  // matching explicit check: a persistently failing rewrite here throws and
  // blocks the import with that same generic error too, which is
  // acceptable — the row it would have rewritten stays reachable under its
  // legacy key either way.
  await upgradeStoredDedupKeys();
  await rezoneImportTimes();

  const rezoneStatus = await settingsRepo.getQuery();

  if (rezoneStatus.at(0)?.importTimesRezoned !== true) {
    throw new Error('statement-import/rezone-pending');
  }

  const holdingRows = await holdingsRepo.byIdQuery(holdingId);
  const holding = holdingRows.at(0);

  if (!holding) {
    throw new Error(`Target holding not found: ${holdingId}`);
  }

  // One pass over `parsed.transactions`, not two opposite `.filter()` calls —
  // every row lands in exactly one of the two arrays below.
  const matchingTransactions: ParsedTransaction[] = [];
  const skippedTransactions: ParsedTransaction[] = [];

  for (const transaction of parsed.transactions) {
    (transaction.currency === holding.currency ? matchingTransactions : skippedTransactions).push(
      transaction,
    );
  }

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

    return {
      ...mapParsedTransaction(transaction, holdingId, occurrenceIndex),
      aliasExternalId: noonAliasDedupKey(holdingId, transaction, occurrenceIndex),
    };
  });
  const imported = await transactionsRepo.importRows({
    holdingId,
    rows,
    closingBalance: parsed.closingBalance,
  });

  // Every caller of this function — the dedicated `importStatement` below
  // AND the generic column-mapping import, which calls this directly — gets
  // the matcher run once, right after the new rows commit; a fresh import
  // is exactly the kind of new debit the matcher exists to catch. Never
  // rejects on its own (see its own doc comment), so a failed auto-link
  // never turns a successful import into a shown error.
  await runLoanAutoLink();

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
