// Column layout verified against docs/plans/statement-import.md
// (Alfa business/FOP) — grounded in OSadovy/uabean's importer facts,
// cross-checked against the REAL fixture bytes (see
// src/statement-import/NOTICE.md for the exact per-line
// facts). No uabean source is reused; this is an independent TypeScript
// implementation. The fixture this format is tested against
// (`__fixtures__/uabean-alfa-business-sample.csv`) IS uabean's own real
// sample — confirmed SYNTHETIC (`XYZ COMPANY`/`JOHN DOE` placeholders,
// all-1s IBANs/EDRPOU, literal `[REDACTED]` markers in description text).
import {
  type ParsedStatement,
  type ParsedTransaction,
  type StatementFormat,
  type StatementFormatInput,
  StatementParseError,
} from '@kiko/statement-import/parser';
import { Money } from '@kiko/currency/money';
import { parseDateTimeSeconds } from '@kiko/statement-import/parse-date-time';

import {
  parseFiniteAmountMajor,
  readDataRows,
  resolveRowCurrency,
  resolveSoleColumnValue,
} from '../business-csv';

// Detect signature: file content matches the FULL literal header line
// (unquoted, unlike Ukrsib business — verified against the real fixture's
// own first line).
export const FULL_HEADER_LINE =
  'Наш рахунок;Наш IBAN;Операція;Рахунок;IBAN;МФО банку контрагента;Найменування контрагента;Код контрагента;Призначення платежу;Дата проведення;Номер документа;Сума;Валюта;Час проведення;Дата документа;Дата архівування;Ід.код;Найменування;МФО';

// Structurally different from ProCredit/Ukrsib business: ONE unsigned `Сума`
// column plus a SEPARATE `Операція` word column (`Дебет` or `Кредит`) that
// determines the sign — not a debit/credit two-COLUMN pair.
export const OPERATION_DEBIT_WORD = 'Дебет';
export const OPERATION_CREDIT_WORD = 'Кредит';

// 0-based column indices against a `;`-delimited data row (19
// columns, verified against the real fixture's header). FOP fields:
// `ownEdrpou` (**`Ід.код`**, column index 16 — NOTE: the header does NOT
// literally say `ЄДРПОУ` the way ProCredit/Ukrsib do) and
// `correspondentCode` (**`Код контрагента`**, column index 7) — both read
// only to skip (no
// ParsedTransaction/ParsedAccountHint field exists for it). Date is SPLIT
// across `operationDate` + `operationTime` (the ONE format studied where
// date and time are NOT combined in one field) — join then reuse the shared
// `parseDateTimeSeconds` helper.
export const COLUMN = {
  ourAccount: 0,
  ourIban: 1,
  operation: 2,
  correspondentAccount: 3,
  correspondentIban: 4,
  correspondentBankMfo: 5,
  correspondentName: 6,
  correspondentCode: 7,
  paymentPurpose: 8,
  operationDate: 9,
  documentNumber: 10,
  amount: 11,
  currency: 12,
  operationTime: 13,
  documentDate: 14,
  archiveDate: 15,
  ownEdrpou: 16,
  ownName: 17,
  mfo: 18,
} as const;

const FORMAT_LABEL = 'Alfa business';

const detect = (input: StatementFormatInput): boolean => input.text.startsWith(FULL_HEADER_LINE);

// Structurally different from ProCredit/Ukrsib business's shared
// `../business-csv` core: ONE unsigned `Сума` column, sign determined by the
// SEPARATE `Операція` word column rather than which of a debit/credit
// COLUMN PAIR is populated. An unrecognized word (neither Дебет nor Кредит)
// is its own distinct failure mode, guarded the same way as an invalid
// amount (StatementParseError) — it must never silently resolve to either
// sign.
const parseRowAmountMinorUnits = (
  row: string[],
  currency: ParsedTransaction['currency'],
): number => {
  const major = parseFiniteAmountMajor(row[COLUMN.amount], FORMAT_LABEL);
  const minorUnits = Money.fromMajor(currency, major).minorUnits;
  const operation = row[COLUMN.operation];

  if (operation === OPERATION_DEBIT_WORD) {
    return -minorUnits;
  }

  if (operation === OPERATION_CREDIT_WORD) {
    return minorUnits;
  }

  throw new StatementParseError(`Unrecognized ${FORMAT_LABEL} Операція word: "${operation}"`);
};

// The ONE format studied where date and time are NOT combined
// in one field — `Дата проведення` + `Час проведення` are joined into a
// single "DD.MM.YYYY HH:MM:SS" string before reusing the shared
// `parseDateTimeSeconds` helper, exactly like ProCredit/Ukrsib business's own
// single-field date.
const parseRowTimeSeconds = (row: string[]): number =>
  parseDateTimeSeconds(`${row[COLUMN.operationDate]} ${row[COLUMN.operationTime]}`, FORMAT_LABEL);

const parseDataRow = (row: string[]): ParsedTransaction => {
  const currency = resolveRowCurrency(row[COLUMN.currency], FORMAT_LABEL);

  return {
    currency,
    amountMinorUnits: parseRowAmountMinorUnits(row, currency),
    timeSeconds: parseRowTimeSeconds(row),
    description: row[COLUMN.paymentPurpose],
  };
};

const parse = (input: StatementFormatInput): ParsedStatement => {
  const dataRows = readDataRows(input.text, FORMAT_LABEL);

  return {
    formatId: 'alfa-business-csv',
    account: {
      currency: resolveRowCurrency(dataRows[0][COLUMN.currency], FORMAT_LABEL),
      // `account.iban` is undefined when the file spans
      // MULTIPLE distinct "Наш IBAN" values (the real fixture's own shape —
      // rows 1-5 carry one IBAN, rows 6-7 a different one, concatenated from
      // two accounts into one export). The account hint is only a
      // non-binding suggestion; the per-row currency filter is the real
      // guard, so merging a multi-account-same-currency file into one
      // chosen holding is accepted v1 behavior — no per-account routing is
      // built.
      iban: resolveSoleColumnValue(dataRows, COLUMN.ourIban),
    },
    transactions: dataRows.map(parseDataRow),
  };
};

export const alfaBusinessCsvFormat: StatementFormat = {
  id: 'alfa-business-csv',
  displayName: 'Alfa-Bank business (CSV)',
  detect,
  parse,
};
