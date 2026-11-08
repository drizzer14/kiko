# MCC picker design (1.4 addendum)

Track: 1.4-category-automation. Base: a00115db2. Addendum to
`docs/superpowers/specs/2026-11-03-category-automation-design.md` (B4, section 3.4). Read from code;
the app was not run. Every code fact names a symbol: re-grep it on the actual base before building
on it. Counts are floors; the developer measures.

Product purpose: Kiko answers "how much money do I have now". The picker only helps a user write a
rule condition; it never changes a balance, net worth or a stored row by itself.

## 1. Ruling and scope

USER RULING 2026-11-08 (via the coordinator): the rule condition "Merchant code (MCC)" gets an MCC
picker. A searchable list of known MCCs plus an "Other" option to type any value. The list holds
BOTH: first the user's own codes (MCCs found in the user's transactions, with row counts), then the
full standard list with en and uk names. Texts go to the user through the coordinator before merge.

Today (`MatcherRow`, `.with('mcc', ...)` in
`src/screens/forms/category-rule-form/matcher-row/matcher-row.component.tsx`): a `TextField`,
number pad, `MCC_DIGITS` digits, hint `ruleForm.mccHint`. The user sees MCCs nowhere else.

In: a bundled MCC name list (code, en, uk) and its generator; a live read of the user's own codes
with counts; the picker field in the rule form; the rule card on the category page shows the same
"code – name" label (Q-MCC3); the MIT notice for the uk names (Q-MCC2).

Out: any change to the stored rule (`{ type: 'mcc'; code: number }`), the parser, the matcher,
`EXPORT_VERSION`, the database schema; MCC names anywhere else in the app (transaction rows,
statistics); runtime download of any list; a migration or an index.

## 2. Decisions taken and pending

| # | Question | State | Answer used by the plan |
|---|---|---|---|
| Q-MCC1 | Accept community sources (low provenance risk) | PENDING USER, default yes | greggles + Sominemo, section 3 |
| Q-MCC2 | Where the MIT notice ships | PENDING USER, default A | A: Settings row "Acknowledgements" + plain text page. B: own uk names for every code, no notice. C: a credit line in the picker |
| Q-MCC3 | The rule card on the category page shows "5411 – Grocery Stores, Supermarkets" too | PENDING USER, default yes | yes: one label everywhere a stored code shows (section 6) |
| Q-MCC4 | en and uk names shown as the sources write them (source casing and punctuation): 419 of the 683 en names in 3000-3999 are all capitals, for example `3000` "UNITED AIRLINES", `3501` "HOLIDAY INNS, HOLIDAY INN EXPRESS", next to `3003` "Airlines"; in uk those codes read «Авіалінії», «Готелі. Курорти» (section 3.3) | PENDING USER, default yes | yes: data, not UI copy (section 3.4) |

The plan builds on every default and does not wait for the answers. What each "no" keeps, drops
and re-pins (with the "was:" pin edits): plan section "Pending defaults".

## 3. Data

### 3.1 Sources (untrusted data, never executed)

| Role | Repository, file | Commit (HEAD by `git ls-remote`, 2026-11-08) | License |
|---|---|---|---|
| codes, en names | `https://github.com/greggles/mcc-codes`, `mcc_codes.json` | `df792275c567946119a8903d36dbd33e44a248bf` | Unlicense (public domain), no attribution required |
| uk names | `https://github.com/Sominemo/MCC-Localize-Dataset`, file named in the research as `mcc-loc.json` | `7b3cbceeb3fbbd6a27dbe489b25abe82552ddff2` | MIT, "Copyright (c) 2020 Sominemo"; the notice must ship |

Measured by plan task 7/10 step 1 (fetched 2026-11-08 from
`raw.githubusercontent.com/<owner>/<repo>/<commit>/<file>`, read by path with `JSON.parse` only):

