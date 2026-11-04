# Category Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fewer rows sit in `other`: more MCC codes, a new seeded Travel category and a one-time back-fill (B1), a review list (B2), a prefix offer in Apply (B3), four new rule conditions (B4), suggestions from history (B5).

**Architecture:** One pure planning layer in `src/categories/category-rules/` (`hasNoRealCategory`, `planMccBackfill`, `planReviewGroups`) and one pure name function (`merchantNameOf`). Every write goes through `applyNameRule` or `backfillMccCategories`, each planning inside one `write()`. The UI uses shared components and theme tokens only.

**Tech Stack:** React Native, Hermes, op-sqlite (SQLCipher), Drizzle, react-native-unistyles, i18next, ts-pattern, jest with `node:sqlite`.

**Spec:** `docs/superpowers/specs/2026-11-03-category-automation-design.md`. Refer to it by section; this plan does not copy it. Every count here is a floor: the developer measures. Every code fact names a symbol, not a line: re-grep each fact on the actual base before building on it.

## User rulings, 2026-11-03

Relayed by the coordinator; spec section 9.

- **Q1 = A.** Old rows with a newly mapped code move once per data set, at the next app open, no prompt. Hand-set rows never move. "Once" holds per device and per file: `importData` also runs the back-fill for a file without the mark.
- **Q2 = B.** A new seeded Travel category. Hotels 7011 and 3501-3999, travel agencies 4722, airlines 3000-3299 and 4511, airports 4582 map to `travel`. Two migrations in the track. A duplicate beside a user's own travel category is accepted. Car rental (3351-3441, 7512), rail and other land transport stay in `transport`. No original code changes (checked against `MCC_CATEGORIES`).

## Global Constraints

- A hand-set row never changes; an automatic write touches only a row with no real category (spec 3.0, 6). A category never reaches a balance or net worth (spec 5.3).
- New condition = new `type` string, never a new field on an existing type (spec 3.4.1). A missing value never matches.
- Two migrations, both in task 1: the Travel seed and `settings.mcc_categories_backfilled`. No index and no other migration. `EXPORT_VERSION` stays 5 (spec 3.1.6).
- The Travel seed never overwrites, retitles or recolors an existing row; a Travel the user deleted stays deleted in that user's 1.4 file (spec 3.1.6).
- Out of scope, do not add: built-in merchant list, day-of-month condition, on-device AI, budgets or planning. No extras beyond B1-B5.
- UI: shared components and theme tokens only (no hex, no raw spacing; Travel's stored seed color is data, as every seeded row's is, spec 3.1.6); `1.4-light-scheme` then applies by itself. No import across screen folders: `src/screens/settings/**` must not import `src/screens/forms/**` (`check:screen-imports`).
- Guideline 2.5.19: no flag, no condition on the entry row; the screen explains itself with no data.
- A catalogue key added or a copy line changed: same step in `en.ts` and `uk.ts`; kiko-translator casing and full-stop rules; plurals `_one/_few/_many/_other` in both; uk apostrophe is U+02BC; uk says «Кіко», «натиснути»; a sheet or nav title key goes in `title-keys.ts`; a name list goes through `common.listedName`.
- Never log a name or an IBAN: a failure log is fixed text.
- Tests: kiko-testing. No history note or task id in a test or comment. A real SQLite test uses `executingClient` and `applyAllMigrations`. A qa red commit reads a missing export, and every field, prop or argument with no type yet, by a runtime lookup or a test-local cast, so the staged typecheck passes; the green commit tidies each one to a typed form. Show the red output, do not claim it. Never `--no-verify`. Keep jest output in a file.
- Harness: the orchestrator never queues. A task ends with READY FOR VERIFY to the coordinator, who queues the verify and merges. Mutation gates are paused by the user; none is scheduled. No agent runs `check:all`, full jest or verify.
- Dev test command: `make jest-affected BASE=<task base>`; exit 3 (`AFFECTS EVERY SUITE`) is expected for `en.ts`, `uk.ts` or `schema.ts` changes: run the named files listed in the task instead and say so in the READY report.

Run-log gaps: this track closes none and leaves all open. Nearest, left open: `20261015T1035-kiko-release-1-2/3` (rule-form barrel for a demo test) and `20261015T1657-kiko-binance-backfill-fix/2` (no mechanized index check; this plan adds no index).

## Review Focus

1. A confirm sheet asked to open while the options sheet is still closing: an iOS Modal drops it. Expected: the confirm always shows. Pinned in task 5 (`onClosed`), device check in its closing report.
2. Editing an `account` rule before the accounts read has landed: the seed would clear a live id and Save would ask for a pick. Expected: the id stays. Pinned in task 4.
3. A prefix preview with 0 rows to move (every same-prefix row is hand-set): expected a plain sentence, no "0 transactions:" and no empty name list. Pinned in task 2.
4. A name with a Unicode trap (`İ`, final sigma, NFD, non-breaking space) under the store-number cut: the guarantee `normalize(name).startsWith(key)` must still hold, or a group's rule misses its own rows. Pinned in task 2.
5. A file this build wrote after the user deleted Travel, restored: it must stay deleted, while a file from before 1.4 gains it. A key of `false` counts as present. Pinned in task 1, steps 10 and 12.
6. A store-number name in a shown list or a one-name rule: `names` and `nameIs` text hold the full name, never the cut prefix, or the confirm reads "ATB, ATB" and `nameIs "ATB"` previews 0 rows. Pinned in tasks 2 and 5.

## Details settled by this plan (the spec leaves them implicit)

| # | Decision | Reason |
|---|---|---|
| S1 | One deterministic pick everywhere: the smallest tidied spelling by code unit (`smallestSpelling`, `<`, never `localeCompare`). Per normalized name it picks the FULL tidied name; `ReviewGroup.names`, S8's `names` and a `nameIs` rule's text use that. `rule.text` per kind: `nameIs` = the one name's full tidied spelling; `nameStartsWith` = the smallest `merchantSpellingOf` (the prefix when cut, else the tidied name) among the members. The prefix spelling is used for nothing else. | Independent of row order. A prefix in a name list hides the store numbers ("ATB, ATB"), and `nameIs "ATB"` on `ATB 0212` matches 0 rows. |
| S2 | "One distinct name" compares `normalizeTransactionName`: `ATB 0212` and `atb  0212` are one name and get `nameIs`. | The matcher compares normalized text, so they are one name to the rule. |
| S3 | `ADDED_MCC_CATEGORIES: Record<string, readonly number[]>` beside `MCC_CATEGORIES`, a range expanded by `rangeOf(first, last)` into plain numbers; `MCC_TO_CATEGORY` builds from both; `export const ADDED_MCC_CODES = Object.values(ADDED_MCC_CATEGORIES).flat()`. | One lookup path; the list and the map cannot differ; a range is no second concept. |
| S4 | The back-fill read binds `inArray(transactions.mcc, [...ADDED_MCC_CODES])` once, unchunked (976 codes). Measured 2026-11-03: `node:sqlite` 3.50.4 accepts 32,766 bound variables and refuses 32,767 ("too many SQL variables"); op-sqlite's `cpp/sqlcipher/sqlite3.c` defines `SQLITE_MAX_VARIABLE_NUMBER 32766` and the podspec does not override it; `IN_CLAUSE_CHUNK_SIZE` is 32,000. 976 is far inside. A test pins `.toSQL().params.length <= IN_CLAUSE_CHUNK_SIZE`. | No chunking machinery for a list known at build time; the pin fails first if the list ever grows near the limit. |
| S5 | "No real category" in SQL is one shared fragment `noRealCategorySql`: `category IS NULL OR lower(category) = 'other' OR lower(category) NOT IN (SELECT lower(key) FROM categories)`. `''` passes through the `NOT IN` arm. SQL only narrows; `hasNoRealCategory` decides. The fragment carries its own outer parentheses: `and()` and `not()` do not wrap a raw fragment (drizzle-orm `sql/expressions/conditions.js`), so without them `NOT a OR b OR c` and `ne(description, '') AND a OR ...` go wrong. Pinned with `toSQL()` in tasks 1 and 6. | A key list as a bound parameter would make the review's live query depend on another live read. `lower()` is ASCII-only, so a Cyrillic key in another case is a superset the pure function rejects: the safe direction. |
| S6 | The two migrations sit at the journal tail + 1 (the seed) and + 2 (the mark) of the task's base (tail on this base: `0063_add_transaction_operation`). The first branch to reach `next` keeps the numbers; a later one renumbers at its merge. The mark: delete its four artifacts, merge `next`, re-run `npx drizzle-kit generate` (never a hand-edited `prevId`). The seed is hand-authored with no snapshot, as `0039_seed_loan_interest_category` is: rename its `.sql`, and move its `_journal.json` entry and its `migrations.js` lines, with a `when` above the entry before it and below the mark's. Renumber list: the `.sql` of each, the mark's `meta/NNNN_snapshot.json`, `_journal.json`, `migrations.js`, both migration tests (file name, SQL file name, "through" tag), `real-sqlite.ts` (`firstStatementOf` tag), `real-sqlite.test.ts` (the same tag), `migrationCount`. No number anywhere else: not in a test title, a comment or a skill. Allowed only before a build ships; a shipped migration is never renamed. | Precedent: `docs/superpowers/plans/2026-09-28-reminders.md`, `2026-10-11-category-rules.md`. `1.4-small`, `1.4-light-scheme`, `1.4-tables` add no migration on their current tips. |
| S7 | Confirm rule for B2 and B5: write at once when `previewCount === group.rowCount`, else the confirm. The options sheet leaves `other` out. | `planRuleRewrite` skips only a row already in the target. A picked category is never `other`, and an orphan key cannot be picked, so every listed row moves. |
| S8 | `previewNameRule` returns `{ count, names }` where `names` is every distinct normalized name in its FULL tidied spelling (S1), ordered by row count descending then normalized text. The UI shows the first 5 and "and M more", M counting names. | `rowIdsRewrittenBy` returns ids only; a private `rowsRewrittenBy` returning `{ id, name }` feeds both so the count and the write stay one function. |
| S9 | The B3 confirm is a content swap inside the one `CategoryOverrideSheet`; the B2 and B5 confirm is a `ConfirmSheet` opened from the options sheet's `onClosed`. | One Modal at a time on iOS. |
| S10 | The review screen is a `FlatList` with `LargeTitleHeading` and `useLargeTitleScroll` (kiko-design-system, custom list screen; `HoldingDetail` is the model), not `Screen scroll` with a map. | The spec's own measure has thousands of groups. |
| S11 | `paused: !useIsScreenVisible()`, not focus. | The Statistics screen documents it: in a split window a screen can show without being the focused route. Spec 3.2.2 says "focused"; visibility is the code's rule. |
| S12 | The options sheet is `BottomSheet` + `SelectableRow` in the settings screen folder. `CategoryField` lives under `src/screens/forms/`, which a settings screen may not import. The chip is a `Button variant="secondaryTonal" size="small"` with a category icon. | No new shared component, so no `kiko:designer` step. |
| S13 | Performance pins assert counted work only (statements, pages, rules evaluated, `EXPLAIN QUERY PLAN`); wall clock is measured by hand and quoted in the READY report. | `transactions.repo.category-rules.performance.test.ts` states the rule in its header. |
| S14 | The performance fixture is not edited for new kinds: its "has the documented shape" pin holds 200 rules and 80 without a name. Each new pin builds `[...fixture.rules, ...ownRules]` on its own line. New row fields derive from the row index, with no draw from the seeded generator. | An edit of a shared seed is an edit of every pin on it (harness-workflow); one extra draw would change every row. |
| S15 | `applyNameRule`'s `kind` is optional, default `'nameIs'`. | The Apply path and its suites keep their meaning. |
| S16 | Task bases: the six tasks stack in this worktree in order; each base is the previous task's tip. "Needs" states the logical dependency, which is what the coordinator may reorder on. | Tasks 1-3 share `plan-rule-rewrite.ts`, `category-rules.repo.ts`, `en.ts`, `uk.ts`; stacking keeps one editor and one merge order. |
| S17 | Evidence `GROUP BY description, lower(category)`, no flag. | Every real-category row votes alike, so a flag only multiplies groups. |
| S18 | Only a real category votes: an evidence row with `hasNoRealCategory` true has no vote, whatever put it there. | A suggestion is only a suggestion, and the user confirms it. |
| S19 | The account picker offers non-archived accounts plus the rule's own selected account; "Deleted account" shows only when the id is in no row. | `accountsRepo.listQuery` returns archived accounts too; an archived account's holdings still match. |
| S20 | A 1.4 file is told from an older one by the presence of `mccCategoriesBackfilled` in the file's settings row (`Object.hasOwn`), read from `snapshot.settings`. A file with no settings row gets no Travel. | Spec 3.1.6 has the proof and the table. The empty-settings branch is the precedent of `withLegacyDedupKeysUpgraded` and leaves `restore-snapshot.test.ts`'s `settings: []` pins unchanged. |
| S21 | Travel stays in task 1, as numbered steps; no split. | Mutable floor 10, under the 20 line and the cap of 30. The seed comes first so that the map's target exists from its first commit. |
| S22 | The demo stays reviewable (Guideline 2.5.19). Task 2 adds store-number rows so the B3 button can appear; task 6 adds a merchant with real-category rows and one `other` row so the B5 chip can appear. `next` replaced the demo after this plan was written: step 8 of task 2 measures the names with a prefix on the merged seed. The rule demo's merchants (`KFC`, `Sushi Master`; its rows are told apart by description and amount) stay separate and its pinned count stays. An added merchant is not a monthly merchant of `buildMonthlyExpenses`, because recurring detection reads those names as a series. Regeneration order: task 1, then task 2, then task 6, each on the builder of its own tip. A track that merges first merges main first and regenerates on the merged builder (harness-workflow). `1.4-tables` or another track may also touch the demo: a `.kiko` conflict is never hand-merged, it is resolved by merging the builder sources and regenerating (`KIKO_REGEN_DEMO=1` on `generate-demo-kiko.test.ts`, then that test plain). `kiko-demo-en-1.1.kiko` and the kit's fake Monobank statement are not touched. Accepted, orchestrator's call: `build-demo-snapshot.ts:237,239` writes `mcc: null` and `counterIban: null`, so a B4 `mcc` or `counterIban` rule matches no demo row. Their picker and rule card stay reachable, so the conditions are not hidden; the Notes for Review state this. | The reviewer reaches a feature only through this file. |

