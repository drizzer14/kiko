import { readFileSync } from 'node:fs';
import path from 'node:path';

import { monobankCsvFormat } from './monobank-csv.format';

// The real uabean fixture (C.4, NOTICE.md) — 4 real Monobank CSV rows, byte
// for byte as exported by uabean's own low-PII sample.
const fixtureText = readFileSync(
  path.join(__dirname, '__fixtures__/uabean-monobank-sample.csv'),
  'utf-8',
);
const fixtureInput = { text: fixtureText, fileName: 'uabean-monobank-sample.csv' };

const unrelatedCsv = {
  text: 'Date,Amount,Description\n2024-01-01,-10.00,Coffee\n',
  fileName: 'other-bank-export.csv',
};

describe('monobankCsvFormat.detect', () => {
  it('accepts the real Monobank CSV export', () => {
    expect(monobankCsvFormat.detect(fixtureInput)).toBe(true);
  });

  it('rejects an unrelated CSV with a different header', () => {
    expect(monobankCsvFormat.detect(unrelatedCsv)).toBe(false);
  });
});

describe('monobankCsvFormat.parse', () => {
  it('parses all four transactions from the fixture', () => {
    const parsed = monobankCsvFormat.parse(fixtureInput);

    expect(parsed.transactions).toHaveLength(4);
  });

  it('detects the account currency from the amount column header', () => {
    const parsed = monobankCsvFormat.parse(fixtureInput);

    expect(parsed.account.currency).toBe('UAH');
  });

  it('carries formatId "monobank-csv" on the parsed statement', () => {
    const parsed = monobankCsvFormat.parse(fixtureInput);

    expect(parsed.formatId).toBe('monobank-csv');
  });

  // Row 1: "01.04.2022 05:27:35,Відсотки за березень,4829,19.32,19.32,UAH,—,—,—,9499.41"
  it('parses the first row exactly (interest credit)', () => {
    const parsed = monobankCsvFormat.parse(fixtureInput);
    const first = parsed.transactions[0];

    expect(first.amountMinorUnits).toBe(1_932);
    expect(first.timeSeconds).toBe(1_648_790_855);
    expect(first.description).toBe('Відсотки за березень');
    expect(first.mcc).toBe(4829);
  });

  // Row 4 (last): "12.05.2023 17:30:36,Uklon,4121,-180,-180,UAH,—,—,9,100000"
  it('parses the last row exactly (Uklon debit, whole-number source amount)', () => {
    const parsed = monobankCsvFormat.parse(fixtureInput);
    const last = parsed.transactions[3];

    expect(last.amountMinorUnits).toBe(-18_000);
    expect(last.timeSeconds).toBe(1_683_912_636);
    expect(last.description).toBe('Uklon');
    expect(last.mcc).toBe(4121);
  });
});
