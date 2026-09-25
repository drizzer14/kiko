// Column layout verified against docs/plans/statement-import.md
// (Ukrsibbank business/FOP) — grounded in OSadovy/uabean's importer facts.
// No uabean source is reused; this is an independent TypeScript
// implementation. **No uabean fixture exists for this format** —
// `__fixtures__/synthetic-ukrsib-business-sample.csv` is HAND-AUTHORED
// synthetic data (all-fake account/EDRPOU numbers, "Test Merchant"
// descriptions), written as real cp1251 bytes, same placeholder-style
// convention the other hand-authored fixtures in this plan use.
import type { StatementFormat } from '../../parser';
import { createColumnarBusinessCsvFormat, FOP_BUSINESS_COLUMN_BASE } from '../business-csv';

// Section C.3: "Detect signature — file content matches the FULL literal
// header line; fields are DOUBLE-QUOTED." **[VERIFY LIVE]** this exact
// glyph against a real export before shipping — this string is transcribed
// verbatim from the plan's own C.3 fact table (itself sourced from uabean's
// importer, not a real Ukrsib export Kiko has seen), including the header's
// OWN trailing `;` (an 18th, always-empty trailing column every data row
// also carries, per this format's hand-authored fixture).
//
// ⚠️ The bank's own header spells "операцiї" (both occurrences, "Дата
// операцiї" and "Код операцiї") with a LATIN small `i` (U+0069), NOT the
// Cyrillic `і` (U+0456) ProCredit/Monobank use — a byte-level detect trap.
// Verified by codepoint, not by eye.
export const FULL_HEADER_LINE =
  '"ЄДРПОУ";"МФО";"Рахунок";"Валюта";"Дата операцiї";"Код операцiї";"МФО банка";"Назва банка";"Рахунок кореспондента";"ЄДРПОУ кореспондента";"Кореспондент";"Номер документа";"Дата документа";"Дебет";"Кредит";"Призначення платежу";"Гривневе покриття";';

// The exact word carrying the Latin-`i` trap, pinned standalone so a test
// can assert its two `i` codepoints independent of `FULL_HEADER_LINE`'s
// surrounding punctuation.
export const OPERATSII_WORD = 'операцiї';

// 0-based column indices against a `;`-delimited, double-quoted data row
// (17 named columns; an 18th always-empty trailing column
// exists too, from the header/rows' shared trailing `;`, but is never read).
// Column 1 (`mfo`, Ukrsib's own "МФО") is this format's ONE index that
// diverges from ProCredit business's otherwise-identical layout — see
// `FOP_BUSINESS_COLUMN_BASE`'s own doc comment. FOP fields: `ownEdrpou` (the
// account HOLDER's own EDRPOU) and `correspondentEdrpou` (the counterparty's
// EDRPOU) — read only to skip, per the plan's EDRPOU disposition (no
// ParsedTransaction/ParsedAccountHint field exists for it).
export const COLUMN = {
  ...FOP_BUSINESS_COLUMN_BASE,
  mfo: 1,
} as const;

// The actual row-parsing logic (currency/amount/date, the unsigned-debit
// negation rule) lives ONCE in `../business-csv` — shared with ProCredit
// business, whose real header differs from this one only in a display label
// at column 1 (`Код ID НБУ` vs `МФО`) and in quoting.
export const ukrsibBusinessCsvFormat: StatementFormat = createColumnarBusinessCsvFormat({
  id: 'ukrsib-business-csv',
  displayName: 'UKRSIBBANK business (CSV)',
  formatLabel: 'Ukrsibbank business',
  detectSignature: FULL_HEADER_LINE,
  column: {
    account: COLUMN.account,
    currency: COLUMN.currency,
    operationDate: COLUMN.operationDate,
    debit: COLUMN.debit,
    credit: COLUMN.credit,
    paymentPurpose: COLUMN.paymentPurpose,
  },
});
