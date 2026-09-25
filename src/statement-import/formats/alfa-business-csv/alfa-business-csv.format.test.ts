import {
  alfaBusinessFixtureInput,
  monobankFixtureInput,
  privatbankLikeInput,
  procreditBusinessFixtureInput,
  sensebankFixtureInput,
  ukrsibBusinessFixtureInput,
} from '../format-test-fixtures';
import { StatementParseError } from '../../parser';

import {
  alfaBusinessCsvFormat,
  COLUMN,
  FULL_HEADER_LINE,
  OPERATION_CREDIT_WORD,
  OPERATION_DEBIT_WORD,
} from '.';

// The REAL uabean fixture (C.4, NOTICE.md) — confirmed SYNTHETIC (`XYZ
// COMPANY`/`JOHN DOE` placeholders, all-1s IBANs/EDRPOU, literal
// `[REDACTED]` markers) — reused byte for byte, cp1251-encoded, exactly as
// committed (a checksum confirms the copy matches the
// clone it came from). Decoded via the REAL `windows-1251` library (see
// `../format-test-fixtures`), the SAME decode step the screen's cp1251
// fallback performs before handing text to this format.
const fixtureInput = alfaBusinessFixtureInput;
const fixtureText = fixtureInput.text;

// The NaN guard: the unsigned `Сума` cell is empty — must never reach
// `Money.fromMajor` as `NaN`; `parse` throws `StatementParseError` instead.
const malformedAmountInput = {
  text: [
    FULL_HEADER_LINE,
    '11111111111111;UA11111111111111111111111111;Дебет;1111111;UA11111111111111111111111111;111111;XYZ COMPANY;11111111;Bad amount row;03.03.2021;104285940;;GBP;14:00:14;03.03.2021;03.03.2021;1111111111;JOHN DOE;111111',
  ].join('\n'),
  fileName: 'malformed-amount.csv',
};

// The join of `Дата проведення` + `Час проведення` produces an unparseable
// combined string when the date half itself is malformed.
const malformedDateInput = {
  text: [
    FULL_HEADER_LINE,
    '11111111111111;UA11111111111111111111111111;Дебет;1111111;UA11111111111111111111111111;111111;XYZ COMPANY;11111111;Bad date row;not-a-date;104285940;1018.23;GBP;14:00:14;03.03.2021;03.03.2021;1111111111;JOHN DOE;111111',
  ].join('\n'),
  fileName: 'malformed-date.csv',
};

// An unrecognized `Операція` word (neither `Дебет` nor `Кредит`) must not
// silently resolve to either sign — this is the ONE format whose sign
// depends on a separate word column rather than "which of two columns is
// non-empty", so a corrupted/unexpected word is its own distinct failure
// mode, guarded the same way as an invalid amount (StatementParseError).
const unknownOperationWordInput = {
  text: [
    FULL_HEADER_LINE,
    '11111111111111;UA11111111111111111111111111;Сторно;1111111;UA11111111111111111111111111;111111;XYZ COMPANY;11111111;Unknown operation word row;03.03.2021;104285940;1018.23;GBP;14:00:14;03.03.2021;03.03.2021;1111111111;JOHN DOE;111111',
  ].join('\n'),
  fileName: 'unknown-operation-word.csv',
};

// The exported constants ARE the real contract a kiko:developer implements
// `detect`/`parse` against (section C.3), pinned here — verified against
// the REAL fixture's bytes. Alfa's 19-column layout is
// genuinely unique in this plan (no shared base with ProCredit/Ukrsib
// business, unlike those two), so instead of a hand-typed literal
// duplicating the plain object below, every index is independently derived
// from splitting the REAL header text itself — still a full pin against
// drift, but structured differently so it does not restate
// `alfa-business-csv.format.ts`'s own object literal token for token.
describe('alfa-business-csv format constants', () => {
  it('anchors the full literal header line exactly, matching the real fixture', () => {
    expect(fixtureText.startsWith(FULL_HEADER_LINE)).toBe(true);
  });

  it('anchors the debit/credit word-column values exactly', () => {
    expect(OPERATION_DEBIT_WORD).toBe('Дебет');
    expect(OPERATION_CREDIT_WORD).toBe('Кредит');
  });

  it("anchors every COLUMN index to its real header field's own position", () => {
    const headerFields = FULL_HEADER_LINE.split(';');

    expect(headerFields).toHaveLength(19);
    expect(headerFields[COLUMN.ourAccount]).toBe('Наш рахунок');
    expect(headerFields[COLUMN.ourIban]).toBe('Наш IBAN');
    expect(headerFields[COLUMN.operation]).toBe('Операція');
    expect(headerFields[COLUMN.correspondentAccount]).toBe('Рахунок');
    expect(headerFields[COLUMN.correspondentIban]).toBe('IBAN');
    expect(headerFields[COLUMN.correspondentBankMfo]).toBe('МФО банку контрагента');
    expect(headerFields[COLUMN.correspondentName]).toBe('Найменування контрагента');
    expect(headerFields[COLUMN.correspondentCode]).toBe('Код контрагента');
    expect(headerFields[COLUMN.paymentPurpose]).toBe('Призначення платежу');
    expect(headerFields[COLUMN.operationDate]).toBe('Дата проведення');
    expect(headerFields[COLUMN.documentNumber]).toBe('Номер документа');
    expect(headerFields[COLUMN.amount]).toBe('Сума');
    expect(headerFields[COLUMN.currency]).toBe('Валюта');
    expect(headerFields[COLUMN.operationTime]).toBe('Час проведення');
    expect(headerFields[COLUMN.documentDate]).toBe('Дата документа');
    expect(headerFields[COLUMN.archiveDate]).toBe('Дата архівування');
    expect(headerFields[COLUMN.ownEdrpou]).toBe('Ід.код');
    expect(headerFields[COLUMN.ownName]).toBe('Найменування');
    expect(headerFields[COLUMN.mfo]).toBe('МФО');
  });
});

