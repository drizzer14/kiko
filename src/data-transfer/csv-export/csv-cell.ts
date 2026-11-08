import { shiftDecimal } from '@kiko/currency/decimal';
import { type Currency, currencyScale } from '@kiko/currency/currency';

export type CsvDialect = { delimiter: ',' | ';'; decimal: '.' | ',' };

const ENGLISH_DIALECT: CsvDialect = { delimiter: ',', decimal: '.' };
const UKRAINIAN_DIALECT: CsvDialect = { delimiter: ';', decimal: ',' };

// A spreadsheet in the user's own locale reads the file: a decimal comma needs a semicolon
// delimiter, or every amount would split into two cells.
export const csvDialectOf = (language: string): CsvDialect =>
  language === 'uk' ? UKRAINIAN_DIALECT : ENGLISH_DIALECT;

// A spreadsheet runs a cell that starts with one of these as a formula. Bank text is third-party
// input, so the cell is made literal with a leading apostrophe.
const FORMULA_START = /^[=+\-@\t\r]/;

// Both delimiters, since a text cell takes no dialect: the same cell must read right in either.
const NEEDS_QUOTES = /[",;\r\n]/;

export const csvTextCell = (value: string): string => {
  const guarded = FORMULA_START.test(value) ? `'${value}` : value;

  return NEEDS_QUOTES.test(guarded) ? `"${guarded.replaceAll('"', '""')}"` : guarded;
};

// Never prefixed: the apostrophe would make the amount unreadable to the import's amount parser.
// `shiftDecimal` keeps one satoshi as `0.00000001`, where a float prints `1e-8`.
export const csvAmountCell = (
  minorUnits: number,
  currency: Currency,
  dialect: CsvDialect,
): string => {
  const decimal = shiftDecimal(String(minorUnits), -currencyScale[currency]);

  return dialect.decimal === '.' ? decimal : decimal.replace('.', dialect.decimal);
};
