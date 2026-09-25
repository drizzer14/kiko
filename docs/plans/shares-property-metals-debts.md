# Shares, Property, Metals, and Debts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** First, ship a generic column-mapping statement import (P0 POC) and let the user test it on the device. Then add Property/Майно, Precious metals, Debt/Борг, and Broker/Брокер account kinds, valued through one price-series model, and ship them together in one release (D16).

**Architecture:** P0 adds a pure column-mapping core (`src/statement-import/column-mapping/`) that turns CSV/XLSX rows plus a user mapping into the existing `ParsedStatement` contract. The result goes through the EXISTING import pipeline (currency filter, dedup key, `addManyDedup`, target holding). Saved mappings live in one JSON column on `settings`. P1–P5: a new `price_points` table stores (instrument, day, price) points. Carry-forward lookup uses the `rateTableAt` rule. A priced holding (property item, metal, share) is valued at read time as `quantityAt(day) × priceAt(day)`. Its `lots[]` sit in holding metadata, so no ledger rows are written, the same way bonds work today. A loan is valued as −outstanding. The outstanding amount comes from an annuity/differentiated schedule or from a manual series. Price sources plug into the same table: manual, NBU (metals), EODHD (BYOK). Everything lands on one integration branch.

**Tech Stack:** React Native 0.87 + TypeScript, op-sqlite + Drizzle (`src/db/schema.ts`, `drizzle-kit generate`, custom runner `src/db/run-migrations.ts`), `react-native-keychain`, `fnts`, `ts-pattern`, i18next (`src/i18n/locales/{en,uk}.ts`), `papaparse`, `windows-1251`, `read-excel-file` (all existing), Jest + RNTL, Maestro (`.maestro/`). **No new npm dependency.**

**Spec:** `docs/research/shares-and-assets-feasibility.md` (decision log and rejected options are binding). Read the `kiko-domain`, `kiko-architecture`, `kiko-code-style`, `kiko-design-system`, `kiko-translator`, `kiko-compliance`, `kiko-linter`, and `kiko-charts` skills before each task they touch.

**Task count:** 44 tasks (T1–T44), numbered in build order. P0 = T1–T9, P1 = T10–T16, P2 = T17–T21, P3 = T22–T25, P4 = T26–T33, P5 = T34–T41, wrap-up = T42–T44. No gated tasks remain (see "Deferred until a real account/sample exists").

**Build order:** strictly sequential on one branch, one editor.
1. P0 T1 → T9, ending in a **STOP**: the coordinator deploys the POC to the device, and P1 waits for the user's test report.
2. P1 T10 → T16 (the price-series foundation every later phase uses).
3. P2 T17 → T21, P3 T22 → T25, P4 T26 → T33, P5 T34 → T41, each ending in `make gate`.
4. Wrap-up T42 → T44: docs, whole-branch review, `make verify`, the deep gate, the device checklist.

---

## Round-5 scope decision (user)

No integration ships without a real sample or a real account. The user has only a Monobank account and no broker accounts. So:

- Every existing importer in `src/statement-import/formats/` stays unchanged (monobank-csv, privatbank-xlsx, sensebank-csv, procredit-business-csv, ukrsib-business-csv, alfa-business-csv).
- Broker sync and broker file import are removed from this plan. Brokers stay as a kind + a plain catalog + MANUAL share holdings priced by EODHD BYOK.
- New bank formats without a real file (PUMB XLSX, ProCredit personal `.xls`) are removed. P0's generic column mapping covers any bank the user has a real export from.

## Deferred until a real account/sample exists

History only. Nothing below is built. Each item returns as a planner addendum once the user has a real account or an anonymized real file. The round-4 text of each task is in git history (commit `48f8615`, this file).

| Removed item (round-4 id) | Reason | Returns when |
|---|---|---|
| P6 Trading 212 sync: pins/env (T32), credentials + client (T33), broker statement writer + sync (T34), connect UI (T35) | no account | the user opens a T212 account |
| P7 IBKR Flex: host verification + pins (T36), Flex XML parser + client (T37), sync + connect UI (T38), IBKR Flex XML file import (T39) | no account | the user opens an IBKR account or supplies a real Flex XML |
| P8 Freedom24: spike (T40), sync (T41) | no account | the user opens an account |
| P9 Revolut: gate (T42), CSV format (T43) | no sample | a real anonymized trading-statement CSV |
| PUMB XLSX importer, synthetic fixture (T44) | no real file | a real anonymized PUMB export (P0 column mapping covers it meanwhile) |
| Legacy `.xls` OLE2/BIFF reader (T49) and its LibreOffice/xlwt fixture tooling | only served T50 | a real `.xls` statement exists |
| ProCredit personal `.xls` importer (T50) | no real file | a real anonymized ProCredit personal `.xls` |
| `saxen` 11.1.1 direct dependency (and the fast-xml-parser/xlsx/@e965/xlsx/cfb evaluation) | only served IBKR XML | IBKR returns |
| `plist.sh` `CREDENTIAL_QUERY_PARAM` marker and the IBKR `t` query-param detection | only served IBKR | IBKR returns |
| Hosts `live.trading212.com`, the IBKR Flex host, the Tradernet host; their privacy-policy entries | no sync | the matching sync returns |
| Planner notes N2 (IBKR `GetStatement` host check) and N11 (synced positions have no quantity history) | broker-sync only | the matching sync returns |
| `pricePoints.source` values `trading212`/`ibkr`, `transactions.source` values `trading212`/`ibkr`, `ShareMeta.quoteSource = 'broker'`, `brokerCatalog.connectable` | broker-sync only | the matching sync returns |
| Oschadbank, Raiffeisen, Ukrgasbank, UKRSIBBANK personal dedicated importers | no reliable format (spec §13) | a real anonymized sample; meanwhile P0 column mapping |

## New network hosts

| Host | Used by | Credential | Pinned (≥2 CA SPKI) | Task |
|---|---|---|---|---|
| `eodhd.com` | `src/quotes/eodhd/` | `api_token` query param (BYOK) | **yes** | T37 |
| `bank.gov.ua` (existing host, new paths `statdirectory/exchange?valcode=XAU…`, `depo_securities?json`) | `src/prices/nbu-metals/`, `src/bonds/nbu-register/` | none | no (unchanged, keyless) | T19, T24 |

## Dependencies

None added. P0 reuses `papaparse`, `windows-1251`, and `read-excel-file` (`read-excel-file/browser`), already used by `src/screens/statement-import/statement-import.screen.tsx`. `.xls` stays unsupported: `read-excel-file` throws `XLS_FILE_NOT_SUPPORTED` for it, and P0 shows a plain "save as .xlsx or CSV" message.

## Decisions carried from round 4

1. **Monobank metals: NO.** `monobank` stays off the metal allow-list.
2. **Loan payments:** automatic linking with high confidence, a visible "Linked automatically" state with Undo, manual link as the fallback (T29–T32). Design in spec §5.4.
3. **EODHD licence: closed.** BYOK, the same model as the Monobank token and Binance keys (spec D22).
4. **Oschadbank, Raiffeisen, Ukrgasbank:** no dedicated importer. Round 4 gave them a "Manual holdings only" caption. Round 5 supersedes that: P0 makes column-mapping import available for every bank account, so their caption becomes "Import with column mapping" (T22).
5. Round-4 decisions 2 (PUMB), 3 (ProCredit `.xls`), and 5 (`saxen`) are superseded by round 5 (see "Deferred").

## Open questions / spec issues found while planning

- **N1. EODHD `api_token` is a query-param credential.** Spec §3.3 calls it out. T34 widens `plist.sh` to detect it. (The IBKR `t` part is deferred.)
- **N4. Spec contradiction, §3.4 vs §7.2.** §3.4 allows `share` under `bank`; §7.2 puts Revolut in the broker catalog, and no catalog bank sells shares. Default: `share` only under `broker`.
- **N5. Spec build-order contradiction, P2 vs P3.** The metal allow-list names PUMB, Oschadbank, and Ukrgasbank, but they are added to the catalog only in P3. Default: T17 allow-lists `privatbank` only, and T22 sets `sellsMetals` on the new banks.
- **N6. Catalog banks with no dedicated format.** `BankCatalogEntry.statementFormatId` becomes optional (T22). Their import runs through P0 column mapping.
- **N7. Export and import (`src/data-transfer/`).** `DataSnapshot` must list every table, and the credential export lists every Keychain secret. Default: add `pricePoints` and `bondRegister` to the snapshot; add the EODHD key behind the existing "include saved credentials" toggle. `settings.statementMappings` rides in the existing `settings` row. Old `.kiko` files without the new keys still restore.
- **N8. EODHD daily limit for paid keys.** Default: read `dailyRateLimit` from EODHD `/api/user` **[VERIFY LIVE]** when the key is saved; fall back to 20.
- **N9. Metal history backfill cost.** T19 starts with a live probe of the NBU range endpoint; the fallback is capped sampling.
- **N10. Two loan-schedule rules the spec leaves open.** (a) Correction point: outstanding = the correction value minus the scheduled principal due after the correction day. (b) A linked payment maps to the installment whose due date is nearest to the payment's local day; the interest counted is `min(installment interest, |payment|)`. Pinned in T26 and T30 tests.
- **N12. The kind picker grows to 7 kinds.** T15 converts the `ChipRow` to a select sheet.
- **N13. `accounts.bankId` is reused as the broker identity for `kind = 'broker'`.** No migration. Column comment and kiko-domain updated in T35.
- **N14 (P0). Mapping has no MCC role.** Column-mapped rows carry no `mcc`, so they import uncategorized. The dedup key does not use `mcc`, so a file imported once through its dedicated importer and once through column mapping still dedupes.
- **N15 (P0). CSV delimiter.** Not in the user's control list, but a CSV needs it: detected with `papaparse`, shown as a changeable control (`,` `;` Tab).
- **N16 (P0). Currency words.** A currency column resolves ISO codes plus the existing PrivatBank word map (`CURRENCY_WORD_MAP`, imported, not copied). Any other value is a per-row error.

