// Row-level helpers shared by every Phase 4 FOP/business `;`-delimited cp1251
// CSV format — ProCredit business and Ukrsibbank business through
// `createColumnarBusinessCsvFormat` (`business-csv.ts`), and Alfa business
// directly (its own word-column sign convention and split date+time columns
// are structurally different enough that it does not fit the shared
// `createColumnarBusinessCsvFormat` factory, but its row reading, currency
// resolution, and NaN-guarded amount parsing are identical).
import Papa from 'papaparse';

import { StatementParseError } from '../../parser';
import { parseAmount } from '../../../currency/parse';
import { isCurrency } from '../../../currency/currency';
import type { Currency } from '../../../currency/currency';

// Splits `text` into `;`-delimited rows — `papaparse` de-quotes a
// double-quoted field (Ukrsib) transparently with no extra config, so the
// same reader also serves an unquoted format (ProCredit, Alfa). Not
// exported — every caller outside this file goes through `readDataRows`
// below, which also drops the header row and guards the no-data-rows case
// (`check:knip` flags an unused exported symbol as dead code once nothing
// external references `readCsvRows` directly).
const readCsvRows = (text: string): string[][] =>
  Papa.parse<string[]>(text, { delimiter: ';', skipEmptyLines: true }).data;

/** Splits `text` into rows, drops the header row, and throws
 * `StatementParseError` (naming `formatLabel`) instead of returning an
 * empty array when no data row is left — every Phase 4 format's own
 * `parse` starts from exactly this ("read rows, take everything after the
 * header, refuse a file with no data") rather than each re-deriving it. */
export const readDataRows = (text: string, formatLabel: string): string[][] => {
  const [, ...dataRows] = readCsvRows(text);

  if (dataRows.length === 0) {
    throw new StatementParseError(`${formatLabel} CSV has no data rows`);
  }

  return dataRows;
};

/** Resolves a row's own currency cell to a `Currency`, throwing
 * `StatementParseError` (naming `formatLabel`) for a code Kiko doesn't
 * recognize — every Phase 4 format reads its OWN row's currency, not a
 * single file-wide constant (ProCredit/Ukrsib/Alfa each carry more than one
 * currency in a single real fixture). */
export const resolveRowCurrency = (raw: string, formatLabel: string): Currency => {
  if (!isCurrency(raw)) {
    throw new StatementParseError(`Unrecognized ${formatLabel} currency: "${raw}"`);
  }

  return raw;
};

/** Parses an amount cell to a finite major-unit number, throwing
 * `StatementParseError` instead of ever returning `NaN` — an empty or
 * malformed cell must never reach `Money.fromMajor` and get written as a
 * `NaN` `amountMinorUnits`. */
export const parseFiniteAmountMajor = (raw: string, formatLabel: string): number => {
  const major = parseAmount(raw);

  if (!Number.isFinite(major)) {
    throw new StatementParseError(`Unrecognized ${formatLabel} amount: "${raw}"`);
  }

  return major;
};

/** The single value every data row shares at `columnIndex`, or `undefined`
 * when the rows disagree — ProCredit's real fixture and Alfa's real fixture
 * both concatenate more than one underlying account into one export
 * (Controller ruling 3), so a file-level account hint (an IBAN/account
 * number) is only ever trustworthy when every row agrees on it; a
 * multi-account file's hint is deliberately dropped rather than silently
 * picking the first row's value. */
export const resolveSoleColumnValue = (
  dataRows: string[][],
  columnIndex: number,
): string | undefined => {
  const values = new Set(dataRows.map((row) => row[columnIndex]));

  return values.size === 1 ? dataRows[0]?.[columnIndex] : undefined;
};