| File (exact name) | Bytes | SHA-256 | Shape |
|---|---|---|---|
| greggles `mcc_codes.json` | 265156 | `60fff0a4457e18dd03731a8971f219f2d1e4b22a13c1d930aaac07badbfe8e68` | JSON array of objects; every object has the seven fields `mcc` (string, four digits, leading zeros kept, for example `"0742"`), `edited_description`, `combined_description`, `usda_description`, `irs_description`, `irs_reportable` (strings) and `id` (number) |
| Sominemo `mcc-loc.json` (the name the research gave is right) | 69063 | `ed32d9bfca87862580d3228b1a23203a07e9a9152b4b1cca6bd2f0c765a01347` | one JSON object keyed by the four-character code string; each value `{ "uk": string, "ru": string }`; no short-name or full-name field, only one uk name per code; file order is by code, but `Object.keys` lists non-padded keys first, so the generator sorts and never relies on key order |
| Sominemo `LICENSE` (kept for task 10/10) | 1065 | `ea371db4627976fe5c82dacb744ed2deb0391e6d4a23a6aecc9ea64f4858626a` | the standard MIT text, "Copyright (c) 2020 Sominemo": the same text as the research quote |

The generator header (task 7/10 step 3) carries these SHA-256 values. Each file is fetched from
`raw.githubusercontent.com/<owner>/<repo>/<commit>/<file>` into its own new, empty scratch
directory; the generator reads it by path with `JSON.parse` only and refuses a file whose SHA-256
differs from the pinned one. Nothing from ISO 18245, Visa or Mastercard documents is copied
(research risk 2).

### 3.2 Join rules (generator)

- Code: a four-character string with leading zeros (`"0742"`), from greggles' `mcc` field padded
  to four. A code that is not four digits after padding, or a duplicate code with a different name,
  stops the generator.
- en: greggles `edited_description`, trimmed; when blank, `combined_description`, trimmed; both blank
  stops the generator with the code named.
- uk: Sominemo's uk name for the code, its only uk field (Sominemo has no short-name field; 3.1).
  A greggles code with no Sominemo uk name stops the generator, listing every such code
  (measured: none, 3.3). Sominemo keys are read by code, never by key order.
- Sominemo-only codes (no en) are dropped and listed in the run report.
- Text tidy: whitespace collapsed to one space; in uk text, an ASCII `'` or U+2019 between two
  Cyrillic letters becomes U+02BC (the catalogue rule of `src/i18n/locales/uk.catalog-rules.test.ts`
  applied to data). en text keeps its apostrophes as the source writes them (search folds them,
  section 5.2).
- Output sorted by code.

### 3.3 Measured counts (step 1 below; step 5 adds the data file size)

Measured by plan task 7/10 step 1 on 2026-11-08 with a scratch Node script (`JSON.parse` of the two
pinned files; code padded to four digits, en = trimmed `edited_description`, else
`combined_description`). The research could not count greggles; the 2026-11-03 CSV check of 981 rows
(plan `docs/superpowers/plans/2026-11-03-category-automation.md`, task 1 step 3) matches.

