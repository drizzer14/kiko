// Shared parse core for the "columnar business CSV" shape ProCredit business
// and Ukrsibbank business both use (section C.3): a `;`-delimited cp1251
// export, one header row, then one data row per transaction, a Дебет XOR
// Кредит column pair whose cell text is UNSIGNED (Controller ruling 1 —
// different from Sensebank, whose debit cell already carries its own minus,
// so `parse` negates the debit side manually here), and a DD.MM.YYYY
// HH:MM:SS single-field date reusing the shared `parseDateTimeSeconds`
// helper. The two formats' real header rows differ only in a DISPLAY label
// at one column (ProCredit's `Код ID НБУ` vs Ukrsib's `МФО`) and in whether
// fields are double-quoted (Ukrsib) — `papaparse` de-quotes a double-quoted
// field transparently with no config change needed, so the same row reader
// serves both. Every column beyond the six this core actually reads
// (account/currency/operationDate/debit/credit/paymentPurpose) is read only
// to locate/skip (the EDRPOU pair, per the plan's disposition) and stays
// entirely in each format's own `COLUMN` export, never duplicated here.
import type {
  ParsedStatement,
  ParsedTransaction,
  StatementFormat,
  StatementFormatId,
  StatementFormatInput,
} from '../../parser';
import { Money } from '../../../currency/money';
import { StatementParseError } from '../../parser';
import { parseDateTimeSeconds } from '../../parse-date-time';
import { parseFiniteAmountMajor, readCsvRows, resolveRowCurrency } from './csv-row';

// Not exported — nothing outside this file references either type by name
// (every call site passes an inline object literal to
// `createColumnarBusinessCsvFormat`, which TypeScript checks structurally);
// `check:knip` flags an unused exported type as dead code (Task 5 review).
type ColumnarBusinessCsvColumn = {
  account: number;
  currency: number;
  operationDate: number;
  debit: number;
  credit: number;
  paymentPurpose: number;
};

type ColumnarBusinessCsvConfig = {
  id: StatementFormatId;
  displayName: string;
  /** Names the source format in a thrown error message only (e.g.
   * `'ProCredit business'`, `'Ukrsibbank business'`). */
  formatLabel: string;
  /** The literal content this format's `detect` matches as a PREFIX — a
   * 59-char header truncation (ProCredit) or the full double-quoted header
   * line (Ukrsib) — both collapse to one `text.startsWith(...)` check. */
  detectSignature: string;
  column: ColumnarBusinessCsvColumn;
};

// Controller ruling 1: the Дебет cell's raw text is UNSIGNED — negate it
// manually; the Кредит cell is unsigned positive, no negation. Guards
// against ever computing a NaN `amountMinorUnits` (Task 3 review precedent)
// when both cells are empty/malformed.
const parseRowAmountMinorUnits = (
  row: string[],
  column: ColumnarBusinessCsvColumn,
  currency: ParsedTransaction['currency'],
  formatLabel: string,
): number => {
  const debitRaw = row[column.debit];
  const creditRaw = row[column.credit];
  const major = parseFiniteAmountMajor(debitRaw || creditRaw, formatLabel);
  const minorUnits = Money.fromMajor(currency, major).minorUnits;

  return debitRaw ? -minorUnits : minorUnits;
};

const parseDataRow = (
  row: string[],
  column: ColumnarBusinessCsvColumn,
  formatLabel: string,
): ParsedTransaction => {
  const currency = resolveRowCurrency(row[column.currency], formatLabel);

  return {
    currency,
    amountMinorUnits: parseRowAmountMinorUnits(row, column, currency, formatLabel),
    timeSeconds: parseDateTimeSeconds(row[column.operationDate], formatLabel),
    description: row[column.paymentPurpose],
  };
};

/**
 * Builds a `StatementFormat` for the columnar-business-CSV shape from a
 * per-format `config` — the ONE place ProCredit business and Ukrsibbank
 * business's shared row-parsing logic lives, so a fix to the shared shape
 * (the NaN guard, the negation rule, the date parse) applies to both formats
 * at once rather than needing to be kept in sync by hand across two files.
 */
export const createColumnarBusinessCsvFormat = (
  config: ColumnarBusinessCsvConfig,
): StatementFormat => {
  const detect = (input: StatementFormatInput): boolean =>
    input.text.startsWith(config.detectSignature);

  const parse = (input: StatementFormatInput): ParsedStatement => {
    const [, ...dataRows] = readCsvRows(input.text);
    const firstRow = dataRows[0];

    if (!firstRow) {
      throw new StatementParseError(`${config.formatLabel} CSV has no data rows`);
    }

    return {
      formatId: config.id,
      account: {
        currency: resolveRowCurrency(firstRow[config.column.currency], config.formatLabel),
        iban: firstRow[config.column.account],
      },
      transactions: dataRows.map((row) => parseDataRow(row, config.column, config.formatLabel)),
    };
  };

  return { id: config.id, displayName: config.displayName, detect, parse };
};