## Upgrade worlds (task 1 adds owed state)

Owed state: `settings.mcc_categories_backfilled = false` on every database and every file without the key, and a `travel` row on every database and every older file. Two callers pay the mark: `useMccBackfill` and `importData`. The migration and `withTravelReseeded` pay the row. Answer to "which seeds are 1.2 or 1.3 upgrade worlds":

| Seed | World | Effect | Re-seed, by its own line |
|---|---|---|---|
| `restore-account-currency`, `restore-category-rules`, `restore-implicit-accounts`, `restore-usdt-rescale`, `restore-walk-state` `.two-path.test.ts` | Database below the new migration read through today's schema | `no such column` on `settings` | `addMccCategoriesBackfilledColumn(source)` beside each `addTransactionOperationColumn` line |
| Every other `applyMigrationsThrough` file (29 files is the floor, 9 in `data-transfer`; `restore-bank-other`, `restore-crypto-cash`, `restore-exchange-pair` use `columnsWithout`) | Same, if it reads `settings` | Measure: run them all in task 1, step 7 | Own line per failing file; never inside `applyMigrationsThrough` or `applyAllMigrations` |
| `import-data.back-compat.test.ts` | Older-build file through `importData` | The list of columns an earlier build lacked | `'mccCategoriesBackfilled'` in `EARLIER_BUILD_SETTINGS_COLUMNS`; a `jest.mock` of the back-fill beside the `lot-recost` mock |
| `import-data.test.ts`, `restore-category-rules.two-path.test.ts`, `__tests__/App.test.tsx` | Mock `recostStoredLots` | The real back-fill would run | A sibling mock of `backfill-mcc-categories` on its own line in each file |
| Data migration: every `applyAllMigrations` database (95 files is the floor) | Now holds a twelfth category row | Grep measured: no test seed counts the rows of `categories` with SQL, no real-SQLite pin holds a next `sortOrder`. `categories.repo.test.ts` reads migration text | None. A failure is reported |
| Data migration: every `applyMigrationsThrough` world at or below the tail | No `travel` row, as a device there has none | `categories` columns do not change, so a read through today's schema still works. A back-fill test on such a world finds the target unknown | None: back-fill pins use `applyAllMigrations` |
| Two-path files built by `readDataSnapshot` on a lower world plus `addMccCategoriesBackfilledColumn` | **Not a faithful older file:** the helper makes the reader write the mark key, so the restore treats it as a 1.4 file | Those suites hold `categories: []` or do not read categories, so nothing they pin changes | None for them. A Travel pin of an older file deletes the key from the JSON after the read |
| `restore-*.test.ts` with a settings row, no key and `categories: []` | Older file through `restoreDataSnapshot` | A real insert now adds `loan_interest` and `travel`; none of them reads the rows (grep measured) | None |
| `restore-snapshot.test.ts` `insertedRows.categories` by `toEqual` | `emptySnapshot` with `settings: []` | S20: no Travel, so both pins hold | None |
| `e2e/screenshot/fixtures/build-demo-snapshot.ts` | Current demo | Rows hold `mcc: null`, nothing owed; a file with the key and no row would have no Travel | `TRAVEL_CATEGORY` at `sortOrder` 11 and `mccCategoriesBackfilled: true`, each on its own line, then regenerate `kiko-demo-en.kiko`, `kiko-demo-uk.kiko` |
| `kiko-demo-en-1.1.kiko` | 1.1 file, no key, no `travel` row | Restoring it adds Travel and runs the back-fill. The README names `import-data.back-compat.test.ts` as its reader; the developer confirms it | File unchanged; a new pin reads it in step 12. The developer measures whether it holds an added code and reports it |
| `lot-money.matrix.test.ts` | Older settings without a flag | Calls `restoreDataSnapshot` directly, not `importData`: no back-fill | None |
| `transactions.repo.sync-adoption.test.ts` | `mcc: 5311` (now added) with an explicit `category: 'shopping'` | The seed passes its own category | None |
| `uabean-monobank-sample.csv` | Holds 5817 (now added) | Its format test asserts `mcc`, not the category | None; a mapper suite that asserts `other` for it is a stop-and-report |

Grep measured: outside those rows, no test seed holds an added code on an `mcc` line. After the edits above, the other suites stay green unchanged. A failure elsewhere is reported, never fixed by editing an expectation (kiko-testing).

Acceptance pins that re-seed by their own line, never in a shared helper: every row above. `real-sqlite.ts` gains one new function and changes nothing an existing pin calls.

## Conflict surface

| Task | Shared files | Other tracks |
|---|---|---|
| 1 | `schema.ts`, `_journal.json`, `migrations.js`, `App.tsx`, `import-data.ts`, `restore-snapshot.ts`, `default-category-title.ts`, `en.ts`, `uk.ts`, `envelope.test.ts` | Another migration on `next`: S6, both of these renumber |
| 2 | `en.ts`, `uk.ts`, `title-keys.ts` (added keys); `screenshot-seed.ts`, `demo-text.ts`, both demo `.kiko` files | `1.4-small` edits both catalogues; added lines only. A demo conflict: S22, regenerate |
| 3 | `en.ts`, `uk.ts` (added keys, help step 2) | same |
| 4 | `en.ts`, `uk.ts` (added keys, help step 2) | same |
| 5 | `settings.stack.tsx`, `src/navigation/types/types.d.ts`, `en.ts`, `uk.ts`, `title-keys.ts`, `help-topics.ts`, `categories.screen.tsx` | One added route each. `1.4-small` rewrites `settings.screen.tsx`, which this does not touch. `1.4-tables` adds its own Tables screen, not a Statistics view; the overlap is additive: `types.d.ts`, `title-keys.ts`, `help-topics.ts`, `en.ts`, `uk.ts` |
| 6 | `en.ts`, `uk.ts`; `screenshot-seed.ts`, `demo-text.ts`, both demo `.kiko` files | same; a demo conflict: S22, regenerate |
| All UI | theme tokens | `1.4-light-scheme`: no hex or raw value, so no conflict |

## Closing steps (every task, same order)

Each task's last four steps are these, named by number in the task:

- **Review:** `kiko:reviewer` on the task's diff from its base. The diff of test files is checked for edited pins.
- **Drift:** `kiko:retrospect` checks `.claude/skills/`, `harness/kiko/skills/`, `harness/kiko/agents/` against the task's code.
- **Scribe:** `kiko:scribe` fixes the drift and commits; the report names the sha or "no drift found". Named per task below.
- **Ready:** the orchestrator reports READY FOR VERIFY to the coordinator: worktree, label `1.4-category-automation-task-N`, base sha, head sha, mutable file count, named-file runs and their output path. The coordinator queues the verify and merges.

---

## 1.4-category-automation task 1/6: more MCC codes, Travel and the back-fill

**Needs:** nothing. **Base:** `c1cea32e0` or its successor on the track.

**Files (floor; measure with `make mutable`). Mutable: 10, by `mutable_source_files` in `mutation.sh`, which leaves out `e2e/`, barrels, `.d.ts`, `.styles.ts`, catalogues and `title-keys.ts`.**
- Modify: `src/monobank/mcc-category/mcc-category.ts`, `src/categories/category-rules/plan-rule-rewrite.ts`, `src/categories/category-rules-repo/category-rules.repo.ts` (export `candidateColumns`, `readHoldingLabels`, `withVisibleDescription`), `src/categories/category-rules-repo/index.ts`, `src/db/schema.ts`, `App.tsx`, `src/data-transfer/import-data.ts`, `src/data-transfer/snapshot/restore-snapshot.ts`, `src/i18n/default-category-title/default-category-title.ts`, `e2e/screenshot/fixtures/build-demo-snapshot.ts`
- Create: `src/categories/category-rules-repo/backfill-mcc-categories.ts`, `src/categories/category-rules-repo/use-mcc-backfill.ts`
- Catalogue (outside the mutable filter): `src/i18n/locales/en.ts`, `uk.ts`
- Generated or hand-authored: `drizzle/migrations/NNNN_seed_travel_category.sql` (no snapshot), `drizzle/migrations/NNNN_add_mcc_categories_backfilled.sql`, `meta/NNNN_snapshot.json`, `meta/_journal.json`, `migrations.js`
- Test-only: see "Upgrade worlds", plus `src/db/__fixtures__/seeded-categories.ts`, `src/test-support/real-sqlite.ts` and `.test.ts`, `src/db/settings-columns.test.ts`, `src/data-transfer/crypto/envelope.test.ts`, regenerated demo `.kiko` files

**Interfaces. Produces:**
```ts
// @kiko/monobank/mcc-category
export const ADDED_MCC_CODES: readonly number[];
// @kiko/categories/category-rules
export const hasNoRealCategory: (row: { category: string | null }, knownCategoryKeys: ReadonlySet<string>) => boolean;
export type MccBackfillRow = RewriteCandidate & { mcc: number | null };
export const planMccBackfill: (prepared: PreparedRules, rows: readonly MccBackfillRow[], knownCategoryKeys: ReadonlySet<string>) => { id: string; category: string }[];
// @kiko/categories/category-rules-repo
export const noRealCategorySql: SQL;
export const backfillMccCategories: () => Promise<void>; // never rejects
export const useMccBackfill: () => void;
// @kiko/db/__fixtures__/seeded-categories
export const TRAVEL_CATEGORY: SeededCategory; // { key: 'travel', title: 'Travel', icon: 'airplane' }
// src/data-transfer/snapshot/restore-snapshot.ts, private
const withTravelReseeded: (categories: CategoryRow[], settings: SettingsRow[]) => CategoryRow[];
```
`knownCategoryKeys` always holds `categoryKeyOf(key)` for every row of `categories`.

