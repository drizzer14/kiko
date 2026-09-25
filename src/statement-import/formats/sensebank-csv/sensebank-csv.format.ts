// Column layout verified against docs/plans/statement-import.md section C.2
// (grounded in OSadovy/uabean's Sensebank CSV importer facts, cross-checked
// against the REAL fixture bytes — see
// src/statement-import/NOTICE.md for the exact
// per-line facts recorded from reading the fixture. No uabean source is
// reused; this is an independent TypeScript implementation. The fixture this
// format is tested against
// (`__fixtures__/uabean-sensebank-sample.csv`) IS uabean's own real sample —
// confirmed synthetic (placeholder IBAN, test-card Visa number, year-2000
// dates), unlike PrivatBank XLSX's hand-authored one.
import Papa from 'papaparse';

import type {
  ParsedStatement,
  ParsedTransaction,
  StatementFormat,
  StatementFormatInput,
} from '../../parser';
import { Money } from '../../../currency/money';
import { StatementParseError } from '../../parser';
import { parseAmount } from '../../../currency/parse';
import { isCurrency } from '../../../currency/currency';
import type { Currency } from '../../../currency/currency';

// Section C.2: "Detect signature — file content starts with the literal
// preamble line `Виписка за рахунком;;;;;;;`". Verified byte-for-byte
// against the real fixture's first line.
export const SENSEBANK_PREAMBLE = 'Виписка за рахунком;;;;;;;';

// Section C.2: "an account line matching `Рахунок (\w+) \((\w+)\)` → IBAN +
// CURRENCY". Verified against the real fixture's 4th line:
// "Рахунок UA111111111111111111111111111 (UAH);;;;;;;".
export const ACCOUNT_LINE_PATTERN = /Рахунок (\w+) \((\w+)\)/;

// The repeated per-block header row, verified EXACTLY against the real
// fixture's bytes — note the FIRST "Cума" cell starts
// with a LATIN capital "C" (U+0043), not the visually-identical Cyrillic
// "С" (U+0421), in BOTH amount column headers. A naive hand-typed Cyrillic
// "С" would silently never match a real Sensebank export.
export const HEADER_ROW = [
  'Дата і час',
  'Статус',
  'Тип',
  'Деталі',
  'Адреса',
  'MCC',
  'Cума списання',
  'Cума зарахування',
] as const;

// Section C.2: skip every line starting with either literal prefix — a
// section/subtotal marker between (or after) the repeated header+rows
// blocks. Verified against the real fixture: TWO "Деталізація операцій…"
// lines are present (one per block); "Вклади гарантуються" is NOT present in
// this particular fixture but is still guarded per the plan's own C.2 fact
// (a deposit-guarantee disclaimer footer uabean's own importer also skips).
export const SECTION_SKIP_PREFIX = 'Деталізація операцій';
export const GUARANTEE_SKIP_PREFIX = 'Вклади гарантуються';

// 0-based column indices against a `;`-delimited data row, matching
// `HEADER_ROW`'s order exactly.
export const COLUMN = {
  date: 0,
  status: 1,
  type: 2,
  details: 3,
  address: 4,
  mcc: 5,
  debit: 6,
  credit: 7,
} as const;

// Section C.2: "DD.MM.YY HH:MM (2-digit year)" — deliberately NOT the shared
// `parseDateTimeSeconds` helper (Monobank/PrivatBank's `DD.MM.YYYY
// HH:MM:SS`, seconds precision) — Sensebank has its own 2-digit-year,
// minute-precision shape.
export const SENSEBANK_DATE_PATTERN = /^(\d{2})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2})$/;

const readRows = (input: StatementFormatInput): string[][] =>
  Papa.parse<string[]>(input.text, { delimiter: ';', skipEmptyLines: true }).data;

const detect = (input: StatementFormatInput): boolean => input.text.startsWith(SENSEBANK_PREAMBLE);

const isHeaderRow = (row: string[]): boolean =>
  row.length === HEADER_ROW.length && HEADER_ROW.every((cell, index) => row[index] === cell);

