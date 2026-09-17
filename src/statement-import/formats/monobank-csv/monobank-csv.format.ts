// Column layout verified against OSadovy/uabean (MIT) — see
// src/statement-import/NOTICE.md. No uabean source is copied; independent
// TypeScript implementation.
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
} as const;

const DATE_TIME_PATTERN = /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2}):(\d{2})$/;

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

// `DD.MM.YYYY HH:MM:SS` wall-clock components, parsed as UTC — deterministic
// and host-timezone-independent (docs/plans/statement-import.md section C.1).
const parseDateTimeSeconds = (raw: string): number => {
  const match = DATE_TIME_PATTERN.exec(raw.trim());

  if (!match) {
    throw new StatementParseError(`Unrecognized Monobank date/time: "${raw}"`);
  }

  const [, day, month, year, hour, minute, second] = match;

  return (
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    ) / 1000
  );
};

const parseMcc = (raw: string | undefined): number | undefined =>
  isAbsentColumn(raw) ? undefined : Number(raw);

const parseRowAmountMinorUnits = (raw: string, currency: Currency): number =>
  Money.fromMajor(currency, parseAmount(raw)).minorUnits;

const parseRow = (row: string[], currency: Currency): ParsedTransaction => ({
  amountMinorUnits: parseRowAmountMinorUnits(row[COLUMN.amount], currency),
  timeSeconds: parseDateTimeSeconds(row[COLUMN.date]),
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

const parse = (input: StatementFormatInput): ParsedStatement => {
  const [headerRow, ...dataRows] = readRows(input);
  const currency = resolveAccountCurrency(headerRow);

  return {
    formatId: 'monobank-csv',
    account: { currency },
    transactions: dataRows.map((row) => parseRow(row, currency)),
  };
};

export const monobankCsvFormat: StatementFormat = {
  id: 'monobank-csv',
  displayName: 'Monobank (CSV)',
  detect,
  parse,
};