**Scenario matrix (a ruling reverses "every other code is `other`"):**

| Row | was: new row | new row | was: stored row after next open | stored row after next open |
|---|---|---|---|---|
| Added code, sync or import | `other` | mapped | `other` | mapped, once |
| Original 38 codes | mapped | mapped | as stored | as stored |
| Hotel or agency (7011, 3501-3999, 4722) | `other` | `travel` | `other` | `travel`, once |
| Airline or airport (3000-3299, 4511, 4582); the earlier draft had `transport` | `other` | `travel` | `other` | `travel`, once |
| Car rental, rail (3351-3441, 7512, 4112) | `other` | `transport` | `other` | `transport`, once |
| Unmapped (6300, null) | `other` / NULL | `other` / NULL | as stored | as stored |
| Added code, hand-set, balance or split-change | n/a | n/a | as stored | as stored |
| Added code, a rule wins (any target) | rule | rule | as stored | as stored |
| Added code, target category deleted (Travel included) | n/a | `other` shows by fold | `other` | `other`, left for B2 |
| Added code, exchange leg | `other` | mapped | `other` | mapped (spec 3.1.3 ruling) |
| Added code, `other` by a pre-0056 pick or a deleted rule | n/a | n/a | `other` | mapped: the residual ruling Q1 accepts |

- [ ] **step 1/17 (kiko:qa): seed pins.** Create `drizzle/migrations/NNNN-seed-travel-category.test.ts`, real `node:sqlite`, shape of the 0063 test, through `0063_add_transaction_operation`:
  - `seeds travel with its title, icon, color and the next sort order`: `('travel', 'Travel', 'airplane', '#40C8E0', 11)` on a default grid.
  - `appends after the highest order of a reordered grid and changes no other order`: other rows reordered, one user row at 40; Travel at 41; every other `sort_order` as stored.
  - `leaves a row already holding the key untouched`: a `travel` row with its own title, icon, color and order, as a 1.3 database that restored a 1.4 file holds; every column equal after.
  - `leaves a user category titled Travel as its own row`: a UUID key titled `Travel`; both rows after, the user's unchanged.
  - `changes no other category, transaction or rule`: full dumps before and after, minus the new row.
  - `runs twice to one row`; `starts at sort order 0 on an empty table`.
  Also: `default-category-title.test.ts`: `translates the travel seeded category` under `uk` to `Подорожі`, and `shows a renamed travel row verbatim`. `icon-picker-modal.component.test.tsx`: `includes airplane, the travel default icon`. `categories.repo.test.ts`: `seeds travel in its own, later, idempotent migration`, shape of the 0039 case.
  Red: `npx jest drizzle/migrations/NNNN-seed-travel-category.test.ts src/i18n/default-category-title src/categories/repo/categories.repo.test.ts --maxWorkers=2`; the SQL file is missing, so show that output. Two are pins, green at once, not red; say so: the pool case (`airplane` is in `KIKO_CATEGORIES_ICONS` and under `symbol-deployment-target.test.tsx`) and `shows a renamed travel row verbatim` (`resolveDefaultCategoryTitle` already returns the stored title for a key outside `DEFAULT_CATEGORY_SEED_TITLES`). Commit `test(db): pins for the Travel seed`.

- [ ] **step 2/17 (kiko:developer): the seed.** Hand-author `NNNN_seed_travel_category.sql` as spec 3.1.6, header after 0039's; journal entry at the tail with a `when` above it, `migrations.js` lines, no snapshot (S6). `TRAVEL_CATEGORY` in `seeded-categories.ts` as its own export, its comment after `LOAN_INTEREST_CATEGORY`'s. `travel: 'Travel'` in `DEFAULT_CATEGORY_SEED_TITLES`; `categories.travel` in `en.ts` (`Travel`) and `uk.ts` (`Подорожі`) in this step. `envelope.test.ts`: `migrationCount` 65, `version` stays 5, the seed note of spec 3.1.6. `npm run check:shipped-migrations`. Exit 3 from `make jest-affected` is expected. Run: step 1's command plus `src/i18n/locales src/help src/design-system/components/icon-picker-modal src/data-transfer/crypto/envelope.test.ts`. Commit `feat(db): seed the Travel category`.

- [ ] **step 3/17 (kiko:qa): MCC map pins.** In `src/monobank/mcc-category/mcc-category.test.ts` add, with literal tables copied from spec 3.1.2 and the current `MCC_CATEGORIES`, never derived from the module:
  - `keeps every one of the 38 original codes in its original category`: `categoryForMcc(code)` equals the literal for each of the 38 (5912 is `shopping`).
  - `maps each of the 86 added single codes to its table category`.
  - `maps both ends of each brand range and refuses the codes next to them`: 3000, 3299, 3501, 3999 `travel`; 3351, 3441 `transport`; 2999, 3300, 3350, 3442, 3500, 4000 `other`.
  - `sends hotels, agencies, airlines and airports to travel`: 7011, 4722, 4511, 4582.
  - `keeps car rental, rail and other land transport in transport`: 7512, 3351, 4112, 4789.
  - `leaves the codes outside the tables in other`: 6300, 8211, 8220, 8299, 8398, 9311, 9399, 7311, 7399, 4215, 7230, 7211, 7216, 5511, 5571, 7995, 5993, 6010, 6051.
  - `lists 976 distinct added codes, none original and none excluded from spending`: length 976, `new Set` size 976, disjoint from the 38, from `ALWAYS_EXCLUDED_MCCS` and `OWN_ACCOUNT_TRANSFER_MCC`.
  - `targets only seeded keys and never cash or transfers`: against `SEEDED_CATEGORIES` and `TRAVEL_CATEGORY`.
  Red: `npx jest src/monobank/mcc-category --maxWorkers=2`. The source file `mcc_codes.csv` was checked 2026-11-03: 981 rows, all 86 singles present, 3000-3299 = 300 rows, 3351-3441 = 91 rows, 3501-3999 = 292 rows of 499 codes (mapped whole by ruling Q2, spec 3.1.1), no overlap with the 38; the developer re-checks each code per spec 3.1.1. Commit `test(mcc): pins for the original and added codes`.

- [ ] **step 4/17 (kiko:developer): the map.** S3; `travel` is one more key of `ADDED_MCC_CATEGORIES`. Keep `MCC_CATEGORIES` byte-identical. Green: same command. Commit `feat(mcc): add 86 codes and three brand ranges`.

- [ ] **step 5/17 (kiko:qa): plan pins.** In `src/categories/category-rules/plan-rule-rewrite.test.ts` add:
  - `describe('hasNoRealCategory')` table: `null`, `''`, `'other'`, `'OTHER'`, `'ghost'` true; `'groceries'`, `'GROCERIES'`, a user key true in the known set false.
  - `describe('planMccBackfill')`, each row a one-line variation of one base row with `mcc: 5300`, `category: 'other'`:
    `plans an added code in other to its mapped category`; `plans a NULL, an empty and an orphan category`; `plans an exchange leg`; `leaves a code of the original map`; `leaves an unmapped code and a null code`; `leaves a hand-set row`; `leaves a balance-setting row`; `leaves a split-change row`; `leaves a row a rule targeting other wins`; `leaves a row a rule targeting another category wins`; `leaves a row whose target category was deleted`; `plans a hotel code to travel`; `leaves a hotel code when travel was deleted`; `leaves a row in a real category`; `ignores a rule that cannot be read`.
  Each asserts the exact `{ id, category }[]` by `toEqual`. Red: `npx jest src/categories/category-rules/plan-rule-rewrite.test.ts --maxWorkers=2`. Commit `test(rules): pins for hasNoRealCategory and planMccBackfill`.

- [ ] **step 6/17 (kiko:developer): the plan.** Both functions in `plan-rule-rewrite.ts`, beside `isRewriteEligible`. `planMccBackfill` builds its `Set` of `ADDED_MCC_CODES` once at module load. Order the cheap checks before `winningRule`. Green: same command. Commit `feat(rules): plan the MCC back-fill`.

- [ ] **step 7/17 (kiko:developer): the mark migration and worlds.**
  - `schema.ts`: `mccCategoriesBackfilled: integer('mcc_categories_backfilled', { mode: 'boolean' }).notNull().default(false)`.
  - `npx drizzle-kit generate --name add_mcc_categories_backfilled`, then re-check `migrations.js` (keep only inserted lines), `./node_modules/.bin/biome check --write` on the artifacts, `npm run check:shipped-migrations` (S6). Add a header in the `.sql` after the shape of 0063's: additive, crash-safe, restore mirror is the default; name only `src/` paths that exist.
  - Test `drizzle/migrations/NNNN-add-mcc-categories-backfilled.test.ts`, shape of the 0063 test: `adds a NOT NULL integer column defaulting to false`; `keeps the settings row with the mark false`; `adds no index`.
  - `src/db/settings-columns.test.ts`: `'mccCategoriesBackfilled'` in the list and `adds mcc_categories_backfilled, defaulting to false`, shape of the `lots_recosted` case.
  - `envelope.test.ts`: `migrationCount` 66, `version` stays 5, the mark note of spec 3.1.6.
  - `real-sqlite.ts`: `addMccCategoriesBackfilledColumn` after the shape of `addTransactionOperationColumn`, with its `real-sqlite.test.ts` case.
  - Apply the "Upgrade worlds" table. `build-demo-snapshot.ts`: `TRAVEL_CATEGORY` with `entityColorsDark.teal` at `sortOrder` 11, and the key `true`; `build-demo-snapshot.test.ts`: `TRAVEL_CATEGORY.key` on its own line in the list pin, and `colors Travel the way its own migration does`; regenerate the demo `.kiko` files by `e2e/screenshot/fixtures/README.md`, same commit.
  Run: every file of `git grep -l applyMigrationsThrough -- src drizzle` plus `src/db/settings-columns.test.ts src/data-transfer/crypto/envelope.test.ts e2e/screenshot/fixtures`, `--maxWorkers=2`, output in a file. Commit `feat(db): settings mark for the MCC back-fill`.

- [ ] **step 8/17 (kiko:qa): back-fill pins on real SQLite.** Create `src/categories/category-rules-repo/backfill-mcc-categories.test.ts` (`executingClient`, `applyAllMigrations`, shape of `lot-recost.test.ts`). Cases:
  - `moves every planned row to its own mapped category and sets the mark`: rows to `groceries`, `transport` and `travel`; assert the stored category per id and the mark.
  - `leaves a hotel row for review when Travel was deleted`: `categoriesRepo.delete('travel')` first; the row stays, the mark is set.
  - `leaves a row in a user category titled Travel`: the UUID key is a real category.
  - `leaves hand-set, structural, rule-won, original-map and deleted-target rows as stored`: one seeded row of each; compare all columns before and after.
  - `sets no hand flag on a moved row`.
  - `rolls every row back and leaves the mark unset when the mark cannot be written`: a test-local `CREATE TRIGGER ... BEFORE UPDATE OF mcc_categories_backfilled ON settings ... RAISE(ABORT, 'refused')`. The rows are unchanged, the mark false; the trigger dropped, a second call moves them.
  - `never rejects and logs its fixed text with no name when the write fails`: same trigger, resolves; `expect(logFailure)` with the literal tag; the rendered call holds no seeded name or IBAN.
  - `runs once: a row that became other after the first run stays other`.
  - `reads only the mark on a later open`: statement spy, exactly one `select` on `settings`, no `transactions` read.
  - `re-reads the mark inside the write`: mark flipped between the outer read and the write; nothing moves.
  - `binds the added codes within the variable limit`: `mccBackfillRowsQuery(...).toSQL().params.length <= IN_CLAUSE_CHUNK_SIZE`, and it executes on the real engine.
  - `noRealCategorySql keeps its own parentheses inside and()`: `mccBackfillRowsQuery(...).toSQL().sql` holds the three arms inside one `( ... )`, and a row with an unlisted code in `other` stays out of the real read.
  - `leaves balances untouched`: `holdings.balance_minor_units` equal before and after, on a holding with moved rows.
  Red: `npx jest src/categories/category-rules-repo/backfill-mcc-categories.test.ts --maxWorkers=2`. Commit `test(rules): pins for the MCC back-fill write`.

