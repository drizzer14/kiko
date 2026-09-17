import path from 'node:path';
import { readFileSync } from 'node:fs';

import { monobankCsvFormat } from '../formats/monobank-csv';

import { detectFormat, statementFormats } from './registry';

const fixtureText = readFileSync(
  path.join(__dirname, '../formats/monobank-csv/__fixtures__/uabean-monobank-sample.csv'),
  'utf-8',
);
const monobankInput = { text: fixtureText, fileName: 'uabean-monobank-sample.csv' };

describe('statementFormats', () => {
  it('registers exactly the Monobank CSV format in this phase', () => {
    expect(statementFormats).toEqual([monobankCsvFormat]);
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
