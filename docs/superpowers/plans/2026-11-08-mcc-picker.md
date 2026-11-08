# MCC Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The rule condition "Merchant code (MCC)" gets a searchable picker: the user's own codes
with row counts first, then the full standard list with en and uk names, plus "Other code" to type
any four digits.

**Architecture:** A generated, committed data module `src/categories/mcc-names/` (code, en, uk)
built by a dependency-free Node generator from two pinned community files. One live aggregate read
`transactionsRepo.mccCountsQuery()`, enabled only while the sheet is open. A screen-local `MccField`
built from shared design-system parts. The stored rule does not change.

**Tech Stack:** React Native, Hermes, op-sqlite (SQLCipher), Drizzle, react-native-unistyles,
i18next, ts-pattern, jest with `node:sqlite`.

**Spec:** `docs/superpowers/specs/2026-11-08-mcc-picker-design.md` (addendum to
`docs/superpowers/specs/2026-11-03-category-automation-design.md`). Refer to it by section; this
plan does not copy it. Every count here is a floor: the developer measures. Every code fact names a
symbol, not a line: re-grep each fact on the actual base before building on it.

## Global Constraints

- The stored rule stays `{ type: 'mcc'; code: number }`: no parser, matcher, schema, migration,
  index, `EXPORT_VERSION` or settings change (spec 8). No owed state is added, so no seed is an
  upgrade world: existing suites stay green unchanged except the pins the ruling changes, listed per
  task with a "was:" line.
- Downloads are untrusted data: each in its own new, empty scratch directory, outside the
  worktree; read by path with `JSON.parse` only; never executed; never committed. The generator
  refuses a file whose SHA-256 differs from its pinned value.
- The generator is dependency-free Node (`require('node:...')` only). It never writes into a guarded
  tree from a shell: the data module lands through the regeneration test (`KIKO_REGEN_MCC=1`), the
  precedent of `KIKO_REGEN_DEMO` in `e2e/screenshot/fixtures/README.md`.
- UI: shared components and theme tokens only; no new design-system component; no import across
  screen folders. `1.4-light-scheme` then applies by itself.
- Guideline 2.5.19: no flag; the picker and its empty state show with no data; the Acknowledgements
  row shows on every install.
- A catalogue key added or a copy line changed: same step in `en.ts` and `uk.ts`; kiko-translator
  casing and full-stop rules by role; plurals `_one/_few/_many/_other` in both; uk apostrophe
  U+02BC; uk says «Кіко», «натиснути»; a sheet or nav title key goes in `title-keys.ts`. Removed or
  renamed keys: none.
- Tests: kiko-testing. No history note or task id in a test or comment. A qa red commit reads a
  missing export by a runtime lookup or a test-local cast, so the staged typecheck passes; the green
  commit tidies it. Show the red output, never claim it. Keep jest output in a file. Never
  `--no-verify`.
- Load: named jest only, `npx jest <files> --maxWorkers=2` after `bash scripts/wait-load.sh 15 3600`;
  `make jest-affected BASE=<task base>` only when the coordinator's power mode allows. Exit 3
  (`AFFECTS EVERY SUITE`) is expected for `en.ts`, `uk.ts`: run the task's named files instead and
  say so in READY.
- Harness: the orchestrator never queues. Each task ends READY FOR VERIFY; the coordinator queues
  `bash scripts/job-queue.sh verify <worktree> <label>` once and reruns until green. No agent runs
  `make verify`, `check:all` or full jest. Mutation: the coordinator's queued gate per task with
  `KIKO_MUTATION_BASE` = that task's own base commit, never a whole-branch run; gates are paused by
  the user, so none is scheduled until lifted.
- No duration estimate anywhere; whoever needs one uses `kiko:estimator`.

Run-log gaps (`run-log.mjs stats --gaps --repo kiko`, read 2026-11-08): this plan closes none and
leaves all open. Nearest, left open: `20261015T1035-kiko-release-1-2/3` (rule-form barrel for a demo
test; this plan adds no demo test) and `20261025T1318-kiko-empty-selectors/6` (created-option pickers
repeat open-guard-create; the MCC picker creates nothing).

## Review Focus

1. The first tap on a row while the search keyboard is up: `CurrencyField` needed
   `keyboardShouldPersistTaps="handled"`, or the tap only dismisses the keyboard. Pinned in task
   9/10; sim check.
