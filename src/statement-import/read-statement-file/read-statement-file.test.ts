import path from 'node:path';
import { readFileSync } from 'node:fs';

import { SENSEBANK_PREAMBLE } from '../formats/sensebank-csv';

import { isLegacyXlsFile, decodeStatementText } from './read-statement-file';

// The real Monobank fixture, read as raw bytes then base64-encoded — the
// exact shape `RNFS.readFile(filePath, 'base64')` hands the screen — so this
// proves the base64 -> UTF-8 decode pipeline round-trips a real multi-byte
// (Cyrillic) file back to the SAME text `readFileSync(..., 'utf-8')` reads
// directly, not just some plausible-looking string.
const monobankFixturePath = path.join(
  __dirname,
  '../formats/monobank-csv/__fixtures__/uabean-monobank-sample.csv',
);
const monobankBase64 = readFileSync(monobankFixturePath).toString('base64');
const monobankUtf8Text = readFileSync(monobankFixturePath, 'utf-8');

// The real Sensebank fixture (cp1251-encoded, section C.2) — base64-encoded
// the same way, then decoded through the 'windows-1251' branch.
const sensebankFixturePath = path.join(
  __dirname,
  '../formats/sensebank-csv/__fixtures__/uabean-sensebank-sample.csv',
);
const sensebankBase64 = readFileSync(sensebankFixturePath).toString('base64');

describe('decodeStatementText', () => {
  it('decodes the Monobank fixture bytes (base64, utf-8) to the same text readFileSync reads directly', () => {
    expect(decodeStatementText(monobankBase64, 'utf-8')).toBe(monobankUtf8Text);
  });

  it('decodes the Sensebank fixture bytes (base64, windows-1251) to text starting with the real preamble', () => {
    expect(
      decodeStatementText(sensebankBase64, 'windows-1251').startsWith(SENSEBANK_PREAMBLE),
    ).toBe(true);
  });
});

describe('isLegacyXlsFile', () => {
  it('is true for an uppercase .XLS extension', () => {
    expect(isLegacyXlsFile('a.XLS')).toBe(true);
  });

  it('is false for a .xlsx extension', () => {
    expect(isLegacyXlsFile('a.xlsx')).toBe(false);
  });
});
