import path from 'node:path';
import { readFileSync } from 'node:fs';
import { decode as decodeWindows1251 } from 'windows-1251';

import { StatementParseError } from '../../parser';
import { PRIVATBANK_TITLE_PREFIX } from '../privatbank-xlsx';

import {
  ACCOUNT_LINE_PATTERN,
  COLUMN,
  GUARANTEE_SKIP_PREFIX,
  HEADER_ROW,
  SECTION_SKIP_PREFIX,
  SENSEBANK_DATE_PATTERN,
  SENSEBANK_PREAMBLE,
  sensebankCsvFormat,
} from '.';

// The REAL uabean fixture (C.4, NOTICE.md) — confirmed SYNTHETIC (placeholder
// IBAN, test-card Visa number, year-2000 dates) — reused byte for byte,
// cp1251-encoded, exactly as committed (a checksum confirms the copy
// matches the clone it came from). Decoded here via the REAL
// `windows-1251` library, the SAME decode step the screen's cp1251 fallback
// will perform before handing text to this format — `sensebankCsvFormat`
// itself stays text-based, never touching raw bytes.
const fixtureBytes = readFileSync(path.join(__dirname, '__fixtures__/uabean-sensebank-sample.csv'));
const fixtureText = decodeWindows1251(fixtureBytes);
const fixtureInput = { text: fixtureText, fileName: 'uabean-sensebank-sample.csv' };

const unrelatedCsv = {
  text: 'Date,Amount,Description\n2024-01-01,-10.00,Coffee\n',
  fileName: 'other-bank.csv',
};

const privatbankLikeInput = {
  // Reuses PrivatBank XLSX's OWN real detect-signature constant (not a
  // hand-typed guess) so this genuinely proves Sensebank's detect rejects
  // ANOTHER shipped format's real signature, not just generic junk text.
  text: `${PRIVATBANK_TITLE_PREFIX}\nДата,Категорія\n01.07.2025,100`,
  fileName: 'privatbank-like.csv',
};

// A minimal, otherwise-valid single-block Sensebank export — every
// malformed-row test below starts from this template and swaps exactly one
// cell, so each test isolates exactly one guard.
const preambleLines = [
  SENSEBANK_PREAMBLE,
  'за період 01.01.2000 - 31.01.2000;;;;;;;',
  'Номер договору №1234567;;;;;;;',
  'Рахунок UA111111111111111111111111111 (UAH);;;;;;;',
  'Деталізація операцій за рахунком: UA111111111111111111111111111;;;;;;;',
  HEADER_ROW.join(';'),
].join('\n');

// The NaN guard: neither the debit nor the credit cell is populated — an
// empty or malformed amount cell must never reach `Money.fromMajor` as
// `NaN`. Sensebank has no PrivatBank-style
// "unresolved rows" concept (its currency is a single regex match, not a
// per-row word lookup), so this format follows Monobank's convention: throw
// `StatementParseError` rather than silently writing `NaN`.
const malformedAmountInput = {
  text: `${preambleLines}\n09.01.00 00:58;виконано;Інше;Bad Amount Row;Kyiv, UKR;;;`,
  fileName: 'malformed-amount.csv',
};

const malformedDateInput = {
  text: `${preambleLines}\nnot-a-date;виконано;Інше;Bad Date Row;Kyiv, UKR;;-1,00;`,
  fileName: 'malformed-date.csv',
};

// Money-safety guard (mirrors `business-csv`'s Дебет XOR Кредит guard): a row
// carrying BOTH a debit AND a credit amount is not a valid single-amount
// row — silently preferring one side (the old `||` fallback) would drop the
// other without a trace, so this must throw rather than guess.
const bothDebitAndCreditInput = {
  text: `${preambleLines}\n09.01.00 00:58;виконано;Інше;Both Amounts Row;Kyiv, UKR;;-150,00;1000,00`,
  fileName: 'both-debit-and-credit.csv',
};

const noAccountLineInput = {
  text: [
    SENSEBANK_PREAMBLE,
    'за період 01.01.2000 - 31.01.2000;;;;;;;',
    HEADER_ROW.join(';'),
    '09.01.00 00:58;виконано;Інше;No account line;Kyiv, UKR;;-1,00;',
  ].join('\n'),
  fileName: 'no-account-line.csv',
};