2. A stored code not in the list (42) and a half-typed "54": the trigger must show the digits, and
   "Other code" must open the typed field holding them, never an empty one. Pinned in task 9/10.
3. A uk search with an ASCII apostrophe (`об'єкт`) must find a name stored with U+02BC. Pinned in
   task 9/10.
4. The own read under a sync while the sheet is open: one re-read per fire, never a read while
   closed. Pinned in task 9/10 (the `enabled` argument) and task 8/10 (one statement).
5. A Sominemo uk name with `'` or `’` inside a word reaching the bundle: the generator rewrites it
   and a data pin refuses it. Pinned in task 7/10.

## Details settled by this plan

| # | Decision | Reason |
|---|---|---|
| P1 | Task labels continue the track: `1.4-category-automation task 7/10` to `10/10`; verify labels `1.4-category-automation-task-7` and so on. Tasks stack in this worktree, each base the previous task's tip. | The base plan used 1/6 to 6/6; distinct labels keep the run log and queue apart. |
| P2 | The data file is `.ts`, `MCC_NAMES: readonly MccName[]`, sorted by code. The regeneration run writes it, then `./node_modules/.bin/biome format --write` on that one file (not `npx`, which rtk rewrites). | Typed, bundled by Metro; `mutation.sh` mutates it, and the non-empty and count pins kill its string and array mutants. |
| P3 | `scripts/mcc-names/generate-mcc-names.js` exports pure functions (`MCC_SOURCES`, `verifySource`, `buildMccNames`, `renderMccNamesModule`, `renderReviewTable`). The write is in `__tests__/generate-mcc-names.test.ts` under `KIKO_REGEN_MCC=1` with `KIKO_MCC_GREGGLES`, `KIKO_MCC_SOMINEMO`, `KIKO_MCC_REVIEW_OUT` paths. | A shell write into `src/` is denied by kill-guard; a test-process write has the demo precedent. Knip sees the script through the test. |
| P4 | Brand-range uk names by rule (spec 3.2); every other gap from `scripts/mcc-names/uk-own-names.json`. | Hundreds of brand codes need no translation, only a noun; the user approves three nouns. |
| P5 | `MccField` lives in the screen folder, reads `ruleForm.*` keys, and owns its own `useLiveQuery`. `MatcherRow` passes `draft.mccText`, `onChange`, `error`, `position`. | `check:component-i18n-namespace` binds design-system components only; a field-local read keeps the read off the screen for non-mcc rules. |
| P6 | If `npm run check:dup` flags `MccField` against `CurrencyField`, stop and report; no `dup-ceilings.tsv` entry and no ignore without a coordinator ruling. The fix is extracting the pinned-search sheet into the design system with a `kiko:designer` step. | Standing rule; no ceiling raised to pass. |
| P7 | The data file is not in `.jscpd.json` `ignore`. If jscpd flags it, stop and report. | An ignore entry needs a documented exception and a ruling. |
| P8 | Language: `i18n.language === 'uk'` picks `uk`, anything else `en` (`appLanguages` in `src/i18n/device-language/device-language.ts`). Memo keys include `i18n.language`. | A live language switch re-labels the list, as Home's titles do. |

## Conflict surface

| Task | Shared files | Other tracks |
|---|---|---|
| 7 | `en.ts`, `uk.ts`, `rule-summary.ts`, `category-form.screen.tsx` | `1.4-small` edits both catalogues; added lines only |
| 8 | `transactions.repo.ts` (one added member) | `1.4-tables` may add reads beside it; additive |
| 9 | `matcher-row.component.tsx`, `en.ts`, `uk.ts`, `title-keys.ts` | additive |
| 10 | `settings.screen.tsx`, `settings.stack.tsx`, `src/navigation/types/types.d.ts`, the pane route list, `en.ts`, `uk.ts`, `title-keys.ts` | `1.4-small` rewrites `settings.screen.tsx`: merge `next` first, then add the card |

## Closing steps (every task, same order)

Each task's last steps, named by number in the task:

- **Review:** `kiko:reviewer` on the task's diff from its base; the diff of test files is checked
  for edited pins against the task's "was:" list.