## Global Constraints

- **Branch and editor.** The coordinator creates `feat/assets-debts` from the current HEAD of `shares-assets-research` **in this worktree** (`/Users/drizzer14/orca/workspaces/pff-ios/shares-assets-research`). No new Orca worktree. One editor at a time. Tasks run in the order below. One release (D16). Never `git checkout`/`restore`/`stash`/`clean` in this worktree.
- **Guideline 5.6.** No `@env` or build flag controls what a user sees. No "coming soon" entry. No demo, seed, or fake data in `src/`. The column-mapping import is a complete, always-visible feature. A catalog field such as `sellsMetals` is always-rendered data, never a visibility gate.
- **Money.** Amounts are integer minor units. Prices, quantities, and purity are scaled decimal **strings**; multiply them only through the T10 BigInt helper. API JSON numbers are converted once, at the boundary, through `decimalFromJsonNumber`. P0 amounts go through `Money.fromMajor`, the same as every existing importer (parity).
- **Writes.** Every write goes through `write()` / `db.transaction()` (`src/db/client.ts`).
- **Credentials.** Keychain only, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, no `accessControl` (the pattern in `src/monobank/token/token.ts`). Never in `.env`, SQLite, metadata, or logs.
- **Pinning.** Every credential host goes in `NSPinnedDomains` in `ios/Kiko/Info.plist` with ≥2 CA SPKI pins, plus a row in the `docs/security/README.md` host table. The base URL comes from `@env` (`.env.example`, the tracked `.env.test`, `src/env.d.ts`).
- **i18n.** Every string is added to `en.ts` and `uk.ts` together (`src/i18n/locales/en.uk.parity.test.ts`). The uk apostrophe is ’ (U+2019). The uk name is "Кіко". **The user reviews every new or changed en/uk key before any deploy that ships it** (T9 for P0, T44 for the rest).
- **Trademarks.** Broker and provider names are plain text. No logos. No partnership wording.
- **Migrations.** Additive only. `npx drizzle-kit generate --name <slug>`, then re-check `drizzle/migrations/migrations.js` and run `npx biome check --write` over the generated artifacts. Data-only migrations are hand-authored, have no snapshot, and get a journal entry. Numbers below assume `0034` is next; use the next free number at implementation time.
- **Skills and docs change in the same task as the code they describe.** A `(scribe)` step is done by the scribe role before the task closes.
- **Checks.** Per task: the scoped `npx jest <paths>` red/green cycle, then `make typecheck` and `make lint`. Per phase: `make gate`. End of P0 and end of the line: `make verify` (lint → full jest → `check:all`) until green. Then, separately, `KIKO_MUTATION_BASE=next make deep` (T44). Never weaken a check.
- **Commits.** Commit each task on `feat/assets-debts` after its checks pass (Conventional Commits).

## Review Focus

1. **P0 number cells vs the decimal separator.** An XLSX number cell (`typeof === 'number'`) is used as-is; only a string cell goes through the separator rule. Otherwise `123.45` read with `,` becomes `12345`. Test in T3.
2. **P0 dedup parity.** For the same file row, column mapping must produce the same `(currency, amountMinorUnits, timeSeconds, description)` as the dedicated importer, so both paths produce the same dedup key and a re-import writes 0 rows. Wall-clock dates are read as UTC (the `parseDateTimeSeconds` convention), never device-local. Tests in T4.
3. **P0 auto-applied mapping never imports silently.** A saved mapping pre-fills and shows the parsed preview; the user still taps Import. Test in T7.
4. **Local day vs UTC day key.** A net-worth bucket at Kyiv local midnight must read that local date's price. `priceAt` maps an instant to `Date.UTC(localY, localM, localD)` before lookup. Test in T12.
5. **A priced holding with no price point yet.** Its value falls back to the cost basis of its lots, never to 0, and the UI shows "No price yet". Tests in T14 and T36.
6. **Quote currency ≠ holding currency** (LSE `GBX`). GBX is divided by 100 and stored as GBP at ingest; any other mismatch is rejected. Test in T40.
7. **A loan holding is deleted while payments are linked to it.** Its links are cleared in the same transaction; a dangling `loanHoldingId` counts as normal spending. Tests in T29 and T30.
8. **Selling more than is held.** The lot form rejects a sell delta larger than `quantityAt(sellDay)`; `quantityAt` never returns a negative value. Tests in T13 and T18.

---

## P0 — Generic column-mapping statement import (POC)

Flow: Account detail → Import statement → pick CSV or XLSX → (dedicated format matched: existing preview, plus a "Map columns manually" button) / (no match or bank mismatch: saved mapping auto-applied if its header fingerprint matches, else the mapping screen) → raw preview (first 10 rows) → user picks header row, encoding (CSV), delimiter (CSV), decimal separator, date format, and the columns (date; amount OR debit + credit; description; optional currency column else a fixed currency; optional counterparty) → parsed preview with per-row errors → choose holding → Import through the existing pipeline → mapping saved on success.

### Task T1: Split `importStatement` into detect + `importParsedStatement` (developer)

**Files:** Modify `src/statement-import/import-statement/import-statement.ts` (+ `import-statement.test.ts`, `index.ts`) and `src/statement-import/parser/parser.ts` (add `type ParsedStatementSource = StatementFormatId | 'column-mapping'`; `ParsedStatement.formatId: ParsedStatementSource`; `statementFormatIds` unchanged).
**Produces:** `importParsedStatement(parsed: ParsedStatement, holdingId: string): Promise<ImportResult>` (the currency filter, occurrence map, `mapParsedTransaction`, `addManyDedup` — moved, not rewritten). `importStatement` = `detectFormat` + `parse` + `importParsedStatement`.

- [ ] Failing test: `importParsedStatement` on a hand-built `ParsedStatement` with `formatId: 'column-mapping'` writes rows with `source: 'import'` and returns `formatId: 'column-mapping'`; a wrong-currency row is counted in `skippedWrongCurrency`. Existing `importStatement` tests stay green unchanged.
- [ ] Implement. Run `npx jest src/statement-import`, then `make typecheck && make lint`.

### Task T2: Move the file-read helpers out of the import screen (developer)

**Files:** Create `src/statement-import/read-statement-file/{read-statement-file.ts,read-statement-file.test.ts,index.ts}`. Modify `src/screens/statement-import/statement-import.screen.tsx` (import the helpers; behavior unchanged).
**Produces:** the screen's `decodeBase64ToBytes`, `decodeUtf8Bytes`, `readSheetRowsSafely`, `fileNameOf`, `isXlsxFile` moved verbatim (no rewrite, no switch to `src/data-transfer/base64`), plus `isLegacyXlsFile(fileName)` and `decodeStatementText(base64, encoding: 'utf-8' | 'windows-1251'): string`.

- [ ] Failing tests: the Monobank fixture's bytes (base64) decode to the same text as `readFileSync(..., 'utf-8')`; the Sensebank fixture decodes through `windows-1251` to text starting with `SENSEBANK_PREAMBLE`; `isLegacyXlsFile('a.XLS')` is true and `'a.xlsx'` false.
- [ ] Implement. Run `npx jest src/statement-import/read-statement-file src/screens/statement-import`, then `make typecheck && make lint`. `make dup` must not flag the moved code.

### Task T3: Column-mapping core (developer)

**Files:** Create `src/statement-import/column-mapping/` with `table-rows.ts`, `date-formats.ts`, `amount.ts`, `apply-column-mapping.ts`, `index.ts`, each with a `.test.ts`. Import `CURRENCY_WORD_MAP` from `src/statement-import/formats/privatbank-xlsx` (already exported); do not copy it.
**Produces:**
- `type TableCell = string | number`; `readTableRows(input: StatementFormatInput, delimiter?: ',' | ';' | '\t'): { rows: TableCell[][]; delimiter }` (CSV through `Papa.parse` with the given or detected delimiter, `skipEmptyLines`; `sheetRows` keep numbers as numbers; a `Date` cell → `YYYY-MM-DD HH:MM:SS` from its UTC parts; `null`/boolean → string).
- `guessHeaderRowIndex(rows): number` (the first of the first 10 rows with the most non-empty cells).
- `dateFormatIds = ['DD.MM.YYYY HH:MM:SS','DD.MM.YYYY HH:MM','DD.MM.YYYY','DD.MM.YY HH:MM','YYYY-MM-DD HH:MM:SS','YYYY-MM-DD','MM/DD/YYYY'] as const`; `parseDateWithFormat(raw, id): number | undefined` (UTC wall-clock seconds, the `parseDateTimeSeconds` convention; two-digit years → 20YY as in Sensebank).
- `parseAmountCell(cell: TableCell, separator: ',' | '.'): number` (number cell as-is; string: strip spaces/NBSP, U+2212 → `-`, drop the other separator, separator → `.`; `NaN` when not a finite number).
- `type ColumnMapping = { headerRowIndex; delimiter?; encoding?: 'utf-8' | 'windows-1251'; decimalSeparator: ',' | '.'; dateColumn: number; dateFormat: DateFormatId; amount: { mode: 'single'; column } | { mode: 'debitCredit'; debitColumn; creditColumn }; descriptionColumn: number; currency: { mode: 'column'; column } | { mode: 'fixed'; currency: Currency }; counterpartyColumn?: number }`.
- `type ColumnMappingRowError = { rowNumber: number; reason: 'date' | 'amount' | 'debitAndCredit' | 'currency'; value: string }`.
- `applyColumnMapping(rows, mapping): { statement: ParsedStatement; rowErrors: ColumnMappingRowError[] }` — rows after `headerRowIndex`; a row whose mapped cells are all empty is skipped silently; debit → `-abs`, credit → `+abs`, both filled → `debitAndCredit` error; currency column: ISO code or a `CURRENCY_WORD_MAP` word; counterparty → `counterIban` when IBAN-shaped (`/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/`), else `comment`; `formatId: 'column-mapping'`; `account.currency` = the first resolved row's currency or the fixed currency.

