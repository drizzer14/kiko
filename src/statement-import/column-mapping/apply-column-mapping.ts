// The generic column-mapping import's core: turns a user-picked
// `ColumnMapping` plus already-read `TableCell` rows into the SAME
// `ParsedStatement` shape every dedicated `StatementFormat` produces
// (`formatId: 'column-mapping'`), so the rest of the pipeline
// (`importParsedStatement`, dedup, the preview screen) treats a mapped file
// identically to a recognized bank export.
import { Money } from '../../currency/money';
import { isCurrency } from '../../currency/currency';
import type { Currency } from '../../currency/currency';
import { CURRENCY_WORD_MAP } from '../formats/privatbank-xlsx';
import { StatementParseError, type ParsedStatement } from '../parser';
import type { ParsedAccountHint, ParsedTransaction } from '../parser';

import { parseAmountCell } from './amount';
import type { TableCell } from './table-rows';
import type { DateFormatId } from './date-formats';
import { parseDateWithFormat } from './date-formats';

// Matches the parity brief's own signature: 2 uppercase letters, 2 check
// digits, then the BBAN (11-30 alphanumerics) — the same shape a
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
  amount:
    | { mode: 'single'; column: number }
    | { mode: 'debitCredit'; debitColumn: number; creditColumn: number };
  descriptionColumn: number;
  currency: { mode: 'column'; column: number } | { mode: 'fixed'; currency: Currency };
  counterpartyColumn?: number;
};

export type ColumnMappingRowError = {
  rowNumber: number;
  reason: 'date' | 'amount' | 'debitAndCredit' | 'currency';
  value: string;
};

const cellText = (cell: TableCell | undefined): string => (cell === undefined ? '' : String(cell));

const isEmptyCell = (cell: TableCell | undefined): boolean => cellText(cell).trim() === '';

// Every column this mapping actually reads — used to decide whether a row is
// blank (every mapped cell empty) and should be skipped silently, never as an
// error (a trailing blank row in an exported file is normal, not malformed).
const mappedColumnsFor = (mapping: ColumnMapping): number[] => [
  mapping.dateColumn,
  mapping.descriptionColumn,
  ...(mapping.amount.mode === 'single'
    ? [mapping.amount.column]
    : [mapping.amount.debitColumn, mapping.amount.creditColumn]),
  ...(mapping.currency.mode === 'column' ? [mapping.currency.column] : []),
  ...(mapping.counterpartyColumn === undefined ? [] : [mapping.counterpartyColumn]),
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

// Debit -> `-abs`, credit -> `+abs` (Controller ruling 1, same as the
// dedicated business-CSV formats), regardless of whether the raw cell already
// carried its own sign — a signed debit stays negative, never doubly negated.
// Both sides filled is not a valid single-amount row at all (money-safety
// review precedent) — reported as `'debitAndCredit'`, never guessed.
const resolveRowAmountMajor = (row: TableCell[], mapping: ColumnMapping): AmountOutcome => {
  if (mapping.amount.mode === 'single') {
    const raw = row[mapping.amount.column];
    const major = parseAmountCell(raw ?? '', mapping.decimalSeparator);

    return Number.isFinite(major)
      ? { kind: 'resolved', major }
      : { kind: 'error', reason: 'amount', value: cellText(raw) };
  }

  const debitRaw = row[mapping.amount.debitColumn];
  const creditRaw = row[mapping.amount.creditColumn];
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
};

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
  const dateSeconds = parseDateWithFormat(row[mapping.dateColumn], mapping.dateFormat);

  if (dateSeconds === undefined) {
    return {
      kind: 'error',
      error: { rowNumber, reason: 'date', value: cellText(row[mapping.dateColumn]) },
    };
  }

  const amountOutcome = resolveRowAmountMajor(row, mapping);

  if (amountOutcome.kind === 'error') {
    return {
      kind: 'error',
      error: { rowNumber, reason: amountOutcome.reason, value: amountOutcome.value },
    };
  }

  const currency =
    mapping.currency.mode === 'fixed'
      ? mapping.currency.currency
      : resolveCurrencyCell(cellText(row[mapping.currency.column]).trim());

  if (currency === undefined) {
    const currencyColumn = mapping.currency.mode === 'column' ? mapping.currency.column : -1;

    return {
      kind: 'error',
      error: { rowNumber, reason: 'currency', value: cellText(row[currencyColumn]) },
    };
  }

  return {
    kind: 'resolved',
    transaction: {
      currency,
      amountMinorUnits: Money.fromMajor(currency, amountOutcome.major).minorUnits,
      timeSeconds: dateSeconds,
      description: cellText(row[mapping.descriptionColumn]),
      ...resolveCounterparty(row, mapping),
    },
  };
};

/**
 * Applies a user-confirmed `ColumnMapping` to already-read `TableCell` rows.
 * `rowErrors` never aborts the parse — every unresolvable row is dropped from
 * `statement.transactions` and reported instead, the same "recoverable, not
 * thrown, not silently dropped without a trace" treatment PrivatBank XLSX's
 * own `unresolvedRows` already established. `account.currency` is the fixed
 * currency, or the first successfully resolved row's own currency — a
 * currency-column mapping that resolves NO row at all has nothing to name the
 * account's currency, which throws (the same "no known account currency"
 * failure every dedicated format already raises for its own unresolvable
 * case).
 */
export const applyColumnMapping = (
  rows: TableCell[][],
  mapping: ColumnMapping,
): { statement: ParsedStatement; rowErrors: ColumnMappingRowError[] } => {
  const dataRows = rows.slice(mapping.headerRowIndex + 1);
  const mappedColumns = mappedColumnsFor(mapping);
  const transactions: ParsedTransaction[] = [];
  const rowErrors: ColumnMappingRowError[] = [];
  let accountCurrency: Currency | undefined =
    mapping.currency.mode === 'fixed' ? mapping.currency.currency : undefined;

  dataRows.forEach((row, index) => {
    if (mappedColumns.every((column) => isEmptyCell(row[column]))) {
      return;
    }

    const rowNumber = mapping.headerRowIndex + index + 2;
    const outcome = resolveRow(row, mapping, rowNumber);

    if (outcome.kind === 'error') {
      rowErrors.push(outcome.error);
      return;
    }

    accountCurrency ??= outcome.transaction.currency;
    transactions.push(outcome.transaction);
  });

  if (!accountCurrency) {
    throw new StatementParseError(
      'Could not resolve any row currency for the column-mapping import',
    );
  }

  const account: ParsedAccountHint = { currency: accountCurrency };

  return {
    statement: { formatId: 'column-mapping', account, transactions },
    rowErrors,
  };
};