| Count | Value |
|---|---|
| greggles rows | 981 (981 distinct codes, no duplicate code, no blank en, every `mcc` four digits as written) |
| Sominemo rows | 981 (every key four digits; no blank uk) |
| Codes in the output (greggles codes) | 981 |
| Overlap (in both files) | 981 |
| Sominemo-only (dropped, no en) | 0 |
| greggles codes with no Sominemo uk name | 0, in 3000-3999 and outside it |
| uk by Sominemo | 981 of 981 |
| greggles codes in 3000-3999 | 683 (all 683 have a Sominemo uk name) |
| Distinct Sominemo uk texts | 256 of 981 (codes 3000-3999 share generic nouns: 3000, 3001, 3003 and 3299 all read «Авіалінії»; 3351 «Оренда авто»; 3501 «Готелі. Курорти») |
| Longest en / longest uk | 142 / 37 characters |
| greggles `edited_description` differing from `combined_description` | 8 rows |
| en text with leading, trailing or double space | 1 (`5599` "Miscellaneous Auto Dealers " has a trailing space; the trim rule applies) |
| en text with an apostrophe | 16 (for example `3299` "WIDERO’S FLYVESELSKAP" with U+2019, `3563` "JOURNEY’S END MOTLS") |
| uk text with an ASCII `'` between Cyrillic letters | 7 (`4215` «Кур'єри», `4814` «Мобільний зв'язок», `5045`, `5422` «М'ясо», `5734`, `7298`, `7379`); none with U+2019 or U+02BC, so the apostrophe rewrite touches exactly these 7 |

The research said Sominemo has gaps in 3300-3350, 3442-3500, 3791-3815 and 3836-3999. At the pinned
commit each of those gaps is also absent from greggles, so no greggles code lacks a uk name (3350,
3500 and 3999 are in neither file). Sominemo names every code, including all 683 in 3000-3999
(«Авіалінії», «Оренда авто», «Готелі. Курорти»), so the generator takes uk from Sominemo only
(3.2). En casing in 3000-3999 as written (Q-MCC4), for the user:
419 of the 683 en texts are all capitals, 264 are not; examples: `3000` "UNITED AIRLINES",
`3501` "HOLIDAY INNS, HOLIDAY INN EXPRESS", `3351` "AFFILIATED AUTO RENTAL", and `3003`
"Airlines" (a generic text, 3003 is one of many such codes).

Presence: `5411` "Grocery Stores, Supermarkets" / «Продукти»; `5812` "Eating places and
Restaurants" / «Кафе. Ресторани»; `4829` "Money Orders – Wire Transfer" (U+2013 in the en text) /
«Переказ»; `6011` "Financial Institutions – Manual Cash Disbursements" / «Каси»; `0742` "Veterinary
Services" / «Ветеринари». All five present in both files.

Five-row samples, in file order:

| greggles `mcc` | `edited_description` |
|---|---|
| `0742` | Veterinary Services |
| `0763` | Agricultural Co-operatives |
| `0780` | Horticultural Services, Landscaping Services |
| `1520` | General Contractors-Residential and Commercial |
| `1711` | Air Conditioning Contractors – Sales and Installation, Heating Contractors – Sales, Service, Installation |

| Sominemo key | `uk` |
|---|---|
| `0742` | Ветеринари |
| `0763` | Сільскогосподарські кооперативи |
| `0780` | Садівництво. Ландшафтний дизайн |
| `1520` | Будівництво. Підрядники |
| `1711` | Кондиціонери. Встановлення |

Task 7/10 step 5 writes the byte size of `mcc-names.data.json`.

### 3.4 Shape and display

`src/categories/mcc-names/`: `mcc-names.data.json` (generated, committed: a JSON array of
`{ "code", "en", "uk" }` sorted by code) and `mcc-names.ts`, which imports the JSON (the
`package.json` import in `src/screens/settings/settings/settings.screen.tsx` is the precedent:
`resolveJsonModule` comes from `@react-native/typescript-config`, and jest and Metro already load
it) and exports it typed as `MCC_NAMES: readonly MccName[]`, `MccName = { code: string; en: string;
uk: string }`, plus the lookups. The data is JSON, not `.ts`, so Stryker makes no mutants of it
(`stryker.conf.json` `mutate` globs `**/*.ts` and `**/*.tsx`; `scripts/checks/mutation.sh` diffs
`'*.ts' '*.tsx'` only). Names are data, as untracked-wallet product names are kept out of the
catalogue (kiko-translator, "Keep as written"): shown verbatim in the source casing (Q-MCC4). Size
about 60-100 KB (research), bundled; no network.

The label of a code: `<code><MCC_NAME_SEPARATOR><name>` with the name in the current language,
`MCC_NAME_SEPARATOR = ' – '` (space, U+2013 en dash, space), a code constant in `mcc-names.ts`,
the same in en and uk (not a catalogue key: the text is identical in both languages, as `SEPARATOR`
in `rule-summary.ts`). It differs from the rule card's own row separator ` · `, so a card summary
reads "Merchant code (MCC) 5411 – Grocery Stores, Supermarkets · Type Expense". A code not in the
list shows as its four digits alone ("0042").

## 4. The user's own codes

### 4.1 Read

`transactionsRepo.mccCountsQuery()`, beside `contextCategoriesQuery` in
`src/transactions/repo/transactions.repo.ts`: `SELECT mcc, count(*) FROM transactions WHERE mcc
BETWEEN 0 AND 9999 GROUP BY mcc ORDER BY count(*) DESC, mcc ASC` (`BETWEEN` is false on NULL, so
no `IS NOT NULL`). The range matches what a rule can store (parser: integer 0-9999). Every row
counts, whatever its category or hand flag: a rule condition tests every row.

Consumer: the picker field calls `useLiveQuery(transactionsRepo.mccCountsQuery(), ['transactions'],
open)`: `enabled` is true only while the picker sheet is open (kiko-architecture, "`paused` vs
`enabled`": the data is structurally not needed while closed). The field passes
`ownLoading: !open || isLoading` to the rows: while the read is loading, and while the sheet closes
(`enabled` false gives `[]` with `isLoading` false during the close fade), the own section shows its
heading only, never the empty text.

### 4.2 Bound (counted work, never wall clock)

- One SQL statement per read; its plan is one `SCAN transactions` row, every other row a temp
  B-tree for GROUP BY or ORDER BY, no `SEARCH`, no other table, no index (none exists on `mcc`;
  none is added).
- Rows returned equal the distinct non-null codes in range (at most 10,000; on the 50,000-row pin,
  exactly the seeded distinct count), never one per transaction; no JavaScript work per transaction.
- Zero reads while the sheet is closed; on a write while open, one re-read per reactive fire.
- Measured by a real `node:sqlite` pin on 50,000 seeded rows (task 8/10): statement count,
  `EXPLAIN QUERY PLAN` rows, result length and count sum. Wall clock measured by hand and quoted in
  the READY report, as the track's precedent states (plan S13, 2026-11-03). Spec 3.2.3 of the base
  spec measured a 100,000-row GROUP BY scan on a Mac; Statistics already reads every row live, so
  this is no new class of cost.

## 5. The picker

### 5.1 Field

`MccField` in `src/screens/forms/category-rule-form/mcc-field/`, built from shared parts only
(`FieldTrigger`, `BottomSheet`, `TextField`, `SelectableRow`, `Text`, `Box`), modeled on
`CurrencyField` (pinned search field, own `FlatList`, `keyboardShouldPersistTaps="handled"`, query
reset on close, `Keyboard.dismiss` on pick). No new design-system component.

| State | Trigger value | Below the trigger |
|---|---|---|
| `mccText` empty, not typing | placeholder `ruleForm.selectMcc`, secondary tone | hint |
| a listed code | `5411 – Grocery Stores, Supermarkets` (name per language) | hint |
| a four-digit code not in the list | `0042` | hint |
| typing (after "Other code") | label of the typed code when four digits, else `ruleForm.mccOther` | `TextField` `ruleForm.mccTypedLabel`, number pad, digits only, `MCC_DIGITS` max (today's filter), then hint |

Typing state is local to `MccField`, set by "Other code", cleared by a pick from the list. On mount
it starts true only when `mccText` is non-empty and not four digits (a half-typed code survives a
type switch and back; `MatcherDraft` keeps `mccText` as today). The error (`errorMcc`) shows under
the typed field while typing, else under the trigger. Validation is unchanged: `mccOutcome` in
`rule-draft.ts`.

### 5.2 Sheet

Order: search field; "Other code" row (always shown, first); "Your codes" heading and rows; "All
codes" heading and rows; a no-match line when a query empties both sections.

- Own row: label = the code's label; second line `ruleForm.mccTransactionCount` (plural, `count`).
  An own code not in the list shows its digits. Order as the read returns it.
- All-codes row: label only; order by code.
- Own section with no codes and no query, after the read landed (`ownLoading` false): the heading
  and `ruleForm.mccOwnEmpty`. While a query is typed, a section the query empties is dropped with
  its heading (the `CurrencyField` rule).
- Search (`matchesMccQuery`, in `mcc-field/mcc-picker-rows.ts`, its only caller's file): one fold
  applied to the query AND the name: trimmed, lowercased, and ASCII `'`, U+2019 and U+02BC read as
  one character. So a typed `об'єкт` finds a uk name stored with U+02BC, and a typed `men's` finds
  an en name written with `'` or U+2019. A query of digits only matches codes that start with it;
  any other query matches the folded name in the current language by substring. The "Other code"
  row: picking it while the query is digits only seeds the typed field with those digits (at most
  four); else with the current `mccText`.
- The picked code's row shows selected in both sections.

### 5.3 VoiceOver

- Trigger: `FieldTrigger` reads its label `Merchant code (MCC)` and the value text.
- Headings: `accessibilityRole="header"`.
- Rows: `accessibilityRole="button"`, label = parts joined by ", ": code, name if any, count text
  for an own row ("5411, Grocery Stores, Supermarkets, 12 transactions"). "Other code" row: its label
  and its second line `ruleForm.mccOtherDescription`.
- The typed field: `TextField` label `ruleForm.mccTypedLabel`.

### 5.4 Scenario matrix (the ruling replaces typed-only input)

| Case | was: | now |
|---|---|---|
| New mcc condition | empty text field | trigger with "Select a code"; the sheet lists own then all codes |
| Stored rule, code 5411 | text field "5411" | trigger "5411 – Grocery Stores, Supermarkets" |
| Stored rule, code 42 (not listed) | text field "0042" | trigger "0042"; "Other code" opens the typed field holding "0042" |
| Type a code not in the list | type in the field | "Other code", then type; same validation |
| Partial code "54", switch type and back | field "54" | typed field "54", typing on |
| Save with nothing picked | error under the field | `errorMcc` under the trigger |
| Saved rule | `{ type: 'mcc', code }` | unchanged |
| Rule card value, code 5411 | "5411" | "5411 – Grocery Stores, Supermarkets" (Q-MCC3) |
| Rule card value, code 42 | "0042" | "0042" |
| Sheet closing (fade) | n/a | own heading only, no empty text |
| User with no MCC rows (manual only) | n/a | own section heading + empty text; full list usable |
| App Store reviewer | n/a | own codes after importing the kit's Monobank statement (MCC column checked in plan task 7/10 step 1); else seeded demo rows (plan task 9/10, conditional steps) |

Reviewer kit check (plan task 7/10 step 1, 2026-11-08, read only): the kit folder is
`memory/refs/reviewer-kit/` in the main checkout (one folder, untracked). Its
`kiko-demo-statement-monobank.csv` (64 data rows, a header row, 65 lines) HAS an MCC column: the
third column, headed `MCC`, with a four-digit value on every one of the 64 rows (14 distinct codes:
5411 x9, 5814 x7, 5732 x7, 4814 x7, 4121 x7, 5912 x5, 5811 x5, 4829 x4, 4111 x4, 5812 x3, 5818 x2,
5541 x2, 5815 x1, 4899 x1). The importer reads that column (`COLUMN.mcc: 2` in
`monobank-csv.format.ts`, mapped in `mapping.ts`), so the reviewer's "Your codes" section fills after
`Monobank` > Import statement. Result: plan task 9/10 steps 7-8 are skipped. The kit's
`HOW-TO-IMPORT.txt` names the statement but not its MCC column; the Notes for Review (plan "Texts for
the user") name the path.

## 6. Rule card (Q-MCC3)

`describeMatcher` in `src/screens/forms/category-form/rule-summary/rule-summary.ts` gains an option
`mccLabelOf: (mccText: string) => string` on `RuleSummaryOptions`, resolved by the caller
(`category-form.screen.tsx`) with `mccLabelOf` of `@kiko/categories/mcc-names` in the current
language, as `accountNameOf` is resolved today. `describeMatcher` keeps its four-digit pad
(`padStart(MCC_DIGITS, '0')`) and passes the padded text, so a stored code 42 reaches the option as
"0042" (section 5.4). The summary builds no label of its own: the value is exactly the field's
label, built once.

## 7. Notice (Q-MCC2)

Default A: a Settings row "Acknowledgements" (its own card below Help, SF Symbol `doc.text`) opens a
plain text page: a title, one intro sentence, then per data set its name (catalogue key), its source
line and its license name, then for Sominemo the MIT text. `doc.text` is in SF Symbols 1.0
(iOS 13.0+ in `sf-symbols-typescript`), so it exists on the deployment target iOS 18.2
(kiko-design-system, "SF Symbol availability"; `__tests__/symbol-deployment-target.test.tsx` checks
the quoted literal).

Untranslated constants in `src/categories/mcc-names/mcc-names.notice.ts`, shown the same in both
languages, not catalogue keys: each data set's source line (the repository URL), its license name
(`The Unlicense`, `MIT License`), and the Sominemo MIT text (copyright line, permission notice,
warranty paragraph) verbatim from the LICENSE file at the pinned commit. Legal text and URLs are not
translated, and the MIT text's straight quotes would break the uk catalogue rules. The greggles
entry (name, source, license name) is the courtesy line: the Unlicense asks for none.

B: the generator drops the Sominemo input; a new hand-written uk file (kiko-translator) covers all
981 codes; no notice and no page.
C: one caption row at the end of the picker list crediting the uk names, with the MIT text reachable
from it. What each changes: plan section "Pending defaults".

## 8. Compliance, i18n, export, help

- Guideline 2.5.19: no flag; the picker shows on every mcc condition, and its own section shows its
  empty text with no data. The demo rows hold `mcc: null` (accepted in base plan S22). The reviewer
  reaches "Your codes" by importing the reviewer kit's fake Monobank statement when it has an MCC
  column (plan task 7/10 step 1 checks); if it has none, plan task 9/10 seeds `mcc` on a few demo
  Monobank rows and regenerates both demo `.kiko` files. The Notes for Review name the picker, the
  own-codes path and Acknowledgements (plan "Texts for the user"). The Acknowledgements row shows on
  every install. No demo or seed import from `src/`.
- No network call, SDK or permission; the list is bundled data (2.5.2 not touched). App Privacy
  unchanged.
- Trademarks: the en names of codes 3000-3999 (airlines, hotels, car rental) are the sources' descriptive text, no
  logo, no partnership claim; reviewer judgment item.
- `.kiko` export and import: unchanged; a rule stores only the code. No migration, no
  `EXPORT_VERSION` change, no owed state, so no upgrade world changes.
- Help: unchanged. `help.topics.categoryRules.steps.2` already names "the merchant code"; the
  picker explains itself.
- i18n: both catalogues together; plurals `_one/_few/_many/_other` in both; uk apostrophe U+02BC;
  the sheet title and the page title in `src/i18n/locales/title-keys.ts`. Removed or renamed keys:
  none. One changed copy: `ruleForm.errorMcc`.

## 9. Texts (drafts; kiko-translator decides, the user approves)

16 new keys (the plural group counted once; 11 picker, 5 Acknowledgements) and one changed copy:
17 rows. Plus user-visible texts that are code constants, listed for the user too: the separator
` – ` (section 3.4) and the notice constants (section 7).

| Key | en | uk |
|---|---|---|
| `ruleForm.mccSheetTitle` (title key; the `ruleForm.mcc` label's twin) | Merchant Code (MCC) | Код продавця (MCC) |
| `ruleForm.selectMcc` | Select a code | Оберіть код |
| `ruleForm.mccSearchPlaceholder` | Search by code or name | Пошук за кодом або назвою |
| `ruleForm.mccOther` | Other code | Інший код |
| `ruleForm.mccOtherDescription` | Type any four-digit code. | Введіть будь-який чотиризначний код. |
| `ruleForm.mccTypedLabel` | Four-digit code | Чотиризначний код |
| `ruleForm.mccOwnSection` | Your codes | Ваші коди |
| `ruleForm.mccAllSection` | All codes | Усі коди |
| `ruleForm.mccOwnEmpty` | No codes in your transactions yet. Syncs and statements from some banks add them. | У ваших транзакціях ще немає кодів. Їх додають синхронізація та виписки деяких банків. |
| `ruleForm.mccNoMatch` | No codes match your search. | Немає кодів за вашим запитом. |
| `ruleForm.mccTransactionCount_one/_few/_many/_other` | `{{count}} transaction`; the rest `{{count}} transactions` | `{{count}} транзакція` / `{{count}} транзакції` / `{{count}} транзакцій` / `{{count}} транзакції` |
| `ruleForm.errorMcc` (changed) | was: Enter a four-digit code. now: Select a code or enter four digits. | was: Введіть чотиризначний код. now: Оберіть код або введіть чотири цифри. |
| `settings.acknowledgements` (Q-MCC2 A) | Acknowledgements | Подяки |
| `acknowledgements.title` (title key) | Acknowledgements | Подяки |
| `acknowledgements.intro` | Kiko uses these open data sets. Their licenses are below. | Кіко використовує ці відкриті набори даних. Їхні ліцензії наведено нижче. |
| `acknowledgements.mccNamesEnglish` | Merchant code names in English | Назви кодів продавців англійською |
| `acknowledgements.mccNamesUkrainian` | Merchant code names in Ukrainian | Назви кодів продавців українською |

Data texts for the user: every uk name (Sominemo) and the en names, as one review table written
by the regeneration run (plan task 7/10).
