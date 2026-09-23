import {
  alfaBusinessFixtureInput,
  monobankFixtureInput,
  privatbankLikeInput,
  procreditBusinessFixtureInput,
  sensebankFixtureInput,
  ukrsibBusinessFixtureInput,
} from '../format-test-fixtures';
import { StatementParseError } from '../../parser';
import { FOP_BUSINESS_COLUMN_BASE } from '../business-csv';

import { COLUMN, FULL_HEADER_LINE, OPERATSII_WORD, ukrsibBusinessCsvFormat } from '.';

// HAND-AUTHORED synthetic fixture (no uabean fixture exists for this
// format, C.4) — cp1251-encoded, all-fake account/EDRPOU numbers, "Test
// Merchant" descriptions (task-5-report.md). Decoded via the REAL
// `windows-1251` library (see `../format-test-fixtures`), the SAME decode
// step the screen's cp1251 fallback performs before handing text to this
// format.
const fixtureInput = ukrsibBusinessFixtureInput;
const fixtureText = fixtureInput.text;

// Task 3 review precedent (NaN guard, IMPORTANT): neither `Дебет` nor
// `Кредит` is populated — an empty or malformed amount cell must never
// reach `Money.fromMajor` as `NaN`; `parse` throws `StatementParseError`
// instead (Monobank/Sensebank/ProCredit business's convention).
const malformedAmountInput = {
  text: [
    FULL_HEADER_LINE,
    '"1234567890";"300346";"UA011111111111111111111111111";"UAH";"05.02.2026 09:15:00";"T_D";"300346";"АТ ""Укрсиббанк""";"UA022222222222222222222222222";"9876543210";"Test Merchant";"1001";"05.02.2026 09:00:00";"";"";"Bad amount row";"250.00";',
  ].join('\n'),
  fileName: 'malformed-amount.csv',
};

const malformedDateInput = {
  text: [
    FULL_HEADER_LINE,
    '"1234567890";"300346";"UA011111111111111111111111111";"UAH";"not-a-date";"T_D";"300346";"АТ ""Укрсиббанк""";"UA022222222222222222222222222";"9876543210";"Test Merchant";"1001";"05.02.2026 09:00:00";"250.00";"";"Bad date row";"250.00";',
  ].join('\n'),
  fileName: 'malformed-date.csv',
};

// The exported constants ARE the real contract a kiko:developer implements
// `detect`/`parse` against (section C.3), pinned here — including the
// byte-level Latin-`i` trap, the reason this format needed its own hand-
// authored fixture rather than a reused one. `COLUMN`'s 16 shared indices
// come from `FOP_BUSINESS_COLUMN_BASE` (also used by
// `procredit-business-csv`'s own `COLUMN`, cross-verified against BOTH
// real/hand-authored fixtures at authoring time, task-5-report.md); only
// this format's OWN divergent column (`mfo`, index 1) is asserted
// independently here.
describe('ukrsib-business-csv format constants', () => {
  it('anchors the full literal header line exactly, matching the hand-authored fixture', () => {
    expect(fixtureText.startsWith(FULL_HEADER_LINE)).toBe(true);
  });

  // ⚠️ The critical byte-level trap this format exists to guard against: a
  // test asserting `і` (Cyrillic, U+0456) here instead would silently pass
  // on a WRONG detect signature that would never match a real Ukrsib
  // export — pinned by exact codepoint, not by eye.
  it('anchors "операцiї" with the LATIN small letter i (U+0069), not Cyrillic і (U+0456), both occurrences', () => {
    expect(OPERATSII_WORD).toBe('операцiї');
    expect(OPERATSII_WORD.codePointAt(6)).toBe(0x0069);
    expect(OPERATSII_WORD.codePointAt(6)).not.toBe(0x0456);

    const occurrences = FULL_HEADER_LINE.split(OPERATSII_WORD).length - 1;
    expect(occurrences).toBe(2);
  });

  it('anchors column 1 (own "МФО") to index 1, matching the hand-authored fixture header', () => {
    expect(COLUMN.mfo).toBe(1);
  });

  it('anchors the column order exactly, matching the hand-authored fixture header', () => {
    expect(COLUMN).toEqual({ ...FOP_BUSINESS_COLUMN_BASE, mfo: 1 });
  });
});

