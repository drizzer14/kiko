// Row-level helpers shared by every Phase 4 FOP/business `;`-delimited cp1251
// CSV format — ProCredit business and Ukrsibbank business through
// `createColumnarBusinessCsvFormat` (`business-csv.ts`), and Alfa business
// directly (its own word-column sign convention and split date+time columns
// are structurally different enough that it does not fit the shared
// `createColumnarBusinessCsvFormat` factory, but its row reading, currency
// resolution, and NaN-guarded amount parsing are identical).
import Papa from 'papaparse';

import type { Currency } from '../../../currency/currency';
import { StatementParseError } from '../../parser';
import { parseAmount } from '../../../currency/parse';
import { isCurrency } from '../../../currency/currency';

/** Splits `text` into `;`-delimited rows — `papaparse` de-quotes a
 * double-quoted field (Ukrsib) transparently with no extra config, so the
 * same reader also serves an unquoted format (ProCredit, Alfa). */
export const readCsvRows = (text: string): string[][] =>
  Papa.parse<string[]>(text, { delimiter: ';', skipEmptyLines: true }).data;

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
 * `StatementParseError` instead of ever returning `NaN` (Task 3 review
 * precedent) — an empty or malformed cell must never reach
 * `Money.fromMajor` and get written as a `NaN` `amountMinorUnits`. */
export const parseFiniteAmountMajor = (raw: string, formatLabel: string): number => {
  const major = parseAmount(raw);

  if (!Number.isFinite(major)) {
    throw new StatementParseError(`Unrecognized ${formatLabel} amount: "${raw}"`);
  }

  return major;
};
