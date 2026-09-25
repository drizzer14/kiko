import path from 'node:path';
import { readFileSync } from 'node:fs';

import { StatementParseError } from '../../parser';

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

const MONOBANK_HEADER =
  'Дата i час операції,Деталі операції,MCC,Сума в валюті картки (UAH),Сума в валюті операції,Валюта,Курс,Сума комісій (UAH),Сума кешбеку (UAH),Залишок після операції';

// Regression fixture: an empty/malformed amount cell must never reach
// `Money.fromMajor` as `NaN` — `detect()` never validates a data row, so a
// truncated/malformed export must fail loudly
// (`StatementParseError`) out of `parse()` instead of silently writing a
// `NaN` `amountMinorUnits` to the ledger.
const malformedAmountInput = {
  text: [MONOBANK_HEADER, '01.06.2023 12:00:00,Bad Amount,5411,,,UAH,—,—,—,1000'].join('\n'),
  fileName: 'malformed-amount.csv',
};

// The last row's balance-after cell can be missing
// (a truncated 9-column export) or non-numeric ("—", the same absent-column
// marker every other optional column uses) — `resolveClosingBalance` must
// fall back to no closing balance (Rule B) instead of throwing a `TypeError`
// on the missing cell or writing a `NaN` `minorUnits` from the dash cell.
const missingBalanceCellInput = {
  text: [MONOBANK_HEADER, '01.06.2023 12:00:00,No Balance Column,5411,-100,-100,UAH,—,—,—'].join(
    '\n',
  ),
  fileName: 'missing-balance-cell.csv',
};

const dashBalanceCellInput = {
  text: [MONOBANK_HEADER, '01.06.2023 12:00:00,Dash Balance,5411,-100,-100,UAH,—,—,—,—'].join('\n'),
  fileName: 'dash-balance-cell.csv',
};

// `resolveClosingBalance` must never simply assume the file's rows are
// oldest-first (`dataRows.at(-1)`) — true of every real Monobank export
// seen so far, but not guaranteed. The closing balance must come from
// whichever row has the LARGEST parsed time, regardless of its position
// in the file.
const newestFirstInput = {
  text: [
    MONOBANK_HEADER,
    '12.05.2023 17:30:36,Uklon,4121,-180,-180,UAH,—,—,9,100000',
    '01.04.2022 05:27:35,Відсотки за березень,4829,19.32,19.32,UAH,—,—,—,9499.41',
  ].join('\n'),
  fileName: 'newest-first.csv',
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

  it("carries the file's account currency on every parsed row", () => {
    const parsed = monobankCsvFormat.parse(fixtureInput);

    expect(parsed.transactions.every((transaction) => transaction.currency === 'UAH')).toBe(true);
  });

  // The fixture's own "Залишок після операції" (balance after transaction)
  // column, section C.4 — Monobank is the one format that carries a genuine
  // running balance per row, verified against the real uabean fixture bytes.
  // Its last row is "…,9,100000", so the closing balance is the LAST row's
  // balance-after, not the first — a single-card/single-account export keeps
  // this unambiguous (see `ParsedStatement.closingBalance`'s doc comment).
  it('carries the closing balance from the LAST row’s "balance after transaction" column', () => {
    const parsed = monobankCsvFormat.parse(fixtureInput);

    expect(parsed.closingBalance).toEqual({
      minorUnits: 10_000_000,
      currency: 'UAH',
      asOfSeconds: 1_683_912_636,
    });
  });

  // An empty/malformed amount cell must never silently become a `NaN`
  // `amountMinorUnits` written to the ledger —
  // `parse()` throws instead, the same way a bad date cell already does.
  it('throws a StatementParseError instead of writing a NaN amount for a malformed amount cell', () => {
    expect(() => monobankCsvFormat.parse(malformedAmountInput)).toThrow(StatementParseError);
  });

  // A missing balance-after cell must not throw —
  // `resolveClosingBalance` falls back to no closing balance (Rule B takes
  // over), the transactions themselves still parse.
  it('returns no closing balance and still parses the row when the balance-after cell is missing', () => {
    const parsed = monobankCsvFormat.parse(missingBalanceCellInput);

    expect(parsed.closingBalance).toBeUndefined();
    expect(parsed.transactions).toHaveLength(1);
  });

  // A "—" balance-after cell (the format's own
  // absent-column marker) must not become a `NaN` closing balance.
  it('returns no closing balance when the balance-after cell is "—"', () => {
    const parsed = monobankCsvFormat.parse(dashBalanceCellInput);

    expect(parsed.closingBalance).toBeUndefined();
  });

  // The closing balance must come from the row with
  // the largest parsed time, not simply the last row in file order.
  it('uses the row with the largest parsed time as the closing balance, not just the last row in the file', () => {
    const parsed = monobankCsvFormat.parse(newestFirstInput);

    expect(parsed.closingBalance).toEqual({
      minorUnits: 10_000_000,
      currency: 'UAH',
      asOfSeconds: 1_683_912_636,
    });
  });
});
