// Shared parse core for the "columnar business CSV" shape ProCredit business
// and Ukrsibbank business both use: a `;`-delimited cp1251
// export, one header row, then one data row per transaction, a Дебет XOR
// Кредит column pair whose cell text is UNSIGNED —
// different from Sensebank, whose debit cell already carries its own minus,
// so `parse` negates the debit side manually here), and a DD.MM.YYYY
// HH:MM:SS single-field date reusing the shared `parseDateTimeSeconds`
// helper. The two formats' real header rows differ only in a DISPLAY label
// at one column (ProCredit's `Код ID НБУ` vs Ukrsib's `МФО`) and in whether
// fields are double-quoted (Ukrsib) — `papaparse` de-quotes a double-quoted
// field transparently with no config change needed, so the same row reader
// serves both. Every column beyond the six this core actually reads
// (account/currency/operationDate/debit/credit/paymentPurpose) is read only
// to locate/skip (the EDRPOU pair) and stays
// entirely in each format's own `COLUMN` export, never duplicated here.
import {
  type ParsedStatement,
  type ParsedTransaction,
  type StatementFormat,
  type StatementFormatId,
  type StatementFormatInput,
  StatementParseError,
} from '@kiko/statement-import/parser';
import { Money } from '@kiko/currency/money';
import { parseDateTimeSeconds } from '@kiko/statement-import/parse-date-time';

import {
  parseFiniteAmountMajor,
  readDataRows,
  resolveRowCurrency,
  resolveSoleColumnValue,
} from './csv-row';

// Not exported — nothing outside this file references either type by name
// (every call site passes an inline object literal to
// `createColumnarBusinessCsvFormat`, which TypeScript checks structurally);
// `check:knip` flags an unused exported type as dead code.
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

// The Дебет cell's raw text is UNSIGNED — negate it
// manually; the Кредит cell is unsigned positive, no negation. Guards
// against ever computing a NaN `amountMinorUnits` when both cells are
// empty/malformed. A row carrying BOTH a debit AND a
// credit is not a valid Дебет XOR Кредит row at all (money-safety review) —
// silently preferring the debit side would drop the credit amount without a
// trace, so this throws instead of guessing.
const parseRowAmountMinorUnits = (
  row: string[],
  column: ColumnarBusinessCsvColumn,
  currency: ParsedTransaction['currency'],
  formatLabel: string,
): number => {
  const debitRaw = row[column.debit];
  const creditRaw = row[column.credit];

  if (debitRaw && creditRaw) {
    throw new StatementParseError(
      `${formatLabel} row carries both a Дебет ("${debitRaw}") and a Кредит ("${creditRaw}") amount`,
    );
  }

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
    const dataRows = readDataRows(input.text, config.formatLabel);

    return {
      formatId: config.id,
      account: {
        currency: resolveRowCurrency(dataRows[0][config.column.currency], config.formatLabel),
        iban: resolveSoleColumnValue(dataRows, config.column.account),
      },
      transactions: dataRows.map((row) => parseDataRow(row, config.column, config.formatLabel)),
    };
  };

  return { id: config.id, displayName: config.displayName, detect, parse };
};
