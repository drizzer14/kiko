import { monobankCsvFormat } from '../formats/monobank-csv';
import { sensebankCsvFormat } from '../formats/sensebank-csv';
import { privatbankXlsxFormat } from '../formats/privatbank-xlsx';
import type { StatementFormat, StatementFormatInput } from '../parser';

export const statementFormats: StatementFormat[] = [
  monobankCsvFormat,
  privatbankXlsxFormat,
  sensebankCsvFormat,
];

/**
 * First format whose `detect` accepts the input, or `undefined` — a file
 * matching no known format is NOT an error here, it is the caller's "we
 * don't recognize this file" state.
 *
 */
export const detectFormat = (input: StatementFormatInput): StatementFormat | undefined =>
  statementFormats.find((format) => format.detect(input));