- [ ] **step 9/17 (kiko:developer): the write.** `backfill-mcc-categories.ts`, shape of `recostStoredLots`: `isBackfillDone` (`rows.at(0)?.mccCategoriesBackfilled !== false`); outer read, then one `write()`: read the mark again; read `categories`, rules; read `{ ...candidateColumns, mcc: transactions.mcc }` with `inner join holdings` `WHERE inArray(mcc, ADDED) AND noRealCategorySql` (S4, S5) as exported `mccBackfillRowsQuery`; `withVisibleDescription` (a blank row's label is its name); plan; group by category; update each group in `chunkRows(ids, IN_CLAUSE_CHUNK_SIZE)` with `.set({ category })` and `eq(categorySetByHand, false)` in the WHERE, never touching the flag; set the mark; commit. Wrapped in `logOnFailure('[mcc-backfill] back-fill failed', ...)`. Export `noRealCategorySql` from `category-rules.repo.ts`. Green: same command. Commit `feat(rules): one-time MCC back-fill`.

- [ ] **step 10/17 (kiko:qa): restore pins for both files.** S20. In `src/data-transfer/snapshot/restore-snapshot.test.ts`, `describe('Travel category reseed')`:
  - `adds Travel at one past every category for a file from before 1.4`: settings row without the key; exact row with `#40C8E0`.
  - `does not bring Travel back in a 1.4 file where the user deleted it`: `it.each` over the key `true` and `false`; `insertedRows.categories` holds no `travel`.
  - `keeps a file's own Travel row verbatim`: `it.each` over the key absent and present; renamed, recolored, moved; `toEqual`.
  - `adds loan interest, then Travel, to a file with neither`: `sortOrder` 1 and 2 after one category.
  - `leaves a user category titled Travel alone beside the added row`.
  - `adds no Travel for a file with no settings row`.
  - `reads the key by presence: a key of false is a 1.4 file`.
  Create `src/data-transfer/import-data.travel-category.test.ts`, real SQLite through `importData` with a real encrypted envelope, shape of `restore-category-rules.two-path.test.ts`, `recostStoredLots` mocked:
  - `a file this build wrote after Travel was deleted restores without it`: the real writer: `applyAllMigrations`, `categoriesRepo.delete('travel')`, `readDataSnapshot`, JSON round trip; asserts the file's settings hold the key.
  - `a file this build wrote with Travel restores the same row`.
  - `a file from before 1.4 gains Travel`: `applyMigrationsThrough('0063_add_transaction_operation')`, `addMccCategoriesBackfilledColumn`, `readDataSnapshot`, then the key deleted from the JSON (see "Upgrade worlds").
  Red, named files; show it. Commit `test(restore): pins for Travel in both kinds of file`.

- [ ] **step 11/17 (kiko:developer): the restore mirror.** `withTravelReseeded` beside `withLoanInterestReseeded`, chained after it at the `categories` insert; constants duplicated with a comment as 0039's are; `entityColorsDark.teal`. Its doc comment states why it differs from loan interest: presence of the mark key, never the row alone. Green: named files plus `src/data-transfer/snapshot/restore-snapshot.test.ts`. Red proof: delete the `hasOwn` check and show the deleted-Travel cases red. Commit `feat(restore): Travel for an older file, never back into a newer one`.

- [ ] **step 12/17 (kiko:qa then kiko:developer): wiring.**
  - Create `src/categories/category-rules-repo/use-mcc-backfill.test.ts` (shape of `use-lot-recost.test.ts`), `__tests__/App.test.tsx` case `starts the one-time MCC back-fill from the app root`.
  - Create `src/data-transfer/import-data.mcc-backfill.test.ts`, real SQLite through `importData` with a real encrypted envelope (shape of `restore-category-rules.two-path.test.ts`), `recostStoredLots` mocked, the back-fill real:
    `moves an added-code row and sets the mark for a file with no key`; `leaves an added-code row in other for a file with the mark`; `keeps the mark through a round trip`; `restores an older file's hand-set and rule-won rows as stored`.
  - Same file, the order: `moves a hotel row of an older file to Travel, restored first`; `leaves a hotel row of a 1.4 file without Travel in other, mark false`; `leaves it, mark true`. Red proof: run the back-fill before the mirror in a scratch copy of the order and show the first case red.
  - `import-data.back-compat.test.ts`: `a real 1.1 file gains Travel and restores its own rows`, reading `kiko-demo-en-1.1.kiko` with its real key.
  - Code: `useMccBackfill` (shape of `useLotRecost`, its `biome-ignore` with `OVERRIDE(total function)`); `App.tsx` after `useLotRecost()`, one sentence added to the `AppRoot` comment; `import-data.ts`: `await backfillMccCategories();` right after `await recostStoredLots();`, one comment line; barrel `export *` of both new files.
  Run: `npx jest src/categories/category-rules-repo src/data-transfer/import-data.mcc-backfill.test.ts src/data-transfer/import-data.travel-category.test.ts src/data-transfer/import-data.test.ts src/data-transfer/import-data.back-compat.test.ts __tests__/App.test.tsx --maxWorkers=2`. Commit `feat(app): run the MCC back-fill at open and after a restore`.

- [ ] **step 13/17 (kiko:qa): the older-build two-path test.** Create `src/data-transfer/snapshot/restore-travel-category.two-path.test.ts`, real SQLite. No copy of a 1.3 source file goes in; spec 3.1.6 records what 1.3 shows, read with `git show`.
  - Path 1, a 1.4 file into 1.3's schema. The file comes from the real `readDataSnapshot` on `applyAllMigrations`, with a row in `travel`, through a raw JSON round trip. `applyMigrationsThrough('0063_add_transaction_operation')` is 1.3's schema (journal tail checked at 918683db3):
    `release 1.3's tables take the Travel row and its transactions with no refusal` (raw insert of the file's rows); `the Travel row holds only columns release 1.3 has` (row keys against `pragma_table_info`); `the only settings key release 1.3 drops is the mark`.
  - Path 2, a 1.3 export into 1.4. Read from that world with a hotel row in `other` and the Travel row added there (`addMccCategoriesBackfilledColumn`, `readDataSnapshot`, the key deleted from the JSON); `importData` with the real back-fill:
    `keeps the file's Travel row and shows it translated in uk`; `moves the hotel row to Travel and sets the mark`; `a row hand-set in release 1.3 stays`; `a file with no Travel row gains it` (the accepted case of spec 3.1.6).
  Named-file run; red proof: in a scratch copy make the mirror add no row and show path 2's last case red. Commit `test(restore): Travel through release 1.3 and back`.

- [ ] **step 14/17 Review (kiko:reviewer).** Both migrations go to the reviewer before BATCH READY; the brief names their numbers. Mark: is the SQL one additive `ALTER`; which existing queries touch `settings` (`settingsRepo`, `readDataSnapshot`, `restoreDataSnapshot`, the older-column worlds) and what each does at the previous index or with a file lacking the key; is the journal index free on `next` and is the S6 list right; does the back-fill read touch any index it should not (`EXPLAIN QUERY PLAN`: `SCAN transactions`, measured by the reviewer). Seed: is it one `INSERT OR IGNORE` and can it change any existing row; which queries read `categories`; is the `when` order right with no snapshot. Neither adds an index, so no `EXPLAIN` test, confirm. Top question: can a restore bring a deleted Travel back in a file this build wrote, or overwrite a row? UI: a new seeded entity is a visible default, so the closing report lists for the user's device: the Travel tile, its airplane icon and teal color in the grid, a pie slice, the uk title `Подорожі`.
- [ ] **step 15/17 Drift (kiko:retrospect).** Check: kiko-architecture's launch-step list (`useMccBackfill` beside `useLotRecost`) and its re-seed and two-path text (a seed whose reseed is gated on a mark key), kiko-domain's category rule text, `categoryForMcc` scope and seeded list, kiko-design-system if it names the seeded colors, `real-sqlite.ts` helper list in kiko-testing.
- [ ] **step 16/17 Scribe (kiko:scribe).** Fix the drift and commit; the report names the sha or "no drift found".
- [ ] **step 17/17 Ready (orchestrator).** READY FOR VERIFY, label `1.4-category-automation-task-1`.

---

## 1.4-category-automation task 2/6: prefix offer in Apply

**Needs:** nothing. **Base:** task 1 tip.

**Files (floor). Mutable: 7.**
- Create: `src/transactions/merchant-name/merchant-name.ts`, `index.ts`; `src/categories/rule-preview-text/rule-preview-text.ts`, `index.ts`
- Modify: `src/categories/category-rules/category-rules.d.ts`, `src/categories/category-rules-repo/category-rules.repo.ts`, `src/screens/forms/transaction-form/category-rule/category-rule.ts` (`PendingCategoryView` gains `title`), `src/screens/forms/transaction-form/use-category-override/use-category-override.ts`, `category-override-sheet/category-override-sheet.component.tsx`, `category-override-sheet.props.d.ts`, `transaction-form.screen.tsx`, `src/i18n/locales/en.ts`, `uk.ts`
- Test-only or data: `src/i18n/locales/title-keys.ts`; `e2e/screenshot/seed/screenshot-seed.ts`, `demo-text.ts`, `e2e/screenshot/fixtures/README.md`, `build-demo-snapshot.test.ts`, regenerated demo `.kiko` files

**Interfaces. Produces:**
```ts
// @kiko/transactions/merchant-name
type MerchantName = { key: string; prefix: string | null };
const MERCHANT_PREFIX_MIN_LETTERS = 3;
export const merchantNameOf: (name: string) => MerchantName;
export const tidiedNameOf: (name: string) => string; // spec section 4 `tidy`: the full name, case kept
export const merchantSpellingOf: (name: string) => string; // prefix, else the tidied name: `nameStartsWith` text only
export const smallestSpelling: (spellings: Iterable<string>) => string; // S1
// @kiko/categories/category-rules
export type NameRuleKind = 'nameIs' | 'nameStartsWith';
// categoryRulesRepo
previewNameRule: (input: { text: string; kind: NameRuleKind; category: string; sourceTransactionId: string | null }) => Promise<{ count: number; names: string[] }>; // counts the source row Apply moves, as `applyNameRule` does
applyNameRule: (input: { name: string; kind?: NameRuleKind; category: string; sourceTransactionId: string | null }) => Promise<number>;
// @kiko/categories/rule-preview-text
export const NAMES_SHOWN = 5;
export const ruleMoveMessage: (preview: { count: number; names: readonly string[] }, categoryTitle: string, t: TFunction) => string;
```

**Copy (drafts; kiko-translator decides):**

| Key | en | uk |
|---|---|---|
| `forms.transaction.applyToAllStartingWith` | `All starting with "{{prefix}}"` | `Усі, що починаються з «{{prefix}}»` |
| `categoryRulePreview.confirmTitle` (title key) | `Move Transactions` | `Перемістити транзакції` |
| `categoryRulePreview.confirm` | `Move` | `Перемістити` |
| `categoryRulePreview.addTitle` (title key), shown instead of `confirmTitle` at a count of 0 | `Add Rule` | `Додати правило` |
| `categoryRulePreview.add`, shown instead of `confirm` at a count of 0 | `Add` | `Додати` |
| `categoryRulePreview.moveMessage_one/_few/_many/_other` | `_one`: `{{count}} transaction moves to "{{category}}": {{names}}.`; the rest: `{{count}} transactions move to ...` | `_one`: `{{count}} транзакція перейде до категорії «{{category}}»: {{names}}.`; `_few`: `транзакції перейдуть`; `_many`: `транзакцій перейде`; `_other`: `транзакції перейде` |
| `categoryRulePreview.moreNames_*` | `and {{count}} more` | `і ще {{count}}` |
| `categoryRulePreview.noRowsMessage` | `No existing transactions move. New ones will go to "{{category}}".` | `Наявні транзакції не перейдуть. Нові потраплятимуть до категорії «{{category}}».` |
| help step `5` (edit) | add: `If the name ends in a store number, you can also apply to all names that start the same way.` | `Якщо назва закінчується номером магазину, можна застосувати й до всіх назв із таким самим початком.` |

**Agents for steps 1-7.** One `kiko:qa` run writes steps 1, 3 and 6, each with its commit (a missing export read by a runtime lookup, Global Constraints). Then one `kiko:developer` run does steps 2, 4, 5 and 7 in order, with no stop between them. If it must hand over midway, the orchestrator resumes the same agent by SendMessage while its context is under about 150k, else starts a fresh one with the finished steps in its brief. **Warning:** Knip reports the new exports until steps 4 and 7 add their callers, and `medium.sh` keeps blocking on `SubagentStop` (only a repeated `Stop` skips). A failure there is that unfinished work, not a finding and not a sign the agent finished; no export is deleted to pass it.

- [ ] **step 1/12 (kiko:qa): name table and property.** Create `src/transactions/merchant-name/merchant-name.test.ts`:
  - `it.each` over every row of the spec section 4 table: exact `{ key, prefix }`. Name: `reads %s as key %s and prefix %s`.
  - `describe('the guarantee')`, using `sweep` from `@kiko/test-support/property-sweep` (add the site to `__tests__/property-sweep-sites.test.ts`) and `seededRandom` with the spread constant: `normalizeTransactionName(name).startsWith(key)`, and when `prefix !== null`, `normalizeTransactionName(prefix) === key`. The generator draws tokens from Latin, Cyrillic, digits of 1-8 lengths, `#`, `№`, `-`, `,`, `.`, double spaces, NBSP, NFD `й`, `İ`, final sigma `ΣΑΣ`; assert the drawn worlds include at least one cut and one kept name.
  - `is the same for a name in another case and spacing`: `key` of `ATB  0212` equals `atb 0212`.
  - `smallestSpelling takes the smallest by code unit`: `[atb, ATB]` -> `ATB`; the input reversed gives the same.
  - `tidiedNameOf keeps the full name` (`ATB  0212` -> `ATB 0212`); `merchantSpellingOf gives the prefix when cut, else the tidied name` (`ATB 0212` -> `ATB`, `ATB Market` -> `ATB Market`).
  Red: `npx jest src/transactions/merchant-name --maxWorkers=2`. Commit `test(names): merchant name table and property pins`.

- [ ] **step 2/12 (kiko:developer): the function.** `merchant-name.ts`, spec section 4 rules in order. `\p{L}` with the `u` flag has precedent on Hermes (`title-fit.ts`, `format.ts`). Calls `normalizeTransactionName`, changes it nowhere. Green: same command. Commit `feat(names): merchantNameOf`.

- [ ] **step 3/12 (kiko:qa): preview and kind pins.** In `src/categories/category-rules-repo/category-rules.repo.test.ts`, real SQLite:
  - `previewNameRule counts exactly the rows applyNameRule then changes`: fixture with `ATB 0212`, `ATB 0340`, `ATB Market`, `ATBANK`, a hand-set `ATB 1`, a balance row; preview; apply `kind: 'nameStartsWith'`; the changed id set has `count` members and every name in `names`.
  - `previewNameRule writes nothing and adds no rule`.
  - `previewNameRule lists each normalized name once in full, most rows first` (S1, S8): by `toEqual` on the fixture above, `['ATB 0212', 'ATB 0340', 'ATB Market', 'ATBANK']` with `ATB 0212` holding the most rows, and a row `atb  0212` adds no name.
  - `previewNameRule of a one-name store-number rule counts its own rows`: `kind: 'nameIs'`, text `ATB 0212` gives its rows, never 0.
  - `previewNameRule of a blank text is zero with no names`.
  - `previewNameRule includes a blank row's label as a name`.
  - `applyNameRule with no kind still writes nameIs` and `stores nameStartsWith with the trimmed text as typed`.
  - `applyNameRule moves an existing prefix rule to the new category and keeps its id`.
  - `a new prefix rule takes rows from an older one-matcher rule by updatedAt and counts them`; `a rule with more conditions still wins`.
  - `sets no hand flag on a row moved by a prefix rule` and `frees the source row as Apply does`.
  Create `src/categories/rule-preview-text/rule-preview-text.test.ts`: `shows at most five names and the count of the rest`; `quotes each name through common.listedName in uk`; `uses the plural of the count` for 1, 2, 5, 21 in uk; `says no rows move for a count of 0`.
  Red, named files. Commit `test(rules): pins for the name rule preview`.

- [ ] **step 4/12 (kiko:developer): repo.** `NameRuleKind` in `category-rules.d.ts`. Private `stageNameRule(rows, { text, kind, category })` shared by both entry points. Private `rowsRewrittenBy` returning `{ id, name }[]` (`name` is the visible description, S8); `rowIdsRewrittenBy` maps it, so `countRuleRewrite`, `saveRule` and the performance pin's statement counts do not change. `previewNameRule` spells `names` with `tidiedNameOf` and `smallestSpelling`, never `merchantSpellingOf`. `applyNameRule`'s `matchers`: `[{ type: kind ?? 'nameIs', text: input.name.trim() }]`. Green; also `npx jest src/transactions/repo/transactions.repo.category-rules.performance.test.ts --maxWorkers=2` unchanged. Commit `feat(rules): previewNameRule and a kind on applyNameRule`.

- [ ] **step 5/12 (kiko:developer): preview text and catalogue.** `rule-preview-text.ts`; keys in `en.ts` and `uk.ts` in this step, with `title-keys.ts`. `names` go through `common.listedName`, joined by `, ` (never `Intl.ListFormat`); `moreNames` appended. Run: `npx jest src/categories/rule-preview-text src/i18n/locales src/help --maxWorkers=2`. Commit `feat(i18n): copy for the name rule preview`.

- [ ] **step 6/12 (kiko:qa): flow pins.** In `use-category-override.test.ts`: `offers no prefix for a name with no store number`; `offers the prefix for a name that ends in one`; `previews without writing on the first tap`; `writes with kind nameStartsWith and the source row only on confirm`; `returning from the confirm leaves the first step and writes nothing`; `cancel leaves what the form saved and writes no rule`; `shows the save alert when the preview fails`; `blocks a second confirm while the write runs`. Create `category-override-sheet.component.test.tsx`: `keeps Apply first and Just for this one for a name with no prefix` (today's sheet, whose text is read through `i18n.t`); `shows the prefix button as secondary below Apply`; `swaps to the confirm content in the same sheet`, with a positive twin for each absence assertion. Commit `test(forms): pins for the prefix offer`.

- [ ] **step 7/12 (kiko:developer): flow.** S9. Hook gains `prefixOffer: string | null`, `prefixPreview: { count; names } | null`, `onOfferPrefix`, `onBackFromPrefix`, `onApplyPrefix`, each with its own `useSubmitOnce`; `isOverrideWriting` includes them. Sheet props gain `prefix`, `onOfferPrefix`, `isOfferingPrefix`, `prefixConfirm: { message: string; onConfirm; onBack; isApplying } | null`; when set the sheet body is the message, `Button` "Move", ghost back. Screen wires props. `resolvePendingCategory` also returns `title`, for `ruleMoveMessage`. `resolveCategoryOverrideRequest`, `offersCategoryNameRule` stay as they are. Run: `npx jest src/screens/forms/transaction-form --maxWorkers=2`. Commit `feat(forms): offer a prefix rule in Apply`.

- [ ] **step 8/12 (kiko:developer): store-number rows in the demo.** S22. `buildStoreNumberTransactions` beside `buildFoodDeliveryTransactions` in `screenshot-seed.ts`. The merchant is `Varus`, a Latin brand literal in both languages as `Novus` is, so `demo-text.ts` does not change (`git grep -i varus` finds it nowhere else: not a monthly merchant, not in the kit's fake statement, not a name a stored demo rule matches). Rows on the same card: `<store> 0212` twice, `<store> 0340` once, all `other`, inside the default 30-day window but not the newest rows, so a Home screenshot's first rows do not change. Keep the three rows within 20 days at uneven gaps, so that they cannot read as a monthly series. Add a short section to `e2e/screenshot/fixtures/README.md` that names the rows and the prefix offer. Pin in `build-demo-snapshot.test.ts`, over en and uk: `holds a store-number name for the Apply prefix offer`: `merchantNameOf(description).prefix` over the file's distinct names equals, by `toEqual`, the one store name. Regenerate both `.kiko` files on this tip (S22; task 1's regeneration is already in it), same commit. Run: `npx jest e2e/screenshot --maxWorkers=2`, output in a file. A failing existing pin that measures a demo total is reported with its seed before any edit. Commit `test(demo): store-number rows for the prefix offer`.
- [ ] **step 9/12 Review (kiko:reviewer).** Brief's top question: can any path write before the confirm?
- [ ] **step 10/12 Drift (kiko:retrospect).** Check: kiko-domain's rule text (Apply now has a prefix option), kiko-design-system only if the sheet entry names its buttons.
- [ ] **step 11/12 Scribe (kiko:scribe).** Fix the drift and commit; the report names the sha or "no drift found".
- [ ] **step 12/12 Ready.** Label `1.4-category-automation-task-2`.

---

## 1.4-category-automation task 3/6: name-contains and MCC conditions

**Needs:** task 1 (it edits `backfill-mcc-categories.ts` and `MccBackfillRow`). **Base:** task 2 tip.

**Files (floor). Mutable: 15.**
- Modify in `src/categories/category-rules/`: `category-rules.d.ts`, `matcher-key.ts`, `matcher-options.ts`, `parse-rule-matchers.ts`, `prepare-rules.ts`, `rule-subject.ts`, `validate-rule.ts`, `plan-rule-rewrite.ts` (`MccBackfillRow` becomes `RewriteCandidate`)
- Modify: `src/categories/category-rules-repo/category-rules.repo.ts`, `backfill-mcc-categories.ts`, `src/transactions/repo/transactions.repo.ts`, `src/screens/forms/category-rule-form/rule-draft/rule-draft.ts`, `rule-draft.types.d.ts`, `matcher-row/matcher-row.component.tsx`, `category-rule-form.screen.tsx`, `src/screens/forms/category-form/rule-summary/rule-summary.ts`, `src/screens/forms/transaction-form/category-rule/category-rule.ts` (via `subjectOfDraft`)
- Catalogue: `en.ts`, `uk.ts` (never in `make mutable`)
- Test data: `__fixtures__/rules-performance-fixture.ts` gains `mcc: index % 4 === 0 ? 5411 : null` with no draw from the generator (S14)

**Interfaces. Produces:**
```ts
| { type: 'nameContains'; text: string }
| { type: 'mcc'; code: number }
// RuleSubject and RewriteCandidate gain: mcc: number | null
```
`mcc` in `candidateColumns`, so the back-fill's own spread goes. `subjectOfDraft` gives `mcc: null`.

**Agents for steps 1-5.** The tree does not compile between steps 2 and 5, and `medium.sh` runs the typecheck at every `SubagentStop` and keeps blocking there (only a repeated `Stop` skips). So no agent hands over inside that stretch. One `kiko:qa` run writes step 1 and the test half of step 4 first: each new literal goes through one test-local `(raw: unknown) => raw as CategoryRuleMatcher` (a draft field the same way), so its tree compiles, red at runtime, and it commits them. Then one `kiko:developer` run does steps 2, 3, the code of 4, and 5, with no stop, and step 5's commit tidies the literals to typed ones. If it must hand over midway, the orchestrator resumes the same agent by SendMessage while its context is under about 150k, else starts a fresh one with the finished steps in its brief. **Warning:** a typecheck failure at that stop is that unfinished work, not a finding and not a sign the agent finished; never fix it with a stub or a loosened type.

- [ ] **step 1/10 (kiko:qa): parser and match pins.**
  - `parse-rule-matchers.test.ts`: `reads a nameContains matcher`; `refuses a blank nameContains`; `reads an mcc matcher at 0 and at 9999`; `refuses an mcc of 10000, -1, 1.5 and "5411"`; `drops an unknown field and keeps the known ones of a new type`; `makes the whole rule unreadable when one new matcher is bad`.
  - `prepare-rules.matrix.test.ts`: `nameContains matches inside a normalized name`; `nameContains matches across case and spacing`; `a blank name matches no nameContains`; `mcc matches its own code`; `mcc on a null value does not match`; `mcc does not match another code`.
  - `prepare-rules.priority.test.ts`: `a new condition counts one and two conditions beat one`; `a matcher written twice counts once`.
  - `validate-rule.test.ts`: `two mcc codes can never match` (conflict `other`); `one code written twice can match`; `an exact name without the contained text can never match`; `an exact name holding the contained text can match`; `a prefix with a contained text can match`.
  - `rule-subject.test.ts`: `a stored row carries its mcc` and `a draft carries none`.
  Red, named files; quote the output. Green at once, and they prove nothing until their positive twins go green, because today's parser refuses the new kind and `canEverMatch` ignores it: `refuses a blank nameContains`, `refuses an mcc of...`, `makes the whole rule unreadable...`, `a blank name matches no nameContains`, `mcc on a null value...`, `mcc does not match another code`, `one code written twice can match`, `an exact name holding...`, `a prefix with a contained text...`. Commit with the test half of step 4: `test(rules): pins for name-contains and merchant-code conditions`.

- [ ] **step 2/10 (kiko:developer): types, parser, match, validate.** Parser: `nameContains` beside `parseNameMatcher` (widen its union); `mcc`: `Number.isInteger(code) && code >= 0 && code <= 9999`. `withNormalizedText`, `keyOfMatcher`, `MATCHER_MATCHES` (`subject.mcc === code`; a null never equals a number, and the test above pins it), `MATCHER_TYPES`. `namesCanMatch`: the one exact name must contain every contained text. `mccsCanMatch`: distinct codes at most one. The compile errors list the rest (`draftOf`, `outcomeOf`, `describeMatcher`, `typeLabels`), which are steps 3-5. Steps 2-5 are one commit, at step 5.

- [ ] **step 3/10 (kiko:developer): feeds.** `isNameMatcher` adds `nameContains`; `rowIdsForNamedRule`'s name-only subject gains `mcc: null`; `candidateColumns` adds `mcc`; `planSourceRow`'s select (the one `giveSourceRowCategory` and `previewNameRule` read) adds `mcc`; `withCategoryRules`'s subject takes `input.mcc ?? null`; fixture line of S14; every test literal of `RuleSubject` or `RewriteCandidate` (5 suites at the floor: `git grep -l 'RuleSubject\|RewriteCandidate\|subjectOfStoredRow' -- src`). Pins in `category-rules.repo.test.ts`: `an mcc rule rewrites by the id-keyset page path`; `a nameContains rule uses the description narrowing`; `the source row is judged with its mcc`. In `src/transactions/repo/transactions.repo.category-rules.test.ts`: `an mcc rule wins a new synced row`; `a row with no code is left for the MCC fallback`. In `src/transactions/repo/transactions.repo.sync-adoption.test.ts`: `an mcc rule wins through the adoption path`. Run: `npx jest src/categories src/transactions/repo --maxWorkers=2`.

- [ ] **step 4/10 (kiko:qa then kiko:developer): form.** `rule-draft.test.ts`: `a four-digit code becomes a number`; `0042 stores as 42 and shows as 0042`; `three digits, five digits and letters give errorMcc`; `a contained text is trimmed and a blank one gives errorName`; `switching type keeps mccText`. `matcher-row.component.test.tsx`: `an mcc row shows a number-pad field limited to four digits`; `a nameContains row shows the name field`; `the type picker lists both new conditions`. Code: `MatcherDraft.mccText`; `emptyMatcherDraft`; `draftOf`; `outcomeOf`; `MatcherDraftError` gains `errorMcc`; `rowErrorMessage`; `typeLabels`. Run: `npx jest src/screens/forms/category-rule-form --maxWorkers=2`.

- [ ] **step 5/10 (kiko:developer): card, copy, help.** `describeMatcher`: `nameContains` uses `ruleForm.nameContains` and `categoryPage.quotedName`; `mcc` uses `ruleForm.mcc` and `String(code).padStart(4, '0')`. `rule-summary` test: `shows a contained name quoted`, `shows a code padded to four digits`. Keys of spec 3.4.4 for these kinds, in both catalogues in this step: `ruleForm.nameContains`, `ruleForm.mcc`, `ruleForm.errorMcc`. Help step 2 in both: en `...set a condition on the name, the amount, the time or the merchant code...`, uk `...задайте умову за назвою, сумою, часом чи кодом продавця...`. Run: `npx jest src/categories src/transactions/repo src/screens/forms/category-rule-form src/screens/forms/category-form src/i18n/locales src/help --maxWorkers=2`. Commit `feat(rules): name-contains and merchant-code conditions`.

- [ ] **step 6/10 (kiko:qa): performance pins.** S13, S14. In `category-rules.performance.test.ts`: a local `withNewKinds = prepareRules([...rules, ...ownRules])`, with 20 `nameContains` and 20 `mcc` rules: `picks the same winner as a scan of every rule, for every row of the batch, with the new kinds`; `never evaluates more than the rules without a name plus the one named bucket, with the new kinds`. In `transactions.repo.category-rules.performance.test.ts`: `updates exactly the planned rows of an mcc rule, a page at a time`; `updates exactly the planned rows of a nameContains rule with no page of the ledger`. The existing shape pin is unchanged. Commit `test(rules): performance pins for the new conditions`.

- [ ] **step 7/10 Review (kiko:reviewer).** Top question: does any feed still build a subject without `mcc`, and can any path widen a rule?
- [ ] **step 8/10 Drift (kiko:retrospect).** Check: kiko-domain's rule list and matcher kinds.
- [ ] **step 9/10 Scribe (kiko:scribe).** Fix the drift and commit; the report names the sha or "no drift found".
- [ ] **step 10/10 Ready.** Label `1.4-category-automation-task-3`.

---

## 1.4-category-automation task 4/6: account and IBAN conditions

**Needs:** task 3. **Base:** task 3 tip.

**Files (floor). Mutable: 18.**
- Create: `src/transactions/iban/iban.ts`, `index.ts`
- Modify in `src/categories/category-rules/`: `category-rules.d.ts`, `matcher-key.ts`, `matcher-options.ts`, `parse-rule-matchers.ts`, `prepare-rules.ts`, `rule-subject.ts`, `validate-rule.ts`
- Modify: `category-rules.repo.ts`, `transactions.repo.ts`, `src/statement-import/column-mapping/apply-column-mapping.ts`, `rule-draft.ts`, `rule-draft.types.d.ts`, `matcher-row.component.tsx`, `matcher-row.props.d.ts`, `category-rule-form.screen.tsx`, `rule-summary.ts`, `category-form.screen.tsx`, `category-rule.ts`, `use-category-pick.ts`, `transaction-form.screen.tsx` (hands the picked holding's account to the hook)
- Catalogue: `en.ts`, `uk.ts`. Fixture: `counterIban` and `accountId` derived from the index, no draw.

**Interfaces. Produces:**
```ts
| { type: 'account'; accountId: string }
| { type: 'counterIban'; iban: string }
// RuleSubject, RewriteCandidate gain: counterIban: string | null; accountId: string | null
// CategoryDraft gains: accountId: string | null
// @kiko/transactions/iban
export const IBAN_PATTERN: RegExp;
export const ibanKeyOf: (iban: string) => string; // no spaces, uppercase
// ruleRows options gain: accountNameOf: (accountId: string) => string | null
// toMatcherDrafts gains: liveAccountIds: ReadonlySet<string>
```

**Agents for steps 1-5.** As in task 3, with the same warning: one `kiko:qa` run writes steps 1 and 4 and commits them with the cast literals; one `kiko:developer` run does steps 2, 3 and 5 with no stop, and step 5's commit tidies the literals.

- [ ] **step 1/11 (kiko:qa): parser, match, validate pins.** Parser: `reads an account matcher`; `refuses an empty account id`; `reads an IBAN typed with spaces in lower case`; `refuses a malformed IBAN`; `a fixture IBAN with a bad checksum still reads`. Matrix: `account matches its own id`; `account on a row with no holding does not match`; `counterIban matches across case and spacing`; `counterIban on a null value does not match`; `every new kind on a missing value does not match` as one `it.each` over all four (blank name, null `mcc`, null account, null IBAN). Priority: `each new condition counts one`. Validate: `two accounts can never match`, `two IBANs can never match`, `one IBAN in two spellings can match`, `matcherSetKey treats two spellings of one IBAN as one`. Iban: `src/transactions/iban/iban.test.ts`, reading the missing module by a runtime lookup. Red, named files; quote the output. Green at once, and they prove nothing until their positive twins go green: `refuses an empty account id`, `refuses a malformed IBAN`, `account on a row with no holding does not match`, `counterIban on a null value does not match`, `every new kind on a missing value does not match`, `one IBAN in two spellings can match`. Commit with step 4: `test(rules): pins for account and counterparty IBAN conditions`.

- [ ] **step 2/11 (kiko:developer): types through validate.** Move `IBAN_PATTERN` out of `apply-column-mapping.ts`, which imports it. Same exhaustive sweep as task 3 step 2.

- [ ] **step 3/11 (kiko:developer): feeds, with pins.** `candidateColumns` adds `counterIban` and `accountId: holdings.accountId`; `planSourceRow`'s select the same; `withCategoryRules`'s holdings read adds `accountId` (`accountIdById`), subject takes `input.counterIban ?? null`, `accountIdById.get(input.holdingId) ?? null`; `rowIdsForNamedRule`'s subject adds nulls; `subjectOfStoredRow` applies `ibanKeyOf` to a non-null value; `subjectOfDraft` gives `counterIban: null` and the draft's `accountId`; `CategoryDraft.accountId` from the picked holding, passed by `use-category-pick.ts`. Pins: `an account rule pre-selects a draft on its holding's account`; `an IBAN rule never pre-selects a draft`; `src/categories/category-rules-repo/category-rules.repo.test.ts`: `an account rule wins through a real join`; `an IBAN rule wins a synced transfer`; `a deleted holding's row matches no account rule`; `the source row is judged with its account and IBAN`; `src/transactions/repo/transactions.repo.sync-adoption.test.ts`: `an account rule wins through the adoption path`.

- [ ] **step 4/11 (kiko:qa): form and card pins.** `rule-draft.test.ts`: `no account picked gives errorAccount`; `an id no longer listed seeds as none`; `a live id seeds as itself`; `a typed IBAN is stored normalized`; `a bad IBAN gives errorIban`. Screen test: `keeps a live account id when the accounts read lands after the rules read` (Review Focus 2; at step 5 the developer deletes the `useDataReady` input and shows it red); `a rule on a deleted account asks for a pick on Save`. `matcher-row` test: `lists the accounts by accountDisplayName, the implicit ones translated`; `leaves an archived account out unless it is the row's own`. `rule-summary.test`: `shows the live account name`; `shows Deleted account for an id in no row`; `shows the IBAN in full`.

- [ ] **step 5/11 (kiko:developer): form and card.** `MatcherDraft` gains `accountId: string | null`, `ibanText`; `MatcherRowProps` gains `accounts: readonly { id: string; label: string }[]`. S19. `SelectField<string>` for the account, with `labels`. IBAN `TextField` `autoCapitalize="characters"`. The screen reads `accountsRepo.listQuery()` uncached and adds it to `useDataReady` before the seed runs. `category-form.screen.tsx` reads accounts for `ruleLinesOf`'s `accountNameOf`. Keys of spec 3.4.4 for these kinds, in both catalogues in this step: `ruleForm.account`, `ruleForm.counterIban`, `ruleForm.errorAccount`, `ruleForm.errorIban`, `categoryPage.deletedAccount`, and the sheet title and placeholder the picker needs. Help step 2 in both: en `...the name, the amount, the time, the merchant code, the account or the counterparty IBAN...`, uk `...за назвою, сумою, часом, кодом продавця, рахунком чи IBAN контрагента...`. Run: `npx jest src/categories src/transactions src/statement-import/column-mapping src/screens/forms/category-rule-form src/screens/forms/category-form src/screens/forms/transaction-form src/i18n/locales src/help --maxWorkers=2`. Commit `feat(rules): account and counterparty IBAN conditions`.

- [ ] **step 6/11 (kiko:qa): account gone and restore.** `src/accounts/accounts.repo.test.ts`: `removing an account leaves its rule, and the rule matches nothing`; `src/monobank/disconnect/disconnect.test.ts`: `a disconnect keeps the rule matching, and a reconnect re-adopts it`. `src/data-transfer/snapshot/restore-account-matcher.test.ts`: `restoring a file keeps an account matcher's id and it matches`; `withImplicitAccountsMerged keeps the id of a rule on a property account in a current file`; `a rule on an id in no row reads as Deleted account and never matches`. Commit `test(rules): a rule on a deleted or restored account`.

- [ ] **step 7/11 (kiko:qa): the two-path older-build restore, on raw JSON.** Raw JSON literals, one for each of `nameContains`, `mcc`, `account`, `counterIban`, plus one mix `[{ nameIs "ATB" }, { mcc 5411 }]`, at the top of the test file. No copy of a 1.3 source file goes in; spec 3.4.5 records what 1.3's parser does, read with `git show`.
  - `src/data-transfer/snapshot/restore-new-matchers.two-path.test.ts`, real SQLite, real `readDataSnapshot`, `restoreDataSnapshot`:
    Path 1, the raw JSON round trip (`EXPORT_VERSION` 5): `restores a %s rule's JSON byte for byte`; `restores every row with its category and rewrites none`.
    Path 2, a 1.3 export back into 1.4: `the same bytes read again in this build`; `the rule wins a new row after the restore`; `a mix reads again whole`; `a row the rule would win keeps its category until the user applies`.
  - `src/data-transfer/crypto/envelope.test.ts` unchanged by this task: `version` 5. State it in the commit.
  Run: named files. Red proof: in a scratch edit of the parser change `matchers.every(isMatcher) ? matchers : null` into a filter of the readable matchers and show task 3's `makes the whole rule unreadable when one new matcher is bad` red. Commit `test(restore): new matchers survive a round trip through release 1.3`.

- [ ] **step 8/11 Review (kiko:reviewer).** Top question: can a rule on a missing account or a null IBAN ever match, and does any path drop a condition?
- [ ] **step 9/11 Drift (kiko:retrospect).** Check: kiko-domain's matcher kinds and the deleted-account state; kiko-architecture's restore section if it lists rule shapes.
- [ ] **step 10/11 Scribe (kiko:scribe).** Fix the drift and commit; the report names the sha or "no drift found".
- [ ] **step 11/11 Ready.** Label `1.4-category-automation-task-4`.

---

## 1.4-category-automation task 5/6: review list

**Needs:** tasks 1 and 2. **Base:** task 4 tip.

**Files (floor). Mutable: 9.**
- Create: `src/categories/category-rules/plan-review-groups.ts`; `src/screens/settings/category-review/category-review.screen.tsx`, `category-review.styles.ts`, `index.ts`; `review-line/review-line.component.tsx`, `review-line.props.d.ts`, `index.ts`; `category-options-sheet/category-options-sheet.component.tsx`, `category-options-sheet.props.d.ts`, `index.ts` (one component per file); `use-review-actions/use-review-actions.ts`, `index.ts`
- Modify: `src/categories/category-rules/index.ts`, `category-rules.repo.ts`, `src/screens/settings/categories/categories.screen.tsx`, `src/navigation/settings-stack/settings.stack.tsx`, `src/navigation/types/types.d.ts`, `src/help/help-topics.ts`, `en.ts`, `uk.ts`
- Data: `title-keys.ts`. Test-only: `e2e/screenshot/fixtures/build-demo-snapshot.test.ts`

**Interfaces. Consumes:** `hasNoRealCategory`, `noRealCategorySql`, `merchantNameOf`, `merchantSpellingOf`, `tidiedNameOf`, `smallestSpelling`, `NameRuleKind`, `previewNameRule`, `applyNameRule`, `ruleMoveMessage`.

**Produces:**
```ts
// @kiko/categories/category-rules
export type ReviewGroup = {
  key: string;
  names: readonly string[]; // one per normalized name, full tidied spelling, most rows first (S1)
  rowCount: number;
  newestTime: number;
  rule: { kind: NameRuleKind; text: string }; // text per kind: S1
};
export const planReviewGroups: (prepared: PreparedRules, rows: readonly RewriteCandidate[], knownCategoryKeys: ReadonlySet<string>) => ReviewGroup[];
// categoryRulesRepo
reviewCandidateRowsQuery: () => /* Drizzle builder */;
// SettingsStackParamList
CategoryReview: undefined;
```

**Copy (drafts):**

| Key | en | uk |
|---|---|---|
| `categoryReview.title` (title key) | `Sort Uncategorized` | `Розподіл без категорії` |
| `categoryReview.entryLabel` | `Sort transactions without a category` | `Розподілити транзакції без категорії` |
| `categoryReview.startsWith` | `Starts with "{{name}}"` | `Починається з «{{name}}»` |
| `categoryReview.nameCount_*` | `{{count}} names` | `{{count}} назва / назви / назв` |
| `categoryReview.rowCount_*` | `{{count}} transactions` | `{{count}} транзакція / транзакції / транзакцій` |
| `categoryReview.choose` | `Choose category` | `Вибрати категорію` |
| `categoryReview.optionsTitle` (title key) | `Choose Category` | `Вибір категорії` |
| `categoryReview.emptyTitle` | `Nothing to sort` | `Немає що розподіляти` |
| `categoryReview.emptyMessage` | `Transactions without a category appear here, grouped by name. Pick a category once, and Kiko adds a rule for it.` | `Тут зʼявляться транзакції без категорії, згруповані за назвою. Виберіть категорію один раз, і Кіко додасть для неї правило.` |
| `help.topics.categoryRules.steps.6` | `To sort what has no category yet, open "Categories", tap "Sort transactions without a category" and pick a category for a name.` | `Щоб розподілити транзакції без категорії, відкрийте «Категорії», натисніть «Розподілити транзакції без категорії» й виберіть категорію для назви.` |

The confirm reuses `categoryRulePreview.*` from task 2.

- [ ] **step 1/13 (kiko:qa): group pins.** Create `plan-review-groups.test.ts`:
  - Keeps and drops: `keeps NULL, empty, other and orphan rows`; `drops a hand-set row`; `drops a balance-setting and a split-change row`; `drops a row a rule wins`; `drops a row in other won by a rule that targets another category` (a rule saved as "New transactions only", spec 3.0: accepted, it never appears and nothing writes it); `drops an exchange leg by either marker`; `drops a blank description` (`''` and spaces); `drops a real category`.
  - Grouping: `groups ATB, ATB 0212 and atb 0340 under one key`; `keeps АТБ and ATB apart`; `treats ATB 0212 and atb  0212 as one name` (S2).
  - Names and rule text (S1), each by `toEqual` on `names` and `rule`: `offers nameIs on the full name for one distinct name`: `ATB 0212`, `atb  0212` -> `['ATB 0212']`, `{ kind: 'nameIs', text: 'ATB 0212' }`; `offers nameStartsWith on the prefix and lists the names in full`: `ATB 0212`, `ATB 0340` -> `['ATB 0212', 'ATB 0340']`, `{ kind: 'nameStartsWith', text: 'ATB' }`; `spells the same whatever the row order`: `atb 0340` and `ATB 0340` in both orders.
  - Order: `sorts by row count, then newest time, then key`; `is the same for shuffled rows` (three shuffles).
  - `every listed row matches its group's own rule`: property via `sweep` on rows built from spec section 4 samples and generated names: `matchesRule` on a rule built from `group.rule` is true for every row in the group (add the site to `property-sweep-sites.test.ts`).
  Commit `test(rules): pins for planReviewGroups`.

- [ ] **step 2/13 (kiko:developer): the plan.** `plan-review-groups.ts`. Memoize `merchantNameOf` per distinct description in a local `Map` (fixture: 2,000 descriptions over 50,000 rows). Order the cheap field checks before `winningRule`. Green: `npx jest src/categories/category-rules/plan-review-groups.test.ts --maxWorkers=2`. Commit `feat(rules): planReviewGroups`.

- [ ] **step 3/13 (kiko:qa): count against rows, on one fixture.** Create `src/categories/category-rules-repo/category-review.repo.test.ts`, real SQLite, one seeded world: 12 rows `ATB 0212` in `other`; 3 rows `ATB 0212` MCC-sorted into `groceries`; `ATB Market`, `ATBANK` in `shopping`; one hand-set `ATB 0340`; one balance row; `Silpo 12` x4 in `other` and nothing else with that prefix.
  - `listed rows are a subset of planned rows`: ids from `planReviewGroups` over `reviewCandidateRowsQuery`, ids changed by `applyNameRule`; the world above.
  - `the preview count equals the rows the write changes`: compare the before and after category per id on one fixture, for `nameIs` and for `nameStartsWith`.
  - `planned equals listed when no other row carries the name`: `Silpo`, so `rowCount === count`.
  - `a listed count below the preview means a confirm`: `count > rowCount`.
  - `every listed row moves whatever it holds`: NULL, `''`, `other` and an orphan key, picked to `groceries`: `count === rowCount`.
  - `a one-name store-number group previews its own rows`: `group.rule` of a group of only `ATB 0212` previews a count equal to its `rowCount`, not 0.
  - `a hand-set row is not listed, not counted and not written`.
  - `the plan is redone inside the write`: a row added between the preview and the write gets the category, and `applyNameRule` returns the new count.
  - Reminder trap (spec 5.3), `src/reminders/repo/reminders.repo.test.ts`: `a manual row with a name and no category becomes an entry only inside its created-at window when a tap gives it a category`: seed the row; `manualEntryDaysQuery` before; `applyNameRule`; after, for a `since` before and after the row's `createdAt`.
    Measure and quote in the report: `git grep -n "source: 'manual'" -- src` (writers at the time of writing: `recordManualTransaction`, whose form path requires a category for income and expense; exchange and change rows carry a marker; `holdings.repo`, `accounts.repo` balance rows are `setsBalance` with `''`). If a live writer under `src/` of a manual, named, unmarked NULL row is found, stop and report it. The demo is no such writer and does not stop this: its 24 rows (Salary 6, Crypto purchase 6, Account top-up 4, Jar top-up 3, BTC purchase 2, ATM cash withdrawal 1, Freelance project 1, Brokerage account top-up 1) are the accepted case of spec 5.3.
  - Performance, S13, in `transactions.repo.category-rules.performance.test.ts`, on the 50,000-row fixture: `plans the review list from one candidate read`; `planReviewGroups keeps only what the brute-force filter keeps`; `calls merchantNameOf once per distinct description` (wrapped via `jest.mock` with a `jest.requireActual` call with no type argument); `reviewCandidateRowsQuery scans the table with no temp B-tree`: `EXPLAIN QUERY PLAN` from the repo's builder, asserted. A pin that fails its bound leads to a partial index in its own migration, its `EXPLAIN` test and a `kiko:reviewer` step, never a weaker bound (spec 3.2.3): report before building that.
  - `reviewCandidateRowsQuery keeps a blank name out through the parentheses of noRealCategorySql`: `toSQL().sql` holds the arms in one `( ... )`, and a row in `other` with description `''` is not returned (the unwrapped SQL returns it; a NULL-category row would not tell them apart).
  - Demo, S22, in `e2e/screenshot/fixtures/build-demo-snapshot.test.ts`, over en and uk: `the review list offers a starts-with line on the store-number rows`: `planReviewGroups` over the snapshot's rows (the row mapping of `build-demo-snapshot.rule-demo.test.ts`), the group's `names` and `rule` by `toEqual`; `leaves the rule demo's merchants in their own lines`.
  Commit `test(rules): review list count, write and cost pins`.

- [ ] **step 4/13 (kiko:developer): the read.** `reviewCandidateRowsQuery`: `candidateColumns`, `inner join holdings`, `ne(description, '') AND noRealCategorySql`. Green: named files. Hand-time it on the fixture and quote it for the report. Commit `feat(rules): review candidate read`.

- [ ] **step 5/13 (kiko:qa): screen pins.** `category-review.screen.test.tsx`, real router not needed; `useLiveQuery` mock answers per query; a loading-gate test deletes the gate and shows red:
  - `shows the loading state while any read is on its first load` and `never the empty state then`.
  - `shows the empty state with no data` (2.5.19), its title and message from `i18n.t`, positive twin; `shows the empty state when nothing is left`.
  - `shows one line per group with its counts`; `reads Starts with for a prefix group`.
  - `writes at once when the preview equals the row count`, `applyNameRule` called with `{ name, kind, category, sourceTransactionId: null }`.
  - `opens the confirm with the names when the preview is larger`, and `writes only on its confirm`; `cancel writes nothing`; `shows five names and and M more`.
  - `opens the confirm only after the options sheet has closed` (Review Focus 1): fires `onClosed`.
  - `leaves other out of the options`, positive twin `lists the other categories of the live table`.
  - `a line left alone stays, with no badge or count about it`.
  - `reads the title of a seeded category through resolveDefaultCategoryTitle`.
  - `pauses its reads while it is not visible`: the options object holds `paused: true`, never `cached`.
  - `blocks a second tap while a write runs`; `shows an alert and leaves the line when the write fails`.
  `categories.screen.test.tsx`: `shows the entry row above the grid and opens CategoryReview`; `shows it with no transactions`. `settings.stack.test.tsx`: `registers the review screen with its localized title`. Commit `test(settings): pins for the review screen`.

- [ ] **step 6/13 (kiko:developer): copy.** All keys above in `en.ts`, `uk.ts`, `title-keys.ts`; the step 6 path in `help-topics.ts`. Run: `npx jest src/i18n/locales src/help --maxWorkers=2`. A help step's quoted labels are real catalogue strings shown on a screen (`help-topics.test.ts`); that holds once step 7 lands, so commit steps 6-7 in order and rerun there. Commit `feat(i18n): copy for the review list`.

- [ ] **step 7/13 (kiko:developer): route and entry.** `CategoryReview: undefined` in `SettingsStackParamList`; a `Stack.Screen` with `options={{ title: t('categoryReview.title') }}` next to `Categories`. `categories.screen.tsx`: above `Sortable.Grid`, one `SettingsRow` (`@kiko/screens/settings/settings-row`, same screen folder) in a `Card`, `icon` from an existing symbol checked in `sf-symbol` availability, `onPress` navigates, spaced by `Box gap`. No condition on it. Commit `feat(settings): review entry on the Categories screen`.

- [ ] **step 8/13 (kiko:developer): screen.** S10, S11, S12. Reads, all `paused: !useIsScreenVisible()`, never `cached`: `reviewCandidateRowsQuery` on `['transactions', 'category_rules', 'categories']`, `categoryRulesRepo.allQuery()`, `categoriesRepo.allQuery()`. Gate: `useDataReady`. `useMemo` over `prepareRules` and `planReviewGroups`. `useReviewActions` holds `pickFor: ReviewGroup | null`, `pendingConfirm`, and one `useSubmitOnce`: `pick(group, category)` closes the sheet; the sheet's `onClosed` runs `previewNameRule` (`sourceTransactionId: null`, as its `applyNameRule` call passes); `previewCount === group.rowCount` writes, else `ConfirmSheet` with `ruleMoveMessage`; write failure shows `common` save alert (the transaction form's `showSaveErrorAlert` shape). `ReviewLine`: `Card`, `Text variant="body"` for the name or `startsWith`, `Text variant="caption" tone="textSecondary"` for `nameCount · rowCount`, `Button variant="secondary" size="small" fullWidth={false}` choose. The options sheet lists the live categories without `other` (S7). Styles via `StyleSheet.create((theme) => ...)` with tokens only; screen and sheet comply with kiko-design-system's "Sheet" and large-title rules. Green: `npx jest src/screens/settings src/navigation/settings-stack --maxWorkers=2`. Commit `feat(settings): review list screen`.

- [ ] **step 9/13 (kiko:developer): help.** Rerun `npx jest src/help src/i18n/locales --maxWorkers=2`; project-wide `npm run check:screen-imports`, `check:import-order`, `check:component-i18n-namespace`.
- [ ] **step 10/13 Review (kiko:reviewer).** Top question: can the UI promise a count the write does not honor? UI changes need the user's device confirm: list what to look at (the entry row above the grid with a drag; the options sheet then the confirm; a split window; VoiceOver on a line's button).
- [ ] **step 11/13 Drift (kiko:retrospect).** Check: kiko-design-system (no shared component changed, confirm), kiko-domain (review list), kiko-compliance (the Notes for Review text duty, spec section 7).
- [ ] **step 12/13 Scribe (kiko:scribe).** Fix the drift and commit; the report names the sha or "no drift found".
- [ ] **step 13/13 Ready.** Label `1.4-category-automation-task-5`.

---

## 1.4-category-automation task 6/6: suggestions

**Needs:** task 5. **Base:** task 5 tip.

**Files (floor). Mutable: 4.** `src/categories/category-rules/plan-review-groups.ts`, `category-rules.repo.ts`, `category-review.screen.tsx`, `review-line.component.tsx`. Not mutable: `en.ts`, `uk.ts`; types `review-line.props.d.ts`; `e2e/screenshot/seed/screenshot-seed.ts`, `demo-text.ts`, `e2e/screenshot/fixtures/build-demo-snapshot.test.ts`, regenerated demo `.kiko` files.

**Interfaces. Produces:**
```ts
export const SUGGESTION_MIN_AGREEING_ROWS = 2;
export const SUGGESTION_MIN_SHARE = 0.75;
export type ReviewEvidence = { description: string; categoryKey: string; rowCount: number };
export type ReviewSuggestion = { category: string; agreeing: number; total: number };
// ReviewGroup gains: suggestion: ReviewSuggestion | null
// planReviewGroups gains a parameter: evidence: readonly ReviewEvidence[]
// categoryRulesRepo
reviewEvidenceQuery: () => /* Drizzle builder */;
```

**Copy (draft):** `categoryReview.suggestion`: en `{{category}}, {{agreeing}} of {{total}}`, uk `{{category}}, {{agreeing}} із {{total}}`. The `{{agreeing}}` is no plural, so it is not named `count`.

- [ ] **step 1/10 (kiko:qa): vote pins.** In `plan-review-groups.test.ts`, `describe('suggestions')`:
  - Thresholds, `it.each`, on the limit: 1 of 1 none; 2 of 2 yes; 2 of 3 none; 3 of 4 yes (exactly 0.75, asserted first); 4 of 5 yes; 3 of 5 none.
  - `a hand-set, a rule-set and an MCC-set row each vote one`.
  - `a row with no real category has no vote`, also a hand-set row in `other` and a row a rule targeting `other` wins (S18).
  - `never suggests other`; `never suggests a key not in the table`; `a structural or exchange row has no vote`.
  - `a PrivatBank row with no code gets the suggestion from the same merchant's Monobank rows`: names `ATB 0212` and `ATB`.
  - `counts votes under the merchant key, so another store number agrees`.
  - `is the same for shuffled rows and shuffled evidence`.
  - `keeps the line's order whatever the suggestions`.
  Real SQLite in `category-review.repo.test.ts`: `reviewEvidenceQuery reads real categories grouped by description and key`; `reads no balance, split, exchange or blank row`; `NOT noRealCategorySql negates the whole fragment` (`toSQL().sql` holds `not (` around the three arms; a row in `other`, a NULL row and an orphan row stay out, a real row comes back); `accepting a suggestion writes through applyNameRule and the count matches`. Performance file: `reviewEvidenceQuery scans with a temp B-tree for the group, and returns one row per pair`, via `EXPLAIN QUERY PLAN` from the builder. Commit `test(rules): pins for the suggestion vote`.

- [ ] **step 2/10 (kiko:developer): the vote.** S17, S18. `reviewEvidenceQuery`: `description`, `lower(category)`, `count(*)`; `ne(description, '') AND category IS NOT NULL AND NOT noRealCategorySql` (S5: the fragment's own parentheses), `setsBalance` false, `changeGroupId IS NULL`, both exchange markers `IS NULL`; group by the first two. `merchantNameOf` memo shared with the grouping. A share is compared as `agreeing / total >= SUGGESTION_MIN_SHARE`. Pure, no clock. Green: named files. Commit `feat(rules): suggestions from the user's history`.

- [ ] **step 3/10 (kiko:qa): chip pins.** Screen test: `shows the chip with the category's title and count`; `shows no chip when there is no suggestion`, positive twin; `nothing changes until the chip is tapped`; `a tap runs the same preview and write as a pick`; `a tap with a larger preview opens the confirm`; `picking another category resolves the line by a rule`; `the evidence read is paused and uncached with the others`. Commit `test(settings): pins for the suggestion chip`.

- [ ] **step 4/10 (kiko:developer): chip and copy.** S12: `Button variant="secondaryTonal" size="small" fullWidth={false}` with the category's `icon` as an existing symbol; the seeded title through `resolveDefaultCategoryTitle`. Key in both catalogues in this step. `useLiveQuery(reviewEvidenceQuery(), ['transactions', 'category_rules', 'categories'], true, { paused })`, added to `useDataReady`. Green: `npx jest src/screens/settings src/categories src/i18n/locales --maxWorkers=2`. Commit `feat(settings): suggestion chip on a review line`.

- [ ] **step 5/10 (kiko:developer): a suggestion in the demo.** S22. `buildSuggestionTransactions` beside `buildStoreNumberTransactions` in `screenshot-seed.ts`, and its key in both languages of `demo-text.ts` (draft: en `Aroma Kava`, uk `Арома Кава`; a merchant in no stored demo rule, not the rule demo's, not in the kit's fake statement): 3 rows in `dining`, 1 row in `other`, same name, inside the default 30-day window but not the newest rows. Re-measure the "rows" sentence of step 8 in task 2. Pin in `build-demo-snapshot.test.ts`, over en and uk: `the review list shows a suggestion on a line`: `planReviewGroups` over the snapshot's rows and evidence: that group's `suggestion` by `toEqual` `{ category: 'dining', agreeing: 3, total: 3 }`, and the store-number group's `suggestion` is null. Regenerate both `.kiko` files on this tip (S22), same commit. Run: `npx jest e2e/screenshot --maxWorkers=2`, output in a file. Commit `test(demo): a merchant the suggestion chip can name`.
- [ ] **step 6/10 (kiko:developer): check of the whole track's copy.** `npx jest src/i18n/locales src/help --maxWorkers=2`; the en and uk parity suite is the pin; quote its result.
- [ ] **step 7/10 Review (kiko:reviewer).** Top question: is a suggestion ever written without a tap, and is the vote deterministic?
- [ ] **step 8/10 Drift (kiko:retrospect).** Check: kiko-domain (suggestion rule and thresholds).
- [ ] **step 9/10 Scribe (kiko:scribe).** Fix the drift and commit; the report names the sha or "no drift found".
- [ ] **step 10/10 Ready.** Label `1.4-category-automation-task-6`.

---

## Mutable file counts (floors, each task's file list through `mutable_source_files`; `make mutable` measures; the cap is 30)

| Task | Mutable | Steps |
|---|---|---|
| 1/6 | 10 | 17 |
| 2/6 | 7 | 12 |
| 3/6 | 15 | 10 |
| 4/6 | 18 | 11 |
| 5/6 | 9 | 13 |
| 6/6 | 4 | 10 |

## Not in the tasks

- What's New line and Notes for Review text (spec 3.1.4, 7): release-time copy through the `release` skill and kiko-translator. The coordinator carries them.
- Mutation gate: paused by the user. Device check: the user's, listed in task 1's report (the Travel tile) and task 5's review report.
- App Store screenshots of the Categories grid pick up the twelfth tile at the next refresh.
