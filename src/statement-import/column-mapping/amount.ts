// Parses one amount cell into a plain major-unit number — the column-mapping
// counterpart of the dedicated formats' `parseAmount`
// (`../../currency/parse`), but driven by the user's OWN chosen
// `decimalSeparator` instead of that helper's "guess by which separator
// occurs last" heuristic: a column-mapping user has already told the mapper
// which separator their file uses, so guessing again would risk disagreeing
// with their own choice.
import type { TableCell } from './table-rows';

const NON_BREAKING_SPACE = ' ';
const MINUS_SIGN = '−';
const SPACE_PATTERN = new RegExp(`[ ${NON_BREAKING_SPACE}]`, 'g');

/**
 * Review Focus 1: a `number` cell (an XLSX numeric cell) is used AS-IS —
 * never re-run through the separator rule, which would otherwise mistake its
 * own '.' for a stray thousands separator and mangle it (`123.45` read with
 * `,` becoming `12345`). Only a `string` cell goes through the
 * strip-spaces/normalize-minus/drop-other-separator/normalize-decimal
 * pipeline below. Returns `NaN`, never throws, for anything that doesn't
 * parse to a finite number — the caller (`applyColumnMapping`) turns that
 * into a recoverable per-row `'amount'` error.
 */
export const parseAmountCell = (cell: TableCell, separator: ',' | '.'): number => {
  if (typeof cell === 'number') {
    return cell;
  }

  const otherSeparator = separator === ',' ? '.' : ',';
  const cleaned = cell
    .replace(SPACE_PATTERN, '')
    .replaceAll(MINUS_SIGN, '-')
    .replaceAll(otherSeparator, '')
    .replace(separator, '.')
    .trim();

  return cleaned === '' ? Number.NaN : Number(cleaned);
};