- [ ] Failing tests: each date preset parses one sample and rejects a mismatch; **Review Focus 1**: number cell `123.45` with separator `,` → 123.45, string `"1 234,56"` with `,` → 1234.56, `"−150,00"` → −150; a `Date` cell reads its UTC parts; debit `"150.00"` (unsigned) and debit `"-150,00"` (signed) both give −150; both-sides row → `debitAndCredit` error; `"грн"` → UAH, `"фунт"` → `currency` error; a blank trailing row is skipped with no error; `rowNumber` is the 1-based file row.
- [ ] Implement. Run `npx jest src/statement-import/column-mapping`, then `make typecheck && make lint`.

### Task T4: Parity tests on the real fixtures (developer)

**Files:** Create `src/statement-import/column-mapping/parity.test.ts`. Reuse `src/statement-import/formats/format-test-fixtures.ts` (`monobankFixtureInput`, `sensebankFixtureInput`, `procreditBusinessFixtureInput`) and load `src/statement-import/formats/privatbank-xlsx/__fixtures__/synthetic-privatbank-sample.xlsx` the way `privatbank-xlsx.format.test.ts` does. No new fixture, no invented format.

- [ ] One test per file: build the user mapping a person would pick from that file's header row, run `readTableRows` + `applyColumnMapping`, and assert `pick(currency, amountMinorUnits, timeSeconds, description)` of every transaction equals the dedicated importer's result for the same input, in the same order.
  - Monobank CSV: `,` delimiter, header row 0, date col 0 `DD.MM.YYYY HH:MM:SS`, amount col 3 single, `.`, description col 1, fixed UAH.
  - Sensebank CSV (cp1251): `;`, header row 5, date col 0 `DD.MM.YY HH:MM`, debit col 6 / credit col 7, `,`, description col 3, fixed UAH. Also assert exactly 2 `date` row errors (the second section line and its repeated header).
  - PrivatBank XLSX: header row 1, date col 0, amount col 4 single, currency column col 5 (words), description col 3. Also assert the row-error count equals the dedicated `unresolvedRows` length.
  - ProCredit business CSV (cp1251): `;`, header row 0, date col 4, debit col 13 / credit col 14, `.`, currency column col 3, description col 15.
- [ ] **Review Focus 2**: for the Monobank fixture, `computeDedupKey` over both results gives equal keys, and `importParsedStatement` of the mapped result after `importStatement` of the same file into the same holding imports 0 rows (in-memory DB, the `import-statement.test.ts` setup).
- [ ] Run `npx jest src/statement-import/column-mapping`. Any failure is fixed in the T3 core, never by editing a dedicated format.

### Task T5: Saved mappings — storage, fingerprint, lookup (developer)

**Storage choice: one nullable JSON column `settings.statementMappings`.** The single `settings` row already rides in the `.kiko` snapshot and restore (`src/data-transfer/snapshot/restore-snapshot.ts`), `settings.trendFilter` is the precedent for a JSON setting, and it needs one additive migration and two repo methods. A new table would add a repo, a snapshot key, and restore code for a map with a handful of entries.

**Files:** Modify `src/db/schema.ts` (`statementMappings: text('statement_mappings', { mode: 'json' }).$type<Record<string, SavedColumnMapping>>()`, with a comment). Generate `drizzle/migrations/0034_add_statement_mappings.sql` (+ snapshot, journal, `migrations.js`) and create `src/db/schema.statement-mappings.test.ts` (pattern: `src/db/schema.change-group.test.ts`). Modify `src/settings/settings.repo.ts` (+ `settings.repo.test.ts`: `saveStatementMapping(key, mapping)` does read-modify-write inside one `write()`). Create `src/statement-import/column-mapping/saved-mapping.ts` (+test). Modify `src/data-transfer/round-trip.test.ts`.
**Produces:** `type SavedColumnMapping = ColumnMapping & { fingerprint: string; savedAt: number }`; `headerFingerprint(row: TableCell[]): string` (trimmed cell text joined by U+241F); `mappingKeyFor(bankId: string | null | undefined, fingerprint): string` (`bank:<bankId>` for a catalog `BankId`, else `header:<fingerprint>`); `findSavedMapping(saved, bankId, rows): { mapping: SavedColumnMapping; exact: boolean } | undefined` (the bank key first; `exact` only when `rows[mapping.headerRowIndex]` has the saved fingerprint; for "Other", a `header:` entry whose fingerprint matches).

- [ ] Failing tests: the migration is registered; the column has a production reader (`src/db/settings-columns.test.ts` stays green); saving two keys keeps both; the same key overwrites; a bank key with a different header returns `exact: false` (pre-fill only); an "Other" file finds its `header:` entry; a snapshot without `statementMappings` restores with `null`.
- [ ] Implement. Run `npx jest src/db src/settings src/statement-import/column-mapping src/data-transfer`, then `make typecheck && make lint`.

### Task T6: Column-mapping screen (developer; designer reviews layout)

