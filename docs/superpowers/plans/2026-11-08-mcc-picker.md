# MCC Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The rule condition "Merchant code (MCC)" gets a searchable picker: the user's own codes
with row counts first, then the full standard list with en and uk names, plus "Other code" to type
any four digits.

**Architecture:** A generated, committed JSON data file `src/categories/mcc-names/mcc-names.data.json`
(code, en, uk) read through a typed module `mcc-names.ts`, built by a dependency-free Node generator
from two pinned community files. One live aggregate read `transactionsRepo.mccCountsQuery()`,
enabled only while the sheet is open. A screen-local `MccField` built from shared design-system
parts. The stored rule does not change.

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
  tree from a shell: the data file lands through the regeneration test (`KIKO_REGEN_MCC=1`), the
  precedent of `KIKO_REGEN_DEMO` in `e2e/screenshot/fixtures/README.md`. A test-process write skips
  the pre-write guard (guard-replay checks `.ts`/`.tsx` only), so every regeneration is followed by
  `./node_modules/.bin/biome check src/categories/mcc-names/mcc-names.data.json` and the data pins
  in `mcc-names.test.ts`.
- UI: shared components and theme tokens only; no new design-system component; no import across
  screen folders. `1.4-light-scheme` then applies by itself.
- Guideline 2.5.19: no flag; the picker and its empty state show with no data; the reviewer has a
  path to "Your codes" (task 7/9 step 1, task 9/9 steps 7-8). The MIT notice ships as bundled text
  in every install (`mcc-names.notice.ts`, task 7/9 steps 11-12); no screen shows it (Q-MCC2 D).
- A catalogue key added or a copy line changed: same step in `en.ts` and `uk.ts`; kiko-translator
  casing and full-stop rules by role; plurals `_one/_few/_many/_other` in both; uk apostrophe
  U+02BC; uk says «Кіко», «натиснути»; a sheet or nav title key goes in `title-keys.ts`. Removed or
  renamed keys: none. A text identical in en and uk is a code constant, not a key.
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
- **Merge gate:** each task merges into `next` on its own green verify, in order 7/9, 8/9, 9/9.
  Task 7/9 carries the MIT notice with the uk names it bundles (steps 11-12), so no tip holds the
  names without the notice. The texts are approved (user, 2026-11-08 21:20; "Texts for the user").
  Task 9/9 also needs the track-end designer check, the sim check and the user's device confirm
  before its merge (UI).
- No duration estimate anywhere; whoever needs one uses `kiko:estimator`.

Run-log gaps (`run-log.mjs stats --gaps --repo kiko`, read 2026-11-08): this plan closes none and
leaves all open. Nearest, left open: `20261015T1035-kiko-release-1-2/3` (rule-form barrel for a demo
test; the conditional demo steps of task 9/9 add a builder pin, not a rule-form demo test) and
`20261025T1318-kiko-empty-selectors/6` (created-option pickers repeat open-guard-create; the MCC
picker creates nothing).

## Review Focus

1. The first tap on a row while the search keyboard is up: `CurrencyField` needed
   `keyboardShouldPersistTaps="handled"`, or the tap only dismisses the keyboard. Pinned in task
   9/9; sim check.
2. A stored code not in the list (42) and a half-typed "54": the trigger must show the digits, and
   "Other code" must open the typed field holding them, never an empty one. Pinned in task 9/9.
3. Apostrophes on both sides of the search: a uk query `об'єкт` must find a name stored with
   U+02BC, and an en query `men's` must find a name written with `'` or U+2019. One fold on query
   and name. Pinned in task 9/9.
4. The own read under a sync while the sheet is open: one re-read per fire, never a read while
   closed, and no empty text during the close fade. Pinned in task 9/9 (the `enabled` argument,
   `ownLoading`) and task 8/9 (one statement).
5. A Sominemo uk name with `'` or `’` inside a word reaching the bundle: the generator rewrites it
   and a data pin refuses it. Pinned in task 7/9.
6. The MIT notice in the release bundle: a module no production path reads is not bundled by
   Metro. The notice is re-exported by `mcc-names.ts`, which the rule card imports. Pinned in task
   7/9 step 11 (byte hash and barrel reach); proved on the release bundle at the device deploy
   ("Closing steps (track end)").

## Details settled by this plan

