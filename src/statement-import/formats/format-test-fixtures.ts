// Shared cp1251/UTF-8 fixture loading for the format test suites under this
// directory. Centralizes the "read + decode + build a StatementFormatInput"
// wiring every format's own `.format.test.ts` needs when it asserts its own
// `detect` REJECTS every other shipped format's real fixture — without this,
// each new format's test file re-implemented the same readFileSync/decode
// boilerplate for Monobank, Sensebank, PrivatBank, and its business-CSV
// siblings (jscpd flagged exactly this duplication). Not a test file
// itself — a plain shared module imported by the format test suites.
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { decode as decodeWindows1251 } from 'windows-1251';

import type { StatementFormatInput } from '../parser';

import { PRIVATBANK_TITLE_PREFIX } from './privatbank-xlsx';

const FORMATS_DIR = __dirname;

const readCp1251FixtureInput = (relativePath: string, fileName: string): StatementFormatInput => ({
  text: decodeWindows1251(readFileSync(path.join(FORMATS_DIR, relativePath))),
  fileName,
});

export const monobankFixtureInput: StatementFormatInput = {
  text: readFileSync(
    path.join(FORMATS_DIR, 'monobank-csv/__fixtures__/uabean-monobank-sample.csv'),
    'utf-8',
  ),
  fileName: 'uabean-monobank-sample.csv',
};

export const sensebankFixtureInput: StatementFormatInput = readCp1251FixtureInput(
  'sensebank-csv/__fixtures__/uabean-sensebank-sample.csv',
  'uabean-sensebank-sample.csv',
);

// PrivatBank XLSX's `detect` reads `sheetRows`, not `text` — a text-only
// input can never match it structurally, but reusing its OWN real detect
// signature (not a hand-typed guess) still proves a text-based format's
// `detect` rejects real signature TEXT another shipped format carries, same
// convention Sensebank's own test established.
export const privatbankLikeInput: StatementFormatInput = {
  text: `${PRIVATBANK_TITLE_PREFIX}\nДата,Категорія\n01.07.2025,100`,
  fileName: 'privatbank-like.csv',
};

// The REAL uabean fixture (C.4, NOTICE.md) — confirmed ANONYMIZED via
// uabean's own `anonymize.py` script — reused byte for byte.
export const procreditBusinessFixtureInput: StatementFormatInput = readCp1251FixtureInput(
  'procredit-business-csv/__fixtures__/uabean-procredit-business-sample.csv',
  'uabean-procredit-business-sample.csv',
);

// HAND-AUTHORED synthetic fixture (no uabean fixture exists for this
// format, C.4) — real cp1251 bytes.
export const ukrsibBusinessFixtureInput: StatementFormatInput = readCp1251FixtureInput(
  'ukrsib-business-csv/__fixtures__/synthetic-ukrsib-business-sample.csv',
  'synthetic-ukrsib-business-sample.csv',
);

// The REAL uabean fixture (C.4, NOTICE.md) — confirmed SYNTHETIC (`XYZ
// COMPANY`/`JOHN DOE` placeholders) — reused byte for byte.
export const alfaBusinessFixtureInput: StatementFormatInput = readCp1251FixtureInput(
  'alfa-business-csv/__fixtures__/uabean-alfa-business-sample.csv',
  'uabean-alfa-business-sample.csv',
);