**Files:** Create `src/screens/column-mapping/` (`column-mapping.screen.tsx`, `.styles.ts`, `.screen.test.tsx`), `src/screens/column-mapping/raw-preview/` (tap a row to set the header row; horizontal scroll; first 10 rows), and `src/screens/column-mapping/column-select-field/` (a `FieldTrigger` + `BottomSheet` + `SelectableRow` list of the header row's cells, plus "Not used" for optional roles). Move `useTargetHoldingOptions` and `previewStats` out of `statement-import.screen.tsx` into `src/screens/statement-import/use-target-holding-options/` and `src/screens/statement-import/preview-stats/` (each + test, `previewStats` takes a `ParsedStatement` and a display name) so both screens share them. Modify `src/navigation/types.d.ts` + `src/navigation/accounts.stack.tsx` (`ColumnMapping: { filePath: string; accountId: string }`), `src/i18n/locales/en.ts` / `uk.ts` (keys below).
**Consumes:** T1 `importParsedStatement`, T2 readers, T3 core, T5 storage; `TargetHoldingSheet`, `ImportOutcome`, `OptionPills`, `Button`, `Text`, `Box`, `Screen` from existing code.

- [ ] Behavior: reads the file once (T2); `.xls` → `columnMapping.xlsNotSupported` and nothing else; CSV shows encoding + delimiter `OptionPills`; decimal separator `OptionPills`; date format select; amount mode `OptionPills` (single / debit + credit); currency: column select or a fixed-currency select (default = the account's first holding currency, else `UAH`); the parsed preview (count, date span, currencies via `previewStats`) and the row-error list (first 20, then a count) update on every change; Import is always enabled; pressing it validates the mapping, shows the error under each invalid field, and scrolls to the first one; on load, `findSavedMapping` pre-fills (`exact` → a `columnMapping.savedApplied` caption); on import success, `saveStatementMapping(mappingKeyFor(account.bankId, fingerprint), …)`.
- [ ] Failing RNTL tests: rendering with the Monobank fixture and the T4 mapping shows 4 transactions; switching the separator changes the preview; a Sensebank file with UTF-8 selected shows row errors, and switching to Windows-1251 clears them; Import is disabled with no amount column; import calls `importParsedStatement` and then saves the mapping under `bank:<bankId>`; a pre-filled exact mapping shows the caption and still needs the Import tap (**Review Focus 3**).
- [ ] i18n (en / uk), namespace `columnMapping`: `title` "Map columns" / "Зіставлення стовпців"; `rawPreview` "Tap the row with the column names" / "Торкніться рядка з назвами стовпців"; `encoding` "Encoding" / "Кодування"; `delimiter` "Separator" / "Роздільник"; `delimiterTab` "Tab" / "Табуляція"; `decimalSeparator` "Decimal separator" / "Десятковий роздільник"; `dateFormat` "Date format" / "Формат дати"; `dateColumn` "Date" / "Дата"; `amountModeSingle` "One amount column" / "Один стовпець суми"; `amountModeDebitCredit` "Debit and credit columns" / "Стовпці дебету й кредиту"; `amountColumn` "Amount" / "Сума"; `debitColumn` "Debit (money out)" / "Дебет (списання)"; `creditColumn` "Credit (money in)" / "Кредит (зарахування)"; `descriptionColumn` "Description" / "Опис"; `currencyColumn` "Currency column" / "Стовпець валюти"; `fixedCurrency` "Currency for all rows" / "Валюта для всіх рядків"; `counterpartyColumn` "Counterparty (optional)" / "Контрагент (необов’язково)"; `notUsed` "Not used" / "Не використовується"; `result` "Result" / "Результат"; `incomplete` "Choose the date, amount, and description columns" / "Оберіть стовпці дати, суми та опису"; `rowError.date` "Row {{row}}: the date does not match the format" / "Рядок {{row}}: дата не відповідає формату"; `rowError.amount` "Row {{row}}: the amount is not a number" / "Рядок {{row}}: сума не є числом"; `rowError.debitAndCredit` "Row {{row}}: both debit and credit are filled" / "Рядок {{row}}: заповнено і дебет, і кредит"; `rowError.currency` "Row {{row}}: unknown currency “{{value}}”" / "Рядок {{row}}: невідома валюта «{{value}}»"; `rowsSkipped_{one,few,many,other}` "{{count}} row will be skipped" (en plural) / "{{count}} рядок буде пропущено" · "{{count}} рядки буде пропущено" · "{{count}} рядків буде пропущено" · "{{count}} рядка буде пропущено"; `savedApplied` "Your saved column mapping is applied. Check the result before importing." / "Застосовано ваше збережене зіставлення стовпців. Перевірте результат перед імпортом."; `xlsNotSupported` "Old .xls files are not supported. Save the file as .xlsx or CSV and try again." / "Старі файли .xls не підтримуються. Збережіть файл як .xlsx або CSV і спробуйте ще раз.".
- [ ] Implement. Run `npx jest src/screens/column-mapping src/screens/statement-import src/i18n`, then `make typecheck && make lint`.

### Task T7: Entry points (developer)

**Files:** Modify `src/screens/statement-import/statement-import.screen.tsx` (+ `.screen.test.tsx`): a "Map columns manually" `Button` (`statementImport.mapColumnsManually` "Map columns manually" / "Зіставити стовпці вручну") under a recognized preview AND in the unrecognized and bank-mismatch states (not the unreadable-read state); when no format matched (or bank mismatch) and `findSavedMapping` returns an `exact` match, `navigation.replace('ColumnMapping', …)` at once. Modify `src/screens/account-detail/account-detail.screen.tsx` (+ `.screen.test.tsx`): `canImportStatement` becomes `isBankAccount` (every bank account, with or without a known format); `expectedFormatId` stays as today. Update `en.ts`/`uk.ts`.

- [ ] Failing tests: a bank account with `bankId: null` shows "Import statement"; a cash account does not; an unrecognized file shows "Map columns manually" and it navigates with `{ filePath, accountId }`; a Monobank file in a Monobank account shows the dedicated preview AND the button; a bank-mismatch file with an exact saved mapping replaces the route to `ColumnMapping` (**Review Focus 3**: that screen still requires the Import tap, tested in T6).
- [ ] Implement. Run `npx jest src/screens/statement-import src/screens/account-detail`, then `make typecheck && make lint`.

### Task T8: Maestro flow + skills (qa, scribe)

**Files:** Create `.maestro/statement-import-column-mapping.yaml`. Modify `.claude/skills/kiko-architecture/SKILL.md` (a "Statement import — column mapping" section: the core module, `importParsedStatement`, `settings.statementMappings` keys `bank:`/`header:`, wall-clock-as-UTC) and `.claude/skills/kiko-domain/SKILL.md` (the `bankId` paragraph: every bank account can import through column mapping; dedicated formats still win when they match).

- [ ] (qa) Flow, with the same prerequisite and "authored without a live run" header as `.maestro/statement-import.yaml`: pick the Monobank fixture → dedicated preview → tap "Map columns manually" → set date, amount, and description via testIDs, pick UAH → assert the result count is 4 → choose the holding → Import → assert the outcome text.
- [ ] (scribe) Edit both skills. Run `make lint`.

### Task T9: P0 phase gate and STOP for device testing (developer, coordinator, ops, user)

- [ ] **User reviews the new en/uk keys** (T6, T7): a diff of `src/i18n/locales/{en,uk}.ts` against `next`.
- [ ] `make gate`, then `make verify` (lint → full jest → `check:all`). Re-run until green. Fix root causes.
- [ ] **STOP. The coordinator deploys the POC to the device (`make deploy`, ops) for user testing before P1 starts.** P1 starts only after the user reports on the checklist below; findings become fix tasks in P0.
- [ ] Device checklist (P0):

| Flow | How |
|---|---|
| Monobank CSV, dedicated vs mapped | Export a real CSV from the Monobank app. Create a throwaway bank account "Import test" (bank Monobank, not connected) with a UAH holding. Import via the dedicated preview, then re-import the same file via "Map columns manually": the preview count matches, and the import reports 0 new rows. (Do not import into the synced Monobank holding: synced rows use different external ids, so an import would duplicate them.) |
| Saved mapping, one step | In a throwaway account with bank Sensebank, import the same Monobank CSV → bank mismatch → map columns → import. Import it again: the mapping screen opens pre-filled with the "saved mapping" caption and the preview; Import still needs a tap. |
| PrivatBank-style XLSX | AirDrop `synthetic-privatbank-sample.xlsx` to Files. In an account with no bank picked, use "Map columns manually": header row 2, currency column = the card-currency column; UAH/USD rows split; the unknown-currency row shows as a row error. |
| Encoding | The Sensebank sample (cp1251) shows garbled headers in UTF-8 and correct Cyrillic after switching to Windows-1251. |
| `.xls` | Any `.xls` file shows the "save as .xlsx or CSV" message. |
| Cleanup | Delete the throwaway accounts. |

---

## P1 — Price-series foundation + Property / Майно

### Task T10: Decimal helper (developer)

**Files:** Create `src/currency/decimal/{decimal.ts,decimal.test.ts,index.ts}`.
**Produces:** `normalizeDecimal(input: string): string | null` (trim, comma → dot, strip spaces/NBSP, no exponent, no sign); `addDecimal(a, b)` and `subDecimal(a, b)` (signed results allowed); `compareDecimal(a, b): -1 | 0 | 1`; `shiftDecimal(value, places)`; `decimalFromJsonNumber(value: number): string | null` (expands the exponent form, rejects non-finite values); `multiplyToMinorUnits(factors: readonly string[], currency: Currency, divideBy?: string): number` (BigInt, round half away from zero, uses `currencyScale`).

- [ ] Failing tests: `"1 234,56"` → `"1234.56"`; `"abc"` and `"1e5"` → null; `multiplyToMinorUnits(['31.1','0.9999','193295.79'], 'UAH', '31.1034768')` equals the hand-computed minor units; half-up at .005; BTC scale 8; `decimalFromJsonNumber(1e-7)` → `"0.0000001"`; `shiftDecimal('12345', -2)` → `"123.45"`.
- [ ] Run `npx jest src/currency/decimal` (FAIL), implement, re-run (PASS). Then `make typecheck && make lint`.

### Task T11: `price_points` table, migration, repo, export (developer)

**Files:** Modify `src/db/schema.ts` (new `pricePoints` table: `instrument` text, `day` int (UTC-midnight ms), `price` text, `currency` text enum `currencyOptions`, `source` text enum `['manual','nbu','eodhd']`, unique `(instrument, day)`). Generate `drizzle/migrations/0035_add_price_points.sql` + snapshot, journal, `migrations.js`. Create `src/db/schema.price-points.test.ts` and `src/prices/price-points-repo/{price-points.repo.ts,.test.ts,index.ts}`. Modify `src/data-transfer/snapshot/{data-snapshot.d.ts,read-snapshot.ts,restore-snapshot.ts}` and their tests.
**Produces:** `PricePointRow`; `pricePointsRepo = { allQuery(), upsertMany(rows), removeInstrument(instrument) }` (chunked upsert like `src/rates/rate-history-repo/rate-history.repo.ts`).

- [ ] Failing tests: the migration creates `price_points` and the unique index and is registered (pattern: `src/db/schema.change-group.test.ts`); `upsertMany` overwrites price and source on `(instrument, day)`; a snapshot round-trip keeps price points; a snapshot **without** `pricePoints` restores with an empty table.
- [ ] Implement. Run `npx jest src/db src/prices src/data-transfer`, then `make typecheck && make lint`.

### Task T12: PriceBook lookup + hook (developer)

**Files:** Create `src/prices/instrument/instrument.ts`, `src/prices/price-book/price-book.ts`, and `src/prices/use-price-book/use-price-book.ts` (each with a test and `index.ts`).
**Produces:** `shareInstrument(symbol)`, `metalInstrument(metal)`, `holdingInstrument(holdingId)` (`share:…` / `metal:…` / `holding:…`); `type PriceBook = ReadonlyMap<string, readonly PricePointRow[]>` (day ascending); `EMPTY_PRICE_BOOK`; `buildPriceBook(rows)`; `dayKeyOf(instant)` (local calendar date → UTC midnight); `priceAt(book, instrument, instant)` (nearest point at or before the day, else the earliest point, as in `earliestRateTable`); `latestPoint(book, instrument)`; `usePriceBook()` (`useLiveQuery(pricePointsRepo.allQuery(), ['price_points'])` + `useMemo`).

- [ ] Failing tests: carry-forward across a gap; the earliest point before the first row; an unknown instrument → `undefined`; **Review Focus 4**: an instant at Kyiv local midnight on 2026-03-30 (DST) resolves to the 2026-03-30 point (the `local(...)` helper style from `src/holdings/interest/interest.test.ts`).
- [ ] Implement. Run `npx jest src/prices`, then `make typecheck && make lint`.

### Task T13: Property kind, `property_item` type, lots, ledgerless predicate (developer)

**Files:** Modify `src/db/schema.ts` (`accounts.kind` += `'property'`; `holdings.type` += `'property_item'`; TS-only, no migration), `src/holdings/holding-type/holding-type.ts` (+test), `src/holdings/entity-symbols/entity-symbols.ts`, `src/holdings/entity-colors/entity-colors.ts`, `src/holdings/exchange-destination/exchange-destination.ts` (exhaustive arms; `property_item` excluded), `src/screens/statistics/bar-chart/bar-chart.component.tsx`, `src/screens/forms/transaction-form/transaction-form.screen.tsx` (`isTransactionEligibleType` uses the new predicate). For the per-type descriptor, form, and detail-spec sites, follow kiko-domain's "Adding a holding type" checklist (`.claude/skills/kiko-domain/SKILL.md`): `src/holdings/holding-descriptor/property-item/` + `holding-descriptors.ts`; `src/screens/forms/holding-form/property/` + `HoldingFormScreen`'s `forms` record and `match` arm; `src/screens/holding-detail/holding-detail-spec/` (`holdingDetailSpecs`). Create `src/holdings/lots/{lots.ts,lots.test.ts,index.ts}`. Modify `src/holdings/holding-metadata/holding-metadata.ts` (+test).
**Produces:** `type Lot = { day: number; quantityDelta: string; costMinorUnits: number }`; `quantityAt(lots, instant)` (never below `"0"`); `costBasisMinorAt(lots, instant)`; `asLots(value)`; `type PropertyCategory = 'real_estate'|'vehicle'|'valuable'|'loan_given'|'business_share'|'other'`; `PropertyMeta = { category; lots }`; `asPropertyMeta`; `isLedgerlessHoldingType(type)` (true for `term_deposit`, `bond`, `property_item`; T17, T26, and T35 extend it). `holdingTypesForAccountKind.property = ['property_item']`.

- [ ] Failing tests: `quantityAt` sums deltas up to the local day; **Review Focus 8**: a sell delta larger than the held quantity clamps to `"0"`, and `asLots` rejects a non-decimal `quantityDelta`; `asPropertyMeta` rejects an unknown category; `creatableHoldingTypesForAccount('property', false)` → `['property_item']`; `isTransactionEligibleType('property_item')` is false; exchange predicates stay exhaustive.
- [ ] Implement. Run `npx jest src/holdings src/screens/forms/transaction-form src/screens/holding-detail`, then `make typecheck && make lint`.

### Task T14: Priced valuation + thread the PriceBook through every reader (developer, scribe)

**Files:** Create `src/holdings/priced-value/{priced-value.ts,.test.ts,index.ts}`. Modify `src/holdings/holding-value/holding-value.ts` (third parameter `book: PriceBook = EMPTY_PRICE_BOOK`; `ValuableHolding` gains `'id'`), `src/statistics/holding-value-at.ts`, `src/statistics/net-worth-series/net-worth-series.ts`, `src/rates/conversion/conversion.ts`, `src/rates/net-worth-view/net-worth-view.ts`, `src/rates/currency-totals/currency-totals.ts`, `src/statistics/type-breakdown/type-breakdown.ts`, `src/statistics/account-contribution/account-contribution.ts`, `src/holdings/derived-entries/derived-entries.ts`, and the screens `src/screens/home/home.screen.tsx`, `src/screens/accounts/accounts.screen.tsx`, `src/screens/account-detail/account-detail.screen.tsx`, `src/screens/account-detail/holding-card/holding-card.component.tsx`, `src/screens/holding-detail/holding-detail.screen.tsx`, `src/screens/statistics/statistics.screen.tsx` (each calls `usePriceBook()`), plus their tests.
**Consumes:** T10, T12, T13. **Produces:** `pricedHoldingTypes`, `isPricedHoldingType(type)`, `pricedValueMinor(holding, book, instant): number | null` (`null` = no price). For a priced type, `holdingValueBreakdown` returns `gross = net = value`, `principalOrCost = costBasis`; `null` → cost basis. `holdingValueAt` uses the breakdown for ledgerless types.

- [ ] Failing tests: a property with a 2024 point of 20,000 and a 2026 point of 16,000 is valued at 20,000 between them and 16,000 after; **Review Focus 5**: no point → value = cost basis; the property net-worth series is flat with no ledger rows; existing bond, deposit, and card tests stay green (default `EMPTY_PRICE_BOOK`).
- [ ] Implement. Run `npx jest src/holdings src/statistics src/rates src/screens`, then `make typecheck && make lint`.
- [ ] (scribe) kiko-domain: a "Price series and priced holdings" section. kiko-architecture "Price data": `price_points` as the non-currency price store.

### Task T15: Account-kind select sheet with subtitles (designer)

**Files:** Create `src/screens/forms/account-kind-field/` (`.component.tsx`, `.props.d.ts`, `.styles.ts`, `.component.test.tsx`, `index.ts`), from `BottomSheet` + `SelectableRow` (the `bank-type-field` shape). Modify `src/screens/forms/account-form/account-form.screen.tsx` (replace the kind `ChipRow`), `en.ts`/`uk.ts` (`forms.account.kindSubtitle.{bank,cash,crypto,property}`; property: en "Real estate, car, valuables, money you lent", uk "Нерухомість, авто, цінності, позики іншим"), and `.claude/skills/kiko-design-system/SKILL.md` (a component-set entry).

- [ ] Failing RNTL test: the sheet lists every `accounts.kind` with label and subtitle; selecting one reports it; disabled in edit mode and once `accountRowStarted` is true.
- [ ] Implement. Run `npx jest src/screens/forms`, then `make typecheck && make lint`.

### Task T16: Property form section, "Update value", "value as of" (developer)

**Files:** Create `src/screens/forms/holding-form/property-section/` and `src/screens/forms/price-point-form/price-point-form.screen.tsx` (+test; date (default today) and value; writes a `manual` point on `holdingInstrument(id)`). Modify `src/screens/forms/holding-form/holding-form.screen.tsx` (render the section; hide the balance field for `isLedgerlessHoldingType`; a create writes `balanceMinorUnits: 0`, one lot `{day, "1", cost}`, and the first manual point = cost), `src/holdings/repo/holdings.repo.ts` (`remove` also calls `removeInstrument(holdingInstrument(id))` in the same transaction), `holding-detail.screen.tsx` (footer action `'updateValue'`, "Value as of <date>" from `latestPoint`), `holding-card.component.tsx` (the caption), `src/navigation/types.d.ts` + `src/navigation/accounts.stack.tsx` (`PricePointForm: { holdingId: string }`), and `en.ts`/`uk.ts` (`forms.account.property` "Property"/"Майно", `forms.holding.propertyItem`, category labels, `forms.pricePoint.*`, `holdingDetail.updateValue`, `holdingDetail.valueAsOf`).

- [ ] Failing tests: creating a property writes one lot + one manual point and no transaction row; "Update value" adds a point for the chosen date and the card re-renders; deleting the holding removes its series; the i18n parity test passes.
- [ ] Implement. Run `npx jest src/screens src/holdings`, then `make typecheck && make lint`.
- [ ] Phase check: `make gate`.

## P2 — Precious metals

### Task T17: Metals kind, `metal` type, bank allow-list (developer, scribe)

**Files:** Modify `src/db/schema.ts` (kind += `'metals'`, type += `'metal'`), `holding-type.ts` (`metals: ['metal']`, `bank` += `'metal'`; `creatableHoldingTypesForAccount(kind, isSynced, bankId?)` drops `metal` under `bank` unless `bankSellsMetals(bankId)`), `holding-metadata.ts` (`MetalMeta = { metal: 'XAU'|'XAG'|'XPT'|'XPD'; form: 'bar'|'coin'|'bank_account'; unit: 'g'|'oz'; purity: string; lots: Lot[] }`, `asMetalMeta`), `priced-value.ts` (metal value = `multiplyToMinorUnits([qty, purity, price], 'UAH', unit === 'g' ? '31.1034768' : undefined)`), `src/bank-sync/bank-catalog/bank-catalog.ts` (+test: `sellsMetals: boolean`, `privatbank: true`, the rest false; `bankSellsMetals(bankId)`), `src/holdings/entity-symbols/entity-symbols.ts`, `src/holdings/entity-colors/entity-colors.ts`, `src/holdings/exchange-destination/exchange-destination.ts` (exhaustive arms), and every caller of `creatableHoldingTypesForAccount` (pass `account.bankId`). For the per-type descriptor, form, and detail-spec sites, follow kiko-domain's "Adding a holding type" checklist (`.claude/skills/kiko-domain/SKILL.md`): `src/holdings/holding-descriptor/metal/` + `holding-descriptors.ts`; `src/screens/forms/holding-form/metal/` + `HoldingFormScreen`'s `forms` record and `match` arm; `src/screens/holding-detail/holding-detail-spec/` (`holdingDetailSpecs`).

- [ ] Failing tests: 31.1034768 g at purity 1 = 1 oz × price; `bankId: 'monobank'` cannot create `metal`, `privatbank` can; `metals` offers only `metal`; metal currency fixed to UAH.
- [ ] Implement. Run `npx jest src/holdings src/bank-sync`, then `make typecheck && make lint`.
- [ ] (scribe) kiko-domain: metals kind, the allow-list as data, the troy-ounce rule.

### Task T18: Lot form (buy/sell) (developer)

**Files:** Create `src/screens/forms/lot-form/lot-form.screen.tsx` (+test; date, buy/sell `OptionPills`, quantity, total cost; writes metadata lots through `holdingsRepo.update`). Modify the navigation types and stack (`LotForm: { holdingId: string }`), holding-detail (footer `'addLot'` for `metal`/`share`, a lot list), and `en.ts`/`uk.ts` (`forms.lot.*`).

- [ ] Failing tests: a buy appends a positive delta; **Review Focus 8**: a sell larger than `quantityAt(day)` shows `forms.lot.sellExceedsError` and writes nothing; no transaction row.
- [ ] Implement. Run `npx jest src/screens/forms/lot-form src/screens/holding-detail`, then `make typecheck && make lint`.

### Task T19: NBU metal prices, current + history (developer)

**Files:** Create `src/prices/nbu-metals/{nbu-metals.ts,.test.ts,index.ts}` and `src/prices/metal-refresh/{metal-refresh.ts,.test.ts,index.ts}`. Modify `src/sync/use-auto-sync/use-auto-sync.ts` and `src/sync/use-sync-all/use-sync-all.ts` (call `refreshMetalPrices` next to `refreshRates`, failures swallowed the same way), and `docs/security/README.md` (the `bank.gov.ua` row: add `src/prices/nbu-metals`).
**Produces:** `fetchNbuMetalsCurrent(fetchImpl)`; `fetchNbuMetalHistory(metal, start, end, fetchImpl)`; `refreshMetalPrices({ now, fetchImpl })` (only held metals; at most once per local day per metal; backfill from the earliest lot day).

- [ ] Step 1, live probe (record the result in the test file header): `GET https://bank.gov.ua/NBU_Exchange/exchange_site?start=20250101&end=20250110&valcode=xau&json`. XAU rows → one range call per metal. Otherwise sample `exchange?valcode=XAU&date=YYYYMMDD&json` weekly, max 60 calls per metal per backfill, carry-forward between samples.
- [ ] Failing tests with recorded JSON fixtures: current rows → `metal:XAU` points in UAH; non-ok → throws, writes nothing; a second refresh the same local day → no fetch; backfill starts at the first lot day.
- [ ] Implement. Run `npx jest src/prices src/sync`, then `make typecheck && make lint`.

### Task T20: Metal form section (developer)

**Files:** Create `src/screens/forms/holding-form/metal-section/` (metal, form, unit chips; purity default `"0.9999"`; first lot). Modify `holding-form.screen.tsx`, `holding-detail.screen.tsx` ("Price as of <date>"), and `en.ts`/`uk.ts` (`forms.account.metals` "Precious metals"/"Дорогоцінні метали", `forms.account.kindSubtitle.metals`, `forms.holding.metal*`, metal names).

- [ ] Failing tests: a create under the metals kind writes a `MetalMeta` with one lot and no transaction; under an allow-listed bank the type chip shows `metal`; the value renders once a `metal:XAU` point exists.
- [ ] Implement. Run `npx jest src/screens/forms/holding-form`, then `make typecheck && make lint`.

### Task T21: Metals reach net worth end-to-end (developer)

**Files:** Modify `src/statistics/net-worth-series/net-worth-series.test.ts` and `src/rates/net-worth-view/net-worth-view.test.ts` (tests only, unless one fails).

- [ ] Pinning tests: a gold bar's series follows the NBU points; a metal holding contributes 0 before its first lot day.
- [ ] Run `npx jest src/statistics src/rates`. Phase check: `make gate`.

## P3 — Bank catalog additions + Bond ISIN mode

### Task T22: PUMB, Oschadbank, Raiffeisen, Ukrgasbank (developer, scribe)

**Files:** Modify `bank-catalog.ts` (+test: `bankIds` += `pumb`, `oschadbank`, `raiffeisen`, `ukrgasbank`; `statementFormatId?` optional; `sellsMetals` true for pumb, oschadbank, ukrgasbank; `connectable: false`), `src/screens/forms/bank-type-field/bank-type-field.component.tsx` (a caption `forms.account.bankColumnMappingOnly` "Import with column mapping" / "Імпорт через зіставлення стовпців" when there is no dedicated format), and `en.ts`/`uk.ts`. The account-detail import action needs no change (T7 shows it for every bank account).

- [ ] Failing tests: the 4 new banks render; Oschadbank shows the column-mapping caption AND the import action, and an Oschadbank import routes to `ColumnMapping` (no `expectedFormatId`, no known format); `isConnectableBank('oschadbank')` is false; PUMB, Oschadbank, Ukrgasbank can create `metal`.
- [ ] Implement. Run `npx jest src/bank-sync src/screens`, then `make typecheck && make lint`.
- [ ] (scribe) kiko-domain `bankId` paragraph: point readers at the catalog file; no fixed bank count.

### Task T23: ISIN validation (developer)

**Files:** Create `src/bonds/isin/{isin.ts,isin.test.ts,index.ts}`.
**Produces:** `normalizeIsin(raw)`; `validateIsin(raw): { ok: true; isin } | { ok: false; reason: 'format' | 'checkDigit' }` (`^[A-Z]{2}[A-Z0-9]{9}[0-9]$`, ISO 6166 Luhn).

- [ ] Failing tests: `' ua4000227045 '` → valid (3 real ISINs from the NBU register, `UA…` and `XS…`); one changed digit → `checkDigit`; 11 chars → `format`.
- [ ] Implement. Run `npx jest src/bonds/isin`, then `make typecheck && make lint`.

### Task T24: NBU register client + `bond_register` cache (developer)

**Files:** Modify `src/db/schema.ts` (`bondRegister`: `isin` PK, `terms` json, `fetchedAt` int). Generate `drizzle/migrations/0036_add_bond_register.sql`; create `src/db/schema.bond-register.test.ts`. Create `src/bonds/nbu-register/{nbu-register.ts,.test.ts,index.ts,__fixtures__/depo-securities-sample.json}` (3 records trimmed from the live payload) and `src/bonds/bond-register-repo/{bond-register.repo.ts,.test.ts,index.ts}`. Modify the data-transfer snapshot files (+tests).
**Produces:** `type BondTerms = { isin; currency; faceValueMinorUnits; couponPct; maturityDate; couponFrequency: BondCouponFrequency | null; name }`; `couponFrequencyFromPayPeriod(days)` (±5 days around 30, 91, 182, 364); `fetchNbuRegister(fetchImpl)`; `bondRegisterRepo = { findByIsinQuery, fetchedAtQuery, replaceAll }`; `refreshBondRegisterIfStale({ now, fetchImpl })` (once per local day).

- [ ] Failing tests: `pay_period` 182 → semiannually, 200 → null; `OZDP` nominal 1 → 100 minor units; `replaceAll` is one transaction; same-day stale check skips the fetch; a snapshot without `bondRegister` restores.
- [ ] Implement. Run `npx jest src/bonds src/db src/data-transfer`, then `make typecheck && make lint`.

### Task T25: Bond form ISIN / Manual mode + Diia hint (developer)

**Files:** Modify `holding-metadata.ts` (`BondMeta.isin?: string`; round-trip test). Create `src/screens/forms/holding-form/bond-isin-section/`. Modify `holding-form.screen.tsx` (an "ISIN / Manual" `ChipRow`; create defaults to ISIN; edit opens Manual with the ISIN editable; opening calls `refreshBondRegisterIfStale`) and `en.ts`/`uk.ts` (`forms.holding.isin*`, `isinCheckDigitError`, `isinNotInRegister`, `switchToManual`, `diiaHint` "Bought in Diia? Add the bond under the bank or broker you chose there.").

- [ ] Failing tests: a found ISIN fills face value, coupon, maturity, frequency, `bondKind: 'government'`, currency, and name, and save stores `BondMeta` with `isin`; not found → message + "Switch to Manual" keeps the ISIN; offline with no cache → same path; check-digit error blocks save; the Diia hint renders in both modes.
- [ ] Implement. Run `npx jest src/screens/forms/holding-form`, then `make typecheck && make lint`. Phase check: `make gate`.

## P4 — Debts / Борг, net-worth rule, interest-only spending

### Task T26: Debt kind, `loan` type, schedule math (developer)

**Files:** Modify `src/db/schema.ts` (kind += `'debt'`, type += `'loan'`), `holding-type.ts` (`debt: ['loan']`; `isLedgerlessHoldingType` += `loan`), the symbol, color, and exchange maps, and `holding-metadata.ts` (`LoanMeta = { kind: 'mortgage'|'car_loan'|'consumer_loan'|'personal'; principalMinorUnits; startDate; annualRatePct?; termMonths?; schedule: 'annuity'|'differentiated'|'none' }`, `asLoanMeta`). Create `src/holdings/loan-schedule/{loan-schedule.ts,.test.ts,index.ts}`. For the per-type descriptor, form, and detail-spec sites, follow kiko-domain's "Adding a holding type" checklist (`.claude/skills/kiko-domain/SKILL.md`): `src/holdings/holding-descriptor/loan/` + `holding-descriptors.ts`; `src/screens/forms/holding-form/loan/` + `HoldingFormScreen`'s `forms` record and `match` arm; `src/screens/holding-detail/holding-detail-spec/` (`holdingDetailSpecs`).
**Produces:** `LoanInstallment`; `loanInstallments(meta)` (monthly, `addMonths`, local-midnight days, last installment absorbs rounding); `loanOutstandingMinorAt(meta, holdingId, book, instant)` (N10a; `none` → `priceAt(holdingInstrument(id))`; clamped ≥ 0); `loanInterestForPaymentMinor(meta, paymentTime, paymentAbsMinor)` (N10b; `none` → 0).

- [ ] Failing tests: an annuity of 1,200,000.00 UAH at 12% over 240 months matches a known table (first and last rows); differentiated has constant principal; outstanding after the last installment is 0; a correction point of 900,000 on day X gives 900,000 minus principal due after X; an informal loan reads the manual series; overpaid correction clamps to 0; interest for a payment 3 days after due date k = installment k's interest, capped by `|payment|`.
- [ ] Implement. Run `npx jest src/holdings`, then `make typecheck && make lint`.

### Task T27: Loan valuation + net-worth rule change (developer, designer, scribe)

**Files:** Modify `holding-value.ts` (`loan`: `gross = net = −outstanding`, `principalOrCost = −principal`), `holding-value-at.ts`, `type-breakdown.ts` (exclude `loan`), `account-contribution.ts` (add `buildDebtTotal({ holdings, rateTable, baseCurrency, now, book }): Money`), `statistics.screen.tsx` (a "Debts" total under the account pie), `home.screen.tsx` (the headline may be negative), and `src/screens/accounts/accounts.screen.tsx` (designer: a "Debts" section for `kind === 'debt'`, total negative; drag reorder stays within a section). `en.ts`/`uk.ts` (`forms.account.debt` "Debt"/"Борг", its subtitle, `statistics.debtsTotal`, `accounts.debtsSection`).

- [ ] Failing tests: net worth = assets − outstanding (headline and series); a negative total renders with a minus through `MoneyText`; the pie never gets a negative slice; no `loan` type bar; the accounts screen renders the Debts section with a negative total.
- [ ] Implement. Run `npx jest src/holdings src/statistics src/rates src/screens`, then `make typecheck && make lint`.
- [ ] (scribe) kiko-domain "Net worth": Σ assets − Σ debt outstanding; credit-card negative balances count as debt; the pie shows assets only. kiko-charts: the pie excludes debts; the net-worth line may cross 0.

### Task T28: Loan form section + outstanding corrections (developer)

**Files:** Create `src/screens/forms/holding-form/loan-section/` (kind chips, principal, start date, optional rate and term, schedule chips; rate and term required unless `none`). Modify `holding-form.screen.tsx` (a `none` create writes the first manual point = principal at the start date), holding-detail (`'updateValue'` labelled "Update outstanding"; annuity/differentiated shows the next installment's interest/principal split), and `en.ts`/`uk.ts` (`forms.holding.loan*`).

- [ ] Failing tests: validation per schedule; a `none` loan creates its first point; the correction form writes to `holdingInstrument(id)`; the detail screen shows the outstanding amount negative.
- [ ] Implement. Run `npx jest src/screens`, then `make typecheck && make lint`.

### Task T29: Loan-payment link column + repo (developer)

**Files:** Modify `src/db/schema.ts` (`transactions.loanHoldingId` text nullable; `transactions.loanLinkSource` enum `'auto' | 'manual'` nullable; `transactions.loanLinkRejected` integer boolean default 0). Generate `drizzle/migrations/0037_add_loan_link.sql`; create `src/db/schema.loan-link.test.ts`. Modify `src/transactions/repo/transactions.repo.ts` (+test: `setLoanPayment({ transactionId, loanHoldingId: string | null, source })`; `undoAutoLoanLink(transactionId)` clears the link and sets `loanLinkRejected`; a manual link or manual "None" clears `loanLinkRejected`; allowed on synced rows) and `holdings.repo.ts` `remove` (clear links to the deleted loan in the same transaction).

- [ ] Failing tests: the migration is registered; `setLoanPayment` on a `monobank` row persists with its source; `undoAutoLoanLink` sets `loanLinkRejected`; a re-sync keeps `loanLinkSource` and `loanLinkRejected`; **`addManyDedup` re-sync of the same `externalId` keeps `loanHoldingId`**; **Review Focus 7**: deleting the loan clears its links.
- [ ] Implement. Run `npx jest src/db src/transactions src/holdings`, then `make typecheck && make lint`.

### Task T30: Interest-only spending (developer, scribe)

**Files:** Create `src/statistics/loan-payments/{loan-payments.ts,.test.ts,index.ts}`. Create the hand-authored data-only migration `drizzle/migrations/0038_seed_loan_interest_category.sql` (`INSERT OR IGNORE` of `loan_interest`, title "Loan interest", an icon, an `entityColors` color) with a journal entry. Modify `src/db/__fixtures__/seeded-categories.ts`, `en.ts`/`uk.ts` (`categories.loan_interest` "Loan interest"/"Відсотки за кредитом"), and `statistics.screen.tsx` (union into `excludedTransactionIds`; append interest entries to the list fed to **both** `buildCategoryBreakdown` and the category trend).
**Produces:** `loanPaymentExcludedTransactionIds(transactions)` (only links whose loan exists); `loanInterestEntries({ transactions, loanHoldings })` (id `loan-interest:<txId>`, category `loan_interest`, amount `−interest`).

- [ ] Failing tests: a linked −12,000 payment with installment interest 9,000 → the pie shows 9,000 under "Loan interest" and nothing from the raw row; an informal loan payment counts 0; an unlinked payment counts in full; **Review Focus 7**: a link to a missing loan counts as normal spending; the trend includes the interest.
- [ ] Implement. Run `npx jest src/statistics src/db src/screens/statistics`, then `make typecheck && make lint`.
- [ ] (scribe) kiko-domain "Spending-exclusion pipeline": the loan-payment marker and the derived interest entries.

### Task T31: Loan-payment field on the transaction form (developer)

**Files:** Create `src/screens/forms/loan-payment-field/` (a `HoldingSelectField` limited to open `loan` holdings, plus "None"; saves at once through `setLoanPayment`). Modify `transaction-form.screen.tsx` (render for an existing debit row, manual or synced) and `en.ts`/`uk.ts` (`forms.transaction.loanPayment`, `loanPaymentNone`, `loanLinkedAuto`, `loanLinkUndo`; `syncedNotice` → "This was synced, so only the category and loan link can be changed.").

- [ ] Also: `loanLinkSource = 'auto'` shows a "Linked automatically" caption and "Undo" (`undoAutoLoanLink`); list rows show a small loan-link marker for both sources.
- [ ] Failing tests: the field shows only on debits; picking a loan persists as `manual`; "None" clears; an auto link shows the caption and Undo; Undo clears and a later matcher run does not re-link; the field is hidden when no loan holding exists (data-driven, not a flag).
- [ ] Implement. Run `npx jest src/screens/forms`, then `make typecheck && make lint`.

### Task T32: Automatic loan-payment matcher (developer, scribe)

**Files:** Create `src/loans/payment-matcher/{payment-matcher.ts,.test.ts,index.ts}` and `src/loans/use-loan-auto-link/` (+test). Modify `LoanMeta` in `holding-metadata.ts` (optional `paymentHoldingId`, `lenderName`, `lenderIban`), the T28 loan section ("Paid from" holding picker, lender name, lender IBAN), the sync completion path, and `importParsedStatement` callers (T1: covers both the dedicated and the column-mapping import), plus `en.ts`/`uk.ts`.
**Produces:** `matchLoanPayments({ transactions, loans, now }): Array<{ transactionId; loanHoldingId; dueDate }>` — pure; rules in spec §5.4.

- [ ] Failing tests (one per §5.4 rule): exact installment amount + window + paid from `paymentHoldingId` → linked; amount + window + a keyword ("кредит", "погашення", "іпотек", "loan", "mortgage", the lender name) → linked; amount + window + `counterIban = lenderIban` → linked; amount + window only → NOT linked; amount outside tolerance → not linked; outside the window → not linked; two candidates for one installment → none; one transaction matching two loans → not linked; `loanLinkRejected` → never; already linked → unchanged; an exchange leg or a credit → never; a different currency → not linked; an informal loan → never; a re-run is idempotent; backfill from the loan start links past payments.
- [ ] Implement. The hook runs after sync, after statement import, and on loan create/edit; writes links with `source: 'auto'` in one `db.transaction()`.
- [ ] (scribe) kiko-domain: the matcher rules and the undo marker.
- [ ] Run `npx jest src/loans src/transactions src/statistics`, then `make typecheck && make lint`. Phase check: `make gate`.

### Task T33: Maestro flows for P1–P4 (qa)

**Files:** Create `.maestro/property-metals-debts.yaml`.

- [ ] Add a Property account and item, update its value; add a Metals account with a gold bar; add a Debt account with an annuity loan; assert the Home headline changes and the Accounts screen shows the Debts section. No network assertions.
- [ ] Run `maestro test .maestro/property-metals-debts.yaml` on a Debug simulator build (the coordinator's persistent Metro).

## P5 — Broker / Брокер, manual shares, EODHD BYOK

### Task T34: Widen `plist.sh` credential detection for EODHD (developer, scribe)

**Files:** Modify `scripts/checks/plist.sh` (the client-file grep adds `\bapi_token\b`). Create `__tests__/plist-credential-detect.test.ts` (copies `plist.sh` + `_lib.sh` into a temp root with a stub `ios/Kiko/Info.plist`, `ios/Kiko.xcodeproj/project.pbxproj` (with the Debug-ATS phase name), `.env`, and `src/` clients; the harness style of `__tests__/mutation-lock.test.ts`). Modify `docs/harness/review-to-biome-inventory.md` (a row), `.claude/skills/kiko-linter/SKILL.md` "Plist assertions", `.claude/skills/kiko-compliance/SKILL.md` "ATS".

- [ ] Failing tests: a temp `src/x.client.ts` with `api_token` and an unpinned `@env` host → exit 2 naming the host; the same file with the host pinned twice → exit 0; a file with no credential marker → ignored; the real repo still passes (`make plist`).
- [ ] Implement. Run `npx jest __tests__/plist-credential-detect.test.ts && make plist`, then `make lint`.

### Task T35: Broker kind, broker catalog, `share` type (developer, scribe)

**Files:** Modify `src/db/schema.ts` (kind += `'broker'`, type += `'share'`; `bankId` column comment per N13), `holding-type.ts` (`broker: ['share','bond','cash']`; `isLedgerlessHoldingType` += `share`), the symbol, color, and exchange maps, and `holding-metadata.ts` (`ShareMeta = { symbol; isin?; exchange; name; lots: Lot[]; quoteSource: 'eodhd' | 'manual' }`, `asShareMeta`). For the per-type descriptor, form, and detail-spec sites, follow kiko-domain's "Adding a holding type" checklist (`.claude/skills/kiko-domain/SKILL.md`): `src/holdings/holding-descriptor/share/` + `holding-descriptors.ts`; `src/screens/forms/holding-form/share/` + `HoldingFormScreen`'s `forms` record and `match` arm; `src/screens/holding-detail/holding-detail-spec/` (`holdingDetailSpecs`). Create `src/brokers/broker-catalog/{broker-catalog.ts,.test.ts,index.ts}` (`brokerIds = ['trading212','ibkr','freedom24','revolut','icu','univer','dragon','other']`, `brokerCatalog: { id; displayName }[]` — plain, non-connectable entries; no `connectable` field until a sync exists) and `src/screens/forms/broker-type-field/` (the `bank-type-field` shape; "Other broker" relies on the account name). Modify `account-form.screen.tsx` (broker branch stores `bankId = brokerId`), `priced-value.ts` (share value = qty × `priceAt(shareInstrument(symbol))`, holding currency), and `en.ts`/`uk.ts` (`forms.account.broker` "Broker"/"Брокер", its subtitle, `forms.account.brokerType`, `forms.holding.share`). EXANTE and Freedom Finance Ukraine are never listed.

- [ ] Failing tests: the broker kind offers share, bond, cash; the catalog renders all 8 plain-text names; the broker account saves its `bankId`; a share with lots and a price is valued; `isBankId('trading212')` stays false; a broker account shows no Import-statement action (T7 limits it to bank accounts).
- [ ] Implement. Run `npx jest src/brokers src/holdings src/screens/forms`, then `make typecheck && make lint`.
- [ ] (scribe) kiko-domain: the broker kind (the old "`broker` was dropped" note becomes history), `bankId` as the catalog identity per kind, share lots, manual holdings only.

### Task T36: Share form section, manual price mode, gain display (developer)

**Files:** Create `src/screens/forms/holding-form/share-section/` (symbol, exchange, name, optional ISIN (T23), quote-source chips `EODHD / Manual`, first lot). Modify holding-detail (market value, cost basis, unrealized gain = value − cost, "Price as of"; footer `'addLot'`, plus `'updateValue'` when `quoteSource === 'manual'`, writing to `shareInstrument(symbol)`) and `en.ts`/`uk.ts` (`forms.holding.share*`, `holdingDetail.costBasis`, `unrealizedGain`, `priceAsOf`, `noPriceYet`).

- [ ] Failing tests: a manual-quote share is valued from a manual point; **Review Focus 5**: an EODHD share with no point shows "No price yet" and value = cost basis; the gain sign colors through `MoneyText`; no financial-advice wording.
- [ ] Implement. Run `npx jest src/screens`, then `make typecheck && make lint`.

### Task T37: EODHD pins, env, security doc (ops, developer)

**Files:** Modify `ios/Kiko/Info.plist` (`NSPinnedDomains` → `eodhd.com` with root + intermediate `NSPinnedCAIdentities`), `.env.example` and `.env.test` (`EODHD_API_ENDPOINT=https://eodhd.com/api`, `EODHD_SIGNUP_URL`), `src/env.d.ts`, and `docs/security/README.md` (host-table row, "Current chains" block with capture date, rotation host list).

- [ ] (ops) Capture the chain with the `openssl s_client … -showcerts` recipe in `docs/security/README.md`; report root and intermediate SPKI-SHA256.
- [ ] (developer) Add pins, env keys, doc row. Run `make plist` and `npx jest __tests__`.

### Task T38: EODHD key in Keychain + settings screen (developer)

**Files:** Create `src/quotes/eodhd-token/{eodhd-token.ts,.test.ts,index.ts}` (service `kiko.eodhd.token`, the `hardenedFor` shape) and `src/screens/settings/share-prices/share-prices.screen.tsx` (+test; paste key, "Check key" → `fetchUserLimits`, show the daily limit, remove key, plain-text sign-up URL from `@env` `EODHD_SIGNUP_URL`, no logo). Modify `src/screens/settings/settings/settings.screen.tsx` (a "Share prices" row), the settings stack navigation, `src/data-transfer/secrets/{read-secrets.ts,restore-secrets.ts}` + `src/data-transfer/payload.d.ts` (`eodhdToken?: string`), and `en.ts`/`uk.ts` (`settings.sharePrices.*`: BYOK in plain words; the user accepts the provider's terms).

- [ ] Failing tests: save/read/clear round-trip with hardening options asserted; a 401 key shows an error and stores nothing; export includes the key only with the credentials toggle on; restore writes it back.
- [ ] Implement. Run `npx jest src/quotes src/screens/settings src/data-transfer`, then `make typecheck && make lint`.

### Task T39: EODHD client (developer)

**Files:** Create `src/quotes/eodhd/{eodhd.client.ts,.test.ts,index.ts,__fixtures__/*.json}`. It imports `EODHD_API_ENDPOINT` from `@env` and sends the key as the `api_token` query param (the literal T34 detects).
**Produces:** `fetchEod(symbol, fromDay, toDay, token, fetchImpl)`; `searchSymbols(query, token, fetchImpl)`; `fetchUserLimits(token, fetchImpl)`; `EodhdAuthError` (401/403), `EodhdQuotaError` (402/429), `EodhdUnavailableError`.

- [ ] Step 1 **[VERIFY LIVE]** (with the user's key or the public `demo` token): confirm `/eod/{SYMBOL}?fmt=json&from&to`, `/search/{q}?fmt=json`, `/user?fmt=json` and their fields. Save anonymized fixtures.
- [ ] Failing tests: closes map through `decimalFromJsonNumber`; each error class maps from its status; the token never appears in `error.message`.
- [ ] Implement. Run `npx jest src/quotes/eodhd && make plist` (the file must be detected as credential-bearing and pinned).

### Task T40: Quota guard + share price refresh (developer)

**Files:** Modify `src/db/schema.ts` (`settings.quoteQuota` json `{ day; calls; dailyLimit; attempted: string[] }`, nullable). Generate `drizzle/migrations/0039_add_quote_quota.sql`. Modify `src/db/settings-columns.test.ts` only if needed and `src/settings/settings.repo.ts` (+test: `getQuoteQuota`, `setQuoteQuota`). Create `src/quotes/quota/{quota.ts,.test.ts,index.ts}` (pure: `canSpend`, `spend`, reset on a new UTC day, default limit 20) and `src/quotes/share-refresh/{share-refresh.ts,.test.ts,index.ts}`. Modify `use-auto-sync.ts` and `use-sync-all.ts` (call `refreshSharePrices`).
**Produces:** `refreshSharePrices({ now, fetchImpl }): Promise<{ status: 'ok' | 'noKey' | 'quotaExhausted' | 'failed'; asOf?: number }>`. Rules: only open `share` holdings with `quoteSource: 'eodhd'`; skip when the latest point day ≥ the last weekday; one call per instrument per UTC day; first sight backfills from the first lot day (clamped to 1 year on the default limit); **Review Focus 6**: `.LSE` + GBX → `shiftDecimal(close, -2)` stored as GBP, any other currency ≠ holding currency → skip, log nothing sensitive; a 401 stops the run without spending quota.

- [ ] Failing tests: each rule above; at the limit → no fetch, `quotaExhausted`; two opens the same day → one call; one upsert transaction per run.
- [ ] Implement. Run `npx jest src/quotes src/settings src/sync src/db`, then `make typecheck && make lint`.

### Task T41: Symbol search in the share form + quota notice (developer)

**Files:** Modify `share-section` (a search sheet when a key exists and search is available; else manual symbol + exchange + currency), `holding-detail.screen.tsx`, and `src/screens/home/home.screen.tsx` ("Prices as of <date>" when the last refresh returned `quotaExhausted` or `failed`), plus `en.ts`/`uk.ts`.

- [ ] Failing tests: a search result fills symbol, exchange, name, currency, ISIN; `EodhdUnavailableError` falls back to manual entry; the quota caption renders from the refresh status.
- [ ] Implement. Run `npx jest src/screens`, then `make typecheck && make lint`. Phase check: `make gate`.

---

## Wrap-up

### Task T42: Privacy policy, compliance docs, broker Maestro flow (scribe, qa)

**Files:** `docs/privacy-policy.md` (uk) and `docs/privacy-policy.en.md`, §3 "Connections to third-party financial services": add EODHD (`eodhd.com`: ticker symbols and the user's own key; only when the user adds a key). State that NBU register and metal prices come from `bank.gov.ua` and carry no personal data, and that column-mapped statement files are read on the device only. Also update the gh-pages copy (`/Users/drizzer14/orca/workspaces/pff-ios/gh-pages/index.html` (uk) and `/Users/drizzer14/orca/workspaces/pff-ios/gh-pages/en.html`), `.claude/skills/kiko-compliance/SKILL.md`, and `docs/security/README.md` (final host-table review). Create `.maestro/broker-share-manual.yaml` (qa).

- [ ] (scribe) Both languages in one pass; "Кіко" in uk. Publish gh-pages **before** App Store submission (the coordinator pushes). Flag the coordinator-owned `memory/refs/resubmission-kit.md` App Privacy section D for review.
- [ ] (qa) The flow adds a broker (Other broker) and a manual-quote share, updates its price, and asserts the value.
- [ ] Run `make lint`.

### Task T43: Whole-branch review (reviewer)

- [ ] `kiko:reviewer` reviews the full `next...feat/assets-debts` diff: correctness, conventions, **compliance** (5.6: no flags, column mapping always visible, brokers as complete manual entries; ATS pins; privacy; trademarks; no financial advice), then `/ponytail-review`. The developer fixes each finding; qa adds a test for each fixed bug.

### Task T44: Final gates + device verification (developer, coordinator, ops, user)

- [ ] **User reviews every new or changed en/uk key** (a diff of `src/i18n/locales/{en,uk}.ts` against `next`) before any deploy.
- [ ] `make verify` (lint → full jest → `check:all`). Re-run until green. Fix root causes, never weaken a check.
- [ ] The coordinator runs `KIKO_MUTATION_BASE=next make deep` detached and waits for the exit code. Effectively green = mutation score ≥ threshold and osv reports only the known accepted CVEs.
- [ ] (ops) `make deploy` Release-AdHoc to the connected iPhone (USB preferred).
- [ ] Device checklist (the user has **only a Monobank account**):

| Flow | Device-verifiable? |
|---|---|
| Column-mapping import: every P0 row (T9) re-checked on the final build | **yes** |
| Oschadbank / Raiffeisen / Ukrgasbank account: import action present, routes to column mapping | **yes** (UI + any real CSV/XLSX) |
| Property: create, update value, net worth and history line | **yes** |
| Metals under the Metals kind: NBU price loads, "price as of", history backfill | **yes** (public NBU) |
| Metal under a bank: PrivatBank allowed, Monobank not offered | **yes** (UI only) |
| New catalog banks render with the right captions | **yes** |
| Bond ISIN mode: found, not found → Manual, offline with and without cache (Airplane mode) | **yes** (public NBU) |
| Debt: annuity / informal loan, negative headline, Debts section, pie shows assets only | **yes** |
| Loan-payment link on a **synced Monobank** debit → interest-only spending | **yes** |
| Automatic loan-payment link on a synced Monobank debit, "Linked automatically", Undo, no re-link | **yes** — needs a real recurring loan payment or a matching manual debit |
| Broker (any catalog entry) with a manual share and manual price | **yes** |
| EODHD BYOK: key check, once-per-day refresh, backfill, quota caption | **only if the user registers a free EODHD key** |
| BigInt decimal math in a Release (Hermes) build | **yes** (any priced holding value) |
| `eodhd.com` TLS negative check (corrupt pins → failure) | **only with a key** |
