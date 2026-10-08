import { monobankCsvFormat } from '@kiko/statement-import/formats/monobank-csv';
import { sensebankCsvFormat } from '@kiko/statement-import/formats/sensebank-csv';
import { privatbankXlsxFormat } from '@kiko/statement-import/formats/privatbank-xlsx';
import { alfaBusinessCsvFormat } from '@kiko/statement-import/formats/alfa-business-csv';
import { ukrsibBusinessCsvFormat } from '@kiko/statement-import/formats/ukrsib-business-csv';
import { procreditBusinessCsvFormat } from '@kiko/statement-import/formats/procredit-business-csv';

import type { StatementFormat, StatementFormatInput } from '../parser';

export const statementFormats: StatementFormat[] = [
  monobankCsvFormat,
  privatbankXlsxFormat,
  sensebankCsvFormat,
  procreditBusinessCsvFormat,
  ukrsibBusinessCsvFormat,
  alfaBusinessCsvFormat,
];

/**
 * First format whose `detect` accepts the input, or `undefined` — a file
 * matching no known format is NOT an error here, it is the caller's "we
 * don't recognize this file" state.
 *
 */
export const detectFormat = (input: StatementFormatInput): StatementFormat | undefined =>
  statementFormats.find((format) => format.detect(input));

/**
 * A human-readable, comma-joined list of every currently registered format's
 * display name — interpolated into `statementImport.unrecognizedFormat` so
 * that message names what Kiko actually accepts instead of leaving the user
 * to guess ("Try a different export").
 */
export const supportedFormatNames = statementFormats.map((format) => format.displayName).join(', ');
