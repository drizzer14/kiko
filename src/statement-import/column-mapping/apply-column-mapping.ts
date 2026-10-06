// The generic column-mapping import's core: turns a user-picked
// `ColumnMapping` plus already-read `TableCell` rows into the SAME
// `ParsedStatement` shape every dedicated `StatementFormat` produces
// (`formatId: 'column-mapping'`), so the rest of the pipeline
// (`importParsedStatement`, dedup, the preview screen) treats a mapped file
// identically to a recognized bank export.
import { match } from 'ts-pattern';
import { maxOf } from '@kiko/numbers';
import maybe, { foldMap } from 'fnts/maybe';
import { Money } from '@kiko/currency/money';
import { type Currency, isCurrency } from '@kiko/currency/currency';
import { CURRENCY_WORD_MAP } from '@kiko/statement-import/formats/privatbank-xlsx';

import {
  StatementParseError,
  type ParsedStatement,
  type ClosingBalance,
  type ParsedAccountHint,
  type ParsedTransaction,
} from '../parser';

import { parseAmountCell } from './amount';
import type { TableCell } from './table-rows';
import { type DateFormatId, readDateWithFormat } from './date-formats';
import { zoneRuleFor, type SourceTimeZoneId, sourceTimeZoneOrKyiv } from './source-time-zone';

// Matches the ISO 13616 IBAN shape: 2 uppercase letters (country code), 2
// check digits, then the BBAN (11-30 alphanumerics) — the same shape a
// `counterpartyColumn` value must have to be treated as an IBAN rather than a
// free-text counterparty name (routed to `comment` instead).
const IBAN_PATTERN = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/;

export type ColumnMapping = {
  headerRowIndex: number;
  delimiter?: ',' | ';' | '\t';
  encoding?: 'utf-8' | 'windows-1251';
  decimalSeparator: ',' | '.';
  dateColumn: number;
  dateFormat: DateFormatId;
  // The zone the date column's wall clocks are read in; a mapping without
  // one reads Kyiv time.
  timeZone?: SourceTimeZoneId;
  amount:
    | { mode: 'single'; column: number }
    | { mode: 'debitCredit'; debitColumn: number; creditColumn: number };
  descriptionColumn: number;
  currency: { mode: 'column'; column: number } | { mode: 'fixed'; currency: Currency };
  counterpartyColumn?: number;
  // Optional running-balance column — see `resolveMappedClosingBalance` below.
  balanceColumn?: number;
};

export type ColumnMappingRowError = {
  rowNumber: number;
  reason: 'date' | 'amount' | 'debitAndCredit' | 'currency';
  value: string;
};

const cellText = (cell: TableCell | undefined): string => (cell === undefined ? '' : String(cell));

const isEmptyCell = (cell: TableCell | undefined): boolean => cellText(cell).trim() === '';

// Every column this mapping actually reads — decides whether a row is
// blank (every mapped cell empty) and should be skipped silently, never as an
// error (a trailing blank row in an exported file is normal, not malformed).
const mappedColumnsFor = (mapping: ColumnMapping): number[] => [
  mapping.dateColumn,
  mapping.descriptionColumn,
  ...match(mapping.amount)
    .with({ mode: 'single' }, (amount) => [amount.column])
    .with({ mode: 'debitCredit' }, (amount) => [amount.debitColumn, amount.creditColumn])
    .exhaustive(),
  ...match(mapping.currency)
    .with({ mode: 'column' }, (currency) => [currency.column])
    .with({ mode: 'fixed' }, () => [])
    .exhaustive(),
  ...(foldMap(maybe(mapping.counterpartyColumn), (column) => [column]) ?? []),
];

// An ISO code (already a recognized `Currency`) or a `CURRENCY_WORD_MAP` word
// (PrivatBank's own Ukrainian/abbreviated labels, e.g. `грн` -> `UAH`) —
// `undefined` for anything else, surfaced by the caller as a `'currency'`
// rowError rather than a throw.
const resolveCurrencyCell = (raw: string): Currency | undefined => {
  if (isCurrency(raw)) {
    return raw;
  }

  const mapped = CURRENCY_WORD_MAP[raw];

  return mapped !== undefined && isCurrency(mapped) ? mapped : undefined;
};

type AmountOutcome =
  | { kind: 'resolved'; major: number }
  | { kind: 'error'; reason: 'amount' | 'debitAndCredit'; value: string };