// Scans every row for the account preamble line (section C.2) — resolves the
// file's single account currency (and IBAN) once, up front, rather than
// re-deriving it per row. Throws when no such line is present at all, or the
// captured currency word isn't one Kiko recognizes — a Sensebank file with no
// resolvable account is unparseable, not a per-row concern (unlike
// PrivatBank XLSX's per-row currency lookup).
const resolveAccount = (rows: string[][]): { currency: Currency; iban: string } => {
  for (const row of rows) {
    const match = ACCOUNT_LINE_PATTERN.exec(row[0] ?? '');
    const currency = match?.[2];

    if (match && currency && isCurrency(currency)) {
      return { currency, iban: match[1] };
    }
  }

  throw new StatementParseError(
    'Could not detect the account currency from the Sensebank CSV account line',
  );
};

// Section C.2: "DD.MM.YY HH:MM (2-digit year)" — its own parse, deliberately
// not the shared `parseDateTimeSeconds` helper (see `SENSEBANK_DATE_PATTERN`'s
// doc comment above).
const parseSensebankDateSeconds = (raw: string): number => {
  const match = SENSEBANK_DATE_PATTERN.exec(raw);

  if (!match) {
    throw new StatementParseError(`Unrecognized Sensebank date: "${raw}"`);
  }

  const [, day, month, year, hour, minute] = match;
  const millis = Date.UTC(
    2000 + Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    0,
  );

  return millis / 1000;
};

// Controller ruling 3: the debit cell's raw text already carries its own
// leading minus sign (e.g. "-150,00"); the credit cell is unsigned positive —
// no manual negation anywhere. Controller ruling 5 guards against ever
// computing a `NaN` `amountMinorUnits` — an empty or
// malformed debit/credit pair throws rather than silently writing `NaN`. A
// row carrying BOTH a debit AND a credit is not a valid single-amount row at
// all (money-safety review, mirrors `business-csv`'s Дебет/Кредит guard) —
// silently preferring the debit side would drop the credit amount without a
// trace, so this throws instead of guessing.
const parseRowAmountMinorUnits = (row: string[], currency: Currency): number => {
  const debitRaw = row[COLUMN.debit];
  const creditRaw = row[COLUMN.credit];

  if (debitRaw && creditRaw) {
    throw new StatementParseError(
      `Sensebank row carries both a "Cума списання" ("${debitRaw}") and a "Cума зарахування" ("${creditRaw}") amount`,
    );
  }

  const raw = debitRaw || creditRaw;
  const major = parseAmount(raw);

  if (!Number.isFinite(major)) {
    throw new StatementParseError(`Unrecognized Sensebank amount: "${raw}"`);
  }

  return Money.fromMajor(currency, major).minorUnits;
};

const parseMcc = (raw: string | undefined): number | undefined => (raw ? Number(raw) : undefined);

const parseDataRow = (row: string[], currency: Currency): ParsedTransaction => ({
  currency,
  amountMinorUnits: parseRowAmountMinorUnits(row, currency),
  timeSeconds: parseSensebankDateSeconds(row[COLUMN.date]),
  description: row[COLUMN.details],
  mcc: parseMcc(row[COLUMN.mcc]),
});

// Section C.2: the file can carry ONE OR MORE repeated header+rows blocks
// under the one account (a block per card). A row only counts as data while
// "inside" a block — after its own `HEADER_ROW` line and before the next
// section/footer skip line — so every preamble/metadata line before the
// FIRST header (the detect line, "за період …", "Номер договору …", the
// account line itself) is skipped without needing its own named pattern.
const collectTransactions = (rows: string[][], currency: Currency): ParsedTransaction[] => {
  const transactions: ParsedTransaction[] = [];
  let inBlock = false;

  for (const row of rows) {
    if (isHeaderRow(row)) {
      inBlock = true;
      continue;
    }

    const firstCell = row[0] ?? '';

    if (firstCell.startsWith(SECTION_SKIP_PREFIX) || firstCell.startsWith(GUARANTEE_SKIP_PREFIX)) {
      inBlock = false;
      continue;
    }

    if (!inBlock) {
      continue;
    }

    transactions.push(parseDataRow(row, currency));
  }

  return transactions;
};

const parse = (input: StatementFormatInput): ParsedStatement => {
  const rows = readRows(input);
  const { currency, iban } = resolveAccount(rows);

  return {
    formatId: 'sensebank-csv',
    account: { currency, iban },
    transactions: collectTransactions(rows, currency),
  };
};

export const sensebankCsvFormat: StatementFormat = {
  id: 'sensebank-csv',
  displayName: 'Sensebank (CSV)',
  detect,
  parse,
};
