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

import { COLUMN, DETECT_PREFIX, procreditBusinessCsvFormat } from '.';

// The REAL uabean fixture (C.4, NOTICE.md) — confirmed ANONYMIZED via
// uabean's own `anonymize.py` script — reused byte for byte, cp1251-encoded,
// exactly as committed (task-5-report.md confirms the copy's checksum
// matches the clone it came from). Decoded via the REAL `windows-1251`
// library (see `../format-test-fixtures`), the SAME decode step the
// screen's cp1251 fallback performs before handing text to this format —
// `procreditBusinessCsvFormat` itself stays text-based, never touching raw
// bytes.
const fixtureInput = procreditBusinessFixtureInput;
const fixtureText = fixtureInput.text;

// The real fixture's own header, byte-verified (task-5-report.md) — used to
// hand-assemble minimal malformed-row inputs, same convention as
// Monobank/Sensebank's own malformed-row fixtures.
const REAL_HEADER =
  'ЄДРПОУ;Код ID НБУ;Рахунок;Валюта;Дата операції;Код операції;МФО банка;Назва банка;Рахунок кореспондента;ЄДРПОУ кореспондента;Кореспондент;Номер документа;Дата документа;Дебет;Кредит;Призначення платежу;Гривневе покриття';

// Task 3 review precedent (NaN guard, IMPORTANT): neither the debit nor the
// credit cell is populated — an empty or malformed amount cell must never
// reach `Money.fromMajor` as `NaN`; `parse` throws `StatementParseError`
// instead (Monobank/Sensebank's convention).
const malformedAmountInput = {
  text: [
    REAL_HEADER,
    '0000000001;000001;UA00000001;UAH;15.01.2000 09:08:00;T_A;320984;АТ "ПроКредит банк";UA00000002;0000000002;Correspondent1;452607519;14.01.2000 11:21:00;;;Bad amount row;100.00',
  ].join('\n'),
  fileName: 'malformed-amount.csv',
};

const malformedDateInput = {
  text: [
    REAL_HEADER,
    '0000000001;000001;UA00000001;UAH;not-a-date;T_A;320984;АТ "ПроКредит банк";UA00000002;0000000002;Correspondent1;452607519;14.01.2000 11:21:00;100.00;;Bad date row;100.00',
  ].join('\n'),
  fileName: 'malformed-date.csv',
};

// Money-safety review: a row is a Дебет XOR Кредит row, never both — a row
// carrying BOTH populated must throw rather than silently taking the debit
// side and dropping the credit amount without a trace.
const bothDebitAndCreditPopulatedInput = {
  text: [
    REAL_HEADER,
    '0000000001;000001;UA00000001;UAH;15.01.2000 09:08:00;T_A;320984;АТ "ПроКредит банк";UA00000002;0000000002;Correspondent1;452607519;14.01.2000 11:21:00;100.00;100.00;Both populated row;100.00',
  ].join('\n'),
  fileName: 'both-debit-and-credit.csv',
};

// The exported constants ARE the real contract a kiko:developer implements
// `detect`/`parse` against (section C.3) — pinned here, verified against the
// REAL fixture's bytes (task-5-report.md), so a future edit that silently
// drifts the 59-char detect prefix or the column order is caught by a real
// assertion. `COLUMN`'s 16 shared indices come from
// `FOP_BUSINESS_COLUMN_BASE` (also used by `ukrsib-business-csv`'s own
// `COLUMN`, cross-verified against BOTH real/hand-authored fixtures at
// authoring time, task-5-report.md); only this format's OWN divergent
// column (`nbuCode`, index 1) is asserted independently here.
describe('procredit-business-csv format constants', () => {
  it('anchors the 59-character detect prefix exactly, matching the real fixture header', () => {
    expect(DETECT_PREFIX).toBe('ЄДРПОУ;Код ID НБУ;Рахунок;Валюта;Дата операції;Код операції');
    expect(DETECT_PREFIX).toHaveLength(59);
    expect(fixtureText.startsWith(DETECT_PREFIX)).toBe(true);
  });

  it('anchors column 1 (own "Код ID НБУ") to index 1, matching the real fixture header', () => {
    expect(COLUMN.nbuCode).toBe(1);
  });

  it('anchors the column order exactly, matching the real fixture header', () => {
    expect(COLUMN).toEqual({ ...FOP_BUSINESS_COLUMN_BASE, nbuCode: 1 });
  });
});

describe('procreditBusinessCsvFormat.detect', () => {
  it('accepts the real fixture (59-char content-prefix match, decoded from cp1251)', () => {
    expect(procreditBusinessCsvFormat.detect(fixtureInput)).toBe(true);
  });

  it("rejects Ukrsibbank business CSV's own real (hand-authored) fixture", () => {
    expect(procreditBusinessCsvFormat.detect(ukrsibBusinessFixtureInput)).toBe(false);
  });

  it("rejects Alfa business CSV's own real uabean fixture", () => {
    expect(procreditBusinessCsvFormat.detect(alfaBusinessFixtureInput)).toBe(false);
  });

  it("rejects Monobank CSV's own real uabean fixture", () => {
    expect(procreditBusinessCsvFormat.detect(monobankFixtureInput)).toBe(false);
  });

  it("rejects PrivatBank XLSX's own real detect signature", () => {
    expect(procreditBusinessCsvFormat.detect(privatbankLikeInput)).toBe(false);
  });

  it("rejects Sensebank CSV's own real uabean fixture", () => {
    expect(procreditBusinessCsvFormat.detect(sensebankFixtureInput)).toBe(false);
  });
});

