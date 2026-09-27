import path from 'node:path';
import { readFileSync } from 'node:fs';
import { monobankCsvFormat } from '@kiko/statement-import/formats/monobank-csv';
import { sensebankCsvFormat } from '@kiko/statement-import/formats/sensebank-csv';
import { privatbankXlsxFormat } from '@kiko/statement-import/formats/privatbank-xlsx';
import { alfaBusinessCsvFormat } from '@kiko/statement-import/formats/alfa-business-csv';
import { ukrsibBusinessCsvFormat } from '@kiko/statement-import/formats/ukrsib-business-csv';
import { procreditBusinessCsvFormat } from '@kiko/statement-import/formats/procredit-business-csv';

import { detectFormat, statementFormats, supportedFormatNames } from './registry';

const fixtureText = readFileSync(
  path.join(__dirname, '../formats/monobank-csv/__fixtures__/uabean-monobank-sample.csv'),
  'utf-8',
);
const monobankInput = { text: fixtureText, fileName: 'uabean-monobank-sample.csv' };

describe('statementFormats', () => {
  it('registers exactly the Monobank CSV, PrivatBank XLSX, Sensebank CSV, and the three FOP/business CSV formats', () => {
    expect(statementFormats).toEqual([
      monobankCsvFormat,
      privatbankXlsxFormat,
      sensebankCsvFormat,
      procreditBusinessCsvFormat,
      ukrsibBusinessCsvFormat,
      alfaBusinessCsvFormat,
    ]);
  });
});

describe('supportedFormatNames', () => {
  it('joins every registered format display name, in registry order', () => {
    expect(supportedFormatNames).toBe(
      'Monobank (CSV), PrivatBank (XLSX), Sensebank (CSV), ProCredit Bank business (CSV), UKRSIBBANK business (CSV), Alfa-Bank business (CSV)',
    );
  });
});

describe('detectFormat', () => {
  it('returns the Monobank format for a matching input', () => {
    expect(detectFormat(monobankInput)).toBe(monobankCsvFormat);
  });

  it('returns undefined for an input matching no known format', () => {
    const input = {
      text: 'Date,Amount,Description\n2024-01-01,-10.00,Coffee\n',
      fileName: 'other.csv',
    };

    expect(detectFormat(input)).toBeUndefined();
  });
});