describe('ukrsibBusinessCsvFormat.detect', () => {
  it('accepts the hand-authored fixture (full literal header match, decoded from cp1251)', () => {
    expect(ukrsibBusinessCsvFormat.detect(fixtureInput)).toBe(true);
  });

  it("rejects ProCredit business CSV's own real uabean fixture", () => {
    expect(ukrsibBusinessCsvFormat.detect(procreditBusinessFixtureInput)).toBe(false);
  });

  it("rejects Alfa business CSV's own real uabean fixture", () => {
    expect(ukrsibBusinessCsvFormat.detect(alfaBusinessFixtureInput)).toBe(false);
  });

  it("rejects Monobank CSV's own real uabean fixture", () => {
    expect(ukrsibBusinessCsvFormat.detect(monobankFixtureInput)).toBe(false);
  });

  it("rejects PrivatBank XLSX's own real detect signature", () => {
    expect(ukrsibBusinessCsvFormat.detect(privatbankLikeInput)).toBe(false);
  });

  it("rejects Sensebank CSV's own real uabean fixture", () => {
    expect(ukrsibBusinessCsvFormat.detect(sensebankFixtureInput)).toBe(false);
  });

  // A file carrying every field UNQUOTED (ProCredit business's own shape)
  // must not accidentally satisfy a loosely-written detect that only checks
  // a Cyrillic-only header substring rather than the FULL literal
  // (quote-inclusive) line.
  it('rejects an unquoted variant of its own header text', () => {
    const unquotedInput = {
      text: FULL_HEADER_LINE.replace(/"/g, ''),
      fileName: 'unquoted-header.csv',
    };

    expect(ukrsibBusinessCsvFormat.detect(unquotedInput)).toBe(false);
  });
});

describe('ukrsibBusinessCsvFormat.parse', () => {
  it('carries formatId "ukrsib-business-csv" on the parsed statement', () => {
    const parsed = ukrsibBusinessCsvFormat.parse(fixtureInput);

    expect(parsed.formatId).toBe('ukrsib-business-csv');
  });

  it('parses all 4 transactions from the hand-authored fixture', () => {
    const parsed = ukrsibBusinessCsvFormat.parse(fixtureInput);

    expect(parsed.transactions).toHaveLength(4);
  });

  // Row 1: UAH debit "250.00", unsigned in the raw cell — must be negated.
  it('parses the first row exactly (UAH debit → negative amountMinorUnits)', () => {
    const parsed = ukrsibBusinessCsvFormat.parse(fixtureInput);
    const first = parsed.transactions[0];

    expect(first.currency).toBe('UAH');
    expect(first.amountMinorUnits).toBe(-25_000);
    expect(first.timeSeconds).toBe(1_770_282_900);
    expect(first.description).toBe('Оплата за товар Test Merchant');
  });

  // Row 2: UAH credit "5000.00", positive, no manual negation.
  it('parses the second row exactly (UAH credit → positive amountMinorUnits)', () => {
    const parsed = ukrsibBusinessCsvFormat.parse(fixtureInput);
    const second = parsed.transactions[1];

    expect(second.currency).toBe('UAH');
    expect(second.amountMinorUnits).toBe(500_000);
    expect(second.timeSeconds).toBe(1_770_388_200);
  });

  // Rows 3-4 switch to a DIFFERENT account/currency (USD) — proves the
  // per-row `currency` is read from each row's own `Валюта` cell.
  it("carries a DIFFERENT row's own currency (USD debit)", () => {
    const parsed = ukrsibBusinessCsvFormat.parse(fixtureInput);
    const third = parsed.transactions[2];

    expect(third.currency).toBe('USD');
    expect(third.amountMinorUnits).toBe(-10_050);
    expect(third.timeSeconds).toBe(1_770_458_700);
  });

  it('parses a USD credit row exactly', () => {
    const parsed = ukrsibBusinessCsvFormat.parse(fixtureInput);
    const fourth = parsed.transactions[3];

    expect(fourth.currency).toBe('USD');
    expect(fourth.amountMinorUnits).toBe(30_075);
    expect(fourth.timeSeconds).toBe(1_770_569_100);
  });

  it("detects the account currency hint (UAH) from the file's first row", () => {
    const parsed = ukrsibBusinessCsvFormat.parse(fixtureInput);

    expect(parsed.account.currency).toBe('UAH');
  });

  it('throws a StatementParseError instead of writing a NaN amount when both debit and credit are empty', () => {
    expect(() => ukrsibBusinessCsvFormat.parse(malformedAmountInput)).toThrow(StatementParseError);
  });

  it('throws a StatementParseError for an unparseable DD.MM.YYYY HH:MM:SS date cell', () => {
    expect(() => ukrsibBusinessCsvFormat.parse(malformedDateInput)).toThrow(StatementParseError);
  });
});