// The exported constants ARE the real contract a kiko:developer implements
// `detect`/`parse` against — pinned here, verified against the
// REAL fixture's bytes, so a future edit that silently
// drifts the preamble, the account-line regex, the header row (note the
// LATIN "C" in "Cума"), the skip prefixes, the column order, or the date
// pattern is caught by a real assertion.
describe('sensebank-csv format constants', () => {
  it('anchors the detect preamble exactly', () => {
    expect(SENSEBANK_PREAMBLE).toBe('Виписка за рахунком;;;;;;;');
  });

  it('anchors the account-line pattern and matches the real fixture line', () => {
    expect(ACCOUNT_LINE_PATTERN.source).toBe('Рахунок (\\w+) \\((\\w+)\\)');
    const match = ACCOUNT_LINE_PATTERN.exec('Рахунок UA111111111111111111111111111 (UAH);;;;;;;');
    expect(match?.[1]).toBe('UA111111111111111111111111111');
    expect(match?.[2]).toBe('UAH');
  });

  it('anchors the header row exactly, including the LATIN "C" in "Cума"', () => {
    expect(HEADER_ROW).toEqual([
      'Дата і час',
      'Статус',
      'Тип',
      'Деталі',
      'Адреса',
      'MCC',
      'Cума списання',
      'Cума зарахування',
    ]);
    // U+0043 LATIN CAPITAL LETTER C, not U+0421 CYRILLIC CAPITAL LETTER ES —
    // verified against the real fixture's own bytes; a
    // hand-typed Cyrillic "С" would silently never match a real export.
    expect(HEADER_ROW[6].codePointAt(0)).toBe(0x43);
    expect(HEADER_ROW[7].codePointAt(0)).toBe(0x43);
  });

  it('anchors the column order exactly', () => {
    expect(COLUMN).toEqual({
      date: 0,
      status: 1,
      type: 2,
      details: 3,
      address: 4,
      mcc: 5,
      debit: 6,
      credit: 7,
    });
  });

  it('anchors both section/footer skip prefixes exactly', () => {
    expect(SECTION_SKIP_PREFIX).toBe('Деталізація операцій');
    expect(GUARANTEE_SKIP_PREFIX).toBe('Вклади гарантуються');
  });

  it('anchors the 2-digit-year date pattern (own parse, not the shared DD.MM.YYYY helper)', () => {
    expect(SENSEBANK_DATE_PATTERN.test('09.01.00 00:58')).toBe(true);
    expect(SENSEBANK_DATE_PATTERN.test('09.01.2000 00:58:00')).toBe(false);
  });
});

describe('sensebankCsvFormat.detect', () => {
  it('accepts the real fixture (content-prefix match, decoded from cp1251)', () => {
    expect(sensebankCsvFormat.detect(fixtureInput)).toBe(true);
  });

  it('rejects an unrelated CSV with a different header', () => {
    expect(sensebankCsvFormat.detect(unrelatedCsv)).toBe(false);
  });

  it("rejects PrivatBank XLSX's own real detect signature", () => {
    expect(sensebankCsvFormat.detect(privatbankLikeInput)).toBe(false);
  });
});