// Debit -> `-abs`, credit -> `+abs` (same as the
// dedicated business-CSV formats), regardless of whether the raw cell already
// carried its own sign — a signed debit stays negative, never doubly negated.
// Both sides filled is not a valid single-amount row at all (money-safety
// review precedent) — reported as `'debitAndCredit'`, never guessed.
const resolveRowAmountMajor = (row: TableCell[], mapping: ColumnMapping): AmountOutcome =>
  match(mapping.amount)
    .with({ mode: 'single' }, (amount): AmountOutcome => {
      const raw = row[amount.column];
      const major = parseAmountCell(raw ?? '', mapping.decimalSeparator);

      return Number.isFinite(major)
        ? { kind: 'resolved', major }
        : { kind: 'error', reason: 'amount', value: cellText(raw) };
    })
    .with({ mode: 'debitCredit' }, (amount): AmountOutcome => {
      const debitRaw = row[amount.debitColumn];
      const creditRaw = row[amount.creditColumn];
      const debitFilled = !isEmptyCell(debitRaw);
      const creditFilled = !isEmptyCell(creditRaw);

      if (debitFilled && creditFilled) {
        return {
          kind: 'error',
          reason: 'debitAndCredit',
          value: `${cellText(debitRaw)} / ${cellText(creditRaw)}`,
        };
      }

      const raw = debitFilled ? debitRaw : creditRaw;
      const major = parseAmountCell(raw ?? '', mapping.decimalSeparator);

      if (!Number.isFinite(major)) {
        return { kind: 'error', reason: 'amount', value: cellText(raw) };
      }

      return { kind: 'resolved', major: debitFilled ? -Math.abs(major) : Math.abs(major) };
    })
    .exhaustive();

const resolveCounterparty = (
  row: TableCell[],
  mapping: ColumnMapping,
): Pick<ParsedTransaction, 'counterIban' | 'comment'> => {
  if (mapping.counterpartyColumn === undefined) {
    return {};
  }

  const raw = cellText(row[mapping.counterpartyColumn]).trim();

  if (raw === '') {
    return {};
  }

  return IBAN_PATTERN.test(raw) ? { counterIban: raw } : { comment: raw };
};

type RowOutcome =
  | { kind: 'resolved'; transaction: ParsedTransaction }
  | { kind: 'error'; error: ColumnMappingRowError };

const resolveRow = (row: TableCell[], mapping: ColumnMapping, rowNumber: number): RowOutcome => {
  const dateReading = readDateWithFormat(
    row[mapping.dateColumn],
    mapping.dateFormat,
    zoneRuleFor(sourceTimeZoneOrKyiv(mapping.timeZone)),
  );

  if (dateReading === undefined) {
    return {
      kind: 'error',
      error: { rowNumber, reason: 'date', value: cellText(row[mapping.dateColumn]) },
    };
  }

  const amountOutcome = resolveRowAmountMajor(row, mapping);

  return match(amountOutcome)
    .with(
      { kind: 'error' },
      (outcome): RowOutcome => ({
        kind: 'error',
        error: { rowNumber, reason: outcome.reason, value: outcome.value },
      }),
    )
    .with({ kind: 'resolved' }, ({ major }): RowOutcome => {
      const currency = match(mapping.currency)
        .with({ mode: 'fixed' }, (currencyMapping) => currencyMapping.currency)
        .with({ mode: 'column' }, (currencyMapping) =>
          resolveCurrencyCell(cellText(row[currencyMapping.column]).trim()),
        )
        .exhaustive();

      if (currency === undefined) {
        const currencyColumn = match(mapping.currency)
          .with({ mode: 'column' }, (currencyMapping) => currencyMapping.column)
          .with({ mode: 'fixed' }, () => -1)
          .exhaustive();

        return {
          kind: 'error',
          error: { rowNumber, reason: 'currency', value: cellText(row[currencyColumn]) },
        };
      }

      return {
        kind: 'resolved',
        transaction: {
          currency,
          amountMinorUnits: Money.fromMajor(currency, major).minorUnits,
          timeSeconds: dateReading.timeSeconds,
          timeReading: dateReading.timeReading,
          description: cellText(row[mapping.descriptionColumn]),
          ...resolveCounterparty(row, mapping),
        },
      };
    })
    .exhaustive();
};

