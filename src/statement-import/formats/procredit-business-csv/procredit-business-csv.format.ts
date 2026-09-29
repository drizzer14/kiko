// Column layout verified against docs/plans/statement-import.md
// (ProCredit business/FOP) — grounded in OSadovy/uabean's importer facts,
// cross-checked against the REAL fixture bytes (see
// src/statement-import/NOTICE.md for the exact per-line
// facts). No uabean source is reused; this is an independent TypeScript
// implementation. The fixture this format is tested against
// (`__fixtures__/uabean-procredit-business-sample.csv`) IS uabean's own real
// sample — confirmed ANONYMIZED via uabean's own committed `anonymize.py`
// script (EDRPOUs, IBANs, correspondent names, and dates all remapped
// through deterministic counters/offsets, not the real values).
import type { StatementFormat } from '@kiko/statement-import/parser';

import { createColumnarBusinessCsvFormat, FOP_BUSINESS_COLUMN_BASE } from '../business-csv';

// Section C.3: "Detect signature — file content starts with the first 59
// characters of the header line (uabean's own truncation point, chosen to
// match BOTH of its two accepted header variants, which diverge after that
// point)". Verified byte-for-byte against the real fixture's own header
// line — the real fixture carries "variant 1"
// (`Код ID НБУ` as column 2); variant 2 (`Надавач платіжних послуг`) is
// UNVERIFIED against any real fixture bytes, but this 59-char prefix matches
// both.
export const DETECT_PREFIX = 'ЄДРПОУ;Код ID НБУ;Рахунок;Валюта;Дата операції;Код операції';

// 0-based column indices against a `;`-delimited data row (17
// columns, "variant 1" header — the real fixture's own shape). Column 1
// (`nbuCode`, ProCredit's own "Код ID НБУ") is this format's ONE index that
// diverges from Ukrsibbank business's otherwise-identical layout — see
// `FOP_BUSINESS_COLUMN_BASE`'s own doc comment. FOP fields: `ownEdrpou` (the
// account HOLDER's own EDRPOU) and `correspondentEdrpou` (the counterparty's
// EDRPOU) — read only to skip (no
// ParsedTransaction/ParsedAccountHint field exists for it).
export const COLUMN = {
  ...FOP_BUSINESS_COLUMN_BASE,
  nbuCode: 1,
} as const;

// The actual row-parsing logic (currency/amount/date, the unsigned-debit
// negation rule) lives ONCE in `../business-csv` — shared with Ukrsibbank
// business, whose real header differs from this one only in a display label
// at column 1 (`Код ID НБУ` vs `МФО`) and in quoting.
export const procreditBusinessCsvFormat: StatementFormat = createColumnarBusinessCsvFormat({
  id: 'procredit-business-csv',
  displayName: 'ProCredit Bank business (CSV)',
  formatLabel: 'ProCredit business',
  detectSignature: DETECT_PREFIX,
  column: {
    account: COLUMN.account,
    currency: COLUMN.currency,
    operationDate: COLUMN.operationDate,
    debit: COLUMN.debit,
    credit: COLUMN.credit,
    paymentPurpose: COLUMN.paymentPurpose,
  },
});