describe('sensebankCsvFormat.parse', () => {
  it('carries formatId "sensebank-csv" on the parsed statement', () => {
    const parsed = sensebankCsvFormat.parse(fixtureInput);

    expect(parsed.formatId).toBe('sensebank-csv');
  });

  it('detects the account currency (UAH) from the "Рахунок … (UAH)" preamble line', () => {
    const parsed = sensebankCsvFormat.parse(fixtureInput);

    expect(parsed.account.currency).toBe('UAH');
  });

  // The real fixture has TWO repeated header+rows blocks under one account
  // (one "за рахунком" block with 2 rows, one "за карткою" block with 4
  // rows) — 6 transactions total, neither a section/footer line nor either
  // repeated header row counted as data.
  it('parses all 6 transactions across BOTH repeated blocks, skipping every section/header line', () => {
    const parsed = sensebankCsvFormat.parse(fixtureInput);

    expect(parsed.transactions).toHaveLength(6);
    expect(
      parsed.transactions.some((transaction) => transaction.description.startsWith('Дата і час')),
    ).toBe(false);
    expect(
      parsed.transactions.some((transaction) =>
        transaction.description.includes('Деталізація операцій'),
      ),
    ).toBe(false);
  });

  it("carries the file's single account currency on every parsed row", () => {
    const parsed = sensebankCsvFormat.parse(fixtureInput);

    expect(parsed.transactions.every((transaction) => transaction.currency === 'UAH')).toBe(true);
  });

  // Row 1 (first block, first row): a DEBIT-only row — the raw cell already
  // carries its own leading minus sign ("-150,00"), comma-decimal.
  it('parses the first row exactly (debit, no MCC — a service fee)', () => {
    const parsed = sensebankCsvFormat.parse(fixtureInput);
    const first = parsed.transactions[0];

    expect(first.amountMinorUnits).toBe(-15_000);
    expect(first.timeSeconds).toBe(947_379_480);
    expect(first.description).toBe('Щомісячна комісія за обслуговування пакета банківських послуг');
    expect(first.mcc).toBeUndefined();
  });

  // Row 2 (first block, second row): a CREDIT-only row, comma-decimal,
  // positive, no leading sign in the raw cell.
  it('parses the second row exactly (credit, no MCC)', () => {
    const parsed = sensebankCsvFormat.parse(fixtureInput);
    const second = parsed.transactions[1];

    expect(second.amountMinorUnits).toBe(1_000_013);
    expect(second.timeSeconds).toBe(948_802_320);
    expect(second.description).toBe('Перерахування чистого підприємницького доходу, без ПДВ');
    expect(second.mcc).toBeUndefined();
  });

  // Row 5 (second block, third row): the largest-magnitude debit in the
  // fixture, an ATM cash withdrawal — proves comma-decimal amounts with more
  // than 2 significant digits before the decimal still parse exactly.
  it('parses an MCC-bearing row from the SECOND block exactly (ATM cash withdrawal)', () => {
    const parsed = sensebankCsvFormat.parse(fixtureInput);
    const fifth = parsed.transactions[4];

    expect(fifth.amountMinorUnits).toBe(-158_582);
    expect(fifth.timeSeconds).toBe(947_090_580);
    expect(fifth.description).toBe('Зняття готівки в банкоматі');
    expect(fifth.mcc).toBe(6011);
  });

  // Row 6 (second block, last row): a credit with an MCC present — maps
  // through Kiko's own `categoryForMcc` via the generic mapper (not this
  // format), confirmed by carrying the raw MCC number through untouched.
  it('parses the last row exactly (credit with MCC present)', () => {
    const parsed = sensebankCsvFormat.parse(fixtureInput);
    const last = parsed.transactions[5];

    expect(last.amountMinorUnits).toBe(160_000);
    expect(last.timeSeconds).toBe(947_087_700);
    expect(last.description).toBe('Переказ з картки на картку (зарахування)');
    expect(last.mcc).toBe(4829);
  });

  it('parses the 2 remaining MCC-bearing rows from the first "за карткою" block exactly', () => {
    const parsed = sensebankCsvFormat.parse(fixtureInput);
    const [, , third, fourth] = parsed.transactions;

    expect(third.amountMinorUnits).toBe(-14_000);
    expect(third.mcc).toBe(4900);
    expect(fourth.amountMinorUnits).toBe(-27_000);
    expect(fourth.mcc).toBe(7311);
  });

  it('throws a StatementParseError instead of writing a NaN amount when both debit and credit are empty', () => {
    expect(() => sensebankCsvFormat.parse(malformedAmountInput)).toThrow(StatementParseError);
  });

  it('throws a StatementParseError for an unparseable DD.MM.YY HH:MM date cell', () => {
    expect(() => sensebankCsvFormat.parse(malformedDateInput)).toThrow(StatementParseError);
  });

  it('throws a StatementParseError when no "Рахунок … (…)" account line is present', () => {
    expect(() => sensebankCsvFormat.parse(noAccountLineInput)).toThrow(StatementParseError);
  });

  it('throws a StatementParseError instead of silently dropping the credit when both debit and credit are populated', () => {
    expect(() => sensebankCsvFormat.parse(bothDebitAndCreditInput)).toThrow(StatementParseError);
  });
});