| # | Decision | Reason |
|---|---|---|
| P1 | Task labels continue the track: `1.4-category-automation task 7/9` to `9/9` (task 10/10 dropped by Q-MCC2 D); verify labels `1.4-category-automation-task-7` and so on. Tasks stack in this worktree, each base the previous task's tip. | The base plan used 1/6 to 6/6; distinct labels keep the run log and queue apart. |
| P2 | The data file is `mcc-names.data.json`, a JSON array sorted by code, written as `JSON.stringify(entries, null, 2)` plus a newline. `mcc-names.ts` imports it and exports `MCC_NAMES: readonly MccName[]`. No format step: the renderer's output must pass `./node_modules/.bin/biome check` on that one file as written (a finding is fixed in `renderMccNamesJson`, never by a format run or an ignore). | Stryker mutates `.ts`/`.tsx` only (`stryker.conf.json` `mutate`; `mutation.sh` diffs `'*.ts' '*.tsx'`), so the data makes no static mutants and the per-task gate stays bounded. JSON import precedent: `package.json` in `settings.screen.tsx` (`resolveJsonModule` from `@react-native/typescript-config`; jest and Metro already load it). |
| P3 | `scripts/mcc-names/generate-mcc-names.js` exports pure functions (`MCC_SOURCES`, `verifySource`, `buildMccNames`, `renderMccNamesJson`, `renderReviewTable`). Its header comment names the URLs, commits, SHA-256, licenses and the regeneration command (JSON holds no comment). The write is in `__tests__/generate-mcc-names.test.ts` under `KIKO_REGEN_MCC=1` with `KIKO_MCC_GREGGLES`, `KIKO_MCC_SOMINEMO`, `KIKO_MCC_REVIEW_OUT` paths. | A shell write into `src/` is denied by kill-guard; a test-process write has the demo precedent. Knip sees the script through the test. |
| P4 | uk names come from Sominemo only (spec 3.2); a greggles code without one makes the run refuse. No fallback rule and no hand-written uk file. | Measured (spec 3.3): Sominemo names all 981 greggles codes, including all 683 in 3000-3999; a fallback would name no code (strict scope, no dead code). |
| P5 | `MccField` lives in the screen folder, reads `ruleForm.*` keys, and owns its own `useLiveQuery`. `MatcherRow` passes `draft.mccText`, `onChange`, `error`, `position`. | `check:component-i18n-namespace` binds design-system components only; a field-local read keeps the read off the screen for non-mcc rules. |
| P6 | If `npm run check:dup` flags `MccField` against `CurrencyField`, stop and report; no `dup-ceilings.tsv` entry and no ignore without a coordinator ruling. The fix is extracting the pinned-search sheet into the design system with a `kiko:designer` step. | Standing rule; no ceiling raised to pass. |
| P7 | The data file is not in `.jscpd.json` `ignore` (jscpd scans JSON too). If jscpd flags it, stop and report. | An ignore entry needs a documented exception and a ruling. |
| P8 | Language: `i18n.language === 'uk'` picks `uk`, anything else `en` (`appLanguages` in `src/i18n/device-language/device-language.ts`). Memo keys include `i18n.language`. | A live language switch re-labels the list, as Home's titles do. |
| P9 | The label separator is `MCC_NAME_SEPARATOR = ' – '` (U+2013) in `mcc-names.ts`, a code constant (spec 3.4); `mccLabelOf` takes no `t`. | Identical in en and uk, like `SEPARATOR` in `rule-summary.ts`; differs from the card's ` · ` row separator. |

## User answers (2026-11-08 21:20, relayed by the coordinator; binding)

- Q-MCC1 community sources: YES. greggles (en) and Sominemo (uk) stay, as built in task 7/9.
- Q-MCC2 where the MIT notice ships: D (a new option). The notice text ships bundled in the app in
  `src/categories/mcc-names/mcc-names.notice.ts`; no screen. was: default A, a Settings row and an
  Acknowledgements page (task 10/10, 5 keys); now: task 10/10 and its 5 keys
  (`settings.acknowledgements`, `acknowledgements.title`, `acknowledgements.intro`,
  `acknowledgements.mccNamesEnglish`, `acknowledgements.mccNamesUkrainian`) dropped, never built,
  so no pin changes; the notice moves into task 7/9 steps 11-12. The hold of tasks 7-9 on task 10
  is void.
- Q-MCC3 the rule card shows "code – name": YES, as built in task 7/9 steps 6-7.
- Q-MCC4 names as the sources write them: YES, verbatim casing, no re-casing rule. Record of the
  casing facts asked about (spec 3.3): 419 of the 683 en names in 3000-3999 are all capitals, for
  example `3000` "UNITED AIRLINES", `3501` "HOLIDAY INNS, HOLIDAY INN EXPRESS", next to `3003`
  "Airlines"; in uk those codes read «Авіалінії», «Готелі. Курорти» (no capitals).
- UI strings: the 12 rows of spec 9 (11 new keys, the plural group counted once, plus the changed
  `ruleForm.errorMcc`) are APPROVED as written (2026-11-08 21:20).
- Notes for Review draft: its Acknowledgements sentence is dropped.
## Conflict surface

| Task | Shared files | Other tracks |
|---|---|---|
| 7 | `rule-summary.ts`, `category-form.screen.tsx` | none expected |
| 8 | `transactions.repo.ts` (one added member) | `1.4-tables` may add reads beside it; additive |
| 9 | `matcher-row.component.tsx`, `en.ts`, `uk.ts`, `title-keys.ts`; conditional: `build-demo-snapshot.ts`, both demo `.kiko` files, `kiko-category-check-en.kiko` | `1.4-small` edits both catalogues; added lines only. A demo conflict: base plan S22, regenerate, never hand-merge |

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
  path, hand-measured numbers where the task asks. The coordinator queues the verify and reruns it
  until green. Merge: the merge gate (Global Constraints): the task merges into `next` on its own
  green verify.