// The account currency, resolved straight off the mapped currency COLUMN's
// own cells across every data row — independent of whether that row's date
// or amount also resolves, so an unrelated field (a wrong date format, say)
// failing every row never blames a currency column that is genuinely fine.
// Scanning the cells directly is the same resolution `resolveRow` itself
// would reach for a fully-valid row, just decoupled from the other fields'
// own success.
const resolveAccountCurrency = (
  dataRows: TableCell[][],
  mapping: ColumnMapping,
): Currency | undefined =>
  match(mapping.currency)
    .with({ mode: 'fixed' }, (currencyMapping) => currencyMapping.currency)
    .with({ mode: 'column' }, (currencyMapping) => {
      for (const row of dataRows) {
        const resolved = resolveCurrencyCell(cellText(row[currencyMapping.column]).trim());

        if (resolved !== undefined) {
          return resolved;
        }
      }

      return undefined;
    })
    .exhaustive();

type ClosingBalanceCandidate = { row: TableCell[]; timeSeconds: number; currency: Currency };

/** File orientation, from the RESOLVED rows' own first vs. last parsed
 * time — used only to break a tie on the newest `timeSeconds`:
 * most bank exports (Monobank included) list the newest row FIRST, so on a
 * tie the FIRST tied row in file order is really the latest transaction of
 * that instant; an oldest-first file's LAST tied row is. `'undeterminable'`
 * when the first and last resolved rows share the same time —
 * `pickClosingBalanceRow` then falls back to comparing the tied rows' own
 * balance cells instead of guessing an order. Callers only ever reach this
 * with two or more candidates (the lone-candidate case returns earlier in
 * `pickClosingBalanceRow`), so plain indexing is safe here —
 * `noUncheckedIndexedAccess` is off project-wide (see `kiko-code-style`),
 * and `candidates[0]`/`candidates[candidates.length - 1]` are always
 * defined for a non-empty array. */
const resolveFileOrientation = (
  candidates: ClosingBalanceCandidate[],
): 'newestFirst' | 'oldestFirst' | 'undeterminable' => {
  const first = candidates[0].timeSeconds;
  const last = candidates[candidates.length - 1].timeSeconds;

  if (first === last) {
    return 'undeterminable';
  }

  return first > last ? 'newestFirst' : 'oldestFirst';
};

type ClosingBalancePick = { candidate: ClosingBalanceCandidate; balanceMajor: number };

/**
 * The one candidate `resolveMappedClosingBalance` reads the closing-balance
 * cell off, together with that cell's already-parsed value (so
 * the caller never re-parses the same cell). Finds every row tied on the
 * NEWEST `timeSeconds` among `candidates` (already RESOLVED rows only, in
 * file order); a lone newest row wins outright, a tied set is broken by
 * `resolveFileOrientation` when the file's own first/last rows disagree, and
 * when they don't (`'undeterminable'`) this returns the tied rows' own
 * balance cell ONLY when every one of them parses to the exact same value —
 * genuinely ambiguous cells return `undefined` (Rule B fallback) rather than
 * guess an order. A single-row file has exactly one "tied" row (itself), so
 * it always resolves through the lone-winner path.
 */
const pickClosingBalanceRow = (
  candidates: ClosingBalanceCandidate[],
  balanceColumn: number,
  decimalSeparator: ',' | '.',
): ClosingBalancePick | undefined => {
  if (candidates.length === 0) {
    return undefined;
  }

  const maxTime = maxOf(candidates.map((candidate) => candidate.timeSeconds));
  const tied = candidates.filter((candidate) => candidate.timeSeconds === maxTime);
  const parseCell = (candidate: ClosingBalanceCandidate) =>
    parseAmountCell(candidate.row[balanceColumn] ?? '', decimalSeparator);

  if (tied.length === 1) {
    return { candidate: tied[0], balanceMajor: parseCell(tied[0]) };
  }

  const orientation = resolveFileOrientation(candidates);

  if (orientation === 'newestFirst') {
    return { candidate: tied[0], balanceMajor: parseCell(tied[0]) };
  }

  if (orientation === 'oldestFirst') {
    const last = tied[tied.length - 1];

    return { candidate: last, balanceMajor: parseCell(last) };
  }

  const cellValues = tied.map(parseCell);
  const allEqual = cellValues.every((value) => Number.isFinite(value) && value === cellValues[0]);

  return allEqual ? { candidate: tied[0], balanceMajor: cellValues[0] } : undefined;
};

