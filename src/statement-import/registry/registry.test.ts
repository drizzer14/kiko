import path from 'node:path';
import { readFileSync } from 'node:fs';

import { monobankCsvFormat } from '../formats/monobank-csv';
import { sensebankCsvFormat } from '../formats/sensebank-csv';
import { privatbankXlsxFormat } from '../formats/privatbank-xlsx';
import { alfaBusinessCsvFormat } from '../formats/alfa-business-csv';
import { ukrsibBusinessCsvFormat } from '../formats/ukrsib-business-csv';
import { procreditBusinessCsvFormat } from '../formats/procredit-business-csv';

import { detectFormat, statementFormats } from './registry';

const fixtureText = readFileSync(
  path.join(__dirname, '../formats/monobank-csv/__fixtures__/uabean-monobank-sample.csv'),
  'utf-8',
);
const monobankInput = { text: fixtureText, fileName: 'uabean-monobank-sample.csv' };

describe('statementFormats', () => {
  it('registers exactly the Monobank CSV, PrivatBank XLSX, Sensebank CSV, and the three Phase 4 FOP/business CSV formats', () => {
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
