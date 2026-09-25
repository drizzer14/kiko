import type { Currency } from '../../currency/currency';

/**
 * One row of a parsed statement, before domain mapping. Deliberately mirrors
 * `docs/plans/bank-providers.md`'s `ProviderStatementItem` shape (externalId,
 * amount, time, description, mcc, counterIban, comment) so the SAME mapping
 * discipline applies to a file-sourced row as to a live-API one.
 */
export type ParsedTransaction = {
  /** A bank-issued unique id, when the export format actually carries one.
   * NONE of the formats studied for this plan (section C) carry one —
   * `undefined` here is the NORMAL case, not a placeholder. The mapper (A.3)
   * synthesizes a deterministic key when this is absent (section D). */
  externalId?: string;
  /** THIS ROW's own currency — REQUIRED (Task 3 review, CRITICAL fix). A
   * single-currency format (every CSV shipped so far) sets the same file-wide
   * currency on every row; a multi-currency format (PrivatBank XLSX, one row
   * per card, each card potentially in a different currency) sets each row's
   * own resolved currency. `import-statement.ts` compares this against the
   * TARGET HOLDING's currency and excludes (never converts — Kiko has no FX)
   * a row whose currency doesn't match, so a foreign-currency amount can
   * never be written verbatim into a holding denominated in a different
   * currency (e.g. a USD `50.00` minor-unit amount written as `5000` into a
   * UAH holding, a ~40x silent corruption). */
  currency: Currency;
  amountMinorUnits: number;
  timeSeconds: number;
  description: string;
  mcc?: number;
  counterIban?: string;
  comment?: string;
  /** The masked card/account hint THIS ROW belongs to (PrivatBank's own
   * `Картка` column, section C.1) — distinct from `ParsedAccountHint.maskedPan`
   * below, which is only ever a single suggestion for the whole file. A
   * multi-card PrivatBank export needs this per row so the screen can show
   * which card each previewed row came from; the user's target-holding pick
   * stays load-bearing regardless — this is never used to auto-route a row.
   * Optional; every format shipped before PrivatBank XLSX omits it. */
  maskedCardHint?: string;
};

export type ParsedAccountHint = {
  currency: Currency;
  /** A display name suggestion for a newly created holding (e.g. a masked
   * PAN or the export's own account label), never used to MATCH an existing
   * holding — matching is always the user's explicit pick (section C.3). */
  suggestedName?: string;
  iban?: string;
  maskedPan?: string;
};

/** A row this format's `parse` recognized structurally but could NOT fully
 * resolve to a domain `ParsedTransaction` — surfaced to the user instead of
 * being thrown (which would abort the whole file) or silently dropped
 * without a trace. Two reasons, both from PrivatBank XLSX today:
 * - `unmapped-currency` — a currency word this format's abbreviation map
 *   doesn't cover yet (section C.1, tagged `[VERIFY LIVE]` — the 4-word map
 *   is known incomplete).
 * - `invalid-amount` — the amount cell didn't parse to a finite number (an
 *   empty or malformed cell) — guards against ever computing a `NaN`
 *   `amountMinorUnits` and writing it to the ledger (Task 3 review,
 *   IMPORTANT fix). */
export type UnresolvedStatementRow =
  | { reason: 'unmapped-currency'; rawCurrency: string; description: string }
  | { reason: 'invalid-amount'; description: string; rawAmount: string };

/**
 * The statement's own running/closing balance, when the export format
 * carries one. `asOfSeconds` is the timestamp this balance is AS OF (the row
 * it was read from), not the time the file was exported. See
 * `transactionsRepo.importRows`'s doc comment (`transactions.repo.ts`) for
 * the ONE full statement of how this is used to write the target holding's
 * balance — this doc comment is a pointer, not a restatement.
 */
export type ClosingBalance = {
  minorUnits: number;
  currency: Currency;
  asOfSeconds: number;
};