Track end, in task 9/9 before its READY and merge: the `kiko:designer` read-only consistency check
of the picker diff (task 9/9 step 9, against task 9/9's base), the sim check list below and the
user's device confirm. The texts are approved (section "Texts for the user").

---

## 1.4-category-automation task 7/9: the MCC name data and the rule card label

**Needs:** nothing. **Base:** a00115db2 or the track tip when it starts.

**Files (floor). Mutable: 4** (`mcc-names.ts`, `mcc-names.notice.ts`, `rule-summary.ts`,
`category-form.screen.tsx`; `mcc-names.data.json` is not mutated, P2).
- Create: `scripts/mcc-names/generate-mcc-names.js`, `src/categories/mcc-names/mcc-names.data.json` (generated), `src/categories/mcc-names/mcc-names.ts`,
  `src/categories/mcc-names/index.ts`, `src/categories/mcc-names/mcc-names.notice.ts` (steps
  11-12)
- Modify: `src/screens/forms/category-form/rule-summary/rule-summary.ts`,
  `src/screens/forms/category-form/category-form.screen.tsx`,
  `docs/superpowers/specs/2026-11-08-mcc-picker-design.md` (sections 3.1, 3.3, 5.4)
- Tests: `__tests__/generate-mcc-names.test.ts`, `src/categories/mcc-names/mcc-names.test.ts`,
  `src/screens/forms/category-form/rule-summary/rule-summary.test.ts`,
  `src/screens/forms/category-form/category-form.screen.test.tsx`,
  `__tests__/mcc-names-notice.test.ts` (step 11)

**Interfaces. Produces:**
```ts
// @kiko/categories/mcc-names
export type MccName = { code: string; en: string; uk: string };
// mcc-names.notice.ts, re-exported by mcc-names.ts (steps 11-12); keys equal MCC_SOURCES keys
export const MCC_NAMES_NOTICE: Readonly<Record<'greggles' | 'sominemo',
  { source: string; licenseName: string; licenseText?: string }>>;
export const MCC_NAMES: readonly MccName[]; // from mcc-names.data.json
export const MCC_NAME_SEPARATOR: ' – ';
export const mccNameOf: (code: string, language: string) => string | undefined;
export const mccLabelOf: (code: string, language: string) => string; // "5411 – ..." or "0042"
// rule-summary.ts RuleSummaryOptions gains (describeMatcher keeps the four-digit pad)
mccLabelOf: (mccText: string) => string;
// scripts/mcc-names/generate-mcc-names.js (CommonJS)
MCC_SOURCES: { greggles: { url, commit, sha256, license }, sominemo: { url, commit, sha256, license } }
verifySource(text, expectedSha256): void // throws on mismatch
buildMccNames({ greggles, sominemo }): { entries: MccName[]; report: { dropped: string[] } } // dropped: Sominemo-only codes
renderMccNamesJson(entries): string
renderReviewTable(entries): string // TSV: code, en, uk
```

Steps 1-10 are done (commits through `cea18f539`); steps 11-16 add the notice (Q-MCC2 D).

- [x] **step 1/16 (kiko:developer): fetch and measure.** In a new, empty scratch directory per file,
  fetch greggles `mcc_codes.json` and the Sominemo uk file from
  `raw.githubusercontent.com/<owner>/<repo>/<commit>/<file>` at the commits of spec 3.1. Read only
  with a scratch Node script kept in another directory, passing the paths as arguments. Record in
  spec 3.1 and 3.3 (Edit): exact file names, field names (greggles `mcc`, `edited_description`,
  `combined_description`; Sominemo's uk shape and whether it has a short name), SHA-256 of each
  file, the counts listed in spec 3.3, a five-row sample of each, the presence of 5411, 5812,
  4829, 6011, 0742, and three en texts of codes 3000-3999 as written (their casing, for the Q-MCC4
  question). A missing one of the first four, or a license file that differs from the research
  quote, is a stop-and-report. Also read the Sominemo LICENSE at the commit and keep its exact text
  for the notice (steps 11-12). Reviewer kit: read (read only) the header and a few rows of the fake Monobank
  statement in the current release's reviewer-kit folder (main checkout, untracked; release skill,
  "Freshness"; its generator `memory/refs/demo-statement/make-fake-statement.py` wrote an `mcc`
  column when read on 2026-11-08) and record in spec 5.4 whether the kit file has an MCC column
  with values. No column: task 9/9 steps 7-8 run; a column: they are marked skipped. Commit
  `docs(category): measured MCC sources`.

- [x] **step 2/16 (kiko:qa): generator pins.** Create `__tests__/generate-mcc-names.test.ts`, tiny
  inline inputs only, no download:
  - `takes the edited description and falls back to the combined one`; `trims and collapses spaces`
    (a real case: `5599` "Miscellaneous Auto Dealers " with its trailing space).
  - `pads a code to four digits and keeps leading zeros` (`742` and `"742"` give `"0742"`).
  - `refuses a code that is not four digits after padding`; `refuses a duplicate code with a
    different name`, `accepts a duplicate with the same name once`.
  - `refuses a run with a code that has no uk name, listing every such code`.
  - `rewrites an ASCII or right-quote apostrophe inside a Cyrillic word to U+02BC` (a real case:
    `4215` «Кур'єри», one of the 7 measured codes 4215, 4814, 5045, 5422, 5734, 7298, 7379) and
    `leaves a quote outside a word`.
  - `drops a Sominemo-only code and reports it`.
  - `sorts the entries by code` (Sominemo's key order is not code order; spec 3.1).
  - `refuses a source whose SHA-256 differs from the pinned one`.
  - `renders the entries as a JSON array with only code, en and uk, ending in a newline` (parse the
    output, `toEqual` the entries) and `renders a review table with one line per code`.
  - `MCC_SOURCES pins full forty-character commits and sixty-four-character SHA-256 values`, with
    both URLs and licenses.
  - `describe('regenerate the MCC names data')` only under `KIKO_REGEN_MCC=1`: reads both
    downloads by env path, verifies, builds, writes `src/categories/mcc-names/mcc-names.data.json`
    and the review TSV at `KIKO_MCC_REVIEW_OUT`.
  Red: `npx jest __tests__/generate-mcc-names.test.ts --maxWorkers=2` (module missing). Commit
  `test(category): pins for the MCC names generator`.

- [x] **step 3/16 (kiko:developer): the generator.** `generate-mcc-names.js`, spec 3.2 in order
  (built on the defaults; the user kept them, "User answers"); header with the URLs, commits,
  SHA-256, licenses (Unlicense; MIT, "Copyright (c) 2020 Sominemo") and the regeneration command.
  Dependency-free (kiko-linter's Node checker rule). Green: same command. Commit
  `feat(category): MCC names generator`.

- [x] **step 4/16 (kiko:qa): data pins.** Create `src/categories/mcc-names/mcc-names.test.ts`, reading
  `MCC_NAMES` through the module (never the file text):
  - `holds each code once`; `holds only four-digit codes`; `is sorted by code`.
  - `holds exactly <N> codes` (N from step 1's measured output count).
  - `gives every code a non-empty English and Ukrainian name, trimmed, with no control character`.
  - `uses the U+02BC apostrophe in every Ukrainian name` (no `'` or U+2019 between two Cyrillic
    letters; regex as in `uk.catalog-rules.test.ts`).
  - `holds the common codes`: 5411, 5812, 4829, 6011, `0742` with its leading zero.
  - `names every code the category map knows except the codes the sources leave out`: the mapped
    codes 0-9999 (`categoryForMcc(code) !== 'other'`) with no entry `toEqual` 3791-3999 without
    3816 and 3835, then 6540 (208 codes; they show as their digits, spec 3.3, 5.4).
  - `mccNameOf gives the name per language and undefined for an unlisted code`; `treats a language
    other than uk as en`.
  - `mccLabelOf joins code and name with an en dash and shows an unlisted code as its digits`
    (`'5411 – <name>'`, `'0042'`).
  Red: `npx jest src/categories/mcc-names --maxWorkers=2`. Commit `test(category): MCC names data
  pins`.

- [x] **step 5/16 (kiko:developer): the data.** Regenerate (no hand-written uk names: Sominemo names every
  code, spec 3.3; a refusal listing codes is a stop-and-report). Run
  `KIKO_REGEN_MCC=1 KIKO_MCC_GREGGLES=<path> KIKO_MCC_SOMINEMO=<path>
  KIKO_MCC_REVIEW_OUT=.superpowers/sdd/1.4-category-automation/mcc-names-review.tsv npx jest
  __tests__/generate-mcc-names.test.ts --maxWorkers=2`. Then, on the written file:
  `./node_modules/.bin/biome check src/categories/mcc-names/mcc-names.data.json` (no `--write`; a
  finding is fixed in `renderMccNamesJson` and regenerated, P2). Write `mcc-names.ts` (imports the JSON,
  `MCC_NAME_SEPARATOR`, lookups; a doc comment names the generator and the regeneration command)
  and `index.ts` (barrel). No catalogue key in this task (P9). Record the JSON's byte size in spec
  3.3. Green: step 2 and step 4 commands. Run `npm run check:dup`; a finding on the data file is
  P7. Commit `feat(category): bundled MCC names, en and uk`.

- [x] **step 6/16 (kiko:qa): rule card pins.** In `rule-summary.test.ts`, the ruling changes one pin:
  - was: `{ label: 'Merchant code (MCC)', value: '5411' }`; now `value: '5411 – Grocery Stores,
    Supermarkets'` (the measured en name). `value: '0042'` for code 42 stays.
  - Add `shows the mcc name in Ukrainian` and `shows an unlisted code as its digits`.
  - Add `passes a stored code to the label option padded to four digits`: a spy option gets
    `'0042'` for code 42 (and `'5411'` for 5411).
  - `category-form.screen.test.tsx`: `shows a merchant-code rule with its name on the card`.
  Red, named files. Commit `test(category): the rule card names the merchant code`.

- [x] **step 7/16 (kiko:developer): the card.** `mccLabelOf: (mccText: string) => string` option on
  `RuleSummaryOptions` (spec 6); the `.with({ type: 'mcc' }, ...)` branch of `describeMatcher` keeps
  its `padStart(MCC_DIGITS, '0')` and passes the padded text to the option, whose result is the
  value. Resolved in `category-form.screen.tsx` with the data module's `mccLabelOf` and
  `i18n.language` (P8); every caller of the summary passes it (grep the callers). Green: named
  files plus `src/categories/mcc-names`. Commit `feat(category): rule card shows the merchant code
  name`.

- [x] **step 8/16 Review (kiko:reviewer).** Top questions: can any download path execute or land
  outside its scratch directory; does the generator refuse every malformed input the spec lists; is
  the provenance table complete (URLs, commits, SHA-256, licenses); did `check:guard-replay` run
  after the regeneration. No migration.
- [x] **step 9/16 Drift (kiko:retrospect).** Check kiko-domain (MCC text), kiko-translator (data
  names and the separator kept out of the catalogue), kiko-architecture (bundled JSON data,
  regeneration precedent), kiko-linter (a new dependency-free Node script under `scripts/`).
- [x] **step 10/16 Scribe (kiko:scribe).** `cea18f539`.
- [ ] **step 11/16 (kiko:qa): notice pins.** Create `__tests__/mcc-names-notice.test.ts` (a knip
  entry by its glob). Read the notice through the barrel `@kiko/categories/mcc-names` by a runtime
  lookup (Global Constraints, red commit); `MCC_SOURCES` from
  `scripts/mcc-names/generate-mcc-names.js`, as `__tests__/generate-mcc-names.test.ts` does.
  - `ships the full license text of every MIT source`: the keys of `MCC_SOURCES` whose `license` is
    `'MIT'` `toEqual` `['sominemo']` (so the pin never passes on an empty list); for each, the
    SHA-256 (`node:crypto`, UTF-8) of `MCC_NAMES_NOTICE[key].licenseText` equals the LICENSE value
    of spec 3.1 (`ea371db4...626a`, written out in full in the test).
  - `credits every source with its repository and license name`: the notice keys `toEqual` the
    `MCC_SOURCES` keys; greggles `https://github.com/greggles/mcc-codes`, `The Unlicense`, no
    license text (the courtesy line, spec 7); Sominemo
    `https://github.com/Sominemo/MCC-Localize-Dataset`, `MIT License`.
  - `reaches the notice from the module the rule card imports`: the barrel's `MCC_NAMES_NOTICE`
    `toBe` the export of `mcc-names.notice.ts` (the barrel is what `category-form.screen.tsx`
    imports; re-grep that import on the base).
  Red: `npx jest __tests__/mcc-names-notice.test.ts --maxWorkers=2` (export missing), output kept
  in a file. Commit `test(category): pins for the bundled MCC names notice`.
- [ ] **step 12/16 (kiko:developer): the notice.** Fetch the Sominemo `LICENSE` at commit
  `7b3cbceeb3fbbd6a27dbe489b25abe82552ddff2` into a new, empty scratch directory outside the
  worktree; check its SHA-256 equals spec 3.1 before use; never execute it. Create
  `src/categories/mcc-names/mcc-names.notice.ts` with `MCC_NAMES_NOTICE` (Interfaces): untranslated
  constants, spec 7; the MIT text verbatim, its trailing newline and straight quotes kept (a
  template literal; the text holds no backtick or `${`). Re-export it from `mcc-names.ts`
  (`export { MCC_NAMES_NOTICE } from './mcc-names.notice';`): Metro bundles only modules reachable
  from the entry, and a re-export compiles to an exports getter, which keeps the require under
  inline requires; the barrel `index.ts` already re-exports `mcc-names.ts`. A short comment says
  why the notice ships (MIT: the notice goes with every copy); no history note. Tidy the test to
  static imports. Green: `npx jest __tests__/mcc-names-notice.test.ts src/categories/mcc-names
  --maxWorkers=2`; `npm run check:knip` (no unused export or file; a finding is a stop-and-report,
  no ignore entry); `npm run check:dup`; `npm run check:secrets`. Commit `feat(category): the MIT
  notice ships with the MCC names`.
- [ ] **step 13/16 Review (kiko:reviewer), targeted:** the diff `cea18f539..HEAD` only. Top
  questions: is the shipped text byte-equal to the pinned LICENSE (the hash pin, not a hand read);
  is the notice on a production import path that the release bundle keeps; are the constants out
  of the catalogue and untranslated; does any pin pass on an empty source list.
- [ ] **step 14/16 Drift (kiko:retrospect).** kiko-compliance (licenses of bundled data: MIT
  notice shipped as bundled text, no screen), kiko-architecture (`mcc-names` folder contents).
- [ ] **step 15/16 Scribe (kiko:scribe).** Sha or "no drift found".
- [ ] **step 16/16 Ready.** Label `1.4-category-automation-task-7`, base the task's recorded base. The report
  names the review TSV path, the kit statement's MCC column result, and the notice pins' output
  path. Merge into `next` on this green verify (merge gate). The release-bundle proof of the
  notice runs on AC at the next device deploy ("Closing steps (track end)").

---

## 1.4-category-automation task 8/9: the user's own codes with counts

**Needs:** nothing. **Base:** task 7/9 tip.

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
  - `leaves out rows with no code and codes outside 0 to 9999`: rows with `mcc` null, -1, 0, 9999,
    10000; the result holds 0 and 9999 only.
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
  - `plans one scan of transactions and no other table`: of the `EXPLAIN QUERY PLAN` detail rows,
    exactly one equals `SCAN transactions`, every other row matches
    `/^USE TEMP B-TREE FOR (GROUP BY|ORDER BY)$/`, none starts with `SEARCH`, none names another
    table (precedent: `category-rules.performance.test.ts`; not an exact list, so the Node SQLite
    and SQLCipher planners both pass).
  Red: named file. Commit `test(transactions): bound for the own MCC counts read`.

- [ ] **step 3/7 (kiko:developer): the read.** `mccCountsQuery` with a doc comment (spec 4.1;
  `WHERE mcc BETWEEN 0 AND 9999`, no `IS NOT NULL`). Green: both files. Measure the 50,000-row read
  by hand three times; quote the numbers in READY. A plan other than the pinned one is a
  stop-and-report, never a new index without a migration plan and a `kiko:reviewer` step. Commit
  `feat(transactions): own MCC counts read`.

- [ ] **step 4/7 Review (kiko:reviewer).** Top question: is the bound in spec 4.2 what the pins
  measure, and can any caller run the read while the picker is closed. No migration, no index;
  confirm the plan pins.
- [ ] **step 5/7 Drift (kiko:retrospect).** kiko-architecture's repository and live-query text.
- [ ] **step 6/7 Scribe (kiko:scribe).**
- [ ] **step 7/7 Ready.** Label `1.4-category-automation-task-8`, with the hand-measured numbers.
  Merge into `next` on this green verify (merge gate).

---

## 1.4-category-automation task 9/9: the picker in the rule form

**Needs:** tasks 7/9 and 8/9. **Base:** task 8/9 tip.

**Files (floor). Mutable: 3** (`mcc-field.component.tsx`, `mcc-picker-rows.ts`,
`matcher-row.component.tsx`; `e2e/` is not mutated).
- Create: `src/screens/forms/category-rule-form/mcc-field/mcc-field.component.tsx`,
  `mcc-field.props.d.ts`, `mcc-field.styles.ts`, `index.ts`, `mcc-picker-rows.ts`
- Modify: `src/screens/forms/category-rule-form/matcher-row/matcher-row.component.tsx`,
  `src/i18n/locales/en.ts`, `uk.ts`, `src/i18n/locales/title-keys.ts`; conditional (steps 7-8):
  `e2e/screenshot/fixtures/build-demo-snapshot.ts`, `kiko-demo-en.kiko`, `kiko-demo-uk.kiko`,
  `kiko-category-check-en.kiko`
- Tests: `mcc-field/mcc-picker-rows.test.ts`, `mcc-field/mcc-field.component.test.tsx`,
  `matcher-row/matcher-row.component.test.tsx`, `category-rule-form.screen.test.tsx`; conditional:
  `e2e/screenshot/fixtures/build-demo-snapshot.test.ts`

**Interfaces. Produces:**
```ts
// mcc-field/mcc-picker-rows.ts
export const matchesMccQuery: (entry: { code: string; name: string | undefined }, query: string) => boolean;
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

**Strings (spec 9):** 11 new keys: `ruleForm.mccSheetTitle` (title key), `selectMcc`,
`mccSearchPlaceholder`, `mccOther`, `mccOtherDescription`, `mccTypedLabel`, `mccOwnSection`,
`mccAllSection`, `mccOwnEmpty`, `mccNoMatch`, `mccTransactionCount_*`; changed `errorMcc`.

- [ ] **step 1/14 (kiko:qa): search and rows pins.** `mcc-picker-rows.test.ts`, `matchesMccQuery`:
  `a digits-only query matches codes that start with it` (`54` matches 5411, not 1543); `a text
  query matches the name by substring, any case`; `folds an ASCII apostrophe, U+2019 and U+02BC to
  one character in the query and the name` (uk query `об'єкт` finds a U+02BC name); `an en name
  with an apostrophe matches a typed apostrophe` (`men's` finds `Men’s and Boys’ Clothing` and
  `Men's and Boys' Clothing`); `a blank query matches every code`; `an unlisted code matches only
  by digits`. `mccPickerRows`, each by `toEqual` on the whole row list:
  - `puts Other first, then own codes by the order given, then every code by code`.
  - `gives an own code its count and an unlisted own code no name`.
  - `shows the own heading and the empty row when the read landed with no codes`.
  - `shows the own heading alone while the read is loading`.
  - `drops a section and its heading when the query empties it, and keeps Other`.
  - `shows the no-match row when the query empties both sections`.
  - `names each code in the current language`.
  Red: named file. Commit `test(rules): pins for the MCC search and picker rows`.

- [ ] **step 2/14 (kiko:developer): search and rows.** Both functions in `mcc-picker-rows.ts`, spec
  5.2. Green: same command. Commit `feat(rules): MCC search and picker rows`.

- [ ] **step 3/14 (kiko:qa): field pins.** `mcc-field.component.test.tsx` (mock `useLiveQuery` by
  query kind; uk cases set the language in a hook, kiko-translator):
  - `shows the placeholder, a listed code with its name, and an unlisted code as its digits` (spec
    5.1 table, three renders; the listed code reads `5411 – <name>`).
  - `reads the own codes only while the sheet is open`: the `enabled` argument is false closed and
    true open.
  - `shows no empty text while the sheet closes`: with the sheet closed and the read giving `[]`
    and `isLoading` false, the rows get `ownLoading` true (`!open || isLoading`, spec 4.1).
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

- [ ] **step 4/14 (kiko:developer): the field and strings.** `MccField` per spec 5 and P5, modeled
  on `CurrencyField`; the 11 keys and the changed `errorMcc` in both catalogues; `ruleForm.
  mccSheetTitle` in `title-keys.ts`. Green: step 3 plus `src/i18n/locales`. Commit `feat(rules):
  MCC picker field`.

- [ ] **step 5/14 (kiko:qa): row and screen pins.** The ruling changes these pins; each was:/now in
  the commit message:
  - `matcher-row.component.test.tsx` `an mcc row shows a number-pad field limited to four digits`:
    was: types in the `Merchant code (MCC)` field; now: opens the trigger, picks "Other code", types
    in `Four-digit code`, same `onChange` calls (`'5411'`, `'54'`).
  - `explains the merchant code on an mcc condition` (en and uk): the hint stays, unchanged.
  - `category-rule-form.screen.test.tsx` `keeps a typed merchant code when the type of the row is
    changed and changed back`: was: the field value `5411`; now: the trigger shows `5411 – <name>`.
  - any pin on the `errorMcc` text: was: `Enter a four-digit code.` / «Введіть чотиризначний код.»;
    now: `Select a code or enter four digits.` / «Оберіть код або введіть чотири цифри.» (grep the
    old text in tests).
  - Add, screen: `saves a picked code as the code only` (pick 5411, Save, the saved matchers equal
    `[{ type: 'mcc', code: 5411 }]`); `edits a stored unlisted code through Other code`.
  Red, named files. Commit `test(rules): the mcc condition uses the picker`.

- [ ] **step 6/14 (kiko:developer): wiring.** `MatcherRow` `.with('mcc', ...)` renders `MccField`
  and the hint. The screen's `useLiveQuery` mock gains the new kind. Green: `npx jest
  src/screens/forms/category-rule-form src/i18n/locales --maxWorkers=2`. Run `npm run check:dup`
  (P6). Commit `feat(rules): the mcc condition opens the picker`.

- [ ] **step 7/14 (SKIPPED: task 7/9 step 1 found the MCC column with a value on all 64 rows of
  the kit statement) (kiko:qa, only if task 7/9 step 1 found no MCC column in the kit statement;
  else mark skipped): demo pin.** `build-demo-snapshot.test.ts`: `gives a few Monobank rows a
  merchant code`: was: every demo row `mcc: null`; now: the named rows (a grocery and a cafe
  merchant of a Monobank holding, for example 5411 and 5812) hold their code, every other row null,
  and no rule-demo row (`KFC`, `Sushi Master`) holds one, so the rule demo's pinned count stays.
  Red: named file. Commit `test(demo): a few demo rows carry a merchant code`.

- [ ] **step 8/14 (SKIPPED, same reason as step 7/14) (kiko:developer, same condition): demo rows
  and regeneration.** In
  `build-demo-snapshot.ts`, set `mcc` on those rows (stored categories unchanged); regenerate both
  demo files: `KIKO_REGEN_DEMO=1 npx jest e2e/screenshot/fixtures/generate-demo-kiko.test.ts`, then
  that test plain (writes `kiko-demo-en.kiko`, `kiko-demo-uk.kiko`); then
  `KIKO_REGEN_CATEGORY_CHECK=1` on the same test (`build-category-check-snapshot.ts` spreads
  `demo.transactions` with `mccCategoriesBackfilled: false`; writes `kiko-category-check-en.kiko`).
  The seeded rows keep a real category, so the back-fill (`mccBackfillRowsQuery`, `noRealCategorySql`
  in `backfill-mcc-categories.ts`) moves none of them and the category-check pins stay unchanged.
  `kiko-demo-en-1.1.kiko` and the kit statement are not touched. `npm run check:guard-replay`. Green: `npx jest e2e/screenshot/fixtures --maxWorkers=2`.
  Commit `feat(demo): demo rows carry merchant codes`. The coordinator copies the fresh en file to
  the reviewer kit at release (release skill).

- [ ] **step 9/14 (kiko:designer, read-only): picker look and track-end consistency check** (user
  rule 2026-11-06) of the picker diff from task 9/9's base to this tip. Against kiko-design-system:
  sheet chrome, section headings, row second line, the typed field under the trigger, light and
  dark, large Dynamic Type. Findings go to a fix step, not inline.
- [ ] **step 10/14 (kiko:developer): designer fixes, if any.** Own commit; step 11 reviews them.
- [ ] **step 11/14 Review (kiko:reviewer).** Top question: can the field show a value the save does
  not store, or store a code the user did not see. Check the pin edits against step 5's list (and
  step 7's when it ran).
- [ ] **step 12/14 Drift (kiko:retrospect).** kiko-design-system (searchable picker pattern now has
  two users), kiko-domain (the mcc condition's input), kiko-testing if a helper was added,
  kiko-compliance and the fixtures README if steps 7-8 ran.
- [ ] **step 13/14 Scribe (kiko:scribe).**
- [ ] **step 14/14 Ready.** Label `1.4-category-automation-task-9`. UI changes need the sim check
  items below and the user's device confirm. Merge into `next` on this green verify and the device
  confirm (merge gate).

---

## Texts for the user

Sent through the coordinator; APPROVED by the user 2026-11-08 21:20 ("User answers"):
1. The UI strings of spec 9: 12 rows (11 new keys, the plural group counted once, plus the changed
   copy `ruleForm.errorMcc` with its was: text). Also the user-visible code constant: the label
   separator ` – ` (en dash, "5411 – Grocery Stores, Supermarkets"; new, replaces nothing). The
   notice constants (source URLs, license names, the MIT text) ship as bundled text and show on no
   screen.
2. The data review table `.superpowers/sdd/1.4-category-automation/mcc-names-review.tsv` (code, en,
   uk), written by task 7/9 step 5; names as the sources write them (Q-MCC4).
3. Notes for Review draft line (plain text, for the release's Notes for Review; its import path is
   checked against the build when the Notes are written): "Category rules: the Merchant code (MCC)
   condition now opens a searchable list. 'Your codes' lists the codes found in your transactions
   with their counts; import the Monobank statement from the reviewer kit to see them. 'All codes'
   lists every code with its name in the app's language (English or Ukrainian), and 'Other code'
   accepts any four digits." If task 9/9 steps 7-8 ran, the own-codes sentence reads: "The demo
   data already holds a few codes."
A changed text goes back through the step that wrote it, then the pins rerun.

## Closing steps (track end)

- [ ] Review: each task's `kiko:reviewer` step done; a whole-diff read of tasks 7-9 for a
  divergent label (field, card, sheet must use `mccLabelOf`).
- [ ] Checks: the coordinator's queued verify per task, green; owed checks per the coordinator's
  power mode; mutation gate per task only when the user lifts the pause, base = that task's base.
- [ ] Merge: each task into `next` on its own green verify, in order 7/9, 8/9, 9/9 (merge gate;
  task 9/9 also after the device confirm). Texts approved 2026-11-08 21:20.
- [ ] Retro: `kiko:retrospect` + `kiko:scribe` per task (sha or "no drift found" in each READY).
- [ ] Designer: task 9/9 step 9 track-end consistency check of the picker diff.
- [ ] Bundle proof of the notice (coordinator, on AC only: it needs a Release build): at the next
  device deploy, `make deploy EXPECT='Copyright (c) 2020 Sominemo'` (`scripts/deploy-device.sh` runs
  `scripts/bundle-contains.js`, which searches `main.jsbundle` as UTF-8 and UTF-16LE; exit 0 found,
  1 not found). Not found is a stop before any release; the jest pin of task 7/9 step 11 is the
  per-task proof.
- [ ] Sim check (iPhone simulator, then shut it down):
  - New rule, Merchant code: the sheet shows "Other code", "Your codes" (empty text on a manual-only
    ledger), "All codes"; scroll is smooth through the full list; closing the sheet shows no empty
    text flash.
  - With a synced Monobank ledger, or the kit statement imported: own codes with counts, most first;
    pick one; the trigger shows "code – name".
  - Search `5411`, `54`, `кафе` (uk), `grocery` (en), `об'єкт` with an ASCII apostrophe, `men's`
    (en).
  - First tap on a row with the keyboard up picks it.
  - "Other code": number pad, four digits at most; Save with three digits shows the error under the
    typed field.
  - Edit a stored rule with an unlisted code: "0042" on the trigger and on the card.
  - Light and dark scheme; largest Dynamic Type; VoiceOver reads headings, rows with counts, the
    trigger value.
  - iPad split window: the sheet in a pane.
- [ ] READY: each task's READY to the coordinator; the final report lists the user's device-confirm
  items (the sim list above) and the bundle proof result.