/**
 * The mapped statement's `closingBalance` (import-balance commit B,
 * "Balance" column role) — same rule as Monobank CSV's own
 * `resolveClosingBalance` (`formats/monobank-csv/monobank-csv.format.ts`),
 * plus a file-order tie-break `pickClosingBalanceRow` handles.
 * `undefined` when no Balance column is mapped, no row resolved, or the
 * chosen row's balance cell is missing or non-numeric — never a `NaN`
 * written to the ledger. The cell is
 * parsed with the mapping's OWN `decimalSeparator` (`parseAmountCell`),
 * matching every other amount cell this mapping reads — `pickClosingBalanceRow`
 * does that parse once and hands the value back, so it is never re-parsed here.
 */
const resolveMappedClosingBalance = (
  mapping: ColumnMapping,
  candidates: ClosingBalanceCandidate[],
): ClosingBalance | undefined => {
  if (mapping.balanceColumn === undefined) {
    return undefined;
  }

  const picked = pickClosingBalanceRow(candidates, mapping.balanceColumn, mapping.decimalSeparator);

  if (!picked || !Number.isFinite(picked.balanceMajor)) {
    return undefined;
  }

  return {
    minorUnits: Money.fromMajor(picked.candidate.currency, picked.balanceMajor).minorUnits,
    currency: picked.candidate.currency,
    asOfSeconds: picked.candidate.timeSeconds,
  };
};

/**
 * Applies a user-confirmed `ColumnMapping` to already-read `TableCell` rows.
 * `rowErrors` never aborts the parse — every unresolvable row is dropped from
 * `statement.transactions` and reported instead, the same "recoverable, not
 * thrown, not silently dropped without a trace" treatment PrivatBank XLSX's
 * own `unresolvedRows` already established. `account.currency` is the fixed
 * currency, or resolved straight off the currency COLUMN's own cells
 * (`resolveAccountCurrency`) — deliberately independent of whether any row
 * resolves end to end, so an unrelated field (a wrong date format, say)
 * failing every row never also throws away a currency column that is
 * genuinely fine. Throws only when the currency column itself resolves to
 * no known code anywhere in the file (the same "no known account currency"
 * failure every dedicated format already raises for its own unresolvable
 * case) — the one case this function cannot recover a `rowErrors` entry
 * for, since there is nothing to name the account's currency at all.
 */
export const applyColumnMapping = (
  rows: TableCell[][],
  mapping: ColumnMapping,
): { statement: ParsedStatement; rowErrors: ColumnMappingRowError[] } => {
  const dataRows = rows.slice(mapping.headerRowIndex + 1);
  const mappedColumns = mappedColumnsFor(mapping);
  const transactions: ParsedTransaction[] = [];
  const rowErrors: ColumnMappingRowError[] = [];
  const accountCurrency = resolveAccountCurrency(dataRows, mapping);
  // Every RESOLVED row, in file order — `resolveMappedClosingBalance` needs
  // the whole ordered list, not just a running "newest so far", so a tie on
  // the newest time can be broken by file order rather than by
  // whichever tied row happens to be visited last.
  const balanceCandidates: ClosingBalanceCandidate[] = [];

  if (!accountCurrency) {
    throw new StatementParseError(
      'Could not resolve any row currency for the column-mapping import',
    );
  }

  dataRows.forEach((row, index) => {
    if (mappedColumns.every((column) => isEmptyCell(row[column]))) {
      return;
    }

    const rowNumber = mapping.headerRowIndex + index + 2;
    const outcome = resolveRow(row, mapping, rowNumber);

    match(outcome)
      .with({ kind: 'error' }, (rowOutcome) => {
        rowErrors.push(rowOutcome.error);
      })
      .with({ kind: 'resolved' }, (rowOutcome) => {
        transactions.push(rowOutcome.transaction);
        balanceCandidates.push({
          row,
          timeSeconds: rowOutcome.transaction.timeSeconds,
          currency: rowOutcome.transaction.currency,
        });
      })
      .exhaustive();
  });

  const account: ParsedAccountHint = { currency: accountCurrency };
  const closingBalance = resolveMappedClosingBalance(mapping, balanceCandidates);

  return {
    statement: {
      formatId: 'column-mapping',
      account,
      transactions,
      ...(closingBalance ? { closingBalance } : {}),
      sourceTimeZone: sourceTimeZoneOrKyiv(mapping.timeZone),
    },
    rowErrors,
  };
};
