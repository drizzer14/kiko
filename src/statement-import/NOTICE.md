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

**One fixture's bytes are reused as-is**:
`src/statement-import/formats/monobank-csv/__fixtures__/uabean-monobank-sample.csv`
is a verbatim copy of uabean's own low-PII sample export,
`tests/importers/monobank/monobank-black-UAH_01-06-23_15-03-59.csv`.
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