describe('alfaBusinessCsvFormat.detect', () => {
  it('accepts the real fixture (full literal header match, decoded from cp1251)', () => {
    expect(alfaBusinessCsvFormat.detect(fixtureInput)).toBe(true);
  });

  it("rejects ProCredit business CSV's own real uabean fixture", () => {
    expect(alfaBusinessCsvFormat.detect(procreditBusinessFixtureInput)).toBe(false);
  });

  it("rejects Ukrsibbank business CSV's own real (hand-authored) fixture", () => {
    expect(alfaBusinessCsvFormat.detect(ukrsibBusinessFixtureInput)).toBe(false);
  });

  it("rejects Monobank CSV's own real uabean fixture", () => {
    expect(alfaBusinessCsvFormat.detect(monobankFixtureInput)).toBe(false);
  });

  it("rejects PrivatBank XLSX's own real detect signature", () => {
    expect(alfaBusinessCsvFormat.detect(privatbankLikeInput)).toBe(false);
  });

  it("rejects Sensebank CSV's own real uabean fixture", () => {
    expect(alfaBusinessCsvFormat.detect(sensebankFixtureInput)).toBe(false);
  });
});

describe('alfaBusinessCsvFormat.parse', () => {
  it('carries formatId "alfa-business-csv" on the parsed statement', () => {
    const parsed = alfaBusinessCsvFormat.parse(fixtureInput);

    expect(parsed.formatId).toBe('alfa-business-csv');
  });

  it('parses all 7 transactions from the real fixture, skipping the header row', () => {
    const parsed = alfaBusinessCsvFormat.parse(fixtureInput);

    expect(parsed.transactions).toHaveLength(7);
  });

  // Row 1: "...;Дебет;...;1018.23;GBP;14:00:14;..." — the word column
  // ("Дебет") determines the sign of the SEPARATE unsigned `Сума` cell (the
  // structurally different convention this format exists to test), and the
  // date+time are joined from TWO separate columns.
  it('parses the first row exactly (word-column Дебет → negative, joined date+time)', () => {
    const parsed = alfaBusinessCsvFormat.parse(fixtureInput);
    const first = parsed.transactions[0];

    expect(first.currency).toBe('GBP');
    expect(first.amountMinorUnits).toBe(-101_823);
    expect(first.timeSeconds).toBe(1_614_780_014);
  });

  // Row 2: "...;Кредит;...;5018.23;GBP;09:47:52;..." — word-column "Кредит"
  // → positive, same unsigned `Сума` convention.
  it('parses the second row exactly (word-column Кредит → positive)', () => {
    const parsed = alfaBusinessCsvFormat.parse(fixtureInput);
    const second = parsed.transactions[1];

    expect(second.currency).toBe('GBP');
    expect(second.amountMinorUnits).toBe(501_823);
    expect(second.timeSeconds).toBe(1_614_764_872);
  });

  // Row 3 switches currency to UAH within the same file — proves per-row
  // `currency` is read from each row's own `Валюта` cell.
  it("carries a DIFFERENT row's own currency (UAH credit)", () => {
    const parsed = alfaBusinessCsvFormat.parse(fixtureInput);
    const third = parsed.transactions[2];

    expect(third.currency).toBe('UAH');
    expect(third.amountMinorUnits).toBe(3_944_747);
    expect(third.timeSeconds).toBe(1_614_782_414);
  });

  it('parses the last row exactly (word-column Дебет → negative, GBP)', () => {
    const parsed = alfaBusinessCsvFormat.parse(fixtureInput);
    const last = parsed.transactions[6];

    expect(last.currency).toBe('GBP');
    expect(last.amountMinorUnits).toBe(-501_823);
    expect(last.timeSeconds).toBe(1_614_764_872);
  });

  it("detects the account currency hint (GBP) from the file's first row", () => {
    const parsed = alfaBusinessCsvFormat.parse(fixtureInput);

    expect(parsed.account.currency).toBe('GBP');
  });

  // The real fixture's `Наш IBAN` column spans TWO distinct accounts (rows
  // 1-5 carry one IBAN, rows 6-7 a different one) — Controller ruling 3:
  // `account.iban` must be undefined rather than silently picking the first
  // row's IBAN. Behavior already existed; this locks it in with a real
  // assertion.
  it('sets account.iban to undefined for the real fixture, which spans two distinct IBANs', () => {
    const parsed = alfaBusinessCsvFormat.parse(fixtureInput);

    expect(parsed.account.iban).toBeUndefined();
  });

  it('throws a StatementParseError instead of writing a NaN amount for an empty Сума cell', () => {
    expect(() => alfaBusinessCsvFormat.parse(malformedAmountInput)).toThrow(StatementParseError);
  });

  it('throws a StatementParseError for an unparseable joined date+time value', () => {
    expect(() => alfaBusinessCsvFormat.parse(malformedDateInput)).toThrow(StatementParseError);
  });

  it('throws a StatementParseError for an unrecognized Операція word (neither Дебет nor Кредит)', () => {
    expect(() => alfaBusinessCsvFormat.parse(unknownOperationWordInput)).toThrow(
      StatementParseError,
    );
  });
});
