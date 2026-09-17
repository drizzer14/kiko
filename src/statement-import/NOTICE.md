# Third-party notice

Kiko's statement-import feature (`src/statement-import/`) was researched
against [`OSadovy/uabean`](https://github.com/OSadovy/uabean), a set of
Python Beancount bank-statement importers, to record real, verified
per-bank export facts (column layout, encoding, date format, sign
convention) for banks the Kiko project has no real export sample for.

**Nothing from uabean is vendored.** Every `StatementFormat.parse` under
`src/statement-import/formats/` is an independent TypeScript
reimplementation written against Kiko's own `ParsedTransaction`/
`ParsedAccountHint` contract, informed by uabean's column layout,
matcher, and edge-case knowledge — no uabean source (Python or
otherwise) is copied into this repository.

**Two fixtures' bytes are reused as-is**:

- `src/statement-import/formats/monobank-csv/__fixtures__/uabean-monobank-sample.csv`
  is a verbatim copy of uabean's own low-PII sample export,
  `tests/importers/monobank/monobank-black-UAH_01-06-23_15-03-59.csv`.
- `src/statement-import/formats/sensebank-csv/__fixtures__/uabean-sensebank-sample.csv`
  is a verbatim, byte-for-byte copy (cp1251-encoded, NOT re-encoded) of
  uabean's own confirmed-synthetic sample export,
  `tests/importers/sensebank/alfabank-uah.csv` — a placeholder all-1s IBAN
  (`UA111111111111111111111111111`), a test-pattern Visa card number
  (`4111xxxxxxx1111`, the well-known `4111 1111 1111 1111` test-card
  prefix), and year-2000 dates confirm it is not real personal data
  (`docs/plans/statement-import.md` section C.4).
- `src/statement-import/formats/procredit-business-csv/__fixtures__/uabean-procredit-business-sample.csv`
  is a verbatim, byte-for-byte copy (cp1251-encoded, NOT re-encoded) of
  uabean's own sample export, `tests/importers/procreditbank-business/procredit.csv`
  — confirmed ANONYMIZED via uabean's own committed `anonymize.py` script
  (EDRPOUs, IBANs, correspondent names, and dates all remapped through
  deterministic counters/offsets, not the real values;
  `docs/plans/statement-import.md` section C.4).
- `src/statement-import/formats/alfa-business-csv/__fixtures__/uabean-alfa-business-sample.csv`
  is a verbatim, byte-for-byte copy (cp1251-encoded, NOT re-encoded) of
  uabean's own sample export,
  `tests/importers/alfabank_business/ReportAlfa-Bank_20221005_124902.csv` —
  confirmed SYNTHETIC (`XYZ COMPANY`/`JOHN DOE` placeholders, all-1s
  IBANs/EDRPOU, literal `[REDACTED]` markers in description text;
  `docs/plans/statement-import.md` section C.4).

No uabean fixture exists for Ukrsibbank business/FOP CSV; its fixture
(`src/statement-import/formats/ukrsib-business-csv/__fixtures__/synthetic-ukrsib-business-sample.csv`)
is HAND-AUTHORED synthetic data (all-fake account/EDRPOU numbers, "Test
Merchant" descriptions), not credited to uabean.

Because the MIT license's core condition — "The above copyright notice
and this permission notice shall be included in all copies or
substantial portions of the Software" — is triggered by reusing those
fixture bytes even where the parsing code is independently written,
this notice records the credit and reproduces uabean's MIT license text
in full below, for the whole feature rather than only the reused
fixture (the simpler, more conservative reading).

## uabean license

The MIT License (MIT)

Copyright (c) 2023 Oleksii Sadovyi

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
