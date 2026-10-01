// The generic column-mapping import's row reader — shared entry point for
// EITHER a delimited-text file (CSV/TSV, read through `papaparse`, same
// library every dedicated CSV format already uses) OR a pre-parsed
// spreadsheet (`StatementFormatInput.sheetRows`, the same shape
// `privatbank-xlsx` reads). A dedicated format picks ONE of these two shapes
// up front and hard-codes it; this module is the one place that reads
// EITHER, since the user's own file could be either kind.
import Papa from 'papaparse';

import type { SpreadsheetCellValue, StatementFormatInput } from '../parser';

export type TableCell = string | number;

export type TableDelimiter = ',' | ';' | '\t';

const pad2 = (value: number): string => String(value).padStart(2, '0');

// A spreadsheet `Date` cell has no delimiter/decimal-separator concept of its
// own — it is read off the cell's UTC parts into the SAME combined wall-clock
// shape `dateFormatIds` already knows how to parse back
// (`'YYYY-MM-DD HH:MM:SS'`), so a mapping that points its date column at a
// real Excel date cell works exactly like one pointed at a text date column.
// Those UTC digits ARE the cell's own wall clock — `date-formats.ts`'s
// `partsToSeconds` is what resolves them downstream, as Kyiv time.
const formatUtcDateTime = (date: Date): string =>
  `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())} ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}`;

const toTableCell = (value: SpreadsheetCellValue): TableCell => {
  if (typeof value === 'number') {
    return value;
  }

  if (value instanceof Date) {
    return formatUtcDateTime(value);
  }

  return value === null ? '' : String(value);
};

const readSheetRows = (sheetRows: SpreadsheetCellValue[][]): TableCell[][] =>
  sheetRows.map((row) => row.map(toTableCell));

const readCsvRows = (
  text: string,
  delimiter?: TableDelimiter,
): { rows: TableCell[][]; delimiter?: TableDelimiter } => {
  const result = Papa.parse<string[]>(text, { delimiter: delimiter ?? '', skipEmptyLines: true });
  const detectedDelimiter = (delimiter ?? result.meta.delimiter) as TableDelimiter | undefined;

  return { rows: result.data, delimiter: detectedDelimiter };
};

/**
 * Reads a `StatementFormatInput` into plain `TableCell` rows, the shared
 * shape every column-mapping helper (`guessHeaderRowIndex`,
 * `applyColumnMapping`) operates on afterward. `input.sheetRows`, when
 * present, always wins — the same "spreadsheet pre-parse beats text" rule
 * `StatementFormatInput.sheetRows`'s own doc comment (`parser.ts`) documents
 * for a dedicated format.
 */
export const readTableRows = (
  input: StatementFormatInput,
  delimiter?: TableDelimiter,
): { rows: TableCell[][]; delimiter?: TableDelimiter } => {
  if (input.sheetRows) {
    return { rows: readSheetRows(input.sheetRows), delimiter };
  }

  return readCsvRows(input.text, delimiter);
};

// How many leading rows can hold the header row — the raw preview's expanded
// view shows the same span, so the user can correct any guess it could make.
export const HEADER_SCAN_ROW_COUNT = 10;

/**
 * The first of the first `HEADER_SCAN_ROW_COUNT` rows with the most non-empty
 * cells — a cheap guess a user picks up front, shown pre-selected before they
 * confirm the header row themselves — a saved/guessed mapping never imports
 * without the user's own tap.
 */
export const guessHeaderRowIndex = (rows: TableCell[][]): number => {
  let bestIndex = 0;
  let bestNonEmptyCount = -1;

  rows.slice(0, HEADER_SCAN_ROW_COUNT).forEach((row, index) => {
    const nonEmptyCount = row.filter((cell) => cell !== '').length;

    if (nonEmptyCount > bestNonEmptyCount) {
      bestNonEmptyCount = nonEmptyCount;
      bestIndex = index;
    }
  });

  return bestIndex;
};
