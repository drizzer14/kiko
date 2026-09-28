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
const THOUSANDS_GROUP_PATTERN = /^\d{3}$/;
// The group BEFORE the first grouping separator is never itself a full
// 3-digit group — a leading "0" there (as opposed to a lone "0" cell with no
// grouping at all) is not how a thousands-grouped number is ever written.
const FIRST_GROUP_PATTERN = /^-?[1-9]\d{0,2}$/;

// The OTHER character is only a real thousands-grouping separator when the
// leading group is a valid thousands-group lead-in and every group after it
// is exactly 3 digits (the last group's digit run stops at the REAL decimal
// separator, when the cell carries one) — a cell whose decimal separator is
// actually the other character fails this shape, rather than being silently
// read as a value 100x too large (a Ukrainian "-150,00" read with '.' picked
// as decimal) or with the decimal separator itself swallowed into a bogus
// leading group (a stray "1,234.567" read with ',' as decimal, where '.'
// lands inside the fraction rather than the integer grouping).
const hasValidThousandsGrouping = (
  normalized: string,
  separator: ',' | '.',
  otherSeparator: ',' | '.',
): boolean => {
  const [firstGroup, ...groupsAfterFirst] = normalized.split(otherSeparator);

  if (groupsAfterFirst.length === 0) {
    return true;
  }

  if (!FIRST_GROUP_PATTERN.test(firstGroup)) {
    return false;
  }

  return groupsAfterFirst.every((group, index) => {
    const isLastGroup = index === groupsAfterFirst.length - 1;
    const digits = isLastGroup ? group.split(separator)[0] : group;

    return THOUSANDS_GROUP_PATTERN.test(digits);
  });
};

/**
 * A `number` cell (an XLSX numeric cell) is used AS-IS — never re-run
 * through the separator rule, which would otherwise mistake its
 * own '.' for a stray thousands separator and mangle it (`123.45` read with
 * `,` becoming `12345`). Only a `string` cell goes through the
 * strip-spaces/normalize-minus/validate-grouping/drop-other-separator/
 * normalize-decimal pipeline below — the other separator is dropped as
 * grouping only when `hasValidThousandsGrouping` confirms it is actually in
 * a thousands-group position (see that function's own comment); otherwise
 * this returns `NaN` rather than misreading the wrong-chip case as a value
 * 100x too large. Returns `NaN`, never throws, for anything that doesn't
 * parse to a finite number — the caller (`applyColumnMapping`) turns that
 * into a recoverable per-row `'amount'` error.
 */
export const parseAmountCell = (cell: TableCell, separator: ',' | '.'): number => {
  if (typeof cell === 'number') {
    return cell;
  }

  const otherSeparator = separator === ',' ? '.' : ',';
  const normalized = cell.replace(SPACE_PATTERN, '').replaceAll(MINUS_SIGN, '-').trim();

  if (!hasValidThousandsGrouping(normalized, separator, otherSeparator)) {
    return Number.NaN;
  }

  const cleaned = normalized.replaceAll(otherSeparator, '').replace(separator, '.');

  return cleaned === '' ? Number.NaN : Number(cleaned);
};