export type ParsedStatement = {
  formatId: ParsedStatementSource;
  account: ParsedAccountHint;
  transactions: ParsedTransaction[];
  /** Rows this format's parse could not resolve (see `UnresolvedStatementRow`
   * above) — optional; a format that never produces one (every CSV format
   * shipped so far) simply omits it, so `ParsedStatement`'s shape stays
   * unchanged for them. */
  unresolvedRows?: UnresolvedStatementRow[];
  /** Only set by a format whose export carries a genuine running/closing
   * balance field on a real committed fixture — see `ClosingBalance`'s doc
   * comment. Today Monobank CSV's per-row "Залишок після операції" (balance
   * after transaction) qualifies: it is single-account, single-card per
   * file, so the row with the largest parsed time is unambiguous (see
   * `resolveClosingBalance`, `monobank-csv.format.ts`). PrivatBank XLSX also
   * has a `balance` column (section C.1), but a PrivatBank export can mix
   * MULTIPLE cards per file (`maskedCardHint` differs per row, see that
   * format's own test), so a single closing balance cannot be attributed to
   * one target holding without also matching on which card each row belongs
   * to — deliberately left unset rather than guessed. Sensebank CSV and the
   * three FOP/business CSVs (ProCredit/Ukrsibbank/Alfa) carry no balance
   * field at all on their committed fixtures. The generic column-mapping
   * path (import-balance commit B) also sets this, from an OPTIONAL
   * user-mapped Balance column (`ColumnMapping.balanceColumn`,
   * `column-mapping/apply-column-mapping.ts`'s `resolveMappedClosingBalance`)
   * — same "newest row wins" rule as Monobank, PLUS a file-order tie-break.
   * "Map columns manually" accepts ANY file, including a multi-card
   * PrivatBank export — column mapping has no
   * `maskedCardHint` concept, so a mapped Balance column on such a file can
   * genuinely mix cards (the newest row's balance may belong to a
   * DIFFERENT card than the one the user is importing into). Mapping
   * Balance is opt-in, so this is an accepted risk, not a guarded one — a
   * user who maps it on a multi-card file is trusting their own file, the
   * same trust every other mapped column already extends.
   */
  closingBalance?: ClosingBalance;
};

/** One entry per SHIPPED format. Phase 1 shipped Monobank CSV; Phase 2 added
 * PrivatBank XLSX; Phase 3 added Sensebank CSV; Phase 4 (Task 5) adds the
 * three FOP/business CSVs (ProCredit, Ukrsibbank, Alfa) — required for each
 * new stub's own `id` field to typecheck against `StatementFormatId`, same
 * reasoning Task 3/4 used for `privatbank-xlsx`/`sensebank-csv`. Every other
 * bank studied for this plan lands in its own later phase and is
 * deliberately NOT listed here yet. */
export const statementFormatIds = [
  'monobank-csv',
  'privatbank-xlsx',
  'sensebank-csv',
  'procredit-business-csv',
  'ukrsib-business-csv',
  'alfa-business-csv',
] as const;
export type StatementFormatId = (typeof statementFormatIds)[number];

/** Every source a `ParsedStatement` can carry: a shipped bank format's own
 * `StatementFormatId`, or `'column-mapping'` — a statement parsed through the
 * generic column-mapping import path (no dedicated `StatementFormat`) rather
 * than one of the registry's own formats. */
export type ParsedStatementSource = StatementFormatId | 'column-mapping';

/** One resolved spreadsheet cell value — mirrors `read-excel-file`'s own
 * `CellValue | null` shape closely enough for this plan's needs, without this
 * format-agnostic contract file importing the library itself. */
export type SpreadsheetCellValue = string | number | boolean | Date | null;

export type StatementFormatInput = {
  text: string;
  fileName: string;
  /** Pre-parsed spreadsheet rows for a binary format (PrivatBank XLSX is the
   * only one in this plan's scope) — `read-excel-file`'s API is entirely
   * `Promise`-based (confirmed against its published `.d.ts`, no synchronous
   * entry point exists anywhere in the package), which cannot run inside a
   * `StatementFormat`'s synchronous `detect`/`parse` (`registry.ts`'s
   * `Array.prototype.find` and this screen's render path are both
   * synchronous, and changing that would ripple through Phase 1's already
   * shipped, tested code). So the file-read layer (the screen) runs the
   * async `read-excel-file` call ONCE, ahead of time, and hands the already
   * resolved rows through here — `detect`/`parse` for a spreadsheet format
   * then stay perfectly synchronous, operating on plain, already-resolved
   * data. A text format (every CSV in this plan) never sets this and keeps
   * using `text` exactly as before — this field is purely additive. */
  sheetRows?: SpreadsheetCellValue[][];
};

export interface StatementFormat {
  id: StatementFormatId;
  displayName: string;
  /** A cheap, non-throwing header/content-signature sniff — see section C
   * (`docs/plans/statement-import.md`) for each format's exact signature. */
  detect: (input: StatementFormatInput) => boolean;
  /** Throws `StatementParseError` on a file that `detect` accepted but whose
   * body doesn't actually parse (a truncated download, a locale variant the
   * column mapper doesn't recognize). */
  parse: (input: StatementFormatInput) => ParsedStatement;
}

export class StatementParseError extends Error {}
