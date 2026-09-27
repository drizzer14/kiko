# Whole-codebase review — 2026-09

- **Branch:** `codebase-review`, based on `feat/assets-debts` at `35e0ce4`.
- **Scope:** all of `src/` (about 990 files, about 120,000 lines, source and tests), plus `App.tsx`, `__tests__/`, `__mocks__/` and `jest/`.
- **Mode:** read-only. This document is the only change on the branch.

## How the review ran

Ten read-only agents ran in parallel. Each agent read the same brief, with the same rule list and the same table format.

| Id | Agent | Area |
|---|---|---|
| R1 | kiko:reviewer | `screens/forms/holding-form`, holding-identity-field, holding-select-field, lot-form, price-point-form, contribution-form, mode-select-field, `screens/holding-detail` |
| R2 | kiko:reviewer | `screens/forms/transaction-form`, account-form, and all other form fields |
| R3 | kiko:reviewer | `screens/statistics`, `screens/home`, `screens/accounts`, entity-amount-header, entity-header-icon |
| R4 | kiko:reviewer | `screens/account-detail`, `screens/settings`, `screens/statement-import`, `screens/column-mapping` |
| R5 | kiko:reviewer | `design-system/**`, `calendar/**` |
| R6 | kiko:reviewer | `holdings`, `accounts`, `categories`, `bonds`, `statistics` (domain) |
| R7 | kiko:reviewer | `prices`, `rates`, `currency`, `dates`, `transactions`, `db`, `migration` |
| R8 | kiko:reviewer | `statement-import`, `monobank`, `crypto-sync`, `bank-sync`, `sync`, `sync-state` |
| R9 | kiko:reviewer | `data-transfer`, `auth`, `navigation`, `i18n`, `settings`, `test-support`, the root files, jest and the mocks |
| A1 | kiko:auditor | Cross-cutting search of all of `src/` for each rule, and a comparison of the skills with the rules |

### Rule ids

**A. Skill rules**

| Id | Skill |
|---|---|
| S-STYLE | kiko-code-style |
| S-DOMAIN | kiko-domain |
| S-ARCH | kiko-architecture |
| S-DS | kiko-design-system |
| S-I18N | kiko-translator |
| S-GEST | kiko-gestures |
| S-COMPL | kiko-compliance |
| S-PRICING | kiko-pricing |
| S-SI | kiko-statement-import |

**B. User rules**

| Id | Rule |
|---|---|
| U1 | One component per file. |
| U2 | Comments explain only WHY. No ids and no history. |
| U3 | The nullable-map ternary is banned. |
| U4 | fnts is the first choice. |
| U5 | A closed literal set uses `match().exhaustive()` or a typed `Record`. |
| U6 | Readability and consistency come first. |
| U7 | Sibling modules use the same structure. |
| U8 | One folder for each unit. |
| U9 | Use a shared component before you make a new one. |
| U10 | The UX patterns (footer, validation, tabs, select sheet, checkmark, capabilities, casing, full stops). |

**C. Memory feedback:** `M-<memory-slug>`.

**D. General quality**

| Id | Problem |
|---|---|
| G1 | Dead code |
| G2 | Duplicated logic or divergent twins |
| G3 | Unclear names |
| G4 | Oversized units that mix concerns |
| G5 | Leaky abstractions |
| G6 | Inconsistent error handling |
| G7 | Test anti-patterns |

**BUG** marks a correctness defect. The reviewers ranked these first.

### Tags

- `feat-refactor`: the finding is in code that the feature session refactors now. This code is `holding-form/**`, the holding-detail test, and the F4 UX items. The finding stays in the document, but the fix waits for that session.
- `USER-DECISION`: the fix needs your choice. Section 6 lists all of these choices.

### Limits of the counts

- The counts are **table rows, not instances**. A row normally covers one rule in one file, with all its line numbers. For example, one U2 row can list 40 comment lines.
- The cross-cutting audit (A1) found some of the same U3 and U2 hits as the area reviewers. Those hits are counted twice in the table below.
- Import order and blank lines were checked with read-only scratch scripts. Some reviewers put these findings in one row per file; others put many files in one row. Section 4 explains why this is the first check to automate.
- I did not re-verify every row myself. I checked the claims that affect the plan:
  - The rates bound-parameter bug (the code path, and the SQLite limit of 32,766 in op-sqlite's `sqlite3.c`).
  - fnts usage: 18 files import `fnts`, 10 of them use `fnts/either`, and 0 use `fnts/maybe`.
  - The size of the U2 search: 713 comment lines in 191 files. This is an upper limit, because the pattern can match some lines that are not ids.

## 1. Summary by rule

| Rule | Rows | Areas with the most rows | Notes |
|---|---:|---|---|
| U2 comments with ids or history | 272 | R5 72, R8 56, R6 40, R3 25, R4 24 | The A1 search finds 713 lines in 191 files. The skills show the same style (see section 3). |
| S-STYLE blank lines, names, config | 180 | R5 49, R8 48, R6 44 | Mostly the missing blank line before `return`/`if`/`for` and between JSX siblings. |
| G2 duplicated logic or divergent twins | 88 | R8 15, R3 13, R7 11 | Several twins are bugs (see the BUG list). |
| G1 dead code or stale comments | 80 | R8 18, R5 17, R6 16 | Examples: dead GlassSurface variants, test-only repo methods, stale paths in comments. |
| G7 test anti-patterns | 69 | R9 16, R5 12 | Examples: `useLiveQuery`, `db/client`, Text and Keychain mocks that each test file writes again; loose fake transactions. |
| S-STYLE import order | 67 | R3 24, R4 20 | The rule is followed in almost no area. A script can check it. |
| U3 nullable-map ternary | 66 | A1 27, R8 12 | No file uses `fnts/maybe`. |
| U10 UX patterns | 37 | R4 11, R1 10, R2 10 | validate 16, tabs 6, case 6, check 4, capab 3, stop 3, select 2, footer 1 |
| **BUG** | **35** | R4 10, R3 5, R6 5, R8 5 | See the list below. Four more high-severity items appear under S-I18N, S-COMPL and G6. |
| U5 closed-set branching | 35 | R6 8, R4 6 | Examples: `switch`, `===` chains, and flags derived from a union. |
| U6 readability or consistency | 35 | R6 7, R4 6, R7 6 | Mixed `@kiko/*` alias and `../` imports in the same file (USER-DECISION). |
| U8 folder for each unit | 32 | R8 7 | Flat folders: `crypto-sync/binance`, `db/`, `dates/`, `navigation/`, `statement-import/column-mapping`, and the design-system root. |
| U7 sibling structure | 31 | R1 4, R4 5, R6 5 | Each holding type uses a different shape in the form, the detail screen and the domain code. |
| S-DS tokens and components | 25 | R5 12, R3 8 | Examples: raw sizes, touch targets under 44 pt, raw opacity values. |
| U4 fnts first | 21 | R8 5 | Hand-written try/catch that returns a result object. |
| G3 unclear names | 20 | — | |
| G4 oversized units | 17 | — | transaction-form (2,580 lines), holding-form (2,339), column-mapping, statistics, `monobank/sync`, `transactions.repo` |
| S-I18N | 16 | R9 7, R8 5 | Examples: English error strings in the sync providers, English Face ID labels, keys missing from TITLE_KEYS. |
| G5 leaky abstractions | 15 | — | |
| U1 one component per file | 14 | R4 5 | See the U1 decision in section 6. It affects about 6 more rows. |
| U9 shared component first | 12 | — | Examples: a hand-written Divider, rows that copy SelectableRow, DateField and TimeField that copy FieldTrigger. |
| G6 error handling | 10 | — | Examples: repository writes that nothing awaits, a `.catch` that loses the error. |
| S-COMPL | 7 | R4 3 | 5.6: `APP_LOCK_ENABLED`, Share Extension paths that cannot be reached, loan-link writers with no caller. 5.1: the export includes `dbKeyHex` and does not say so. |
| M-memory | 6 | — | Button hierarchy, Liquid Glass. |
| S-PRICING, S-ARCH, S-GEST | 6 | — | |
| **Total rows** | **1,196** | | |

### Worst files

1. `src/screens/forms/transaction-form/transaction-form.screen.tsx`: 3 bugs, a 1,130-line component, three copies of the same validation logic, U1, U5 and U2.
2. `src/screens/forms/holding-form/holding-form.screen.tsx` (`feat-refactor`): 3 bugs, a different shape for each of the 5 holding types (U7), U3, U4, U5 and 36 id comments.
3. `src/screens/column-mapping/column-mapping.screen.tsx`: 4 bugs, a 48-prop second component, G4, U3 and U5.
4. `src/screens/statistics/statistics.screen.tsx`: 2 bugs, a 975-line component, pipelines that are written twice.
5. `src/monobank/sync/sync.ts`: 2 bugs, 1,248 lines, four copies of the single-flight lock, 37 missing blank lines.
6. `src/transactions/repo/transactions.repo.ts`: 1,014 lines, writers with no caller, a balance update written three times, and fake transactions in its tests that depend on call order.
7. `src/design-system/components/glass-surface/**`: dead content-card variants, and docs that contradict the rule that glass is for the navigation layer only.
8. `src/i18n/locales/en.ts`: casing, full-stop and two-role key errors, plus about 40 id comments.

### Correctness bugs, most severe first

Fix these first, before the style sweep. Each one needs a regression test. Each fix changes behavior.

| # | Severity | File | Bug | Area |
|---|---|---|---|---|
| 1 | High | `src/rates/repo/rates.repo.ts:20-38` | `upsertMany` writes every rate pair in one INSERT. About 110 currencies give up to about 12,000 rows × 5 parameters, which is more than SQLite's 32,766 limit. The write rolls back and `either()` hides the error. Crypto holdings then have no rate. I verified the code and the limit, but not the currency count that Monobank returns on a device. **Verify on a device.** Fix: use `chunkForTable`, the same as `transactions.repo.ts:299`. | R7 |
| 2 | High | `src/data-transfer/secrets/read-secrets.ts:16` | An export with secrets includes the SQLCipher master key `dbKeyHex`. The toggle copy does not say so, and no code reads the key back. (S-COMPL, USER-DECISION.) | R9 |
| 3 | High | `src/data-transfer/import-data.ts:147` | A REPLACE import restores the tables, then the secrets. If the Keychain write throws, the user sees "Import failed" after the data was already replaced. The import also leaves the old accounts' Monobank and Binance secrets in the Keychain. | R9 |
| 4 | High | `src/statement-import/mapping/mapping.ts:39-46` | The dedup key is not unique: "Top up" at occurrence 1 and "Top up 1" at occurrence 0 give the same key. One row is lost with no message. (USER-DECISION: migrate the old keys?) | R8 |
| 5 | High | `src/crypto-sync/binance/binance.transactions.ts:363` | The first Binance sync writes nothing until all of about 38 windows are fetched. One failure restarts from 2017, so on a poor network the import may never finish. | R8 |
| 6 | High | `src/screens/forms/transaction-form/transaction-form.screen.tsx:2297` | On the empty-create form ("+"), Save with no holding picked closes the form and saves nothing. | R2 |
| 7 | High | `transaction-form.screen.tsx:1532-1673` | When the user changes the primary holding, the dependent choices stay. The result can be an exchange or split from a card, an exchange from B to B, or split returns in the wrong currency. | R2 |
| 8 | High | `transaction-form.screen.tsx:603` | The split-return picker offers ledgerless holdings (loan, bond, metal, and others). The return then does not appear in net worth. | R2 |
| 9 | High | `src/screens/column-mapping/column-mapping.screen.tsx:847,968` | The fixed currency comes from the account's first holding, not the selected target holding. All rows are then skipped as the wrong currency. | R4 |
| 10 | High | `src/accounts/accounts.repo.ts:283` | Deleting an account leaves its holdings' `price_points` series. The twin `holdingsRepo.remove` deletes them. | R6 |
| 11 | High | `src/statistics/category-trend/category-trend.ts:84` | Unknown category slugs are not merged into "Other" (the pie chart twin does merge them). The chart shows two lines named "Other". | R6 |
| 12 | High | `src/screens/forms/holding-form/holding-form.screen.tsx:1559` | The deposit `termMonths` has no maximum, so a large value hangs the detail screen. The loan twin has a maximum. `feat-refactor` | R1 |
| 13 | High | `holding-form.screen.tsx:1637` | A purity of ".75" passes validation, but `normalizeDecimal` rejects it, so the form saves 0.9999 with no message. `feat-refactor` | R1 |
| 14 | Medium | `holding-form.screen.tsx:1581-1753` | In manual bond mode, when a date is empty, Save does nothing and shows no error. `feat-refactor` | R1 |
| 15 | Medium | `src/screens/statistics/statistics.screen.tsx:232` and `src/screens/home/home.screen.tsx:244` | The account filter uses the account name, not the id. Two accounts with the same name collide, and a rename empties the filter. | R3 |
| 16 | Medium | `src/screens/home/filter-menu/filter-menu.component.tsx:16` | The `FILTER_ALL = 'All'` sentinel collides with an account named "All". The twin is in trend-filter-field. | R3 |
| 17 | Medium | `statistics.screen.tsx:666` | A selected category that is not in the current date range hides every slice, and the user cannot clear it. (USER-DECISION.) | R3 |
| 18 | Medium | `src/rates/rate-history-repo/rate-history.repo.ts:63,94` | The history rate table keeps rates ≤ 0. The live twin drops them. | R7 |
| 19 | Medium | `src/prices/metal-refresh/metal-refresh.ts:99` | The metal backfill does not fill an earlier lot or days with no data. It also fetches metals of closed holdings. (USER-DECISION.) | R7 |
| 20 | Medium | `src/monobank/sync/sync.ts:400` | If client-info omits `accounts`, the queue throws a TypeError after the fast phase commits. | R8 |
| 21 | Medium | `src/monobank/sync/sync.ts:1191` | The "Last sync" time is set even when every card that the sync fetched failed. | R8 |
| 22 | Medium | `src/statement-import/formats/monobank-csv/monobank-csv.format.ts:116` and `src/statement-import/column-mapping/apply-column-mapping.ts:230` | The two closing-balance pickers break ties in different ways (divergent twins). | R8 |
| 23 | Medium | `src/screens/column-mapping/column-mapping.screen.tsx:1037` | Import does nothing when the mapping finds 0 rows. This is also a Guideline 2.1 risk. (USER-DECISION.) | R4 |
| 24 | Medium | `column-mapping.screen.tsx:1072` | If the mapping save throws after a successful import, the screen shows both the success sheet and the "Import failed" Alert. | R4 |
| 25 | Medium | `column-mapping.screen.tsx:933` | Initialization latches before the settings and accounts queries resolve, so a saved mapping never fills in. | R4 |
| 26 | Medium | `src/screens/statement-import/statement-import.screen.tsx:471` and `column-mapping.screen.tsx:1049` | A double tap starts two imports, because `if (importing)` reads render state. Use `useSubmitOnce`. | R4 |
| 27 | Medium | `src/screens/statement-import/statement-import.screen.tsx:355` | A `.xls` file shows "unrecognized format" and then leads to a dead end. The column-mapping twin handles `.xls`. | R4 |
| 28 | Medium | `src/auth/biometrics.ts:130` | The Face ID sheet labels "Cancel" and "Use Passcode" are hardcoded in English. | R9 |
| 29 | Low | `src/screens/statement-import/preview-stats/preview-stats.ts:51` | An empty parse shows the date range "NaN.NaN.NaN". | R4 |
| 30 | Low | `src/screens/settings/categories/categories.screen.tsx:109` | When the user clears a category title, the card shows a blank name but the database keeps the old title. | R4 |
| 31 | Low | `src/screens/settings/categories/add-category-row/add-category-row.component.tsx:74` | A double tap creates two categories. A rejected write has no handler. | R4 |
| 32 | Low | `src/screens/account-detail/account-detail.screen.tsx:179` | When `keepLocalCopy` rejects, nothing handles the error (divergent twin in import-data). | R4 |
| 33 | Low | `src/statistics/reconcile-bond-funding/reconcile-bond-funding.ts:87` | A bond can match a funding debit from months earlier, and two bonds can claim the same debit. (USER-DECISION: the size of the date window.) | R6 |
| 34 | Latent | `src/statistics/loan-payments/loan-payments.ts:98` | The loan interest is capped and stamped in the payment's currency, not the loan's currency. No code calls this path yet. | R6 |
| 35 | Latent | `src/holdings/priced-value/priced-value.ts:94` and `:53` | A holding with no id is handled three different ways. The metal value is a bare UAH number that the code wraps in `holding.currency`. | R6 |
| 36 | Low | `src/screens/statistics/bar-chart/bar-chart.component.tsx:104` | The by-type bar shows current values only, but its empty state says "No data for this range". | R3 |
| 37 | Perf | `src/screens/holding-detail/holding-detail.screen.tsx:507` | `now = Date.now()` is a memo dependency, so the ledger is sorted and grouped again on every render. | R1 |
| 38 | Low | `src/design-system/components/currency-field` and `src/screens/column-mapping/currency-fields/currency-fields.component.tsx:60` | The column-mapping host does not wire `onOpenChange`, so the background-scroll bug is still open there (divergent twin). | R5 |



## 2. Full findings table

This section has one table for each area, with the rows exactly as each agent reported them. The rule ids and tags are described above.


### R1 — Holding forms and holding-detail

| Rule | file:line | What is wrong | Fix (the existing pattern or rule to apply, name a file that already does it right when one exists) | Effort (S/M/L) | Tags |
|---|---|---|---|---|---|
| BUG / U10-validate | src/screens/forms/holding-form/holding-form.screen.tsx:1581-1615, 1696-1753, 2200-2208 | In Bond Manual mode, a missing purchase or maturity date makes `isBondValid` false. But `bondReasonKey` returns null, so `firstInvalidFieldRef` finds no target. Save does nothing: no error, no scroll. Scenario: Bond → Manual → quantity 10, face 1000, coupon 15, purchase date set, maturity empty → press Save → nothing happens. No test covers this. | Derive `isBondValid` as `bondReasonKey() === null`, like `isTermDepositValid` (:1570). Add date-required reasons and show them on both DateFields plus their scroll entries. Pattern: `loanStartDateError` (use-loan-fields.ts:51). Behavior change: 1-2 new i18n keys. | S | feat-refactor |
| BUG / G2 | src/screens/forms/holding-form/holding-form.screen.tsx:1559-1563 | The deposit `termMonths` has no upper cap. The loan twin caps it at `MAX_LOAN_TERM_MONTHS` (use-loan-fields.ts:67) to stop this exact hang. Scenario: term "99999999" → Save succeeds → `depositLedger` → `depositPeriods` (src/holdings/interest/interest.ts:169-205) builds about 2e8 bi-weekly periods. Past the Date range, `addMonths` returns NaN and the monthly loop never breaks. Holding-detail hangs. | Share one term cap constant and apply it in `termDepositReasonKey`. Behavior change: a value above the cap is rejected. | S | feat-refactor |
| BUG | src/screens/forms/holding-form/holding-form.screen.tsx:1637-1643, 385, 1520 | Purity is validated with `parseAmount` but stored with `normalizeDecimal`. The input ".75" (or "1,") passes Save. Then `normalizeDecimal` returns null and `?? DEFAULT_METAL_PURITY` silently stores "0.9999". Scenario: 18k gold typed ".75" → saved as 0.9999 → value overstated by 33%. The comments at :347-351 and :1633-1636 say this path is "unreachable". That is false. | Validate with `normalizeDecimal` + `compareDecimal`, as the metal-quantity check at :1660-1664 already does. Then delete the fallback. | S | feat-refactor |
| BUG (perf) / G1 | src/screens/holding-detail/holding-detail.screen.tsx:507, 545-578 | `now = Date.now()` changes on every render and is a `useMemo` dependency. So `derived`, `ledger` and `listData` recompute on every render. The comment at :565-567 claims they recompute "only when the ledger changes". Scenario: a synced card with thousands of rows re-sorts and re-groups on every rates or price-points emission. | Key the memos on `todayStart`, or on a `now` taken once at mount, not on the millisecond clock. | S | |
| U7 | src/screens/forms/holding-form/holding-form.screen.tsx:1216-1292, 1324-1376, 1449-1534, 1544-1675, 1985-2333 | The 5 detail types use 5 different shapes. Deposit: inline JSX, no section, state and validation are closures in the screen. Bond: split across 2 sections, fields inline in the screen, plus `useBondIsinMode`. Property and metal: a section component, but state, validation and seed stay in the screen. Loan: `useLoanFields` owns everything and renders through the null-rendering `LoanFormBlock`. Headings differ ("Contributions"/"Terms" vs "Details"). The seed effect, `buildMetadata`, `createPayloadFor` and `firstInvalidFieldRef` each branch per type again. | Use one per-type shape, copied from loan: `use<Type>Fields` (state, reasonKey, seed, create payload, edit metadata) plus `<Type>Section`. The screen dispatches through one `Record<HoldingType, …>`. Add `TermDepositSection` and `useTermDepositFields`. Move bond's inline quantity, price and date fields into its section. | L | feat-refactor |
| U7 | src/screens/holding-detail/holding-detail.screen.tsx:192-229, 518-524, 579, 782 | What the detail screen shows per type is decided by scattered checks: breakdown (deposit/bond), expected profit (bond), next installment (loan), "value as of" (priced), footer action (if-chain), and the loan button label. A new holding type compiles without any decision being made. | Add one `Record<HoldingType, DetailSpec>` (footer action, breakdown, extra panel, labels), or use `match(type).exhaustive()`. | M | |
| U7 | src/screens/forms/holding-form/loan-section/loan-section.component.tsx:21-32; bond-isin-section/bond-isin-section.component.tsx:24-38; manual-bond-fields/manual-bond-fields.component.tsx:14-17 vs metal-section/metal-section.component.tsx:55-71, property-section/property-section.component.tsx:31-38 | Label maps take two forms. Three sections use a module function `(t) => Record`. Two sections use an inline Record in the body. `bondKindLabels` also lacks its `Record<BondKind, string>` type. | Use one form (a typed module function) in all 5 sections. | S | feat-refactor |
| U7 / U10-select | src/screens/forms/holding-form/holding-form.screen.tsx:1949-1957 | The holding Type picker is a ChipRow. Its sibling, the account Kind picker, is a select sheet (`AccountKindField`: SelectableRow + description). | Add a `HoldingTypeField` that mirrors `src/screens/forms/account-kind-field/`, or confirm that chips are right here. | M | feat-refactor, USER-DECISION (chips vs select sheet for 3-5 options) |
| U10-select | src/screens/forms/holding-form/property-section/property-section.component.tsx:42-48 | The 6 property categories are chips. The 6-option account-kind picker is a select sheet. | Apply the same decision as the row above. | S | feat-refactor, USER-DECISION |
| U1 | src/screens/forms/holding-form/holding-form.screen.tsx:936-1023 | `LoanFormBlock` (88 lines) is a second component in the screen file. It exists only to return null when the type is not loan. | Fold it into `LoanSection`, or give it its own folder, during the U7 split. | S | feat-refactor |
| U1 | src/screens/holding-detail/holding-detail.screen.tsx:273-300, 346-478 | `ValueHeaderSecondary` and `LedgerRowItem` (133 lines) are defined inside the screen file. | Move each into its own folder: `value-header-secondary/`, `ledger-row/`. | M | |
| U1 | src/screens/forms/holding-form/bond-isin-section/bond-isin-section.component.tsx:33-38 (+ index.ts) | The component file also exports the `couponFrequencyLabels` helper. The barrel re-exports it for `ManualBondFields`. | Move all bond label maps into one `bond-labels.ts` next to the sections. | S | feat-refactor |
| U3 | src/screens/forms/holding-form/holding-form.screen.tsx:531, 929 | Uses the banned nullable-map shapes: `editingHolding ? asLoanMeta(...) : null` and `entry === undefined ? null : {...}`. | Replace with `foldMap(maybe(x), f)` from fnts/maybe. | S | feat-refactor |
| U3 | src/screens/forms/holding-identity-field/holding-identity-field.component.tsx:19-22 | `testID !== undefined ? \`${testID}-${suffix}\` : undefined`. This is also a copy of TextField's own `deriveTestID`. | Use one shared `deriveTestID` built on maybe/fmap. | S | |
| U3 | src/screens/holding-detail/holding-detail.screen.tsx:508, 519-521, 621 | Three banned nullable maps: `holding ? holdingValueBreakdown(...) : null`, `bondMeta ? Money.of(...) : null`, and `holding ? holdingIdentity(holding) : undefined`. | Replace with maybe + fmap/foldMap. | S | |
| U3 | src/screens/forms/holding-form/use-bond-isin-mode/use-bond-isin-mode.ts:163-165 | `matchedRow !== undefined && matchedRow.isin === normalizedIsin ? matchedRow.terms : null`. | Use maybe(matchedRow) + a guard for the isin match + fmap. | S | feat-refactor |
| U4 | src/screens/forms/holding-form/use-loan-fields/use-loan-fields.ts:130-131 | `x === undefined ? '' : String(x)`: a fold with a default value, written by hand. | Use `fold(maybe(x), String, () => '')`. | S | feat-refactor |
| U4 | src/screens/holding-detail/holding-detail.screen.tsx:546, 600 | `holding ? derivedEntries(...) : []` and `holding ? !isTimeExempt(...) : true` are folds with a default, written by hand. | Use fold over `maybe(holding)`. | S | |
| U4 | src/screens/forms/holding-form/holding-form.screen.tsx:1067, 1077-1079 | `accountKind ? f(accountKind) : holdingTypes` appears twice. | Use `fold(maybe(accountKind), …)`. This is a judgment call: convert only if it reads cleaner. | S | feat-refactor |
| U5 | src/screens/forms/holding-form/holding-form.screen.tsx:566, 605-626, 698-700, 815-924, 1324-1373, 1494-1533 | If-chains or ternary spreads over the closed `HoldingType` union appear 6 times: seed, createPayload, buildMetadata, firstInvalidFieldRef, saveEdit, and the ISIN reason filter. | Use one `Record<HoldingType, TypeFormSpec>` or `match().exhaustive()`. This is part of the U7 row. | M | feat-refactor |
| U5 | src/screens/holding-detail/holding-detail.screen.tsx:113, 200-222, 312, 360, 579, 782 | `type === 'bond'`, `'term_deposit'`, `'loan'` and `kind === 'derived'` are branched with if/ternary. | Use a Record lookup or `match().exhaustive()`, as in the U7 detail row. | S | |
| U5 | src/screens/forms/lot-form/lot-form.screen.tsx:145-192 | An if/else over the `LotDirection` union ('buy'/'sell'). | Use `match(direction).with('buy',…).with('sell',…).exhaustive()`. | S | |
| U5 | src/screens/forms/holding-form/use-bond-isin-mode/use-bond-isin-mode.ts:76-79 | A ternary maps `reason: 'format'\|'checkDigit'` to an i18n key. | Use a typed `Record<IsinInvalidReason, IsinReasonKey>`. | S | feat-refactor |
| U6 | src/screens/forms/price-point-form/price-point-form.screen.tsx:93, 137, 144, 151-155 | The loan/value switch is repeated 4 times. The error prop nests a ternary inside a `t()` argument inside another ternary. | Compute `isValidValue` and a `copy` object (the loan keys vs the value keys) once per render. | S | |
| U6 | src/screens/forms/holding-form/bond-isin-section/bond-isin-section.component.tsx:127-138 | The code widens to `ChipRow<string>` and casts with `value as BondCouponFrequency`, only to show "no selection". | Give ChipRow an optional `selected`, or add a `null` option state. | S | feat-refactor |
| U8 | src/screens/holding-detail/holding-detail.screen.tsx:849-950 | The styles live inside the screen file. | Move them to `holding-detail.styles.ts` (src/screens/account-detail/account-detail.styles.ts does it right). | S | |
| U8 | src/screens/forms/holding-form/holding-form.contribution-buttons.test.tsx | This is a second, loose test file for the same screen, about one section. | Move it into the `term-deposit-section/` component test when that section is extracted (U7). | S | feat-refactor |
| U9 | src/screens/holding-detail/holding-detail.screen.tsx:703, 912-916 | A hand-rolled hairline `Box` divider. | Use the design-system `Divider`, as holding-form.screen.tsx:1939 does. | S | |
| U9 | src/screens/forms/holding-select-field/holding-select-field.component.tsx:82-117 | A hand-rolled `Pressable` option row with its own selected fill and checkmark. It is the only select field that does not use SelectableRow. | Use `SelectableRow` with `description` and `trailing` props, as src/screens/statement-import/target-holding-sheet/ does. | M | |
| U9 | src/screens/forms/holding-identity-field/holding-identity-field.component.tsx:91-104; holding-identity-field.styles.ts:36-44 | A raw `TextInput` plus a copied bordered-input style and a copied keyboard-accessory wiring. This duplicates TextField. | Give TextField a leading slot (or a hidden-label mode) and compose it here. | M | |
| U10-validate | src/screens/forms/holding-form/holding-form.screen.tsx:2025-2055 | The contribution amount and date fields have no `error` prop. Their errors show as separate FieldErrors, so the field labels never turn red. | Pass the row's error into the TextField/DateField `error` prop, as the annual-rate field (:2100) does. | S | feat-refactor |
| U10-validate | src/screens/forms/holding-form/bond-isin-section/bond-isin-section.component.tsx:126-145 | The coupon-frequency picker's error is a detached FieldError, and its label stays white, because ChipRow has no `error` prop. | Add `error` (→ FieldLabel `invalid`) to ChipRow, as the F4 FieldTrigger change did (5392779). | S | feat-refactor |
| U10-validate | src/screens/forms/holding-select-field/holding-select-field.props.d.ts:12-21 | There is no `error` prop, so the exchange and convert consumers render a detached FieldError with a white label. This twin was missed by the F4 change that gave TargetHoldingField an `error` prop. | Add `error` and forward it to FieldTrigger, as target-holding-field.component.tsx:47 does. | S | feat-refactor |
| U10-tabs | src/screens/forms/lot-form/lot-form.screen.tsx:225-233 | The Buy/Sell toggle uses OptionPills, but the choice shows or hides the Total cost field. By the tabs rule that makes it a SegmentedControl. | Use SegmentedControl + FieldLabel, as the loan-section Schedule control (loan-section.component.tsx:109-119) does. | S | USER-DECISION (kiko-design-system:637 names it as an OptionPills consumer) |
| U10-check | src/screens/forms/holding-select-field/holding-select-field.component.tsx:113-117 | The checkmark is trailing. Every other select sheet (SelectableRow) puts it leading. | This is fixed by the U9 SelectableRow row. | S | |
| U10-case | src/screens/holding-detail/holding-detail.screen.tsx:673 | `holdingDetail.nextInstallment` is a SummaryTable title, which renders as a heading, but its value is sentence case ("Next installment (…)"). The key is not in TITLE_KEYS. | Change it to "Next Installment ({{date}})" and add it to `src/i18n/locales/title-keys.ts`. | S | |
| U10-case | src/screens/forms/holding-select-field/holding-select-field.component.tsx:76 | The field label doubles as the sheet title. That is two UI roles with one key (for example "Return to {{index}}"). | Use a separate sheet-title key, following kiko-translator's two-roles rule. | S | |
| U10-case | src/screens/forms/mode-select-field/mode-select-field.component.tsx:57 | The field label is reused as the sheet title. | Same fix as the row above. | S | |
| U10-capab | src/screens/holding-detail/holding-detail.screen.tsx:579 | Only a deposit or a bond shows the breakdown. For a priced holding (property, metal), the cost basis and gain are never shown, although `principalOrCost` is computed for exactly that purpose (kiko-pricing). | Show cost basis and gain for priced types, or confirm they stay hidden. | M | USER-DECISION |
| U2 | src/screens/forms/holding-form/holding-form.screen.tsx:108, 178-179, 216-217, 312, 345-354, 391, 398, 414, 460, 516, 550-551, 573-580, 644-647, 704-705, 722, 843, 932, 1074, 1100, 1177-1178, 1237, 1275, 1288, 1395-1396, 1443-1444, 1481-1488, 1528, 1539, 1577, 1631, 1831-1852, 2011, 2051, 2199 | Comments carry task, review and spec ids and history: "T25 review round 2, N2", "F4 audit 8", "round-6 device feedback item 3", "spec 6.4 #6", "ponytail", "used to". | Delete the ids and history. Keep only the WHY. | S | feat-refactor |
| U2 | src/screens/forms/holding-form/holding-form.screen.test.tsx:32, 67-83, 123, 151, 211, 346, 419-448, 475, 500, 678, 772-925, 1356-1369, 1529-1530, 1600, 1664, 1788, 1839, 1900, 1949, 1991-2031, 2188, 2264, 2325, 2447, 2467, 2532; holding-form.contribution-buttons.test.tsx:138 | Ids appear in test names and comments, for example `describe('… bond ISIN mode (T25)')`, "(item 2, F3)" and "round-4 device feedback item 10". | Same fix: delete the ids and history. | S | feat-refactor |
| U2 | src/screens/forms/holding-form/use-bond-isin-mode/use-bond-isin-mode.ts:17-19, 45-53, 106-122, 142, 154, 161, 170, 178, 192, 208-217, 229, 247-250, 268; use-bond-isin-mode.test.ts:5, 28-30, 92, 106, 132, 157, 189-192, 221, 265, 307, 322 | Review ids (I1/I3/I5/M3/M6/N1/N2) appear throughout, including inside the biome-ignore OVERRIDE reason at :217. | Keep the WHY. Delete the ids. | S | feat-refactor |
| U2 | src/screens/forms/holding-form/use-loan-fields/use-loan-fields.ts:22, 26-32, 100-102; use-loan-fields.test.ts:51, 67, 69 | "M1, T28 brief", "Minor 10", "T26 review". | Same fix: delete the ids. | S | feat-refactor |
| U2 | src/screens/forms/holding-form/bond-isin-section/bond-isin-section.component.tsx:30-31, 41-42, 47, 130-131; bond-isin-section.props.d.ts:9-11, 34-35, 38, 42-43; bond-isin-section.component.test.tsx:26, 97, 160, 163 | Spec and review ids, plus "used to be written out twice". | Same fix: delete the ids and history. | S | feat-refactor |
| U2 | src/screens/forms/holding-form/loan-section/loan-section.component.tsx:34-39; loan-section.props.d.ts:23 | "T28, spec 5.1", "F3/T24 ruling". | Same fix: delete the ids. | S | feat-refactor |
| U2 | src/screens/forms/holding-form/metal-section/metal-section.component.tsx:20-23; metal-section.props.d.ts:16; metal-section.component.test.tsx:144 | "T20", "F4 audit 8". | Same fix: delete the ids. | S | feat-refactor |
| U2 | src/screens/forms/holding-form/property-section/property-section.component.tsx:13 | "(T16)". | Delete the id. | S | feat-refactor |
| U2 | src/screens/forms/holding-form/manual-bond-fields/manual-bond-fields.component.tsx:22; manual-bond-fields.props.d.ts:9 | "spec 6.3". | Delete the id. | S | feat-refactor |
| U2 | src/screens/holding-detail/holding-detail.screen.tsx:176, 212, 232, 239, 272, 335, 341, 432, 522, 607-609, 646-649, 657, 726, 747-751, 764, 811, 861-871, 889; holding-detail.screen.test.tsx:125-126, 153, 247, 358, 380-394, 409, 423, 534, 662, 714, 740, 854, 890, 1012, 1058, 1081-1096, 1123, 1147, 1177, 1203-1204 | Ids and history: "feedback round-3, item 1", "F4 audit 14", "D2", "N10a", "the old `?? ''` fallback is no longer needed", "lifted verbatim out of the old eager .map". | Same fix: delete the ids and history. | S | test file: feat-refactor |
| U2 | src/screens/forms/lot-form/lot-form.screen.tsx:80, 86, 119, 199; lot-form.screen.test.tsx:181 | "T18", "Review Focus 8", "F4 audit 23". | Same fix: delete the ids. | S | |
| U2 | src/screens/forms/price-point-form/price-point-form.screen.tsx:43, 57-58, 91; price-point-form.screen.test.tsx:138, 159-187 | "T16", "T28 review round 1, Minor 6", "I2". | Same fix: delete the ids. | S | |
| U2 | src/screens/forms/contribution-form/contribution-form.screen.tsx:40-43 | "replacing the old inline collapsible form" (history). | Delete the history. | S | |
| U2 | src/screens/forms/holding-identity-field/holding-identity-field.component.tsx:67-75, 108-113; holding-identity-field.styles.ts:21; holding-identity-field.props.d.ts:73; holding-identity-field.component.test.tsx:182, 192 | "round-3 device-feedback brief, task 1", "round-4 … item 5", "Option A". | Same fix: delete the ids. | S | |
| U2 | src/screens/forms/holding-select-field/holding-select-field.component.tsx:58-62; holding-select-field.styles.ts:4-6; holding-select-field.props.d.ts:9; holding-select-field.component.test.tsx:73 | "NOTE: this moved … WAS already", "no longer needs its own copy", "(Requirement C)". | Same fix: delete the history and ids. | S | |
| U2 | src/screens/forms/mode-select-field/mode-select-field.component.tsx:12 | "rather than the former inline ChipRow". | Delete the history. | S | |
| S-STYLE (blank line) | src/screens/forms/holding-form/holding-form.screen.tsx:1335, 1351, 1356, 1367, 1372, 1431, 1451, 1454, 1467, 1497, 1533, 1904, 2019 | A `return` or `if` has no blank line before it. | Add the blank line (kiko-code-style "Blank lines before statement blocks"). | S | feat-refactor |
| S-STYLE (blank line) | src/screens/forms/lot-form/lot-form.screen.tsx:72, 131, 204 (JSX 226-227) | Same issue. Adjacent JSX siblings also have no blank line between them. | Add the blank lines. | S | |
| S-STYLE (blank line) | src/screens/forms/price-point-form/price-point-form.screen.tsx:94, 121 | Same issue. | Add the blank lines. | S | |
| S-STYLE (blank line) | src/screens/forms/contribution-form/contribution-form.screen.tsx:85, 106 | Same issue. | Add the blank lines. | S | |
| S-STYLE (blank line) | src/screens/forms/holding-form/use-bond-isin-mode/use-bond-isin-mode.ts:222 | Same issue. | Add the blank line. | S | feat-refactor |
| S-STYLE (blank line) | src/screens/forms/holding-form/bond-isin-section/bond-isin-section.component.tsx:112-122, 142-143; bond-isin-section.component.test.tsx:170 | Adjacent JSX siblings have no blank line between them. The test has an `if` with no blank line before it. | Add the blank lines. | S | feat-refactor |
| S-STYLE (blank line) | src/screens/holding-detail/holding-detail.screen.tsx:376-387, 444-466, 653-654, 669-670; holding-detail.screen.test.tsx:366, 1172 | Adjacent JSX siblings have no blank line between them; the test has `return`/`if` with no blank line. | Add the blank lines. | S | test file: feat-refactor |
| S-STYLE (blank line) | src/screens/forms/holding-select-field/holding-select-field.component.tsx:105-110 | Two sibling `Text` nodes have no blank line between them. | Add the blank line. | S | |
| S-STYLE (blank line) | src/screens/forms/holding-form/holding-form.screen.test.tsx:41, 100, 105, 108, 428, 452 | A `return` or `if` has no blank line before it. | Add the blank lines. | S | feat-refactor |
| S-STYLE (import) | src/screens/forms/lot-form/lot-form.screen.tsx:2-4, 8-26, 28-31; lot-form.screen.test.tsx:1-2, 8-9 | The `../` group is sorted alphabetically, not by length. Line 2 (77 characters) comes before line 4 (47). | Re-sort each group by the length of its ending line, ascending. Reference: holding-form.screen.tsx:12-81, which is correct. | S | |
| S-STYLE (import) | src/screens/forms/price-point-form/price-point-form.screen.tsx:2-4, 8-20, 23-29; price-point-form.screen.test.tsx:1-2, 7-8 | Same alphabetical sort. | Same fix. | S | |
| S-STYLE (import) | src/screens/forms/contribution-form/contribution-form.screen.tsx:2-4, 8-16, 19-25; contribution-form.screen.test.tsx:1-2, 8-9 | Same alphabetical sort. | Same fix. | S | |
| S-STYLE (import) | src/screens/forms/holding-identity-field/holding-identity-field.component.tsx:2-3, 12-13; holding-identity-field.component.test.tsx:1-3, 5-6, 9 | Alphabetical sort. In the test, a `../` import (:9) sits in the `./` group. | Re-sort, and move line 9 into group 2. | S | |
| S-STYLE (import) | src/screens/forms/holding-form/property-section/property-section.component.tsx:5-7; property-section.props.d.ts:4-5 | Longer lines come before shorter ones (98 before 59, 78 before 75). | Re-sort by length. | S | feat-refactor |
| S-STYLE (import) | src/screens/forms/holding-form/metal-section/metal-section.props.d.ts:4-5 | 89 before 75. | Swap the two lines. | S | feat-refactor |
| S-STYLE (import) | src/screens/forms/holding-form/holding-form.screen.test.tsx:1-2, 7-8; holding-form.contribution-buttons.test.tsx:1-3, 6-10 | Not sorted by length. Line 10 of the second file (a `../` import) sits in the external block after the bare-import barrier without a blank line. | Re-sort, keep the barrier in place, and add the missing blank line before group 2. | S | feat-refactor |
| S-STYLE (import) | src/screens/forms/holding-select-field/holding-select-field.component.test.tsx:1-2 | 66 before 42. | Swap the two lines. | S | |
| S-STYLE (import) | src/screens/holding-detail/holding-detail.screen.test.tsx:1-3, 15-24 | Not sorted by length (for example :22-23 come after longer lines). | Re-sort. | S | feat-refactor |
| G1 | src/screens/forms/holding-form/holding-form.screen.tsx:291-296, 650-657, 1043-1045, 1762-1765, 1944-1947 | Stale comments: the ledgerless list omits metal and loan; "a bank create offers only term_deposit / bond" (card and metal are also offered); "deposit/bond write metadata". `saveReasonsFor` is a wrapper that returns one boolean. | Correct the comments and inline `saveReasonsFor`. | S | feat-refactor |
| G1 | src/screens/holding-detail/holding-detail.screen.tsx:483-485, 543-544 | "holdingsRepo exposes no single-row lookup" is false (`byIdQuery` exists; the full list is still needed for `holdingNameById`). "swipe-to-delete" refers to a removed feature. | Correct both comments. | S | |
| G1 | src/screens/forms/holding-select-field/holding-select-field.component.tsx:94-98 | The comment explains a "light theme". The app is dark-only. | Delete the comment. | S | |
| G1 | src/screens/forms/holding-form/use-loan-fields/use-loan-fields.ts:31 | The comment names `MAX_TERM_MONTHS`. The constant is `MAX_LOAN_TERM_MONTHS`. | Fix the name, or rename the constant when it is shared (BUG row 2). | S | feat-refactor |
| G2 | src/screens/forms/lot-form/lot-form.screen.tsx:46-50, 91-95 | This is the 3rd copy of `startOfToday`. It also uses `allQuery()` + `find`, with a false "no single-row lookup" comment. | Use `startOfLocalDay(Date.now())` (src/dates/local-day, as use-bond-isin-mode.ts:200 does) and `holdingsRepo.byIdQuery` (as holding-form.screen.tsx:1087 does). | S | |
| G2 | src/screens/forms/price-point-form/price-point-form.screen.tsx:36-40, 49-54, 93 vs 152 | The same two copies, plus the validity expression is written twice (in save and in render). | Same fixes, and compute the validity once per render. | S | |
| G2 | src/screens/forms/contribution-form/contribution-form.screen.tsx:34-38, 46-50, 85 vs 137, 105 | The same copies and the double validity check. The save-error Alert uses `forms.contribution.error*`, while its siblings use `forms.fields.saveError*` (lot-form.screen.tsx:203 was unified in F4 897c9fa). | Same fixes. Use the shared Alert keys (the message text changes). | S | feat-refactor |
| G2 | src/screens/holding-detail/holding-detail.screen.tsx:346-478, 819-825, 885-888 | The ledger's transaction row re-implements Home's `TransactionRow` (src/screens/home/transaction-row/). The day header re-implements Home's `sectionHeader` (home.styles.ts:39). | Share one row and one day-header component. | M | |
| G2 | src/screens/forms/holding-form/holding-form.screen.tsx:656, 814, 1678; 1046-1051 vs bond-isin-section.component.tsx:33-38 | The name-empty check is written 3 times. The monthly, quarterly and annually labels are defined in two maps. | Use one `isNameMissing` helper and one frequency label module. | S | feat-refactor |
| G2 | src/screens/forms/holding-form/bond-isin-section/bond-isin-section.component.tsx:78-79, 151-153 | The section re-runs `validateIsin` and re-derives the "not in register" / "not loaded" reason that `bondIsinReasonKey` (use-bond-isin-mode.ts:86-90) already computed. | Pass `isinReasonKey` in as a prop. | S | feat-refactor |
| G3 | src/screens/forms/holding-identity-field/ (folder) | The name says "Holding", but account-form and the settings categories also use it. | Rename it `EntityIdentityField` (4 consumers). | M | |
| G3 | src/screens/forms/holding-form/holding-form.screen.tsx:169 vs 185, 1223, 1280 | `seedBondFields` vs `seedBondMetaFields` is a confusing pair. `setRecap` does not match `recapitalization`. `metalMetal` is a stutter. | Rename. | S | feat-refactor |
| G3 | src/screens/holding-detail/holding-detail.screen.tsx:108 | `breakdownRows(type: string)` takes a loose `string`. | Type it `HoldingType`. | S | |
| G3 | src/screens/forms/mode-select-field/mode-select-field.component.tsx:50, 67 | The name is generic, but the component is transaction-only (`FormMode`, `transaction-type-*` testIDs). | Rename it `TransactionTypeField`. | S | |
| G4 | src/screens/forms/holding-form/holding-form.screen.tsx:1025-2337 | One 1300-line component (the file has 2339 lines) mixes account and type options, hydration, the state of 5 types, validation, scroll-to-invalid, create/edit save, returnTo navigation, and render. | Do the U7 split. Move the returnTo navigation into a helper. | L | feat-refactor |
| G4 | src/screens/holding-detail/holding-detail.screen.tsx:480-847 | 6 live queries, valuation, ledger merge and grouping, header, footer and list are in one component. | Split into a `useHoldingDetailData` hook, a `HoldingSummary` component and a `LedgerList` component. | M | |
| G5 | src/screens/forms/lot-form/lot-form.screen.tsx:97-98, 195-197 | The screen rebuilds `metadata` and writes lots through the generic `holdingsRepo.update`. Its twin, contribution-form, calls `holdingsRepo.appendDepositContribution`. | Add `holdingsRepo.appendLot(holdingId, lot)`. | S | |
| G5 | src/screens/forms/holding-identity-field/holding-identity-field.styles.ts:26-28 | The styles hard-code IconEditor's internal chip width (`spacing(11)`) plus the gap. | Export the chip size from icon-editor and read it here. | S | |
| G7 | src/screens/forms/holding-form/holding-form.screen.test.tsx:1-2689, 89-123 | One 2689-line file covers every holding type. It has an ad hoc table-keyed `useLiveQuery` mock. No test covers BUG rows 1-3. | Split the tests per section and hook (with U7). Add a shared `src/test-support/mock-live-query`. Add tests for the 3 bugs. | L | feat-refactor |
| G7 | src/screens/forms/holding-form/holding-form.contribution-buttons.test.tsx:13-58 | The test mocks Button to record `variant`/`size` props, which asserts implementation details. | Assert the rendered output in the section's own test; button tests already own the variant-to-style mapping. | M | feat-refactor |
| G7 | src/screens/holding-detail/holding-detail.screen.test.tsx:169-205, 266-300, 534-544 | The "glass card (M2 …)" test only asserts that a testID exists, and its name is stale (rows are `Card`). `seed()` takes 8 positional `unknown` parameters. The live-query and repo stubs are ad hoc. | Assert the Card or delete that test. Use an options object with typed `HoldingRow` factories and the shared live-query mock. | M | feat-refactor |
| G7 | src/screens/forms/lot-form/lot-form.screen.test.tsx:21-28 | Hand-rolled `useLiveQuery` + repo `toSQL` stubs. 28 test files in src repeat this. | Use the shared mock helper (to be created). | S | |
| G7 | src/screens/forms/price-point-form/price-point-form.screen.test.tsx:20-35 | Same hand-rolled stubs. | Same fix. | S | |
| G7 | src/screens/forms/contribution-form/contribution-form.screen.test.tsx:21-30 | Same hand-rolled stubs. | Same fix. | S | |


### R2 — Transaction-form, account-form and form fields

Correctness bugs come first. `BUG` = correctness bug, placed before the brief's own rule IDs.

| Rule | file:line | What is wrong | Fix (the existing pattern or rule to apply, name a file that already does it right when one exists) | Effort (S/M/L) | Tags |
|---|---|---|---|---|---|
| BUG | src/screens/forms/transaction-form/transaction-form.screen.tsx:1920,2269,2297-2304,2359-2366 | The empty-create form (the Home "+" button) never checks for a picked holding. If `holdingId` is undefined, `writeManual` skips `recordManual` without a word, and `performSave` then calls `goBack()`. Scenario: fresh install, or only synced holdings → tap +, enter 100, pick a category, Save → the form closes and nothing is saved. With a description, the "Apply to all" sheet opens and writes a name rule for a row that does not exist. | Add a `primaryHolding` validation field (blocks Save when `holdingId === undefined` on empty-create) with its error shown under the holding picker. | S | |
| BUG | transaction-form.screen.tsx:1532-1535,1586,1609-1611,1669-1673,2365,2084-2102 | Picks that depend on the primary holding are not reset when the user re-points it. (a) Mode `exchange`/`split` stays after switching to a card. `resolveModeOptions` hides those modes, but `isExchange`/`isSplit` stay true, so an exchange or split is recorded from a non-cash source, which bypasses `isExchangeCreateSourceType`. (b) Exchange To = B, then switch the source to B → exchange B→B. (c) Split returns picked in UAH, then the payer changes to a BTC holding → `canSaveSplit` does not check currency, and `saveSplit` writes return amounts at the payer's scale onto the UAH holdings. | In the primary-holding `onSelect`: reset `mode` if it is not in the new `modeOptions`, clear the destination if it is excluded, and drop returns not in the new options. Or check membership in the save guard. Behavior change. | M | |
| BUG | transaction-form.screen.tsx:603-629 | Split-return picker uses `() => true` as its type gate, so ledgerless holdings in the payer's currency (loan, bond, term_deposit, property_item, metal — metal is always UAH) are offered. Scenario: UAH cash payer plus a UAH gold holding → "Return to 1" lists Gold → a +X manual row lands on a holding whose value comes from lots only, so the return vanishes from net worth. | Use the same gate as `buildPrimaryOptions` (`isTransactionEligibleType`, :698-726); Exchange already excludes these (`exchange-destination.ts:16`). | S | |
| U10-validate | transaction-form.screen.tsx:300-305,350-360,442-447,288-293,336-348,429-439,1851-1852 | Scroll-to-first-invalid picks the wrong field. Split checks category (bottom) before the payment amount (top). A bad payment amount is blamed on `splitReturns`, not `amount`. Exchange checks To before Value Out, which is above it. Only ONE field ever shows an error per press. | Check fields in visual order. Blame `amount` for the payment. Show every invalid field's error, as holding-form does. | M | |
| U10-validate | transaction-form.screen.tsx:1347-1363,1225-1276 | Category error is an external `FieldError` under `CategoryField`, so the label never turns red. Split return rows get no per-row error, only one combined message under the list. | Pass `error` through `CategoryField` to `FieldTrigger` (added in 5392779). Give each return row its own error. | M | feat-refactor |
| U10-validate | src/screens/forms/category-field/category-field.component.tsx:28-35 (+ category-field.props.d.ts) | No `error` prop, even though `FieldTrigger` supports one. Every caller has to hand-roll an external `FieldError`. | Add `error?: string` and forward it to `FieldTrigger` (same contract as `DateField`). | S | feat-refactor |
| U10-validate | src/screens/forms/exchange-fields/exchange-fields.component.tsx:59-72 | Destination error is an external `FieldError`; the "To" label never turns red. | Forward `error` via `HoldingSelectField` → `FieldTrigger` (that field needs an `error` prop; another reviewer owns it). | S | feat-refactor |
| U10-validate | src/screens/forms/convert-exchange-fields/convert-exchange-fields.component.tsx:55-68 | Same external-`FieldError` twin for the counterpart picker. | Same fix as `ExchangeFields`. | S | feat-refactor |
| U10-validate | src/screens/forms/account-form/account-form.screen.tsx:380-383,508-515 | Cash initial value is silently clamped (`Math.max(0, parseAmount(x) \|\| 0)`): a pasted "-5" or a malformed value saves 0 with no error. | Validate on Save with an error under the field, like the F4 fix `ba6a3d2` (metal purity). Behavior change. | S | USER-DECISION (blank = 0 allowed?) |
| U10-capab | src/screens/forms/bank-type-field/bank-type-field.component.tsx:130-147 | Shows only the sync and import icons. Every bank supports the generic column-mapping import (kiko-domain), but no bank shows that capability's icon (`increase.indent`, user 2026-09-24). | Add the column-mapping capability icon to every bank row. | S | feat-refactor |
| U10-capab | account-form.screen.tsx:546,550 | Hardcodes `bankId === 'monobank'` for the Connect field and the import-only hint. | Branch on `bankCatalog` `connectable` (kiko-domain: callers never hardcode a provider). | S | |
| U10-case | bank-type-field.component.tsx:80 (label from account-form.screen.tsx:500) | The field label `forms.account.bankType` ("Bank type") is also used as the sheet title, so the Title Case role renders "Bank type". | Add a separate sheet-title key (pattern: `statementImport.chooseHoldingSheetTitle`) and add it to `TITLE_KEYS`. | S | |
| U10-tabs | transaction-form.screen.tsx:2323-2334 | The transaction type (income/expense/exchange/split) is a select sheet, but the choice changes the visible fields (Exchange and Split fields). By rule U10-tabs this should be a `SegmentedControl`. On edit only income/expense show, and they do not change fields. | Decide: tabs for create (4 options) vs keep the sheet. | M | USER-DECISION |
| U1 | transaction-form.screen.tsx:112,154,766,1078,1211,1329,550 | Six module-level functions return JSX (`renderReadOnlyNotice`, `renderCommentRow`, `renderPrimaryHoldingField`, `renderFieldGroup`, `renderSplitReturns`, `renderModeAndActions`). Two are large. The screen module also exports `canSaveSplit`. | Move each into its own component folder (as `exchange-fields/` already is). Move `canSaveSplit` into a domain unit (e.g. `src/transactions/split/`) with its own test. | L | |
| U1 | src/screens/forms/scroll-to-field/scroll-to-field.ts:43 | Exports a hook (`useHeaderInset`) plus 2 functions and a type. | Move the hook to `use-header-inset/`. | S | |
| U2 | transaction-form.screen.tsx:130-139,506,542-544,568,594-596,631,657-658,806,842,961,973,1039,1044,1054,1157,1205-1206,1219,1228,1257,1344,1445,1453-1463,1486,1497,1504,1519,1526,1552,1640-1641,1861-1886,1928-1932,2033,2059-2061,2306-2309,2355,2407,2450-2461,2502-2506,2572 | Task/review/spec IDs and history in comments ("F3 part 1 fix round 1", "item 17", "Requirement C", "D1-Q3", "Round-6 … used to", "Previously…", "DEFAULT (M1…)"). | Keep only the WHY; delete the IDs and history. | M | |
| U2 | account-form.screen.tsx:56,60,79,104,132,145-148,164,250,259-261,278,285,329-333,350,370-372,396-402,450,520-521 | "§2.1", "T16/T20", "C-1", "C-2", "Global Constraint 2", "Option A", "F2 fix", "used to", "any more". | Same. | S | |
| U2 | bank-type-field.component.tsx:16,38-39,69,91,112-119,149 | "T22", "device-feedback-round-3/4 item 3/7", "F4 item 3", "F2 fix", "now". | Same. | S | |
| U2 | scroll-to-field.ts:24-29,79-80,105-106,128 | "round-3/round-4 device feedback", "used to", "this replaced". | Same. | S | |
| U2 | src/screens/forms/account-kind-field/account-kind-field.component.tsx:12-16; account-kind-field.props.d.ts:24,33-37 | "(T15)", "former inline ChipRow". | Same. | S | |
| U2 | src/screens/forms/date-field/date-field.component.tsx:110-113; date-field.props.d.ts:22 | "Option A", "it used to … now". | Same. | S | |
| U2 | src/screens/forms/date-time-row/date-time-row.component.tsx:12-13; date-time-row.styles.ts:4-5 | "round-6 device feedback item 1 — used to stack". | Same. | S | |
| U2 | category-field.component.tsx:102; category-field.styles.ts:4-6 | "(F5 fix)", "now lives … no longer needs". | Same. | S | |
| U2 | src/screens/forms/description-suggestions/description-suggestions.component.tsx:15,44; description-suggestions.props.d.ts:10 | "A1", "D1". | Same. | S | |
| U2 | convert-exchange-fields.component.tsx:13 | Spec section reference. | Same. | S | |
| U2 | src/screens/forms/amount-format/amount-format.ts:30-31,64-66 | "The old `replace`…", "used to strip". | Same. | S | |
| U2 | transaction-form.screen.test.tsx:25-31,250-251,635,704,835,933,1341,2851 (+ inline comments) | Describe names carry "(A1)", "(D1)", "(D2)", "(B)", "(item 17, F3)", "phantom gap regression"; comments say "Round-6 … item 3", "now". | Name behaviors, not task IDs. | S | |
| U2 | account-form.screen.test.tsx:25-27,40-44,52-55,102 | "(T15)", "used to read", "now". | Same. | S | |
| U2 | bank-type-field.component.test.tsx:10,61,172; date-time-row.component.test.tsx:20-21; date-field.component.test.tsx:143,155; exchange-fields.component.test.tsx:82-83; convert-exchange-fields.component.test.tsx:103; scroll-to-field.test.ts:105,117,192; category-field.component.test.tsx:127,138 | Test names and comments carry "round-3", "F4 item 3", "T22", "Option A", "used to". | Same. | S | |
| U3 | bank-type-field.component.tsx:51-52 | `selected === null ? undefined : bankCatalog.find(...)` (the ternary is also redundant: `find` already returns undefined). | Plain `find`, or `foldMap(maybe(selected), …)`. | S | |
| U3 | date-field.component.tsx:21-22,60,75-78 | `testID !== undefined ? … : undefined`; `value === null ? null : new Date(value)`; `markedDates` ternary. | `fmap`/`foldMap` from `fnts/maybe`. | S | |
| U3 | transaction-form.screen.tsx:872,969,983-985,1811,1852 | `row.category ? row.category.toLowerCase() : null`, `existing ? f(existing) : null`, a nested nullable ternary. | `foldMap(maybe(x), f)`. | S | |
| U4 | transaction-form.screen.tsx:196-200,1541,222-233 | Hand-rolled nullable folds, one duplicated (`holdingSuffix` vs `amountSuffix`). | One `maybe`-based helper, used everywhere. | S | |
| U4 | account-form.screen.tsx:266-306 | Three identical `try { await ensureAccount() } catch { return false }` blocks. | One `either(ensureAccount)` + `bifold` helper (these return data, not UI feedback). | S | |
| U5 | transaction-form.screen.tsx:230,283-483,1610-1611,2210-2230,1078-1171,979,989-1000,1726-1761 | Branching over the closed `FormMode` union through booleans (`isExchange`/`isSplit`/`converting`) in 5 separate if-chains. Direction ternaries over `ExchangeConvertDirection`. `plan.kind` if-chain over the `HydrationPlan` union. | Derive one variant union (`convert \| exchange \| split \| readOnly \| edit \| create`) and use `match().exhaustive()`. Use `Record<Direction, …>` for the labels and gate. | M | |
| U5 | account-form.screen.tsx:380,497,533,546,550,567 | Repeated `kind === 'cash' / 'bank' / 'crypto'` checks in save and in the JSX. | `Record<Kind, Section>` or `match(kind)`. | M | |
| U6 | description-suggestions.component.tsx:65 | Reuses the single-select `ChipRow` as a pick list via the `selected=""` hack. | A plain chip list, or give `ChipRow` a no-selection mode. | S | USER-DECISION |
| U6 | transaction-form.screen.tsx:949-959,603-610 | `resolveConvertView` takes 9 positional params; `buildReturnOptions` takes 6. | Params objects (as `resolveHydration` already does). | S | |
| U7 | account-form.screen.tsx:497-580,83-99,116-123,428-431,160 | Diverges from its sibling holding-form in four ways. (1) Per-kind sections are inline JSX; holding-form uses section components (`metal-section/`, `loan-section/`). (2) Kind uses a select sheet; holding-form's Type uses `ChipRow` (holding-form.screen.tsx:1949). (3) The icon is seeded with the kind glyph; holding-form keeps null and falls back to the type glyph (:1923). (4) The error flag is named `showNameError`; every other form uses `attemptedSave`. | Pick one pattern for each concern and apply it to both forms. | M | feat-refactor (holding-form side) |
| U7 | transaction-form.screen.tsx:267-483,1689-1694 | Validation is 3 mirrored function families (disabled/reason/field) with one error shown at a time. holding-form uses per-section `xxxReasonKey` + `fieldErrorMessage`. The hydration latch is `useState` here and `useRef` in account-form. | Adopt holding-form's reason-key pattern; one latch style. | M | |
| U7 | bank-type-field.component.tsx:54-62,77-82 | Sheet has no `gap` (siblings use `gap={2}`); `onSelect`/close order differs from `AccountKindField`/`ModeSelectField`. | Match the siblings. | S | |
| U8 | transaction-form.screen.tsx:2554-2578 | `StyleSheet.create` sits inside the screen file; ~1400 lines of helpers are loose in one module. | `transaction-form.styles.ts`, plus helper/section folders co-located under `transaction-form/`. | M | |
| U9 | date-field.component.tsx:89-108; date-field.styles.ts:12-28 | Hand-rolls `FieldTrigger` (same label, bordered row, icon, value, disabled style, error, `deriveErrorTestID`). | Compose `FieldTrigger` + `BottomSheet`; delete the duplicate styles. | S | |
| U9 | time-field.component.tsx:56-76; time-field.styles.ts:10-27 | Same re-implementation. It also diverges from its `DateField` twin: plain `Text` label, no `required`, no `error`. | Compose `FieldTrigger` (gains `required`/`error` for free). | S | |
| U9 | transaction-form.screen.tsx:112-128,2353 | Notice passes an inline `backgroundColor` built from a threaded theme color. | `<Box background="surfaceHigh">` (Box already has this prop). | S | |
| U9 | src/screens/forms/color-picker/color-picker.component.tsx:31-35 | Label is a raw `Text` caption; `ChipRow` and the other fields use `FieldLabel`. | `FieldLabel`. | S | |
| S-DS | src/screens/forms/chip-row/chip-row.component.tsx:61,47-50; chip-row.styles.ts:4-7,12,18-20 | `SymbolIcon size={18}` literal; disabled `opacity: 0.5` (should be the `DISABLED_OPACITY` token, 0.4); `flexDirection` in a style instead of `Box direction="row"`; chip about 36pt tall with no hitSlop (under 44pt). | `theme.iconSizes.body`, `DISABLED_OPACITY`, `Box direction`, hitSlop. | S | |
| S-DS | color-picker.styles.ts:6-9,16-17,27 | `borderRadius: 999` / `borderWidth: 2` literals; swatch tap target 40pt; row `flexDirection` in style. | Radii token, 44pt target, `Box direction`. | S | |
| S-DS | transaction-form.screen.tsx:2524 | `SymbolIcon size={22}` literal. | `theme.iconSizes.heading`. | S | |
| S-I18N | color-picker.component.tsx:46 | VoiceOver label is `${prefix} ${name}` with the raw English palette key ("yellow"), even in the uk UI. | Add palette name keys to the catalogues. | S | |
| S-ARCH | account-form.screen.tsx:231-243,373-374,407-408 | `create`/`update` and then a separate `setIcon`: two transactions, so a failure leaves a partial write. `update(patch)` already accepts `icon`. | One `update(id, { name, color, bankId, icon })`; pass `icon` to `create`. | S | |
| S-STYLE | account-form.screen.tsx:241,244,256,275,293,306 | Missing blank line before `if`/`return`. | Add the blank lines. | S | |
| S-STYLE | account-form.screen.test.tsx:36,117,131,148,157,185; transaction-form.screen.test.tsx:49,176-179,1904,2745,2770 | Missing blank line before `if`/`return`. | Add the blank lines. | S | |
| S-STYLE | bank-type-field.component.tsx:140; chip-row.component.tsx:65; transaction-form.screen.tsx:169 | No blank line between adjacent JSX siblings. | Add the blank lines. | S | |
| S-STYLE (imports) | transaction-form.screen.tsx:7,12-21,48,51,56,65,75 | Not length-sorted (the multiline `react` import ends in a 15-char line and must come first). `../` is split from `../../../` by a blank line inside one group. | Re-sort; `../**` is one group. | S | |
| S-STYLE (imports) | account-form.screen.tsx:4,8,23,30,33,39 | Length sort broken; blank line inside the `../**` group at :33. | Re-sort. | S | |
| S-STYLE (imports) | chip-row.component.tsx:2,7,8,11; color-picker.component.tsx:10; convert-exchange-fields.component.tsx:3; exchange-fields.component.tsx:3; date-time-row.component.tsx:6 | Length sort broken. | Re-sort. | S | |
| S-STYLE (imports) | Tests: transaction-form.screen.test.tsx:2,13 (blank inside group :12); account-form.screen.test.tsx:2,3,7,9 (no blank line around the side-effect import); category-field.component.test.tsx:2; chip-row.component.test.tsx:2; color-picker.component.test.tsx:4; convert-exchange-fields.component.test.tsx:2,8; date-field.component.test.tsx:2; date-time-row.component.test.tsx:2; exchange-fields.component.test.tsx:2; time-field.component.test.tsx:2; account-kind-field.component.test.tsx:6-7; bank-type-field.component.test.tsx:2; description-suggestions.component.test.tsx:4 | Length sort broken, or groups not blank-line separated at the side-effect import. | Re-sort; never move an import across the side-effect import. | S | |
| G1 | transaction-form.screen.tsx:1311-1314,2489 | `ModeAndActionsProps.isReadOnly` is passed but never read. | Delete it. | S | |
| G1 | transaction-form.screen.tsx:2084,2114-2127,2154-2167,2194-2204 | Guards inside `saveSplit`/`saveExchange`/`saveConvert`/`tryWriteManual` repeat the save gate and can never fire. | Keep one gate. | S | |
| G2 | transaction-form.screen.tsx:283-483 | `isSaveDisabled`, `saveDisabledReason` and `saveDisabledField` are three hand-mirrored families of 5 functions each ("must never disagree"). | One `saveBlock(params) → { field, messageKey } \| null`. | M | |
| G2 | transaction-form.screen.tsx:611-615,713-717 | The synced-holding id-set filter is copied in 2 builders. | Share one helper. | S | |
| G2 | transaction-form.screen.tsx:698-726 vs src/screens/holding-detail/holding-detail.screen.tsx:224 | "Can take a manual transaction" (not ledgerless, not synced) is implemented twice, in two screens. | Move a `canRecordManualTransaction(holding, account)` predicate into `src/holdings/`. | S | |
| G2 | account-form.screen.tsx:219-229 vs 352-361 | The name-required block + `scrollToField` is copied between `ensureAccount` and `save`. | One `blockOnEmptyName()`. | S | |
| G2 | account-form.screen.tsx:193-207,436-440; transaction-form.screen.tsx:1612-1623,2243-2252,2340-2343 (+ holding-form, lot-form, price-point-form, contribution-form, column-mapping, statement-import) | The same scroll-to-invalid wiring (`useAnimatedRef` + `useScrollOffset` + `useHeaderInset` + `contentHeightRef` + `onContentSizeChange`) is copied in 8 screens. | A `useScrollToField()` hook in `scroll-to-field/`. | M | |
| G2 | account-form.screen.tsx:417; transaction-form.screen.tsx:1941-1943 (+ holding-form:1877, lot-form:203, price-point-form:120) | The save-error `Alert` is copied 5×. | One shared `showSaveErrorAlert(t)`. | S | |
| G2 | account-kind-field.component.tsx:18-78 vs mode-select-field.component.tsx | Near-identical select fields (`FieldTrigger` + `BottomSheet` + `SelectableRow` map). | Decide whether to extract a generic `SelectField` (memory warns against wrappers over diverging sites). | M | USER-DECISION |
| G2 | date-field.component.tsx:21-22 | `deriveErrorTestID` is a copy of the ones in `field-trigger` and `text-field`. | Removed by the `FieldTrigger` fix in the U9 row above. | S | |
| G3 | transaction-form.screen.tsx:283,1840,1329,2483-2486,1814-1818 | `isSaveDisabled`/`disableSave` name a state that never disables Save. `renderModeAndActions` renders no mode, and its call-site comment still says "mode chip row". | Rename (e.g. `saveBlock`, `renderCategoryAndConvert`); fix the comments. | S | |
| G3 | chip-row.component.tsx:13-18,53-58; category-field.component.tsx:24-27; date-field.styles.ts:24; time-field.styles.ts:21; bank-type-field.component.tsx:83-86,106-110; src/screens/forms/exchange-fields/exchange-fields.props.d.ts:13; account-form.screen.tsx:234,397 | Stale or misleading comments: the "kind and currency pickers" ChipRow; "flips to black on light" and "both themes" in a dark-only app; "sign ChipRow"; "footer caption" for a caption rendered at the top; a comment attached to the wrong line; `buildDestinationOptions` (the real name is `buildExchangeOptions`); kind lists that miss `debt`. | Fix or delete them. | S | |
| G4 | transaction-form.screen.tsx:1418-2552 (module 2580 lines) | The component is ~1130 lines and mixes 7 live queries, hydration, convert prefill, category auto-pick and suggestions, split-row state, validation and scrolling, 4 save paths, and the override sheet. | Split into hooks (`useTransactionFormData`, `useTransactionHydration`, `useSplitReturns`, `useCategoryOverride`) and components (`SplitReturnsSection`, `CategoryOverrideSheet`, `ReadOnlyNotice`, `CommentRow`), as holding-form does with `use-bond-isin-mode/` and `*-section/`. | L | |
| G4 | account-form.screen.tsx:82-583 | Mixes the create latch and 3 connect handlers, hydration, save routing, and 3 inline kind sections. | `useAccountCreateLatch` + `CashSection`/`BankSection`/`CryptoSection`. | M | |
| G7 | transaction-form.screen.test.tsx:61,73,881,1277,2486,1181,1916,2428,154-163,122-144,262-268,250,2876 | Dead `mockRemove` (the form no longer deletes). `isSaveDisabled` helper copied 3× and reads `.parent?.props.accessibilityState`. `setLiveData` takes 8 positional params. Row types are hand-written instead of the schema `$inferSelect` types. The `flushDeferredModeSelect` comment claims `ModeSelectField` defers `onSelect` (false). "Save enables" is stale. `canSaveSplit` unit tests live in the screen test. | Delete the dead mock. Use `getByRole('button', { name: 'Save' })` + `toBeEnabled()`. Use an options object and schema types. Move the `canSaveSplit` tests with the unit. | M | |
| G7 | account-form.screen.test.tsx:247-264,1116-1127,817-832,43 | "offers the four account kinds" checks 4 of 6 kinds. "lists all six banks" hard-codes 6 of the 10 catalog banks (twice). `selectKind` omits `debt`. No debt-create test. | Iterate `kinds`/`bankCatalog`; add the debt case. | S | |
| G7 | transaction-form.screen.test.tsx:65-111; account-form.screen.test.tsx:78 (+25 other test files) | The fake query `{ toSQL: () => ({ sql: '', params: [] }) }` is hand-rolled in 27 test files. | A shared `fakeQuery()` in `src/test-support/`. | S | |


### R3 — Statistics, home and accounts screens

| Rule | file:line | What is wrong | Fix | Effort | Tags |
|---|---|---|---|---|---|
| BUG | src/screens/statistics/statistics.screen.tsx:232,848-852 | The account filter matches on `account.name`. Two accounts named "Binance" give two options with the same `value`: duplicate React key and testID, and tapping one checks both. Rename a filtered account while the Statistics tab stays mounted: `selectedAccounts` keeps the old name, every chart goes empty, the chip still shows "Accounts · 1" and no row is checked. | Use `account.id` as `value` and in `selectedAccounts`; show the name through `label`, as the category options already do. Behavior change. | S | |
| BUG | src/screens/home/home.screen.tsx:244-257,323 | Same bug on Home, the twin of the row above. Removing same-named duplicates hides the second account, and one chip then matches both accounts' rows. Renaming while filtered empties the list. | Match on `row.accountId`, which `listAllWithContextQuery` already returns (transactions.repo.ts:430). | S | |
| BUG | src/screens/home/filter-menu/filter-menu.component.tsx:16,20-21,46 | `FILTER_ALL = 'All'` uses the same value space as account names. An account named "All" shows as checked whenever nothing is selected, tapping it clears the filter instead of selecting it, and its key collides with the synthetic "All" row. The twin is trend-filter-field.component.tsx:184-186,311. | Use a sentinel no user can type, or model the "All" row outside `options`. | S | |
| BUG | src/screens/statistics/statistics.screen.tsx:666-709 | The category menu options come from the range-scoped `allCategorySlices`; the selection is not range-scoped. Select "Groceries", then pick a week with no groceries: every category is excluded, the donut shows "No spending to show", the chip shows "Categories · 1", and the menu lists no checked row. The same happens for a saved manual trend key (trend-filter-field.component.tsx:186,302): it is not listed, so it cannot be unchecked. | Add the selected keys to the options, or prune the selection when the range changes. Behavior change. | M | USER-DECISION: keep hidden selections visible or prune them |
| BUG | src/screens/statistics/bar-chart/bar-chart.component.tsx:104 | The by-type bar is a "now" snapshot and ignores the date range (statistics.screen.tsx:152-155), but its empty state says "No data for this range". | Add an `emptyLabel` prop, as PieChart and CategoryTrendLine have, with holdings wording. | S | |
| G6 | src/screens/accounts/accounts.screen.tsx:144,253,278 | `accountsRepo.remove` and `reorder` promises are fire-and-forget. A rejected write is an unhandled rejection with no user feedback; the grid silently shows the wrong order. | Use try/catch plus an Alert in the handler (the carve-out in kiko-code-style's fnts section, done in account-detail.screen.tsx). | S | |
| G6 | src/screens/home/transaction-row/transaction-row.component.tsx:66 | `transactionsRepo.remove` is fire-and-forget; a rejection is swallowed. | Same as above; see G5 for moving it to the screen. | S | |
| G6 | src/screens/statistics/statistics.screen.tsx:329-333,828-830 | The backfill `.catch` marks the run complete and drops the error. `setTrendFilter` is not awaited or caught. | Use `either` plus `bifold` for the backfill and handle the save failure. | S | |
| G6 | src/screens/home/use-refresh-control-signal.ts:71 | `onRefresh().finally(clear)` has no catch, so a rejecting `syncAll` is an unhandled rejection. | Add `.catch`, or wrap in `either`. | S | |
| S-STYLE | src/screens/statistics/statistics.screen.tsx:106,446,571,573,668,913 | No blank line before `if`/`for`. No blank line between JSX siblings (912-913). | Add the blank lines. | S | |
| S-STYLE | src/screens/home/home.screen.tsx:169-188,180,246,256,283,285,306,401-422,436,437,456 | `toggleFilter` is defined in the component body but closes over nothing (Statistics already hoists it). `renderDayHeader` returns JSX from the body. Blank lines missing before statements and between JSX siblings. | Move the helper to module scope; make a `DayHeader` component folder; add blank lines. | S | |
| S-STYLE | src/screens/accounts/accounts.screen.tsx:135-178,185-210,166,168,173,266,269,273 | `renderAccountCard` and `renderGrid` return JSX from the component body; `renderGrid` also uses an implicit return. JSX siblings have no blank lines. | Extract `AccountCard/` and `AccountsGrid/` folders, like account-detail/holding-card/. | M | |
| S-STYLE | src/screens/statistics/net-worth-line/net-worth-line.component.tsx:13-20,243,256,365,446-458,619,644 | The `declare module 'react-native-svg'` block sits between import groups. `StatusMessage` is a second component in the file. Blank lines missing before statements and between JSX siblings. | Move the augmentation to an ambient `.d.ts`; extract StatusMessage; add blank lines. | S | USER-DECISION (second component, see C) |
| S-STYLE | src/screens/statistics/category-trend-line/category-trend-line.component.tsx:139,152,186-196 | Blank lines missing before `if`. `LegendEntry` is a second component in the file. | Add blank lines; extract. | S | USER-DECISION |
| S-STYLE | src/screens/statistics/trend-filter-field/trend-filter-field.component.tsx:60-66,73-91,115 | `SectionHeader` uses an implicit arrow return and is a second component. `ManualCategoryRow` is a third. Blank line missing at 115. | Explicit return; extract or inline; add the blank line. | S | USER-DECISION |
| S-STYLE | src/screens/statistics/bar-chart/bar-chart.component.tsx:52-94 | `BarRow` is a second component in the file. | Extract it to `bar-row/`. | S | USER-DECISION |
| S-STYLE | src/screens/statistics/pie-chart/pie-chart.component.tsx:144-180 | `PieLegendEntry` is a second component in the file. | Extract it. | S | USER-DECISION |
| S-STYLE | src/screens/home/transaction-row/transaction-card/transaction-card.component.tsx:49,53 | No blank line between JSX siblings. | Add them. | S | |
| S-STYLE | src/screens/entity-amount-header/entity-amount-header.component.tsx:41-57,72 | Props type is declared inline instead of in `.props.d.ts`. No blank line between JSX siblings. | Move to `entity-amount-header.props.d.ts`. | S | |
| S-STYLE | src/screens/entity-header-icon/entity-header-icon.component.tsx:15 | Props type is inline. | Add a `.props.d.ts`. | S | |
| S-STYLE | src/screens/home/transaction-filter-bar/transaction-filter-bar.component.tsx:12-25 | Props type is inline. | Add a `.props.d.ts`. | S | |
| S-STYLE | src/screens/home/use-refresh-control-signal.ts:67 | No blank line before `if`. | Add it. | S | |
| M-import-ordering-length-sort | src/screens/statistics/statistics.screen.tsx:1-11,13-70,72-78 | All three groups are sorted alphabetically, not by length. The loan-payments import (L70, 90 characters) is tacked on at the end. | Re-sort by ending-line length. | S | |
| M-import-ordering-length-sort | src/screens/home/home.screen.tsx:1-16,18-43,45-52 | All groups are alphabetical. | Re-sort. | S | |
| M-import-ordering-length-sort | src/screens/statistics/bar-chart/bar-chart.component.tsx:1-5,7-14 | Alphabetical. | Re-sort. | S | |
| M-import-ordering-length-sort | src/screens/statistics/pie-chart/pie-chart.component.tsx:1-5,7-13 | Alphabetical. | Re-sort. | S | |
| M-import-ordering-length-sort | src/screens/statistics/net-worth-line/net-worth-line.component.tsx:4-5,22-28 | L5 comes after L4 (54 after 92). Group 2 imports follow code (the declare block). | Re-sort and move all imports to the top. | S | |
| M-import-ordering-length-sort | src/screens/statistics/category-trend-line/category-trend-line.component.tsx:3-4 | 54 comes after 58. | Swap. | S | |
| M-import-ordering-length-sort | src/screens/entity-amount-header/entity-amount-header.component.tsx:7-8 | 55 comes after 99. | Swap. | S | |
| M-import-ordering-length-sort | src/screens/home/sync-progress-bar/sync-progress-bar.component.tsx:2-5 | 36 after 47; 54 after 97. | Re-sort. | S | |
| M-import-ordering-length-sort | src/screens/home/transaction-filter-bar/transaction-filter-bar.component.tsx:4-5 | 49 after 56. | Swap. | S | |
| M-import-ordering-length-sort | src/screens/home/transaction-row/transaction-row.component.tsx:1-12 | Alphabetical. | Re-sort. | S | |
| M-import-ordering-length-sort | src/screens/home/transaction-row/transaction-row.props.d.ts:1-2 | 64 after 73. | Swap. | S | |
| M-import-ordering-length-sort | src/screens/statistics/statistics.screen.test.tsx:19-27 | Group 2 is alphabetical. | Re-sort; keep the unistyles side-effect barrier. | S | |
| M-import-ordering-length-sort | src/screens/home/home.screen.test.tsx:1-4,8-18,20-24 | Groups unsorted. A `../` side-effect import sits in the external group. An import (L24) comes after a type alias. | Re-sort; move L24 up. | S | |
| M-import-ordering-length-sort | src/screens/accounts/accounts.screen.test.tsx:1-7,9-16 | Both groups unsorted. | Re-sort. | S | |
| M-import-ordering-length-sort | src/screens/home/filter-menu/filter-menu.component.test.tsx:1-5,7-8 | 42 after 90; 37 after 57; 56 after 65. | Re-sort. | S | |
| M-import-ordering-length-sort | src/screens/home/date-range-field/date-range-field.component.test.tsx:1-3 | 39 after 71. | Re-sort. | S | |
| M-import-ordering-length-sort | src/screens/statistics/trend-filter-field/trend-filter-field.component.test.tsx:1-2,5-6 | 42 after 79; 37 after 57. | Re-sort. | S | |
| M-import-ordering-length-sort | src/screens/statistics/net-worth-line/net-worth-line.component.test.tsx:3-8 | 57 after 74. No blank line before the `./` group. | Re-sort; add the blank line. | S | |
| M-import-ordering-length-sort | src/screens/statistics/pie-chart/pie-chart.component.test.tsx:3-7 | 48 after 59. No blank line before `./`. | Re-sort. | S | |
| M-import-ordering-length-sort | src/screens/statistics/bar-chart/bar-chart.component.test.tsx:3-6 | 68 after 69. No blank line before `./`. | Re-sort. | S | |
| M-import-ordering-length-sort | src/screens/entity-amount-header/entity-amount-header.component.test.tsx:1-4 | 46 after 63. `../` imports sit in the external group. | Re-sort and split the groups. | S | |
| M-import-ordering-length-sort | src/screens/entity-header-icon/entity-header-icon.component.test.tsx:1-3 | No blank line between the external and `../` groups. | Add the blank line. | S | |
| M-import-ordering-length-sort | src/screens/statistics/category-trend-line/category-trend-line.component.test.tsx:3-5 | No blank line before `./`. | Add it. | S | |
| M-import-ordering-length-sort | src/screens/home/transaction-row/transaction-card/transaction-card.component.test.tsx:1-4 | The `../` barrier sits in the external group. | Add a blank line. | S | |
| S-DS | src/screens/home/filter-menu/filter-menu.styles.ts:7-15 | The trigger chip is about 36pt tall (8pt padding top and bottom plus a 20pt glyph) with no `hitSlop`, under the 44pt touch floor. | Use `minHeight: 44` or a `hitSlop`; see the shared chip in G2. | S | |
| S-DS | src/screens/home/date-range-field/date-range-field.styles.ts:8-17 | Same chip, same under-44pt target. | Same fix. | S | |
| S-DS | src/screens/statistics/trend-filter-field/trend-filter-field.component.tsx:205 | Raw `size={18}`; the sibling chips use `theme.iconSizes.body`. The chip is also under 44pt (styles 7-16). | Use `theme.iconSizes.body`; use the shared chip. | S | |
| S-DS | src/screens/statistics/pie-chart/pie-chart.component.tsx:151-177,267-286 | The legend toggle's tap target is about 24pt and has no `accessibilityRole`. Raw `fontSize: 19` and `lineHeight: 19` (styles 88-93). Raw `View` with a flexDirection style instead of `Box direction`. | Add `hitSlop` or `minHeight` and a role; use a typography token; use Box. | S | |
| S-DS | src/screens/entity-header-icon/entity-header-icon.component.tsx:13 | `ENTITY_ICON_SIZE = 28` is a raw icon size. | Use `theme.iconSizes.title`. | S | |
| S-DS | src/screens/home/sync-progress-bar/sync-progress-bar.component.tsx:69-77 | Inline style objects built from theme values; the folder has no `.styles.ts`. | Move them to `sync-progress-bar.styles.ts`. | S | |
| S-DS | src/screens/home/add-transaction-fab/add-transaction-fab.styles.ts:33-37 | Raw `opacity: 0.85`. The comment claims Button uses the same value; Button has no pressed opacity. | Add a token, or delete the false claim. | S | |
| S-DS | src/screens/statistics/bar-chart/bar-chart.component.tsx:65-74 | Raw `View` with a flexDirection style (styles 15-20) instead of `Box direction="row"`. | Use Box. | S | |
| S-GEST | src/screens/accounts/accounts.screen.tsx:195,201,203 | The grid tuning literals (1.03, 75) are copied in account-detail.screen.tsx:265,270. `rowGap` has already drifted: spacing(4) here, spacing(3) there. | Define one shared grid-tuning constant beside `onGridDragEnd`. | S | |
| S-I18N | src/screens/home/date-range-field/date-range-field.component.tsx:103,107,205,228,254,258 | A component shared with Statistics reads the `home.dateRangeField.*` namespace. | Move the keys to `components.dateRangeField`. | S | |
| U10-case | src/screens/statistics/trend-filter-field/trend-filter-field.component.tsx:143-154 | The button label renders "3 Categories" and "Top 3 by Contribution" (en.ts:655-659), and "Топ 3 за Внеском" in uk (uk.ts:573-588). A button is sentence case, so these are wrong mid-string capitals; en and uk also disagree on the noun. | Lowercase the en plural nouns; add separate lowercase measure keys for the interpolated label. | S | |
| U10-validate | src/screens/statistics/trend-filter-field/trend-filter-field.component.tsx:189,329,338 | Save and Clear stay disabled until the draft changes. The rule is Save always enabled; the twin DateRangeField Apply is always enabled. | Always enable; an unchanged Save just closes the sheet. Behavior change. | S | |
| U10-tabs | src/screens/statistics/trend-filter-field/trend-filter-field.component.tsx:240-251 | The Top/Manual mode swaps which sections are visible but uses OptionPills (chips). | Use SegmentedControl, as BondIsinSection does. | S | USER-DECISION: kiko-design-system documents OptionPills here |
| U5 | src/screens/statistics/trend-filter-field/trend-filter-field.component.tsx:40-42,46-48,102,144,204,248 | Repeated `mode === 'manual'` ternaries and ifs. The mode-to-icon mapping is written twice. | `match(filter).exhaustive()` plus `Record<TrendMode, string>`; bar-chart's `holdingTypeLabel` does it right. | S | |
| U5 | src/screens/statistics/statistics.screen.tsx:773-779 | A ternary on the `mode` union. | Use `match(...).exhaustive()`. | S | |
| U5 | src/screens/statistics/net-worth-line/net-worth-line.component.tsx:310,683 | Ternaries on the `'above' | 'below'` union. | Use `Record<Side, ...>`. | S | |
| U4 | src/screens/statistics/statistics.screen.tsx:323-333 | A hand-rolled `.then/.catch` turns the promise into a status. | `either(() => runBackfill(...))` plus `bifold`. | S | |
| U6 | src/screens/statistics/statistics.screen.tsx:1-7 vs 13-70; home.screen.tsx:2-8 vs 18-43; accounts.screen.tsx:2-8 vs 13-32 | Each file uses `@kiko/*` for repos but `../../` for other src modules. transaction-row uses only aliases. | Use one style; per memory, `@kiko/*` for cross-feature imports. | S | |
| U6 | src/screens/statistics/trend-filter-field/trend-filter-field.component.tsx:18,20,143-158 | An IIFE builds the label and calls a hoisted `function measureLabel` before its definition. Deep imports reach into filter-menu internals past its barrel. | Use a plain helper or `match`; import from `filter-menu/index`. | S | |
| U7 | src/screens/accounts/accounts.screen.tsx:135-178 | The account card is inline in the screen; its sibling holding card is its own component folder (account-detail/holding-card/). | Extract `AccountCard/` with the same layout. | M | |
| U7 | src/screens/statistics/category-trend-line/category-trend-line.component.tsx:208-211,259 | The y-grid testID uses an index; the twin net-worth-line.component.tsx:546 uses the tick key. Optional `emptyLabel` renders a blank empty state; PieChart has a default. There is no loading state. | Align with net-worth-line; make `emptyLabel` required. | S | |
| U8 | src/screens/home/filter-menu/, date-range-field/, transaction-row/transaction-card/ | Shared components live under home/. They are pulled in by statistics.screen.tsx:68-69, trend-filter-field.component.tsx:18,20 and statement-import/example-transaction/example-transaction.component.tsx:19. | Move them to a shared screens folder (or design-system). | M | |
| U8 | src/screens/home/use-refresh-control-signal.ts, src/screens/statistics/use-focus-refreshed-now.ts (+ tests) | Hook and test lie loose in a screen folder. `useFocusRefreshedNow` is generic. | Give each hook its own folder; move `use-focus-refreshed-now/` to src/navigation/. | S | |
| U8 | src/screens/entity-amount-header/, src/screens/entity-header-icon/ | Shared components sit as siblings of the screen folders. | Group them under the shared folder above. | S | |
| U9 | src/screens/home/home.screen.tsx:455 + home.styles.ts:28-36 | A hand-rolled hairline divider duplicates the design-system `Divider` exactly (accounts.screen.tsx:265 uses Divider). | `<Divider />`. | S | |
| U9 | src/screens/statistics/statistics.screen.tsx:910-915 + statistics.styles.ts:15-22 | The Debts label/value row re-implements a SummaryTable row. | Use `SummaryTable`. | S | |
| U2 | src/screens/statistics/statistics.screen.tsx:245-247,264-266,341-342,399-402,464-470,477,517,545,608,734-737 | Task and review ids (T27, T30, N10b, D5, spec §5.3, Review Focus 7) and history ("used to", "no longer", "any more"). | Keep only the why. | S | |
| U2 | src/screens/home/home.screen.tsx:56-57,88-90,213-215,243,276,355,366,476-478 | History and ids ((D2), (B), "the old Set", "no longer issues"). | Same. | S | |
| U2 | src/screens/accounts/accounts.screen.tsx:58-63,76-79,100-105,182-184,241-242,259,274; accounts.styles.ts:4,35-38 | T27, M2, I1, F9, spec §5.3; "before this split"; "no longer applied". | Same. | S | |
| U2 | src/screens/statistics/statistics.styles.ts:15 | "T27". | Same. | S | |
| U2 | src/screens/statistics/net-worth-line/net-worth-line.component.tsx:64-67,137-141,172-177,252-253,271-273,334-335,672-676,698; net-worth-line.styles.ts:6,47 | R5-D "exploratory, may keep or drop"; "Earlier this was"; "the reported bug"; (G5). | Same; decide whether R5-D stays. | S | |
| U2 | src/screens/statistics/category-trend-line/category-trend-line.component.tsx:49-54,147-149,165-167 | Copied history ("labels now render", "old single fraction-set", "rendered one day early"). | Same. | S | |
| U2 | src/screens/statistics/trend-filter-field/trend-filter-field.component.tsx:50-58,219,230-236,245,285-295; trend-filter-field.styles.ts:32-36 | "it used before", "the former caption", "any more", "(infra item I4)", "(on-device review...)". | Same. | S | |
| U2 | src/screens/home/transaction-row/transaction-row.component.tsx:43-44,69; transaction-row.props.d.ts:19; transaction-row.styles.ts:4-8 | "F3 fix round 1, C1", (D2), (M2). | Same. | S | |
| U2 | src/screens/home/transaction-row/transaction-card/transaction-card.component.tsx:14-21; transaction-card.props.d.ts:14 | F3 ids; "used to own inline". | Same. | S | |
| U2 | src/screens/home/date-range-field/date-range-field.component.tsx:218; date-range-field.styles.ts:27-29 | "(F5 fix...)"; "former single gap". | Same. | S | |
| U2 | src/screens/home/use-refresh-control-signal.ts:8-11,22-23 | History of the frozen-spinner bug. | Same. | S | |
| U2 | src/screens/statistics/use-focus-refreshed-now.ts:8-9 | "a plain useMemo froze it". | Same. | S | |
| U2 | src/screens/entity-amount-header/entity-amount-header.component.tsx:17,49-50 | "round-2 design review"; "as it does today". | Same. | S | |
| U2 | src/screens/statistics/bar-chart/bar-chart.component.tsx:113-117 | Narrates a past bug ("made every bar ... full-width"). | Same. | S | |
| U2 | src/screens/statistics/statistics.screen.test.tsx:70-71,586,863,1207,1328 | "(T27)", "(T30, spec 5/D14)", "Review Focus 7" in test names; "the screen's old useMemo". | Same. | S | |
| U2 | src/screens/home/home.screen.test.tsx:296,306-307,470,534,969,1023 | "(M2 in the HIG audit)", T27, "used to", "anymore". | Same. | S | |
| U2 | src/screens/accounts/accounts.screen.test.tsx:291,404,409,445,488,493-495,527 | F9, G2, T27, M2, I1, §5.3. | Same. | S | |
| U2 | src/screens/statistics/net-worth-line/net-worth-line.component.test.tsx:28-33,124,206,311,492,607,670,734,743,797-798,816,831,956 | R5-D, (G5), "the old ...", "any more". | Same. | S | |
| U2 | src/screens/statistics/trend-filter-field/trend-filter-field.component.test.tsx:328,359-360 | "(infra item I4)", "any more". | Same. | S | |
| U2 | src/screens/statistics/trend-filter-field/trend-filter-field.section-header-tone.test.tsx:75-76 | "the former caption". | Same. | S | |
| U2 | src/screens/statistics/pie-chart/pie-chart.component.test.tsx:207 | "used to sit beneath it". | Same. | S | |
| U2 | src/screens/home/add-transaction-fab/add-transaction-fab.component.test.tsx:68,82-83 | "the old flat accent circle". | Same. | S | |
| U2 | src/screens/home/transaction-row/transaction-row.component.test.tsx:100 | "(D2)" in a test name. | Same. | S | |
| U2 | src/screens/home/transaction-row/transaction-card/transaction-card.component.test.tsx:30 | "F3 fix round 1, C1". | Same. | S | |
| U2 | src/screens/entity-amount-header/entity-amount-header.component.test.tsx:18 | "round-2 design review". | Same. | S | |
| U1 | src/screens/statistics/net-worth-line/net-worth-line.component.tsx:178,303,354 | The component file also exports `buildTicks`, `toAreaPath` and `buildLineSegments`. | Move them to `net-worth-line.geometry.ts` (the bottom-sheet.gesture.ts pattern). | M | |
| U1 | src/screens/home/filter-menu/filter-menu.component.tsx:16 | Exports the `FILTER_ALL` constant from a component file. | Move it next to the option model (see BUG row 3). | S | |
| G1 | src/screens/statistics/bar-chart/bar-chart.component.tsx:23,98 | The `height` prop is never read. `holdingDefaults` is a pointless alias. | Delete both. | S | |
| G1 | src/screens/statistics/pie-chart/pie-chart.component.tsx:40,185; pie-chart.styles.ts:73-74 | No caller or test passes `size`. The styles comment describes a "Total" caption that no longer exists. | Delete. | S | |
| G1 | src/screens/statistics/net-worth-line/net-worth-line.component.tsx:263-286,428,470 | The `toAreaPath` doc sits above `adjacentSegment`. `formatAxisTime` is a pass-through wrapper. `negativeAreaOpacity` is an alias. | Move the doc; inline the other two. | S | |
| G1 | src/screens/statistics/category-trend-line/category-trend-line.component.tsx:29,168; category-trend-line.styles.ts:5,17,42,65,70,75 | `height` is never passed. `formatAxisTime` is a wrapper. The styles comments say "month"; buckets are day or week. | Delete the prop and wrapper; fix the comments. | S | |
| G1 | src/screens/statistics/statistics.styles.ts:10-14 | `cardTitle` repeats `variant="heading"`; the comment still says "GlassSurface padding". | Delete. | S | |
| G1 | src/screens/home/filter-menu/filter-menu.props.d.ts:29-33 | Every caller passes `triggerIcon`, so the "legacy" default (component:36) is dead. | Make the prop required. | S | |
| G1 | src/screens/home/transaction-filter-bar/transaction-filter-bar.component.tsx:8-10 | A `FILTER_ALL` re-export shim. | Import from filter-menu. | S | |
| G1 | src/screens/home/home.screen.tsx:54-61,229-235; home.styles.ts:5,58 | Composite props for "future" cross-tab navigation that is never used. An orphan comment block. The styles comments say "FlatList"; it is a SectionList. | Delete or fix. | S | |
| G1 | src/screens/accounts/accounts.screen.tsx:49,106-116; accounts.styles.ts:16,39-41 | The `debtsTotal` useMemo depends on a per-render `Date.now()`, so it never hits. The styles comment still says "GlassSurface". `width: '100%'` repeats `fullWidth`. | Use a stable `now` (G2); delete the rest. | S | |
| G1 | src/screens/home/transaction-row/transaction-row.styles.ts:4-6 | Stale comment: "glass card, GlassSurface owns padding". | Fix it. | S | |
| G1 | src/screens/statistics/trend-filter-field/trend-filter-field.component.tsx:73-91 | `ManualCategoryRow` only passes props through to SelectableRow; FilterMenu uses SelectableRow directly. | Inline SelectableRow. | S | |
| G2 | statistics.screen.tsx:95-114; home.screen.tsx:169-188; trend-filter-field.component.tsx:113-122 | Three copies of the set-toggle helper. | One `toggleSetValue` helper or a `useToggleSet` hook. | S | |
| G2 | statistics.screen.tsx:203-215; home.screen.tsx:151-165 | The date-range state, apply and clear are copied. Statistics clears with `defaultDateRange()`, not `now`. | A `useDateRangeState(now)` hook. | S | |
| G2 | statistics.screen.tsx:848-852; home.screen.tsx:244-257 | Account-option twins: Home removes duplicates and memoizes, Statistics does neither. Both drop the kind-glyph fallback that the card uses (accounts.screen.tsx:162). | One shared builder keyed by id (BUG rows). | S | |
| G2 | statistics.screen.tsx:690-696; home.screen.tsx:302-311 | Category-order twins: Statistics lowercases the keys, Home does not. | One `orderByCategorySort` helper. | S | |
| G2 | src/screens/statistics/statistics.screen.tsx:229-240 | Re-implements `activeHoldings`; src/rates/active-holdings/active-holdings.ts states it is the ONE place for that rule. | Call `activeHoldings`, then apply the account filter. | S | |
| G2 | src/screens/statistics/statistics.screen.tsx:494-564 | The same nine-field projection is written three times. | Pass `transactionsWithCurrency` straight through (structural typing), or use one mapper. | S | |
| G2 | home.screen.tsx:106-116,146,190,195; statistics.screen.tsx:173-181,217,222; accounts.screen.tsx:41-49 (+ account-detail.screen.tsx:101) | The same live queries, the `?? 'UAH'` fallback and `buildRateTable` in each screen. `now` differs: `Date.now()` per render on Home and Accounts, `useFocusRefreshedNow` on Statistics. | A `useNetWorthInputs()` hook with the focus-refreshed `now`. | M | |
| G2 | net-worth-line.component.tsx:51-75,88-93,157-261,428-444,514-570,691-715 vs category-trend-line.component.tsx:37-68,94-184,227-283,311-327; both `.styles.ts` | Constants, types, X-tick builders, `formatAxisTime`, `leftPercentOf`, `xLabelStyle`, the Y-axis and gridline JSX and the styles are near-copies. jscpd missed it. | Extract a shared `chart-axis/` module (builders, styles and an axis component). | L | |
| G2 | filter-menu.styles.ts:7-15; date-range-field.styles.ts:8-17; trend-filter-field.styles.ts:7-16; the "All" row logic in filter-menu.component.tsx:20-21,46,52-53 vs trend-filter-field.component.tsx:184-186,308-312 | Three copies of the chip-trigger chrome (they disagree on glyph size and wrapper). Two copies of the "All" row logic. | One `FilterChip` trigger and one "All"-row helper. | M | |
| G2 | src/screens/home/date-range-field/date-range-field.component.tsx:32-41 | `pad2`, `toCalendarKey` and `atLocalMidnight` duplicate dates/format.ts:5, forms/date-field/date-field.component.tsx:24-28 and `startOfLocalDay`. | Move them to src/dates. | S | |
| G2 | src/screens/statistics/bar-chart/bar-chart.component.tsx:37-48 | The holding-type label map is duplicated in holding-form.screen.tsx:1032-1042. | One `holdingTypeLabelKey: Record<HoldingType, ...>` in src/holdings, next to entity-symbols. | S | feat-refactor |
| G2 | home.screen.tsx:494-498; accounts.screen.tsx:229-232; bar-chart:100-108; pie-chart:196-204; category-trend-line:206-214; net-worth-line:446-458 | Six hand-rolled empty states, with copied `empty` styles. | One shared EmptyState component (net-worth-line's StatusMessage is the seed). | M | |
| G2 | accounts.screen.tsx:164; entity-header-icon.component.tsx:27; account-detail/holding-card/holding-card.component.tsx:74 | Three icon a11y labels: by entity name, by SF Symbol name (VoiceOver reads "Icon creditcard.fill"), and hard-coded English. | One translated "{{name}} icon" label from the entity name. | S | |
| G3 | src/screens/statistics/statistics.screen.tsx:84-90 | Category slices are forced into `AccountSlice`, so a category key sits in `accountId`; PieChart (pie-chart.component.tsx:38,151,229) is typed per account. | A generic `PieSlice { key, label, amount, share, color }`. | S | |
| G4 | src/screens/statistics/statistics.screen.tsx:162-973 | One component holds 7 queries, backfill orchestration (290-338), the spending-exclusion union and projections (439-627), filter state and options, trend-filter resolution and 5 copied chart cards. | Split into `useRateHistoryBackfill`, `buildSpendingInputs` in src/statistics, `useStatisticsFilters` and a `ChartCard` component. | L | |
| G4 | src/screens/home/home.screen.tsx:80-508 | Data loading, the net-worth summary, filter state and options, grouping, navigation handlers and the list are all in one component. | `useTransactionFilters`, a `NetWorthSummary` component and a `DayHeader` component. | M | |
| G4 | src/screens/statistics/net-worth-line/net-worth-line.component.tsx:95-444 | The 720-line file mixes pure geometry with rendering (see the U1 row). | Move the geometry to its own module; test it there. | M | |
| G5 | src/screens/home/transaction-row/transaction-row.component.tsx:66 | The leaf row calls `transactionsRepo.remove` itself, while `onPress` and `onDuplicate` are injected from the screen. | Inject `onDelete` from HomeScreen as well. | S | |
| G7 | src/screens/statistics/statistics.screen.test.tsx:31-160 | A hand-rolled `useLiveQuery` fake keyed by table, stubbed repo `toSQL` calls and hand-typed rows. It defaults only 2 nullable columns (125-130); `description` and `changeGroupId` come back `undefined`, never `null` as on device. | A shared test-support live-query fake typed from schema rows, per fake-db-masks-bugs. | M | |
| G7 | src/screens/home/home.screen.test.tsx:69-175 | The same fake. It re-declares `Transaction` instead of using `HomeTransactionRow`. | Same shared fake. | M | |
| G7 | src/screens/accounts/accounts.screen.test.tsx:51-115,399-415 | The same fake. The screen test also asserts the shared Card's own fill and border internals. | Same shared fake; leave Card style assertions to the card test. | S | |
| G7 | src/screens/home/date-range-field/date-range-field.component.test.tsx:17-29 | An inline copy of test-support/mock-text-tone.tsx, plus a copied `pad2`. | Import the shared mock and helper. | S | |
| G7 | pie-chart.component.test.tsx:9-14; net-worth-line.component.test.tsx:37-42; category-trend-line.component.test.tsx:34-39 | The `styleLayers` helper is copied three times. | Move it to src/test-support. | S | |
| G7 | net-worth-line.component.test.tsx:670-679; pie-chart.component.test.tsx:207 | Tests assert that removed code is absent (ClipPath testIDs, the "Total" caption). | Delete them. | S | |
| G7 | src/screens/statistics/trend-filter-field/trend-filter-field.section-header-tone.test.tsx:17-32 | A second test file for the same component, with its own Text mock asserting the `variant` prop. | Merge into the component test; use a shared prop-exposing Text mock. | S | |


### R4 — Account-detail, settings, statement-import and column-mapping screens (paths relative to `src/screens/` unless they start with `src/`)

| Rule | file:line | What is wrong | Fix (the existing pattern or rule to apply, name a file that already does it right when one exists) | Effort (S/M/L) | Tags |
|---|---|---|---|---|---|
| BUG | column-mapping/column-mapping.screen.tsx:1037-1068 | Import is a silent no-op when the mapping is complete but has 0 transactions. Example: every row fails the chosen date format. `canImport` is false, `fieldErrors` holds no error, `firstInvalid` is null. The user gets no message, no scroll and no Alert. This is also Guideline 2.1 ("a button that does nothing"). | On press, show an error for the 0-row case and scroll to it. Alternative: allow the import and show the result sheet (statement-import allows 0 rows). Behavior change. | S | USER-DECISION: which field owns the "no rows" error, or allow a 0-row import |
| BUG | statement-import/preview-stats/preview-stats.ts:51-53,69 | An empty parse gives `Math.min()` = Infinity, so the date range reads "NaN.NaN.NaN – NaN.NaN.NaN". Reached by a header-only CSV on statement-import, or by a mapping where every row errors. | Return an empty/dash span when `transactions.length === 0`. Also add a `dateSpan` assertion to preview-stats.test.ts:39. | S | |
| BUG | column-mapping/column-mapping.screen.tsx:847,968-969 | The fixed currency defaults to the account's FIRST holding, not to the chosen target holding. Example: UAH card first, then a USD card. The user picks the USD card and leaves "Currency for all rows" as is. Every row is tagged UAH, and `importParsedStatement` skips all rows as wrong currency. | Default from the selected target holding. Add `currency` to `TargetHoldingOption` (use-target-holding-options.ts:26-33) and delete the extra holdings query at :847. Behavior change. | S | |
| BUG | column-mapping/column-mapping.screen.tsx:1072-1089 | `saveStatementMapping` runs in the same `try` as the import. If the import succeeds and the mapping save throws, the success sheet opens AND the "Import failed" Alert shows. | Put the mapping save in its own try; a save failure does not fail the import. | S | |
| BUG | settings/categories/categories.screen.tsx:109,118-126 | Clear a category title and blur. `commitTitle` skips the write but local `title` stays `''`, so the card shows a blank name while the DB keeps the old title. | When trimmed is empty, reset `setTitle(category.title)`, or validate on commit with an inline error. | S | |
| BUG | settings/categories/add-category-row/add-category-row.component.tsx:74-81 | `save` is async and has no submit guard. A fast double tap runs `categoriesRepo.create` twice, which makes two categories. A rejection is unhandled. | Wrap in `useSubmitOnce` (as export-data.screen.tsx:81) and add a catch that shows an Alert. | S | |
| BUG | statement-import/statement-import.screen.tsx:471-490; column-mapping/column-mapping.screen.tsx:1049-1073 | `if (importing) return` reads render state. Two taps in one tick both pass, so there are two imports (useSubmitOnce's own doc describes this exact failure). | Use `useSubmitOnce` (forms/use-submit-once) as every form does. | S | |
| BUG | column-mapping/column-mapping.screen.tsx:933-966 | `initializedRef` latches on the first non-empty `rows`, even when the settings and accounts live queries have not resolved yet (`useLiveQuery` starts with `[]`). On a fast file read, `savedMappings` and `bankId` are undefined, so the saved mapping never pre-fills. This includes the auto-replace path that found an exact mapping. The twin at statement-import.screen.tsx:416-434 re-runs when `savedMappings` changes. | Gate the init on `isLoading === false` of both queries. | S | |
| BUG | statement-import/statement-import.screen.tsx:355-376 | A `.xls` file is decoded as text. The screen shows the generic "unrecognized format" message and offers "Map columns manually", which leads to column-mapping's `xlsNotSupported` dead end. Divergent twin: column-mapping.screen.tsx:876-879 handles `.xls`. | Check `isLegacyXlsFile` here too and show `columnMapping.xlsNotSupported` with no "Map columns" button. | S | |
| BUG | account-detail/account-detail.screen.tsx:179-188 | A `keepLocalCopy` rejection is not caught. The promise is unhandled and the user gets no feedback. The twin in settings/import-data/import-data.screen.tsx:86-98 silently swallows the same failure as a "cancel". | Share one pick-and-copy helper. On a copy throw, fall back to `picked.uri`, the same as the `status !== 'success'` branch. | S | |
| S-COMPL (5.6, 2.1) | statement-import/statement-import.screen.tsx:55-60,320,540-576; statement-import/target-holding-sheet/target-holding-sheet.component.tsx:12-37,85-96; statement-import/use-target-holding-options/use-target-holding-options.ts:20 | The code paths for the never-built "entry point 2 / Share Extension" ship in the binary. No route reaches StatementImport without `accountId`, and `ios/` has no share extension. kiko-architecture's 5.6 rule says a not-ready feature is removed, never left reachable-but-hidden. The no-accountId "Map columns manually" and "Create new holding" render as no-op buttons (2.1). | Make `StatementImport.accountId` required. Delete the unscoped grouped branch, `groupByAccount`, the `allQuery` branch, the `accountId ?? ''` and the no-op guards. | M | |
| S-COMPL (5.6) | settings/system/system.screen.tsx:52-60 | `APP_LOCK_ENABLED && <AppLockSetting/>` is a build flag that gates whether UI is visible. That is exactly the kiko-compliance 5.6 question. The value is `true` today, and the OFF path is the escape hatch for a build without the pod. | Render `AppLockSetting` always and keep the flag only in the auth path, or record an explicit exception in kiko-compliance. | S | USER-DECISION |
| S-COMPL (5.6) | account-detail/add-bank-sheet/add-bank-sheet.component.tsx:15-28 | `visibleCatalogEntries` silently hides any catalog entry that has no registry wiring. It is a conditional-visibility mechanism. It is a no-op today, because both the catalog and the registry hold only Monobank. | Remove the filter. Add a Jest invariant: catalog ids === registry keys, so a mismatch fails loudly. | S | |
| U10-tabs | column-mapping/column-mapping.screen.tsx:598-608,622-631 | Encoding and decimal separator use `SegmentedControl`, but neither choice changes the visible fields. The user rule (2026-09-24) says chips. | `ChipRow`, like the delimiter at :610-618. | S | feat-refactor (F4 UX round) |
| U10-tabs | account-detail/crypto-sync-form/crypto-sync-form.component.tsx:49-55 | The Wallet/Binance source is a `ChipRow`, but the choice swaps the visible field (address vs key pair). By the rule it must be tabs. The account form uses the same component. | `SegmentedControl` + `FieldLabel`, like amount-fields.component.tsx:39-45. | S | |
| U10-check | statement-import/target-holding-sheet/target-holding-sheet.component.tsx:66-76; statement-import/target-holding-field/target-holding-field.component.tsx:51-58 | Every row gets `selected={false}`, so the chosen holding has no checkmark. The field does not pass `selectedId` to the sheet. | Pass `selectedId` and set `selected={holding.id === selectedId}`. Right example: column-select-field.component.tsx:65. | S | |
| U10-check / U10-capab / U9 | account-detail/add-bank-sheet/add-bank-sheet.component.tsx:56-77; add-bank-sheet.styles.ts:7-11 | Hand-rolled `Pressable` rows: no checkmark and no capability icons. `SelectableRow` already has `description` and `trailing` for this. | `SelectableRow`, like forms/bank-type-field (capability icons in `trailing`). | S | feat-refactor (if it falls under the F4 capability-icons item) |
| U10-validate | settings/categories/add-category-row/add-category-row.component.tsx:49-51,173 | Save is `disabled={!canSave}`, and there is no inline error. | Keep Save always enabled. Validate on press and show `FieldError` under the name field (kiko-code-style "Form validation model"). | S | |
| U10-validate / U9 | settings/import-data/import-data.screen.tsx:188-230 | The file and key errors are hand-rolled `Text tone="negative"`, not `FieldError`. No label turns red. The file picker is a bare Button with no field label. | Use `FieldTrigger` with `error` for the file. Forward `error` through `ClipboardTextField` to `TextField`. | M | |
| U10-validate | account-detail/monobank-connect-field/monobank-connect-field.component.tsx:80; account-detail/binance-credentials-field/binance-credentials-field.component.tsx:125; account-detail/wallet-address-field/wallet-address-field.component.tsx:74 | Connect is disabled while the input is empty. The error shows in `SyncStatusLine` beside the button, not under the field with a red label. | Keep Connect enabled and validate on press, with the empty-input error under the field. | S | USER-DECISION: does Connect follow the Save rule |
| U10-validate | column-mapping/mapping-result/mapping-result.component.tsx:39-50 | The currency-unresolved error shows in the page-bottom Result block before any Import press. After a press it shows again on the currency field. | Keep only the field error, shown on press. The Result block keeps the neutral "incomplete" text. | S | |
| U10-case | column-mapping/column-select-field/column-select-field.component.tsx:59 | The sheet header reuses the sentence-case field label (for example "Date format") in the sheet-title role, which needs Title Case. | One `*SheetTitle` key per field, like `statementImport.chooseHoldingSheetTitle`. | S | |
| U10-stop | src/i18n/locales/en.ts:497-500,514-516,744,758,869-873 | Error strings shown by this area have no final "." (`invalidToken`, `invalidApiKeyOrSecret`, `invalidBTCAddress`, `couldNotConnect*`, `couldNotSaveCredentials`, `rowError.*`). The `skippedWrongCurrency_*` keys have none; the sibling at :765 has one. | Add the "." per the kiko-translator role table, in en and uk. | S | |
| U10-footer | settings/categories/categories.screen.tsx:461; settings/categories/add-category-row/add-category-row.component.tsx:96-121 | "Add category" is an inline last card with inline Save/Cancel. Accounts and AccountDetail put "Add" in the footer. | Put "Add category" in the footer to open the form, or record the exception. | M | USER-DECISION |
| M-button-hierarchy-user-spec | account-detail/bank-sync-section/bank-sync-section.component.tsx:221-236; account-detail/crypto-sync-section/crypto-sync-section.component.tsx:106-121 | "Sync" is a solid `primary` fill. The memory names "Sync now" as an inline secondary that needs a faint tint. | `secondaryTonal`, `size="small"`. | S | USER-DECISION: the code comment calls primary deliberate |
| M-button-hierarchy-user-spec | account-detail/bank-sync-section/bank-sync-section.component.tsx:307-314 | "Change bank" is a transparent `ghost`. An inline secondary needs a faint tint. | `secondaryTonal`. | S | |
| M-button-hierarchy-user-spec | settings/categories/categories.screen.tsx:205-224 | The default and set-default stars are `compact` (44pt). The memory and kiko-design-system:268-273 say `small`. | `size="small"`, or update the skill. | S | USER-DECISION |
| S-DS | settings/settings/settings.screen.tsx:126-150 | The About block (version, copyright, privacy link) is in the pinned `footer` slot. kiko-design-system:185-196 says About is page content that uses `fillHeight`, and the footer is for actions. `fillHeight` does not exist in `Screen`. | Decide where About goes, then fix the code or the skill. | S | USER-DECISION |
| S-STYLE | account-detail/account-detail.screen.tsx:207,225,233,240; account-detail/add-bank-sheet/add-bank-sheet.component.tsx:69,72; account-detail/bank-sync-section/bank-sync-section.component.tsx:203,237; account-detail/holding-card/holding-card.component.tsx:76; settings/export-data/export-data.screen.tsx:176; statement-import/target-holding-sheet/target-holding-sheet.component.tsx:94; settings/settings-row/settings-row.component.tsx:33,64,72 | No blank line between adjacent JSX siblings. | Add the blank line (kiko-code-style "Blank line between adjacent JSX sibling nodes"). | S | |
| S-STYLE | account-detail/monobank-connect-field/monobank-connect-field.component.tsx:53; column-mapping/column-mapping.screen.tsx:878,945; settings/import-data/import-data.screen.tsx:77 | No blank line before `if` / `return`. | Add the blank line (hard rule). | S | |
| S-STYLE | account-detail/monobank-token-input/monobank-token-input.component.tsx:12 | The Monobank URL is hardcoded. The twin Binance URL comes from `@env` (binance-credentials-field:3). | Move it to `.env` / `@env`. | S | |
| S-STYLE | settings/settings/settings.screen.tsx:27-28 | The privacy-policy URLs are hardcoded config. | Move them to `.env` / `@env`. | S | |
| S-I18N | account-detail/holding-card/holding-card.component.tsx:74 | The a11y label `${holding.name} icon` has hardcoded English. | `t('common.iconLabel', …)`, like sync-status-line:32. | S | |
| U1 | statement-import/statement-import.screen.tsx:181-281 | `StatementPreviewBlock` is a second, non-small (100-line) component in the screen file. `StatementImportFooter` at :141-172 is small and allowed. | Move it to a `statement-preview-block/` folder. | S | |
| U1 | column-mapping/column-mapping.screen.tsx:454-778 | `ColumnMappingForm` is a second component in the screen file: 270 lines, 48 props. | Give it its own folder, fed by a form-state hook (see G4). | M | |
| U1 | settings/categories/categories.screen.tsx:31-60,85-319 | `CategoryListRow` and its styles live in the screen file. | Give it a `category-card/` folder with its own styles. | S | |
| U1 | statement-import/target-holding-sheet/target-holding-sheet.component.tsx:66-76 | The `row` helper returns JSX inside the component body. | Inline it in the `map`, or extract a `TargetHoldingRow` component. | S | |
| U1 | account-detail/add-bank-sheet/add-bank-sheet.component.tsx:27 | The component file also exports a non-component helper. | Delete it (see S-COMPL) or move it. | S | |
| U3 | account-detail/account-detail.screen.tsx:52-60 | `account === undefined ? undefined : {…}` | `foldMap(maybe(account), …)` from fnts/maybe. | S | |
| U3 | account-detail/bank-sync-section/bank-sync-section.component.tsx:101-102 | `id === undefined ? undefined : registry[id]` | `foldMap(maybe(id), (k) => registry[k])`. | S | |
| U3 | statement-import/statement-import.screen.tsx:59-60,117,119 | Nullable-map ternaries. | fnts `maybe` / `foldMap`. | S | |
| U3 | column-mapping/column-mapping.screen.tsx:129-136,144-146,992,993-995 | Nullable-map ternaries. | fnts `maybe` / `foldMap`. | S | |
| U3 | statement-import/example-transaction/example-transaction.component.tsx:53 | `mcc !== undefined ? categoryForMcc(mcc) : null` | fnts `maybe` / `foldMap`. | S | |
| U3 | column-mapping/column-select-field/column-select-field.component.tsx:60,68,77 | `testID ? \`${testID}-…\` : undefined` | One `suffixTestID` helper using `foldMap`, like field-trigger's `deriveErrorTestID`. | S | |
| U4 | statement-import/statement-import.screen.tsx:96-108 | try/catch-to-undefined. Twin of the next row. | `eitherSync` + `bifold`/`fold`. | S | |
| U4 | column-mapping/column-mapping.screen.tsx:339-348 | try/catch-to-undefined. Twin of the row above. | `eitherSync` + `bifold`/`fold`. | S | |
| U4 | settings/import-data/import-data.screen.tsx:40-49 | try/catch around `decodeURIComponent`. | `eitherSync`, and merge with `fileNameOf` (G2). | S | |
| U5 | column-mapping/column-mapping.screen.tsx:127-147,279-295,370-374,389-403,436-442 | if/ternary chains over the closed unions `AmountMode`, `CurrencyMode`, `Encoding`, `LoadState['kind']`. | `match().exhaustive()` or a typed `Record` (e.g. `Record<LoadState['kind'], Key \| undefined>`). | S | |
| U5 | statement-import/statement-import.screen.tsx:397,465,603-619 | Repeated `loadState.kind ===` checks. | `match(loadState)`. | S | |
| U5 | column-mapping/amount-fields/amount-fields.component.tsx:47,60 | `mode === 'single' &&` / `mode === 'debitCredit' &&` | A `Record<AmountMode, ReactNode>` or `match`. | S | |
| U5 | column-mapping/currency-fields/currency-fields.component.tsx:46,59 | Same pattern as its twin amount-fields. | The same fix. | S | |
| U5 | account-detail/crypto-sync-form/crypto-sync-form.component.tsx:57,59 | `source === …` repeated. | A `Record<BalanceProviderId, ReactNode>`. | S | |
| U5 | account-detail/binance-credentials-field/binance-credentials-field.component.tsx:40-45 | if/else over the `Field` union. | A `Record<Field, setter>`. | S | |
| U6 | statement-import/statement-import.screen.tsx:116,182,183 | `ReturnType<typeof previewStats>` and `ReturnType<typeof useTargetHoldingOptions>`. The twin column-mapping.screen.tsx:59,492 uses `PreviewStats`. | Use `PreviewStats` / `TargetHoldingOption[]`. | S | |
| U6 | column-mapping/column-mapping.screen.tsx:556-564 | `Partial<Record>` for complete key sets, built through a helper fn. | A plain `Record` literal at module scope. | S | |
| U6 | settings/categories/categories.screen.tsx:205-215 | A permanently disabled Button with `onPress={() => {}}` is used as a static marker. | `SymbolIcon` in the same slot, or a DS marker component. | S | |
| U6 | statement-import/import-outcome/import-outcome.component.tsx:23-44 | `result &&` is repeated 3 times. | Return early when `result` is undefined. | S | |
| U6 | statement-import/preview-stats/preview-stats.ts:24-31 | `firstTransaction` is optional only so that old test literals compile. | Make it required (`\| undefined`) and fix the literals. | S | |
| U6 | account-detail/account-detail.screen.tsx:1-4; bank-sync-section.component.tsx:4,6; crypto-sync-section.component.tsx:1; statement-import/use-target-holding-options/use-target-holding-options.ts:1-8; settings/settings/settings.screen.tsx:5; settings/import-data/import-data.screen.tsx:5-6; settings/export-data/export-data.screen.tsx:6; settings/categories/categories.screen.tsx:3,6; settings/categories/add-category-row/add-category-row.component.tsx:3; settings/system/system.screen.tsx:1 | Within one file, the `@kiko/*` alias and relative paths are mixed for cross-feature imports. | Use one style per file: `@kiko/*` for cross-feature imports (file-structure memory). | M | |
| U7 | account-detail/bank-sync-section/bank-sync-section.component.tsx:52-79,200 vs crypto-sync-section.component.tsx:31-35,91 | The sibling sections diverge: disconnect copy via `Partial<Record>` + default vs `match().exhaustive()`; gap 4 vs 3; bank picks its provider via button + sheet, crypto via inline chips. | One shared connected-state block and one provider-choice pattern (see G2). | M | |
| U7 | account-detail/wallet-address-field/wallet-address-field.component.tsx:49; monobank-connect-field.component.tsx:41; binance-credentials-field.component.tsx:56 | The Connect flow style diverges: `.then` vs an async IIFE. | Use one async/await handler shape in all three. | S | |
| U7 | account-detail/bank-sync-section:28; crypto-sync-section:26; crypto-sync-form:15; monobank-connect-field:12; binance-credentials-field:16; wallet-address-field:12; holding-card:44; settings/categories/add-category-row:22 | Props types are declared inline. Siblings (clipboard-text-field, sync-status-line, add-bank-sheet, …) use `<name>.props.d.ts`. | A `.props.d.ts` per component folder (kiko-code-style "One component per file"). | S | |
| U7 | settings/system/app-lock-setting/ (no index.ts); settings/system/system.screen.tsx:15 | There is no barrel, so the screen imports `.component` directly. | Add `index.ts`, like every sibling folder. | S | |
| U7 | column-mapping/column-mapping.screen.tsx:574,593 vs 637,671,692,713 | The raw-preview and file-format sections lack `styles.fieldGroup`, which the other sections carry. The skill requires one uniform section spacing. | Apply the same group style to every section. | S | |
| U8 | account-detail/account-detail.styles.ts:4-66 | The sub-component styles (`statusLine`, `tokenFieldColumn`, `inputRow`, `pasteButtonWrapper`, `linkPressable`) live in the screen styles and are imported by 7 sub-folders. | Put each sub-component's styles in its own `.styles.ts`. | S | |
| U8 | account-detail/format-last-sync.ts; account-detail/format-last-sync.test.ts | Loose files in the screen root. | Move them to a `format-last-sync/` folder. | S | |
| U8 | settings/settings/settings.styles.ts:1-51; settings/settings-row/settings-row.component.tsx:8; settings/settings/settings.screen.tsx:38-51 | SettingsRow's styles live in the settings screen folder, while the screen's own styles are inline. | Move them to `settings-row.styles.ts`, and the screen's styles to `settings.styles.ts`. | S | |
| U8 | account-detail/clipboard-text-field (used by settings/import-data:16); account-detail/crypto-sync-form, account-detail/monobank-connect-field (used by forms/account-form); statement-import/{target-holding-field,import-result-sheet,preview-stats,use-target-holding-options} (used by column-mapping:57-69); home/transaction-row/transaction-card (used by statement-import/example-transaction:19) | Cross-screen shared units live inside one screen's folder. | Move them to a shared location (design-system, or a shared screens folder). | M | |
| U8 | account-detail/crypto-sync-form/ | No test next to the unit. | Add crypto-sync-form.component.test.tsx. | S | |
| U9 | account-detail/account-detail.screen.tsx:232,239,244; account-detail/account-detail.styles.ts:24-28 | A hand-rolled `<Box style={styles.divider}/>` is used where a `Divider` exists. | The shared `Divider` (as settings.screen.tsx:194). | S | |
| G1 | column-mapping/column-mapping.styles.ts:10-12 | `resultBlock` is unused; mapping-result.styles.ts has its own. | Delete it. | S | |
| G1 | account-detail/bank-sync-section/bank-sync-section.component.tsx:52-79 | `DisconnectCopy`, its map and its default serve one provider, and the key types are Monobank literals (speculative generality). | Pass the two keys directly. | S | |
| G1 | column-mapping/column-mapping.screen.tsx:590-592; statement-import/import-result-sheet/import-result-sheet.component.tsx:19-22; statement-import/import-result-sheet/import-result-sheet.props.d.ts:16-17; account-detail/account-detail.screen.tsx:143-145,154-157; settings/settings/settings.screen.tsx:158-160; settings/settings-row/settings-row.chevron.ts:3; settings/settings/settings.styles.ts:5-7; settings/settings-row/settings-row.component.tsx:13; account-detail/holding-card/holding-card.styles.ts:6; settings/categories/add-category-row/add-category-row.styles.ts:5; settings/categories/categories.screen.tsx:46-47 | Stale or false comments. Examples: "ChipRow" (actually SegmentedControl); "error stays inline ImportOutcome" (now an Alert); "connect-field catch above" (no connect field in the file); "Color Scheme"; "dark \| light"; "GlassSurface" (now Card); "compact ghost Button". | Correct or delete each comment. | S | |
| G2 | statement-import/statement-import.screen.tsx:126-129,296-303,336-393,471-547 vs column-mapping/column-mapping.screen.tsx:79-89,817-829,859-920,1049-1126 | Twin screens duplicate the `LoadState`, the file-read effect, the `holdingId` effect, and the import → sheet → `popTo` flow and Alert. They diverge on the `.xls` check, the 0-row gate and the `handleSheetClosed` guard. | Extract `useStatementFile(filePath)` and `useImportFlow()` hooks. | M | |
| G2 | account-detail/bank-sync-section/bank-sync-section.component.tsx:188-271 vs crypto-sync-section.component.tsx:82-158 | The connected-state block (heading, last-sync line, Sync/Disconnect row, error, ConfirmSheet) is duplicated. | Extract a `ConnectedSyncBlock` component. | M | |
| G2 | account-detail/bank-sync-section/bank-sync-section.component.tsx:147-155 | `connectMonobank` (`saveToken` + sync) duplicates forms/account-form/account-form.screen.tsx:~265-275. | One helper in src/monobank. | S | |
| G2 | account-detail/monobank-token-input/monobank-token-input.component.tsx:30-39; binance-credentials-field.component.tsx:84-93; settings/settings/settings.screen.tsx:140-148 | Three copies of an external-link `Pressable` + `Text`. | One shared link component in the design-system. | S | |
| G2 | settings/import-data/import-data.screen.tsx:40-49,62-99 vs account-detail/account-detail.screen.tsx:148-189 and src/statement-import/read-statement-file/read-statement-file.ts:90 | `fileNameFrom` percent-decodes; `fileNameOf` does not. The pick + `keepLocalCopy` flow is duplicated, with divergent failure handling. | One `pickLocalCopy` + one file-name helper. | S | |
| G2 | settings/settings-row/settings-row.chevron.ts:5 | `AppTheme` is re-declared (the same as disabled-field-style.ts). | Export one theme type. | S | |
| G2 | column-mapping/column-mapping.screen.tsx:93-110 vs 409-426 | `MappingFormFields` and `SavedFormState` are near-identical types. | One type (derive with `Omit`/`Partial`). | S | |
| G3 | account-detail/add-bank-sheet/ | The folder name `add-bank-sheet` does not match the component `AddBankProviderSheet`. | Rename one to match the other. | S | |
| G3 | account-detail/account-detail.screen.tsx:129 | `showActionButton` gates the whole BankSyncSection. | `showBankSync`. | S | |
| G3 | account-detail/account-detail.styles.ts:31; clipboard-text-field.component.tsx:68 | `tokenFieldColumn` is used by the generic ClipboardTextField. | `inputColumn`. | S | |
| G4 | column-mapping/column-mapping.screen.tsx:792-1220 | One screen mixes 17 form `useState`s, file read, decode, saved-mapping prefill, validation, import + mapping save, and navigation. It also re-decodes base64, re-parses the whole file and re-applies the mapping on every render (:922-925, :992). | `useColumnMappingForm` (reducer), `useStatementFile`, a memoized `useMappedPreview`, `useImportFlow`. | L | |
| G4 | statement-import/statement-import.screen.tsx:291-647 | File I/O, encoding fallback, detection, auto-replace, cleanup, import and navigation in one component. It parses the file on every render (:403-404), and the auto-replace effect re-runs `readTableRows` on every render because `input` is a new object each render (:396-399, :416-421). | `useStatementFile` + `useMemo` for format/stats + `useImportFlow`. | M | |
| G5 | statement-import/statement-import.screen.tsx:365-376 | The screen owns the UTF-8 → cp1251 decode fallback policy. | Move it to read-statement-file (`readStatementInput`). | S | |
| G5 | column-mapping/column-mapping.screen.tsx:1076-1082 | The screen owns mapping-save keying (fingerprint + `mappingKeyFor` + `saveStatementMapping`). | Move it to src/statement-import/column-mapping (`importMappedStatement`). | S | |
| G5 | settings/import-data/import-data.screen.tsx:131-135 | The screen detects a wrong key by matching the data layer's message prefix `'data-transfer/decrypt'`. | Have `importData` return a typed error kind. | S | |
| G6 | account-detail/wallet-address-field/wallet-address-field.component.tsx:49-55; monobank-connect-field.component.tsx:52; binance-credentials-field.component.tsx:73 | A rejected `onConnect` has no catch. Status stays `checking` and Connect stays disabled. | Catch the rejection and set a `saveError` status. | S | |
| G6 | settings/export-data/export-data.screen.tsx:94-98 | `Share.share` has no catch here, while `runExport` (:71-75) catches the same call. | Make both call sites handle it the same way. | S | |
| G6 | settings/categories/categories.screen.tsx:122,130,136,155,159 | Repo writes are not awaited and are unhandled, so a failure is silent. | Await them and show an Alert on failure. | S | |
| G7 | account-detail/account-detail.screen.test.tsx:31-39,56-90,102-103,106-120,156-157,~950-980 | An inline Text mock duplicates src/test-support/mock-text-tone.tsx. The `useNavigation` mock is for a removed HoldingCard `transitionEnd` workaround. `mockAccountSetIcon`/`Update` are never asserted. The file re-tests BankSyncSection disconnect, which bank-sync-section.component.test.tsx already covers. | Use the shared mock. Delete the stale mocks. Keep section behavior in the section test. | S | |
| G7 | settings/settings/settings.screen.test.tsx:41 | It mocks `APP_LOCK_ENABLED`, which SettingsScreen never reads. | Delete it. | S | |
| G7 | statement-import/preview-stats/preview-stats.test.ts:39-49 | The empty-parse test does not assert `dateSpan`, so it misses the NaN bug. | Assert `dateSpan`. | S | |
| G7 | account-detail.test:122,239-248; statement-import.test:68; column-mapping.test:56; categories.test:99; settings.test:52; system.screen.test:47; system.screen.app-lock-off.test:38; bank-sync-section.test:15; crypto-sync-section.test:17,72 | Each test hand-rolls a `use-live-query` per-table mock and an inline Button mock. | Shared factories in src/test-support (for example `mockLiveQueryByTable`, `MockButton`). | M | |
| G7 | column-mapping/column-mapping.screen.test.tsx:81 | The mock path `'./../statement-import/target-holding-sheet'` is malformed. | `'../statement-import/target-holding-sheet'`. | S | |
| U2 | statement-import/statement-import.screen.tsx:62,131-140,144,174,188,210-214,285,298,301,304,315,325-335,368-373,401,407-413,426-431,436-450,467,493,501-530,549,557,563-565,581 | The comments carry task/review ids (F3, F4 audit, T7, N2, M8, R2-1, C1, "section C.2", a `.superpowers/sdd/...task-2-report.md` path) and history ("FORMER inline gate"). | Keep only the WHY; delete the ids and history. | S | |
| U2 | column-mapping/column-mapping.screen.tsx:78,151-153,204,246-252,359,447-453,499,575-578,590-592,710-712,781-790,820-829,852-858,899-912,929,998,1043,1084,1092-1111,1130 | Same problem. | Same fix. | S | |
| U2 | account-detail/account-detail.screen.tsx:75-82,123-124,131-147,167-178,256; account-detail/account-detail.styles.ts:34-45 (includes the date 2026-09-17) | Same problem. | Same fix. | S | |
| U2 | account-detail/bank-sync-section/bank-sync-section.component.tsx:65-67,89-91,113-121,131-132,255-258,297-305 | Same problem ("5.6 remediation … were removed", F3/N3/I1). | Same fix. | S | |
| U2 | account-detail/crypto-sync-section/crypto-sync-section.component.tsx:45-47,51-52,141-143 | Same problem. | Same fix. | S | |
| U2 | account-detail/add-bank-sheet/add-bank-sheet.component.tsx:19-23,32-35 | Same problem. | Same fix. | S | |
| U2 | account-detail/clipboard-text-field/clipboard-text-field.component.tsx:20-46 | Same problem ("two earlier failed attempts…"). | Same fix. | S | |
| U2 | account-detail/holding-card/holding-card.component.tsx:37-43 | Same problem. | Same fix. | S | |
| U2 | account-detail/format-last-sync.ts:11-14 | Same problem ("It previously returned…"). | Same fix. | S | |
| U2 | column-mapping/column-select-field/column-select-field.props.d.ts:16,22-23 | Same problem. | Same fix. | S | |
| U2 | column-mapping/mapping-result/mapping-result.component.tsx:16-25,36-38,55; mapping-result.props.d.ts:11-20 | Same problem. | Same fix. | S | |
| U2 | column-mapping/raw-preview/raw-preview.component.tsx:12,19,23-31; raw-preview.styles.ts:7-9,15-17,25,30-35; column-widths.ts:13-17 | Same problem. | Same fix. | S | |
| U2 | settings/categories/categories.screen.tsx:70-71,106-107,143,306,327-347,376 | Same problem. | Same fix. | S | |
| U2 | settings/export-data/export-data.screen.tsx:119-122; export-data.styles.ts:12-24 | Same problem. | Same fix. | S | |
| U2 | settings/import-data/import-data.screen.tsx:83,143-147 | Same problem. | Same fix. | S | |
| U2 | settings/settings/settings.screen.tsx:75-102,170-184 | Same problem. | Same fix. | S | |
| U2 | settings/settings-row/settings-row.chevron.ts:8,22; settings-row.props.d.ts:14 | Same problem. | Same fix. | S | |
| U2 | statement-import/example-transaction/example-transaction.component.tsx:26-27,36,44; example-transaction.props.d.ts:7 | Same problem. | Same fix. | S | |
| U2 | statement-import/import-outcome/import-outcome.component.tsx:10-13; import-outcome.props.d.ts:4-8 | Same problem. | Same fix. | S | |
| U2 | statement-import/import-result-sheet/import-result-sheet.component.tsx:12-33; import-result-sheet.props.d.ts:4-6,15,24 | Same problem. | Same fix. | S | |
| U2 | statement-import/preview-stats/preview-stats.ts:10,16,18-19,25,28-29,43-46 | Same problem. | Same fix. | S | |
| U2 | statement-import/target-holding-field/target-holding-field.component.tsx:11-20; target-holding-field.props.d.ts:12 | Same problem. | Same fix. | S | |
| U2 | statement-import/target-holding-sheet/target-holding-sheet.component.tsx:17-18,40-44; target-holding-sheet.props.d.ts:15 | Same problem. | Same fix. | S | |
| U2 | tests: account-detail.screen.test:260,615,624,650,832,1140,1214-1251; bank-sync-section.test:133-177 (incl. an `it('N3: …')` title); crypto-sync-section.test:199; holding-card.test:163,205; column-mapping.screen.test:182-717 (incl. test titles at 245,254,610,674); mapping-result.test:19,32; raw-preview.test:72,89; import-data.test:80; settings-row.chevron.test:13; settings-row.component.test:28,49,130; settings.screen.test:181-259; example-transaction.test:19-115; import-outcome.test:65; import-result-sheet.test:17,61; statement-import.screen.test:15-931 (incl. describe titles at 683,815,894); target-holding-field.test:43,65; target-holding-sheet.test:115; use-target-holding-options.test:24 | Ids and history in test comments and test titles. | Rename the titles by behavior; delete the ids. | M | |
| M-import-ordering-length-sort | account-detail/account-detail.screen.tsx:1-13,15-37 | The external group is alphabetical (L2<L1, L3<L2, L7<L6, L12<L11). The `../` group is unsorted (L22<L21, L34<L33). | Re-sort by the length of each import's ending line. | S | |
| M-import-ordering-length-sort | account-detail/bank-sync-section/bank-sync-section.component.tsx:8-26 | The `../**` group is split into two blocks (L8-21, L23-26). | Merge into one group and length-sort. | S | |
| M-import-ordering-length-sort | account-detail/crypto-sync-form/crypto-sync-form.component.tsx:5-13 | The `../` group is unsorted (L10>L11, L12>L13). | Same fix. | S | |
| M-import-ordering-length-sort | account-detail/crypto-sync-section/crypto-sync-section.component.tsx:1-24 | The whole file is alphabetical. | Same fix. | S | |
| M-import-ordering-length-sort | account-detail/format-last-sync.ts:3-5 | L3 (52) before L4 (50). | Same fix. | S | |
| M-import-ordering-length-sort | account-detail/holding-card/holding-card.component.tsx:1-2,13-14 | Unsorted. | Same fix. | S | |
| M-import-ordering-length-sort | account-detail/sync-status-line/sync-status-line.component.tsx:1-8 | Alphabetical. | Same fix. | S | |
| M-import-ordering-length-sort | column-mapping/column-mapping.screen.tsx:1-8,10-47,49-69 | All three groups are unsorted. `../` imports (L55-69) sit in the `./` block. | Same fix. | S | |
| M-import-ordering-length-sort | column-mapping/column-select-field/column-select-field.component.tsx:1-2 | L1 (42) before L2 (33). | Same fix. | S | |
| M-import-ordering-length-sort | column-mapping/mapping-result/mapping-result.component.tsx:8-10 | A `../../` import (L10) sits in the `./` group. | Same fix. | S | |
| M-import-ordering-length-sort | settings/categories/add-category-row/add-category-row.component.tsx:6-14 | Alphabetical. | Same fix. | S | |
| M-import-ordering-length-sort | settings/categories/categories.screen.tsx:11-25 | L15>L16, L21>L22. | Same fix. | S | |
| M-import-ordering-length-sort | settings/import-data/import-data.screen.tsx:1-8 | L5 (61) before L6 (34). | Same fix. | S | |
| M-import-ordering-length-sort | settings/settings-row/settings-row.component.tsx:5-8 | Alphabetical. | Same fix. | S | |
| M-import-ordering-length-sort | settings/settings/settings.screen.tsx:1-23 | External unsorted (L1>L2, L4>L5). `../` unsorted (L16>L17) and split (L22-23). | Same fix. | S | |
| M-import-ordering-length-sort | settings/system/app-lock-setting/app-lock-setting.component.tsx:1-12 | Alphabetical. | Same fix. | S | |
| M-import-ordering-length-sort | settings/system/system.screen.tsx:1-16 | Alphabetical; `../settings-row` (L16) sits in the `./` block. | Same fix. | S | |
| M-import-ordering-length-sort | statement-import/statement-import.screen.tsx:1-7,9-38,40-51 | Unsorted (L1>L2, L4>L5, L16>L17, L31>L32>L33). A `../forms/scroll-to-field` import (L46) sits in the `./` block. | Same fix. | S | |
| M-import-ordering-length-sort | tests (length sort): account-detail.screen.test:1-3,9-14; binance-credentials-field.test:1-2; crypto-sync-section.test:1-2; format-last-sync.test:2-3; holding-card.test:10-11; monobank-token-input.test:1-2; add-category-row.test:1-2; categories.screen.test:5 (a `@kiko` alias after `../`),12-13; settings-row.component.test:1-2,4-5; settings.screen.test:2-3,7-8,15-16; app-lock-setting.test:1-2; app-lock-setting.native-throw.test:1-2; system.screen.app-lock-off.test:1-2; system.screen.test:1-3,5-6; statement-import.screen.test:8-9 | Not length-sorted. | Re-sort within each segment, and do not cross a side-effect import. | S | |
| M-import-ordering-length-sort | tests (group blank lines): nearly every test file in the area (add-bank-sheet, bank-sync-section, clipboard-text-field, crypto, monobank-connect, monobank-token, sync-status-line, wallet, amount-fields, column-mapping, column-select-field, currency-fields, mapping-result, raw-preview, add-category-row, categories, export-data, import-data, settings-row, settings, app-lock-setting, system, import-outcome, import-result-sheet, preview-detail-list, statement-import, target-holding-field, target-holding-sheet; account-detail.screen.test:6) | There is no blank line between the groups around the side-effect imports. | Add the blank lines. Keep the side-effect imports in place (they are barriers). | S | |


### R5 — Design system and calendar

| Rule | file:line | What is wrong | Fix | Effort | Tags |
|---|---|---|---|---|---|
| S-DS | src/calendar/calendar-header/calendar-header.component.tsx:45-85 | 4 year/month nav controls: 16pt glyph + `hitSlop={8}` ≈ 32pt tap target (HIG floor is 44). `size={16}` is a raw literal. | `theme.iconSizes.caption`; icon-only Button (see U9 row) restores 44pt. Visual change. | S | |
| S-DS | src/design-system/components/bottom-sheet/bottom-sheet.styles.ts:265 | Grabber `borderRadius: 2.5` is a raw radius. | `theme.radii.full` | S | |
| S-DS | src/design-system/components/button/button.component.tsx:81-89 | JSX siblings (icon / label / trailingIcon) have no blank line between them. | Add blank lines. | S | |
| S-DS | src/design-system/components/currency-breakdown/currency-breakdown.component.tsx:16-19,33-42 | JSX siblings have no blank line between them. | Add blank lines. | S | |
| S-DS | src/design-system/components/currency-breakdown/currency-breakdown.styles.ts:8,20 | `flexDirection: 'row'` in styles; Box has a `direction` prop. | `<Box direction="row">` | S | |
| S-DS | src/design-system/components/entity-icon-tile/entity-icon-tile.component.tsx:82-83 | Sibling `<Stop>` nodes have no blank line. | Add blank line. | S | |
| S-DS | src/design-system/components/screen/screen.component.tsx:118-119,151-152,171-172 | Child and footer siblings have no blank line. | Add blank lines. | S | |
| S-DS | src/design-system/components/summary-table/summary-table.component.tsx:26-34 | Label and value siblings have no blank line. | Add blank line. | S | |
| S-DS | src/design-system/components/text/text.component.tsx:7-26 | Text hand-lists 4 props. It drops testID, accessibilityRole and other RN props. It does not widen from RN `TextProps` or spread `{...props}` (the wrapping rule). | Pick from RN TextProps, spread `{...props}` before `style`. | M | |
| S-DS | src/design-system/components/divider/divider.props.d.ts:3-7 | Props are hand-declared, not widened from ViewProps. | `Pick<ViewProps,'style'\|'testID'>` + spread | S | |
| S-DS | src/design-system/components/icon-picker-modal/icon-picker-modal.component.tsx:80-92 | Selected-tile fill is an inline style object with a ternary. | `styles.optionSelected`, as selectable-row.styles.ts:19 does. | S | |
| S-DS | src/design-system/components/option-pills/option-pills.component.tsx:66-70 | Inline `{backgroundColor: isSelected ? accent : 'transparent'}`. | Styles member, as selectable-row does. | S | |
| S-STYLE | src/calendar/calendar-header/calendar-header.component.tsx:3,4,6,9 | Imports not length-sorted within their group. | Re-sort ascending by ending-line length. | S | |
| S-STYLE | src/calendar/kiko-calendar/kiko-calendar.component.test.tsx:3 | No blank line between import groups. | Add blank line. | S | |
| S-STYLE | src/calendar/kiko-calendar/kiko-calendar.component.tsx:8 | Import length order. | Re-sort. | S | |
| S-STYLE | src/calendar/kiko-calendar/kiko-calendar.day-cell-color.test.tsx:3,4,14,15 | Import length order. | Re-sort. | S | |
| S-STYLE | src/design-system/components/bottom-sheet/bottom-sheet.component.tsx:2,4,5,12,19 | Import length order. | Re-sort. | S | |
| S-STYLE | src/design-system/components/bottom-sheet/bottom-sheet.component.test.tsx:23,48 | No blank line before `return`. | Add blank line. | S | |
| S-STYLE | src/design-system/components/button/button.component.test.tsx:2,3 | Import length order. | Re-sort. | S | |
| S-STYLE | src/design-system/components/button/button.component.tsx:3,4,9 | Import length order. | Re-sort. | S | |
| S-STYLE | src/design-system/components/card-context-menu/card-context-menu.component.test.tsx:11 | No blank line between groups. | Add blank line. | S | |
| S-STYLE | src/design-system/components/card/card.component.tsx:6 | Import length order. | Re-sort. | S | |
| S-STYLE | src/design-system/components/confirm-sheet/confirm-sheet.component.test.tsx:2 | No blank line between groups. | Add blank line. | S | |
| S-STYLE | src/design-system/components/currency-breakdown/currency-breakdown.component.test.tsx:6,23,25 | No group blank line (6); no blank line before `return` (23,25). | Add blank lines. | S | |
| S-STYLE | src/design-system/components/currency-breakdown/currency-breakdown.component.tsx:4,6,9 | Import length order. | Re-sort. | S | |
| S-STYLE | src/design-system/components/currency-field/currency-field.component.test.tsx:2,3 | Length order (2); no group blank line (3). | Re-sort, add blank line. | S | |
| S-STYLE | src/design-system/components/currency-field/currency-field.component.tsx:2 | Import length order. | Re-sort. | S | |
| S-STYLE | src/design-system/components/divider/divider.component.tsx:6 | Import length order. | Re-sort. | S | |
| S-STYLE | src/design-system/components/edit-header-button/edit-header-button.component.test.tsx:2 | No blank line between groups. | Add blank line. | S | |
| S-STYLE | src/design-system/components/entity-icon-tile/entity-icon-tile.component.test.tsx:2 | No blank line between groups. | Add blank line. | S | |
| S-STYLE | src/design-system/components/entity-icon-tile/entity-icon-tile.styles.ts:1-2 | Two imports from `react-native-unistyles`, in the wrong length order. | One import: `{ StyleSheet, type UnistylesThemes }`. | S | |
| S-STYLE | src/design-system/components/field-error/field-error.component.test.tsx:2,3 | No blank line between groups. | Add blank lines. | S | |
| S-STYLE | src/design-system/components/field-label/field-label.component.test.tsx:2,3,4 | Length order (2); no group blank lines (3,4). | Re-sort, add blank lines. | S | |
| S-STYLE | src/design-system/components/field-trigger/field-trigger.component.test.tsx:2,3 | No blank line between groups. | Add blank lines. | S | |
| S-STYLE | src/design-system/components/glass-surface/glass-surface.component.test.tsx:7,13,52,54,221,585,635,674,704 | No group blank lines (7,13); no blank line before `return`/`if` (rest). | Add blank lines. | S | |
| S-STYLE | src/design-system/components/glass-surface/glass-surface.component.tsx:2,4,8,22-26,43-44,54-56 | Import length order. Chains of one-line `if (...) return x;` with no blank lines and no braces. | Re-sort; braced ifs with a blank line before each, as entity-tint.ts:73-81 does. | S | |
| S-STYLE | src/design-system/components/glass-surface/glass-surface.resample.hook.ts:29,85,97 | Import length order (29); no blank line before `return`/`if` (85,97). | Re-sort, add blank lines. | S | |
| S-STYLE | src/design-system/components/icon-editor/icon-editor.component.test.tsx:2,3,4,8 | Length order; no group blank lines; a `./` import placed before a `../` import (8). | Regroup and re-sort. | S | |
| S-STYLE | src/design-system/components/icon-editor/icon-editor.component.tsx:3,7,8,11 | Import length order. | Re-sort. | S | |
| S-STYLE | src/design-system/components/icon-picker-modal/icon-picker-modal.component.test.tsx:8,10 | No group blank lines; group order wrong (10). | Regroup. | S | |
| S-STYLE | src/design-system/components/keyboard-done-accessory/use-keyboard-done-accessory.test.tsx:2,10,14,25 | Length order; no group blank lines; no blank line before `return` (25). | Fix all three. | S | |
| S-STYLE | src/design-system/components/language-switch/language-switch.component.test.tsx:2 | No blank line between groups. | Add blank line. | S | |
| S-STYLE | src/design-system/components/money-text/money-text.component.test.tsx:2,5,7 | Length order; no group blank line. | Fix. | S | |
| S-STYLE | src/design-system/components/money-text/money-text.component.tsx:3,7 | Import length order. | Re-sort. | S | |
| S-STYLE | src/design-system/components/option-pills/option-pills.component.test.tsx:2,3 | Length order; no group blank line. | Fix. | S | |
| S-STYLE | src/design-system/components/option-pills/option-pills.component.tsx:7,10 | Import length order. | Re-sort. | S | |
| S-STYLE | src/design-system/components/screen/screen.component.test.tsx:2,10,63,70 | Length order; no group blank line; no blank line before `return`. | Fix. | S | |
| S-STYLE | src/design-system/components/screen/screen.component.tsx:7,8 | Import length order. | Re-sort. | S | |
| S-STYLE | src/design-system/components/segmented-control/segmented-control.component.test.tsx:3 | No blank line between groups. | Add blank line. | S | |
| S-STYLE | src/design-system/components/selectable-row/selectable-row.component.test.tsx:3 | No blank line between groups. | Add blank line. | S | |
| S-STYLE | src/design-system/components/sheet-footer/sheet-footer.component.tsx:23 | Component uses an implicit `=> (` return. | Explicit `return`. | S | |
| S-STYLE | src/design-system/components/switch/switch.component.test.tsx:2 | Import length order. | Re-sort. | S | |
| S-STYLE | src/design-system/components/switch/switch.component.tsx:9 | Import length order. | Re-sort. | S | |
| S-STYLE | src/design-system/components/symbol/symbol.component.test.tsx:2,3,15 | Length order; no group blank lines. | Fix. | S | |
| S-STYLE | src/design-system/components/symbol/symbol.component.tsx:3,6 | Import length order. | Re-sort. | S | |
| S-STYLE | src/design-system/components/symbol/symbol.color.ts:28 | Abbreviated names `r, g, b, a`. | `red, green, blue, alpha` | S | |
| S-STYLE | src/design-system/components/text-field/text-field.component.test.tsx:3,4,6 | Length order; no group blank lines. | Fix. | S | |
| S-STYLE | src/design-system/components/text/text.component.test.tsx:2,3 | No blank line between groups. | Add blank lines. | S | |
| S-STYLE | src/design-system/components/text/text.component.tsx:5,17 | Import length order; no blank line before `return`. | Fix. | S | |
| S-STYLE | src/design-system/entity-tint.ts:95,109 | `#${a}${b}${c}` hex built with a multi-part template literal. | `'#'.concat(...)`, as symbol.color.ts:31 does. | S | |
| S-STYLE | src/design-system/theme.test.ts:2,52,53,67,68,151 | Length order; braceless `if` with no blank line; `r,g,b,alphaStr` abbreviations. | Fix. | S | |
| S-I18N | src/calendar/calendar-header/calendar-header.component.tsx:26-28 | The grid is Sunday-first (library default; no `firstDay`). Ukrainian users, and most of their host countries, expect Monday-first. | `firstDay={1}` in KikoCalendar + rotate WEEKDAY_KEYS. Behavior change. | S | USER-DECISION: Monday-first, or follow locale? |
| U2 | src/design-system/theme.ts:1-2,47-48,63-75,98-116,123-132,140-141,189-199 | Spec section numbers, "F3 fix round 1, I3", "on-device review of the initial 0.30… +0.08", "Lowered from 0.55", "before this". | Keep only the WHY; drop ids and history. | S | |
| U2 | src/design-system/palette.ts:5-7 | "previously aliased…" | Drop history. | S | |
| U2 | src/design-system/disabled-field-style.ts:3,10 | Stale "(dark \| light)" and "in both themes" (app is dark-only). | Fix the text. | S | |
| U2 | src/design-system/entity-tint.ts:46-48,59,62-68,99-101,127,139-146,187 | Commit hash 8e2e759, "DEVICE BUG (review, 2026-09-13)", "used to", "tried first", "F3 fix round 1". | Drop history. | S | |
| U2 | src/design-system/components/button/button.component.tsx:44-45 | Stale "`textPrimary` flips to black on light". | Drop. | S | |
| U2 | src/design-system/components/button/button.styles.ts:85-100 | Stale "text.props.ts" and "four tones" (there are six); "It used to force capitalize". | Fix and drop. | S | |
| U2 | src/design-system/components/bottom-sheet/bottom-sheet.component.tsx:32-33,44,89-101,113-116,168-223,295 | "DEVICE BUG fix", "attempt B", "build 19", "builds 17/18", "CRASH fix: this used to", "F5 device bug fix". | Keep the WHY in 1-3 lines each. | S | |
| U2 | src/design-system/components/bottom-sheet/bottom-sheet.props.d.ts:21,32-33,62-63 | "(F3 part 1 fix round 3, R2-1)", "had before", "used to render". | Drop. | S | |
| U2 | src/design-system/components/bottom-sheet/bottom-sheet.styles.ts:4-12,19,33-36,39-52,57-69,74-81,97,153-164,200-204,224-227,237-257 | "bug A2", "Bug A", "DEVICE BUG (F5)", "used to sit", "were moved from". Line 97 names `backdropGlass`, which does not exist. | Drop history; fix the stale name. | S | |
| U2 | src/design-system/components/bottom-sheet/bottom-sheet.keyboard.ts:6,14,19,78-89 | Line 6 says the lift uses "the live `useAnimatedKeyboard()` height", which is false and banned. Line 14 names the wrong file. "builds 17/18", "build 19's first pass". | Fix and drop. | S | |
| U2 | src/design-system/components/card/card.component.tsx:14-16 | "that used to be a neutral GlassSurface now…" | Drop history. | S | |
| U2 | src/design-system/components/card-context-menu/card-context-menu.component.tsx:71-72,93-94,101-104,133-138 | "unlike the old ActionSheetIOS", "byte-for-byte as before", "there is none today, but a future…" | Drop. | S | |
| U2 | src/design-system/components/currency-field/currency-field.component.tsx:89,109,133,151-154,173,213 | "(soon more)", "DEVICE BUG fix", "This used to read…", "F5 fix". | Drop. | S | |
| U2 | src/design-system/components/entity-icon-tile/entity-icon-tile.component.tsx:20-32,53-60 | Stale "plain transparent frosted surface" (cards are now `Card`); "DEVICE BUG (review, 2026-09-14)… REVERTED". | Drop. | S | |
| U2 | src/design-system/components/entity-icon-tile/entity-icon-tile.styles.ts:27-30 | "tried here and reverted (review, 2026-09-14)" | Drop. | S | |
| U2 | src/design-system/components/field-error/field-error.component.tsx:11-12,18 | "Option A, see the round-3 device-feedback brief" | Drop. | S | |
| U2 | src/design-system/components/field-error/field-error.props.d.ts:8 | Says "outer Box"; it is an `Animated.View`. | Fix. | S | |
| U2 | src/design-system/components/field-label/field-label.component.tsx:15 | "Option A" | Drop. | S | |
| U2 | src/design-system/components/field-label/field-label.props.d.ts:13 | "Option A" | Drop. | S | |
| U2 | src/design-system/components/field-trigger/field-trigger.component.tsx:22-27,89 | "rendered this exact JSX… before being unified", "Option A". | Drop. | S | feat-refactor |
| U2 | src/design-system/components/field-trigger/field-trigger.props.d.ts:4,49 | Stale "text.props.ts"; "Option A". | Fix. | S | feat-refactor |
| U2 | src/design-system/components/field-trigger/field-trigger.styles.ts:9-11,31-34 | "was a byte-for-byte copy… before", "an earlier version". | Drop. | S | |
| U2 | src/design-system/components/glass-surface/glass-surface.props.d.ts:26,45-46,107-119,141-155,164,192 | "F4 device bug fix", "(G2)", "confirmed 2026-09-12". Consumer lists name settings/category cards, Statistics charts, Home net-worth, transaction row and ledger rows; none use GlassSurface now. | Rewrite for the 3 real nav-layer consumers. | M | |
| U2 | src/design-system/components/glass-surface/glass-surface.component.tsx:68,89-163,189,194 | Stale "accounts list, settings sections". Line 189 refers to an `isStableGlass()` early return that does not exist. Long history block. | Rewrite. | M | |
| U2 | src/design-system/components/glass-surface/glass-surface.styles.ts:13,46-55,60-63 | Stale "a `gradient` is set" and "same reason as `tinted`"; "(G2)", "Device bug fix". | Fix. | S | |
| U2 | src/design-system/components/glass-surface/glass-surface.resample.hook.ts:1-2,22-27 | Date; nonexistent `isStableGlass()`. | Fix. | S | |
| U2 | src/design-system/components/icon-picker-modal/icon-picker-modal.component.tsx:41-60,84,94-98 | "used to pass slide", "F5 fix", `explore-bottomsheet.md`. Line 84 says the sheet base is "`sheetBackground` (= `surface`)"; both halves are false. Line 97 says "black-on-blue" (light theme). | Fix and drop. | S | |
| U2 | src/design-system/components/icon-picker-modal/icon-pools.ts:1-4,14-15,20,89-95 | Plan §3.0.1/§3.0.2, "T30, spec 5/D14", migration 0039, "replace the former". | Drop. | S | |
| U2 | src/design-system/components/keyboard-done-accessory/use-keyboard-done-accessory.tsx:47-55 | "REDESIGN (2026-09-14)", commit hashes. | Drop. | S | |
| U2 | src/design-system/components/keyboard-done-accessory/keyboard-done-accessory.styles.ts:28,36-40,85-92 | "builds 17/18", commits, "replacing the earlier blue". Stale "settings/system cards" (glass). | Drop. | S | |
| U2 | src/design-system/components/option-pills/option-pills.component.tsx:24-26,40-42,61-65 | Stale consumer list; "glass card behind shows through" (no glass cards now); "stays exactly as it was". | Fix. | S | |
| U2 | src/design-system/components/option-pills/option-pills.props.d.ts:12-13,17-19 | "original", "every existing consumer… unchanged". | Drop. | S | |
| U2 | src/design-system/components/option-pills/option-pills.styles.ts:13-14,23-25,33,40-42 | "original always-2-column", "(H2 in the HIG audit)", "stayed body-sized… read oversized". | Drop. | S | |
| U2 | src/design-system/components/screen/screen.component.tsx:12-16,137 | "redesign feedback round-1 brief, task 3", "feedback round-2, item 2", "round-3, item 1". | Drop. | S | |
| U2 | src/design-system/components/screen/screen.styles.ts:7-13,58-60 | "Design feedback iterated this down…", "feedback flagged". | Drop. | S | |
| U2 | src/design-system/components/screen/bottom-clearance.ts:8-10 | "Home did exactly that — 130 pt". | Drop. | S | |
| U2 | src/design-system/components/segmented-control/segmented-control.component.tsx:16,23 | "F3 fix rounds 3-4", "F3 fix round 2, M4". | Drop ids. | S | |
| U2 | src/design-system/components/segmented-control/segmented-control.props.d.ts:10 | "F3 fix round 1, M4" | Drop. | S | |
| U2 | src/design-system/components/segmented-control/segmented-control.styles.ts:3,38-41,48-49,92-93 | Round ids, "OLD track", "ponytail dropped". | Drop. | S | |
| U2 | src/design-system/components/selectable-row/selectable-row.props.d.ts:20-22,40 | "every existing caller is unaffected", "device-feedback-round-3 item 7". | Drop. | S | |
| U2 | src/design-system/components/selectable-row/selectable-row.styles.ts:48-50,65 | "an earlier version", round id. | Drop. | S | |
| U2 | src/design-system/components/sheet-footer/sheet-footer.component.tsx:10-16 | "replacing the three previously-inconsistent…", "former row gap". | Drop. | S | |
| U2 | src/design-system/components/sheet-footer/sheet-footer.styles.ts:4-6 | "previously duplicated…" | Drop. | S | |
| U2 | src/design-system/components/summary-table/summary-table.component.tsx:14-15 | "device-feedback-round-F1, items 3 and 9" | Drop. | S | |
| U2 | src/design-system/components/summary-table/summary-table.props.d.ts:16 | "pre-existing" | Drop. | S | |
| U2 | src/design-system/components/summary-table/summary-table.styles.ts:4-6 | "used before this component existed… former breakdownDetailRow" | Drop. | S | |
| U2 | src/design-system/components/symbol/symbol.props.d.ts:1-4 | Stale "light theme (flips to black)", "text.props.ts". | Fix. | S | |
| U2 | src/design-system/components/symbol/symbol.availability.ts:29 | "(§3.0.5)" | Drop. | S | |
| U2 | src/design-system/components/text/text.props.d.ts:12-13 | Stale "`textPrimary` flips to black on the light theme". | Drop. | S | |
| U2 | src/design-system/components/text-field/text-field.component.tsx:75-76,153 | Stale "accessory bar fill" (it is a pill now); "Option A". | Fix. | S | |
| U2 | src/design-system/components/text-field/text-field.props.d.ts:55 | "Option A" | Drop. | S | |
| U2 | src/design-system/components/money-text/money-text.component.tsx:30 | Stale "money-text.props.ts". | Fix. | S | |
| U2 | src/design-system/components/money-text/money-text.props.d.ts:17-18 | "so a later batch can pass…" | Drop. | S | |
| U2 | src/calendar/kiko-calendar/kiko-calendar.theme.ts:38 | "M1 in the HIG audit" | Drop. | S | |
| U2 | src/calendar/kiko-calendar/kiko-calendar.day-cell-color.test.tsx:55,65-68,131-133 | "M1…"; stale light-theme reasoning; "the state before the fix". | Fix. | S | |
| U2 | src/design-system/components/bottom-sheet/bottom-sheet.component.test.tsx:41,88-93,133-134,138-143,317,353,428,520,525 | "R2-1 (F3 part 1 fix round 3)", "bug A2", "build 19", "attempt B", "F5". | Drop. | S | |
| U2 | src/design-system/components/bottom-sheet/bottom-sheet.keyboard.test.ts:85 | "Build 19's first pass" | Drop. | S | |
| U2 | src/design-system/components/glass-surface/glass-surface.component.test.tsx:88,114,311,551-552,577 | "(G2)", dates, "used to". | Drop. | S | |
| U2 | src/design-system/components/segmented-control/segmented-control.component.test.tsx:47,77,85,122,141 | F3 round ids. | Drop. | S | |
| U2 | src/design-system/components/icon-picker-modal/icon-picker-modal.component.test.tsx:48,51,157,171 | "T30 (spec 5/D14)", also in a test NAME (51); "used to be". | Drop. | S | |
| U2 | src/design-system/components/keyboard-done-accessory/use-keyboard-done-accessory.test.tsx:95,130,156,164 | "DEVICE BUG (review, 2026-09-14)", "Addendum (review…)". | Drop. | S | |
| U2 | src/design-system/components/entity-icon-tile/entity-icon-tile.component.test.tsx:39,68 | "(review, 2026-09-13)" | Drop. | S | |
| U2 | src/design-system/components/currency-field/currency-field.component.test.tsx:4,361 | "Previously reached only by", "DEVICE BUG (review, 2026-09-14)". | Drop. | S | |
| U2 | src/design-system/components/confirm-sheet/confirm-sheet.component.test.tsx:3 | "Previously reached only by" | Drop. | S | |
| U2 | src/design-system/components/card-context-menu/card-context-menu.component.test.tsx:12 | "Previously reached only by" | Drop. | S | |
| U2 | src/design-system/components/field-trigger/field-trigger.leading-text-mark-variant.test.tsx:29-30 | "DEVICE BUG (review, 2026-09-14)… used to" | Drop. | S | feat-refactor |
| U2 | src/design-system/components/text-field/text-field.component.test.tsx:220,226 | "Option A" in a comment and in a test name. | Drop. | S | |
| U2 | src/design-system/components/option-pills/option-pills.component.test.tsx:60 | "(M3)" | Drop. | S | |
| U2 | src/design-system/components/switch/switch.component.test.tsx:24 | "previously overflowed" | Drop. | S | |
| U2 | src/design-system/components/symbol/symbol.availability.test.ts:78 | "used to resolve to" | Drop. | S | |
| U2 | src/design-system/entity-tint.test.ts:120 | "which used to reach" | Drop. | S | |
| U2 | src/design-system/theme.test.ts:7-10,19-21,31,41-47 | "Darkened from the original…", "Lowered from 0.55", "the fix for the device bug". | Drop. | S | |
| U3 | src/design-system/components/segmented-control/segmented-control.component.tsx:50,71,77 | `testID ? \`${testID}-x\` : undefined` | Shared `deriveTestID` (see G2) using `foldMap(maybe(testID), …)`. | S | |
| U3 | src/design-system/components/selectable-row/selectable-row.component.tsx:97 | Same banned ternary. | Same. | S | |
| U3 | src/design-system/components/currency-field/currency-field.component.tsx:167 | `selected === undefined ? undefined : currencySymbol[selected]` | `foldMap(maybe(selected), (c) => currencySymbol[c])` | S | |
| U3 | src/design-system/components/bottom-sheet/bottom-sheet.component.tsx:334 | `backdropAccessibilityLabel === undefined ? undefined : 'button'` | fmap/foldMap | S | |
| U3 | src/design-system/components/text-field/text-field.component.tsx:47-48 | `deriveTestID` body is the banned ternary. | foldMap | S | |
| U3 | src/design-system/components/field-trigger/field-trigger.component.tsx:17-18 | `deriveErrorTestID` body is the banned ternary. | foldMap | S | feat-refactor |
| U4 | src/design-system/components/currency-field/currency-field.component.tsx:155-156,169 | Three separate `selected === undefined ?` branches. | One `fold(maybe(selected), …)` producing `{value, tone, mark}`. | S | |
| U5 | src/design-system/components/button/button.component.tsx:78 | `size === 'small' ? SMALL_HIT_SLOP : undefined`, while line 62 already `match`es on `size`. | Fold hitSlop into the same size match, or a `Record<ButtonSize,…>`. | S | |
| U5 | src/design-system/components/money-text/money-text.component.tsx:44-52 | Closed `context` union handled by an if-chain. | `match(context).exhaustive()` | S | |
| U6 | src/design-system/components/selectable-row/selectable-row.component.tsx:57 | Conditional prop spread `{...(selected ? {tone} : {color})}`. | `tone="onAccent" color={selected ? undefined : iconColor}`, the pattern the skill documents for the trend-filter row. | S | |
| U6 | src/design-system/components/text-field/text-field.component.tsx:131 | Recomputes `leadingIcon !== undefined && leadingIcon !== ''`; `hasLeadingIcon` already exists (83). | Use `hasLeadingIcon`. | S | |
| U6 | src/design-system/components/screen/screen.component.tsx:119,152,172 | `footer ? … : null` truthiness, but lines 61 and 115 use `footer !== undefined`. | One idiom. | S | |
| U7 | src/design-system/components/card-context-menu/card-context-menu.component.tsx:87-107 | Inline props type; every sibling component has a `.props.d.ts`. | Add card-context-menu.props.d.ts. | S | |
| U7 | src/design-system/components/edit-header-button/edit-header-button.component.tsx:17 | Inline `FC<{ onPress }>` | Add a .props.d.ts. | S | |
| U7 | src/design-system/components/keyboard-done-accessory/use-keyboard-done-accessory.tsx:1 | Hook file is `use-x.tsx` here but `x.resample.hook.ts` in glass-surface. The hook also builds component JSX inline. | Pick one hook naming. Consider a `KeyboardDoneAccessory` component returned by the hook. | S | |
| U8 | src/design-system/theme.ts (+ palette, entity-tint, unistyles + their tests, disabled-field-style.ts, disabled-opacity.ts) | 11 loose files at the design-system root; `grid-interaction/` is already in its own folder. | Folder per unit (theme/, palette/, entity-tint/, …). | M | |
| U8 | src/design-system/theme.test.ts:129-156 | Tests palette.ts contents; palette.test.ts exists. | Move to palette.test.ts. | S | |
| U8 | src/calendar/kiko-calendar/kiko-calendar.day-cell-color.test.tsx:52-72 | Tests kiko-calendar.theme.ts; no `kiko-calendar.theme.test.ts` exists. | Split into kiko-calendar.theme.test.ts. | S | |
| U9 | src/calendar/calendar-header/calendar-header.component.tsx:45-85 | Raw Pressable + SymbolIcon icon-only controls. | Icon-only `Button` (`ghost`, `small`, `fullWidth={false}`, `accessibilityLabel`), as the categories reorder buttons do. | S | |
| U9 | src/design-system/components/icon-editor/icon-editor.component.tsx:54-58 | Hand-rolled caption `Text`. | `FieldLabel` | S | |
| U10-validate | src/design-system/components/currency-field/currency-field.component.tsx:160-170 | FieldTrigger has `error` (F4, 5392779); CurrencyField does not pass it through. A currency picker cannot show the inline error under the field. | Add an `error` prop, forward it. | S | feat-refactor |
| M-liquid-glass-bloom-and-ceiling | src/design-system/components/glass-surface/glass-surface.props.d.ts:45-46,61-62,101-103 | Docs still tell callers to use `transparent` for "the settings and category cards" and `tint` for entity cards. That is content-layer glass, which the nav-layer-only decision forbids. | Rewrite as nav-layer only (see G1). | S | |
| M-button-hierarchy-user-spec | src/design-system/components/icon-picker-modal/icon-picker-modal.component.tsx:106-116 | Cancel is a `secondary` pill here but a red `ghost` in confirm-sheet.component.tsx:60 and card-context-menu.component.tsx:225. | One Cancel treatment in every sheet. | S | USER-DECISION: which Cancel style |
| G1 | src/design-system/components/glass-surface/glass-surface.props.d.ts:14,36,79 | `tint` and `translucentStrong` have 0 consumers. `padding` is only passed as `0`, a no-op. The default `radius='md'` is never used. | Delete them. | M | |
| G1 | src/design-system/components/glass-surface/glass-surface.component.tsx:16-66,240-311 | Precedence branches (`resolveBackdropFill`/`resolveWashFill`/`isActiveVariant`) exist only for the dead variants. | Collapse to material/transparent/bloom. | M | |
| G1 | src/design-system/components/glass-surface/glass-surface.styles.ts:18-20,41-58 | `opaqueBase` backdrop, `strongTranslucentBase` and `strongWash` are used only by the dead variants. | Delete. | S | |
| G1 | src/design-system/theme.ts:95,117,136 | `surfaceTranslucentStrong` and `surfaceWashStrong` only feed dead variants. `sheetBackground` has no reader at all. | Delete the tokens. | S | |
| G1 | src/design-system/components/glass-surface/glass-surface.component.test.tsx:89-101,138,243-283,352-368,437-458,501-540,743-783 | About 14 tests cover the dead tint/translucentStrong variants. | Delete with them. | S | |
| G1 | src/design-system/theme.test.ts:29-79 | Tests the dead tokens. | Delete. | S | |
| G1 | src/design-system/components/glass-surface/glass-surface.resample.hook.ts:37-104 (+ glass-surface.resample.ts) | The re-sample loop was built for Sortable.Grid content cards. Its only consumer now is BottomSheet's static Modal fill, and it runs a measure loop on every sheet mount. | Remove if a device check shows the sheet does not need it. | M | USER-DECISION: device check first |
| G1 | src/design-system/components/button/button.props.d.ts:55-58 | `trailingIcon`: 0 consumers (component lines 87-89). | Delete. | S | |
| G1 | src/design-system/components/bottom-sheet/bottom-sheet.props.d.ts:45-57 | `animationType` and `maxHeight`: 0 consumers. `callerMaxHeight` in bottom-sheet.keyboard.ts:59-67 and tests 302-336 exist only for them. | Delete. | S | |
| G1 | src/design-system/components/box/box.props.d.ts:4,10 | `background`: 0 consumers. | Delete. | S | |
| G1 | src/design-system/components/entity-icon-tile/entity-icon-tile.props.d.ts:10-12 | `size`: 0 consumers. | Delete. | S | |
| G1 | src/design-system/components/symbol/symbol.props.d.ts:11-17 | `fallbackName`: 0 callers; the central map covers it. | Drop the prop, keep the internal map. | S | |
| G1 | src/design-system/components/text-field/text-field.props.d.ts:8-11 | `returnKeyType`: 0 consumers, so the branch at text-field.component.tsx:32-34 is dead. | Drop it from the Pick. | S | |
| G1 | src/design-system/components/currency-field/currency-field.props.d.ts:23-24 | `required`: 0 consumers. | Delete, or wire it with `error` (U10 row). | S | feat-refactor |
| G1 | src/design-system/components/card/card.props.d.ts:7 | `radius: 'full'` never used (only `lg` and the default). | Narrow the union. | S | |
| G1 | src/design-system/components/edit-header-button/edit-header-button.component.tsx:27 | `accessibilityLabel` equals the visible label (button.props says only pass it to disambiguate). | Delete. | S | |
| G1 | src/calendar/calendar-header/calendar-header.styles.ts:35-37 | `flexDirection: 'row'` duplicates `direction="row"` at component line 89. | Delete. | S | |
| G2 | src/design-system/disabled-field-style.ts:5 | `type AppTheme = UnistylesThemes[keyof UnistylesThemes]` is copied in 4 files: here, entity-icon-tile.styles.ts:10, kiko-calendar.theme.ts:5, src/screens/settings/settings-row/settings-row.chevron.ts:5. | Export it once from unistyles.ts. | S | |
| G2 | src/design-system/components/button/button.styles.ts:11,16 | The 44pt touch floor is redefined 6× (here; option-pills.styles.ts:35; selectable-row.styles.ts:8; segmented-control.styles.ts:21; bottom-sheet.styles.ts:70; keyboard-done-accessory.styles.ts:13). The 34pt small height and `{top:5,bottom:5}` hitSlop are copied in button.component.tsx:16 and option-pills.component.tsx:22 / .styles.ts:52. | One token module, like disabled-opacity.ts. | S | |
| G2 | src/design-system/components/text-field/text-field.component.tsx:47 | Four idioms for a derived testID: `deriveTestID` here; the twin `deriveErrorTestID` in field-trigger.component.tsx:17; ternaries in segmented-control and selectable-row; `testID && …` in bottom-sheet.component.tsx:307,324,363,371 and glass-surface.component.tsx:244,295,298,311. | One exported `deriveTestID(testID, suffix)`. | S | |
| G2 | src/design-system/components/bottom-sheet/bottom-sheet.component.tsx:153 | Duplicates the cap math in bottom-sheet.keyboard.ts:63-67. | `resolveKeyboardAwareMaxHeight(windowHeight, 0, …)` | S | |
| G2 | src/design-system/components/card-context-menu/card-context-menu.component.tsx:208-228 | The action sheet re-copies ConfirmSheet's layout (heading header + buttons + red ghost Cancel) from confirm-sheet.component.tsx:39-63. | Extract a shared action-sheet, or extend ConfirmSheet. | S | |
| G2 | src/design-system/components/option-pills/option-pills.component.tsx:29-101 | Near-duplicate of src/screens/forms/chip-row/chip-row.component.tsx: both are selectable pill rows with an accent fill, `onAccent` label and inline selected background. OptionPills even has a compact size. ChipRow stays outside the design system. | Merge into one design-system chips component. Visual change. | M | USER-DECISION: final chip look |
| G2 | src/design-system/components/symbol/symbol.props.d.ts:7 | `SymbolTone` is a copy of `TextTone` (text.props.d.ts:16, not exported). | Export TextTone and reuse it. | S | |
| G2 | src/design-system/entity-tint.ts:90-95,104-109 | Byte-to-hex formatting duplicates symbol.color.ts:19 `byteToHex`, in a different style. | One helper in entity-tint. | S | |
| G2 | src/design-system/components/currency-field/currency-field.component.tsx:103,117-120 | Divergent twin. settings, account-form and holding-form wire `onOpenChange` → `automaticallyAdjustKeyboardInsets`. src/screens/column-mapping/currency-fields/currency-fields.component.tsx:60 does not, and column-mapping.screen.tsx:1139 is a `Screen scroll`. The background-scroll misfire bug is still open there. | Wire it there. Better: move the gating into Screen or a context so no host can forget it. Behavior fix. | S | |
| G2 | src/design-system/components/screen/screen.component.tsx:119-123,152-156,172-176 | The footer node is written 3×. | One `footerNode` const. | S | |
| G3 | src/design-system/components/symbol/symbol.component.tsx:13 | Folder is `symbol/`, props are `SymbolProps`, but the component is `SymbolIcon`. | Rename to `symbol-icon/` / `SymbolIconProps`. | S | |
| G4 | src/design-system/components/bottom-sheet/bottom-sheet.component.tsx:131-383 | Mixes keyboard tracking (224-266), the drag gesture (282-294), the scrim (337-347, a second copy of GlassSurface's glass/fallback branch) and the body. | Extract a `useKeyboardHeight` hook and a `SheetScrim` component. | M | |
| G4 | src/design-system/components/card-context-menu/card-context-menu.component.tsx:107-241 | Gesture, lift animation, action sheet and confirm sheet in one component. | Extract the action sheet (see G2). | S | |
| G5 | src/design-system/components/currency-field/currency-field.component.tsx:23-79 | Currency search, localized sort and UAH-pin domain logic inside a design-system component. | Move to src/currency/ as a pure module with its own test. | S | |
| G5 | src/design-system/components/icon-picker-modal/icon-pools.ts:23,55 | Domain icon pools live in a design-system folder; 4 screens deep-import them. | Move to the category and entity-symbol domain modules. | S | |
| G5 | src/design-system/components/icon-picker-modal/icon-picker-modal.component.tsx:64,66,77,109 | Shared component uses feature i18n keys `categories.*` and `forms.holding.remove`, but serves the account, holding and category flows. | `common.*` keys. | S | |
| G5 | src/design-system/components/bottom-sheet/bottom-sheet.component.tsx:16 | Imports `KEYBOARD_ACCESSORY_HEIGHT` from another component's `.styles.ts`, bypassing its barrel. | Export it through keyboard-done-accessory/index.ts. | S | |
| G7 | src/design-system/components/field-label/field-label.component.test.tsx:11-20 | Inline Text tone mock; src/test-support/mock-text-tone.tsx already exists. | Use the shared mock. | S | |
| G7 | src/design-system/components/keyboard-done-accessory/use-keyboard-done-accessory.test.tsx:23-44 | Inline Text mock + a mutable liquid-glass mock (a 3rd copy). | Shared test-support mocks. | S | |
| G7 | src/design-system/components/money-text/money-text.component.test.tsx:16-40 | Inline Text mock. | Extend the shared mock. | S | |
| G7 | src/design-system/components/option-pills/option-pills.label-variant.test.tsx:18-26 | A second test file that exists only to hold a variant Text mock. | Shared variant mock; merge into option-pills.component.test.tsx. | S | |
| G7 | src/design-system/components/field-trigger/field-trigger.leading-text-mark-variant.test.tsx:19-26 | Same pattern. | Same fix. | S | feat-refactor |
| G7 | src/design-system/components/bottom-sheet/bottom-sheet.component.test.tsx:21-28,37,46-53,113-121 | Liquid-glass and safe-area mocks copied from other files; `MAX_HEIGHT_RATIO` re-declared; 113-121 repeats 60-68. | Shared mocks; export the ratio; delete the dupe. | S | |
| G7 | src/design-system/components/glass-surface/glass-surface.component.test.tsx:44-60 | Mutable liquid-glass mock (copy 1 of 3). | Shared factory. | S | |
| G7 | src/design-system/components/screen/screen.component.test.tsx:47 | Safe-area mock copied from bottom-sheet.component.test.tsx:46. | Shared factory. | S | |
| G7 | src/calendar/kiko-calendar/kiko-calendar.day-cell-color.test.tsx:22-28 | Hand-copies buildCalendarTheme's mapping while the comment claims it does not. | `buildCalendarTheme(darkTheme)` | S | |
| G7 | src/calendar/calendar-header/calendar-header.component.test.tsx:12-23,82-89 | Three tests assert the same "March 2026" render. | Keep one. | S | |
| G7 | src/design-system/theme.test.ts:4-26 | Pins every literal token value (mirrors the source). | Keep invariants only (contrast, `onAccent` value). | S | |
| G7 | src/design-system/components/field-error/field-error.component.test.tsx:6-10,20-24 | Test name claims a tone the test never asserts; 20-24 is tautological. | Assert the tone via the shared mock; delete 20-24. | S | |

U1: no violations. `BreakdownCell` is a local, non-exported helper, which the user rule allows (see Section C, item 7). S-GEST, S-COMPL, S-ARCH, G6: clean. Every function called from a worklet has its `'worklet'` directive. `useAnimatedKeyboard` is not used anywhere. No hidden-feature flags.


### R6 — Holdings, accounts, categories, bonds and statistics domain

| Rule | file:line | What is wrong | Fix (the existing pattern or rule to apply, name a file that already does it right when one exists) | Effort | Tags |
|---|---|---|---|---|---|
| G2 | src/statistics/category-trend/category-trend.ts:84-86,145,331-353 | **BUG (divergent twin).** The trend's `groupKey` folds only a null or empty category. An unknown slug keeps its own key. The pie's twin (`category-breakdown.ts:94-98`, via `resolveCategoryKey`) was already fixed for exactly this. `buildCategoryMeasures` takes no `categoryDisplay`, so it cannot fold at all. Example: a transaction with category `'foo'` that is not in the categories table, default key `other`. The pie merges it into Other. The trend draws two lines, both titled "Other". Top-N can rank `'foo'`. Excluding Other still leaves the `'foo'` line. | Fold with `resolveCategoryKey(category, categoryDisplay, defaultKey)` inside `accumulateSpend`. Pass `categoryDisplay` into `buildCategoryMeasures` (caller: `statistics.screen.tsx:749`). This changes behavior (it is the fix). | S | |
| G2 | src/accounts/accounts.repo.ts:283-306 | **BUG (divergent twin).** `remove` does not delete each holding's `holding:<id>` price series. Its twin `holdings.repo.ts:475` does (kiko-pricing: "a deleted holding never leaves an orphaned series"). Example: deleting a Property account that holds a property_item, or a Debt account that holds a `'none'` loan, leaves its `price_points` rows orphaned. They also ship in every `.kiko` export. | Delete by `inArray(pricePoints.instrument, ids.map(holdingInstrument))` in the same `tx`, or extract one shared `removeHoldingsTx` that both repos call. | S | |
| S-DOMAIN | src/statistics/reconcile-bond-funding/reconcile-bond-funding.ts:87-100 | **BUG.** Candidate funding debits have no day window. The comment at L16-17 assumes "on (or near) the same day". Example: a manual bond bought 2026-03-01 for 10,000 UAH, with no recorded debit, and a 10,300 UAH rent debit on 2025-06-15 as the only debit within 5%. The net-worth series turns the bond on 8.5 months early, at 10,300. Matched debits are also never consumed, so two bonds can claim the same debit. | Add a maximum day distance before the amount test, and consume matched debits. This changes behavior. | S | USER-DECISION (window size) |
| S-DOMAIN | src/statistics/loan-payments/loan-payments.ts:98-118 | **Latent BUG.** The interest is in the loan's currency (schedule minor units), but it is capped against, and stamped with, the payment's currency. Example: USD loan, installment interest 30,000¢, paid from a UAH card −1,200,000 kopecks. The entry becomes −30,000 kopecks (300 ₴), not about $300. It is latent because nothing calls `setLoanPayment`/`setAutoLoanLinks` yet; only a restore can create links. | Add `currency` to `LoanHolding`. Skip (or convert) a payment whose currency differs from the loan's. The research spec already requires the same currency. | S | |
| U7 | src/holdings/priced-value/priced-value.ts:94-100 | **Latent BUG.** There are three different behaviors for a holding with no id. Metal needs no id (it uses the shared `metal:` instrument), but the id guard runs first, so it falls back to cost basis. Loan uses `holding.id ?? ''` (`holding-value.ts:206`), so an id-less `'none'` loan reads 0 debt. `BreakdownHolding`/`ContributionHolding` (`type-breakdown.ts:11`, `account-contribution.ts:19`) leave out `id`, so the type never forces it. | Move the id check into the property branch. Make `id` required on the value read types (every caller already passes full rows). | S | |
| S-PRICING | src/holdings/priced-value/priced-value.ts:53-77 | `pricedMetalValueMinor` returns UAH minor units as a bare number. `pricedBreakdown` (`holding-value.ts:238-248`) then wraps it in `holding.currency`. Only the form (`holding-form.screen.tsx:1301`) keeps metal in UAH. A restored non-UAH metal would mix a UAH value with a foreign-currency cost basis. | Return `Money` from `pricedValueMinor` (`Money.of('UAH', …)` for metal) and guard the currency in `pricedBreakdown`. | M | |
| G2 | src/holdings/holding-value/holding-value.ts:106-112,259-265 | Twins of `derived-entries.ts:108-114,202-211`: the `depositLedger` call with the same contributions mapping, and the nominal → gross coupon → corporate-tax net coupon computation. | Extract `bondNetCouponMinor(meta, currency)` and `ledgerFor(meta, now)` into `interest.ts` and call them from both files. | S | |
| G2 | src/holdings/repo/holdings.repo.ts:252-260,354-362 | The manual-adjustment ledger insert literal appears three times (the third is `accounts.repo.ts:180-188`). | Add a shared `insertManualAdjustmentTx(tx, holdingId, amount, time)`. | S | |
| G2 | src/holdings/lots/lots.ts:30-44 | `isRecord` duplicates `holding-metadata.ts:66-67`. `asLot` uses `typeof === 'number'`, so it accepts NaN/Infinity for `day` and `costMinorUnits`. The sibling `isNumber` in holding-metadata rejects them. | Export one `isRecord`/`isNumber` and use `isNumber` in `asLot`. | S | |
| G2 | src/bonds/nbu-register/nbu-register.ts:43-44 | Re-implements `isCurrency` from `currency/currency/currency.ts:378`. | Import it. | S | |
| G2 | src/holdings/interest/interest.ts:4 | A local `DAY_MS` duplicates `dates/duration.ts:5` (`buckets.ts` already imports that one). | Import `DAY_MS`. | S | |
| G2 | src/holdings/exchange-prefill/exchange-prefill.ts:23 | Builds the `${a}:${b}` rate key by hand and re-implements `canConvert` (`rates/net-worth-view.ts:47`). The pre-check guards a throwing `convert` (U4). | Use `canConvert`, or `eitherSync(() => convert(...))` folded to `null`. | S | |
| G2 | src/statistics/transfer-exclusion/transfer-exclusion.ts:97-128 | The "collect ids where predicate" loop is copied four times (also `exchange-exclusion.ts:16-28` and `loan-payments.ts:38-52`). | Add one `idsWhere(rows, predicate)` helper. | S | |
| G2 | src/holdings/holding-metadata/holding-metadata.ts:104-139 | `walletAddressOf`, `ibanOf` and `syncedAtOf` are three copies of one field reader. They also mix `undefined` and `null` returns (U6). | Use one `fieldOf(metadata, key, guard)` and one return convention. | S | |
| G2 | src/categories/repo/categories.repo.ts:97-105 | The sortOrder-rewrite loop is identical in `accounts.repo.ts:257-265` and `holdings.repo.ts:554-562`. | Add a shared `rewriteSortOrderTx(tx, table, keyColumn, ids)`. | S | |
| G1 | src/holdings/repo/holdings.repo.ts:275-276,429-430,497-500 | `updateName`, `setColor` and `upsertMonobank` have no production caller (only tests call them). | Delete them and their tests. Tests of the upsert path should go through `upsertMonobankMany`. | S | |
| G1 | src/accounts/accounts.repo.ts:244-247 | `archive` has no caller, so `archivedAt` is never written by the app. | Either delete it or build the archive UI. | S | USER-DECISION |
| G1 | src/holdings/interest/interest.ts:13-24,93 | `periodsPerYear` is used only by tests. The `daysInMonth` doc talks about an `instant` parameter that does not exist. | Delete `periodsPerYear` and fix the doc. | S | |
| G1 | src/holdings/tax/tax.ts:9-11 | `INTEREST_TAX_RATE_PCT` has no reader. | Delete it. | S | |
| G1 | src/holdings/entity-symbols/entity-symbols.ts:5,59-80 | `genericEntitySymbol.holding`/`.transaction` and `genericEntitySymbolFallback` are unused "scaffolding". The doc path `entity-colors.ts` is stale. | Keep only `account` and fix the path. | S | |
| G1 | src/statistics/category-breakdown/category-breakdown.ts:61,94-98 | `const chartSeries = chartSeriesDark` is a pointless alias. `groupKey` just passes through to `resolveCategoryKey`. | Inline both. | S | |
| G1 | src/statistics/account-contribution/account-contribution.ts:77 | `accountDefaults = defaultAccountColor` is a pointless alias. | Inline it. | S | |
| G1 | src/statistics/holding-value-at.ts:21-25 | Stale doc: the ledgerless list leaves out `metal` and `loan`. | Point to `isLedgerlessHoldingType` instead of listing types. | S | |
| G1 | src/holdings/lots/lots.ts:5-7 | Stale doc: says lots belong to bond, term deposit and property. Lots are used only by property_item and metal. | Fix the doc. | S | |
| G1 | src/holdings/holding-value/holding-value.ts:46-48 | Says "all three deposit branches"; only two use `makeBreakdown`. | Fix the doc. | S | |
| G1 | src/bonds/isin/isin.ts:45-49 | "A future caller that wires this up to a form…" is stale; the ISIN form exists. | Delete the comment, or export the named result type. | S | |
| G1 | src/holdings/priced-value/priced-value.ts:15-16,49 | "T26/T35 extend this set" is wrong (T26 is loans, which are not priced). "T20 is expected" is stale. | Fix the doc. | S | |
| G1 | src/holdings/holding-metadata/holding-metadata.ts:277-279 | "a future metal-section form (T20)" is stale; the form exists. | Fix the doc. | S | |
| G1 | src/holdings/exchange-destination/exchange-destination.ts:6,19-20 | Pins `schema.ts:25`. "(bond/jar have no…)" leaves out property_item, metal and loan. | Drop the line pin and fix the list. | S | |
| G1 | src/categories/repo/categories.repo.ts:56 | Doc path `statistics/category-breakdown.ts` is stale (it is now a folder). | Fix the path. | S | |
| G1 | src/holdings/holding-type/holding-type.ts:61-62,109-110 | "term_deposit and bond … derives entirely from lots" is wrong. "currently only PrivatBank" is stale (4 catalog banks have `sellsMetals: true`). | Fix the doc and point to the catalog instead of naming banks. | S | |
| G3 | src/holdings/deletable/deletable.ts:1-55 | The folder is called `deletable` but exports `isSyncedTransaction`, `isSyncedAccount` and `isSyncedHolding`. | Rename to `sync-ownership/` (it is imported everywhere, so do it as a move-only batch). | M | |
| G3 | src/accounts/accounts.repo.ts:31-58 | `nextSortOrder` also writes (it shifts every debt account's sortOrder). The name hides the mutation. | Split into a read (`nextSortOrder`) and `makeRoomBeforeDebtsTx`, or rename. | S | |
| U3 | src/holdings/loan-schedule/loan-schedule.ts:136-138,142-149 | `correction === undefined ? 0 : f(correction)`, `x !== undefined && … ? x : undefined`, and two `=== undefined ? default : f(x)`. | `fnts/maybe`: `fold`/`foldMap(maybe(correction), …)`. No area file uses `maybe` yet. | S | |
| U3 | src/categories/category-display/category-display.ts:71 | `key ? byKey.get(key) : undefined` | `foldMap(maybe(key), (k) => byKey.get(k))` | S | |
| U3 | src/statistics/category-breakdown/category-breakdown.ts:127-128 | `changeGroupId != null ? (get ?? 0) : 0` | `fold(maybe(changeGroupId), …, 0)` | S | |
| U3 | src/holdings/repo/holdings.repo.ts:340-343 | `a !== undefined && b !== undefined ? a - b : 0` | Combine with `maybe`, or use an early return. | S | |
| U5 | src/holdings/holding-value/holding-value.ts:175-178,265,279-292 | An `isPriced` guard, then a `switch` with `default` (a new type silently gets `flat`). Also a metal/else ternary in `pricedLotsOf`, and `bondKind === 'corporate' ?` (the same at `derived-entries.ts:211`). | `match(holding.type)….exhaustive()` or `Record<HoldingType, fn>`, like `exchange-destination.ts:12-17`. | S | |
| U5 | src/holdings/derived-entries/derived-entries.ts:282-293 | `entriesForType` is an if-chain over `holding.type` ending in `return []`. | `Record<HoldingType, entriesFn>` or exhaustive `match`. | S | |
| U5 | src/holdings/priced-value/priced-value.ts:98 | Metal-vs-else branch; property is the implicit else. | `match` over `pricedHoldingTypes`. | S | |
| U5 | src/holdings/holding-type/holding-type.ts:56-57,67-72 | `isTimeExemptHoldingType` and `isLedgerlessHoldingType` are `===` chains. Siblings in the same file use a const tuple plus `includes`. | Tuple plus `includes`, like `syncOnlyHoldingTypes` (L46-49). | S | |
| U5 | src/holdings/interest/interest.ts:13-36,368-379 | `switch` over closed frequency unions (the skill bans `switch`). | `Record<Frequency, number>` lookups. | S | |
| U5 | src/statistics/trend-filter/trend-filter.ts:32-41,79 | `measureValue` is an if-chain over `TrendMeasure`; `resolveTrendFilter` branches on `mode`. | `Record<TrendMeasure, keyof CategoryMeasure>` and `match(stored)`. | S | |
| U5 | src/holdings/repo/holdings.repo.ts:377-395 | `updateLoan` branches on `LoanPricePointOp.kind` with `if` plus a ternary. | `match(op).with({kind:'none'}…).exhaustive()` | S | |
| U5 | src/holdings/loan-schedule/loan-schedule.ts:47,67-68,135 | `schedule === 'none'`/`'annuity'` checks; `differentiated` is the implicit else. | `match(schedule)` | S | |
| U6 | src/holdings/derived-entries/derived-entries.ts:54-71,80,104 | `makeEntry` takes 7 positional parameters, three of them adjacent numbers, so they are easy to swap. `NonNullable<ReturnType<typeof asTermDepositMeta>>` is used instead of `TermDepositMeta`. `contributionEntries` parses metadata a second time. | Take an object parameter, import the type, and pass `meta` in. | S | |
| U6 | src/statistics/category-trend/category-trend.ts:204 | Restates the `CategoryDisplay` shape inline. | Import `CategoryDisplay`. | S | |
| U6 | src/accounts/accounts.repo.ts:1-11 | Mixes the `@kiko/*` alias and `../` relative imports for cross-feature paths in one file. | Pick one style (memory says `@kiko/*` for cross-feature imports). | S | USER-DECISION |
| U6 | src/holdings/repo/holdings.repo.ts:1-14 | Same alias/relative mix. | Same. | S | USER-DECISION |
| U6 | src/statistics/net-worth-series/net-worth-series.ts:1-13 | Same alias/relative mix. | Same. | S | USER-DECISION |
| U6 | src/holdings/repo/holdings.repo.test.ts:20-25 | Same alias/relative mix. | Same. | S | USER-DECISION |
| U6 | src/accounts/accounts.repo.test.ts:14-15 | Same alias/relative mix. | Same. | S | USER-DECISION |
| U7 | src/holdings/holding-value/holding-value.ts:65-250 | Per-type logic is organized differently for each holding type. Value lives in two files (metal's priced branch is extracted, property's is inline). Parse, value, entries and no-id handling are spread over five modules with different shapes. Adding a type touches roughly 8 sites, and nothing enforces it. | Give each type one descriptor, `Record<HoldingType, { parse, breakdown, entries, ledgerless, priced }>`, or at least the same four-function shape per type. | L | USER-DECISION |
| U7 | src/holdings/holding-metadata/holding-metadata.ts:225-231 | `asBondMeta` silently defaults `bondKind`, `couponFrequency` and `purchasePrice`. The deposit, metal and loan parsers reject bad input instead. | Make the parsers consistent (or document why the legacy defaults stay). | S | USER-DECISION |
| U7 | src/holdings/derived-entries/derived-entries.ts:250-280 | Metal lots become ledger rows; property_item's cost lot and loans get none. | Decide which types surface entries. | S | USER-DECISION |
| U7 | src/bonds/bond-register-repo/bond-register.repo.ts:40-94 | The refresh scheduler lives inside the repo file. Its sibling is its own folder, `src/prices/metal-refresh/`. | Move it to `src/bonds/bond-register-refresh/`. | M | |
| U7 | src/categories/repo/categories.repo.ts:30-40 | `create` returns void; the accounts and holdings `create` return the id. Repo folders use three naming schemes (`repo/`, `category-overrides-repo/`, `bond-register-repo/`, plus flat accounts). | Return the key, and use one folder scheme. | S | |
| U8 | src/accounts/accounts.repo.ts | The repo and its test sit loose in the feature root, imported as `@kiko/accounts/accounts.repo`. Siblings use `repo/` plus an `index.ts`. | Move to `src/accounts/repo/`, like `src/holdings/repo/`. | S | |
| U8 | src/statistics/holding-value-at.ts | Loose file with no test of its own (tested indirectly from `holdings.repo.test.ts:24` and net-worth-series). | Move to `holding-value-at/` with a test. | S | |
| U8 | src/statistics/chart-balance-consistency.test.ts | Loose, and it tests `transactionsRepo`, not statistics. | Move next to `src/transactions/repo/`. | S | |
| G7 | src/holdings/repo/holdings.repo.test.ts:31-42,84-113,838-917 | The hand-rolled fake tx maps any unknown table to `'transactions'` and ignores `where` (a delete clears the whole table); this is the fake-db-masks-bugs pattern. The file also tests `accountsRepo.disconnect` and `holdingValueAt`. | Use a shared fake tx that throws on an unknown table or column, and split out the other units. | M | |
| G7 | src/accounts/accounts.repo.test.ts:30-70,372-416 | The `tableNameOf`/`makeCreateTx` copies have the same unknown→`'transactions'` default. `makeRemoveTx` never checks the tables touched, which is how row 2 was missed. The comment at L415-416 ("monobankId is stripped") is stale. | Use the shared fake and assert the cleanup tables match `holdingsRepo.remove`. | M | |
| G7 | src/categories/repo/categories.repo.test.ts:9 | The `jest.mock('db/client', write → work(mockTx))` block is copy-pasted six times (also holdings.repo.test:12, accounts.repo.test:6, category-overrides.repo.test:7, bond-register.repo.test:6, chart-balance-consistency.test:10). | Move it into one helper in `src/test-support/`. | S | |
| G7 | src/statistics/net-worth-series/net-worth-series.test.ts:1-10 | The comment says "Stub the native module", but there is no stub. The fixture is built through `monobank/sync`'s `mapStatementItem`, which pulls another module into the test. | Fix the comment and use plain fixtures. | S | |
| G7 | src/statistics/chart-balance-consistency.test.ts:21-52 | Copies the fake from `transactions.repo.test.ts`'s `makeExchangeTx` ("same shape as"). | Use the shared fake. | S | |
| G7 | src/statistics/category-trend/category-trend.test.ts:147 | Tests the null/empty fold only; there is no unknown-slug test, so row 1 was missed. | Add a parity test against `buildCategoryBreakdown`. | S | |
| S-STYLE | src/accounts/accounts.repo.ts:1-11,123,287,290,297 | Imports: L2 is shorter than L1; `@kiko/holdings/repo` sits in its own group (L4) instead of group 1; L7, L8, L10, L11 are out of length order. Missing blank line before return/if/for at 123, 287, 290, 297. | kiko-code-style import order and blank lines. | S | |
| S-STYLE | src/bonds/bond-register-repo/bond-register.repo.ts:1-2 | Import L2 is shorter than L1. | Sort by length. | S | |
| S-STYLE | src/bonds/nbu-register/nbu-register.ts:13 | Hardcoded public URL; the skill says "externalize to .env". Every NBU client does the same. | `.env` via `@env`, or change the skill. | S | USER-DECISION |
| S-STYLE | src/categories/category-overrides-repo/category-overrides.repo.ts:1-2 | Imports out of length order. | Sort. | S | |
| S-STYLE | src/categories/repo/categories.repo.ts:1-7,73 | Imports: L2<L1, L5<L4, L7<L6. Missing blank line at 73. | Sort, add the blank line. | S | |
| S-STYLE | src/holdings/derived-entries/derived-entries.ts:4-9,81,84,121,125,133,141,150,159,163,165,178,191,193,198,263,286,289,292 | Imports L6-8 unsorted; missing blank lines at the lines listed. | Sort, add blank lines. | S | |
| S-STYLE | src/holdings/entity-colors/entity-colors.ts:2-3 | Imports out of order. | Sort. | S | |
| S-STYLE | src/holdings/exchange-convert/exchange-convert.ts:1-2 | Imports out of order. | Sort. | S | |
| S-STYLE | src/holdings/holding-metadata/holding-metadata.ts:3,15-30,49,59,146,155,157,163,178,204 | `CompoundingFrequency`, `BondKind` and `BondCouponFrequency` are hand unions with separate arrays and parallel Sets (the skill wants one const tuple per closed set). Missing blank lines at the lines listed. | Const tuple like `loanKinds` (L349-354); add blank lines. | S | |
| S-STYLE | src/holdings/holding-type/holding-type.ts:121,124 | Missing blank lines. | Add them. | S | |
| S-STYLE | src/holdings/holding-value/holding-value.ts:1-17,43,56,67,75,96,113,123,140,145,160,198,235,271 | Imports L5<L4, L8-9 out of order; missing blank lines at the lines listed. | Sort, add blank lines. | S | |
| S-STYLE | src/holdings/interest/interest.ts:1-2,154,183,193,383 | Imports out of order. Abbreviated names `d` and `prev`. Missing blank lines at 71, 107, 126, 129, 134, 138, 144, 155, 175, 181, 188, 191, 194, 196, 202, 205, 283, 299, 303, 327, 355, 360, 384, 401, 404. | Sort, use full names, add blank lines. | S | |
| S-STYLE | src/holdings/lots/lots.ts:1-2 | Imports out of order. | Sort. | S | |
| S-STYLE | src/holdings/priced-value/priced-value.ts:5-6 | Import L6 is shorter than L5. | Sort. | S | |
| S-STYLE | src/holdings/loan-schedule/loan-schedule.ts:153 | Missing blank line. | Add it. | S | |
| S-STYLE | src/holdings/repo/holdings.repo.ts:451 | Missing blank line. | Add it. | S | |
| S-STYLE | src/holdings/tax/tax.ts:45,48 | `cumFrom` is abbreviated; missing blank line at 48. | Use a full name, add the blank line. | S | |
| S-STYLE | src/statistics/buckets/buckets.ts:20 | Missing blank line. | Add it. | S | |
| S-STYLE | src/statistics/category-breakdown/category-breakdown.ts:6-11,63,181,184,189 | Imports L7, L9, L11 out of order; missing blank lines at 63, 181, 184, 189. | Sort, add blank lines. | S | |
| S-STYLE | src/statistics/category-trend/category-trend.ts:1-7,138,141,146,299,307 | Imports L2-7 out of order; missing blank lines at 138, 141, 146, 299, 307. | Sort, add blank lines. | S | |
| S-STYLE | src/statistics/holding-value-at.ts:1-4,38 | Imports L2<L1, L4<L3; parameter `t` is abbreviated. | Sort, rename to `instant`. | S | |
| S-STYLE | src/statistics/internal-transfers/internal-transfers.ts:65,68 | Missing blank lines. | Add them. | S | |
| S-STYLE | src/statistics/loan-payments/loan-payments.ts:1-5,94 | Imports L2<L1, L5<L4; missing blank line at 94. | Sort, add the blank line. | S | |
| S-STYLE | src/statistics/net-worth-series/net-worth-series.ts:3-13,102,129,141 | Group 2 is unsorted; missing blank lines at 102, 129, 141. | Sort, add blank lines. | S | |
| S-STYLE | src/statistics/reconcile-bond-funding/reconcile-bond-funding.ts:1-2 | Equal-length imports with the type import before the value import (tiebreak broken). | Put the value import first. | S | |
| S-STYLE | src/statistics/transfer-exclusion/transfer-exclusion.ts:36,39,101,121 | Missing blank lines. | Add them. | S | |
| S-STYLE | src/statistics/trend-filter/trend-filter.ts:4,7,36,79 | `TrendMode` and `TrendMeasure` are hand unions (should be tuples); missing blank lines at 36 and 79. | Tuple, add blank lines. | S | |
| S-STYLE | src/statistics/type-breakdown/type-breakdown.ts:1-7 | Imports out of order. | Sort. | S | |
| S-STYLE | src/accounts/accounts.repo.test.ts:8,64,71,74,80,331,395,402,407,428,436,516 | Missing blank lines. | Add them. | S | |
| S-STYLE | src/bonds/bond-register-repo/bond-register.repo.test.ts:8,49,54,69,74 | Missing blank lines. | Add them. | S | |
| S-STYLE | src/bonds/nbu-register/nbu-register.test.ts:55 | Missing blank line. | Add it. | S | |
| S-STYLE | src/categories/category-overrides-repo/category-overrides.repo.test.ts:9 | Missing blank line. | Add it. | S | |
| S-STYLE | src/categories/repo/categories.repo.test.ts:1-2,11,55,58,89,132,135,156,159,179,200,234,238,245,345,348,355,358,390 | Imports out of order; missing blank lines at the lines listed. | Sort, add blank lines. | S | |
| S-STYLE | src/holdings/derived-entries/derived-entries.test.ts:93 | Missing blank line. | Add it. | S | |
| S-STYLE | src/holdings/holding-metadata/holding-metadata.test.ts:1-9,244 | Type import before the value import at equal length; missing blank line at 244. | Fix the tiebreak, add the blank line. | S | |
| S-STYLE | src/holdings/holding-value/holding-value.test.ts:264,531 | Missing blank lines. | Add them. | S | |
| S-STYLE | src/holdings/loan-schedule/loan-schedule.test.ts:27,97 | Missing blank lines. | Add them. | S | |
| S-STYLE | src/holdings/repo/holdings.repo.test.ts:14,62,66,97,333,481,488,495,500 | Missing blank lines. | Add them. | S | |
| S-STYLE | src/statistics/account-contribution/account-contribution.test.ts:1-2 | Imports out of order. | Sort. | S | |
| S-STYLE | src/statistics/category-breakdown/category-breakdown.test.ts:4-6 | Imports out of order. | Sort. | S | |
| S-STYLE | src/statistics/category-trend/category-trend.test.ts:60 | Missing blank line. | Add it. | S | |
| S-STYLE | src/statistics/chart-balance-consistency.test.ts:12,39,46,52 | Missing blank lines. | Add them. | S | |
| S-STYLE | src/statistics/net-worth-series/net-worth-series.test.ts:4-13 | Imports out of order (L10, L12, L13). | Sort. | S | |
| S-STYLE | src/statistics/type-breakdown/type-breakdown.test.ts:3-4 | Imports out of order. | Sort. | S | |
| U2 | src/accounts/accounts.repo.ts:17,21,69,82,216,275,280 | History and ids ("same as before…", T27 round 1, "now offers", I1/T29, Review Focus 7). | Keep only the WHY. | S | |
| U2 | src/bonds/bond-register-repo/bond-register.repo.ts:57,66,68 | spec 6.4, T24 review. | Same. | S | |
| U2 | src/bonds/isin/isin.ts:2 | T23. | Same. | S | |
| U2 | src/bonds/nbu-register/nbu-register.ts:8,17,32,47,63,113,116,146 | spec 6.x, P0. | Same. | S | |
| U2 | src/holdings/deletable/deletable.ts:10 | "Guideline 5.6 remediation: PrivatBank, bunq, Starling" (history). | Same. | S | |
| U2 | src/holdings/derived-entries/derived-entries.ts:250 | T18. | Same. | S | |
| U2 | src/holdings/entity-colors/entity-colors.ts:16-20 | T17, T13, T26, "previously unused". | Same. | S | |
| U2 | src/holdings/entity-symbols/entity-symbols.ts:20-27,42-44,65-66 | Migration history, T13/T17/T26, "these changes", "a later task". | Same. | S | |
| U2 | src/holdings/exchange-destination/exchange-destination.ts:41 | "Requirement B, device review 2026-09-06". | Same. | S | |
| U2 | src/holdings/exchange-prefill/exchange-prefill.ts:5 | "Feature 1". | Same. | S | |
| U2 | src/holdings/holding-metadata/holding-metadata.ts:41-45,79-81,235-240,275,287,345 | T25, spec 6.4, 5.6 remediation history, T13/T16/T17/T20/T26. | Same. | S | |
| U2 | src/holdings/holding-type/holding-type.ts:62-66,75-80,101,104 | T13/T17/T26/T35/T18/P5, "which was the bug". | Same. | S | |
| U2 | src/holdings/holding-value/holding-value.ts:103-104,151-152,180,183,199-202,225 | "fix for the old overvaluation", R4 bug, T27, M4, M1, Review Focus 5. | Same. | S | |
| U2 | src/holdings/interest/interest.ts:230,341,346-347 | "the old overvaluation", "no longer collapses", "counted one extra day". | Same. | S | |
| U2 | src/holdings/loan-schedule/loan-schedule.ts:25,96,115,161,172 | spec 5.1, N10a, M4, N10b/D14, M2 (T26/T30). | Same. | S | |
| U2 | src/holdings/lots/lots.ts:13,72 | T10, Review Focus 8. | Same. | S | |
| U2 | src/holdings/priced-value/priced-value.ts:13,15,49,83,87 | T17, T26/T35, T20, Review Focus 4/5. | Same. | S | |
| U2 | src/holdings/repo/holdings.repo.ts:32,66,175-177,366,463,470,504-506 | T16, T28 I1, Review Focus 7/T29, "the loop the sync used before". | Same. | S | |
| U2 | src/statistics/account-contribution/account-contribution.ts:58,85-93,109 | spec §5.2 I2, "this was the last hold-out", T27. | Same. | S | |
| U2 | src/statistics/category-breakdown/category-breakdown.ts:101-102 | "design F2-6", "v1". | Same. | S | |
| U2 | src/statistics/category-trend/category-trend.ts:128-129 | "design F2-7", "v1". | Same. | S | |
| U2 | src/statistics/loan-payments/loan-payments.ts:25,31,34,56,61,64 | spec 5 D14, Review Focus 7, T29, N10b, M2. | Same. | S | |
| U2 | src/statistics/trend-filter/trend-filter.ts:68 | "Decision D5". | Same. | S | |
| U2 | src/statistics/type-breakdown/type-breakdown.ts:31,36 | T27, "re-review round 1, item 6". | Same. | S | |
| U2 | src/accounts/accounts.repo.test.ts:300,369,599 | N1 round-1, I1/T29. | Same. | S | |
| U2 | src/bonds/isin/isin.test.ts:4,7 | T24 plus a date. | Same. | S | |
| U2 | src/bonds/nbu-register/nbu-register.test.ts:1,5 | T24 plus a date. | Same. | S | |
| U2 | src/holdings/deletable/deletable.test.ts:19-20 | Removal history. | Same. | S | |
| U2 | src/holdings/derived-entries/derived-entries.test.ts:123,385 | BUG2, T18. | Same. | S | |
| U2 | src/holdings/holding-type/holding-type.test.ts:179 | T22. | Same. | S | |
| U2 | src/holdings/holding-value/holding-value.test.ts:122,144,184,326,415,473,492,552,564,576,616 | BUG2, "used to… now", D2, Review Focus 5, T17, T27, M8, M4, M1. | Same. | S | |
| U2 | src/holdings/interest/interest.test.ts:294,303,338,344 | BUG2, "used to", D2. | Same. | S | |
| U2 | src/holdings/loan-schedule/loan-schedule.test.ts:174,205,227,236,243,269,295,302,307,314,321 | N10a, I1, M2 and similar ids in titles and comments. | Same. | S | |
| U2 | src/holdings/priced-value/priced-value.test.ts:79 | Review Focus 5 in a test title. | Same. | S | |
| U2 | src/holdings/repo/holdings.repo.test.ts:187,252,730,741,868,929,1064,1120,1146 | D-I2, T16, Review Focus 7/T29, "used to", I1. | Same. | S | |
| U2 | src/statistics/account-contribution/account-contribution.test.ts:181,216,259,362 | T27, I2, T14. | Same. | S | |
| U2 | src/statistics/chart-balance-consistency.test.ts:1 | "audit F3". | Same. | S | |
| U2 | src/statistics/loan-payments/loan-payments.test.ts:64,66,132 | Review Focus 7 in titles. | Same. | S | |
| U2 | src/statistics/net-worth-series/net-worth-series.test.ts:252,672,698,733,785,788,825,872,876 | R4, T14, T21, T27, M4, Review Focus 5. | Same. | S | |
| U2 | src/statistics/type-breakdown/type-breakdown.test.ts:90,127,157 | T14, T27, round 1 item 6. | Same. | S | |


### R7 — Prices, rates, currency, dates, transactions, db and migration

Order: correctness bugs, then compliance, then conventions.

| Rule | file:line | What is wrong | Fix (the existing pattern or rule to apply, name a file that already does it right when one exists) | Effort (S/M/L) | Tags |
|---|---|---|---|---|---|
| G2 (BUG) | src/rates/repo/rates.repo.ts:20-38 (fed by src/rates/rates-refresh/rates-refresh.ts:128-151,206-208) | `upsertMany` writes all pairs in ONE insert. A Monobank refresh prices 107 fiat currencies plus 3 crypto. `buildPairs` then emits 107×106 = 11,342 to 110×109 = 11,990 rows. At 5 bound params per row that is 56,710–59,950 params, over op-sqlite's limit of 32,766. SQLite fails with "too many SQL variables" and the write rolls back. The callers' `either` swallows the rejection. Result: `currency_rates` never gets a live row. `latestFetchedAt` stays null, so every sync re-fetches, including the 1 s + 3 s retries. Crypto has no seed, so BTC/ETH/USDT holdings are never priced and drop out of net worth. Only the preferred Monobank path fails: the NBU fallback (about 43 currencies, about 9k params) fits. No test hits SQLite: monobank-fiat-coverage.test.ts and crypto-coverage.test.ts fake the upsert, and rates.repo.test.ts has no upsert test. This likely explains the "empty currency_rates" symptom that the seed commit b82a96f blamed on being offline. | Chunk inside the one `write` with `chunkForTable(currencyRates, rates)`, as transactions.repo.ts:299 does. Add a bound-param test through drizzle sqlite-proxy (pattern at transactions.repo.test.ts:569) using the full `currencyOptions` set. Check on a device. | S | |
| G2 (BUG) | src/rates/rate-history-repo/rate-history.repo.ts:63-70,94-101 | `rateTableAt` and `earliestRateTable` accept a stored rate of "0" or below. The live twin `rateTableFromRows` (src/rates/conversion/conversion.ts:31-41) drops rate ≤ 0 on purpose (a bad provider tick must not become a false zero). Scenario: CoinGecko `market_chart` returns price 0 for one day. `composeHistoryRows` stores BTC:UAH "0". The Statistics net-worth line then values the BTC holding at 0 in that bucket. | Pick the nearest or earliest row per pair, then build the table through `rateTableFromRows`. Reuse `rateKey`. | S | |
| G2 (BUG) | src/prices/metal-refresh/metal-refresh.ts:99-122,186-201 | A backfill runs only when a metal has NO stored point. (A) XAU is backfilled from a 2025-01-01 lot. The user later adds a lot dated 2020-06-01. XAU goes to `current`, so 2020-06 to 2024-12 is never fetched. `priceAt` falls back to the earliest point, and the chart values 2020 gold at the 2025 price. (B) The app sits unopened from day 1 to day 11. Only day 11 is fetched, so days 2–10 carry the day-1 price. The rates twin (`planBackfillRun` + `missingDays`, src/rates/history-backfill/history-backfill.ts:55-98) handles both cases. | Mirror `planBackfillRun`. Range-fetch from the earliest lot day when it is before the first stored day. Range-fetch lastStoredDay+1 to today instead of today only. This changes behavior; update kiko-pricing "NBU metal prices". | M | USER-DECISION: more NBU calls vs an accurate chart |
| S-PRICING | src/prices/metal-refresh/metal-refresh.ts:179,186 | It scans every holding, including closed holdings and holdings in archived accounts. So it makes a daily NBU fetch for metals nobody holds. The skill says it refreshes "ONLY currently held metals". `activeHoldings` (src/rates/active-holdings/active-holdings.ts) is the one place that rule lives. | Filter through `activeHoldings`. | S | |
| S-COMPL (5.6 "not-ready feature is REMOVED") + G1 | src/transactions/repo/transactions.repo.ts:753-811 | `setLoanPayment`, `setAutoLoanLinks` and `undoAutoLoanLink` have no caller in src (only tests and schema comments). The loan-link picker and the auto-matcher do not exist, yet statistics/loan-payments reads `loanHoldingId`. This is unreachable code for a not-ready feature. It is not reviewer-visible UI, so 5.6 risk is low. | Remove the three writers (keep the columns; migrations are additive-only), or wire the picker. | S | USER-DECISION |
| S-COMPL (5.6) + G1 | src/prices/instrument/instrument.ts:7; src/db/schema.ts:471 | `shareInstrument` has no src caller. The `'eodhd'` source value exists for an EODHD client that is not built (kiko-pricing "Later"). | Remove until shares ship, or record them as a schema reservation. | S | USER-DECISION |
| G6 | src/transactions/repo/transactions.repo.ts:655-658 vs 690-696 | The same operation class is handled two ways. `update` silently returns on a non-manual (synced) row; `remove` throws. An edit of a synced row "succeeds" and changes nothing. | Throw a typed error in both, using `remove`'s shape. | S | |
| G6 | src/rates/monobank-rates/monobank-rates.ts:70-71; src/rates/nbu-rates/nbu-rates.ts:44,67; src/rates/nbu-history/nbu-history.ts:41,85; src/prices/nbu-metals/nbu-metals.ts:61,72; src/rates/coingecko-history/coingecko-history.ts:30,47 | These fetchers cast `response.json()` blindly. A 200 response with an error object throws a raw TypeError ("raw.flatMap is not a function", "prices is not iterable"). Only coingecko.ts validates the body shape. src/rates/nbu-history/nbu-history.ts:67 also lacks nbu-rates' finite and `units > 0` guard (nbu-rates.ts:52), so it can store "Infinity" or "NaN" rates. | Add a shape guard per provider, as src/rates/coingecko/coingecko.ts:30-48 does. | M | |
| S-STYLE (guard) | src/rates/monobank-rates/monobank-rates.ts:66-69 | Imperative `if (!response.ok) throw`. The skill says replace it with `guard`. | Use the `guard` pair, as src/rates/nbu-rates/nbu-rates.ts:37-45 does. | S | |
| S-STYLE (externalize config) | src/rates/monobank-rates/monobank-rates.ts:6; src/rates/nbu-rates/nbu-rates.ts:15; src/rates/nbu-history/nbu-history.ts:11; src/prices/nbu-metals/nbu-metals.ts:15,22; src/rates/coingecko-history/coingecko-history.ts:12 | Hardcoded URLs. `MONOBANK_API_ENDPOINT` already exists in `@env`. The coingecko.ts sibling uses `@env` `PRICE_ENDPOINT`. | Move the URLs to `.env` / `.env.example` and src/env.d.ts. Update .env.test. | S | |
| S-STYLE (single source) | src/currency/currency/currency.ts:368; src/rates/coingecko-ids/coingecko-ids.ts:9 | There are two hand-kept crypto lists: a Set, and a `Record<'BTC'\|'ETH'\|'USDT', …>` union. `isCrypto` returns `boolean`, not a type guard. | Use `const cryptoCurrencies = [...] as const`, derive `CryptoCurrency` from it, make `isCrypto` a type guard, and type the map as `Record<CryptoCurrency, string>`. | S | |
| S-STYLE (single source) | src/db/schema.ts:19,47-59,225,247,471; src/rates/conversion/conversion.ts:14; src/rates/rates-refresh/rates-refresh.ts:26,109,131,181; src/rates/history-entry/history-entry.ts:13 | Enum literals are inlined. The rate `source` set is written out 7 times. The `holdings.type` enum has a mirror tuple in src/holdings/holding-type/holding-type.ts. Its `satisfies` check works one way only, so its comment "and vice versa" is false. | Derive every enum from one const tuple, as `currencyOptions` does. | M | |
| S-ARCH | src/rates/repo/rates.repo.ts:16-19 | `latestFetchedAt` executes the read inside the repo. The rule is that reads return a query builder. The sibling `bondRegisterRepo.fetchedAtQuery()` returns a builder. | Return the builder; the 3 sync callers await it. | S | |
| S-PRICING | src/prices/metal-refresh/metal-refresh.ts:69,73 | It hand-parses the `'metal:'` prefix and casts with an unchecked `as Metal`. The skill says always go through the instrument namespace functions. | Add `metalFromInstrument` to src/prices/instrument/, or compare against `metalInstrument(metal)`. | S | |
| U3 | src/prices/price-as-of-caption/price-as-of-caption.ts:47,49-51,56-58 | Banned `x === null ? undefined : f(x)` and `point === undefined ? undefined : t(…)`. | `foldMap(maybe(…), …)` from fnts/maybe. | S | feat-refactor |
| U3 | src/prices/price-book/price-book.ts:75 | `points === undefined \|\| … ? undefined : points[last]`. | `points?.at(-1)` | S | |
| U3 | src/db/keys/db-key.ts:14 | `credentials ? credentials.password : undefined`. | `credentials \|\| undefined` then `?.password`, or fnts `maybe`. | S | |
| U4 | src/rates/rates-refresh/rates-refresh.ts:59-78,182-189 | Hand-rolled try/catch retry and fallback in data-layer network code. | `either` + `bifold`, as src/db/use-live-query.ts does. | M | |
| U4 | src/migration/migrations-gate/migrations.gate.tsx:36-51 | A try/catch swallows the error. The comment cites a kiko-code-style carve-out that covers early-return JSX and UI Alert handlers only, not this bootstrap step. | `either(...)` fire-and-forget. | S | |
| U5 | src/prices/price-as-of-caption/price-as-of-caption.ts:45 | `holding.type === 'metal'` vs the rest, over priced types. The card's copy once drifted by dropping this branch. | `match(holding.type)` over `pricedHoldingTypes` with `.exhaustive()`. | S | feat-refactor |
| U5 | src/migration/migrations-gate/migrations.gate.tsx:132-152 | An if-chain over the closed `status` union. | `match(state).exhaustive()`. The skill (kiko-code-style:248-250) blesses the plain early return. | S | USER-DECISION |
| U6 + M-file-structure-colocation | src/rates/rates-refresh/rates-refresh.ts:1; src/rates/history-backfill/history-backfill.ts:1; src/rates/repo/rates.repo.ts:1,4; src/rates/rate-history-repo/rate-history.repo.ts:1,4; src/prices/price-points-repo/price-points.repo.ts:1,4; src/prices/metal-refresh/metal-refresh.ts:1,4; src/transactions/repo/transactions.repo.ts:2,4 vs 6-22; src/db/client.ts:1; src/db/encrypted-database.ts:1 | Alias and relative imports are mixed in the same file. The same module is imported both ways (`@kiko/db/repository` next to `../../db/client`; `@kiko/holdings/repo` next to `../../holdings/holding-metadata`). `rates-refresh` uses a self-alias for its own feature and relative paths across features, the reverse of the memory rule. | Choose one style. Memory says alias for cross-feature, but src has 1213 `../../` imports vs 146 alias imports. | M | USER-DECISION |
| U6 | src/rates/monobank-rates/monobank-rates.ts:1-2; src/rates/rates-refresh/rates-refresh.ts:3-4; src/migration/migrate-legacy-db/migrate-legacy-db.ts:1-2 | The same module is imported twice (a type import and a value import). | One import with an inline `type`, as src/db/encrypted-database.ts:2 does. | S | |
| U6 | src/rates/rates-refresh/rates-refresh.ts:181-189 | A closure mutates the outer `let fiatSource`. | Return `{ rows, source }`. | S | |
| U6 | src/rates/coingecko/coingecko.ts:41-42,68 | Double casts inside the guard, and a redundant `(data as CoinGeckoPrices)` after narrowing. | Drop the casts. | S | |
| U6 | src/dates/format.ts:19-21,34-35 | `options?.timeZone === 'UTC'` is repeated 5 times. | Choose the getter set once. | S | |
| U6 | src/db/use-live-query.ts:25 | `export function` while every other hook is an arrow const. | `export const useLiveQuery = …` | S | |
| U7 | src/rates/monobank-rates/, nbu-rates/, nbu-history/, coingecko/, coingecko-history/; src/prices/nbu-metals/ | The rate providers are not built the same way. monobank-rates uses an imperative ok-check, has no guard, and exports a provider-less `fetchFiatRates`. The NBU clients use `guard` with no shape check. coingecko uses `guard`, a shape check and `@env`. coingecko-history hardcodes its URL. Folder names differ too (`coingecko/` vs `*-rates/`). | One provider template: a `<provider>-rates` folder, a `fetch<Provider>…` name, the endpoint from `@env`, a shared read guard and a shape guard. | M | |
| U7 | src/prices/metal-refresh/metal-refresh.ts:12,19; src/rates/history-backfill/history-backfill.ts:16; src/rates/rates-refresh/rates-refresh.ts:22-28 | Callers re-declare the repos' input row types: `NewPricePointRow`, `NewHistoryRow`, and `StoredRate` (which duplicates `NewRate`). `FetchHistory` re-declares `NbuMetalHistoryPoint`. | Export `New*Row` from each repo and import it. | S | |
| U7/G2 | src/rates/rate-history-repo/rate-history.repo.ts:15; src/prices/price-points-repo/price-points.repo.ts:12 | Fixed 2000-row chunks. src/db/chunk-for-table.ts:8-16 records that a fixed chunk size broke once already. | `chunkForTable`. | S | |
| U8 | src/dates/ | A flat folder (default-range, duration, format, local-day and their tests loose). Its siblings src/currency/* and src/rates/* are folder-per-thing. | One folder per unit, with a barrel. | S | |
| U8 | src/db/capture-set-tx.ts, in-array-clause-test-helper.ts, render-condition-test-helper.ts, __fixtures__/ | Shared test helpers live in the app db folder. The rule (kiko-code-style:517-519) is src/test-support/, and that folder exists. Their names are inconsistent too. | Move them to src/test-support/ and use one naming scheme. | S | |
| U8 | src/db/ (schema.*.test.ts ×10, client, encrypted-database, run-migrations, use-live-query, id, chunk-for-table, db-config) | A flat dump of about 30 files. | Group per unit (schema/, client/, migrations-runner/…). | M | |
| U8/G7 | src/db/schema.category-overrides.test.ts:39,84,111,212,271,330,391 | Eight unrelated migration suites (categories, hold, colors, icons, journal registration, exchange marker, indexes) sit under one misleading name. | One file per migration or table, like schema.price-points.test.ts. | M | |
| U8 | src/rates/monobank-rates/monobank-fiat-coverage.test.ts:1-3 | It drives refreshRates and net-worth-view from the monobank-rates folder. | Move it beside rates-refresh/crypto-coverage.test.ts. | S | |
| G1 | src/transactions/repo/transactions.repo.ts:474-475 | `add` has no src caller. | Delete it. | S | |
| G1 | src/db/run-migrations.ts:18-19 | The header claims the "same `folderMillis` gate". The code gates on COUNT (lines 54-61). | Fix the comment. | S | |
| G1 | src/migration/migrate-legacy-db/migrate-legacy-db.ts:21; src/rates/repo/rates.repo.test.ts:13 | "Must run at module load" / "client.ts runs the legacy-db migration at module load" is stale. It now runs lazily from `openConnection`/`establishKey`. | Fix the comments. | S | |
| G1 | src/db/schema.ts:67,110,120,126,283-284,418; src/db/__fixtures__/seed-category-colors.ts:10,13 | Dead paths: src/monobank/sync.ts, transactions/transactions.repo.ts, statistics/transfer-exclusion.ts, exchange-exclusion.ts, category-breakdown.ts. The function is now `upsertAllHoldings`. "The sole documented exception" is stale: the list has 3 entries. | Update the paths and the text. | S | |
| G1 | src/transactions/default-description/default-description.test.ts:1-2; exchange-description.test.ts:1-2; row-description.test.ts:1-2; src/prices/price-as-of-caption/price-as-of-caption.test.ts:1-3 | A redundant `import '../../i18n'` sits before a named import from the same module. | Drop the bare import. | S | |
| G2 | src/rates/nbu-rates/nbu-rates.ts:37; nbu-history.ts:34; src/prices/nbu-metals/nbu-metals.ts:54,65; src/rates/coingecko/coingecko.ts:16; coingecko-history.ts:23 | Six copies of the ok-check `guard`; only the message differs. | A `readJsonOrThrow(label)` factory in one http module. | S | |
| G2 | src/rates/nbu-history/nbu-history.ts:11,45-61 vs src/prices/nbu-metals/nbu-metals.ts:15-22,101-118; nbu-rates.ts:15 | Endpoints, `toNbuDate`, `parseNbuDate` and `rangeUrl` are copied. The same exchange payload is fetched twice per sync (fiat and metals). | One NBU client module; optionally one fetch for both fiat and metals. | M | |
| G2 | src/rates/rates-refresh/rates-refresh.ts:20,86-151 vs src/rates/history-backfill/history-backfill.ts:13,101-196 | `UahPrice`, `pairSource`, the pair double loop and `allCurrencies` are duplicated. | Extract a `pair-composition` module. Seed, refresh and backfill all use it. | M | |
| G2 | src/db/encrypted-database.ts:12,19,31-35 vs src/migration/migrate-legacy-db/migrate-legacy-db.ts:7-17 | DB file names and the table-count SQL are duplicated. `'pff.db'` in encrypted-database breaks the "Do NOT reference pff anywhere else" rule at migrate-legacy-db.ts:7-8. | Export the names and `tableCount` from one place. | S | |
| G2 | src/rates/history-backfill/history-backfill.ts:9; src/rates/history-entry/history-entry.ts:16 (and 4 tests) | `DAY_MS` is redefined, despite src/dates/duration.ts:1-5 being "the single source". | Import it from duration. | S | |
| G2 | src/rates/conversion/conversion.ts:51; src/currency/format/format.ts:6 | `toMajor` (src/currency/money/money.ts:6) is re-inlined. | Call `toMajor`. | S | |
| G2 | src/rates/monobank-rates/monobank-rates.ts:18-24 | A local `isFiat` plus a Set duplicate `isFiat` in currency.ts:372. | Import it, as nbu-rates.ts:3 does. | S | |
| G2 | src/transactions/repo/transactions.repo.ts:117-127,667-676,698-705; 514-534 vs 578-601 | The balance read-modify-write is copied 3 times. The receive-leg dispatch (`plain`/`contribution`/`excluded`) is copied twice. | `adjustBalanceTx(tx, holdingId, delta)` and `recordReceiveLegTx`. | S | |
| G2 | src/currency/parse/parse.ts:18-50 vs src/currency/decimal/decimal.ts:56-60 | Two user-input parsers disagree. "1,234.56" gives 1234.56 in one and null in the other; "1.234,56" also gives null in `normalizeDecimal`. | Share the separator logic. This changes behavior for price, quantity and purity fields. | S | |
| G2 | src/prices/price-book/price-book.ts:40 vs src/rates/history-entry/history-entry.ts:23 | Two day keys. `dayKeyOf` uses the LOCAL date; `toUtcMidnight` uses the UTC date. At 01:30 Kyiv on Sep 25 they give Sep 25 and Sep 24. Both tables are documented as the "same convention". | Move both to src/dates. Name each one's convention. | S | |
| G2 | src/rates/net-worth-view/net-worth-view.ts:51; src/rates/rate-history-repo/rate-history.repo.ts:56,87; src/rates/history-backfill/history-backfill.ts:123 | The pair-key template is inlined 4 times. | Export `rateKey` (conversion.ts:17). | S | |
| G3 | src/rates/monobank-rates/monobank-rates.ts:65; src/rates/rates-refresh/rates-refresh.ts:31,36 | `fetchFiatRates` has no provider name; its twin is `fetchNbuFiatRates`. The dep names are `fetchFiatRates` / `fetchNbuRates`. | `fetchMonobankFiatRates`, and symmetric dep names. | S | |
| G3 | src/db/id.ts:12,17; src/rates/coingecko-history/coingecko-history.ts:50,57,81,87; src/rates/history-backfill/history-backfill.ts:66; src/db/run-migrations.ts:102 | Abbreviated names: `cryptoObj`, `rand`, `ts`, `a`/`b`, `r`, `d`, `doRun`. | Full names (kiko-code-style "Variable naming"). | S | |
| G4 | src/transactions/repo/transactions.repo.ts (1014 lines) | It mixes queries, manual CRUD, exchange legs, change returns, loan links, dedup import and the closing-balance rule. | Split into repo queries/CRUD, exchange, loan-links and import-rows modules. | L | |
| G5 | src/rates/fiat-rate-seed/fiat-rate-seed.ts:2 | A static seed deep-imports rates-refresh, which loads @kiko/rates/repo and db/client. So the pure net-worth-view loads the db client. | Import the extracted pair-composition module. | S | |
| G7 | src/transactions/repo/transactions.repo.test.ts:29,343,382,692,1042,1596,2115,2456 (+ inline mockTx at 151,191,219,659,927,1218,1259,1309,1420,1444); src/transactions/repo/money-path.test.ts:26 | Eight bespoke fake tx builders, keyed on select call ORDER. money-path.test.ts copies makeExchangeTx. This is the class the fake-db-masks-bugs memory warns about. The file is 2548 lines and mixes concerns. | One shared fake in src/test-support that throws on unknown calls, or the drizzle sqlite-proxy already used at :569. Split the file with the repo. | L | |
| G7 | src/prices/price-points-repo/price-points.repo.test.ts:22 vs src/rates/rate-history-repo/rate-history.repo.test.ts:25 | `makeUpsertTx` is duplicated; only the key fields differ. | A shared keyed-upsert fake. | S | |
| G7 | 15 test files (`jest.mock('../../db/client', … write: work(mockTx))`); src/rates/repo/rates.repo.test.ts, src/db/client.test.ts, encrypted-database.test.ts, keys/db-key.test.ts, src/migration/migrate-legacy-db/migrate-legacy-db.test.ts (op-sqlite mock) | Mock blocks are copy-pasted. | Shared helpers in src/test-support. | M | |
| G7 | src/db/schema.*.test.ts (8 files, e.g. schema.price-points.test.ts:4-10) | The `migrationsDir` / `combinedSql` helper is duplicated. | A shared migrations-SQL reader. | S | |
| G7 | src/rates/repo/rates.repo.test.ts | There is no `upsertMany` test; the sibling repos test theirs. This is how the bound-param bug escaped. | Add the chunking test (see the first bug row). | S | |
| G7 | src/prices/price-book/price-book.test.ts:51-62,89-99; src/dates/format.test.ts:22-32 | They pin `process.env.TZ` mid-test. kiko-domain says this does not retarget `Date`, so these tests may not prove what they claim. | Use the local `Date` constructor pattern (fix 33333c1). | S | |
| U2 | src/transactions/repo/transactions.repo.ts:43,276-277,289-297,443,461,506-510,537,729-742,772-775,799,827-831,931-935,961 | Task, review and spec ids (T29, D21, spec 5.4, Bundle B, "ponytail"), build history, "used to". | Keep only the WHY. | M | |
| U2 | src/transactions/repo/transactions.repo.test.ts:107,635,649-653,766-774,801-805,825-845,900,915,1638,1829,1842,1942,2059,2227,2286,2341-2345,2384-2390,2428-2436,2463 | The same kind of ids in test comments and titles. | Same. | M | |
| U2 | src/db/schema.ts:22,69-80,148-160,169-175,186-192,264,301,318,352,364,371,387-388,448,481 | Task ids, plan dates, "Review Focus", "Guideline 5.6 remediation … were removed" history. | Same. | M | |
| U2 | src/rates/net-worth-view/net-worth-view.ts:21,32,40-45,73-77; net-worth-view.test.ts:34,68,144,173,207,257-262,316,323 | "Part A/C", "RULING R2", "T14/T21/T27", history. | Same. | S | |
| U2 | src/rates/rates-refresh/rates-refresh.ts:44,176,193-196; rates-refresh.test.ts:29,201,205 | "Part B", "`Promise.all` discarded…" history. | Same. | S | |
| U2 | src/prices/price-as-of-caption/price-as-of-caption.ts:21,28-34; price-as-of-caption.test.ts:53-54 | "(T20)", "Extracted (F4 audit 13)… used to". | Same. | S | feat-refactor |
| U2 | src/migration/migrations-gate/migrations.gate.tsx:24-31,55,74,78 | Plan dates, "Task 5.2", "later phase", history. | Same. | S | |
| U2 | src/db/chunk-for-table.ts:8-14; src/db/client.ts:48,50-53; src/db/client.test.ts:81 | "T29 review round 1, C1 and M6", "cluster-2", "historical" path. | Same. | S | |
| U2 | src/dates/local-day.ts:4-6; src/transactions/transaction-span/transaction-span.ts:8-10; src/transactions/exchange-description/exchange-description.ts:12-14; src/transactions/row-description/row-description.ts:15-17; src/transactions/default-description/default-description.ts:13; default-description.test.ts:32 | History ("used to live", "was slow", "used to store") and "F3 fix round 3, N9". | Same. | S | |
| U2 | src/currency/currency/currency.ts:3,243; src/rates/conversion/conversion.test.ts:62,81; src/rates/currency-totals/currency-totals.test.ts:61,78; src/prices/nbu-metals/nbu-metals.test.ts:1; src/prices/metal-refresh/metal-refresh.test.ts:1; src/rates/repo/rates.repo.test.ts:6 | "as of Item A", "originally shipped", "T14", "T19 Step 1 LIVE PROBE (2026-09-24)", "An earlier fixture". | Same. | S | |
| U2 | src/db/schema.category-overrides.test.ts:102,208,212,266,271,391,411; schema.bond-register.test.ts:12; schema.loan-link.test.ts:12; schema.price-points.test.ts:12; in-array-clause-test-helper.ts:10; render-condition-test-helper.ts:9; __fixtures__/seeded-categories.ts:25 | T-21, M1/M2/C1, T24/T29/T11/T30. | Same. | S | |
| U2 | src/rates/fiat-rate-seed/fiat-rate-seed.ts:6 | "captured 2026-09-22", a date in a comment. kiko-pricing:29-30 relies on it. | Keep it (data provenance), or move it to a `FIAT_SEED_CAPTURED_ON` constant. | S | USER-DECISION |
| S-STYLE (blank line before return/if/for) — sources | src/currency/compact/compact.ts:48; src/currency/parse/parse.ts:35; src/dates/format.ts:63,72,75; src/db/capture-set-tx.ts:20,23,29; src/db/chunk-for-table.ts:21,24,37; src/db/id.ts:13,16,19; src/db/render-condition-test-helper.ts:19; src/migration/migrate-legacy-db/migrate-legacy-db.ts:50,62; src/prices/nbu-metals/nbu-metals.ts:107,113; src/rates/coingecko-history/coingecko-history.ts:50,83; src/rates/coingecko/coingecko.ts:35,37,47; src/rates/conversion/conversion.ts:36,40,48,52; src/rates/history-backfill/history-backfill.ts:66,69,113,120,131,137,140,152,155,158,161,166,182,184,188,195,209,230,244; src/rates/monobank-rates/monobank-rates.ts:41,44,50,54,57,67,71; src/rates/nbu-history/nbu-history.ts:50,56,83,86,90; src/rates/nbu-rates/nbu-rates.ts:52,55,68; src/rates/net-worth-view/net-worth-view.ts:65; src/rates/rate-history-repo/rate-history.repo.ts:52,58,64,66,70,86,89,95,97,101; src/rates/rates-refresh/rates-refresh.ts:88,96,103,134,138,150,162,187; src/rates/repo/rates.repo.ts:18; src/transactions/group-by-day/group-by-day.ts:25; src/transactions/repo/transactions.repo.ts:299,656,664,691,694,700; src/transactions/transaction-span/transaction-span.ts:26,29 | The hard rule is violated (23 files). | Insert the blank lines. | S | |
| S-STYLE (blank line) — tests | src/currency/currency/currency.test.ts:52,63; src/dates/format.test.ts:130; src/db/encrypted-database.test.ts:141; schema.category-overrides.test.ts:132,165,198,384; schema.sync-state.test.ts:46; use-live-query.test.ts:19; migrate-legacy-db.test.ts:33,51; metal-refresh.test.ts:43,63,108,112; nbu-metals.test.ts:34,94; price-points.repo.test.ts:10,30,36,87,105,117,132; coingecko-history.test.ts:16; coingecko.test.ts:13; history-backfill.test.ts:181,185,192; monobank-fiat-coverage.test.ts:37; monobank-rates.test.ts:40; nbu-history.test.ts:24,40,46; nbu-rates.test.ts:29; rate-history.repo.test.ts:9,36,42,85,104,119; crypto-coverage.test.ts:30,35,48,82,90,102,131; rates-refresh.test.ts:34,93,187,212,215,282,308; money-path.test.ts:9,41,48,54; transactions.repo.test.ts:10,155,166,195,223,363,370,374,664,677,861,1061,1068,1074,1223; transaction-span.test.ts:26 | The same rule in test code (25 files). | Same. | S | |
| M-import-ordering-length-sort — sources | src/currency/format/format.ts:2; src/db/__fixtures__/seed-category-colors.ts:2; src/db/client.ts:2,3,7; src/db/encrypted-database.ts:2,3; src/db/use-live-query.ts:2; src/migration/migrate-legacy-db/migrate-legacy-db.ts:2; src/migration/migrations-gate/migrations.gate.tsx:3,5,7,9,12; src/prices/metal-refresh/metal-refresh.ts:6-8; src/prices/price-points-repo/price-points.repo.ts:2; src/prices/use-price-book/use-price-book.ts:4; src/rates/coingecko/coingecko.ts:2; src/rates/conversion/conversion.ts:4; src/rates/currency-totals/currency-totals.ts:4; src/rates/monobank-rates/monobank-rates.ts:4; src/rates/nbu-rates/nbu-rates.ts:4; src/rates/net-worth-view/net-worth-view.ts:7; src/rates/rate-history-repo/rate-history.repo.ts:2,6; src/rates/rates-refresh/rates-refresh.ts:5,6,8; src/rates/repo/rates.repo.ts:2; src/transactions/repo/transactions.repo.ts:4; src/transactions/row-description/row-description.ts:5 | Imports are not sorted ascending by ending-line length within their group (22 files). No side-effect barrier is involved. | Re-sort each group. | S | |
| M-import-ordering-length-sort — tests | src/dates/default-range.test.ts:2; src/db/schema.{category-overrides,change-group,namespace-external-ids,price-points,statement-mappings,sync-state,trend-filter}.test.ts:2; src/db/settings-columns.test.ts:2; src/migration/migrations-gate/migrations.gate.test.tsx:2,6; src/rates/fiat-rate-seed/fiat-rate-seed.test.ts:2; src/rates/rates-refresh/rates-refresh.test.ts:2 | The same (for example `node:fs` at 52 characters sorted before `node:path` at 33). | Same. | S | |


### R8 — Statement-import, monobank, crypto-sync, bank-sync and sync

**Compliance (S-COMPL): no violation found in this area.**
- **5.6:** no `@env` visibility flags. `connectable` and `sellsMetals` are always-rendered data. The removed providers' code is gone.
- **5.1.5:** secrets stay in the Keychain. The diagnostic `console.warn` calls log counts and Binance `msg` text only.
- **Export compliance:** HMAC-SHA256 request signing is exempt authentication.
- **ATS:** the credential-bearing hosts come from `@env`, and `check:plist` covers them.
- **Test code:** `format-test-fixtures.ts` and the CSV/XLSX fixtures are not imported by app code, so they are not bundled.
- **Trademarks:** bank and Binance names are factual text. No logos.

| Rule | file:line | What is wrong | Fix (the existing pattern or rule to apply, name a file that already does it right when one exists) | Effort (S/M/L) | Tags |
|---|---|---|---|---|---|
| BUG | src/statement-import/mapping/mapping.ts:39-46 | The dedup key is not injective. Parts are joined with `' '` and the occurrence is appended as `' N'`. Scenario: one holding, same time and amount, rows A "Top up", B "Top up", C "Top up 1". B gets key `…top up 1` (occurrence 1). C gets `…top up 1` (occurrence 0). `importRows` upserts C over B: 3 rows parsed, 2 stored, 1 lost silently. | Use a separator that normalization can never produce (U+241F, as saved-mapping.ts:18 does) or a `#N` suffix. This changes every synthesized externalId, so re-importing an old file duplicates rows unless you migrate. | M | USER-DECISION: migrate old keys, or accept one-time duplicates |
| BUG | src/crypto-sync/binance/binance.transactions.ts:363-373 | All windows are collected in memory and written once at the end. The first sync walks about 38 windows from 2017. One failed request rejects `runSync`, nothing is written, and the cursor (newest imported row) stays undefined. The next run starts again from `HISTORY_FLOOR_MS`, so on a flaky network the first import may never complete. | Write each window's rows as soon as it is fetched, oldest first, so the cursor moves forward. The per-card commit in src/monobank/sync/sync.ts:804-841 is the model. Behavior change. | S | |
| BUG | src/monobank/sync/sync.ts:400,410 vs 873,1055,1165,1201 | The comment at 397-399 says client-info can omit `accounts`, but only `upsertAllHoldings` defaults it. `orderStatementQueue` (`[...accounts]`) then throws a TypeError after the fast phase has committed. | Normalize once after `fetchClientInfo` (`accounts ?? []`). If the API always sends `accounts`, delete the comment and the local default instead. | S | |
| BUG | src/monobank/sync/sync.ts:1191 | "At least one card succeeded" is computed as `failures.length < accounts.length`. This counts cards that were never fetched (unrepresentable currency, no holding) as successes. Scenario: 1 UAH card and 1 unrepresentable-currency card; the UAH fetch fails; 1 < 2, so "Last sync" is stamped although every fetched card failed. This contradicts 1178-1181. | Gate on `succeededIds.length > 0 \|\| toFetchPlan.length === 0`. Behavior change. | S | |
| BUG (G2) | src/statement-import/formats/monobank-csv/monobank-csv.format.ts:116-124; src/statement-import/column-mapping/apply-column-mapping.ts:230-264 | The two closing-balance pickers break ties differently. Monobank CSV takes the last tied row (`>=`). Column mapping uses file orientation. Monobank's own comment (103-104) says file order is not guaranteed. On a newest-first file whose two newest rows share one second, the older row's balance is written to the holding. | Move `pickClosingBalanceRow` into a shared `statement-import/closing-balance/` and use it in both. Behavior change for ties only. | M | |
| G2 | src/crypto-sync/binance/binance.client.ts:66-89; src/crypto-sync/btc-wallet/btc-wallet.client.ts:28-38 | Divergent twin of src/monobank/client/monobank.client.ts:98-163, which has a 30 s timeout, a bounded 429 retry with Retry-After, and typed translated errors. The Binance and Esplora clients have none of these. A Binance 429 fails the whole balance sync at once. A hung request keeps the per-account lock and the progress session open until the OS times it out. | Extract `request` (timeout and 429 policy) from monobank.client.ts into a shared sync HTTP module and use it in all three clients. | M | |
| U6 | src/statement-import/import-statement/import-statement.ts:101-113 | Runs `detectFormat` over the whole registry again, although the screen already picked the bank-scoped format (statement-import.screen.tsx:72-83). The input type `{text; fileName}` hides the `sheetRows` that XLSX needs. Preview and import can disagree if two detects ever overlap. | Accept the format the screen previewed: `(format, input: StatementFormatInput, holdingId)`. | S | feat-refactor |
| S-I18N | src/crypto-sync/btc-wallet/btc-wallet.provider.ts:25,39,43 | English error strings are shown verbatim by `useSyncAction` (crypto-sync-section error `Text`). The default holding name 'BTC Wallet' is English, although `providerDisplayName` translates 'Wallet'. | Use `i18n.t` keys, as `resolveTargetAccount` does (src/crypto-sync/sync/sync.ts:76). | S | |
| S-I18N | src/crypto-sync/binance/binance.provider.ts:130,139,149,157,177,184,261 | Raw English errors reach the UI through `useSyncAction`. | Use `i18n.t` keys, as src/monobank/sync/sync.ts:268,332,993 does. | S | |
| S-I18N | src/crypto-sync/binance/binance.client.ts:47 | `Binance request failed: <status>: <msg>` is shown raw. | Use a translated message with the status; keep `msg` for the log. The Monobank timeout and rate-limit errors are the model. | S | |
| S-I18N | src/crypto-sync/btc-wallet/btc-wallet.client.ts:16 | `Block explorer request failed` is English. | Use `i18n.t`. | S | |
| S-I18N | src/monobank/client/monobank.client.ts:66 | `Monobank request failed: ${status}` is English, while its twins at lines 38 and 49 are translated. | Use `i18n.t`. | S | |
| S-STYLE | src/crypto-sync/binance/binance.client.ts:1-3,178 | Imports not length-sorted (29 after 44). No blank line before `if` at 178. | Sort by length. Add the blank line. | S | |
| S-STYLE | src/crypto-sync/binance/binance.client.test.ts:36,121,172,185,290,297,324,375,434 | No blank line before `return`. | Add blank lines. | S | |
| S-STYLE | src/crypto-sync/binance/binance.credentials.ts:1-2 | Imports not length-sorted. | Sort. | S | |
| S-STYLE | src/crypto-sync/binance/binance.credentials.test.ts:20,27,32,36 | No blank line before `return`. | Add blank lines. | S | |
| S-STYLE | src/crypto-sync/binance/binance.provider.ts:156,218,220,224,248,304 | No blank line before `if`/`for`/`return`. | Add blank lines. | S | |
| S-STYLE | src/crypto-sync/binance/binance.provider.test.ts:1-2 | Imports not length-sorted. | Sort. | S | |
| S-STYLE | src/crypto-sync/binance/binance.transactions.test.ts:1-12 | Not length-sorted. `./binance.client` is imported twice (type at 3, value at 4). | Merge with an inline `type`, then sort. | S | |
| S-STYLE | src/crypto-sync/binance/migrate-binance-credential.test.ts:15,20,29,34 | No blank line before `return`/`if`. | Add blank lines. | S | |
| S-STYLE | src/crypto-sync/btc-wallet/btc-wallet.client.ts:1-2 | Imports not length-sorted. | Sort. | S | |
| S-STYLE | src/crypto-sync/btc-wallet/btc-wallet.client.test.ts:31 | No blank line before `return`. | Add. | S | |
| S-STYLE | src/crypto-sync/btc-wallet/btc-wallet.provider.ts:1-3 | Imports not length-sorted. | Sort. | S | |
| S-STYLE | src/crypto-sync/btc-wallet/btc-wallet.provider.test.ts:1-2 | Imports not length-sorted. | Sort. | S | |
| S-STYLE | src/crypto-sync/disconnect/disconnect.ts:3-4 | Imports not length-sorted. | Sort. | S | |
| S-STYLE | src/crypto-sync/provider/provider.ts:1-2 | Imports not length-sorted. | Sort. | S | |
| S-STYLE | src/crypto-sync/run-crypto-sync/run-crypto-sync.ts:1-7 | Imports not length-sorted (35<53, 74<82, 65<100). | Sort. | S | |
| S-STYLE | src/crypto-sync/sync/sync.ts:4-13,137,150 | Imports not length-sorted. No blank line before `if`/`return`. | Sort. Add blank lines. | S | |
| S-STYLE | src/crypto-sync/sync/sync.test.ts:6-15 | Imports not length-sorted. | Sort. | S | |
| S-STYLE | src/monobank/client/monobank.client.ts:1-2,84 | Imports not length-sorted. No blank line before `return`. | Sort. Add. | S | |
| S-STYLE | src/monobank/client/monobank.client.test.ts:1-2,23,49,84,102,117 | Imports not length-sorted. Missing blank lines. | Sort. Add. | S | |
| S-STYLE | src/monobank/migrate-credential/migrate-credential.test.ts:16,21,30,35 | Missing blank lines. | Add. | S | |
| S-STYLE | src/monobank/sync-status/sync-status.ts:30,38,97,105,159,211,215,248,259 | Missing blank lines before `for`/`return`. | Add. | S | |
| S-STYLE | src/monobank/sync/sync.ts:1-21; 266,271,283,286,329,331,338,341,410,487,504,506,510,563,568,607,611,614,635,637,640,665,670,675,684,702,835,885,941,973,992,1089,1104,1118,1122,1203,1247 | Imports in natural order, not length. 37 missing blank lines. | Sort. Add blank lines. | S | |
| S-STYLE | src/monobank/sync/sync.test.ts:231,234,328,344,354,607,612,855,899,902,905,939,984,1059,1096,1122,1178,1182,1184,1187,1234,1237,1346,1393,1404,1408,1411,1457,1469,1704,1849,1904,1949,2117,2153,2156,2159 | Missing blank lines. | Add. | S | |
| S-STYLE | src/monobank/token/token.ts:63,108,113 | Missing blank lines. | Add. | S | |
| S-STYLE | src/monobank/token/token.test.ts:24,29,38 | Missing blank lines. | Add. | S | |
| S-STYLE | src/statement-import/column-mapping/apply-column-mapping.ts:8-9,11-12,16-17,337 | Same module imported twice (currency, parser, date-formats). No blank line before `return` at 337. | Merge with an inline `type` (skill §Import ordering). Add the blank line. | S | |
| S-STYLE | src/statement-import/column-mapping/apply-column-mapping.test.ts:1-4 | `./**` group split by a blank line; type imports placed before values. | One sibling block, length-sorted. | S | |
| S-STYLE | src/statement-import/column-mapping/saved-mapping.test.ts:1-5 | Same: sibling group split, types first. | One block. | S | |
| S-STYLE | src/statement-import/formats/business-csv/business-csv.ts:16-31 | `./csv-row` sits inside the `../` block with no blank line. `../../parser` is imported twice (22, 24). | Separate the groups. Merge the imports. | S | |
| S-STYLE | src/statement-import/formats/procredit-business-csv/procredit-business-csv.format.ts:11-13 | The `../**` group is split by a blank line. | One block. | S | |
| S-STYLE | src/statement-import/formats/ukrsib-business-csv/ukrsib-business-csv.format.ts:10-12 | Same group split. | One block. | S | |
| S-STYLE | src/statement-import/formats/monobank-csv/monobank-csv.format.ts:12-17 | `../../parser` imported twice (12, 14); currency twice (16, 17). | Merge with inline `type`. | S | |
| S-STYLE | src/statement-import/formats/privatbank-xlsx/privatbank-xlsx.format.ts:14-19 | parser and currency each imported twice. | Merge. | S | |
| S-STYLE | src/statement-import/formats/sensebank-csv/sensebank-csv.format.ts:18-23 | parser and currency each imported twice. | Merge. | S | |
| S-STYLE | src/statement-import/formats/business-csv/csv-row.ts:12-13 | Currency imported twice. | Merge. | S | |
| S-STYLE | src/statement-import/formats/alfa-business-csv/alfa-business-csv.format.ts:15,23 | Parser imported twice. | Merge. | S | |
| S-STYLE | src/statement-import/mapping/mapping.test.ts:1-2 | Imports not length-sorted. | Sort. | S | |
| S-STYLE | src/statement-import/column-mapping/parity.test.ts:11 | No blank line before `return`. | Add. | S | |
| S-STYLE | src/statement-import/import-statement/import-statement.test.ts:13,39-40 | No blank line before `return`. `../column-mapping` imported twice. | Add. Merge. | S | feat-refactor |
| S-STYLE | src/sync/sync-jobs/sync-jobs.ts:2,7 | `../../bank-sync/provider` imported twice. | Merge. | S | |
| S-STYLE | src/sync/use-auto-sync/use-auto-sync.ts:1-13 | Not length-sorted. `../**` split into two blocks (7-10 and 12-13). | One parent block, length-sorted. | S | |
| S-STYLE | src/sync/use-auto-sync/use-auto-sync.test.ts:21,24 | Missing blank lines. | Add. | S | |
| S-STYLE | src/sync/use-crypto-sync/use-crypto-sync.ts:1-2 | 61 after 90: not sorted. | Sort. | S | |
| S-STYLE | src/sync/use-sync-all/use-sync-all.ts:1-3,78 | Not sorted. Missing blank line. | Sort. Add. | S | |
| S-STYLE | src/sync/use-sync-all/use-sync-all.test.ts:164 | Missing blank line. | Add. | S | |
| S-STYLE | src/sync/use-sync/use-sync.ts:1-6 | Not sorted. | Sort. | S | |
| S-STYLE | src/sync-state/sync-state.repo.ts:1-5 | Not sorted. | Sort. | S | |
| S-STYLE | src/sync-state/sync-state.repo.test.ts:10 | Missing blank line. | Add. | S | |
| U1 | src/sync/use-sync/use-sync.ts:26,68 | Two exported hooks in one file (`useSyncAction`, `useSync`). | Move `useSyncAction` to `src/sync/use-sync-action/` with its test. | S | |
| U1 | src/monobank/sync-status/sync-status.ts:47,114 | Two hooks plus three stores plus the session in one module. | Split: `sync-status`, `sync-progress`, `fast-phase`, each with its hook. | M | |
| U2 | src/statement-import/parser/parser.ts:11,15,33,45,57,61,103,107,119-125,156,169 | "section C/A.3", "Task 3 review, CRITICAL", "Phase 1/2/3/4", "import-balance commit B", "ruling I1", "Review follow-up M1". | Keep the WHY; drop ids and history. | S | |
| U2 | src/statement-import/parser/parser.test.ts:24-29 | "Phase 4 (Task 5)", "task-5-brief.md". | Delete. | S | |
| U2 | src/statement-import/registry/registry.test.ts:20 | Test title says "three Phase 4 FOP/business". | Rename. | S | |
| U2 | src/statement-import/windows-1251.d.ts:1-2 | "Phase 3", "Phase 4". | Drop. | S | |
| U2 | src/statement-import/formats/format-test-fixtures.ts:5-8,42,48,55,62 | "Phase 4", "Task 5 review", "Task 4", "C.4". | Drop. | S | |
| U2 | src/statement-import/formats/monobank-csv/monobank-csv.format.ts:28,67-68,103-104,109 | "section C.1", "Task 3 review", "review follow-up M2/I1". | Drop. | S | |
| U2 | src/statement-import/formats/monobank-csv/monobank-csv.format.test.ts:8,24,34,51-55,123,138,145,155,163 | Review ids, plus history ("used to assume"). | Drop. | S | |
| U2 | src/statement-import/formats/privatbank-xlsx/privatbank-xlsx.format.ts:1,22,30,45,80,93-96 | "section C.1", "Task 3 review". | Drop. | S | |
| U2 | src/statement-import/formats/privatbank-xlsx/privatbank-xlsx.format.test.ts:56,95,176 | "Task 3 review", "section C.1". | Drop. | S | |
| U2 | src/statement-import/formats/sensebank-csv/sensebank-csv.format.ts:1-10,25-27,30,36,51,73,87,108,131-137,170 | "Section C.2", "task-4-report.md", "Controller ruling 3/5", "Task 3 review". | Drop. | S | |
| U2 | src/statement-import/formats/sensebank-csv/sensebank-csv.format.test.ts:21,25,56,92-93,121 | Same kinds of ids. | Drop. | S | |
| U2 | src/statement-import/formats/sensebank-csv/cp1251-decode.test.ts:5,40 | "section C.2's KEY DESIGN". | Drop. | S | |
| U2 | src/statement-import/formats/procredit-business-csv/procredit-business-csv.format.ts:1-4,15,19,25 | Section numbers, task-5-report.md. | Drop. | S | |
| U2 | src/statement-import/formats/procredit-business-csv/procredit-business-csv.format.test.ts:16,25,31,51,63-64,69,174 | Same. | Drop. | S | |
| U2 | src/statement-import/formats/ukrsib-business-csv/ukrsib-business-csv.format.ts:1,9,14,25,35 | Same. | Drop. | S | |
| U2 | src/statement-import/formats/ukrsib-business-csv/ukrsib-business-csv.format.test.ts:16,23,44,49 | Same. | Drop. | S | |
| U2 | src/statement-import/formats/alfa-business-csv/alfa-business-csv.format.ts:1,4,26-28,32,38,41,100,126 | Same, plus "Controller ruling 3". | Drop. | S | |
| U2 | src/statement-import/formats/alfa-business-csv/alfa-business-csv.format.test.ts:22,29,64-65,198 | Same. | Drop. | S | |
| U2 | src/statement-import/formats/business-csv/business-csv.ts:2,4,36,59-63 | "Controller ruling 1", "Task 5/Task 3 review". | Drop. | S | |
| U2 | src/statement-import/formats/business-csv/csv-row.ts:1,27,30,43,55,71 | "Phase 4", "Task 5 review", "ruling 3". | Drop. | S | |
| U2 | src/statement-import/formats/business-csv/column-base.ts:6-7 | "jscpd flagged…Task 5 review". | Drop. | S | |
| U2 | src/statement-import/column-mapping/apply-column-mapping.ts:19,83,87,190,219,267,270,272-273,323 | "parity brief", "ruling I1", "commit B", "follow-up I1". | Drop. | S | |
| U2 | src/statement-import/column-mapping/apply-column-mapping.test.ts:200,203,285,308 | "commit B", "ruling I1", "the review's own reproduction". | Drop. | S | |
| U2 | src/statement-import/column-mapping/amount.ts:15 | "Review Focus 1". | Drop. | S | |
| U2 | src/statement-import/column-mapping/amount.test.ts:4 | "Review Focus 1". | Drop. | S | |
| U2 | src/statement-import/column-mapping/table-rows.ts:73 | "P0 Review Focus 3". | Drop. | S | |
| U2 | src/statement-import/column-mapping/saved-mapping.ts:3 | "Review Focus 3". | Drop. | S | |
| U2 | src/statement-import/column-mapping/date-formats.ts:90-95 | "F4 item 8", plus history ("used to show"). | Keep only the WHY (unambiguous day > 12). | S | feat-refactor |
| U2 | src/statement-import/column-mapping/date-formats.test.ts:17 | "F4 item 8". | Drop. | S | feat-refactor |
| U2 | src/statement-import/column-mapping/parity.test.ts:1,158 | "Review Focus 2". | Drop. | S | |
| U2 | src/statement-import/import-statement/import-statement.ts:13,16,21,36,39 | "section C.1/A.4", "Task 3 review", "F4 item 9", "T1-T2 brief". | Drop. | S | feat-refactor |
| U2 | src/statement-import/import-statement/import-statement.test.ts:19,52,81,292-297 | "Task 3", plus history ("used to key…under the old code"). | Drop. | S | feat-refactor |
| U2 | src/statement-import/mapping/mapping.ts:11 | "section A.3". | Drop. | S | |
| U2 | src/statement-import/mapping/mapping.test.ts:83 | "Phase 2/Task 3", "section C.1". | Drop. | S | |
| U2 | src/statement-import/parse-date-time/parse-date-time.ts:7,12-14 | "section C.1", "Task 3 review", "Phase 4". | Drop. | S | |
| U2 | src/statement-import/read-statement-file/read-statement-file.ts:46,92,135,144-151,173,192 | "N1/M8 (F3 part 1 fix round 1/2)", "item 6's fix", "before this fix", "task brief". | Keep the WHY (percent-encoded file URL, plaintext copy). | S | |
| U2 | src/statement-import/read-statement-file/read-statement-file.test.ts:30,60,89 | Same ids. | Drop. | S | |
| U2 | src/bank-sync/bank-catalog/bank-catalog.ts:4-5,12,47,52,58,148,157 | "device-feedback-round-1 item 3", "P3", "T17", "round-4 item 4". | Drop. | S | |
| U2 | src/bank-sync/provider-catalog/provider-catalog.ts:39-43 | History of removed providers. | One WHY line (5.6: removed, not hidden). | S | |
| U2 | src/bank-sync/provider/provider.ts:8-13 | Same history. | Same. | S | |
| U2 | src/bank-sync/registry/registry.ts:33-36 | Same history. | Same. | S | |
| U2 | src/crypto-sync/sync/sync.ts:50,79 | "Task 5.2". | Drop. | S | |
| U2 | src/crypto-sync/sync/sync.test.ts:236 | "Task 5.2". | Drop. | S | |
| U2 | src/crypto-sync/binance/binance.transactions.ts:184,222 | "item 12". | Drop. | S | |
| U2 | src/crypto-sync/binance/binance.transactions.test.ts:96,309 | "Phase 6 / Risk R-1". | Drop. | S | |
| U2 | src/crypto-sync/binance/binance.credentials.ts:5-7,35,124-128 | Date "(2026-09-11)", "used to carry", "used to run". | Drop. | S | |
| U2 | src/crypto-sync/binance/migrate-binance-credential.ts:8,13-15 | Date; cites agent memory files ("memory: crash-safe-migration-ordering"). | State the rule inline. | S | |
| U2 | src/monobank/migrate-credential/migrate-credential.ts:8,13-15 | Same. | Same. | S | |
| U2 | src/monobank/token/token.ts:4-6 | "Historically…(2026-09-11)". | Drop. | S | |
| U2 | src/monobank/throttle/throttle.ts:6-10 | "The throttle used to be…". | State only the WHY (per-token limit). | S | |
| U2 | src/monobank/sync-status/sync-status.ts:227 | "was previously bound". | Drop. | S | |
| U2 | src/monobank/sync/sync.ts:250,311,345-347,433-434,987,1143-1146,1186,1207,1240-1244 | "Phase 6/3/1", "since T-16", "the previous behaviour", "old fail-fast loop", "BUG A fix 1", "R6-1". | Drop. | S | |
| U2 | src/monobank/sync/sync.test.ts:30,305,505,790,1004,1221,1305,1370,1538,1688 | "Phase 6", "T32", "BUG1", "R7/R6-3", "round 4-D", "R6-1". | Drop. | S | |
| U2 | src/sync/settle-limited/settle-limited.ts:8-9 | "multi-account plan, Phase 3". | Drop. | S | |
| U2 | src/sync/use-sync/use-sync.ts:41-42 | "this is the old `finally` block". | Drop. | S | |
| U2 | src/sync/use-auto-sync/use-auto-sync.test.ts:183,224-230 | "used to be", "Item A (whole-branch review)". | Drop. | S | |
| U3 | src/statement-import/mapping/mapping.ts:59 | `mcc !== undefined ? categoryForMcc(mcc) : null`. | `foldMap(maybe(mcc), categoryForMcc)`, folded to null. | S | |
| U3 | src/statement-import/formats/monobank-csv/monobank-csv.format.ts:47,65 | `x ? f(x) : null`; `absent ? undefined : Number(raw)`. | maybe/fmap. | S | |
| U3 | src/statement-import/formats/sensebank-csv/sensebank-csv.format.ts:160 | `raw ? Number(raw) : undefined`. | maybe/fmap. | S | |
| U3 | src/statement-import/formats/privatbank-xlsx/privatbank-xlsx.format.ts:59 | `v === null \|\| v === undefined ? '' : String(v)`. | One shared maybe-fold helper (see the cellText G2 row). | S | |
| U3 | src/statement-import/column-mapping/apply-column-mapping.ts:48,62 | Nullable ternaries. | maybe/fold. | S | |
| U3 | src/statement-import/column-mapping/table-rows.ts:35 | `value === null ? '' : String(value)`. | Same helper. | S | |
| U3 | src/statement-import/column-mapping/date-formats.ts:118 | `match ? toSeconds(match) : undefined`. | foldMap. | S | feat-refactor |
| U3 | src/statement-import/column-mapping/saved-mapping.ts:58,65 | `x ? {…x} : undefined`. | fmap. | S | |
| U3 | src/bank-sync/bank-catalog/bank-catalog.ts:143-145,154,164-166 | `isBankId(id) ? find()?.f : default`. | See the U5 row for bank-catalog. | S | |
| U3 | src/monobank/token/token.ts:63 | `credentials ? credentials.password : undefined`. | fmap. | S | |
| U3 | src/monobank/client/monobank.client.ts:83 | `header ? parseInt : NaN`. | maybe fold. | S | |
| U3 | src/sync/use-auto-sync/use-auto-sync.ts:73,108-109 | `entry ? entry.hasCredentials(...) : true`; `id === undefined ? [] : await …`. | maybe fold. | S | |
| U4 | src/statement-import/read-statement-file/read-statement-file.ts:118-128,163-170,200-204 | Hand-rolled try/catch-to-result in the data layer. | `either`/`eitherSync` plus `bifold`. | S | |
| U4 | src/crypto-sync/binance/binance.provider.ts:201-213 | `walletSatoshis` is try/catch → null. | `either(satoshis)` plus `bifold`; the log stays in the left branch. | S | |
| U4 | src/monobank/sync/sync.ts:1129-1152 | Per-card try/catch plus manual `Error` normalization. | `either` plus two-arg `first(result, toError)` (skill §fnts). | S | |
| U4 | src/crypto-sync/binance/binance.client.ts:31-33 | `isRight(x) ? bifold(x) : undefined` is a hand-rolled fold. | Two-handler `bifold`. | S | |
| U4 | src/crypto-sync/binance/binance.credentials.ts:115-116 | Same pattern. | Same fix. | S | |
| U5 | src/crypto-sync/disconnect/disconnect.ts:24 | `providerId === 'binance'` over a closed union. | `match(providerId).exhaustive()` (resync-request.ts does it right). | S | |
| U5 | src/statement-import/column-mapping/apply-column-mapping.ts:58-61,89,162-167,250-263,320 | Repeated `mode ===` checks; if-chain over the orientation union. | `match(mapping.amount/currency/orientation).exhaustive()`. | S | |
| U5 | src/statement-import/read-statement-file/read-statement-file.ts:141 | Ternary over the `'utf-8' \| 'windows-1251'` union. | `Record<Encoding, (bytes) => string>`. | S | |
| U5 | src/bank-sync/bank-catalog/bank-catalog.ts:20-31,63-130,140-166 | The `bankIds` tuple and the `bankCatalog` array are two sources of truth: an id without an entry compiles. Three `find` lookups. | `Record<BankId, Entry>`; lookups become a plain index. | M | |
| U6 | src/monobank/currency-code/currency-code.ts:5-114,116-end | Two 107-arm `match` chains for one mapping; the numeric side cannot be exhaustive anyway. | One `[code, currency]` table, with both directions derived from it. | M | |
| U6 | src/monobank/sync/sync.ts:217-224,1037-1047 | The same `sync_state` row is read three times. | Read once into a `SyncStateSnapshot`. | S | |
| U7 | src/statement-import/formats/business-csv/business-csv.ts, csv-row.ts, column-base.ts | The only formats folder with no tests. | Add unit tests next to them, like every sibling format folder. | S | |
| U7 | src/statement-import/formats/{monobank-csv,sensebank-csv,privatbank-xlsx}/*.format.test.ts | Each hand-rolls fixture loading with `readFileSync`; ProCredit, Ukrsib and Alfa use format-test-fixtures. | Add an XLSX loader to the shared fixtures module and use it everywhere. | S | |
| U7 | src/statement-import/formats/privatbank-xlsx/privatbank-xlsx.format.ts:26-54; sensebank-csv.format.ts:28-77 | Export `COLUMN` and other internals; monobank-csv keeps them private. Inconsistent export surface. | Pick one rule: export only what a test pins. | S | |
| U7 | src/crypto-sync/binance/binance.client.test.ts:15-26 | Inline payloads; the Monobank client tests use `__fixtures__/*.json`. | Move to `binance/__fixtures__/`. | S | |
| U8 | src/crypto-sync/binance/ | Flat dump of 6 units and 6 tests with dotted names, no barrel. Diverges from monobank/'s folder-per-thing layout (U7). | `binance/client/`, `credentials/`, `hmac/`, `provider/`, `transactions/`, `migrate-credential/`, each with an index.ts, as src/monobank/ does. | M | |
| U8 | src/crypto-sync/btc-wallet/ | Same flat layout (3 units). | Folder per unit. | S | |
| U8 | src/crypto-sync/resync-request.ts | Loose file at the root, no test. | `resync-request/` with a test. | S | |
| U8 | src/statement-import/formats/format-test-fixtures.ts | Test helper sits loose among the format folders. | Move to `formats/__fixtures__/` or src/test-support/. | S | |
| U8 | src/statement-import/column-mapping/ | Flat folder: 5 units and 6 tests. | One folder per unit (amount/, apply-column-mapping/, date-formats/, saved-mapping/, table-rows/). | M | feat-refactor (date-formats) |
| U8 | src/statement-import/column-mapping/parity.test.ts | Tests the whole import pipeline, not column mapping. | Move next to import-statement/. | S | |
| U8 | src/statement-import/formats/sensebank-csv/cp1251-decode.test.ts | Tests decoding, not Sensebank. | Next to read-statement-file (see the G7 row). | S | |
| G1 | src/crypto-sync/binance/binance.credentials.ts:49-60,78,122-131 | Dead repair path. Per-account items exist only since 2026-09-11, the hardened policy since 2026-09-07 (git), so no per-account item can carry `BIOMETRY_CURRENT_SET`. It re-writes the secret once per process for nothing. | Delete the latch and the repair; `readCredentials` becomes pure like `readToken`. | S | |
| G1 | src/bank-sync/provider-catalog/provider-catalog.ts:4,7,25-28,36 | `connectionMethod`, `shape`, `coverage` and `dataProvidedKey` are never read (add-bank-sheet renders only about and eligibility). | Delete them, or render the dataProvided copy. | S | USER-DECISION: show "data provided" or drop it |
| G1 | src/bank-sync/registry/registry.ts:10,41 | The `catalog` field is never read. | Delete. | S | |
| G1 | src/bank-sync/provider/provider.ts:19-25 | Multi-bank `:` split for providers that do not exist. | Keep or drop per the registry-generality decision. | S | USER-DECISION |
| G1 | src/monobank/sync-status/sync-status.ts:25,44,46,87,113 | `setSyncing`, `setSyncProgress` and `getSnapshot` are exported for tests only; they let a caller bypass the session. Stale docs at 46 ("Monobank sync") and 113 (`{completed,total}`). | Make them non-exported, test through the session API, fix the docs. | S | |
| G1 | src/statement-import/column-mapping/apply-column-mapping.ts:167,191 | The `-1` branch is unreachable (currency is undefined only in column mode). The comment says Monobank exports newest-first, but the fixture is oldest-first. | `match` the mode. Fix the comment. | S | |
| G1 | src/monobank/sync/sync.ts:319,351,535,760-765,902,1008-1012,1147,1227 | `importAccount` re-queries the holdings per card, although `card.holding` is known. Stale names (`upsertHoldings`, `addTransactions`) and paths. The 1008-1012 comment ("needs no new column") contradicts the `syncedBalanceMinorUnits` marker. | Pass `card.holding`. Fix names and paths. Rewrite the comment. | S | |
| G1 | src/crypto-sync/sync/sync.ts:17,48,58,97-103,105-106,111,119-124,159 | Orphan JSDoc (97-103). "One connection per provider" and "one global lock like Monobank" are both now false. Stale paths. | Rewrite the comments. | S | |
| G1 | src/sync/use-sync-all/use-sync-all.ts:53-59 | Claims an app-open auto-sync joins this lock; `useAutoSync` never calls `runSyncAllOnce`. Stale path. | See the G2 row for use-auto-sync. Fix the path. | S | |
| G1 | src/sync-state/sync-state.repo.ts:35,61 | Stale path `monobank/sync.ts`. | Fix. | S | |
| G1 | src/crypto-sync/binance/binance.transactions.ts:348 | Stale path. | Fix. | S | |
| G1 | src/crypto-sync/binance/migrate-binance-credential.ts:16 | Stale path. | Fix. | S | |
| G1 | src/crypto-sync/disconnect/disconnect.ts:8 | Stale path. | Fix. | S | |
| G1 | src/monobank/sync/sync.test.ts:1-4,470 | Header describes a stub that does not exist in the file. Stale path. | Delete or fix. | S | |
| G1 | src/crypto-sync/sync/sync.test.ts:412 | Stale path. | Fix. | S | |
| G1 | src/crypto-sync/binance/binance.credentials.test.ts:10 | Stale path `src/monobank/token.test.ts`. | Fix. | S | |
| G1 | src/sync/use-auto-sync/use-auto-sync.test.ts:224-230 | Dangling comment with no test under it. | Delete. | S | |
| G1 | src/statement-import/formats/sensebank-csv/cp1251-decode.test.ts:5 | "the screen's forthcoming…fallback" never landed; the encoding is picked explicitly. | Fix the comment. | S | |
| G2 | src/statement-import/formats/monobank-csv/monobank-csv.format.ts:70-78; sensebank-csv.format.ts:79-80,144-155 vs formats/business-csv/csv-row.ts:22-23,58-66; business-csv.ts:75-79 | The NaN-guarded amount parse, the debit+credit guard and the `;` Papa reader are each written 2-3 times. | Move csv-row helpers to `formats/shared/` and use them in all six formats. | M | |
| G2 | src/statement-import/formats/sensebank-csv/sensebank-csv.format.ts:111-129; parse-date-time/parse-date-time.ts:16-35 vs column-mapping/date-formats.ts:31-65 | The same date shapes are parsed twice. | Formats call `parseDateWithFormat` presets (throw on undefined). | M | feat-refactor |
| G2 | src/statement-import/formats/privatbank-xlsx/privatbank-xlsx.format.ts:59; column-mapping/apply-column-mapping.ts:48; column-mapping/table-rows.ts:35 | Three `cellText` helpers. | One shared helper. | S | |
| G2 | src/statement-import/read-statement-file/read-statement-file.ts:19-84 vs src/data-transfer/base64/base64.ts:45-72, src/data-transfer/utf8/utf8.ts:52-85 | A second hand-rolled base64/UTF-8 codec. | Reuse `utf8Decode`; keep only the lenient base64 variant, or add a lenient flag to the shared one. | S | |
| G2 | src/statement-import/mapping/mapping.ts:15-21; src/monobank/sync/sync.ts:26-32; src/crypto-sync/binance/binance.transactions.ts:78-85 | Three hand-written "new transaction row" types. | Export one `NewTransaction` from the transactions repo. | S | |
| G2 | src/monobank/migrate-credential/migrate-credential.ts:35-69 vs src/crypto-sync/binance/migrate-binance-credential.ts:36-70; token.ts:19,39 vs binance.credentials.ts:20,44 | Line-for-line identical migration; duplicated `serviceFor`/`hardenedFor`. | One `migrateGlobalSecretToPerAccount(globalService, serviceFor)` plus a shared keychain-policy module. | S | |
| G2 | src/monobank/sync/sync.ts:936-974; src/crypto-sync/sync/sync.ts:128-151; src/crypto-sync/run-crypto-sync/run-crypto-sync.ts:48-66; src/sync/use-sync-all/use-sync-all.ts:64-79 | Four copies of the single-flight join/release lock. | One `singleFlight(map, key, start)` helper. | S | |
| G2 | src/sync/use-sync/use-sync.ts:54-57 vs use-sync-all.ts:43-47, use-auto-sync.ts:131-145 | `useSyncAction` refreshes rates but not metal prices (divergent twin). `useAutoSync` copies `fanOutAndRefresh` and skips `runSyncAllOnce`. | One shared `refreshAfterSync()`. `useAutoSync` calls `runSyncAllOnce(jobs)`. | S | |
| G2 | src/crypto-sync/binance/binance.provider.ts:216-225; binance.transactions.ts:323-327 | Two casts of `metadata.binanceAsset`. | Add `binanceAssetOf` to src/holdings/holding-metadata, like `walletAddressOf`. | S | |
| G2 | src/crypto-sync/binance/binance.provider.ts:114-191 | `hasBalances`/`hasRows` and three near-identical filter-validate-sum parsers. | One `sumBTCRows(rows, fields)`. | S | |
| G2 | src/monobank/currency-code/currency-code.ts:5-114 vs 116-end | Two hand-kept inverse tables (consistent today, 107 each). | Derive both from one table (see the U6 row). | S | |
| G2 | src/monobank/sync-status/sync-status.ts:19-47,71-115,239-262 | Three hand-rolled listener stores. | One `createSignal<T>()`. | S | |
| G2 | src/monobank/sync/sync.ts:553-558 vs 589-594 | Inline context type duplicates `SkipContext`. | Use `SkipContext`. | S | |
| G2 | src/crypto-sync/sync/sync.ts:181-197 vs src/monobank/sync/sync.ts:384-420 | Crypto upserts each holding in its own transaction; Monobank batches to avoid a reactive burst. | Batch upsert, like `upsertMonobankMany`. | S | |
| G3 | src/crypto-sync/binance/binance.client.ts:13 | `FetchAccountOptions` is used by every Binance request. | `BinanceRequestOptions`. | S | |
| G3 | src/monobank/sync/sync.ts:129,571-589 | `SyncSyncStateRepo` stutters. The `orderStatementQueue` JSDoc sits on `type SkipContext`. | Rename. Move the doc. | S | |
| G3 | src/crypto-sync/binance/binance.transactions.ts:329 | Private `runSync` shadows Monobank's `runSync` concept. | `importHistory`. | S | |
| G3 | src/statement-import/column-mapping/table-rows.ts:41; formats/business-csv/csv-row.ts:22 | Two `readCsvRows` with different signatures. | Rename, or merge per the G2 row. | S | |
| G4 | src/monobank/sync/sync.ts:976-1248 | `runSyncInner` mixes target and token, snapshot, planning, progress registration, fetch loop, diagnostics, and four end-of-run persists. The file is 1248 lines. | Split into `plan.ts` (queue/skip/windows), `progress.ts`, `finish-run.ts` (stamp/failed-set/graduate/reconcile/cursor). | L | |
| G4 | src/statement-import/column-mapping/apply-column-mapping.ts:187-297 | Row resolution and closing-balance picking in one 367-line file. | Move closing balance to its own unit (see the BUG G2 row). | M | |
| G4 | src/monobank/sync-status/sync-status.ts | Three stores plus the session in one module. | Split (see the U1 row). | M | |
| G5 | src/statement-import/mapping/mapping.ts:3 | Generic MCC categorization is imported from `monobank/`; statistics and categories use it too. | Move mcc-category to src/categories/ or src/transactions/. | S | |
| G5 | src/crypto-sync/sync/sync.ts:6-12 | Crypto depends on `monobank/sync-status`, which is app-wide. | Move sync-status to src/sync/. | S | |
| G5 | src/crypto-sync/binance/binance.transactions.ts:6 | Imports `monobank/throttle`, a generic gate. | Move throttle to src/sync/. | S | |
| G5 | src/statement-import/column-mapping/apply-column-mapping.ts:10 | Column mapping imports `CURRENCY_WORD_MAP` from the PrivatBank format. | Move the map to src/currency/ (or `formats/shared`). | S | |
| G7 | src/statement-import/import-statement/import-statement.test.ts:85-262 | Hand-rolled fake tx: dispatches on projected fields, returns `[]` for unknown tables (M-fake-db-masks-bugs). `MONOBANK_HEADER` and the fixture reads duplicate monobank-csv.format.test.ts:21 and format-test-fixtures. | A shared fake tx in src/test-support that throws on unknown tables; reuse `monobankFixtureInput`. | M | feat-refactor |
| G7 | src/statement-import/column-mapping/parity.test.ts:47-262 | A second copy of the same fake tx and the XLSX loader. | Same shared fake. | M | |
| G7 | src/sync-state/sync-state.repo.test.ts:21-60 | Fake tx parses drizzle `queryChunks`, so the test depends on ORM internals. | Shared fake tx keyed by table and account id. | S | |
| G7 | src/monobank/token/token.test.ts:21-40; migrate-credential.test.ts:13-38; src/crypto-sync/binance/migrate-binance-credential.test.ts:12-37; binance.credentials.test.ts:17-40 | Four copies of one service-keyed Keychain mock. | `__mocks__/react-native-keychain.ts` (react-native-svg.tsx is the precedent). | S | |
| G7 | src/monobank/sync/sync.test.ts:151-380; src/crypto-sync/sync/sync.test.ts:22-80 | Duplicated `AccountRow` factories and in-memory repo doubles; test re-implements `monobankIdOf`. | Shared factories in src/test-support. | M | |
| G7 | src/sync/use-auto-sync/use-auto-sync.test.ts:16-26 | The mock re-implements the `syncJobsFor` routing logic. | Mock the runners, or use the real `syncJobsFor`. | S | |
| G7 | src/statement-import/registry/registry.test.ts:13-17 | Re-reads the Monobank fixture although `monobankFixtureInput` exists. | Import it. | S | |
| G7 | src/statement-import/formats/sensebank-csv/cp1251-decode.test.ts:17-45 | Tests the third-party `windows-1251` library, not Kiko code. | Test `decodeStatementText(base64, 'windows-1251')` in read-statement-file.test. | S | |
| M-file-structure-colocation | src/sync/use-auto-sync/use-auto-sync.ts:1-10; src/sync/use-sync/use-sync.ts:1-6; src/sync/use-sync-all/use-sync-all.ts:1-6; src/monobank/sync/sync.ts:1-7; src/crypto-sync/sync/sync.ts:1-12; src/crypto-sync/binance/binance.transactions.ts:1-6; src/sync-state/sync-state.repo.ts:1-5 | Mixes `@kiko/*` aliases with cross-feature `../../` imports in one block. | `@kiko/*` for every cross-feature import. | S | |


### R9 — Data-transfer, auth, navigation, i18n, settings, test-support, root files and mocks

Rows are ranked: correctness, then compliance, then conventions, then general issues.

| Rule | file:line | What is wrong | Fix (the existing pattern or rule to apply, name a file that already does it right when one exists) | Effort (S/M/L) | Tags |
|---|---|---|---|---|---|
| S-I18N | src/auth/biometrics.ts:130-131 | The native Face ID sheet labels are hardcoded English: `cancelLabel: 'Cancel'`, `fallbackLabel: 'Use Passcode'`. A uk user sees English in the system sheet. "Use Passcode" is also Title Case on a button. biometrics.test.ts:80-85 pins these literals. | Pass the labels in from `use-app-lock.ts:61` as `t('common.cancel')` and `t('auth.usePasscode')`. This is the same pattern as `title: prompt`. Update the test. Changes behavior. | S | |
| G6 | src/data-transfer/import-data.ts:147-148 | `restoreDataSnapshot` commits the full REPLACE before `restoreExportSecrets` runs. Scenario: a Keychain `saveToken` throws. `importData` then rejects, and the screen shows "Import failed" although every table was already replaced. `languageRestored` is never applied. | Restore secrets first (Keychain items are keyed by account id, so they are harmless if the DB restore then fails). Or capture the secrets step with `either` and return a partial-success flag. Changes behavior. | M | |
| G2 | src/data-transfer/import-data.ts:147 + secrets/restore-secrets.ts:27 | The REPLACE import deletes every account row but never clears the Keychain token or credentials of the replaced accounts. Its twin `crypto-sync/disconnect/disconnect.ts:25` does clear them (`clearCredentials`, `clearToken`). Scenario: a connected Monobank user imports another device's export. The old token stays in the Keychain forever. | Before the restore, clear the secrets of every monobank/binance account id that is not in `payload.tables.accounts`. Changes behavior. | M | |
| S-I18N | src/i18n/locales/en.ts:653-659, 642-646; uk.ts:572-575, 588 | The trend "Filters" button renders "3 Categories" and "Top 3 by Contribution". The measure chip labels are interpolated mid-sentence, so a Title Case word sits inside a sentence-case button. uk renders "Топ 3 за Внеском", which breaks uk sentence case. | en: `'{{count}} category'`/`'{{count}} categories'`. Give the button its own lowercase measure keys (`button.measure.*`: 'contribution' / 'внеском') instead of reusing the chip keys. Changes copy. | S | |
| S-I18N | src/i18n/locales/en.ts:567 | `holdingDetail.nextInstallment` is a SummaryTable `title`, which renders as a heading (`summary-table.component.tsx:22`). It is written in sentence case and is not in TITLE_KEYS. | `'Next Installment ({{date}})'`, and add the key to `title-keys.ts`. Changes copy. | S | |
| S-I18N | src/navigation/settings.stack.tsx:33,38 | `settings.system` and `settings.categories` serve two roles: the Settings row label (settings.screen.tsx:165,231) and the nav title. One key covers both, and neither is in TITLE_KEYS. | Split them the way `settings.dataExport.title` / `rowLabel` are split. Add the title keys to `title-keys.ts`. | S | |
| U10-stop | src/i18n/locales/en.ts:500, 514-516, 525-526, 869-874; uk.ts:457, 469-471, 480-481, 694-699 | Error strings have no final ".": `invalidToken`, `invalidApiKeyOrSecret`, `invalidBTCAddress`, `couldNotSaveCredentials` (field status errors), `noConnectionFound`, `noMonobankConnection` (thrown errors), and `columnMapping.rowError.*`. Their sibling `noMonobankToken` has one. | Add "." in both catalogues, following the rule in kiko-translator "Final . always … errors". Changes copy. | S | |
| U10-stop | src/i18n/locales/en.ts:208, 765; uk.ts:184, 640 | `bankColumnMappingOnly` is the same BankTypeField caption role as `bankConnectable`/`bankImportOnly` (both end in ".") but has no ".". `skippedWrongCurrencyCodes` is a "Label: {{value}}" string, which takes no final ".", but it has one. | Add "." to the first; drop it from the second. | S | feat-refactor |
| S-I18N | src/i18n/locales/uk.ts:137, 461, 464, 465 | The apostrophe is U+02BC (ʼ), not the required U+2019 (’). `uk.catalog-rules.test.ts:15` only catches ASCII `'`, so these pass. | Replace with ’. Extend the regex to `['ʼ]`. | S | |
| U6 | src/i18n/locales/uk.ts:583 vs 20; 438/442/469/485 vs 446; 705 vs 587/634/639 | uk wording is inconsistent: 'Всі' vs 'Усі'; 'API ключ' vs 'API-ключ'; plural `_other` 'рядка' vs 'рядки'. | Pick one form of each. | S | |
| S-I18N | src/i18n/locales/title-keys.ts:21-63 | Heading and title keys are missing from TITLE_KEYS (found by call site): `accountDetail.synchronization`, `accounts.debtsSection`, `auth.locked`, `columnMapping.result`, `forms.holding.contributions/details/terms`, `holdingDetail.nextInstallment`, `accountDetail.disconnectProvider`, `common.deleteNamed`. The casing test checks them as sentence case. | Add them. | S | |
| S-I18N | src/i18n/locales/en.casing-by-role.test.ts:101, 133 | Blind spot in the check: interpolations are blanked to spaces, so a capitalized word right after a leading `{{count}}` counts as a sentence start. "{{count}} Category" passes. | Replace each interpolation with a lowercase placeholder token such as `x`. | S | |
| S-COMPL 5.6 | src/auth/use-app-lock.ts:40, 53, 71 (+ lock-gate.component.tsx:45-48, screens/settings/system/system.screen.tsx:55) | `APP_LOCK_ENABLED` is a build flag that decides whether the App Lock card and the lock screen exist. The kiko-architecture "5.6" section bans any build flag that gates visibility, but its "app lock (always on)" section sanctions this one. The pod is installed, and the lazy `require` (biometrics.ts:12) already keeps the native module off the import path. | Either remove the flag, its OFF branches, and the 3 "disabled/off" tests, or keep it and write the exemption into the 5.6 section. | M | USER-DECISION |
| S-COMPL 5.1.1/5.1.5 | src/data-transfer/secrets/read-secrets.ts:16, 38; payload.d.ts:5-12 | Every "include secrets" export carries the device's SQLCipher master key (`dbKeyHex`). Nothing reads or shows it (grep: payload, read, and a comment only). The toggle copy (en.ts:68-70) names only the Monobank token and Binance keys, so the DB key leaves the Keychain undisclosed. | Stop reading and writing `dbKeyHex`; keep the field optional and ignored for legacy files. Or disclose it and show it. Changes behavior. | S | USER-DECISION |
| M-import-ordering-length-sort | App.tsx:10, 12, 16, 18, 19 | Within-group length sort is broken. | Re-sort each group by the length of its ending line. | S | |
| M-import-ordering-length-sort | src/auth/biometrics.ts:2; use-app-lock.ts:2-3; lock-gate/lock-gate.component.tsx:2, 4, 9-11 | Groups 1 and 2 are not length-sorted (lock-gate should run `../use-app-lock` → `../biometrics` → box, button, text, symbol). | Re-sort. | S | |
| M-import-ordering-length-sort | src/data-transfer/export-data.ts:11; import-data.ts:13; secrets/read-secrets.ts:1-6; secrets/restore-secrets.ts:1-4; snapshot/read-snapshot.ts:4-17 | `./utf8/utf8` should come first in group 3. In read/restore-secrets, the `../**` group is split into two blocks, both sorted descending. In read-snapshot, the wrapped schema import (`} from '../../db/schema';`, 25 chars) should come first. | Re-sort; make one `../**` block. | S | |
| M-import-ordering-length-sort | src/i18n/index.ts:5; active-locale/active-locale.ts:4; use-sync-language-with-settings/use-sync-language-with-settings.ts:2, 5; src/settings/settings.repo.ts:2, 5-6 | Not length-sorted (the `@kiko/*` alias belongs to group 1 and must be sorted there). | Re-sort. | S | |
| M-import-ordering-length-sort | src/navigation/accounts.stack.tsx:2, 6, 9-11, 13, 18; home.stack.tsx:2, 5, 8; statistics.stack.tsx:2, 8; settings.stack.tsx:2, 8-9, 12; root.navigator.tsx:2, 9, 12; use-scroll-to-top-on-tab-press.ts:2, 10 | `react` comes after longer lines; the screen imports are unsorted; `./types` comes last although it is shorter. | Re-sort. | S | |
| M-import-ordering-length-sort | Tests: lock-gate.component.test.tsx:2; lock-gate.native-throw.test.tsx:2; use-app-lock(.disabled).test.ts:2; import-data.test.ts:17, 19; round-trip.test.ts:4-7; crypto/envelope.test.ts:4; snapshot/restore-snapshot.test.ts:23-25; navigation/*.stack.test.tsx:2; use-scroll-to-top-on-tab-press.test.tsx:2, 11; root.navigator.test.tsx:11-15; __tests__/App.test.tsx:6; info-plist.test.ts:2; mutation-*.test.ts:2-3; `__mocks__/@react-native-community/datetimepicker.tsx:14` | Same drift. In restore-snapshot.test, group 3 is glued to group 2 and then split. In root.navigator.test, a side-effect import is wedged between two `./` imports. | Re-sort. Keep side-effect barriers in place. | S | |
| S-STYLE | src/data-transfer/snapshot/restore-snapshot.ts:48, 135, 138, 147, 150, 159, 162, 165; secrets/read-secrets.ts:19, 21, 27, 29; src/navigation/use-scroll-to-top-on-tab-press.ts:99, 104, 109 | No blank line before `if`/`for`/`return`. | Add the blank line (kiko-code-style "Blank lines before statement blocks"). | S | |
| S-STYLE | Tests/harness: restore-snapshot.test.ts (22 sites, e.g. 29-38, 65, 72); settings.repo.test.ts:7, 69, 72; use-scroll-to-top-on-tab-press.test.tsx:55, 92, 94, 151, 177; reset-tab-stack-on-blur.test.ts:19; import-data.test.ts:40; use-app-lock.disabled.test.ts:67; restore-legacy-balance-set-at.test.ts:18; jest/setup.js:10, 42, 50, 80, 96; jest/reanimated-mock.js:36, 39; `__mocks__/@bottom-tabs/react-navigation.tsx:97`; __tests__/App.test.tsx:50; mutation-*.test.ts (8 sites) | Same rule. | Add blank lines. | S | |
| S-STYLE | src/navigation/home.stack.tsx:19; src/test-support/mock-text-tone.tsx:9 | The component uses an implicit arrow return. | Use an explicit `return` (as `statistics.stack.tsx:13` does). | S | |
| S-STYLE / U7 | src/auth/lock-gate/lock-gate.component.tsx (folder); App.tsx:14 | kiko-code-style says the lock gate is a `.gate.tsx`. Its sibling `migration/migrations-gate/` uses `migrations.gate.tsx` plus an `index.ts` barrel. LockGate uses `.component.tsx`, has no barrel, and App.tsx deep-imports it. | Rename to `lock.gate.tsx` and add `index.ts`, matching migrations-gate. | S | |
| S-DS / G2 | src/navigation/dark-theme.ts:18-22 | Hardcoded hex values duplicate the `design-system/theme.ts` dark tokens. The comment says "systemGroupedBackground"; the theme says "systemBackground". | Read `darkTheme.colors.background/accent/...` from `theme.ts`. | S | |
| U3 | src/navigation/reset-tab-stack-on-blur.test.ts:13 | `parentFocused === undefined ? undefined : {...}` is the banned nullable-map ternary. | `foldMap(maybe(parentFocused), (f) => ({ isFocused: () => f }))`. | S | |
| U4 | src/navigation/use-scroll-to-top-on-tab-press.ts:170-171 | A nullable-default ternary. | `Math.max(headerTarget, restingTop.current ?? headerTarget)`. | S | |
| U4 | src/data-transfer/import-data.ts:86-98, 116-145 | Four hand-rolled `let x; try {} catch { throw }` blocks. | One `eitherSync`-based `parseOr(text, message)` helper with `bifold`, as `auth/biometrics.ts:86-97` does. | M | |
| U5 | src/i18n/active-locale/active-locale.ts:10-13 | `match(... as AppLanguage \| string).otherwise` is not exhaustive over `AppLanguage`; a third language would silently map to en-US. The cast is meaningless. | `const LOCALE: Record<AppLanguage, 'en-US' \| 'uk-UA'>` plus an `appLanguages.includes` guard. | S | |
| U5 | src/data-transfer/snapshot/restore-snapshot.test.ts:27-40 | An 11-branch `if (table === x)` chain. | A `new Map([[accounts,'accounts'],…])` lookup. | S | |
| U6 | src/settings/settings.repo.ts:1, 5-6; auth/use-app-lock.ts:1, 5-6; i18n/use-sync-language-with-settings/…ts:1, 4 | One file mixes the `@kiko/db/…` alias and `../db/…` relative paths for the same module tree. | Pick one per file; the memory rule says `@kiko/*` for cross-feature imports. | S | |
| U6 | src/navigation/accounts/settings/statistics.stack.test.tsx:1-2; statement-import-return.navigator.test.tsx:5-6 | Two imports from the same module (value and type). | Merge them with an inline `type`. | S | |
| U6 | App.tsx:29 vs 41 | `const AppRoot: FC` sits next to `export default function App(): React.JSX.Element`. | Use one component idiom. | S | |
| U8 | src/navigation/ (17 loose files) | Stacks, hooks, helpers, theme, types, and their tests are all flat. | Give `use-scroll-to-top-on-tab-press/`, `reset-tab-stack-on-blur/`, and each stack its own folder. | M | USER-DECISION |
| U8 | src/auth/biometrics.ts, use-app-lock.ts (+3 tests); src/data-transfer/export-data.ts, import-data.ts, round-trip.test.ts | These are loose, while their siblings (`lock-gate/`, `crypto/`, `snapshot/`) are foldered. | Move each into its own folder. | S | |
| U8 | __tests__/mutation-*.test.ts, info-plist.test.ts; src/i18n/locales/title-keys.ts, flatten-catalog.ts | Harness-script tests sit in an app-level flat folder. Test-only helpers sit inside the shipped `locales/`. | Move them next to `scripts/checks/` and into `src/test-support/` (check the knip/jest config). | M | |
| U2 | src/data-transfer/export-data.ts:13-15; import-data.ts:15-17; snapshot/restore-snapshot.ts:1, 96, 165-166, 172-174; read-snapshot.ts:1; data-snapshot.d.ts:1; payload.d.ts:1; utf8/utf8.ts:47-50 | Task ids ("Task 12/13", "T11", "T24"), history ("used to make"), and path-header comments. | Keep only the WHY. Delete the path headers. | S | |
| U2 | src/data-transfer/snapshot/restore-snapshot.test.ts:1, 159, 219 (test name), 230, 241-249, 270-271, 282, 313; restore-legacy-balance-set-at.test.ts:1-3; snapshot-covers-every-table.test.ts:1, 3; read-snapshot.test.ts:1; export-data.test.ts:90-93 | "C1 (T29 review round 1)", "pre-T24", "FIX-restore-backfill-brief.md", "Invariant #15", "the old fixed 2000-row chunk". | Rewrite as WHY only. | S | |
| U2 | src/auth/biometrics.ts:72-73; use-app-lock.test.ts:35-37; lock-gate/lock-gate.native-throw.test.tsx:11 | "T-15 regression", "after the re-lock path was removed", "left the switch permanently disabled". | Rewrite. | S | |
| U2 | src/settings/settings.repo.ts:22-27 | A comment about setters that "were REMOVED". | Delete it. | S | |
| U2 | src/navigation/types.d.ts:22, 55, 63-64, 84, 91, 98, 103, 108-111, 130-131, 139-140; root.navigator.tsx:29, 50-53; use-scroll-to-top-on-tab-press.ts:84-88, 249-254 | "Bundle B", "C1, F3 part 1 fix round 1", "T6/T7/T16/T18", "device-feedback-round-1 item 5", "ponytail review", "bug B1", "TabView.tsx:477", "the previous cast-and-return", "headerHeight + 52 double-counted". | Rewrite as WHY only. | M | |
| U2 | src/navigation/root.navigator.test.tsx:31-34, 48, 67; statement-import-return.navigator.test.tsx:14-28, 59-62, 145, 204-241 (test names "item 2/15", "C1"); use-scroll-to-top-on-tab-press.test.tsx:15-16, 239-240 | Task and review ids, `file:line` citations that will go stale, history. | Rewrite. | S | |
| U2 | src/i18n/locales/en.ts:43-44, 157-159, 275-277, 300, 311, 452-453, 461-463, 553, 619-620, 670-671, 698-700, 712, 723-729, 733, 738, 749, 752, 762, 767, 771, 776, 780-781, 787, 795-797, 817-820, 826-834, 847, 857-863, 891-893 | "F3 fix round 2, M4", "T30 (spec 5/D14)", "spec §5.3", "F4 audit 16", "Task 3 review, CRITICAL fix", "device-feedback-round-F1", "used to swallow", "retired currency.ts map". | Keep only the role/WHY sentence. | M | feat-refactor |
| U2 | src/i18n/locales/uk.ts:141, 373-376, 581, 714; default-category-title/default-category-title.ts:19-22; default-category-title.test.ts:29-31 (test name) | "T30", "Full-stop DECISION (F4): rewritten…", "(CASE track, 2026-09-24)", "Item 3 report". | Rewrite. | S | |
| U2 | src/i18n/locales/title-keys.ts:1, 4-5, 10, 20; en.casing-by-role.test.ts:1, 3-4, 16-20, 32; en.final-stop-by-role.test.ts:1, 3-5, 27; uk.casing.test.ts:1, 3-4; uk.catalog-rules.test.ts:1, 3; flatten-catalog.ts:1, 5-6; en.uk.parity.test.ts:1 | Dates, "CASE fix round 1/5", "ponytail L43/L25", "Invariant #17", and `.superpowers/sdd/...` paths that do not exist in the repo. | Delete the ids and dangling paths; keep the rule text. | S | |
| U2 | src/i18n/device-language/device-language.ts:1, device-language.test.ts:1, device-language.fallback.test.ts:1; active-locale/active-locale.test.ts:1 | Path headers that are wrong since the files moved into folders. | Delete them. | S | |
| U2 | src/test-support/navigation-props.ts:5-10, 14; mock-reanimated-scroll-to-end.ts:16, 25-26; ancestor-with-style.ts:9-11 | "C1, F3 part 1 fix round 1", "used to build … twelve files", "three tests used to copy-paste" (only 2 users exist). | Rewrite as WHY. | S | |
| U2 | jest.config.js:39; jest/reanimated-mock.js:23-26; jest/setup.js:180-182; `__mocks__/@bottom-tabs/react-navigation.tsx:43, 72-78`; `__mocks__/react-native-svg.tsx:51-52, 62`; __tests__/App.test.tsx:25-27; mutation-stream.test.ts:104-105 | "Phase 3", "Task 6", "bug B1", "item F3", "now", "no longer needs", "used to capture". | Rewrite. | S | |
| G1 | src/navigation/types.d.ts:5-10, 101-102, 126 | An orphan docblock (two docblocks in a row). `StatementImport.accountId?` is optional for a "Share Extension" that does not exist (no target in ios/; the one caller, account-detail.screen.tsx:184, always passes it). This keeps dead branches alive in statement-import.screen.tsx:317, 528, 550, 563. | Make `accountId` required and delete the dead branches. | M | |
| G1 | src/auth/use-app-lock.test.ts:8-10; use-app-lock.disabled.test.ts:8-12; lock-gate/lock-gate.disabled.test.tsx:8; lock-gate.native-throw.test.tsx:13; jest/setup.js:163-165 | Stale claims: "APP_LOCK_ENABLED defaults FALSE" (it is `true`); use-app-lock "only `import type`s" biometrics (false, `authenticate` is a value import); "same as .disabled.test's pattern" (false). | Correct or delete them. | S | |
| G1 | src/data-transfer/snapshot/restore-snapshot.ts:78; base64/base64.ts:39-40; import-data.test.ts:69 | "10 logical tables" (there are 11). The codec is cited in statement-import.screen.tsx but now lives in `statement-import/read-statement-file/read-statement-file.ts`. "See the file header comment" points at nothing. | Fix the references. | S | |
| G1 | src/navigation/{accounts,settings,statistics}.stack.test.tsx:4-7; root.navigator.test.tsx:4-10; src/i18n/locales/en.ts:691; flatten-catalog.ts:3-4; jest/setup.js:55 | Comments describe stubs that do not exist or give wrong paths. flatten-catalog's consumer list omits the final-stop test. | Fix or delete. | S | |
| G2 | src/data-transfer/base64/base64.ts:45-72, utf8/utf8.ts:52-85 vs src/statement-import/read-statement-file/read-statement-file.ts:19-81 | Twin hand-rolled base64 and UTF-8 decoders. The 4-byte decode differs (`String.fromCodePoint` vs a manual surrogate pair); base64 is strict vs lenient. | Move them to one shared codec module; the lenient caller pre-filters. | M | |
| G2 | src/i18n/locales/en.casing-by-role.test.ts:132-159 vs uk.casing.test.ts:35-59 | Twin `sentenceCaseViolations` with different sentence-start sets (`.!?:—-"` vs `.!?:—-"“”«»`). | Share one scanner, parametrized by alphabet. | S | |
| G2 | src/navigation/accounts.stack.test.tsx:16-57 vs settings.stack.test.tsx:14-50 | Identical `react-i18next` catalogue-walker mock and `titleByScreen`. | Put `mockCatalogTranslation` and `stackScreenOptions(Stack)` in src/test-support. | S | |
| G2 | src/navigation/root.navigator.tsx:29-37 vs 45-55 | The same B1 explanation appears twice. | Keep one. | S | |
| G2 | src/settings/settings.repo.ts:15-74 | `.where(eq(settings.id, SETTINGS_ID))` is repeated 7 times. | A local `updateSettings(values)` helper. | S | |
| G2 | __tests__/mutation-stream.test.ts:22-92, mutation-lock.test.ts:20-58, mutation-eta.test.ts:15-27 | `freshTmp`, `makeStub`, `run`, `Run`, and `SCRIPT` are duplicated. | A shared harness test helper. | S | |
| G3 | src/i18n/locales/en.final-stop-by-role.test.ts; __tests__/mutation-stream.test.ts:276, 325 | The file is named `en.*` but checks en and uk. `gitq` and `mkAndReturn` are unclear names. | Rename to `catalog.final-stop-by-role.test.ts`; use full names. | S | |
| G4 | src/navigation/use-scroll-to-top-on-tab-press.ts:216-379 | One hook mixes (a) expanded-header-height tracking (frame change, stale-height latch) and (b) the tabPress subscription and scroll decision. | Extract `useExpandedHeaderHeight(headerHeight)`. | M | |
| G7 | 28 test files, e.g. src/auth/use-app-lock.test.ts:22, screens/home/home.screen.test.tsx, screens/forms/*.test.tsx, i18n/use-sync-language-with-settings/…test.ts:8 | An inline `jest.mock('…/db/use-live-query')` factory is re-written in every file. | A shared `mockUseLiveQuery()` in src/test-support. | M | |
| G7 | 19 files `jest.mock('@kiko/settings/settings.repo')`, e.g. auth/*.test.ts, lock-gate/*.test.tsx, __tests__/App.test.tsx:28 | Three divergent fake shapes (`{toSQL}`, `Promise.resolve([])`, `{}`); App.test.tsx:30-37 documents a bug one shape masked. | One shared settings-repo fake that returns a real array. | S | |
| G7 | 16 repo tests, e.g. settings/settings.repo.test.ts:4-11, data-transfer/snapshot/restore-snapshot.test.ts:2-6, 62, 108, 125, 150, 192, 221, 252, 292 | The `write: (work) => work(mockTx)` mock plus hand-rolled fake tx objects. restore-snapshot.test re-inlines the same tx 8 times although it has `captureHoldingsInsert`. | A shared `mockWrite` and `recordingTx()` in test-support that throw on unknown calls (fake-db-masks-bugs). | M | |
| G7 | src/data-transfer/snapshot/restore-legacy-balance-set-at.test.ts:39-111 | A third copy of the import-tx fake (the comment says it mirrors `import-statement.test.ts` `makeImportTx` and `transactions.repo.test.ts`). It returns `[{institution:null}]` for any accounts select. | Reuse one shared import-tx fake. | M | |
| G7 | screens/account-detail/account-detail.screen.test.tsx:31-39; design-system/components/field-label/field-label.component.test.tsx:11-19; money-text.component.test.tsx:16; monobank-token-input…test.tsx:24; binance-credentials-field…test.tsx:31; date-range-field…test.tsx:17; add-category-row…test.tsx:26 | The `text-tone-${tone}` Text mock is copied inline, although `src/test-support/mock-text-tone.tsx` exists (used by home.screen.test.tsx:17). | Use MockTextTone; add an optional `tone` default. | S | |
| G7 | src/auth/lock-gate/lock-gate.component.test.tsx:13-20; lock-gate.native-throw.test.tsx:23-30; design-system/components/button/button.component.test.tsx:18; edit-header-button.component.test.tsx:10 | The same `icon:${name}` Symbol mock is copied 4 times. | Put `mockSymbolAsText` in test-support. | S | |
| G7 | statistics/net-worth-series/net-worth-series.test.ts:34; account-contribution.test.ts:22; type-breakdown.test.ts:8; prices/price-as-of-caption/price-as-of-caption.test.ts:10; screens/account-detail/holding-card/holding-card.component.test.tsx:17; crypto-sync-section.component.test.tsx:112; data-transfer/round-trip.test.ts:13-139 | Six hand-rolled `holding()` builders plus 48 `as never`/`as unknown as` row casts. round-trip rows miss columns (holdings has no `balanceSetAt`) without failing. | Typed `holdingRow()`, `transactionRow()`, `emptySnapshot()` factories in test-support. | M | |
| G7 | src/data-transfer/export-data.test.ts:26; import-data.test.ts:24; snapshot/restore-snapshot.test.ts:42; restore-legacy-balance-set-at.test.ts:113 | `emptySnapshot` is copied 4 times; two copies lack `pricePoints`/`bondRegister`. | Share one `emptySnapshot()`. | S | |
| G7 | src/data-transfer/round-trip.test.ts:153, 167, 184, 192; import-data.test.ts:39, 76, 170 | Encodes with @noble `utf8ToBytes` (TextEncoder) instead of production `utf8Encode`, so the "full pipeline" test skips the Hermes-safe encoder. | Use `utf8Encode`. | S | |
| G7 | src/data-transfer/snapshot/read-snapshot.test.ts:2-12 (+ read-snapshot.ts:21-27) | The mock is a call-order queue, and the production doc says it must never use `Promise.all` because of this mock. The test dictates production shape. | Mock by table identity. | S | |
| G7 | src/auth/use-app-lock.test.ts:29-44, 113-126; use-app-lock.disabled.test.ts:31-45, 64-69; lock-gate.native-throw.test.tsx:47-49; lock-gate.disabled.test.tsx:33-35 | AppState listener scaffolding for a removed re-lock path; the test at :113 is vacuous. | Delete it; keep the "no listener" test (:106). | S | |
| G7 | src/auth/lock-gate/lock-gate.component.test.tsx:30-52, 162-184 | Tests MigrationsGate's `applyPersistedLanguage` inside LockGate's file. | Move to `migrations.gate.test.tsx`. | S | |
| G7 | src/navigation/accounts.stack.test.tsx:51; settings.stack.test.tsx:44; statistics.stack.test.tsx:26 | Calls the stack components as plain functions (an implementation detail); this is why the hook mocks are needed. | Render in a NavigationContainer and read the header title, or use a shared helper. | M | |
| G7 | src/i18n/device-language/device-language.test.ts + device-language.fallback.test.ts | Two files for one unit, only because of a module-level mock. | One file with `jest.isolateModules`/`doMock`. | S | |
| G7 | src/navigation/root.navigator.test.tsx:57-65, 120 | Test 3 is redundant with test 4. `restoreAllMocks` runs at the end of the test body, so the spy leaks when the test fails. | Delete test 3; move the reset to `afterEach`. | S | |
| G7 | __tests__/mutation-stream.test.ts:95, 358 | Two units (streaming, diff scoping) in one file. | Split into `mutation-diff-scope.test.ts`. | S | |


### A1 — Cross-cutting audit (all of src/)

| Rule | file:line | What is wrong | Fix | Effort | Tags |
|---|---|---|---|---|---|
| U2 | 191 files, 713 comment lines (full list below) | Comments carry task/review ids (T#, F#, R#, I#, N#, M#), "round N", spec §/section refs, or history ("used to", "previously", "moved from/to") instead of only WHY. Worst: `holding-form.screen.tsx` (36), `transactions.repo.test.ts` (30), `holding-form.screen.test.tsx` (29), `i18n/locales/en.ts` (27), `statement-import.screen.tsx` (25), `column-mapping.screen.tsx` (24), `use-bond-isin-mode.ts` (23). | Strip the id/round/history token, keep only the WHY. Do this as its own no-behavior-change PR per file/module (comment-only diff), not mixed into feature work. | L (bulk) / S (per file) | feat-refactor (for holding-form.* files) |
| U3 | `src/prices/price-as-of-caption/price-as-of-caption.ts:47` | `meta === null ? undefined : latestPoint(...)` — classic nullable-map ternary. | `pipe(fromNullable(meta), fmap((m) => latestPoint(priceBook, metalInstrument(m.metal))))` (fnts maybe). | S | — |
| U3 | `src/prices/metal-refresh/metal-refresh.ts:160` | `rate === undefined ? [] : [toRow(metal, today, rate.price)]` | `foldMap(maybe(rate), (r) => [toRow(metal, today, r.price)])`. | S | — |
| U3 | `src/prices/nbu-metals/nbu-metals.ts:82,123` | Same null→`[]`/map pattern, twice. | Same `foldMap` pattern. | S | — |
| U3 | `src/statistics/loan-payments/loan-payments.ts:84` | `meta === null ? [] : [[holding.id, meta] as const]` | `foldMap` over `maybe(meta)`. | S | — |
| U3 | `src/holdings/loan-schedule/loan-schedule.ts:145` | `scheduledCorrection === undefined ? dayKeyOf(...) : scheduledCorrection.day` | `fold(maybe(scheduledCorrection), () => dayKeyOf(meta.startDate), (c) => c.day)`. | S | — |
| U3 | `src/screens/forms/date-field/date-field.component.tsx:22,60,105` | error-testID map, `value === null ? null : new Date(value)`, placeholder/format map — all nullable-map ternaries. | fnts `maybe`/`fmap`; testID helper is also duplicated (see G2 below). | S | feat-refactor-adjacent (forms) |
| U3 | `src/screens/forms/time-field/time-field.component.tsx:73,86` | Same null→placeholder / null→`new Date()` pattern as date-field. | Same fix; note date-field and time-field are divergent twins of the same idiom — fix both identically. | S | — |
| U3 | `src/screens/forms/holding-form/holding-form.screen.tsx:929` | `entry === undefined ? null : { ref: entry.ref, focus: entry.focus }` | `foldMap`/`fmap`. | S | feat-refactor |
| U3 | `src/screens/forms/holding-form/use-loan-fields/use-loan-fields.ts:130,131` | `meta.annualRatePct === undefined ? '' : String(...)` ×2 | `fold(maybe(x), () => '', String)`. | S | — |
| U3 | `src/screens/forms/holding-identity-field/holding-identity-field.component.tsx:22` | `testID !== undefined ? ... : undefined` (see G2 — 4-way duplicate). | fnts `fmap`; also dedupe (G2). | S | — |
| U3 | `src/screens/forms/bank-type-field/bank-type-field.component.tsx:52` | `selected === null ? undefined : bankCatalog.find(...)` | `fmap`. | S | — |
| U3 | `src/screens/account-detail/bank-sync-section/bank-sync-section.component.tsx:102` | `connectedProviderId === undefined ? undefined : bankProviderRegistry[id]` | `fmap`. | S | — |
| U3 | `src/screens/account-detail/format-last-sync.ts:17` | `lastSyncAt === null ? t('accountDetail.never') : formatDateTime(lastSyncAt)` | `fold(maybe(lastSyncAt), () => t('accountDetail.never'), formatDateTime)`. | S | — |
| U3 | `src/screens/column-mapping/column-mapping.screen.tsx:277,278,297,299,350,971` | Six separate null/undefined→default-or-map ternaries (error strings, `cellText`, `headerRow`). | `fmap`/`fold` per site. | M (6 sites, 1 file) | — |
| U3 | `src/screens/holding-detail/holding-detail.screen.test.tsx:306` | Test-mock `account === undefined ? [] : [account]`. | Lower priority (test mock), same `foldMap` fix if touched. | S | — |
| U3 | `src/screens/statement-import/example-transaction/example-transaction.component.tsx:53` and `src/statement-import/mapping/mapping.ts:59` | `transaction.mcc !== undefined ? categoryForMcc(transaction.mcc) : null` — duplicated in TWO files (G2 twin). | `fmap`; fix both together. | S | — |
| U3 | `src/screens/statement-import/statement-import.screen.tsx:60` | `id === undefined ? undefined : statementFormats.find(...)` | `fmap`. | S | — |
| U3 | `src/transactions/repo/transactions.repo.ts:765` | `loanHoldingId === null ? null : 'manual'` | `fmap`. | S | — |
| U3 | `src/statement-import/formats/privatbank-xlsx/privatbank-xlsx.format.ts:60` and `src/statement-import/column-mapping/table-rows.ts:35` and `apply-column-mapping.ts:48` | `value === null/undefined ? '' : String(value)` — same idiom, 3 files. | `fold(maybe(value), () => '', String)`; fix as one batch (G2 twin cluster). | M | — |
| U3 | `src/statement-import/column-mapping/apply-column-mapping.ts:62` | `mapping.counterpartyColumn === undefined ? [] : [mapping.counterpartyColumn]` | `foldMap` to array. | S | — |
| U3 | `src/db/run-migrations.ts:66` | `row === undefined ? 0 : Number(row.count)` | `fold`. | S | — |
| U3 | `src/sync/use-auto-sync/use-auto-sync.ts:109` | `bankAccountId === undefined ? [] : await syncStateRepo.getQuery(...)` | `foldMap`/`fold` (async-aware fold, or early-return guard if fnts async story is thin here — verify before mechanizing). | S | — |
| U3 | `src/design-system/components/currency-field/currency-field.component.tsx:156,167,169` | Three null-map ternaries for the same `selected` value. | Single `fold(maybe(selected), ...)` computed once, reused for name/leadingText/tone. | S | — |
| U3 | `src/design-system/components/symbol/symbol.color.ts:29` | `a === undefined ? 255 : Math.round(Number(a) * 255)` | `fold`. | S | — |
| U3 | `src/design-system/components/bottom-sheet/bottom-sheet.component.tsx:153,334` | `maxHeight === undefined ? capHeight : Math.min(...)`, `backdropAccessibilityLabel === undefined ? undefined : 'button'` | `fold`/`fmap`. | S | — |
| U3 | `src/design-system/components/text-field/text-field.component.tsx:48` and `field-trigger.component.tsx:18` | Same `deriveErrorTestID`/`deriveTestID` nullable-map, duplicated (see G2 — 4-file cluster). | `fmap`; extract shared helper (see G2). | S | — |
| U3 | `src/currency/decimal/decimal.ts:180` | `divideBy === undefined ? {...} : parseSignedDecimal(divideBy)` | `fold`. | S | — |
| G2 | `src/design-system/components/text-field/text-field.component.tsx:47`, `src/design-system/components/field-trigger/field-trigger.component.tsx:17-18`, `src/screens/forms/date-field/date-field.component.tsx:21-22`, `src/screens/forms/holding-identity-field/holding-identity-field.component.tsx:19-22` | The exact same `deriveTestID(testID, suffix)` / `deriveErrorTestID(testID)` helper (`testID !== undefined ? \`${testID}-${suffix}\` : undefined`) is hand-copied into 4 files. Comments in 3 of them even say "mirrors TextField's own `deriveTestID`" — the duplication is *known and accepted*, not accidental. | Extract one shared `deriveTestID(testID, suffix)` into a design-system util (e.g. `design-system/derive-test-id.ts`) and import it in all 4 places; also fixes the U3 hit at each site in one pass. | S | — |
| G2 | `src/statement-import/mapping/mapping.ts:59` vs `src/screens/statement-import/example-transaction/example-transaction.component.tsx:53` | Identical `mcc !== undefined ? categoryForMcc(mcc) : null` duplicated instead of one calling the other or both calling a shared helper. | Extract or have the component call the mapping module's helper. | S | — |
| U5 | `src/screens/settings/settings/settings.screen.tsx:34-36` | `match(language).with('uk', ...).otherwise(...)` where `language: AppLanguage` is a closed 2-value union (`src/i18n/device-language/device-language.ts:5`) — should be `.exhaustive()` so a 3rd language breaks the build instead of silently falling into English. | Change `.otherwise(() => PRIVACY_POLICY_URL_EN)` to `.with('en', () => PRIVACY_POLICY_URL_EN).exhaustive()`. Note this DOES change behavior for any language not yet in the union (compile error instead of runtime fallback) — intentional, that's the point of exhaustive matching. | S | — |
| U5 | `src/holdings/interest/interest.ts:14,28,369` and `src/holdings/holding-value/holding-value.ts:283` | 4 `switch` statements over closed literal unions (`frequency`, `holding.type`) instead of `ts-pattern` `.exhaustive()`, while 18 other files in the same codebase already use ts-pattern for this exact purpose (inconsistent idiom, U6). | Convert to `match(x)....exhaustive()`, following `src/holdings/exchange-destination/exchange-destination.ts` as the in-tree exemplar (4 already-exhaustive matches). Behavior-preserving if every case is carried over. | M (4 switches, 2 files) | — |
| U4 | `src/bonds/isin/isin.ts:47-62` | `validateIsin` hand-rolls a discriminated result `{ ok: true; isin } \| { ok: false; reason }` instead of using fnts `either`/`eitherSync` + `bifold`, which the codebase already uses this way in 10 other files (`db/encrypted-database.ts`, `crypto-sync/binance/binance.credentials.ts`, etc.). The module's own doc comment explicitly names this as "the never-throw... shape the rest of the domain prefers" but doesn't reach for the library that already models it. | Model as `Either<'format' \| 'checkDigit', string>`; fold at the call site. Behavior-preserving. | M | — |
| U4 | Whole tree | fnts `maybe`/`just`/`nothing`/`fold`/`fmap`/`foldMap` has ZERO usages anywhere in `src/` (`grep -rn "maybe(" src` → 0 hits), despite ~28 hand-rolled nullable-map ternaries above that are exactly its use case, and despite the `kiko-code-style` skill documenting it as available. | Introduce `maybe` at the first fix site (e.g. `price-as-of-caption.ts`) as the reference example, then batch the rest. | — (tracking finding, not a single fix) | — |
| U7 | `src/statement-import/formats/*` | 6 of 7 format folders (`alfa-business-csv`, `monobank-csv`, `privatbank-xlsx`, `procredit-business-csv`, `sensebank-csv`, `ukrsib-business-csv`) follow `{name}.format.ts` + `{name}.format.test.ts` + `index.ts` + `__fixtures__/`. `business-csv/` is a shared base (not a format itself — confirmed no format file imports its own name as a format) but sits in the *same directory tier* as the real formats with a different naming scheme (`business-csv.ts`, `column-base.ts`, `csv-row.ts`, no test file, no `__fixtures__`). Not a bug, but the naming makes it look like an 8th, untested format at a glance. | Rename the folder (e.g. `formats/_shared/business-csv-base/`) or add a short doc-comment at the top of `business-csv.ts` stating up front "this is the shared parser, not a format" (it currently only says so 8 lines in). Low urgency, naming-clarity only. | S | — |
| U7 | `src/crypto-sync/binance/*` vs `src/crypto-sync/btc-wallet/*` | binance has `.client`, `.credentials`, `.provider`, `.transactions`, `.hmac` + a one-off migration file; btc-wallet has only `.client`, `.provider`, plus `bitcoin-address.ts`. Verified this tracks real complexity (binance needs signed authenticated calls; btc-wallet reads a public address) — NOT flagging as a violation, noting for the record since the brief asked for the matrix. | No fix needed. | — | — |
| M-import-ordering-length-sort | `src/screens/statement-import/statement-import.screen.tsx:1-7` | Import lines are 43,40,47,68,52,74,77 chars — not ascending (43 before 40; 68 before 52). | Reorder within the group by ascending length, per the memory rule; `holding-form.screen.tsx:1-10` in the same tree is correctly sorted — use it as the reference. | S | — |
| M-import-ordering-length-sort | `src/screens/forms/transaction-form/transaction-form.screen.tsx:1-11` | 41,45,47,51,55,74,59,60,66,81,92 — the `react-native-reanimated` import (74) is out of order, placed before three shorter ones (59,60,66). | Move it to its length-sorted position. | S | — |
| G4 | `src/screens/forms/holding-form/holding-form.screen.tsx` (2339 lines) and its test (2689 lines) | One file carries bond/ISIN, loan, metal, property CREATE/EDIT payload building, validation (incl. the newly-added metal-purity validation), and scroll-to-invalid-field orchestration. Concerns to split: (1) per-type payload builders (already partly split into `*-section` components, but the CREATE/EDIT payload functions for all 4 types live in this one file), (2) cross-type Save validation/error-collection, (3) scroll/focus orchestration. | Behavior-changing if split (re-export surface changes); flag for the developer/planner, not a blind refactor. Given this file is under active F4 work, timing this split is a call for the team, not this audit. | L | feat-refactor, USER-DECISION (timing of a refactor mid-feature) |


## 3. Rules that the skills are missing or contradict

This list is for the scribe. It merges the Section C notes of all ten agents; the appendix has each agent's original notes. The same gap was found by several agents in some cases (for example, the U2 gap was found by all ten).

### kiko-code-style

1. **U2 is not in any skill, and the skills themselves use the banned style.** Add a "Comments explain WHY only" rule: no task ids, review ids, round numbers, spec sections, dates, commit hashes or history. Then remove the ids from the skills. Examples:
   - kiko-code-style:115-117 and :136 ("T25 review round 1, I4")
   - kiko-domain throughout (T25, I1, N10a, M2)
   - kiko-design-system:685-747 ("F3 fix round 1, I3")
   - kiko-statement-import:147-162 and :258-345
   - kiko-translator:6-9, :83, :129 and :136
   - kiko-architecture:592-595
   - kiko-charts:144-170

   Agents copy this style from the skills into the code.
2. **The fnts section (:214-259) describes the current code instead of stating a rule.** Lines :224-227 say "today every one of them is `guard` … no `pipe` composition is left". This is false: 10 files use `fnts/either`. Delete that sentence. Add three rules:
   - fnts is the first choice (pipe/compose, maybe + fmap/bind/fold/foldMap, either/eitherSync + bifold, guard), but readability still wins.
   - **The U3 ban:** `x === undefined ? undefined : f(x)` and all null/undefined variants become `foldMap(maybe(x), f)`.
   - A shared `deriveTestID` helper built on `maybe`.
3. **U1 conflict (USER-DECISION).** Lines :441-462 say that every function that returns JSX is extracted, "even a small render row helper". Your rule allows a small local component that is not exported. kiko-domain:881 also documents `LoanFormBlock` (88 lines, in the screen file) as the pattern. After your decision, also add "one exported hook per file" (A1 and R8 found `useSync` + `useSyncAction`, and the `sync-status` stores).
4. **The U5 details are missing.**
   - Name a typed `Record<Union, X>` lookup as an accepted alternative.
   - `.otherwise()` is only for an open match. A closed union always ends in `.exhaustive()` (see `settings.screen.tsx:34` and `active-locale.ts:10`).
   - Boolean flags derived from a union (`isExchange`/`isSplit`) count as branching over that union.
   - Lines :179-184 require `.exhaustive()` over ISO 4217 numeric codes, but a `number` cannot be exhaustive. Use a table lookup there.
   - A subset predicate is a tuple + `includes`, never an `===` chain.
5. **The "Form validation model" (:260-275) is out of date.** It still describes a `showNameError` flag and a "FieldError" message. Rewrite it to the full current pattern:
   - Save is always enabled; validate on press.
   - The field's own `error` prop shows the message under the field and turns the label red. There is no outline.
   - Show the error on **every** invalid field, including dates and pickers.
   - Scroll to the first invalid field **in visual order**.
   - A blocked Save always shows at least one error (bug 14).
   - Use the shared `forms.fields.saveError*` Alert keys (the :250-255 example still points at contribution-form's own keys).
   - The same rules apply to Import and, after your decision, to Connect.
6. **No rule for `@kiko/*` versus `../` imports (USER-DECISION).** The memory says "alias for cross-feature imports", but the code has 1,213 relative imports and 146 alias imports. Many files mix both styles for the same module. The rule must also say which import group an alias sorts in.
7. **Import order.** Lines :279-285 say it "cannot be mechanized". It can (see section 4, item 1). Also state the tie-break (a value import comes before a type import) and that a duplicate specifier is merged with an inline `type`.
8. **Folder-per-thing.**
   - The example at :497-502 shows a flat `holdings/holdings.repo.ts`, but the code uses `holdings/repo/`.
   - Add a rule for where cross-screen shared units live. Examples today: `home/filter-menu`, `home/transaction-row/transaction-card`, `account-detail/clipboard-text-field`.
   - Decide whether `src/navigation/` and `__tests__/` are exceptions (USER-DECISION).
9. **File suffixes (:406-407).** The skill says the lock gate is a `.gate.tsx`, but the code has `lock-gate.component.tsx` and no barrel.
10. **Add a testing section.** There is none. It should require:
    - Shared factories in `src/test-support/`: `mockUseLiveQuery`, a strict `fakeTx` that throws on an unknown table or column, `fakeQuery`, the Text tone mock, a Keychain `__mocks__`, typed row factories, and `emptySnapshot`.
    - Moving any inline `jest.mock` factory that 3 or more files repeat.
    - No ids in test titles.

    The fake-db-masks-bugs memory lives only in memory today.
11. **"Externalize hardcoded config" (:542-553).** Every NBU, Monobank and CoinGecko-history client and both privacy-policy URLs keep their URL in the code. `MONOBANK_API_ENDPOINT` already exists in `@env`. Either move all of them to `.env`, or narrow the rule (USER-DECISION).
12. **Carve-out (:248-250).** It allows the migrations-gate early-return chain, which contradicts U5. The gate file also cites this carve-out for an unrelated try/catch (USER-DECISION).
13. **Add:** filters and selections are keyed by a stable id, never a display name (bugs 15 and 16).

### kiko-design-system

1. **There is no "UX patterns" section.** The memory calls this section "the authoritative home", but it does not exist. Add the full list:
   - The primary action goes in the footer (Import and Export, and every form).
   - The validation pattern from kiko-code-style item 5.
   - Tabs (SegmentedControl) only when the choice changes the visible fields; otherwise chips.
   - A long list goes in a select sheet.
   - The selected option shows a checkmark.
   - Capabilities are visible (never skip a selector; show the column-mapping icon on every bank).
   - Copy feedback changes the label.
   - Grouped lists use a divider and a larger gap.
   - Casing by role and full stops by role (link to kiko-translator).
2. **Contradictions with the tabs/chips rule.**
   - :737-743, and kiko-statement-import:321-345, prescribe SegmentedControl for encoding and the decimal separator. Your rule says chips.
   - :633-678 documents the trend-filter Top/Manual mode, and :637 the lot Buy/Sell toggle, as OptionPills. Both choices change the visible fields, so the rule says tabs (USER-DECISION).
   - :637 also lists the icon-picker modal as an OptionPills consumer. It is not one.
3. **The documented GlassSurface consumers are stale (:298-338).** The section lists entity cards, ledger rows and the Home transaction row. The real consumers are only BottomSheet, the keyboard accessory and the FAB. The text contradicts the rule that glass is for the navigation layer only.
4. **Missing or wrong components.**
   - :185-196 documents `Screen.fillHeight`, which does not exist. The About block is in `footer` (USER-DECISION: where does About go?).
   - :749-754 lists the charts as design-system components. They live in `screens/statistics`.
   - The frontmatter omits SheetFooter, EditHeaderButton, IconEditor, IconPickerModal, LanguageSwitch and useKeyboardDoneAccessory.
   - :130-147 describes the old `ManualCategoryRow` behavior.
5. **Error placement.** :581-586 places FieldError "next to a blocked field or footer Save button", which contradicts "no footer errors".
6. **Field composition.** :569-598 describe DateField and TimeField as separate implementations. Require them to compose `FieldTrigger` (both copy it today, and TimeField has no `error` or `required`).
7. **Tokens.**
   - Add a 44 pt touch-target token (6 files redefine it).
   - Add the small button height and hitSlop.
   - Export one `AppTheme` type (4 copies today).
   - Add a `DISABLED_OPACITY` use rule.
8. **Button hierarchy.** The memory says "Sync now" is an inline secondary with a faint tint. The code uses `primary` and a comment calls that deliberate. Other open choices: the categories star size (`small` in the skill at :268-273, `compact` in the code), and one Cancel style for every sheet (USER-DECISION).
9. **Missing shared components.** Add a shared filter-chip trigger (3 copies today), an EmptyState (6 copies), and one chips component (OptionPills and ChipRow are near copies; USER-DECISION on the final look).

### kiko-domain

1. **Add an "Adding a holding type" checklist (U7).** Each of the 5 types uses a different shape today: inline JSX, a section component, or a `use<Type>Fields` hook. Proposed shape for each type:
   - A `use<Type>Fields` hook (state, reason key, seed, create payload, edit metadata).
   - A `<Type>Section` component.
   - One `Record<HoldingType, …>` entry each for the form, the detail screen and the derived entries.
   - A domain descriptor `{ parse, breakdown, entries, ledgerless, priced }` (USER-DECISION: size and timing).
2. **Term caps.** Only the loan `termMonths` is capped (:945). Require a cap on every term input (bug 12).
3. **Currency scale (:308-313) is wrong.** ETH uses scale 8. BHD/IQD/JOD/KWD/LYD/OMR/TND use scale 3. JPY, CLP and others use scale 0. The code uses a `Record` lookup, not `match`.
4. **"Money at the repository boundary" (:301-304, and kiko-architecture:178-180).** No repository returns `Money`. That gap let the metal UAH assumption leak (latent bug 35). Change the code or the skill (USER-DECISION).
5. **Add a `canRecordManualTransaction(holding, account)` predicate** owned by the domain. Two screens implement it today, and the split-return picker skipped it (bug 8).

### kiko-pricing

1. **Metal currency.** :147-150 say metal is UAH and "not enforced by code". R1 found an effect in the form that enforces it; R6 found that the value path still returns a bare UAH number. Require a `Money` result from the priced value.
2. **The `day` convention (:74-76) is wrong.** `dayKeyOf` uses the local date and `toUtcMidnight` uses the UTC date. Move both into `src/dates` and name each convention.
3. **Chunking.** :47-50 and :85-86 allow a fixed chunk of 2,000 rows and say nothing about `ratesRepo.upsertMany`. Require `chunkForTable` for every bulk write (bug 1).
4. **Metal backfill.** :314-354 say to mirror nbu-rates/nbu-history, which asks for copy-paste. The "single current call for an already-priced metal" wording allows bug 19. Update the text after that fix.
5. **Decimal fields.** Validate a decimal-string field with the same `normalizeDecimal` that stores it (bug 13).
6. **Seed date.** :29-30 point to a date comment, which conflicts with U2 (USER-DECISION: keep it, or use a `FIAT_SEED_CAPTURED_ON` constant).

### kiko-architecture

1. **The 5.6 rule contradicts itself.** :19-24 ban any build flag that gates visibility, but :639-647 allow `APP_LOCK_ENABLED`, which gates the App Lock card and the lock screen. Remove the flag or write down an exemption (USER-DECISION; kiko-compliance too).
2. **`dbKeyHex`.** :880-890 call it "display-only", but no UI shows it (bug 2).
3. **Wrong location.** :437-441 and :498 put the throttle and sync-status in `src/monobank/`, but crypto-sync depends on both. Move them to `src/sync/`.
4. **Add a provider-client resilience contract:** timeout, 429 retry with Retry-After, translated errors and a response shape guard. Only Monobank has these today; Binance and Esplora have none.
5. **Repository module shape.**
   - A one-shot read returns a query builder (`ratesRepo.latestFetchedAt` differs from `bondRegisterRepo.fetchedAtQuery`).
   - Every bulk write uses `chunkForTable`.
   - Shared helpers (`removeHoldingsTx`, `rewriteSortOrderTx`, `adjustBalanceTx`) replace the twins.
6. **Add:** a domain pipeline belongs in `src/<domain>`, not in a screen (the statistics exclusion union). Prescribe one data-prelude hook (`useNetWorthInputs`) for Home, Statistics, Accounts and AccountDetail.

### kiko-translator

1. **Full-stop rule.** Add explicit roles for field status errors (`invalid*`, `couldNot*`), row errors (`rowError.*`), thrown messages, and "Label: {{value}}" lines. Add an `ERROR_KEYS` list like `TITLE_KEYS`.
2. **Casing test.** The test replaces an interpolation with a space, so "{{count}} Category" passes. Add a rule that a word inserted by interpolation takes the case of its position, and fix the test.
3. **Apostrophe test.** The rule says U+2019, but the test rejects only ASCII `'`, so U+02BC passes (uk.ts:137, 461, 464, 465).
4. **Keys in shared components.** A shared design-system component uses `common.*` keys, never feature keys (the icon-picker uses `categories.*`).
5. **Two roles need two keys.** Select fields reuse the field label as the sheet title. TITLE_KEYS is missing 12 heading keys (see R9).

### Other skills

- **kiko-gestures:104-107** say the account-detail grid has 2 columns; the code has `columns={1}`. State whether `rowGap` is part of the shared grid tuning; it has drifted to 4 in one place and 3 in the other.
- **kiko-charts:16-27** say every chart uses the fixed VIEW_WIDTH, but PieChart uses a pixel `size`. **:211-222** describe category-trend-line as "mirroring" net-worth-line, which invites copying. Prescribe a shared `chart-axis/` module instead.
- **kiko-statement-import:63-67** allow a second hand-written UTF-8 decoder. Point to `src/data-transfer/utf8` instead. Also:
  - List the twin pairs: statement-import and column-mapping (file read, import flow, `.xls`, the 0-row gate), and the two closing-balance pickers.
  - Define the standard format folder: `format.ts`, `format.test.ts`, `index.ts`, `__fixtures__/`, with shared helpers in `formats/shared`.
- **kiko-compliance** does not cover code for an entry point that was never built (the Share Extension), or a build constant that gates UI.

### Harness finding (not a code rule)

**Agents must never use `pkill`, `killall` or any kill by name pattern.** An agent stops only a PID that it started itself (`kill <pid>`), or lets the tool timeout stop a hung command. Read-only roles (reviewer, auditor, explorer, debugger) do not kill processes at all.

- **Why:** during this review, R5 (kiko:reviewer) ran `pkill -f "cat" -U <user>` to stop its own hung `cat`. The pattern matches every command line that contains "cat", for example "Applications". Orca Helper processes and simulator runtime processes restarted. Two of the coordinator's background watchers died with exit code 144.
- **Where to write it:**
  - `harness/kiko/skills/harness-workflow/SKILL.md`, as a standing rule.
  - Every agent file that has the Bash tool in `harness/kiko/agents/`: developer, debugger, reviewer, qa, designer, ops, pm, auditor, retrospect, scribe and planner.
- **How to automate it:** a `PreToolUse` hook on `Bash` in `harness/kiko/hooks/hooks.json`. The hook blocks a command that matches `\b(pkill|killall)\b` or `kill\s+(-\d+\s+)?-?\$\(` (a kill of a substituted PID list), and prints the rule. A plain `kill <digits>` stays allowed.

## 4. Candidates for automated checks

The table orders the checks by value. "Class B" means the check reports at WARNING and does not block, until the backlog is fixed.

| # | Check | Tool | Catches | Notes |
|---|---|---|---|---|
| 1 | `check:imports`: 3 groups, sort by the length of each import's last line, value before type at equal length, a side-effect import is a barrier, no duplicate specifiers. In the same script: a blank line before `return`/`if`/`for`/`while`/`switch` (unless the line follows `{`), and a blank line between adjacent JSX siblings. | A small node script in `scripts/checks/`, fast tier | S-STYLE imports (67 rows), S-STYLE blank lines (about 180 rows) | Four reviewers wrote working scratch checkers. The R2 version flagged 236 of 982 files. Land it BEFORE the formatting sweep, so the fix stays fixed. |
| 2 | Ban the nullable-map ternary. | Semgrep, Class B, then ERROR | U3 | Patterns: `$X === undefined ? undefined : $E`, `$X !== undefined ? $E : undefined`, `$X === null ? null : $E`, `$X !== null ? $E : null`, `$X == null ? null : $E`, `$X === null ? undefined : $E`, and `$X ? \`...${$X}...\` : undefined`. The default-value variants (`x === null ? '' : f(x)`) need a second, looser rule. |
| 3 | Ban ids and history in comments and test titles. | An `rg` wrapper script (Semgrep does not match comments), Class B | U2 | Pattern: `(//\|/\*\|\*).*\b(T-?\d{1,2}\b\|F\d( item\| fix\| audit)\|[Rr]ound[- ]?\d\|[Rr]eview (Focus\|follow-up)\|audit \d+\|item \d+\|spec [§\d]\|§\d\|Task \d\|Phase \d\|[Cc]ontroller ruling\|Requirement [A-Z]\|Option A\|builds? \d{2}\|20\d\d-\d\d-\d\d\|used to\|[Pp]reviously\|no longer\|\.superpowers/)`. Also match `it('…(T25)…')` and `describe(` titles. Expect some false positives ("used to" in a WHY sentence); tune the pattern with fixtures. |
| 4 | Ban `switch` in `src/**`, and `$H.type === '$T'` chains in `src/screens/**`. | Semgrep, Class B | U5 | A `.otherwise()` on a closed union needs type information. Cover it in review and in the skill. |
| 5 | Ban raw literals: `<SymbolIcon size={<number>}>`, `const *_ICON_SIZE = <number>`, a numeric `borderRadius`/`fontSize`/`lineHeight`/`opacity` in `*.styles.ts`. | Semgrep | S-DS | |
| 6 | Allow `<GlassSurface>` only in bottom-sheet, keyboard-done-accessory, add-transaction-fab and glass-surface. | Semgrep, ERROR | M-liquid-glass | |
| 7 | Flag a local redefinition outside its owner module: `const DAY_MS =`, `const isRecord =`, `const isCurrency =`, `const deriveTestID =`, `type AppTheme = UnistylesThemes[…]`, `new Date(d.getFullYear(), d.getMonth(), d.getDate())`, a hand-built rate key `` `${a}:${b}` `` outside `src/rates`, and the `'metal:'`/`'holding:'` instrument prefixes outside `src/prices/instrument`. | Semgrep | G2 | |
| 8 | Flag hand-written UI: `<Box style={$S.divider}/>` or `height: StyleSheet.hairlineWidth` in screens (use Divider); a `<Pressable accessibilityState={{selected}}>` inside a BottomSheet (use SelectableRow); `<Text variant="caption" tone="negative">` (use FieldError); `<SelectableRow selected={false}>`; `<Button disabled={!can…}>` in a footer. | Semgrep, Class B | U9, U10 | |
| 9 | Flag a hardcoded `'https://…'` in `src/**` (not in tests). | Semgrep | S-STYLE config | USER-DECISION on the rule first. |
| 10 | Flag a repository write that nothing awaits in a JSX handler (`$A={() => $R.$M(...)}` where `$R` matches `/Repo$/`). | Semgrep, Class B | G6 | |
| 11 | Flag an import from another screen's folder (`from '../(home\|statistics\|…)/'` under `src/screens/*/`). | Semgrep | U8 | |
| 12 | Flag a literal `throw new Error('…')` in `src/crypto-sync/**` and `src/monobank/**`, because these messages reach the UI; also `authenticateWithOptions({ cancelLabel: '<literal>' })`. | Semgrep | S-I18N | |
| 13 | Flag `process.env.TZ =` in tests; flag an import of `bytesToUtf8`/`utf8ToBytes` from `@noble/*` outside tests. | Semgrep, ERROR | kiko-domain, Hermes memory | |
| 14 | Flag test-support drift: an inline `jest.mock('…/db/use-live-query', …)`, `testID={\`text-tone-${tone}\`}` outside test-support, `toSQL: () => ({ sql: ''` in tests. | Semgrep, WARNING, after the shared helpers exist | G7 | |
| 15 | Run Knip in `--production` mode, which reports exports that only tests use. | Knip | G1 | This finds `periodsPerYear`, `updateName`, `setColor`, `upsertMonobank`, `archive`, `add`, and the sync-status test-only exports. |
| 16 | Lower the jscpd threshold (`minTokens` or per folder) for `screens/statistics`, `monobank/migrate-credential` + `crypto-sync/binance`, and `statement-import/formats`. | jscpd | G2 | The chart twins and the identical credential migrations passed the global 5% gate. |
| 17 | Bound-parameter invariant: drive each bulk write (`ratesRepo.upsertMany` with `buildPairs` over every entry of `currencyOptions`, `rateHistoryRepo`, `pricePointsRepo`, `addManyDedup`) through the drizzle sqlite-proxy. Assert that no statement has more than 32,766 parameters. | Jest | Bug 1 | |
| 18 | Twin-parity invariants: the key set of `buildCategoryTrend` equals that of `buildCategoryBreakdown`; the tables that `accountsRepo.remove` touches include all that `holdingsRepo.remove` touches (including `price_points`); `currencyFromCode(codeFromCurrency(c)) === c` for every currency; `computeDedupKey` is unique for descriptions that end in digits. | Jest | Bugs 4, 10, 11 | |
| 19 | Type-completeness invariants: one exhaustive `Record<HoldingType, …>` descriptor; each schema enum equals its runtime tuple in both directions; the `providerCatalog` ids equal the `bankProviderRegistry` keys (this replaces the silent `visibleCatalogEntries` filter); every `design-system/components/*` folder is named in kiko-design-system. | Jest | U7, S-COMPL, skill drift | |
| 20 | i18n invariants: every key used as `variant="heading"`, SummaryTable `title=` or a nav `title:` is in TITLE_KEYS (a source scan; it found 12 missing keys); the casing test replaces each interpolation with `x`; the apostrophe test uses `['ʼ]`; every error-role key ends with "."; FilterMenu option values are unique and never equal the "All" sentinel. | Jest | S-I18N, U10-case, U10-stop, bug 16 | |
| 21 | Form invariants: for each holding type and transaction mode, leave each required field empty in turn and press Save; assert that at least one `*-error` node renders and that the first error is the top invalid field. Every term reason function rejects cap + 1. Decimal fields pass if and only if `normalizeDecimal` is not null. Every FieldTrigger consumer forwards `error`. The split-return picker never offers a ledgerless type. Every bank row shows the column-mapping capability icon. | Jest | Bugs 6, 8, 12, 13, 14, U10 | |
| 22 | A `PreToolUse` Bash hook that blocks `pkill`/`killall`. | Claude Code hook | Harness finding | |

## 5. Proposed fix order

Each batch covers one concern and is one commit, or a few small ones. Run every batch AFTER the feature session lands its own holding-form and F4 refactor. The exceptions are batches 0 and 1: their bugs are not in `feat-refactor` code, and they should not wait. Every row tagged `feat-refactor` goes to the feature session, or waits until that session merges.

| Batch | Content | Behavior-free? | Gate |
|---|---|---|---|
| 0 | **Urgent production fixes.** Chunk `ratesRepo.upsertMany` + the bound-parameter test (bug 1). Translate the Face ID labels (bug 28). | No | Device check of the rates first; the user reviews the new en/uk strings. |
| 1 | **The other correctness bugs**, one commit each with a test, grouped by area: data-transfer (bugs 2-3, after the `dbKeyHex` decision), statement-import and sync (4, 5, 20-22), transaction-form (6-8), column-mapping and statement-import screens (9, 23-27, 29), domain (10, 11, 18, 19, 33-35), home and statistics (15-17, 36), settings (30-32), holding-detail memo (37), column-mapping `onOpenChange` (38). Bugs 12-14 go to the feature session. | No | Full jest; a device check for network and sync items. |
| 2 | **User decisions (section 6) + a first scribe pass.** Fix the three skill texts that cause new violations every day: the U2 rule, the fnts/U3 rule, and the UX-patterns section. Remove the ids from all skills. | Docs only | The skill-drift rule. |
| 3 | **Automated checks, first.** `check:imports` with blank lines (item 1); Semgrep U3, U2 and U5 at Class B (items 2-4); the i18n and twin invariants that already pass (items 18-20). | Harness only | `check:rules` fixtures. |
| 4 | **Shared helpers and test-support.** `deriveTestID` (fnts), `AppTheme`, the touch-target token, one `DAY_MS`/`isRecord`/`isCurrency`/`rateKey`/`toMajor`/`startOfLocalDay` source, `readJsonOrThrow`, `mockUseLiveQuery`, a strict `fakeTx` that throws on unknown input, `fakeQuery`, the Text-tone and Symbol mocks, a Keychain `__mocks__`, typed row factories, `emptySnapshot`. Then move the tests onto them, one folder at a time. | Yes | Full jest. |
| 5 | **Dead code (G1).** GlassSurface `tint`/`translucentStrong` + tokens + tests; unused props (Button `trailingIcon`, BottomSheet `animationType`/`maxHeight`, Box `background`, and others); repository methods with no caller; the Binance repair latch; unused provider-catalog fields; aliases with no purpose; stale comments. The loan-link writers, `shareInstrument`, `archive` and the Share Extension paths go after the user decisions. | Yes (except 5.6 removals) | Knip in production mode is clean. |
| 6 | **fnts, U3, U4 and U5, one module at a time** (prices, rates, statement-import, db, design-system, sync, screens). Convert the nullable ternaries to `maybe`, try/catch-to-result to `either`/`eitherSync` + `bifold`, and `switch` or `===` chains to `match().exhaustive()` or a `Record`. | Yes | Semgrep U3 goes to ERROR when the batch is done. |
| 7 | **Twins (G2), one pair at a time:** the NBU client module and a pair-composition module; the `formats/shared` helpers; `useStatementFile` + `useImportFlow`; `ConnectedSyncBlock`; the single-flight helper; the credential migration; `useScrollToField` + `showSaveErrorAlert`; `useNetWorthInputs`; `chart-axis/`; a shared codec; `useDateRangeState`, `toggleSetValue`, and the FilterChip trigger. | Mostly yes; the list notes each exception | Full jest. |
| 8 | **Structure (U8, U1): pure moves.** Folders for `crypto-sync/binance` and `btc-wallet`, `db/`, `dates/`, `statement-import/column-mapping`, the design-system root, `accounts/repo/`, and (after the decision) navigation. Move shared units out of the screen folders. Move throttle and sync-status to `src/sync/`. Extract the second components (StatementPreviewBlock, ColumnMappingForm, CategoryListRow, LedgerRowItem, ValueHeaderSecondary, …) under the U1 decision. | Yes | Find every importer with grep. |
| 9 | **Large decompositions (G4, U7):** transaction-form (hooks + sections + one `saveBlock` over a variant union), column-mapping (form reducer + a memoized preview), statistics, home, `monobank/sync.ts` (plan/progress/finish-run), `transactions.repo`, and holding-detail. The per-holding-type descriptor comes after the decision, and together with the feature session. | Yes | One screen at a time; device check. |
| 10 | **UX consistency (U10):** tabs or chips (encoding and separator become chips; the crypto source becomes tabs; the other choices follow the decision), checkmarks (TargetHoldingSheet, HoldingSelectField), SelectableRow in AddBankSheet with capability icons, the `error` prop on CategoryField/HoldingSelectField/ChipRow/CurrencyField, validate on press in AddCategoryRow and import-data, and the 44 pt touch targets. | No (visual) | You review on the device. |
| 11 | **i18n copy:** full stops, the casing of interpolated words, the TITLE_KEYS additions, separate sheet-title keys, the uk apostrophes and wording, and `common.*` keys in shared components. | No (copy) | You review the en/uk keys BEFORE any deploy that ships them. |
| 12 | **U2 comment purge, one folder at a time.** Do this late, so that it does not conflict with the moves. Then set the U2 check to ERROR. | Yes | Diffs contain comments only. |
| 13 | **Mechanical formatting.** Run `check:imports` with autofix, or re-sort by hand. Add the blank lines. Merge duplicate imports. Apply the alias decision. | Yes | `check:imports` goes to ERROR. |
| 14 | **Final scribe pass** for the rest of section 3, then `kiko:retrospect` for skill drift. | Docs only | |

## 6. Decisions for you

Each decision blocks the rows tagged `USER-DECISION` for its topic.

### Rules and skills

1. **U1.** Is a small, local, non-exported component allowed in the same file (your rule), or does the stricter skill text win? The rows affected are BarRow, PieLegendEntry, LegendEntry, SectionHeader, ManualCategoryRow, StatusMessage and BreakdownCell. `LoanFormBlock` (88 lines) and `StatementPreviewBlock` (100 lines) are too large for the exception in either case.
2. **Import style.** Use `@kiko/*` for every cross-feature import, as the memory says? The code has 1,213 `../` imports and 146 alias imports.
3. **Hardcoded public URLs** (NBU, Monobank, CoinGecko history, the privacy policy). Move them to `.env`, or narrow the skill rule?
4. **The migrations-gate early return.** Keep it (as the kiko-code-style carve-out allows), or change it to `match().exhaustive()`?
5. **Structure of `src/navigation/`.** Use a folder for each unit, or keep it flat as an exception?
6. **The seed capture date comment** in `fiat-rate-seed.ts`. Keep it as data provenance, or change it to a constant?
7. **"Money at the repository boundary."** Change the code to return `Money`, or change the skill text?

### Compliance and data

8. **`APP_LOCK_ENABLED`.** Remove the flag and its OFF paths, or record a 5.6 exemption?
9. **`dbKeyHex` in the export with secrets.** Stop exporting it (recommended), or disclose it and show it?
10. **Share Extension code paths.** Make `StatementImport.accountId` required and delete the paths that cannot be reached? Recommended: yes.
11. **Loan-link writers** (`setLoanPayment`, `setAutoLoanLinks`, `undoAutoLoanLink`) and `shareInstrument`/`'eodhd'`. Remove them until the features ship, or keep them?
12. **The dedup-key fix** (bug 4). Migrate the old synthesized keys, or accept duplicates once when a user imports an old file again?
13. **`accountsRepo.archive`** has no caller. Delete it, or build the archive UI?

### UX

14. **Tabs versus chips versus a select sheet:**
    - The transaction type: sheet today; tabs on create?
    - The trend-filter Top/Manual mode: chips today; tabs by the rule.
    - The lot Buy/Sell toggle: chips today; tabs by the rule.
    - The holding type and the property category: chips today; a select sheet like the account kind?
15. **Connect buttons** (Monobank, Binance, wallet). Do they follow "always enabled, validate on press"?
16. **Column-mapping Import with 0 rows.** Show an error under a field, or allow the import and show the result sheet?
17. **A hidden category selection** after a date-range change. Keep it visible in the menu, or remove it from the selection?
18. **Cash initial value.** May a blank field mean 0, or is it an error?
19. **"Add category"** in the footer (like Accounts), or keep it inline?
20. **Button styles:** Sync as `primary` or `secondaryTonal`; "Change bank" as `ghost` or `secondaryTonal`; the categories star as `small` or `compact`; one Cancel style for every sheet.
21. **The Settings About block:** in the page content or in the footer?
22. **Priced holdings** (property, metal). Show the cost basis and gain on the detail screen?
23. **Calendar week start:** Monday first, or follow the locale?
24. **One chips component** (OptionPills and ChipRow merged). What is the final look? Also: a generic `SelectField` for AccountKindField and ModeSelectField, and the `selected=""` pick-list workaround in DescriptionSuggestions.
25. **Provider catalog:** show the "data provided" copy, or drop the unused fields?

### Domain

26. **`reconcile-bond-funding`:** what is the maximum day distance between a bond and its funding debit?
27. **Metal backfill:** more NBU calls for an accurate chart (recommended), or keep the current number of calls?
28. **Bond metadata defaults and derived entries per type:** should the bond parser reject bad input like its siblings do? Which holding types show derived ledger entries?
29. **The per-holding-type descriptor refactor** (U7, large). When does it run relative to the feature session?

### Device checks

30. **The GlassSurface bloom re-sample loop.** Remove it after a device check shows that the sheet does not need it?
31. **The net-worth-line "R5-D exploratory" code.** Keep it or drop it?

## 7. Out of scope and not verified

- I did not run a build, jest, Stryker or a device test. Every bug is a static finding from reading the code. Each fix needs its regression test and, for network or sync items, a device check.
- For bug 1, I verified the code path and the SQLite limit. I did not verify the number of currencies that Monobank returns on a device.
- A1 checked U7 and U8 by sampling sibling sets. The area reviewers covered their folders file by file.
- An area can be clean for a rule. For example, R1, R2, R3, R5, R8 and A1 found no S-COMPL violation in their areas, and R5 found no U1 violation.


## Appendix — the notes of each agent (Sections B-E)

This appendix keeps each agent's original counts, skill gaps, automated-check candidates and fix batches, so that the scribe can trace section 3 and section 4 back to their source.


### R1 — Holding forms and holding-detail

#### Section B — Per-rule row counts

- BUG: 4 (1 also counts as U10-validate, 1 as G2, 1 as G1)
- S-COMPL: 0
- U1: 3
- U2: 16 (folder-grouped rows)
- U3: 4
- U4: 3
- U5: 4
- U6: 2
- U7: 4 (1 shared with U10-select)
- U8: 2
- U9: 3
- U10-validate: 3 (+1 in BUG)
- U10-select: 2 (1 shared with U7)
- U10-tabs: 1
- U10-check: 1
- U10-case: 3
- U10-capab: 1
- S-STYLE: 18 (9 blank-line, 9 import order)
- G1: 4 (+1 in BUG)
- G2: 6 (+1 in BUG)
- G3: 4
- G4: 2
- G5: 2
- G7: 6
- S-I18N, S-DS, S-GEST, S-CHARTS, S-LINT, S-PRICING, S-SI: 0 beyond the rows above

Worst 3 files:
1. `src/screens/forms/holding-form/holding-form.screen.tsx`: 3 bugs, U7, U1, U2, U3, U4, U5, G1-G4.
2. `src/screens/holding-detail/holding-detail.screen.tsx`: the perf bug, U7, U1, U3, U5, U8, U9, U10, G2, G4.
3. `src/screens/forms/holding-select-field/holding-select-field.component.tsx`: U9, U10-validate, U10-check, U10-case, U2, G1, S-STYLE.

#### Section C — Skill gaps

1. **U2 is in no skill.** No skill says comments explain only WHY, with no task or review ids and no history. The skills model the habit themselves, for example kiko-code-style SKILL.md:115-117 ("T25 review round 1, I4") and kiko-domain throughout. Owner: kiko-code-style.
2. **The fnts section describes instead of prescribing.** kiko-code-style SKILL.md:224-227 says "today every one of them is `guard` … no `pipe` composition is left". It has no U3 ban and no maybe/foldMap rule. Owner: kiko-code-style.
3. **kiko-design-system has no UX-patterns section.** The brief and the memory assume it exists. kiko-code-style "Form validation model" (:260-275) covers only "always enabled" and FieldError. It omits the red label (FieldLabel `invalid`), an error on every required field including dates and pickers, scroll-to-first-invalid, and "a blocked Save always shows at least one error" (BUG row 1). It also omits footer placement, tabs vs chips, select sheet for long lists, the checkmark, and capability visibility. Owner: kiko-design-system.
4. **U1 conflict.** kiko-code-style :458-462 bans any in-file JSX helper, which is stricter than U1's small-local exception. kiko-domain :881 documents `LoanFormBlock` "module-scope in holding-form.screen.tsx" as the pattern. Owners: kiko-code-style and kiko-domain. USER-DECISION: which rule wins.
5. **Buy/Sell conflict.** kiko-design-system :637 lists "the Lot form's buy/sell toggle" as an OptionPills consumer. The tabs rule makes it a SegmentedControl. Owner: kiko-design-system. USER-DECISION.
6. **No per-holding-type module checklist (U7).** kiko-domain describes each type's form piecemeal: :207-231 property/metal, bond ISIN mode, loan (:867+), each shaped differently and each "mirroring" another. Owner: kiko-domain. Add an "Adding a holding type" checklist: hook + section + spec entries for form, detail and derived entries.
7. **Term caps.** kiko-domain :945 caps only the loan `termMonths`. There is no rule that every term input is capped, which is how the deposit twin was missed. Owner: kiko-domain.
8. **Decimal-string validation.** No skill says to validate a decimal-string field with the same `normalizeDecimal` that stores it (BUG row 3). Owner: kiko-pricing.
9. **U5 alternative.** kiko-code-style ":177 ts-pattern" does not name a typed `Record<Union, X>` lookup as the accepted alternative, although the code uses it widely. Owner: kiko-code-style.
10. **Test conventions.** No skill asks for a shared live-query mock or typed fixture factories. 28 files hand-roll them. Owner: kiko-code-style (a testing section) or the qa agent.
11. **Stale Alert example.** kiko-code-style :250-255 cites contribution-form as the Alert example. That form still uses its own error keys, and the F4 shared `forms.fields.saveError*` rule is not written down. Owner: kiko-code-style.
12. **Stale pricing claim.** kiko-pricing says metal is always UAH but "not enforced by code". It is enforced, by the effect at holding-form.screen.tsx:1300-1304. Owner: kiko-pricing.

#### Section D — Mechanization candidates

- **U3 (Semgrep, Class A):**
  `pattern-either: ['$X === undefined ? undefined : $E', '$X !== undefined ? $E : undefined', '$X === null ? null : $E', '$X !== null ? $E : null', '$X ? $F($X, ...) : undefined', '$X ? $F($X, ...) : null']`, with paths `src/**`.
- **U2 (Semgrep, Class B at first):**
  `pattern-regex: '(//|/\*|\*).*\b(T\d{1,2}|F\d|round[- ]\d+|[Rr]eview [Ff]ocus|audit \d+|item \d+|spec \d+(\.\d+)?|Minor \d+|Requirement [A-Z]|[IMN]\d{1,2}a?)\b'` over `src/**`. Also match `it('…(T25)…')` test names.
- **Import order:** a node wrapper, `scripts/checks/import-order.sh`, in the fast tier. It checks the 3 groups, ascending ending-line length, the type tiebreak, and the bare-import barrier. The scratch checker I used shows the approach works.
- **Blank line before `return`/`if`/`for`/`while`/`switch`:** Biome and Semgrep cannot see blank lines. Use an awk or node check, or ESLint `padding-line-between-statements` for this one rule only.
- **Duplicated `startOfToday`:** Semgrep `new Date($D.getFullYear(), $D.getMonth(), $D.getDate())` outside `src/dates/**` → use `startOfLocalDay`.
- **Full-list lookup in forms:** Semgrep `useLiveQuery(holdingsRepo.allQuery(), ...)` in `src/screens/forms/**` → use `byIdQuery`.
- **Hand-rolled divider:** Semgrep `height: StyleSheet.hairlineWidth` in `src/screens/**` → `Divider`.
- **Hand-rolled select row:** Semgrep `<Pressable ... accessibilityState={{ selected: $S }} ...>` inside `<BottomSheet>` in `src/screens/**` → `SelectableRow`.
- **U5 (Class B):** Semgrep `$H.type === '$T'` or `$H?.type === '$T'` in `src/screens/**`.
- **U1:** Semgrep for `const $C: FC<$P> = ...` in a `*.screen.tsx` where `$C` is not the default export (metavariable-comparison).
- **Jest invariant for blocked Save (catches BUG 1):** per holding type, leave each required field empty in turn, press Save, and expect at least one `*-error` node.
- **Jest invariant for term caps (catches BUG 2):** every termMonths reason function rejects the cap + 1.
- **Jest invariant for decimal fields (catches BUG 3):** validation passes if and only if `normalizeDecimal` is non-null, for inputs [".75", "1,", "0,9999"].
- **Jest invariant for headings:** every key passed to `<Text variant="heading">` or to SummaryTable `title=` is in TITLE_KEYS (a source grep). This catches the `nextInstallment` row.

#### Section E — Fix batches (in order)

1. **Bugs.** Behavior changes, feat session. Fix BUG rows 1-3 (bond date reasons, deposit term cap, purity via `normalizeDecimal`) and add the missing tests.
2. **Perf memo.** holding-detail `now` memo keys. Behavior-free.
3. **Comments only.** The U2 scrub plus the G1 stale comments, file by file.
4. **Format only.** S-STYLE import re-sort and blank lines, across all 18 rows.
5. **fnts conversions.** U3 and U4 to maybe/fold/foldMap, plus the shared `deriveTestID`.
6. **Small twins (G2).** `startOfLocalDay`, `byIdQuery`, single validity checks, the Divider in holding-detail, and `holdingsRepo.appendLot` (G5). Contribution Alert keys: the message text changes, so the user reviews that string first.
7. **Field errors.** Add `error` to ChipRow and HoldingSelectField. Wire the contribution rows' `error`. This changes the look: red labels.
8. **Select row.** HoldingSelectField → SelectableRow (U9 and U10-check; the checkmark moves, a visual change).
9. **Holding-detail extraction (U1, U8, G4).** `LedgerRow`, `ValueHeaderSecondary`, a styles file and a data hook; share Home's TransactionRow and day header.
10. **Holding-form per-type restructure.** feat-refactor: U7, U5, G4, U1 LoanFormBlock, the label module, G3 renames, then split the tests (G7) and add the shared live-query mock.
11. **Holding-detail per-type spec** (U7, U5).
12. **i18n.** `nextInstallment` to Title Case plus TITLE_KEYS; separate sheet-title keys for the two select fields. The user reviews the strings before deploy.
13. **User decisions (USER-DECISION rows):**
    - Holding type and property category: chips or select sheet?
    - Lot Buy/Sell: SegmentedControl?
    - Priced holdings: show cost basis and gain?
    - U1 vs kiko-code-style: which one-component rule wins?

No files were written. The scratch import checker is at /private/tmp/claude-501/-Users-drizzer14-orca-workspaces-pff-ios-codebase-review/c208bcbe-e4d3-4bbe-b22f-553388e72602/scratchpad/imports.py.


### R2 — Transaction-form, account-form and form fields

#### Section B — Per-rule counts
- BUG 3 · U10-validate 6 · U10-capab 2 · U10-case 1 · U10-tabs 1
- U1 2 · U2 15 · U3 3 · U4 2 · U5 2 · U6 2 · U7 3 · U8 1 · U9 4
- S-DS 3 · S-I18N 1 · S-ARCH 1 · S-STYLE 3 · S-STYLE (imports) 4 · S-COMPL 0
- G1 2 · G2 9 · G3 2 · G4 2 · G7 3
- Total 80 rows.

Worst files:
1. `src/screens/forms/transaction-form/transaction-form.screen.tsx` — all 3 bugs, U1, G4, the 3 mirrored validation families.
2. `src/screens/forms/account-form/account-form.screen.tsx` — U5/U7/G4, non-atomic writes, hardcoded provider.
3. `src/screens/forms/transaction-form/transaction-form.screen.test.tsx` — task-ID names, dead mocks, implementation-detail asserts.

#### Section C — Skill gaps
1. **kiko-design-system** has no "UX patterns" section. Memory (`ui-consistency-patterns…`) says that section is the authoritative home for: footer action, validate on press with the error under the field and a red label, scroll to first invalid, tabs vs chips, checkmark, capability icons. The section does not exist. Owner: kiko-design-system.
2. **kiko-code-style:260-275 "Form validation model"** is out of date.
   - It still describes a `showNameError`-style flag and says "shows its message via FieldError".
   - It does not say to prefer the field's own `error` prop (red label) and show errors on every invalid field. It does not say to scroll to the first invalid field in visual order.
   - This gap produced the external-FieldError pickers and the one-error-at-a-time model. Owner: kiko-code-style.
3. **kiko-code-style:214-227 (fnts)** only describes current usage ("today every one of them is `guard` … no `pipe` … left"). It does not ban the nullable-map ternary (U3). It does not say fnts comes first. This contradicts the `use-fnts-first` memory. Owner: kiko-code-style.
4. **kiko-code-style:439-466** says every JSX-returning helper must go to its own file. It has no carve-out for the user's allowed small, local, non-exported helper, and no "hooks: one exported unit per file" rule. Owner: kiko-code-style.
5. **No skill states rule U2** (comments explain WHY only; no task IDs or history). The skills themselves model the violation: kiko-code-style:116,136 ("T25 review round 1, I4"); kiko-design-system:686-743 ("F3 fix round 1, I3", "F3 item 9"). Owner: kiko-code-style, then a scribe sweep of all skills.
6. **kiko-code-style ts-pattern section (177-212)** does not cover boolean flags derived from a union (`isExchange`/`isSplit`) branched in if-chains. That is how U5 slips through. Owner: kiko-code-style.
7. **kiko-design-system:569-571 and 588-598** describe DateField/TimeField as separate field implementations. They do not require them to compose `FieldTrigger`, which invites the copy. Owner: kiko-design-system.
8. **kiko-translator:106-117 (two roles need two keys)** is not reflected in the select-field family: the API reuses the field `label` as the sheet title. `accountDetail.synchronization` is rendered as a heading but is missing from `TITLE_KEYS`. Owner: kiko-translator + kiko-design-system.
9. **kiko-domain** does not own a "can take a manual transaction" predicate. It lives in two screens, and the split-return picker skipped it (a bug above). Owner: kiko-domain.
10. **kiko-code-style:279-285** says import order "cannot be mechanized". Biome cannot do it, but a ~60-line script can (see D). Owner: kiko-code-style + kiko-linter.
11. Out-of-area drift: the design-system `confirm-sheet.props.d.ts` doc still cites the transaction-form delete, which is gone. Owner: kiko-design-system.

#### Section D — Mechanization candidates
1. **Semgrep `kiko-no-nullable-map-ternary`** (U3), Class B:
   ```yaml
   pattern-either:
     - pattern: '$X === undefined ? undefined : $E'
     - pattern: '$X !== undefined ? $E : undefined'
     - pattern: '$X === null ? null : $E'
     - pattern: '$X !== null ? $E : null'
     - pattern: '$X === null ? undefined : $E'
     - pattern: '$X ? $X.$M(...) : null'
   ```
2. **Semgrep: raw icon size.**
   ```yaml
   pattern: '<SymbolIcon ... size={$N} ... />'
   metavariable-regex: { metavariable: $N, regex: '^\d+$' }
   ```
3. **Semgrep: raw style literals.** Flag `opacity: $N` in `*.styles.ts` and component styles (use `DISABLED_OPACITY`), and `borderRadius: 999` (use a radii token).
4. **Semgrep: JSX helpers inside a screen.** In `**/*.screen.tsx`, flag `const render$X = (...) => ...` and `export const $X = ...` (a non-default runtime export).
5. **Semgrep: task-ID / history comments** (U2), Class B, on `src/**`:
   ```yaml
   pattern-regex: '//.*\b(T\d{1,2}|F\d( item| fix)|[Rr]ound[- ]\d|item \d+|Requirement [A-Z]|used to|[Pp]reviously|no longer)\b'
   ```
6. **Script check `check:imports`.** Import order is deterministic (3 groups; sort by the length of each import's last line; side-effect imports are barriers). `r2_imports.py` in the scratchpad already finds 236/982 files. Wire it as a wrapper in `scripts/checks/`. The same script can check the blank line before `if`/`return`/`for` (`r2_blank.py`).
7. **Jest invariants:**
   - Every `FieldTrigger` consumer (`CategoryField`, `HoldingSelectField`) forwards `error` and renders `${testID}-error`.
   - Every `bankCatalog` entry shows the column-mapping capability icon in `BankTypeField`.
   - A blank transaction form: the first field blamed on Save is the topmost invalid one, per mode.
   - The split-return picker never offers a ledgerless holding type.
8. **Semgrep in tests:** flag a hand-rolled `toSQL: () => ({ sql: '' ...` in `*.test.tsx` (use the shared `fakeQuery`).

#### Section E — Fix batches, in order
1. **Bug fixes** (behavior changes, one commit each, each with a regression test): the no-holding validation on empty-create; stale dependent picks on a primary-holding change; the ledgerless filter for split returns; field order for first-invalid.
2. **Picker errors:** add `error` to `CategoryField` (and `HoldingSelectField`, other reviewer's area). Drop the external `FieldError` wrappers in transaction-form, `ExchangeFields` and `ConvertExchangeFields`. Behavior: the label turns red.
3. **`DateField`/`TimeField` compose `FieldTrigger`.** Delete the duplicate styles and `deriveErrorTestID`. `TimeField` gains `required`/`error`.
4. **Design tokens:** `ChipRow` (icon size, `DISABLED_OPACITY`, `Box direction`, hitSlop); `ColorPicker` (radii, `FieldLabel`, 44pt target, translated a11y name); transaction-form icon size and notice `Box background`.
5. **account-form writes:** one atomic `update` with `icon`; `connectable` instead of `'monobank'`; one `blockOnEmptyName`; one connect helper via `either`.
6. **U3/U4:** replace the nullable ternaries with `maybe`/`foldMap` (bank-type-field, date-field, transaction-form).
7. **Comment sweep** (U2 + stale G3), file by file, behavior-free; tests included.
8. **Mechanical sweep:** import order + blank lines + JSX sibling spacing. Land the `check:imports` script first so it stays fixed.
9. **transaction-form decomposition** (behavior-free, several commits):
   - Styles file.
   - `canSaveSplit` and the option builders moved to domain or co-located units.
   - One `saveBlock` replacing the 3 families, with `match` on a variant union.
   - `render*` functions become component folders.
   - Hooks for data, hydration, split rows and the override sheet.
10. **account-form structure:** per-kind section components; align icon seeding and naming with holding-form. Coordinate with the feature session (`feat-refactor`).
11. **Shared form plumbing:** a `useScrollToField()` hook and a `showSaveErrorAlert` helper across the 8 screens.
12. **Test hygiene:** `fakeQuery` helper; fix the stale account-form and bank-count tests; remove the dead mock; role-based Save asserts.
13. **User decisions to ask for:**
    - Tabs vs sheet for the transaction type.
    - A generic `SelectField` vs keeping `AccountKindField`/`ModeSelectField` as twins.
    - The `ChipRow` pick-list hack in `DescriptionSuggestions`.
    - Blank-means-0 for the cash initial value.
    - Sheet-title keys for the select fields.


### R3 — Statistics, home and accounts screens

#### Section B — Per-rule counts

BUG 5 · S-STYLE 13 · M-import-ordering-length-sort 24 · S-DS 8 · S-GEST 1 · S-I18N 1 · U10 3 (case 1, validate 1, tabs 1) · U5 3 · U4 1 · U6 2 · U7 2 · U8 3 · U9 2 · U2 25 · U1 2 · G1 11 · G2 13 · G3 1 · G4 3 · G5 1 · G6 4 · G7 7 · S-COMPL 0 · U3 0 (no strict nullable-map ternary in this area).

The 3 worst files:
1. **src/screens/statistics/statistics.screen.tsx** — 2 bugs, a 975-line component doing four jobs, duplicated pipelines, ids in comments, unsorted imports.
2. **src/screens/home/home.screen.tsx** — the account-filter bug twin, the Divider re-implementation, helpers in the body, duplicated state logic.
3. **src/screens/statistics/net-worth-line/net-worth-line.component.tsx** — a 720-line mix of geometry and rendering, copied by category-trend-line, R5-D "exploratory" comments.

#### Section C — Skill gaps

- **kiko-code-style**
  - No rule for U2 (comments explain why only: no ids, dates or history).
  - No U3 ban on the nullable-map ternary.
  - Lines 220-227 describe current fnts use ("today every one of them is `guard`") instead of prescribing it. This contradicts use-fnts-first.
  - Lines 458-462 say "a function that returns JSX is a component, even a small render row helper; extract it". This contradicts U1's exception for a small, local, non-exported helper. USER-DECISION: which rule wins.
  - No rule on `@kiko/*` alias versus relative imports.
  - No "one exported unit per file" rule for hooks and component files.
  - No rule that a filter or selection is keyed by a stable id, never a display name.
- **kiko-design-system**
  - It has no UX-patterns section, although memory calls it the authoritative home for U10: footer, Save always enabled, tabs versus chips, checkmark, capability visibility.
  - Lines 130-147 say `ManualCategoryRow` paints the accent itself with `color={checked ? undefined : option.color}`. The code now delegates to SelectableRow (trend-filter-field.component.tsx:73-91). This is drift.
  - Lines 633-678 document the trend-filter mode as OptionPills. That contradicts U10-tabs. USER-DECISION.
  - No shared filter-chip trigger or EmptyState component exists, and the skill does not ask for one.
- **kiko-gestures** lines 104-107 say the account-detail holding grid has "2 columns". The code has `columns={1}` (account-detail.screen.tsx:266). The skill should also say whether `rowGap` is part of the shared tuning.
- **kiko-charts**
  - Lines 16-27 say every chart, pie included, uses the fixed VIEW_WIDTH stretch. PieChart uses a fixed pixel `size`.
  - Lines 211-222 describe category-trend-line as "mirroring" net-worth-line's builders. That invites copying; the skill should ask for a shared axis module.
  - Lines 144-170 contain history and task ids.
- **kiko-translator**: the casing test blanks out interpolations, so "{{count}} Category" and "by {{measure}}" (a capital inserted mid-string) pass. The skill should require an interpolated word to be cased for the place it is inserted.
- **kiko-architecture**: no rule that a domain pipeline, such as the exclusion union and projections, belongs in src/statistics and not in a screen. No shared data-prelude hook is prescribed (see the base-currency row in G2).

#### Section D — Mechanization candidates

1. **Import length-sort**: a `scripts/checks/import-order` script. Biome cannot sort by length. Algorithm: groups by `@`/bare, `../`, `./`; sort key is the length of the ending line; bare side-effect imports are barriers.
2. **Blank line before `return`/`if`/`for`/`while`/`switch`**, unless the line follows `{`: a script check. Biome has no equivalent rule.
3. **Semgrep, ids in comments**: `pattern-regex: '//.*\b(T\d{1,2}|F\d|R\d-[A-Z]|[IMNCDG]\d{1,2}[a-z]?|round \d|spec §|Review Focus)\b'` on `src/**`, Class B.
4. **Semgrep, raw icon size**: `<$C ... size={$N} ... />` with `metavariable-regex $N: '^\d+$'` for `$C` in SymbolIcon or EntityIconTile. Also `const $X_ICON_SIZE = $N`.
5. **Semgrep, raw typography**: `fontSize: $N` or `lineHeight: $N` with a numeric literal in `*.styles.ts`.
6. **Semgrep, cross-screen import**: `pattern-regex: "from '\.\./(home|statistics|accounts|account-detail|holding-detail|statement-import)/"` under `src/screens/*/`, excluding the importing folder's own name.
7. **Semgrep, fire-and-forget repo write** in a JSX handler: `$A={() => $R.$M(...)}` with `metavariable-regex $R: '\w+Repo$'`, Class B.
8. **Semgrep, disabled Save**: `<Button ... disabled={$X} ...>` inside `<SheetFooter>` or a Screen `footer`, Class B (U10-validate).
9. **Jest invariant for casing**: substitute sample values into `{{...}}` and run the role check on the rendered string.
10. **jscpd**: a per-folder threshold, or a lower `minTokens`, for `src/screens/statistics`. The duplication between the two chart files passed the global 5% gate.
11. **Semgrep, grid literals**: `activeItemScale={1.03}` or `autoScrollActivationOffset={75}` as literals should use the shared constant.
12. **FilterMenu unit test**: option `value`s must be unique, and none may equal the "All" sentinel.

#### Section E — Fix batches, in order

1. **Account filter keyed by id plus a safe sentinel.** BUG rows 1-3 and the account-options G2 row. Behavior change; small.
2. **Hidden category selection** (BUG row 4). Needs the user decision first. Add the bar-chart empty label (BUG row 5).
3. **Error handling for repo writes.** All G6 rows plus the G5 row (inject `onDelete`).
4. **Comment hygiene.** All U2 rows plus the stale-comment parts of G1. Behavior-free.
5. **Import re-sort and alias consistency.** All M-import rows plus the alias U6 row. Behavior-free.
6. **Blank lines and helper placement.** The S-STYLE blank-line parts and module-scope helpers. Behavior-free.
7. **Dead code.** The remaining G1 rows plus the U1 `FILTER_ALL` shim.
8. **Design tokens and shared primitives.** S-DS rows, both U9 rows, the S-GEST constant.
9. **Shared chip trigger.** The chip G2 row plus the 44pt touch targets.
10. **Relocate shared components and hooks.** U8 rows plus the date-range i18n namespace.
11. **Shared chart axis module and geometry module.** The chart G2 row, the net-worth-line G4 row, the U1 exports and the U7 testID row.
12. **Screen splits.** Statistics and Home G4 rows, the data-prelude G2 row, `activeHoldings`, the projections, `toggleSetValue`, `useDateRangeState`, and the AccountCard and AccountsGrid extraction (S-STYLE and U7).
13. **TrendFilterField UX.** U10-validate, U10-tabs, U5 and U10-case. Needs the user decisions.
14. **Test support.** All G7 rows.
15. **Holding-type label map.** Coordinate with the holding-form refactor (feat-refactor).
16. **Scribe pass for Section C drift.** Blocked on the U1 and U10-tabs decisions.


### R4 — Account-detail, settings, statement-import and column-mapping screens (paths relative to `src/screens/` unless they start with `src/`)

#### Section B — PER-RULE COUNTS

BUG 10 · S-COMPL 3 · U10 11 (tabs 2, check 2, validate 4, case 1, stop 1, footer 1) · M-button-hierarchy-user-spec 3 · S-DS 1 · S-STYLE 4 · S-I18N 1 · U1 5 · U2 24 · U3 6 · U4 3 · U5 6 · U6 6 · U7 5 · U8 5 · U9 1 · G1 3 · G2 7 · G3 3 · G4 2 · G5 3 · G6 3 · G7 5 · M-import-ordering-length-sort 20.

Three rows count under a second rule id as well, but I counted them once, under their first id: the add-bank-sheet row (U10-check / U10-capab / U9), the import-data row (U10-validate / U9), and the .xls row (BUG, G2 twin). The U9 and G2 counts above therefore exclude them.

Three worst files:
- **`column-mapping/column-mapping.screen.tsx`:** 4 BUGs, U1, U3, U4, U5, U6, U10, G1, G2, G4, G5, U2, import order.
- **`statement-import/statement-import.screen.tsx`:** BUG ×2, 5.6 dead paths, U1, U3, U4, U5, U6, G2, G4, G5, U2, import order.
- **`settings/categories/categories.screen.tsx`:** BUG, U1, U8, button spec, U10-footer, G1, G6, U2, import order.

#### Section C — SKILL GAPS

1. **kiko-design-system has no "UX patterns" section.** The ui-consistency memory calls that section the authoritative home, but it does not exist. U10 is scattered or missing: footer placement, validate-on-press "Option A" (error under the field, red label, no outline, scroll to first invalid), tabs vs chips, select sheets, checkmark, capability visibility, copy-label feedback. Owner: kiko-design-system.
2. **Tabs vs chips contradicts the user rule.** kiko-statement-import SKILL.md:321-345 and kiko-design-system SKILL.md:737-743 prescribe `SegmentedControl` for encoding and decimal separator. The user rule (2026-09-24) says chips. Owners: both skills.
3. **kiko-design-system SKILL.md:185-196 documents a prop that does not exist.** It describes `Screen.fillHeight` for Settings' About block. There is no such prop (no hits under `src/`), and the code uses `footer`. Owner: kiko-design-system; USER-DECISION where About goes.
4. **Error placement conflicts.** kiko-design-system SKILL.md:581-586 places FieldError "next to a blocked field or footer Save button". This conflicts with U10 (no footer errors). kiko-code-style SKILL.md:260-275 ("Form validation model") lacks Option A, and does not cover Import or Connect actions. Owner: kiko-code-style.
5. **One component per file.** kiko-code-style SKILL.md:441-462 says "exactly one component per file … even a small render row helper". U1 allows a small, local, non-exported helper. Align them. Owner: kiko-code-style.
6. **fnts section is descriptive.** kiko-code-style SKILL.md:214-227 says "today every one of them is `guard`". It has no ban on the nullable-map ternary (U3) and no maybe/foldMap guidance. This is the exact drift the use-fnts-first memory names. Owner: kiko-code-style.
7. **U2 is missing and the skills model the anti-pattern.** kiko-code-style has no U2 rule (no ids or history in comments). The skills are full of "F3 fix round 2, M5" style references (kiko-statement-import SKILL.md:258-345, kiko-design-system SKILL.md:685-747, kiko-translator SKILL.md:6-8), so agents copy the pattern. Owner: kiko-code-style for the rule; a scribe sweep for the skills.
8. **Categories star size drift.** kiko-design-system SKILL.md:268-273 says the categories star is `size="small"`; the code uses `compact` (categories.screen.tsx:207,219). USER-DECISION.
9. **Sync button treatment.** The button-hierarchy memory ("Sync now" = faint tint) is not in kiko-design-system's Button section, and the code comments say `primary` is deliberate. Owner: kiko-design-system; USER-DECISION.
10. **5.6 rule gaps.** kiko-architecture and kiko-compliance do not cover unreachable code for an unbuilt entry point (the Share Extension). They also do not cover a build const gating UI (`APP_LOCK_ENABLED`): kiko-architecture:639-650 calls it an invariant, but the kiko-compliance 5.6 question flags it. Owner: kiko-compliance; add an explicit rule or exception.
11. **kiko-translator's final-stop test only checks keys whose name ends in `*Error`.** Errors like `invalidToken`, `couldNotConnect*` and `rowError.*` escape it. Owner: kiko-translator; add an explicit `ERROR_KEYS` list like `TITLE_KEYS`.
12. **No rule for where cross-screen shared components live.** Examples: ClipboardTextField in account-detail, used by settings; TransactionCard in home. Owner: kiko-code-style (folder section).
13. **kiko-statement-import does not list the twin pairs.** The statement-import and column-mapping screens share the file read, the import/sheet flow, the `.xls` handling and the 0-row gate, but the skill does not name them as twins (fix-divergent-twins memory). Owner: kiko-statement-import.

#### Section D — MECHANIZATION CANDIDATES

1. **Semgrep: nullable-map ternary (U3), WARNING.**
```yaml
- id: kiko-no-nullable-map-ternary
  languages: [typescript]
  severity: WARNING
  message: Use foldMap(maybe(x), f) from fnts/maybe.
  pattern-either:
    - pattern: '$X === undefined ? undefined : $E'
    - pattern: '$X !== undefined ? $E : undefined'
    - pattern: '$X === null ? null : $E'
    - pattern: '$X !== null ? $E : null'
    - pattern: '$X == null ? $X : $E'
```
2. **Semgrep: task ids in comments (U2).** Rule `kiko-no-task-ids-in-comments`, `languages: [generic]`, paths `src/**`:
```
pattern-regex: '(//|\*).*\b(F[0-9]+( fix round| item| audit)?|T[0-9]+\b|[Rr]ound[- ]?[0-9]+|[Ii]tems? [0-9]+|audit [0-9]+|device-feedback|Review Focus|R[0-9]-[0-9]|Task [0-9])'
```
   Also catch ids in `it(`/`describe(` titles.
3. **Semgrep: a disabled submit gate (U10-validate).** Pattern `<Button ... disabled={!$X} ... />` with `metavariable-regex: $X: '^(can|is)[A-Z]'`. It stays silent for `isSubmitting` / `importing`.
4. **Semgrep: `<SelectableRow ... selected={false} ... />` (U10-check).**
5. **Semgrep: a hand-rolled divider (U9).** Pattern `<Box style={$S.divider} />`.
6. **Semgrep: a hand-rolled error caption (U9).** Pattern `<Text variant="caption" tone="negative">...</Text>`; use FieldError.
7. **Semgrep: a hardcoded URL in `src/screens/**` (S-STYLE externalize).** `pattern-regex: "'https?://[^']+'"`.
8. **Semgrep: English text in a template a11y label (S-I18N).** `pattern-regex: 'accessibilityLabel=\{`[^`]*\$\{[^}]+\}\s+[a-z]+`\}'`.
9. **Jest invariant:** `providerCatalog` ids === `bankProviderRegistry` keys. It replaces the hiding filter.
10. **Jest invariant:** every error-role key in en and uk ends in "." (an explicit `ERROR_KEYS` list).
11. **Custom harness check `check:imports`.** It checks the group order, the within-group ending-line-length sort, and the side-effect barrier. My scratch awk/python script shows the check is easy to write; Biome cannot express it. The blank line before `return`/`if`/`for` and between JSX siblings can go in the same script.
12. **Semgrep: an inline `jest.mock('…use-live-query'` once a shared factory exists (G7), WARNING.**

#### Section E — FIX BATCHES (in order)

1. **Correctness, each its own small commit.** These change behavior.
   - (a) Empty `dateSpan` + test.
   - (b) Fixed currency from the target holding.
   - (c) Split the mapping-save try.
   - (d) Category blank title.
   - (e) `useSubmitOnce` in add-category-row and both import screens.
   - (f) Gate the column-mapping init on the queries.
   - (g) `.xls` on statement-import.
   - (h) `keepLocalCopy` error handling unified.
   - (i) The 0-row Import feedback, after the USER-DECISION.
2. **Compliance.**
   - Make `accountId` required and delete the Share-Extension branches.
   - Add the catalog/registry invariant test and delete the filter.
   - Resolve `APP_LOCK_ENABLED` per the USER-DECISION.
3. **UX consistency.**
   - Encoding/decimal to chips; crypto source to tabs.
   - TargetHoldingSheet checkmark.
   - AddBankProviderSheet to SelectableRow.
   - AddCategoryRow and import-data validate-on-press with FieldError.
   - ColumnSelectField sheet-title keys; en/uk final stops.
   - The button variants and categories footer, after the USER-DECISION.
4. **Structure, behavior-free.**
   - U1 extractions (StatementPreviewBlock, ColumnMappingForm, CategoryListRow, TargetHoldingRow).
   - Styles co-location (U8), props `.d.ts` files, the app-lock barrel.
   - `Divider` swap.
   - Move the shared components out of the screen folders.
5. **fnts / U3 / U4 / U5 rewrites, behavior-free.**
6. **Twins (G2):**
   - `useStatementFile` + `useImportFlow`
   - `ConnectedSyncBlock`
   - the shared link component
   - the file-name / pick helper
   - one `AppTheme`
   - one form-state type
7. **G4 / G5:**
   - `useColumnMappingForm` reducer + a memoized preview
   - move the decode policy and the mapping-save keying into src/statement-import
   - a typed `importData` error
8. **Comments:** the U2 sweep plus the stale G1 comments; delete `resultBlock` and the `DisconnectCopy` generality.
9. **Tests (G7):**
   - shared `useLiveQuery` / Button mock factories
   - delete the stale mocks
   - move section behavior out of the account-detail screen test
10. **Import re-sort + blank lines (S-STYLE, M-import-ordering).** Do this mechanical pass last, after the file moves, so it does not conflict with them. Then land `check:imports` (D11) so the problem does not come back.


### R5 — Design system and calendar

#### Section B — Counts

S-DS 12 · S-STYLE 49 · S-I18N 1 · U1 0 · U2 76 · U3 6 · U4 1 · U5 2 · U6 3 · U7 3 · U8 3 · U9 2 · U10 1 · M-liquid-glass 1 · M-button-hierarchy 1 · G1 17 · G2 10 · G3 1 · G4 2 · G5 4 · G7 12.

Worst 3 files:
1. glass-surface/ (props, component, styles, test): dead content-card variants plus stale docs and a stale `isStableGlass` reference.
2. bottom-sheet.component.tsx: U3, G2, G4, G5, U2 and import order.
3. currency-field.component.tsx: U3, U4, U10, G5, the column-mapping divergent twin, and a dead `required` prop.

#### Section C — Skill gaps

1. **kiko-design-system:185-196** documents a Screen `fillHeight` prop that does not exist. Grep finds it only in a comment at settings.screen.test.tsx:416. Owner: kiko-design-system.
2. **kiko-design-system:298-338** claims these still use GlassSurface: entity cards (`tint`), ledger rows (`transparent bloom`) and the Home transaction row (`material`). The real consumers are only BottomSheet, the keyboard accessory and the FAB. The section contradicts the nav-layer-only rule. Owner: kiko-design-system.
3. **kiko-design-system:633-637** lists "the icon-picker modal" as an OptionPills consumer. It is not one. The real consumers are LanguageSwitch, the trend filter and the lot form.
4. **kiko-design-system:749-754** lists BarChart, PieChart and NetWorthLine in the design-system component set. They live in src/screens/statistics/.
5. **Component list drift.** The frontmatter and "Component set" omit SheetFooter, EditHeaderButton, IconEditor, IconPickerModal, LanguageSwitch and useKeyboardDoneAccessory. Divider is in the frontmatter but has no body entry. bottom-sheet.styles.ts:75 cites a "BottomSheet header" section that does not exist.
6. **kiko-design-system:737-748** says the encoding and decimal-separator selectors use SegmentedControl. That contradicts the user rule of 2026-09-24: chips for a value selection, tabs only when the visible fields change. The skill has no UX-patterns section at all, although the memory says it is the authoritative home. Missing items: footer primary action, tabs vs chips, select sheet, checkmark, capability visibility, casing and full stops. Owner: kiko-design-system.
7. **kiko-code-style:458-462** says to extract every JSX-returning helper into its own file. U1 allows a small local non-exported helper. Owner: kiko-code-style (USER-DECISION: confirm the U1 exception).
8. **kiko-code-style:224-227** fnts section is still descriptive ("today every one is guard"). It has no ban on the nullable-map ternary (U3) and no `deriveTestID` helper rule. Owner: kiko-code-style.
9. **No skill states U2 (comments explain WHY only).** The skills themselves are full of task ids ("F3 fix round 1, I3", "T25", "T27 round 1, I1", "device-feedback-round-F1") and agents copy that style into code. Owners: kiko-code-style (rule) and scribe (skill cleanup).
10. **kiko-design-system "Touch targets"** requires 44pt but defines no token; 6 files redefine it.
11. **kiko-translator** has no rule that shared design-system components use `common.*` keys.

#### Section D — Mechanization candidates

1. **Import order and blank lines.** Semgrep and Biome cannot do this. A `scripts/checks/imports.sh` node script can: 3 groups, length sort, side-effect barrier, blank line before `return`/`if`. The checker I ran is about 40 lines and found 45 files.
2. **U3 banned ternary.** Semgrep draft:
   ```yaml
   - id: kiko-no-nullable-map-ternary
     severity: WARNING
     languages: [typescript]
     pattern-either:
       - pattern: '$X === undefined ? undefined : $E'
       - pattern: '$X !== undefined ? $E : undefined'
       - pattern: '$X == null ? null : $E'
       - pattern: '$X ? `...${$X}...` : undefined'
   ```
3. **GlassSurface nav-layer allowlist.** `pattern: <GlassSurface ... />` with `paths.exclude` covering bottom-sheet/**, keyboard-done-accessory/**, add-transaction-fab/** and glass-surface/**. Severity ERROR.
4. **Raw icon size.** `pattern: <SymbolIcon ... size={$N} ... />` with `metavariable-regex: {metavariable: $N, regex: '^\d+$'}`. Also a raw `borderRadius: $N` numeric literal in `*.styles.ts`.
5. **U2 history comments.** Grep rule on `//` comments under src/: `\b(F[0-9]\b|T[0-9]{2}\b|R[0-9]-[0-9]|fix round|round-?[0-9]|builds? [0-9]{2}|20[0-9]{2}-[0-9]{2}-[0-9]{2}|Option A|§[0-9])`.
6. **Duplicated theme type.** `pattern: type $T = UnistylesThemes[keyof UnistylesThemes];` flagged outside unistyles.ts.
7. **Hand-rolled Text mocks.** `pattern: jest.mock('../text', ...)` in tests → WARNING pointing to test-support.
8. **Feature i18n keys in the design system.** In `src/design-system/**`, `t('$K')` with `metavariable-regex` not matching `^(common|calendar|currencyNames|language)\.` → WARNING.
9. **Jest invariant for the skill list.** Every `src/design-system/components/*` folder must be named in kiko-design-system SKILL.md. Same pattern as settings-columns.test.ts.

#### Section E — Fix batches

All behavior-free unless marked. Run in this order.

1. **Shared helpers.** Export `AppTheme` from unistyles.ts; add a touch-target token module; add `deriveTestID` (fnts). Then replace the U3 sites and the G2 44/34/hitSlop, testID and cap-math duplicates.
2. **Dead code.** GlassSurface `tint`/`translucentStrong`/`padding` with their styles, tokens and tests; `sheetBackground`; Button `trailingIcon`; BottomSheet `animationType`/`maxHeight`; Box `background`; EntityIconTile `size`; SymbolIcon `fallbackName`; TextField `returnKeyType`; Card `'full'`; the EditHeaderButton label; the calendar-header duplicate flexDirection.
3. **Comment purge.** All U2 rows. Fix the stale references (`isStableGlass`, `backdropGlass`, text.props.ts, light theme, `useAnimatedKeyboard`, `sheetBackground`) and rewrite the GlassSurface docs as nav-layer only (M-liquid-glass row).
4. **Formatting.** Import re-sort, blank lines, JSX sibling blank lines, explicit return, `.concat`, full variable names, the single unistyles import.
5. **Tests.** Shared Text, liquid-glass and safe-area mock factories in test-support. Merge the `.label-variant` and `.leading-text-mark-variant` files into their component tests. Day-cell test uses `buildCalendarTheme`. Move the palette assertions to palette.test.ts. Delete redundant tests.
6. **Structure.** Folder per unit at the design-system root. Move icon-pools and the currency ordering to the domain. Add props files for CardContextMenu and EditHeaderButton. Switch the icon-picker to `common.*` keys (needs en/uk key review before deploy). Optional `symbol-icon` rename.
7. **Refactors (low risk).** BottomSheet: `useKeyboardHeight` + `SheetScrim`. Text and Divider widen RN props and spread `{...props}`. SelectableRow tone/color idiom. Button and MoneyText `match`.
8. **Behavior and UX (device check, some user decisions).**
   - Calendar-header icon-only Buttons (44pt target).
   - CurrencyField `error` passthrough (feat-refactor).
   - column-mapping `onOpenChange` twin fix.
   - One Cancel style (USER-DECISION).
   - OptionPills/ChipRow merge (USER-DECISION).
   - Monday-first calendar (USER-DECISION).
   - Remove the bloom re-sample (device check).


### R6 — Holdings, accounts, categories, bonds and statistics domain

#### Section B: Per-rule counts

150 rows in total:

| Rule | Rows |
|---|---|
| S-STYLE | 44 |
| U2 | 40 |
| G1 | 16 |
| G2 | 11 (2 of them bugs) |
| U5 | 8 |
| U6 | 7 |
| U7 | 6 (1 latent bug) |
| G7 | 6 |
| U3 | 4 |
| U8 | 3 |
| S-DOMAIN | 2 (both bugs) |
| G3 | 2 |
| S-PRICING | 1 |

No findings under U1, U4 as its own row (folded into the G2 exchange-prefill row), U9, U10, S-I18N, S-COMPL, G4, G5 or G6.

Worst files:
1. `src/accounts/accounts.repo.ts`: the price-series bug, dead `archive`, the misleading `nextSortOrder`, flat folder, alias mix, imports, blank lines, history comments.
2. `src/holdings/holding-value/holding-value.ts`: twin coupon/ledger logic, the metal currency leak, `switch` with default, the U7 per-type layout, stale and history comments.
3. `src/holdings/repo/holdings.repo.ts`: repeated ledger-insert literal, three dead members, U3/U5, history comments.

#### Section C: Skill gaps

- **kiko-code-style has no U2 rule, and the skills model the opposite.** No skill says "comments explain WHY only; no task ids or history". kiko-code-style cites "T25 review round 1, I4" at L115-116 and "T25 review round 1, I1/I3" at L136. kiko-domain is full of T25/I1/N10a/M2. Agents copy that style into code. kiko-code-style should own the rule; scribe should strip ids from kiko-domain.
- **The fnts section is descriptive, not prescriptive.** kiko-code-style L220-227 says "today every one of them is guard … no pipe composition is left". It has no U3 ban on the nullable-map ternary. There is no `fnts/maybe` use anywhere in `src`. kiko-code-style should own the fix.
- **The skill's co-location example contradicts the code.** kiko-code-style L497-502 shows a flat `holdings/holdings.repo.ts`. The code uses `holdings/repo/holdings.repo.ts`, and accounts is the only flat one. kiko-code-style should own the fix.
- **No rule for `@kiko/*` versus `../` imports.** The memory file-structure-colocation says to use the alias for cross-feature imports. Files mix both. kiko-code-style should own the rule. USER-DECISION.
- **"Externalize hardcoded config" versus the NBU clients.** kiko-code-style L542-553 says public URLs belong in `.env`. Every NBU client keeps its endpoint inline, and kiko-domain/kiko-pricing present them as "the pattern". USER-DECISION; kiko-code-style should own the outcome.
- **"Convert to Money at the repository boundary" is not what the code does.** kiko-domain L301-304 and kiko-architecture L178-180 both say it. No repo returns `Money`: reads return raw rows, and the value modules pass bare minor-unit numbers, which is how the metal-is-UAH assumption leaked. kiko-domain should own the fix. USER-DECISION.
- **kiko-pricing blesses an unenforced money invariant.** L147-150 say metal is "UAH … documented assumption, not enforced by code". That conflicts with the money-precision memory. kiko-pricing should require currency-carrying `Money` from the priced value.
- **No contract for how a holding type is organized (U7).** No skill states where a type's parse, value, entries, ledgerless/priced membership and no-id behavior live, or a checklist for adding a type. kiko-domain should own it.
- **Fake db handles are not covered by any skill.** The fake-db-masks-bugs memory ("fakes throw on unknown columns") lives only in memory. Every repo test hand-rolls its own fake. kiko-architecture should own it, in the repository-module-shape section.
- **Subset predicates have no stated shape.** kiko-code-style's closed-set section should say a type-subset predicate is a tuple plus `includes` (or `Record<Type, boolean>`), never an `===` chain.

#### Section D: Mechanization candidates

- **Import order:** a small script check (`scripts/checks/import-order.sh`) that checks the 3 groups, sorts by ending-line length, applies the value-before-type tiebreak, and stops at side-effect imports. The throwaway script used for this review showed the check is deterministic, so a proper `scripts/checks/` wrapper is feasible.
- **Blank line before return/if/for/while/switch:** the same script style (Biome cannot express it).
- **U3, Semgrep:**
  ```yaml
  pattern-either:
    - pattern: '$X === undefined ? undefined : $E'
    - pattern: '$X === null ? null : $E'
    - pattern: '$X !== undefined ? $E : undefined'
    - pattern: '$X != null ? $E : $D'
    - pattern: '$X === undefined ? $D : $F($X)'
  ```
- **U5, Semgrep:** `pattern: switch ($X) { ... }` in `src/**` (no `switch`). Also `pattern: '$T === "$A" || $T === "$B" || $T === "$C"'`.
- **U2:** a regex check over comments and test titles: `\bT\d{1,2}\b|Review Focus \d|round \d|re-review|\b[MIN]\d{1,2}\b|§\d|used to|previously`.
- **G1:** run Knip in `--production` mode so exports used only by tests (`periodsPerYear`, `updateName`, `setColor`, `upsertMonobank`, `archive`) are flagged. Plain Knip also missed the fully unused `INTEREST_TAX_RATE_PCT`.
- **G2, Semgrep:** flag a hand-built rate key outside `src/rates` (`pattern: '$T[`${$A}:${$B}`]'`). Flag local redefinitions (`const isCurrency = ...`, `const isRecord = ...`, `const DAY_MS = ...`) outside their owner module.
- **Jest invariant 1:** for one transaction set, the key set of `buildCategoryTrend` equals the key set of `buildCategoryBreakdown` (would have caught row 1).
- **Jest invariant 2:** a recording fake tx shows `accountsRepo.remove` touches at least the tables `holdingsRepo.remove` touches, including `price_points` (would have caught row 2).
- **Jest invariant 3:** for each `HoldingType`, a breakdown, an entries function and a parser resolve through one exhaustive map (enforces U7).

#### Section E: Fix batches, in order

1. **Correctness, behavior-changing, one commit each with a test:** trend fold (row 1); `accountsRepo.remove` price series (row 2); loan-payments currency guard; priced-value id handling. Then the reconcile day window, after the user rules on the window size.
2. **Dead code:** remove `periodsPerYear`, `INTEREST_TAX_RATE_PCT`, unused `genericEntitySymbol` members, `updateName`/`setColor`/`upsertMonobank`, the pointless aliases and `groupKey`. `archive` waits for a user decision.
3. **Dedup helpers (G2):** shared `isRecord`/`isNumber`/`isCurrency`/`DAY_MS`/`canConvert`; `bondNetCouponMinor`; `insertManualAdjustmentTx`; `idsWhere`; `rewriteSortOrderTx`; one metadata field reader.
4. **Closed sets (U5 plus the tuple rule):** tuples for the bond/compounding/trend unions and the subset predicates; `Record` lookups replace the `switch`es; exhaustive `match` in `holdingValueBreakdown`, `entriesForType`, `pricedValueMinor`, `updateLoan`, loan schedule.
5. **fnts `maybe` (U3):** loan-schedule, category-display, category-breakdown, holdings.repo.
6. **Import re-sort** across the whole area, with no logic change.
7. **Blank lines and names:** the S-STYLE blank-line rows plus `d`, `prev`, `cumFrom`, `t`.
8. **Comment pass (U2 plus stale G1 comments):** source first, then tests.
9. **Structure (U8/U7/G3):** `accounts/repo/`, `holding-value-at/`, move the chart-balance test, rename `deletable` to `sync-ownership`, split out the bond register refresh. Move-only; grep every importer.
10. **Test infrastructure (G7):** a shared db/client mock and a strict fake tx that throws on unknown tables; migrate the six repo tests; add the parity tests from Section D.
11. **Per-holding-type descriptor (U7):** large; needs a user decision first.


### R7 — Prices, rates, currency, dates, transactions, db and migration

#### Section B — PER-RULE COUNTS (rows)

- Correctness bugs: G2-BUG 3.
- S-COMPL 2, S-PRICING 2, S-STYLE 7 (2 of them are the blank-line rows, covering 48 files), S-ARCH 1.
- U2 13, U3 3, U4 2, U5 2, U6 6 (plus 1 shared with M), U7 3 (plus 1 shared with G2), U8 5.
- M-import-ordering 2 (covering 36 files), M-file-structure-colocation 1 (shared with U6).
- G1 5 (plus 2 shared with S-COMPL), G2 11 (plus 3 BUG, plus 1 shared with U7), G3 2, G4 1, G5 1, G6 2, G7 7 (plus 1 shared with U8).
- Total: about 72 rows.

The 3 worst files:
1. src/transactions/repo/transactions.repo.ts — G4, G2 ×2, G6, G1 ×2, dead loan-link writers, U2 ×15, imports, blank lines, alias mix.
2. src/rates/rates-refresh/rates-refresh.ts together with src/rates/repo/rates.repo.ts — the bound-param bug, the pair-composition twin, U4, U2, a closure side effect, imports, blank lines.
3. src/db/schema.ts — enum duplication, a false "vice versa" claim, 22 U2 hits, 6 stale paths.

#### Section C — SKILL GAPS

- **kiko-code-style:220-227** — the fnts section is still descriptive ("today every one of them is `guard`… no `pipe`… left"). It lacks the U3 ban on the nullable-map ternary and the U4 "fnts first" rule. Owner: kiko-code-style (scribe).
- **kiko-code-style:248-250** — it blesses the `migrations-gate` early-return JSX. That conflicts with U5 (closed-union branching uses `match`), and the gate file cites this carve-out for an unrelated try/catch. USER-DECISION.
- **kiko-code-style** has no U2 comment rule (no task ids, no history). The skill itself models the banned form ("T25 review round 1, I4", lines 116, 136). Owner: kiko-code-style.
- **kiko-code-style** has no rule on `@kiko/*` alias vs relative imports. The memory file-structure-colocation.md says alias for cross-feature; the code does the opposite. Owner: kiko-code-style, after the user decides.
- **kiko-domain:308-313** — "BTC at scale 8, everything else at scale 2" and "map scale with ts-pattern `match`" are wrong. ETH is 8; BHD/IQD/JOD/KWD/LYD/OMR/TND are 3; BIF/CLP/JPY/… are 0. The code uses a `Record` lookup, which U5 allows. Owner: kiko-domain.
- **kiko-pricing:74-76** — "`day` … same convention as `currencyRateHistory.day`" is inaccurate: `dayKeyOf` uses the local date, `toUtcMidnight` the UTC date. Owner: kiko-pricing.
- **kiko-pricing:47-50, 85-86** — they bless a fixed 2000-row chunk and say nothing about `ratesRepo.upsertMany`. They should prescribe `chunkForTable` for every bulk write. Owner: kiko-pricing and kiko-architecture ("Repository module shape").
- **kiko-pricing:314-318, 336-354** — "mirroring nbu-rates/nbu-history's pattern" prescribes copy-paste. The "single current call for an already-priced metal" wording blesses the earlier-lot gap bug. Update after the fix. Owner: kiko-pricing.
- **kiko-pricing:29-30** — "see the file for the capture date" depends on a date comment, which conflicts with U2. USER-DECISION.
- **kiko-architecture "Repository module shape"** — it is silent on one-shot executed reads (`ratesRepo.latestFetchedAt` vs `bondRegisterRepo.fetchedAtQuery`). Owner: kiko-architecture.

#### Section D — MECHANIZATION CANDIDATES

- **Import order and duplicate specifiers.** It is mechanizable after all: a small script (about 50 lines) that reads the group blocks, the ending-line length, the value-before-type tiebreak, the side-effect barriers and duplicate module specifiers. Wire it as `scripts/checks/imports.sh`, fast tier. Biome's `organizeImports` stays off.
- **Blank line before return/if/for/while/switch.** A regex or AST script, same tier. The draft I ran for this review had no false positives in the lines I spot-checked.
- **Semgrep, nullable-map ternary (U3):**
  ```yaml
  pattern-either:
    - pattern: '$X === undefined ? undefined : $E'
    - pattern: '$X === null ? undefined : $E'
    - pattern: '$X == null ? null : $E'
    - pattern: '$X !== undefined ? $E : undefined'
    - pattern: '$X ? $X.$F : undefined'
  ```
- **Semgrep, imperative ok-check in clients:** `if (!$R.ok) { throw ...; }`, scoped to src/rates, src/prices, src/bonds and clients → "use fnts guard".
- **Semgrep, hardcoded URL:** `pattern-regex: "'https://[^']+'"` in `src/**/*.ts`, excluding tests → "externalize to @env".
- **Semgrep, constant redefinition:** `const DAY_MS = $X` outside src/dates/duration.ts. Likewise the string literals `'metal:'`, `'holding:'`, `'share:'` outside src/prices/instrument/.
- **Semgrep, TZ pinning in tests:** `process.env.TZ = $X` in `*.test.*` (ERROR). kiko-domain already forbids it.
- **Semgrep, U2 comments.** Semgrep ignores comments, so use an `rg` wrapper instead: `rg -n "(//|\*).*\b(T[0-9]{1,2}|review round|Review Focus|Part [A-C]\b|spec [0-9§]|RULING|Bundle [A-Z])\b" src`.
- **Jest invariant, bound parameters.** For every repo bulk write (`ratesRepo.upsertMany`, `rateHistoryRepo.upsertMany`, `pricePointsRepo.upsertMany`, `addManyDedup`), drive it through drizzle sqlite-proxy with a worst-case batch. For rates, that is `buildPairs` over every currency in `currencyOptions`. Assert that each statement's params length is ≤ 32766. This would have caught the first bug.
- **Jest invariant, enum parity.** The schema `holdings.type` / `accounts.kind` enums must equal their runtime tuples in both directions. The rate `source` enum must come from one tuple.

#### Section E — FIX BATCHES (in order; each is one concern)

1. **rates.repo chunking (bug).** `chunkForTable` in `ratesRepo.upsertMany`, plus the bound-param Jest invariant. Switch rate-history and price-points to `chunkForTable`. Check on a device. Behavior-free apart from the fix.
2. **History rate-table parity (bug).** `rateTableAt` / `earliestRateTable` go through `rateTableFromRows`; export `rateKey`.
3. **Metal backfill gaps (bug, changes behavior).** Mirror `planBackfillRun`; filter by `activeHoldings`; update kiko-pricing. Needs a user decision.
4. **Provider client unification.** A shared read guard, one NBU module, Monobank via `guard` and `MONOBANK_API_ENDPOINT`, coingecko-history via `@env`, a shape guard per provider, the nbu-history finite/units guard, and the `fetchMonobankFiatRates` rename.
5. **Pair-composition module.** Extract it from rates-refresh and history-backfill; the seed imports it, which removes the db import chain. Add the rate `source` tuple.
6. **Single sources.** `DAY_MS`, `toMajor`, `isFiat`, the crypto tuple and `CryptoCurrency` type, db file names and `tableCount`, a metal-instrument parser, exported `New*Row` types, schema enums derived from tuples, and the day-key helpers moved into src/dates.
7. **transactions.repo.** `adjustBalanceTx`, a receive-leg helper, the update/remove G6 fix, dropping `add`, then the file split (G4). Update the fakes in the same batch, per the fake-db-masks-bugs memory.
8. **fnts / U3 / U5 pass.** price-as-of-caption (feat-refactor), price-book, db-key, the rates-refresh retry and fallback, the gate's `applyPersistedLanguage`.
9. **Comment pass.** The U2 purge, plus the stale comments (run-migrations, migrate-legacy-db, schema paths, "sole exception").
10. **Imports.** Add the import-order checker first, then re-sort, merge duplicate specifiers, and apply the alias decision.
11. **Blank lines.** Add the checker, then fix mechanically.
12. **Structure and test hygiene.** src/dates folders; db test helpers into src/test-support; split schema.category-overrides.test.ts; shared fakes and mocks (write mock, `makeUpsertTx`, migrations reader); rewrite the TZ-pinned tests.
13. **User decisions.** The loan-link dead writers; `shareInstrument` / `'eodhd'`; the seed date comment; the gate's `match` vs early return.

Brief used: /private/tmp/claude-501/-Users-drizzer14-orca-workspaces-pff-ios-codebase-review/c208bcbe-e4d3-4bbe-b22f-553388e72602/scratchpad/review-brief.md


### R8 — Statement-import, monobank, crypto-sync, bank-sync and sync

#### Section B — Per-rule counts

BUG 5 · S-COMPL 0 · S-I18N 5 · S-STYLE 48 · U1 2 · U2 56 · U3 12 · U4 5 · U5 4 · U6 3 · U7 4 · U8 7 · G1 18 · G2 16 · G3 4 · G4 3 · G5 4 · G6 0 (the BUG rows cover it) · G7 8 · M-file-structure-colocation 1.

Worst 3 files:
1. src/monobank/sync/sync.ts: 2 BUG, S-STYLE, U2, U4, U6, G1, G2×2, G3, G4, M.
2. src/statement-import/column-mapping/apply-column-mapping.ts: BUG twin, S-STYLE, U2, U3, U5, G1, G2, G4, G5.
3. src/statement-import/read-statement-file/read-statement-file.ts: U2, U4×3, U5, G2 codec twin.

#### Section C — Skill gaps

1. **kiko-code-style** has no comment-content rule (U2). The skill itself models the banned style: "T25 review round 1, I4" (lines 116, 136). kiko-statement-import (for example lines 147-162, 263-296: "F3 fix round 2, N2", "ruling I1") and kiko-architecture:592-595 ("R6-3…R7") do the same. Owner: kiko-code-style (add the rule), plus a scrub of all three.
2. **kiko-code-style:214-258** (fnts) is descriptive, not prescriptive. Lines 224-227 say "today every one of them is `guard`", which is now false: `either` is used in 6+ files here. The U3 nullable-ternary ban and `foldMap(maybe(x), f)` are missing, although memory `use-fnts-first` says the rule "lives in kiko-code-style". Owner: kiko-code-style.
3. **kiko-code-style:179-184** requires `match().exhaustive()` for ISO 4217 numeric codes. That is impossible for `number` (currency-code.ts uses `.otherwise`). Allow a typed `Record<Union, X>` or table lookup (U5 permits it). Owner: kiko-code-style.
4. **U1 for hooks** (one exported hook per file) and **U7** (sibling modules share one layout) are in no skill. Owner: kiko-code-style. kiko-statement-import should also define the canonical format folder: format.ts, format.test.ts, index.ts, `__fixtures__/`, with shared helpers in `formats/shared`.
5. **kiko-statement-import:63-67** endorses a second hand-rolled UTF-8 decoder ("two separate call sites; do not assume touching one updates the other"). That legitimizes a divergent twin (G2, memory fix-divergent-twins). It should point to src/data-transfer/utf8. Owner: kiko-statement-import.
6. **kiko-architecture:437-441 and 498** place the throttle and sync-status "in src/monobank/", although crypto-sync depends on both. The skill codifies the G5 misplacement. Owner: kiko-architecture.
7. **The `@kiko/*` alias rule for cross-feature imports** exists only in memory (file-structure-colocation), in no skill. Owner: kiko-code-style.
8. **No provider-client resilience contract** (timeout, 429 retry, translated errors) for Binance and Esplora; kiko-architecture documents only Monobank's. Owner: kiko-architecture.
9. **No shared test-double rule** (Keychain mock, fake tx that throws on unknown tables). Memory fake-db-masks-bugs is not in a skill. Owner: kiko-code-style (testing section).

#### Section D — Mechanization candidates

- **U2 (Semgrep `pattern-regex`, Class B):** `(//|\*).*\b(Task \d|T\d{1,2}\b|F\d item|[Rr]ound \d|[Rr]eview (follow-up|Focus)|[Cc]ontroller ruling|ruling [A-Z]?\d|Phase \d|[Ss]ection [A-D]\.\d|task-\d-(report|brief)|\b[ICMN]\d\b \()` on `src/**`.
- **U3 (Semgrep):** `pattern-either:`
  - `$X === undefined ? undefined : $E`
  - `$X !== undefined ? $E : undefined`
  - `$X == null ? null : $E`
  - `$X !== undefined ? $E : null`
  - `$X ? $F($X) : undefined`
- **U4 (Semgrep, Class B, `src/` excluding `src/screens`):** `try { return await $E; } catch { ... return $V; }` → suggest `either`.
- **S-STYLE blank lines and import length-sort:** both are provable by a small node checker (I ran one in this review; zero false positives on spot-check). Add `scripts/checks/style-order.sh` to the fast tier.
- **Stale path references in comments:** a script that resolves every backticked `src/…\.tsx?` path. 20 stale refs found here.
- **S-I18N:** a Semgrep rule for `throw new Error('$LITERAL')` under `src/crypto-sync/**` and `src/monobank/**`, since these messages reach the UI through `useSyncAction`.
- **G2 twins:** lower jscpd `minTokens` for `src/monobank/migrate-credential` and `src/crypto-sync/binance` (the identical migrations went through at 5%). Add a Jest invariant that `currencyFromCode(codeFromCurrency(c)) === c` for every currency.
- **BUG (dedup key):** a property test that `computeDedupKey` is injective over random descriptions ending in digits.
- **U5 (bank-catalog):** a `Record<BankId, …>` makes completeness a compile error; no test needed.

#### Section E — Fix batches (in order)

1. **Correctness (behavior change, each with a test):**
   - (a) Binance per-window commit.
   - (b) Monobank: normalize `accounts` once; fix the display-stamp gate.
   - (c) Share `pickClosingBalanceRow` with monobank-csv.
   - (d) Dedup-key separator, after the USER-DECISION on migration.
2. **Provider resilience twin:** shared request helper (timeout, 429) for Binance and Esplora; translated crypto and Monobank errors.
3. **Pure moves (no behavior change):**
   - throttle and sync-status to `src/sync/`
   - mcc-category to categories
   - `CURRENCY_WORD_MAP` to currency
   - crypto-sync/binance and btc-wallet to folder-per-thing
   - column-mapping folders
   - format-test-fixtures, parity.test and cp1251 test to their right places
   - split `useSyncAction` and sync-status
4. **Dedupe twins (no behavior change):**
   - credential migration and keychain policy
   - single-flight helper
   - `formats/shared` amount, reader, date and `cellText` helpers
   - codec reuse
   - one `NewTransaction` type
   - `binanceAssetOf`
   - currency table
   - signal helper
   - post-sync refresh (the `refreshMetalPrices` twin changes behavior slightly)
5. **Dead code:** Binance repair latch, provider-catalog fields and registry `catalog` (after the USER-DECISION), test-only sync-status exports, the `-1` branch, the per-card holding re-query.
6. **Style sweep, one commit per concern:** import re-sort; blank lines; U2 scrub and stale paths; U3/U4 fnts conversions; U5 `match`; alias imports.
7. **Tests:** shared Keychain `__mocks__`; shared throwing fake tx and row factories; reuse fixture loaders; remove the routing re-implementation from the use-auto-sync mock.
8. **Mechanize (Section D)** and update the skills (Section C), per the skill-drift rule.


### R9 — Data-transfer, auth, navigation, i18n, settings, test-support, root files and mocks

#### Section B — Counts per rule

S-I18N 8 · S-COMPL 2 · U10-stop 2 · M-import-ordering-length-sort 6 · S-STYLE 4 · S-STYLE/U7 1 · S-DS/G2 1 · U2 13 · U3 1 · U4 2 · U5 2 · U6 4 · U8 3 · G1 4 · G2 6 · G2 (correctness) 1 · G3 1 · G4 1 · G6 1 · G7 15.

Three worst files:
1. `src/i18n/locales/en.ts`: casing, full-stop, and dual-role bugs, plus about 40 task-id comments.
2. `src/data-transfer/import-data.ts` and the secrets pair: two correctness bugs, the undisclosed DB-key export, hand-rolled try/catch.
3. `src/navigation/types.d.ts` and the navigation folder: dead Share Extension optionality, heavy task-id comments, flat structure, import drift.

#### Section C — Skill gaps

- **kiko-code-style** has no comment-content rule for U2. Skills themselves model the banned style: kiko-code-style.md:116, 135 ("T25 review round 1, I4/I1/I3") and kiko-translator.md:8-9, 83, 129, 136 (T-ids, dates, "CASE fix round 1/5"). Owner: kiko-code-style.
- **kiko-code-style fnts section (lines 220-227)** is descriptive ("today every one of them is `guard`"). That contradicts U4 and memory `use-fnts-first`. The U3 ban (`foldMap(maybe(x), f)`) is not written anywhere in it. Owner: kiko-code-style.
- **kiko-code-style, test mocks:** there is no rule that says to use `src/test-support` factories, or to move an inline `jest.mock` factory repeated in 3+ files into test-support or `__mocks__`. That missing rule is the root of the G7 volume. Owner: kiko-code-style.
- **kiko-code-style, `@kiko/*` alias:** the rule does not say when to use the alias vs `../`, or which import group the alias sorts in (it is group 1, per biome `:ALIAS:`). Owner: kiko-code-style.
- **kiko-code-style "File suffixes" (lines 406-407)** names the lock gate as a `.gate.tsx`. The code is `lock-gate.component.tsx`. Either the code or the skill is wrong. Owner: kiko-code-style.
- **kiko-code-style folder-per-thing exceptions** do not cover `src/navigation/` or `__tests__/`. Needs your decision (USER-DECISION). Owner: kiko-code-style.
- **kiko-architecture contradicts itself.** Lines 19-24 ban any build flag that gates visibility. Lines 639-647 sanctions `APP_LOCK_ENABLED`, which gates the App Lock card (system.screen.tsx:55). Owners: kiko-architecture and kiko-compliance. USER-DECISION.
- **kiko-architecture Data transfer (lines 880-890)** calls `dbKeyHex` "display-only", but no UI displays it. Owner: kiko-architecture.
- **kiko-translator full-stop rule** has no entry for field status errors (`invalid*`, `couldNot*`), "Row N: …" errors, or thrown messages. It also does not say whether "error → ." or "Label: {{value}} → no ." wins (`unsupportedCurrencyCode`). Owner: kiko-translator.
- **kiko-translator** has no rule against reusing a chip or label key as an interpolated fragment inside another role (the trend-filter measure bug). Owner: kiko-translator.
- **kiko-translator apostrophe rule** says U+2019, but the test only rejects ASCII `'`. U+02BC passes. Owner: kiko-translator.

#### Section D — Candidates for automated checks

1. **Semgrep, i18n of the native auth sheet.** Pattern: `authenticateWithOptions({..., $K: "$S", ...})` with `metavariable-regex $K: ^(cancelLabel|fallbackLabel|title)$`.
2. **Semgrep, noble text helpers.** The existing TextDecoder rule misses the helper that caused the builds 9-11 bug:
   ```yaml
   - id: kiko-no-noble-utf8-helpers
     pattern-either:
       - pattern: import { ..., bytesToUtf8, ... } from '@noble/ciphers/utils.js'
       - pattern: import { ..., utf8ToBytes, ... } from '@noble/ciphers/utils.js'
     paths: { exclude: ["*.test.ts"] }
   ```
3. **Semgrep, U3 ternary.** Patterns: `$X === undefined ? undefined : $E`, `$X == null ? null : $E`, `$X !== undefined ? $E : undefined`, `$X != null ? $E : null`.
4. **Semgrep, U2 comments.** A `pattern-regex` on `//` and `/*` in `src/**` and `jest/**`: `(?i)\b(T-?\d{1,2}\b|F\d\b.*round|round \d|task \d+|phase \d|item \d+|audit \d+|device-feedback|\.superpowers/|ponytail L\d)`. Add `\A// src/` for path headers.
5. **Semgrep, 5.6 extension.** Catch JSX `{$F && ...}` or `if (!$F)` where `$F` matches `metavariable-regex ^[A-Z_]+_ENABLED$`. This covers the `ENABLE_*` gap the skill admits.
6. **Semgrep WARNING, G7.** Flag `testID={\`text-tone-${tone}\`}` outside `src/test-support/`, and flag `jest.mock('$P/db/use-live-query', ...)` to point at the shared helper.
7. **Jest invariant, TITLE_KEYS coverage.** Scan `src/**/*.tsx` for `variant="heading">{t('K')`, `title={t('K'`, and `title: t('K'`. Assert every K is in TITLE_KEYS. This scan found 12 misses.
8. **Jest casing-test fix.** Replace interpolations with `x` instead of spaces (catches "{{count}} Category"). Add the uk apostrophe regex `['ʼ]`.
9. **Jest full-stop extension.** Treat leaves named `/^(invalid|couldNot|noConnection)/` or under `rowError.*` as the error role.
10. **Import-order script (`check:imports`).** Group 1/2/3, sort by ending-line length, side-effect imports as barriers. My python version reproduced every hand-found violation, so it could become a wrapper in `scripts/checks/`.
11. **Blank-line-before-statement check.** A Biome GritQL plugin or a small script; it flagged 17 files here.

#### Section E — Fix batches (in order)

1. **Catalogue copy (changes visible text; you review en/uk before any deploy).** Biometric labels; trend-filter button casing; `nextInstallment` Title Case; split the dual-role keys; full stops; U+02BC → ’; uk wording consistency.
2. **Harden the i18n tests (no behavior change).** Interpolation placeholder, apostrophe regex, TITLE_KEYS additions and the coverage test, full-stop name rule.
3. **Data-transfer correctness.** Secrets-restore order or best-effort; Keychain orphan cleanup; `dbKeyHex` (needs your decision first).
4. **APP_LOCK_ENABLED.** Remove it or document it (needs your decision); update the matching skill sections.
5. **U2 comment purge, folder by folder (no behavior change).** Includes the stale G1 comments and dangling paths.
6. **Import re-sort across the whole area (no behavior change).**
7. **Blank-line and explicit-return pass (no behavior change).**
8. **Shared test fakes (test code only).** Add `mockUseLiveQuery`, the settings-repo fake, `mockWrite`/`recordingTx`, row factories plus `emptySnapshot`, the Symbol mock, a catalogue-translation mock plus a stack-screen helper. Adopt MockTextTone. Delete the AppState scaffolding. Move the MigrationsGate language test. Use `utf8Encode` in the data-transfer tests. Make the read-snapshot mock order-free.
9. **Small refactors (no behavior change).** `dark-theme` from tokens; `settings.repo` update helper; `active-locale` Record; U3/U4 fixes; the `import-data` eitherSync helper; `useExpandedHeaderHeight` split; a shared codec with `read-statement-file.ts`; required `accountId` (touches statement-import).
10. **Structure (U7/U8, needs your decision for navigation).** LockGate suffix and barrel; navigation, auth, and data-transfer folders; move the harness tests out of `__tests__`.

Files most worth opening first:
- /Users/drizzer14/orca/workspaces/pff-ios/codebase-review/src/data-transfer/import-data.ts
- /Users/drizzer14/orca/workspaces/pff-ios/codebase-review/src/data-transfer/secrets/read-secrets.ts
- /Users/drizzer14/orca/workspaces/pff-ios/codebase-review/src/auth/biometrics.ts
- /Users/drizzer14/orca/workspaces/pff-ios/codebase-review/src/i18n/locales/en.ts
- /Users/drizzer14/orca/workspaces/pff-ios/codebase-review/src/i18n/locales/uk.ts
- /Users/drizzer14/orca/workspaces/pff-ios/codebase-review/src/i18n/locales/title-keys.ts
- /Users/drizzer14/orca/workspaces/pff-ios/codebase-review/src/navigation/types.d.ts


### A1 — Cross-cutting audit (all of src/)

#### Section B — Per-rule counts (this pass) and worst files

| Rule | Rows/hits | Worst 3 files |
|---|---|---|
| U2 | 713 comment lines / 191 files (99 src, 92 test) | `holding-form.screen.tsx` (36), `transactions.repo.test.ts` (30), `holding-form.screen.test.tsx` (29) |
| U3 | 28 confirmed nullable-map-ternary sites (of 61 raw `=== /== null/undefined ?` hits; 33 were general two-value branching, not a nullable-map, and excluded) | `column-mapping.screen.tsx` (6), `date-field.component.tsx`/`time-field.component.tsx`/`currency-field.component.tsx`/`bottom-sheet.component.tsx` (2-3 each) |
| G2 (divergent twins found via U3 sweep) | 3 clusters (deriveTestID ×4 files, mcc-category-map ×2 files, null→'' String() ×3 files) | text-field/field-trigger/date-field/holding-identity-field (4-way) |
| U5 | 5 (4 switch-over-closed-union, 1 wrong `.otherwise` instead of `.exhaustive`) | `interest.ts` (3 switches) |
| U4 | 2 concrete (isin.ts hand-rolled result; zero `maybe` usage tree-wide) | `bonds/isin/isin.ts` |
| U1 | 0 confirmed violations — every multi-`const [A-Z]` `.tsx` file inspected (7 highest-count files) turned out to be constants + ONE small local non-exported render-row helper (the U1 exception), consistently applied | — |
| U7 | 1 naming-clarity note (`business-csv` base module), 1 confirmed-non-issue documented | `formats/business-csv/` |
| U8 | 0 strong violations found in the folders checked (`db/`, `navigation/`, `dates/`, `i18n/locales/`, `crypto-sync/binance/`, `statement-import/column-mapping/`) — these are flat by design (non-component logic modules paired 1:1 with their test in the same dir), not a co-location gap. Spot-checked only; not exhaustive over all ~200 directories. | — |
| M-import-ordering-length-sort | 2 confirmed (of 3 files spot-checked; 1 file, `holding-form.screen.tsx`, was correctly sorted) | `statement-import.screen.tsx`, `transaction-form.screen.tsx` |

#### Section C — Skill gaps

1. **U2 (comment history/task-id ban) has NO owning skill.** Grepped all of `.claude/skills/*/SKILL.md` for "task id", "round N", "spec section", "history" — no hits. This is a real, currently-violated rule (713 hits) with zero skill documentation. Owner: `kiko-code-style` (add a "Comments explain WHY, never history" section next to its existing "Linting rules" section).
2. **U3 (banned nullable-map ternary → foldMap/fmap) has NO owning skill.** `kiko-code-style/SKILL.md` documents `maybe`/`just`/`nothing`/`fold` (lines 243-244) but never states the ternary is BANNED or shows the `x === undefined ? undefined : f(x)` anti-pattern to grep for. Owner: `kiko-code-style`, same section as the existing fnts write-up (lines 214-259).
3. **STALE/DESCRIPTIVE TEXT — exactly the "describes current usage instead of prescribing" pattern the brief warns about:** `.claude/skills/kiko-code-style/SKILL.md:224-227`:
   > "`grep -rn "from 'fnts'" src` for the live uses instead — today every one of them is `guard` in an HTTP client, and no `pipe` composition is left in the tree."

   This is FALSE as of current code: `grep -rln "from 'fnts` src` returns 18 files, and 10 of them import `either`/`bifold`/`eitherSync`/`isLeft`/`isRight` — not `guard`. The claim was true at the time it was written and has since drifted; it now actively misleads a reader into thinking `either` isn't used in this codebase, when `db/use-live-query.ts`, `db/encrypted-database.ts`, `sync/use-sync/use-sync.ts`, `crypto-sync/run-crypto-sync/run-crypto-sync.ts`, `auth/biometrics.ts`, etc. all use it. Owner: `kiko-code-style` — replace the snapshot claim with the general rule only (drop the "today every one is guard" sentence entirely, since the skill text right below it already documents `either`/`guard`/`maybe` generically and doesn't need a dated example).
4. `kiko-code-style/SKILL.md:439-528` already documents U1/U8 (one component per file, folder-per-thing) reasonably well — those are NOT gaps, contrary to the brief's caveat that they're "not yet in skills." Confirmed present and consistent with what the code does.
5. `kiko-code-style/SKILL.md:177-259` documents U5 (ts-pattern `.exhaustive()`) well, but doesn't call out the `.otherwise()` trap (an open union legitimately uses `.otherwise`, e.g. `active-locale.ts`'s device-locale string; a closed union should never use it, e.g. the `settings.screen.tsx` bug above). Add one sentence: "`.otherwise()` is only for a deliberately-widened/open match (document why); a closed union always ends in `.exhaustive()`."

#### Section D — Mechanization candidates

1. **U2 (comment history ban).** Semgrep pattern (as a warning, not error — a comment isn't parsed by Semgrep's AST matcher, needs `pattern-regex` at the generic/comment level):
   ```yaml
   - id: kiko-no-task-id-in-comment
     patterns:
       - pattern-regex: '//.*\b([TFRIMN]\d{1,3}|round \d|spec [§5])\b'
     paths:
       include: ["src/**/*.ts", "src/**/*.tsx"]
     message: "Comment cites a task/review id or round number — explain WHY only, drop the history."
     severity: WARNING
   ```
   Start as Class B (non-blocking) given the current 713-hit backlog — flipping it to ERROR immediately would fail every touched file.
2. **U3 (nullable-map ternary).** Semgrep, generic pattern (needs a few pattern-either variants; drafting the most common shape):
   ```yaml
   - id: kiko-nullable-map-ternary
     patterns:
       - pattern-either:
           - pattern: $X === undefined ? undefined : $F
           - pattern: $X === null ? null : $F
           - pattern: $X == null ? null : $F
     message: "Nullable-map ternary — use fnts maybe/fmap/foldMap instead."
     severity: WARNING
   ```
   This only catches the `undefined`/`null`-preserving shape; the "default value" variants (`x === null ? '' : f(x)`) need a second, looser rule and will have more false positives (ordinary two-branch UI logic) — expect to hand-tune the fixture set before promoting to ERROR.
3. **U5 (`switch` over a closed union).** A Biome custom rule isn't available (no GritQL support in this Biome version per `kiko-linter/SKILL.md` — verify); Semgrep can flag `switch ($X) { ... }` where `$X`'s declared type is a union — hard to express without type info in Semgrep OSS. More realistic: a Jest/lint script that flags any `switch (` whose scrutinee is imported from `holding-metadata.ts`'s closed-set exports (`loanKinds`, `metalKinds`, etc.) by name.
4. **U4 (fnts `maybe` never used).** A cheap CI invariant: `grep -c "from 'fnts/maybe'" src -r` reported in the `check:deps`/`check:knip` summary so a future PR notices if the import stays at 0 despite the ternaries above.
5. **Divergent `deriveTestID` (G2).** Once extracted to a shared util, a Semgrep rule banning a *local* `const deriveTestID =` / `const deriveErrorTestID =` declaration anywhere except that one file would prevent recurrence.
6. **Import-ordering (length-sort within group).** Not Semgrep-friendly (needs cross-line comparison); a small Node script comparing consecutive import-statement string lengths per Biome-defined group, run in `check:lint`, would fully mechanize this — currently 100% manual and the two violations above show it already drifts.

#### Section E — Fix batches (small, one concern each, behavior-free unless noted)

1. **Batch 1 — extract `deriveTestID` (G2 + 4× U3 in one move).** Add `src/design-system/derive-test-id.ts`, import in `text-field`, `field-trigger`, `date-field`, `holding-identity-field`. Behavior-free.
2. **Batch 2 — dedupe the `mcc`→category ternary (G2 + U3).** One shared helper for `mapping.ts` and `example-transaction.component.tsx`. Behavior-free.
3. **Batch 3 — `isin.ts` to `either` (U4).** Convert `validateIsin`'s hand-rolled result to fnts `either`/`bifold`, fold back to the same external `{ok,reason}` shape at the boundary per the skill's own "fold back to the call site's existing contract" rule. Behavior-free if the folded shape matches exactly — verify all callers.
4. **Batch 4 — the 4 `switch`→`.exhaustive()` conversions (U5).** `holdings/interest/interest.ts` ×3, `holdings/holding-value/holding-value.ts` ×1. Behavior-free if every case is carried over 1:1 — needs care since a `switch` can silently fall through in a way `.exhaustive()` cannot.
5. **Batch 5 — `settings.screen.tsx` `.otherwise` → `.exhaustive()` (U5).** Behavior-changing for a hypothetical未-yet-added language (compile error instead of English fallback) — call this out to the reviewer explicitly.
6. **Batch 6 — remaining ~24 standalone U3 ternary sites.** One PR per module (prices/, statement-import/, db/, design-system/) rather than one giant sweep, since each needs `pipe(fromNullable(x), fmap(...))` wiring checked against its own call site.
7. **Batch 7 — U2 comment cleanup.** Largest batch by volume (713 lines/191 files); do LAST and split by directory (statistics/, holdings/, screens/forms/holding-form/, i18n/) since it touches nearly every file — do not block Batches 1-6 on this.
8. **Batch 8 — skill fixes (Section C items 1-3, 5).** `kiko-code-style/SKILL.md`: add the U2/U3 sections, delete the stale "today every fnts use is guard" sentence, add the `.otherwise()` vs `.exhaustive()` note. Do this once Batches 3-5 land, so the skill describes the POST-fix state, not another snapshot destined to go stale.

#### Full U2 file:line inventory (method + top offenders, not every line inline above)

Grep used: `grep -rnE '//.*(\b[TFRIMN][0-9]+\b|round [0-9]|§|spec [0-9]|previously|used to|moved (from|to))' --include='*.ts' --include='*.tsx' src` → 713 lines, 191 files. Top 10 by count (line numbers on request, already captured for these 7: `holding-form.screen.tsx` 108,178,179,216,217,312,345,347,354,398,414,516,550,551,577,580,704,705,722,843,932,1074,1100,1140,1178,1237,1275,1288,1396,1444,1481,1488,1528,1577,1631,1831; `statement-import.screen.tsx` 131,144,174,188,298,301,304,315,325,332,407,426,436,445,449,467,493,501,502,506,512,521,522,549,557; `column-mapping.screen.tsx` 151,204,247,359,451,452,499,820,823,826,852,899,903,998,1043,1084,1092,1093,1095,1096,1101,1106,1107,1130; `use-bond-isin-mode.ts` 17,18,19,45,50,51,52,53,106,108,142,154,161,170,178,192,208,212,217,229,247,250,268; `i18n/locales/en.ts` 43,44,157,275,300,311,452,453,553,619,620,670,671,712,723,733,762,771,776,780,787,795,817,832,834,847,857; `navigation/types.d.ts` 55,64,84,91,108,109,130,131,139,140; `holding-metadata.ts` 41,43,44,45,235,239,275,278,287,345). The remaining 184 files (per-file counts 1-30) are in the raw `uniq -c` output I generated during this run — I can dump the full 191-line list verbatim if the scribe needs it machine-readable; omitted here to keep the report readable.

#### Coverage caveats (be honest about what I verified vs estimated)
- U3/U5/U4/G2: every hit above was read in context and hand-classified (not just grep-matched) — I excluded ~33 raw `=== null/undefined ?` hits that were ordinary two-value UI branching, not a nullable-map.
- U1: checked via a `.tsx` const-count heuristic then manually read the 7 highest-count files; did not open all ~500 `.tsx` files individually, so a low-count multi-component file could theoretically be missed.
- U7/U8: spot-checked the sibling groups named in the brief (holding-form sections, statement formats, crypto providers, rate sources) plus the 6 flattest top-level directories; did NOT build a full matrix over every account-kind/bank/form family in the tree — time-boxed.
- Import-ordering: spot-checked 3 files only; not a tree-wide sweep (no mechanized check exists to run one).
- Performance/bundle-size claims: none made — out of this pass's scope (grep-driven correctness/consistency only).