describe('procreditBusinessCsvFormat.parse', () => {
  it('carries formatId "procredit-business-csv" on the parsed statement', () => {
    const parsed = procreditBusinessCsvFormat.parse(fixtureInput);

    expect(parsed.formatId).toBe('procredit-business-csv');
  });

  it('parses all 6 transactions from the real fixture', () => {
    const parsed = procreditBusinessCsvFormat.parse(fixtureInput);

    expect(parsed.transactions).toHaveLength(6);
  });

  // No balance/closing-balance column exists in `FOP_BUSINESS_COLUMN_BASE`'s
  // 17-column layout — see `ParsedStatement.closingBalance`'s doc comment in
  // `parser.ts`, which names the three FOP/business CSVs explicitly.
  it('never sets a closingBalance (no balance column in this format)', () => {
    const parsed = procreditBusinessCsvFormat.parse(fixtureInput);

    expect(parsed.closingBalance).toBeUndefined();
  });

  // Row 1: "...;UAH;15.01.2000 09:08:00;...;100.00;;Сплата комісії...;100.00"
  // — a DEBIT-only row (money out); the raw `Дебет` cell is UNSIGNED
  // (`100.00`, no leading minus), unlike Sensebank's own debit cell — this
  // format's `parse` must negate it itself.
  it('parses the first row exactly (UAH debit → negative amountMinorUnits, own EDRPOU dropped)', () => {
    const parsed = procreditBusinessCsvFormat.parse(fixtureInput);
    const first = parsed.transactions[0];

    expect(first.currency).toBe('UAH');
    expect(first.amountMinorUnits).toBe(-10_000);
    expect(first.timeSeconds).toBe(947_927_280);
    expect(first.description).toBe(
      "Сплата комісії за обслуговування рахунків та/чи інших зобов'язань",
    );
  });

  // Row 3: "...;UAH;04.01.2000 01:14:00;...;;117042.75;Кошти від продажу...;117042.75"
  // — a CREDIT-only row (money in), positive, no manual negation.
  it('parses a credit row exactly (UAH credit → positive amountMinorUnits)', () => {
    const parsed = procreditBusinessCsvFormat.parse(fixtureInput);
    const third = parsed.transactions[2];

    expect(third.currency).toBe('UAH');
    expect(third.amountMinorUnits).toBe(11_704_275);
    expect(third.timeSeconds).toBe(946_948_440);
  });

  // Row 2: same file, a DIFFERENT currency (GBP) — proves the per-row
  // `currency` field is set from EACH row's own `Валюта` cell, not a single
  // file-wide constant (unlike Monobank/Sensebank's single-currency files).
  it("carries a DIFFERENT row's own currency (GBP), not the first row's UAH", () => {
    const parsed = procreditBusinessCsvFormat.parse(fixtureInput);
    const second = parsed.transactions[1];

    expect(second.currency).toBe('GBP');
    expect(second.amountMinorUnits).toBe(-247_500);
    expect(second.timeSeconds).toBe(946_948_440);
  });

  it("detects the account currency hint (UAH) from the file's first row", () => {
    const parsed = procreditBusinessCsvFormat.parse(fixtureInput);

    expect(parsed.account.currency).toBe('UAH');
  });

  // The real fixture's `Рахунок` column spans TWO distinct accounts
  // (`UA00000001` on rows 1-3 & 6, `UA00000007` on rows 4-5) — a single
  // account export concatenated from more than one underlying account, the
  // same shape Alfa business's own real fixture has (Controller ruling 3).
  // `account.iban` must be undefined rather than silently picking the first
  // row's account, unifying ProCredit/Ukrsib's shared core with Alfa's own
  // behavior.
  it('sets account.iban to undefined for the real fixture, which spans two distinct accounts', () => {
    const parsed = procreditBusinessCsvFormat.parse(fixtureInput);

    expect(parsed.account.iban).toBeUndefined();
  });

  it('throws a StatementParseError instead of writing a NaN amount when both debit and credit are empty', () => {
    expect(() => procreditBusinessCsvFormat.parse(malformedAmountInput)).toThrow(
      StatementParseError,
    );
  });

  it('throws a StatementParseError for an unparseable DD.MM.YYYY HH:MM:SS date cell', () => {
    expect(() => procreditBusinessCsvFormat.parse(malformedDateInput)).toThrow(StatementParseError);
  });

  it('throws a StatementParseError instead of taking the debit side when both Дебет and Кредит are populated', () => {
    expect(() => procreditBusinessCsvFormat.parse(bothDebitAndCreditPopulatedInput)).toThrow(
      StatementParseError,
    );
  });
});
