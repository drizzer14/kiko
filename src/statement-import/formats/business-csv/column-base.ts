// The 16 column facts genuinely IDENTICAL — same 0-based index, same
// meaning — across ProCredit business and Ukrsibbank business (section
// C.3): both banks' exports share one column layout, diverging ONLY in
// column 1 (ProCredit's own `Код ID НБУ` vs Ukrsib's own `МФО`). Shared here
// so `procredit-business-csv.format.ts`/`ukrsib-business-csv.format.ts`
// don't each restate the other 16 identical index/key pairs (jscpd flagged
// this duplication). Alfa business has a genuinely different
// 19-column layout and does NOT use this base.
//
// This does NOT blur Ukrsib's own Latin-`i` glyph fact (`операцiї` vs
// `операції`) — that fact lives in the HEADER TEXT
// (`FULL_HEADER_LINE`/`OPERATSII_WORD`, ukrsib-business-csv.format.ts),
// never in this plain 0-based index map, which carries no header text at
// all.
export const FOP_BUSINESS_COLUMN_BASE = {
  ownEdrpou: 0,
  account: 2,
  currency: 3,
  operationDate: 4,
  operationCode: 5,
  bankMfo: 6,
  bankName: 7,
  correspondentAccount: 8,
  correspondentEdrpou: 9,
  correspondent: 10,
  documentNumber: 11,
  documentDate: 12,
  debit: 13,
  credit: 14,
  paymentPurpose: 15,
  hryvniaCoverage: 16,
} as const;
