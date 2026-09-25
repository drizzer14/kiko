// Column layout verified against OSadovy/uabean (MIT) — see
// src/statement-import/NOTICE.md. No uabean source is copied; independent
// TypeScript implementation.
import Papa from 'papaparse';

import type {
  ClosingBalance,
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
import { parseDateTimeSeconds } from '../../parse-date-time';

// `—` (U+2014 em dash) marks an absent optional column (commission,
// cashback, exchange rate) in Monobank's export — never an empty string.
const EM_DASH = '—';

const DATE_HEADER = 'Дата i час операції';

// The account currency is not a separate column — it is embedded in the
// card-currency amount column's OWN header text, e.g. "Сума в валюті картки
// (UAH)" (section C.1).
const AMOUNT_HEADER_PATTERN = /^Сума в валюті картки \((\w+)\)$/;

const COLUMN = {
  date: 0,
  description: 1,
  mcc: 2,
  amount: 3,
  balanceAfter: 9,
} as const;

const isAbsentColumn = (value: string | undefined): boolean =>
  value === undefined || value === EM_DASH;

const readRows = (input: StatementFormatInput): string[][] =>
  Papa.parse<string[]>(input.text, { skipEmptyLines: true }).data;

const findAccountCurrency = (headerRow: string[] | undefined): string | undefined => {
  const amountHeader = headerRow?.[COLUMN.amount];
  const match = amountHeader ? AMOUNT_HEADER_PATTERN.exec(amountHeader) : null;

  return match?.[1];
};

const detect = (input: StatementFormatInput): boolean => {
  const headerRow = readRows(input)[0];

  if (!headerRow || headerRow[COLUMN.date] !== DATE_HEADER) {
    return false;
  }

  const currency = findAccountCurrency(headerRow);

  return currency !== undefined && isCurrency(currency);
};

const parseMcc = (raw: string | undefined): number | undefined =>
  isAbsentColumn(raw) ? undefined : Number(raw);

// Guards against ever computing a `NaN` `amountMinorUnits` — an empty or
// malformed amount cell throws the same way a bad date cell already does,
// rather than silently writing `NaN` to the ledger.
const parseRowAmountMinorUnits = (raw: string, currency: Currency): number => {
  const major = parseAmount(raw);

  if (!Number.isFinite(major)) {
    throw new StatementParseError(`Unrecognized Monobank amount: "${raw}"`);
  }

  return Money.fromMajor(currency, major).minorUnits;
};

const parseRow = (row: string[], currency: Currency): ParsedTransaction => ({
  currency,
  amountMinorUnits: parseRowAmountMinorUnits(row[COLUMN.amount], currency),
  timeSeconds: parseDateTimeSeconds(row[COLUMN.date], 'Monobank'),
  description: row[COLUMN.description],
  mcc: parseMcc(row[COLUMN.mcc]),
});

const resolveAccountCurrency = (headerRow: string[] | undefined): Currency => {
  const currencyCode = findAccountCurrency(headerRow);

  if (!currencyCode || !isCurrency(currencyCode)) {
    throw new StatementParseError(
      'Could not detect the account currency from the Monobank CSV header',
    );
  }

  return currencyCode;
};

// The fixture's own "Залишок після операції" (balance after transaction)
// column — a genuine running balance, unlike every other format shipped so
// far. Monobank's own export is single-card/single-account per file, so the
// row with the LARGEST parsed time (last one on a tie — a file is not
// guaranteed oldest-first, only unambiguous by time) is
// the closing balance of the whole statement, as of that row's own time
// (see `ClosingBalance`'s doc comment in `parser.ts` for why `asOfSeconds`
// is that row's time, not "now"). Returns `undefined` when there are no data
// rows, or when the chosen row's balance-after cell is missing or
// non-numeric (a truncated export or the format's own
// "—" absent-column marker must fall back to Rule B, never a `TypeError` or
// a `NaN` written to the ledger).
const resolveClosingBalance = (
  dataRows: string[][],
  currency: Currency,
): ClosingBalance | undefined => {
  let newest: { row: string[]; timeSeconds: number } | undefined;

  for (const row of dataRows) {
    const timeSeconds = parseDateTimeSeconds(row[COLUMN.date], 'Monobank');

    if (!newest || timeSeconds >= newest.timeSeconds) {
      newest = { row, timeSeconds };
    }
  }

  if (!newest) {
    return undefined;
  }

  const balanceCell = newest.row[COLUMN.balanceAfter];
  const balanceMajor = isAbsentColumn(balanceCell) ? Number.NaN : parseAmount(balanceCell);

  if (!Number.isFinite(balanceMajor)) {
    return undefined;
  }

  return {
    minorUnits: Money.fromMajor(currency, balanceMajor).minorUnits,
    currency,
    asOfSeconds: newest.timeSeconds,
  };
};

const parse = (input: StatementFormatInput): ParsedStatement => {
  const [headerRow, ...dataRows] = readRows(input);
  const currency = resolveAccountCurrency(headerRow);
  const closingBalance = resolveClosingBalance(dataRows, currency);

  return {
    formatId: 'monobank-csv',
    account: { currency },
    transactions: dataRows.map((row) => parseRow(row, currency)),
    ...(closingBalance ? { closingBalance } : {}),
  };
};

export const monobankCsvFormat: StatementFormat = {
  id: 'monobank-csv',
  displayName: 'Monobank (CSV)',
  detect,
  parse,
};