- **Drift:** `kiko:retrospect` checks `.claude/skills/`, `harness/kiko/skills/`,
  `harness/kiko/agents/` against the task's code.
- **Scribe:** `kiko:scribe` fixes the drift and commits; the report names the sha or "no drift
  found".
- **Ready:** READY FOR VERIFY to the coordinator: worktree, label, base sha, head sha, mutable file
  count (`make mutable` with `KIKO_MUTATION_BASE` = task base), named-file runs and their output
  path, hand-measured numbers where the task asks. The coordinator queues the verify, reruns it
  until green, and merges.

Track end, after task 10/10 READY and before the final merge: the `kiko:designer` read-only
consistency check of the picker diff (tasks 9/10 and 10/10 against task 9/10's base), the sim check
list below, and the texts to the user (section "Texts for the user").

---

## 1.4-category-automation task 7/10: the MCC name data and the rule card label

**Needs:** nothing. **Base:** a00115db2 or the track tip when it starts.

**Files (floor). Mutable: 4** (`mcc-names.ts`, `mcc-names.data.ts`, `rule-summary.ts`,
`category-form.screen.tsx`).
- Create: `scripts/mcc-names/generate-mcc-names.js`, `scripts/mcc-names/uk-own-names.json`,
  `src/categories/mcc-names/mcc-names.data.ts` (generated), `src/categories/mcc-names/mcc-names.ts`,
  `src/categories/mcc-names/index.ts`
- Modify: `src/screens/forms/category-form/rule-summary/rule-summary.ts`,
  `src/screens/forms/category-form/category-form.screen.tsx`, `src/i18n/locales/en.ts`, `uk.ts`,
  `docs/superpowers/specs/2026-11-08-mcc-picker-design.md` (sections 3.1, 3.3)
- Tests: `__tests__/generate-mcc-names.test.ts`, `src/categories/mcc-names/mcc-names.test.ts`,
  `src/screens/forms/category-form/rule-summary/rule-summary.test.ts`,
  `src/screens/forms/category-form/category-form.screen.test.tsx`

**Interfaces. Produces:**
```ts
// @kiko/categories/mcc-names
export type MccName = { code: string; en: string; uk: string };
export const MCC_NAMES: readonly MccName[];
export const mccNameOf: (code: string, language: string) => string | undefined;
export const mccLabelOf: (code: string, language: string, t: TFunction) => string; // "5411 · ..." or "0042"
// scripts/mcc-names/generate-mcc-names.js (CommonJS)
MCC_SOURCES: { greggles: { url, commit, sha256, license }, sominemo: { url, commit, sha256, license } }
verifySource(text, expectedSha256): void // throws on mismatch
buildMccNames({ greggles, sominemo, ukOwn }): { entries: MccName[]; report: { dropped: string[]; bySominemo: number; byBrand: number; byOwn: number } }
renderMccNamesModule(entries): string
renderReviewTable(entries): string // TSV: code, en, uk, uk source
```

- [ ] **step 1/11 (kiko:developer): fetch and measure.** In a new, empty scratch directory per file,
  fetch greggles `mcc_codes.json` and the Sominemo uk file from
  `raw.githubusercontent.com/<owner>/<repo>/<commit>/<file>` at the commits of spec 3.1. Read only
  with a scratch Node script kept in another directory, passing the paths as arguments. Record in
  spec 3.1 and 3.3 (Edit): exact file names, field names (greggles `mcc`, `edited_description`,
  `combined_description`; Sominemo's uk shape and whether it has a short name), SHA-256 of each
  file, the counts listed in spec 3.3, a five-row sample of each, and the presence of 5411, 5812,
  4829, 6011, 0742. A missing one of the first four, or a license file that differs from the
  research quote, is a stop-and-report. Also read the Sominemo LICENSE at the commit and keep its
  exact text for task 10/10. Commit `docs(category): measured MCC sources`.

- [ ] **step 2/11 (kiko:qa): generator pins.** Create `__tests__/generate-mcc-names.test.ts`, tiny
  inline inputs only, no download:
  - `takes the edited description and falls back to the combined one`; `trims and collapses spaces`.
  - `pads a code to four digits and keeps leading zeros` (`742` and `"742"` give `"0742"`).
  - `refuses a code that is not four digits after padding`; `refuses a duplicate code with a
    different name`, `accepts a duplicate with the same name once`.
  - `takes the Sominemo uk name first, then the brand rule, then the own file` (one code each).
  - `names a brand code by its range noun`: 3000 «Авіакомпанія», 3351 «Прокат авто», 3501 «Готель»;
    3350 and 3500 and 3999 at the range ends.
  - `refuses a run with a code that has no uk name, listing every such code`.
  - `rewrites an ASCII or right-quote apostrophe inside a Cyrillic word to U+02BC` and `leaves a
    quote outside a word`.
  - `drops a Sominemo-only code and reports it`.
  - `sorts the entries by code`.
  - `refuses a source whose SHA-256 differs from the pinned one`.
  - `renders a module whose header names both sources, commits, licenses and the regeneration
    command` and `renders a review table with one line per code`.
  - `MCC_SOURCES pins full forty-character commits and sixty-four-character SHA-256 values`.
  - `describe('regenerate the MCC names module')` only under `KIKO_REGEN_MCC=1`: reads both
    downloads by env path, verifies, builds, writes `src/categories/mcc-names/mcc-names.data.ts`
    and the review TSV at `KIKO_MCC_REVIEW_OUT`.
  Red: `npx jest __tests__/generate-mcc-names.test.ts --maxWorkers=2` (module missing). Commit
  `test(category): pins for the MCC names generator`.

- [ ] **step 3/11 (kiko:developer): the generator.** `generate-mcc-names.js`, spec 3.2 in order,
  header with the URLs, commits, SHA-256, licenses (Unlicense; MIT, "Copyright (c) 2020 Sominemo")
  and the regeneration command. Dependency-free (kiko-linter's Node checker rule). Green: same
  command. Commit `feat(category): MCC names generator`.

- [ ] **step 4/11 (kiko:qa): data pins.** Create `src/categories/mcc-names/mcc-names.test.ts`, reading
  the module (never its text):
  - `holds each code once`; `holds only four-digit codes`; `is sorted by code`.
  - `holds exactly <N> codes` (N from step 1's measured output count).
  - `gives every code a non-empty English and Ukrainian name, trimmed, with no control character`.
  - `uses the U+02BC apostrophe in every Ukrainian name` (no `'` or U+2019 between two Cyrillic
    letters; regex as in `uk.catalog-rules.test.ts`).
  - `holds the common codes`: 5411, 5812, 4829, 6011, `0742` with its leading zero.
  - `names every code the category map knows`: each code 0-9999 with `categoryForMcc(code) !==
    'other'` (from `@kiko/monobank/mcc-category`) has an entry; a gap is a stop-and-report.
  - `mccNameOf gives the name per language and undefined for an unlisted code`; `treats a language
    other than uk as en`.
  - `mccLabelOf joins code and name and shows an unlisted code as its digits`.
  Red: `npx jest src/categories/mcc-names --maxWorkers=2`. Commit `test(category): MCC names data
  pins`.

- [ ] **step 5/11 (kiko:developer): own uk names and the data.** Write `uk-own-names.json` for every
  non-brand gap the generator lists (kiko-translator; U+02BC). Run
  `KIKO_REGEN_MCC=1 KIKO_MCC_GREGGLES=<path> KIKO_MCC_SOMINEMO=<path>
  KIKO_MCC_REVIEW_OUT=.superpowers/sdd/1.4-category-automation/mcc-names-review.tsv npx jest
  __tests__/generate-mcc-names.test.ts --maxWorkers=2`, then
  `./node_modules/.bin/biome format --write src/categories/mcc-names/mcc-names.data.ts`. Write
  `mcc-names.ts`, `index.ts` (barrel). `ruleForm.mccWithName` in both catalogues (spec 9). Green:
  step 2 and step 4 commands. Run `npm run check:dup`; a finding on the data file is P7. Commit
  `feat(category): bundled MCC names, en and uk`.

- [ ] **step 6/11 (kiko:qa): rule card pins.** In `rule-summary.test.ts`, the ruling changes one pin:
  - was: `{ label: 'Merchant code (MCC)', value: '5411' }`; now `value: '5411 · Grocery Stores,
    Supermarkets'` (the measured en name). `value: '0042'` for code 42 stays.
  - Add `shows the mcc name in Ukrainian` and `shows an unlisted code as its digits`.
  - `category-form.screen.test.tsx`: `shows a merchant-code rule with its name on the card`.
  Red, named files. Commit `test(category): the rule card names the merchant code`.

- [ ] **step 7/11 (kiko:developer): the card.** `mccNameOf` option on `RuleSummaryOptions` (spec 6),
  resolved in `category-form.screen.tsx` from `i18n.language` (P8); every caller of the summary
  passes it (grep the callers). Green: named files plus `src/categories/mcc-names`. Commit
  `feat(category): rule card shows the merchant code name`.

- [ ] **step 8/11 Review (kiko:reviewer).** Top questions: can any download path execute or land
  outside its scratch directory; does the generator refuse every malformed input the spec lists; is
  the provenance table complete (URLs, commits, SHA-256, licenses). No migration.
- [ ] **step 9/11 Drift (kiko:retrospect).** Check kiko-domain (MCC text), kiko-translator (data
  names kept out of the catalogue), kiko-architecture (bundled data, regeneration precedent),
  kiko-linter (a new dependency-free Node script under `scripts/`).
- [ ] **step 10/11 Scribe (kiko:scribe).**
- [ ] **step 11/11 Ready.** Label `1.4-category-automation-task-7`. The report names the review TSV
  path for the user's text review.

---

## 1.4-category-automation task 8/10: the user's own codes with counts

**Needs:** nothing. **Base:** task 7/10 tip.

**Files (floor). Mutable: 1.**
- Modify: `src/transactions/repo/transactions.repo.ts` (`mccCountsQuery`, beside
  `contextCategoriesQuery`)
- Tests: `src/transactions/repo/transactions.repo.mcc-counts.test.ts`,
  `src/transactions/repo/transactions.repo.mcc-counts.performance.test.ts`

**Interfaces. Produces:**
```ts
// transactionsRepo
mccCountsQuery: () => SQLQuery<{ mcc: number; rowCount: number }> // spec 4.1
```

- [ ] **step 1/7 (kiko:qa): read pins on real SQLite.** `transactions.repo.mcc-counts.test.ts`
  (`executingClient`, `applyAllMigrations`):
  - `counts each code once, most rows first, then by code`.
  - `leaves out rows with no code and codes outside 0 to 9999`.
  - `counts hand-set, balance, split-change and exchange-leg rows alike`.
  - `returns no rows for a ledger with no code`.
  - `is one statement` (`toSQL()` and the client's statement count).
  Red: named file. Commit `test(transactions): pins for the own MCC counts read`.

- [ ] **step 2/7 (kiko:qa): bound pin.** `transactions.repo.mcc-counts.performance.test.ts`, its own
  seed (not `rules-performance-fixture`, base plan S14): 50,000 rows, `mcc` derived from the row
  index (one in five null, 300 distinct codes, a few outside the range). Header states counted work
  only, wall clock by hand. Cases:
  - `reads 50,000 rows in one statement and returns one row per distinct code`: length 300, count
    sum equals the non-null in-range rows.
  - `plans one scan of transactions and no other table`: `EXPLAIN QUERY PLAN` detail rows pinned
    exactly as measured (one `SCAN transactions`, the temp B-trees, nothing else; any `SEARCH` or a
    second table fails).
  Red: named file. Commit `test(transactions): bound for the own MCC counts read`.

- [ ] **step 3/7 (kiko:developer): the read.** `mccCountsQuery` with a doc comment (spec 4.1). Green:
  both files. Measure the 50,000-row read by hand three times; quote the numbers in READY. A plan
  other than the pinned one is a stop-and-report, never a new index without a migration plan and a
  `kiko:reviewer` step. Commit `feat(transactions): own MCC counts read`.

- [ ] **step 4/7 Review (kiko:reviewer).** Top question: is the bound in spec 4.2 what the pins
  measure, and can any caller run the read while the picker is closed. No migration, no index;
  confirm the plan pins.
- [ ] **step 5/7 Drift (kiko:retrospect).** kiko-architecture's repository and live-query text.
- [ ] **step 6/7 Scribe (kiko:scribe).**
- [ ] **step 7/7 Ready.** Label `1.4-category-automation-task-8`, with the hand-measured numbers.

---

## 1.4-category-automation task 9/10: the picker in the rule form

**Needs:** tasks 7/10 and 8/10. **Base:** task 8/10 tip.

**Files (floor). Mutable: 4.**
- Create: `src/screens/forms/category-rule-form/mcc-field/mcc-field.component.tsx`,
  `mcc-field.props.d.ts`, `mcc-field.styles.ts`, `index.ts`, `mcc-picker-rows.ts`
- Modify: `src/categories/mcc-names/mcc-names.ts` (`matchesMccQuery`),
  `src/screens/forms/category-rule-form/matcher-row/matcher-row.component.tsx`,
  `src/i18n/locales/en.ts`, `uk.ts`, `src/i18n/locales/title-keys.ts`
- Tests: `mcc-field/mcc-picker-rows.test.ts`, `mcc-field/mcc-field.component.test.tsx`,
  `src/categories/mcc-names/mcc-names.test.ts`, `matcher-row/matcher-row.component.test.tsx`,
  `category-rule-form.screen.test.tsx`

**Interfaces. Produces:**
```ts
// @kiko/categories/mcc-names
export const matchesMccQuery: (entry: { code: string; name: string | undefined }, query: string) => boolean;
// mcc-field/mcc-picker-rows.ts
type MccPickerRow =
  | { type: 'other' }
  | { type: 'heading'; section: 'own' | 'all' }
  | { type: 'ownEmpty' }
  | { type: 'noMatch' }
  | { type: 'code'; section: 'own' | 'all'; code: string; name: string | undefined; rowCount?: number };
export const mccPickerRows: (input: { own: readonly { mcc: number; rowCount: number }[]; ownLoading: boolean; query: string; language: string }) => MccPickerRow[];
// MccFieldProps
{ value: string; onChange: (mccText: string) => void; error: string | undefined; testID: string }
```

**Strings (spec 9):** `ruleForm.mccSheetTitle` (title key), `selectMcc`, `mccSearchPlaceholder`,
`mccOther`, `mccOtherDescription`, `mccTypedLabel`, `mccOwnSection`, `mccAllSection`,
`mccOwnEmpty`, `mccNoMatch`, `mccTransactionCount_*`; changed `errorMcc`.

- [ ] **step 1/12 (kiko:qa): search and rows pins.** `mcc-names.test.ts` adds `matchesMccQuery`:
  `a digits-only query matches codes that start with it` (`54` matches 5411, not 1543); `a text
  query matches the name by substring, any case`; `reads an ASCII apostrophe and U+2019 as U+02BC`;
  `a blank query matches every code`; `an unlisted code matches only by digits`.
  `mcc-picker-rows.test.ts`, each by `toEqual` on the whole row list:
  - `puts Other first, then own codes by the order given, then every code by code`.
  - `gives an own code its count and an unlisted own code no name`.
  - `shows the own heading and the empty row when the read landed with no codes`.
  - `shows the own heading alone while the read is loading`.
  - `drops a section and its heading when the query empties it, and keeps Other`.
  - `shows the no-match row when the query empties both sections`.
  - `names each code in the current language`.
  Red: named files. Commit `test(rules): pins for the MCC search and picker rows`.

- [ ] **step 2/12 (kiko:developer): search and rows.** Both functions, spec 5.2. Green: same command.
  Commit `feat(rules): MCC search and picker rows`.

- [ ] **step 3/12 (kiko:qa): field pins.** `mcc-field.component.test.tsx` (mock `useLiveQuery` by query
  kind; uk cases set the language in a hook, kiko-translator):
  - `shows the placeholder, a listed code with its name, and an unlisted code as its digits` (spec
    5.1 table, three renders).
  - `reads the own codes only while the sheet is open`: the `enabled` argument is false closed and
    true open.
  - `picks an own code on the first tap with the keyboard up` (`keyboardShouldPersistTaps` on the
    list) and `picks a code from the full list`; `onChange` gets the four-digit string; the sheet
    closes and the query resets.
  - `Other code opens the typed field seeded with the digits of the query`, and `with the current
    code when the query is not digits`; the typed field filters to digits and four at most.
  - `starts typing for a half-typed code and not for a four-digit one`.
  - `shows the error under the typed field while typing and under the trigger otherwise`.
  - `shows the own count as a plural in en and uk` (1, 2, 5, 21).
  - `labels rows for VoiceOver` (spec 5.3: joined label, headings with the header role).
  - `marks the picked code selected in both sections`.
  Red: named file. Commit `test(rules): pins for the MCC field`.

- [ ] **step 4/12 (kiko:developer): the field and strings.** `MccField` per spec 5 and P5, modeled on
  `CurrencyField`; strings in both catalogues; `ruleForm.mccSheetTitle` in `title-keys.ts`. Green:
  step 3 plus `src/i18n/locales`. Commit `feat(rules): MCC picker field`.

- [ ] **step 5/12 (kiko:qa): row and screen pins.** The ruling changes these pins; each was:/now in
  the commit message:
  - `matcher-row.component.test.tsx` `an mcc row shows a number-pad field limited to four digits`:
    was: types in the `Merchant code (MCC)` field; now: opens the trigger, picks "Other code", types
    in `Four-digit code`, same `onChange` calls (`'5411'`, `'54'`).
  - `explains the merchant code on an mcc condition` (en and uk): the hint stays, unchanged.
  - `category-rule-form.screen.test.tsx` `keeps a typed merchant code when the type of the row is
    changed and changed back`: was: the field value `5411`; now: the trigger shows `5411 · <name>`.
  - Add, screen: `saves a picked code as the code only` (pick 5411, Save, the saved matchers equal
    `[{ type: 'mcc', code: 5411 }]`); `edits a stored unlisted code through Other code`.
  Red, named files. Commit `test(rules): the mcc condition uses the picker`.

- [ ] **step 6/12 (kiko:developer): wiring.** `MatcherRow` `.with('mcc', ...)` renders `MccField` and
  the hint. The screen's `useLiveQuery` mock gains the new kind. Green: `npx jest
  src/screens/forms/category-rule-form src/categories/mcc-names src/i18n/locales --maxWorkers=2`.
  Run `npm run check:dup` (P6). Commit `feat(rules): the mcc condition opens the picker`.

- [ ] **step 7/12 (kiko:designer, read-only): picker look.** Against kiko-design-system: sheet
  chrome, section headings, row second line, the typed field under the trigger, light and dark,
  large Dynamic Type. Findings go to a fix step, not inline.
- [ ] **step 8/12 (kiko:developer): designer fixes, if any.** Own commit.
- [ ] **step 9/12 Review (kiko:reviewer).** Top question: can the field show a value the save does
  not store, or store a code the user did not see. Check the pin edits against step 5's list.
- [ ] **step 10/12 Drift (kiko:retrospect).** kiko-design-system (searchable picker pattern now has
  two users), kiko-domain (the mcc condition's input), kiko-testing if a helper was added.
- [ ] **step 11/12 Scribe (kiko:scribe).**
- [ ] **step 12/12 Ready.** Label `1.4-category-automation-task-9`. UI changes need the sim check
  items below and the user's device confirm.

---

## 1.4-category-automation task 10/10: acknowledgements (Q-MCC2, default A)

**Needs:** task 7/10. **Base:** task 9/10 tip.

**Q-MCC2 isolation.** Only this task changes with the answer:
- A (default): the steps below.
- B: replace steps 1-4 with: drop the Sominemo input from `buildMccNames` and `MCC_SOURCES`, write
  own uk names for every code in `uk-own-names.json`, regenerate (task 7/10 step 5 command), update
  spec 3.1 and 7; pins: `MCC_SOURCES` holds greggles only, the data pins unchanged.
- C: replace steps 1-4 with one caption row at the end of the picker list (`mccPickerRows` gains a
  `credit` row) whose press shows the notice in a sheet; same notice constant.

**Files (floor). Mutable: 4.**
- Create: `src/categories/mcc-names/mcc-names.notice.ts`,
  `src/screens/settings/acknowledgements/acknowledgements.screen.tsx`, `index.ts`
- Modify: `src/screens/settings/settings/settings.screen.tsx`,
  `src/navigation/settings-stack/settings.stack.tsx`, `src/navigation/types/types.d.ts`
  (`SettingsStackParamList`), the pane route list `openInPane` reads (grep it), `en.ts`, `uk.ts`,
  `title-keys.ts`
- Tests: `acknowledgements.screen.test.tsx`, `settings.screen.test.tsx`, `settings.stack.test.tsx`

- [ ] **step 1/8 (kiko:qa): pins.**
  - `acknowledgements.screen.test.tsx`: `shows the MIT notice verbatim` (equals the LICENSE text
    task 7/10 step 1 kept, as a literal in the test); `shows it unchanged in Ukrainian`; `credits
    both data sets with their licenses`.
  - `settings.screen.test.tsx`: `opens Acknowledgements from its own row` (pane-aware, as the Help
    row); `shows the row with no data`.
  - `settings.stack.test.tsx`: `registers the Acknowledgements page with its title`.
  Red, named files. Commit `test(settings): pins for acknowledgements`.
- [ ] **step 2/8 (kiko:developer): page, row, route.** Spec 7; model the page on
  `help-topic.screen.tsx`; the row's card below Help, after the `settings-card-help` precedent;
  strings in both catalogues, `acknowledgements.title` in `title-keys.ts`. Green: named files plus
  `src/i18n/locales src/navigation/settings-stack`. Commit `feat(settings): acknowledgements page`.
- [ ] **step 3/8 Review (kiko:reviewer).** Top question: does the shipped notice satisfy MIT's
  "included in all copies or substantial portions" for the bundled uk names.
- [ ] **step 4/8 Drift (kiko:retrospect).** kiko-compliance (licenses of bundled data), kiko-design-
  system (a plain text page), kiko-architecture (Settings routes).
- [ ] **step 5/8 Scribe (kiko:scribe).**
- [ ] **step 6/8 (kiko:designer, read-only): track-end consistency check** of the picker diff from
  task 9/10's base to this tip, plus the Acknowledgements page (user rule 2026-11-06).
- [ ] **step 7/8 (kiko:developer): designer fixes, if any**, then a fresh review of that diff.
- [ ] **step 8/8 Ready.** Label `1.4-category-automation-task-10`; the report says the texts went
  to the user and names the answer used for Q-MCC2.

---

## Texts for the user

Sent through the coordinator before any merge into `next`, in one message:
1. The UI strings of spec 9 (18 rows: 17 new keys, the plural group counted once, 12 for the
   picker and card and 5 for Acknowledgements; one changed copy `ruleForm.errorMcc` with its was:
   text).
2. The three brand-rule nouns (spec 3.2).
3. The data review table `.superpowers/sdd/1.4-category-automation/mcc-names-review.tsv` (code, en,
   uk, uk source), written by task 7/10 step 5.
4. Open questions: Q-MCC1, Q-MCC2 (with the defaults), Q-MCC3 (card label, default yes), Q-MCC4
   (source casing kept, default yes).
A changed text goes back through the step that wrote it, then the pins rerun.

## Closing steps (track end)

- [ ] Review: each task's `kiko:reviewer` step done; a whole-diff read of tasks 7-10 for a
  divergent label (field, card, sheet must use `mccLabelOf`).
- [ ] Checks: the coordinator's queued verify per task, green; owed checks per the coordinator's
  power mode; mutation gate per task only when the user lifts the pause, base = that task's base.
- [ ] Retro: `kiko:retrospect` + `kiko:scribe` per task (sha or "no drift found" in each READY).
- [ ] Designer: task 10/10 step 6 consistency check of the picker diff.
- [ ] Sim check (iPhone simulator, then shut it down):
  - New rule, Merchant code: the sheet shows "Other code", "Your codes" (empty text on a manual-only
    or demo ledger), "All codes"; scroll is smooth through the full list.
  - With a synced Monobank ledger: own codes with counts, most first; pick one; the trigger shows
    "code · name".
  - Search `5411`, `54`, `кафе` (uk), `grocery` (en), `об'єкт` with an ASCII apostrophe.
  - First tap on a row with the keyboard up picks it.
  - "Other code": number pad, four digits at most; Save with three digits shows the error under the
    typed field.
  - Edit a stored rule with an unlisted code: "0042" on the trigger and on the card.
  - Light and dark scheme; largest Dynamic Type; VoiceOver reads headings, rows with counts, the
    trigger value.
  - iPad split window: the sheet and the Acknowledgements page in a pane.
  - Settings, Acknowledgements: the MIT notice in full, en and uk.
- [ ] READY: each task's READY to the coordinator; the final report lists the user's device-confirm
  items (the sim list above) and the texts' approval state.
