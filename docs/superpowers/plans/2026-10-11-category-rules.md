# Category Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Categories get many rules (one or more AND-ed matchers: name is, name starts with, amount with currency, direction, time of day). Rules run on every synced or imported row and as a pre-select in the manual form. Saving a rule can rewrite existing rows, and a manual-pick flag protects categories the user chose by hand.

**Architecture:** A pure module `src/categories/category-rules/` (guard, priority, evaluation, rewrite plan, editor validation) is the one source of truth. Migration 0058 replaces `category_overrides` with `category_rules` (converted rows) and adds `transactions.category_set_by_hand`. `categoryRulesRepo` owns the rule writes and the rewrite. The insert path (`withCategoryRules`), the export (v3), the screens and the form all call the pure module.

**Tech Stack:** RN 0.87 / Hermes, op-sqlite + Drizzle (drizzle-kit `driver: 'expo'`), `node:sqlite` in Jest (`@kiko/test-support/real-sqlite`), fnts, ts-pattern, i18next, react-native-sortables, Jest/RNTL.

**Spec:** `docs/superpowers/specs/2026-10-11-category-rules-design.md` (APPROVED 2026-10-11; rulings 1-9 and decisions 1-16 are binding). Read it with this plan. Section numbers below (§N) and row ids (M1-M28, P1-P22) refer to it.

## Global Constraints

- Rules never touch a row with `category_set_by_hand = 1`. Existing rows get 0 (ruling 6).
- Priority: distinct matcher count DESC (repeats counted once), then `updated_at` DESC, `created_at` DESC, `id` DESC (decisions 1, 2). The first match wins.
- Amount matcher: ABSOLUTE minor units, integer compare, same currency only. Zero amount: no direction (decision 7).
- Time matcher: `getHours() * 60 + getMinutes()` of `new Date(time)` (device zone). `before X` = minute < X; `after X` = minute >= X.
- Names: always `normalizeTransactionName` in JS, never SQL. `text` is stored as typed (trimmed).
- A row a rule no longer wins is never reverted (decision 3). A deleted rule changes no row (P15).
- The rewrite skips exchange legs (`exchange_pair_id` or `exchange_counterpart_holding_id` not null), `sets_balance = 1` rows and split-change rows (`change_group_id` not null) (decision 5).
- Every write in one `write()`. `IN (...)` lists chunked by `IN_CLAUSE_CHUNK_SIZE` (32 000). Inserts chunked by `chunkForTable`.
- Code style: fnts first, ts-pattern for closed unions, full-word identifiers, folder-per-unit with `index.ts`, `@kiko/<feature>` barrels, type-only files `.d.ts`, comments WHY only (no task or decision ids in comments: `kiko-no-history-id-comment`), comments wrap at 100 columns.
- Strings en + uk for every new key (kiko-translator; uk uses `’`). Sentence case, Title Case for screen and sheet titles. The user reviews the key table at each BATCH READY that ships keys.
- Guideline 5.6: no flag; every screen ships visible.
- No new dependency.
- Tests: TDD. Each scenario-matrix row is a test written first and shown red. Jest TZ is pinned to `Europe/Kyiv` in `jest.config.js` (never set `process.env.TZ` in a test). DST days: fall-back 2026-10-25, spring-forward 2027-03-28.
- No wall-clock assertion in a committed test (memory: wall-clock speed guards fail under Stryker). Speed guards count work. Timings are measured and recorded in the run log (see "Performance" below).
- BATTERY MODE: no `make verify`, full jest, Stryker, `npm ci`, build or simulator. Narrow `npx jest <path>` runs are allowed only when the coordinator lifts battery mode.

## Review Focus

1. An OLD backup (v1/v2) whose override has a blank or whitespace `display_name`: the restore still succeeds, and the result equals what migration 0058 makes from the same row (a stored rule that fails the guard and shows as unreadable). Pinned in category-rules task 2/6 step 7 (two-path test case "blank display name").
2. A rule that can never match on its own or in combination beyond decision 8's list: `before 00:00`, `amount < 0`, `amount = 0` with a direction, two different `nameIs` texts, a `nameIs` that does not start with the rule's `nameStartsWith`. The editor refuses it as "never matches". Pinned in task 1/6 (`validate-rule.test.ts`).
3. A name typed in NFD (decomposed "Café") against a rule typed in NFC ("Café"): match. Pinned in task 1/6 (matrix row M24b).
4. A sync batch row whose holding currency read returns nothing (holding missing): name and direction rules still apply, amount rules do not, nothing throws. Pinned in task 2/6 step 5.
5. The rule editor amount field with more decimals than the currency scale (500.123 UAH, 0.000000001 BTC): refused inline (`errorAmount`), never rounded. Pinned in task 5/6 step 3 (`rule-draft.test.ts`).

## Migration index (read before task 2/6)

- The runner (`src/db/run-migrations.ts`) applies `journal.entries.slice(COUNT(*))` in journal ORDER and resolves each entry's SQL by `idx`. Indexes are a namespace shared by every branch (memory migration-idx-shared-namespace).
- Reserved: 0056 binance-pay-history, 0057 transaction-templates, 0058 this track.
- Merge rule (all tracks): the FIRST branch whose migration reaches `next` keeps the next free number. Every LATER branch merges `next` in and REGENERATES its migration on top of `next`'s journal before its merge. Two branches generated from the same snapshot share a `prevId`, and the next `drizzle-kit generate` re-adds the other branch's columns: "duplicate column name" on every device at launch.
- Task 2/6 therefore generates its migration (0058 or the next free idx) on top of whatever is in `next` at its merge (binance-pay-history's 0056 and/or transaction-templates' migration), never from a snapshot that lacks them. Steps: merge `next` into the branch; delete this track's generated artifacts (SQL, snapshot, journal entry, `migrations.js` entry); run `npx drizzle-kit generate --name add_category_rules`; re-apply the hand edits to the SQL (the header comment, the INSERT ... SELECT conversion); rename the test file and its references; update `envelope.test.ts` `migrationCount`.
- Proof in the task's report and BATCH READY: `npx drizzle-kit check` passes, and a second `npx drizzle-kit generate` produces no new migration (no-op).
- Files that change on renumber: `drizzle/migrations/NNNN_add_category_rules.sql`, `drizzle/migrations/meta/NNNN_snapshot.json` (its `prevId` = the newest snapshot id on `next`), `drizzle/migrations/meta/_journal.json` (entry `idx`, `tag`, last), `drizzle/migrations/migrations.js` (import + `mNNNN` key), `drizzle/migrations/NNNN-add-category-rules.test.ts` (file name, the SQL file name, the "through" tag), and `src/data-transfer/crypto/envelope.test.ts` (`migrationCount`). Never hand-edit `prevId`; regenerate.

## Performance (spec §11)

- Fixture: `src/categories/category-rules/__fixtures__/rules-performance-fixture.ts` (task 1/6). Deterministic (seeded PRNG, no `Math.random`): 50 000 transactions over 20 holdings in UAH, USD, EUR, GBP, BTC, 3 years of times, 2 000 distinct descriptions (Cyrillic and Latin), 10% flagged; 200 rules (120 `nameIs`, 40 `nameStartsWith`, 40 with 2-3 matchers of amount, direction, time).
- Committed tests assert results and counted work only (indexed evaluation equals a brute-force reference on every fixture row; candidate-rule counts; SQL statement counts on the real engine).
- Timings: the developer measures the medians of 5 runs with a temporary `*.measure.test.ts` beside the committed test (prints with `console.info`, never committed; delete before the commit). Run only outside battery mode. Record the numbers in the run log `--note` of that step and in the BATCH READY: (a) `prepareRules` + 10 000-row evaluation (task 1/6); (b) a 10 000-row insert with and without rules, (c) rewrite count + apply for a name rule and a no-name rule on 50 000 rows (task 3/6). Targets: (a)+(b) delta well under 100 ms; (c) about 1 s. A miss goes to the orchestrator before any index is added (an index needs its own plan, an EXPLAIN QUERY PLAN test and a reviewer step).

---

## Change sets

| Task | Scope | Mutable files* | Depends on | Estimate (dev to BATCH READY) |
|---|---|---|---|---|
| category-rules task 1/6 | Pure rule module, matrix tests, perf fixture | 5 | main 1f7a26a4 (this branch) | 60-90 min |
| category-rules task 2/6 | Migration 0058, schema, `categoryRulesRepo`, insert path, `setCategory` flag, export v3 + old-backup conversion, form swap off `category_overrides` | 12 | task 1/6; transaction-templates split in `next` | 150-240 min |
| category-rules task 3/6 | Re-sync refresh re-evaluation (decision 6), manual-save flag plumbing, perf on the real engine | 1 | task 2/6 | 50-80 min |
| category-rules task 4/6 | Categories list cards, category page (read + delete rules), category form, category delete deletes rules (decision 12) | 10 | task 3/6 | 120-180 min + device check |
| category-rules task 5/6 | Rule editor, rewrite count + confirm sheet, "Add rule" | 8 | task 4/6 | 120-180 min + device check |
| category-rules task 6/6 | Form: full-draft pre-select, flag on create/Duplicate/template, "Apply" clears the created row's flag | 5 | task 5/6 | 60-100 min + device check |

\* The `mutation.sh` filter (`.ts/.tsx`, not tests, `__fixtures__`, `test-support`, `index.ts`, `.styles.ts`, `.d.ts`, `i18n/locales/`, `scripts/checks/`; comment-only diffs skipped). Hand counts are estimates; `make mutable` decides.

**Estimate sources (kiko:estimator).** The run log has no similar row (11 rows, all harness or single steps). Duration log: Round C w2 dev round, 22 mutable, rule change touching many tests: 90 min against 45-60 estimated (x1.5-2); Round C task 2/14, 16 mutable: dev 58 min; implicit device fix 6, 4 UI files: 54 min; implicit task 5/8, one screen: 40 min; the estimator snapshot: a small change set is about 40 min dispatch to BATCH READY. Mutation windows: 1-3 files 2-12 min; 10-14 files 58-119 min; 20 files 94 min; a comment-only change to `transaction-form.screen.tsx` (1131 mutants) cost 178 min, so any window with the form screen or `transactions.repo.ts` (2847 lines) is long.

**Why this order.**
- Decision 16: before the transaction-templates split is in `next`, only work that touches neither the form nor the schema. That is task 1/6.
- Dropping `category_overrides` breaks every reader at compile time (insert path, form, export, category delete), and `snapshot-covers-every-table.test.ts` plus `envelope.test.ts` fail on a new table without its export decision. So the migration, the schema, the repo, the insert path, the export and the minimal form swap are ONE change set (task 2/6). Keeping `category_overrides` alive until later was rejected (decision 16: data gap).
- `setCategory` gains the flag in task 2/6, and "Apply" clears the source row's flag in the same task. Reason: the new rewrite skips flagged rows, so a flag without its clearing step would stop "Apply" from changing a row the user had picked "Just for this one" for.
- Decision 6 (refresh re-evaluation) waits for task 3/6: task 2/6's tip keeps today's "refresh never writes category", which is safe. The manual-save flag plumbing in `transactionsRepo` rides task 3/6 so that `transactions.repo.ts` mutates in ONE combined window (tasks 2/6 + 3/6, same lineage, about 12 files) instead of two.
- Category delete keeps today's behavior (rules move to the default category) until task 4/6, which adds the "N rules will be deleted" line together with the deletion. A silent rule deletion at task 2/6's tip would lose data without notice.
- The rewrite confirm sheet has no trigger without the rule editor, so it ships with the editor (task 5/6), not alone. The rewrite core (`rewriteForRule`) ships in task 2/6, because "Apply" on the change-category sheet already needs it.
- Task 4/6 shows rules read-only (cards, hold to delete) and no text about adding rules; task 5/6 adds "Add rule", the empty-state hint and the editor. So no tip names a later task's feature (memory hold-merge-until-feature-complete).
- The form changes are last (spec §7.2, R4).

**Each task tip is shippable alone** (memory intermediate-task-tip-must-be-safe): 1/6 changes no app behavior; 2/6 behaves as today on today's data (every rule is a converted one-`nameIs` rule), apart from the approved exclusions (decision 5, flagged rows); 3/6 adds a data-only rule; 4/6 and 5/6 are complete screens; 6/6 completes the form. Still: no release is cut from `next` until task 6/6 is merged.

**Mutation windows.** Per task, `KIKO_MUTATION_BASE=<task base sha>`. Combine consecutive tasks on one lineage when `make mutable` on the earliest base prints 30 or fewer (tasks 2/6 + 3/6 by design). The coordinator runs `make deep`; orchestrators never do.

**Weak files** (memory touching-weak-file-needs-tests-first): before each task, the orchestrator reads the last mutation score of each touched existing file (duration log, the last `reports/mutation/mutation.json`). For a file below 65, add kill tests inside the task and 20-40 min to the estimate. Known: `accounts.screen` 74.03 (reference only, not touched).

**Shared with transaction-templates** (rebase, never edit in parallel):
- `src/screens/forms/transaction-form/` units `category-rule/`, `use-category-pick/`, `use-category-override/`, `category-override-sheet/` (created by the split) and `transaction-form.screen.tsx` (templates edits the top and bottom blocks, the hydrate inputs and the `alongside` argument of the save calls): tasks 2/6, 6/6.
- `transactionsRepo.recordManual` / `recordManualWithReturns` (templates adds the optional `alongside` second argument): task 3/6.
- `categoriesRepo.delete` (templates adds `clearCategoryDatabaseTransaction`, `countReferencingCategory`): tasks 2/6, 4/6.
- `categories.screen.tsx` delete confirm (templates may add `categories.deleteTemplates_*` to its body): task 4/6.
- `settings.stack.tsx`, `src/navigation/types/types.d.ts` (templates adds `TransactionTemplates`, `TransactionForm`, `AccountForm`, `HoldingForm`): tasks 4/6, 5/6.
- `src/db/schema.ts`, the drizzle journal / `migrations.js` / snapshots (0057), `read-snapshot.ts`, `restore-snapshot.ts`, `data-snapshot.d.ts`, `envelope.test.ts` `VERSION_DECISIONS`: task 2/6.
- en/uk `categories.*` subtree (templates adds `categories.deleteTemplates_*`): task 4/6.

**Per-task close (every task).**
- `make verify` (lint, full Jest, `check:all`) outside battery mode, run until green. Run `bash scripts/wait-load.sh 8 1800 && make verify`.
- One `kiko:reviewer` pass for the task (brief: the top question named in the task, the scenario rows it pins).
- `kiko:retrospect` then `kiko:scribe` (Skill drift rule); the BATCH READY names the drift-fix sha or "no drift found".
- `KIKO_MUTATION_BASE=<task base sha> make mutable`; the BATCH READY names the base sha, the run id, the count, and the TIMES line from the run log.
- A whole-branch `kiko:reviewer` pass before the track merges (Review cadence).

---

## category-rules task 1/6 — Pure rule module (no form, no schema)

Base: `category-rules` after the plan commit (main 1f7a26a4 lineage). Can run now, before the split.

**Files:**
- Create: `src/categories/category-rules/category-rules.d.ts` (types only)
- Create: `src/categories/category-rules/parse-rule-matchers.ts`
- Create: `src/categories/category-rules/rule-subject.ts`
- Create: `src/categories/category-rules/prepare-rules.ts`
- Create: `src/categories/category-rules/plan-rule-rewrite.ts`
- Create: `src/categories/category-rules/validate-rule.ts`
- Create: `src/categories/category-rules/index.ts`
- Create: `src/categories/category-rules/__fixtures__/rules-performance-fixture.ts`, `src/categories/category-rules/__fixtures__/rule-row.ts` (test helper: `ruleRow({ id?, category?, matchers, createdAt?, updatedAt? }): StoredCategoryRule`, JSON-stringifies the matchers)
- Test: `parse-rule-matchers.test.ts`, `rule-subject.test.ts`, `prepare-rules.matrix.test.ts`, `prepare-rules.priority.test.ts`, `plan-rule-rewrite.test.ts`, `validate-rule.test.ts`, `category-rules.performance.test.ts` (all in `src/categories/category-rules/`)

**Interfaces (produces):**
```ts
// category-rules.d.ts
import type { Currency } from '@kiko/currency/currency';
export type AmountOperator = 'eq' | 'gt' | 'gte' | 'lt' | 'lte';
export type RuleDirection = 'expense' | 'income';
export type CategoryRuleMatcher =
  | { type: 'nameIs'; text: string }
  | { type: 'nameStartsWith'; text: string }
  | { type: 'amount'; operator: AmountOperator; minorUnits: number; currency: Currency }
  | { type: 'direction'; direction: RuleDirection }
  | { type: 'time'; operator: 'before' | 'after'; minuteOfDay: number };
// The stored row shape (structurally equal to the schema's CategoryRuleRow; no db import here).
export type StoredCategoryRule = {
  id: string; category: string; matchers: string; createdAt: number; updatedAt: number;
};
export type PreparedRule = {
  id: string; category: string; createdAt: number; updatedAt: number;
  matchers: readonly CategoryRuleMatcher[];
  rank: number; // position in priority order, 0 = strongest
};
export type PreparedRules = {
  ordered: readonly PreparedRule[];                       // every readable rule, priority order
  byName: ReadonlyMap<string, readonly PreparedRule[]>;   // normalized first nameIs text -> rules, priority order
  withoutName: readonly PreparedRule[];                   // rules with no nameIs matcher, priority order
  unreadable: readonly StoredCategoryRule[];              // failed the guard; never match
};
export type RuleSubject = {
  normalizedName: string;
  absoluteMinorUnits: number | null;
  currency: Currency | null;
  direction: RuleDirection | null;
  minuteOfDay: number | null;
};
export type RewriteCandidate = {
  id: string; description: string; amountMinorUnits: number; time: number;
  currency: Currency | null; category: string | null; categorySetByHand: boolean;
  exchangePairId: string | null; exchangeCounterpartHoldingId: string | null;
  setsBalance: boolean; changeGroupId: string | null;
};
export type RuleValidation =
  | { kind: 'valid' }
  | { kind: 'noMatchers' }
  | { kind: 'neverMatches' }
  | { kind: 'duplicate'; category: string };

// parse-rule-matchers.ts
export const parseRuleMatchers: (json: string) => CategoryRuleMatcher[] | null;
// rule-subject.ts
export const minuteOfDayOf: (time: number) => number;
export const subjectOfStoredRow: (row: {
  description: string | null; amountMinorUnits: number; time: number; currency: Currency | null;
}) => RuleSubject;
export const subjectOfDraft: (draft: {
  description: string; absoluteMinorUnits: number | null; currency: Currency | null;
  direction: RuleDirection; time: number;
}) => RuleSubject;
// prepare-rules.ts
export const prepareRules: (rows: readonly StoredCategoryRule[]) => PreparedRules;
export const candidateRules: (prepared: PreparedRules, subject: RuleSubject) => readonly PreparedRule[];
export const winningRule: (prepared: PreparedRules, subject: RuleSubject) => PreparedRule | undefined;
export const matchesRule: (rule: PreparedRule, subject: RuleSubject) => boolean;
// plan-rule-rewrite.ts
export const isRewriteEligible: (row: RewriteCandidate) => boolean;
export const planRuleRewrite: (
  prepared: PreparedRules, savedRuleId: string, rows: readonly RewriteCandidate[],
) => string[];
// validate-rule.ts
export const matcherSetKey: (matchers: readonly CategoryRuleMatcher[]) => string;
export const canEverMatch: (matchers: readonly CategoryRuleMatcher[]) => boolean;
export const validateRule: (
  matchers: readonly CategoryRuleMatcher[], otherRules: readonly PreparedRule[], ownId: string | null,
) => RuleValidation;
```

Rules the code follows (from the spec; the code header of `prepare-rules.ts` holds the rule text once, per memory money-rule-scenario-matrix-first):
- `parseRuleMatchers` rejects: invalid JSON, a non-array, an empty list, an unknown `type`, an unknown operator or direction, `minorUnits` not a non-negative safe integer, a currency failing `isCurrency`, `minuteOfDay` not an integer 0-1439, a name `text` whose `normalizeTransactionName` is blank, extra junk is ignored.
- `subjectOfStoredRow`: `direction` = `amount < 0` expense, `> 0` income, `0` null; `absoluteMinorUnits = Math.abs(amount)`; `normalizedName = normalizeTransactionName(description ?? '')`.
- `matchesRule`: every matcher matches; a matcher whose subject field is null fails; a blank `normalizedName` fails every name matcher.
- `candidateRules`: merge of `byName.get(subject.normalizedName) ?? []` and `withoutName`, by `rank`. A rule is indexed under its FIRST `nameIs` text; it still has to pass every matcher.
- `planRuleRewrite`: ids of rows where `isRewriteEligible(row)` (flag false, no exchange marker, not `setsBalance`, no `changeGroupId`), `winningRule(prepared, subjectOfStoredRow(row))?.id === savedRuleId`, and `row.category !== savedRule.category`. An unknown `savedRuleId` (unreadable or missing) returns `[]`.
- `canEverMatch` returns false for: two directions that differ; amount matchers in two currencies; an empty amount range over integers >= 0 (`eq v` = [v, v], `gt v` = [v+1, inf), `gte v` = [v, inf), `lt v` = [0, v-1], `lte v` = [0, v]; this covers `lt 0`); an amount range of exactly [0, 0] together with a direction (decision 7); an empty minute range (`before X` = [0, X-1], `after X` = [X, 1439]; this covers `after >= before` and `before 00:00`); two `nameIs` with different normalized texts; a `nameIs` that does not start with a `nameStartsWith` prefix; two `nameStartsWith` where neither prefix starts the other.
- `matcherSetKey`: one string per matcher (names normalized), sorted, joined with `'\u0000'`; order-independent.
- `validateRule`: `noMatchers` for `[]`; `neverMatches` when `!canEverMatch`; `duplicate` with the other rule's category when another rule (id not `ownId`) has the same `matcherSetKey` (decision 9); else `valid`.

- [ ] **Step 1/7: Guard and subject tests first.** `parse-rule-matchers.test.ts`: one `it.each` row per rejection listed above, plus valid lists of each type, plus "junk keys ignored". `rule-subject.test.ts`: sign to direction (-1, 0, +1), absolute amount, `minuteOfDayOf(new Date(2026, 9, 25, 18, 30).getTime()) === 1110` (fall-back day) and the same on 2027-03-28, `minuteOfDayOf(new Date(2026, 0, 1, 0, 0).getTime()) === 0`, `23:59 -> 1439`, blank description.
  Run: `npx jest src/categories/category-rules` -> FAIL (modules missing).
- [ ] **Step 2/7: Matrix tests first.** `prepare-rules.matrix.test.ts`: one `it.each` row per spec §6.1 row, asserting `winningRule(prepareRules([ruleRow(...)]), subject) !== undefined`. Amounts as minor units (UAH scale 2, BTC scale 8 via `currencyScale`). Drafts through `subjectOfDraft` (M16-M19).

  | Row | Expected | was: |
  |---|---|---|
  | M1-M10 | as spec (absolute, currency, each operator at its boundary, zero) | new |
  | M11 | 0.00 UAH: expense no, income no | new |
  | M12-M14 | sign vs direction | new |
  | M15 | 0.001 BTC = 100 000 sats match | new |
  | M16, M18 | draft without currency / amount: amount rule no | new |
  | M17 | draft without holding, `nameIs`: match | match |
  | M19 | draft mode expense, amount blank: direction match | new |
  | M20-M22 | time boundaries; 18:30 on 2026-10-25 = 1110 match | new |
  | M24 | `"  SILPO  "` vs "silpo"; "Сільпо" vs "СІЛЬПО": match | match |
  | M24b | NFD "Café" vs rule "Café": match (Review Focus 3) | match |
  | M25 | starts with "silpo": "Silpo Market 12" match, "Mega Silpo" no | new |
  | M26 | blank description: no | no |

  M23 lives in step 4; M27 in task 2/6 (needs the insert path); M28 is unreachable (`holdings.currency` NOT NULL), no test.
  Run: `npx jest src/categories/category-rules/prepare-rules.matrix.test.ts` -> FAIL.
- [ ] **Step 3/7: Priority and rewrite-plan tests first.** `prepare-rules.priority.test.ts`: P1 (2 matchers beat 1, though older), P2 (`updated_at` later wins), P3 (equal `updated_at`, `created_at` later wins), P4 (all equal: larger `id` string wins), same-category tie harmless, an unreadable rule never wins and lands in `unreadable`, `candidateRules` for a name matching no `nameIs` returns exactly `withoutName`. `plan-rule-rewrite.test.ts`:

  | Row | Expected | was: |
  |---|---|---|
  | P10 | flagged row: not planned | was: the same-name rewrite overwrote it |
  | P11 | saved rule wins, category differs: planned | — |
  | P12 | saved rule wins, category equal: not planned | — |
  | P13 | a stronger rule wins: not planned | — |
  | P14 | a narrowed rule no longer matches a row it set: not planned (never reverted) | — |
  | P15 | deleted rule (`savedRuleId` absent): `[]` | was: n/a |
  | P21 | exchange leg (either marker), `setsBalance`, `changeGroupId` row: not planned | was: the name rewrite could touch it |

  Run: `npx jest src/categories/category-rules` -> FAIL.
- [ ] **Step 4/7: Validation tests first.** `validate-rule.test.ts`: M23 (`after 22:00` + `before 06:00` -> `neverMatches`; the two single rules are each `valid`); every `canEverMatch` false case above (Review Focus 2); `[]` -> `noMatchers`; duplicate by `matcherSetKey` with matchers in a different order and a name in different case -> `duplicate` naming the other category; the rule's own id is not a duplicate of itself.
  Run -> FAIL.
- [ ] **Step 5/7: Implement** the six source files until steps 1-4 pass. `prepareRules` sorts once with a comparator over (count DESC, `updatedAt` DESC, `createdAt` DESC, `id` DESC) and assigns `rank`. No DB import anywhere in the folder.
  Run: `npx jest src/categories/category-rules` -> PASS. Then `npm run check:feature-imports && npm run check:knip && npm run check:typecheck` -> green (knip counts test imports as use).
- [ ] **Step 6/7: Performance fixture and test.** `rules-performance-fixture.ts` exports `buildRulesPerformanceFixture(): { rules: StoredCategoryRule[]; rows: RewriteCandidate[] }` (spec §11 shape, deterministic). `category-rules.performance.test.ts` (no DB): (i) on the first 10 000 rows, `winningRule` equals a brute-force reference (`ordered.find((rule) => matchesRule(rule, subject))`) for every row; (ii) for every row whose name matches no `nameIs` text, `candidateRules(...).length === withoutName.length` (80). Measure (a) with the temporary `*.measure.test.ts` (outside battery mode), record it in the run log, delete the measure file.
  Run: `npx jest src/categories/category-rules/category-rules.performance.test.ts` -> PASS.
- [ ] **Step 7/7: Commit** (explicit paths): `feat(categories): pure category rule module with the scenario matrix`. Then the per-task close. Reviewer top question: "Does every §6.1 / P1-P4 / P10-P15 / P21 row have a test that fails on a plausible wrong rule (strict vs non-strict, signed vs absolute, null field)?" Each matrix test must have been seen red (memory fix-round-tests-shown-red).

---

## category-rules task 2/6 — Migration 0058, repo, insert path, export v3, form swap

**Starts only after the transaction-templates split is merged into `next`; rebase onto it first.** Migration gate: see "Migration index".

**Files (mutable):**
- Modify: `src/db/schema.ts` (add `categoryRules`, `CategoryRuleRow`, `transactions.categorySetByHand: integer('category_set_by_hand', { mode: 'boolean' }).notNull().default(false)`; remove `categoryOverrides`, `CategoryOverrideRow`)
- Create: `src/categories/category-rules-repo/category-rules.repo.ts`, `index.ts`
- Delete: `src/categories/category-overrides-repo/` (repo, test, index; `git rm`)
- Modify: `src/categories/repo/categories.repo.ts` (`delete` moves rules to the default key, as overrides moved before)
- Modify: `src/transactions/repo/transactions.repo.ts` (`withCategoryOverrides` -> `withCategoryRules`; `setCategory` sets the flag)
- Modify: `src/data-transfer/crypto/envelope.ts` (`EXPORT_VERSION = 3`, readable `[1, 2, 3]`)
- Modify: `src/data-transfer/import-data.ts` (required keys per version; v3 rule guard; old-file conversion)
- Create: `src/data-transfer/snapshot/with-legacy-overrides-converted.ts`
- Modify: `src/data-transfer/snapshot/read-snapshot.ts`, `restore-snapshot.ts`, `data-snapshot.d.ts`
- Modify (after the split; verify the unit names in `next` first): `src/screens/forms/transaction-form/category-rule/category-rule.ts`, `use-category-pick/use-category-pick.ts`, `use-category-override/use-category-override.ts`
- Comment-only (skipped by the gate): `src/db/chunk-for-table.ts:23`, `src/settings/settings.repo.ts:100-101` (point at `withCategoryRules` / the rewrite instead of the deleted repo)
- Non-mutable: `drizzle/migrations/0058_add_category_rules.sql`, `drizzle/migrations/meta/0058_snapshot.json`, `meta/_journal.json`, `migrations.js`, `docs/harness/documented-exceptions.md`
- Tests: `drizzle/migrations/0058-add-category-rules.test.ts` (new), `src/categories/category-rules-repo/category-rules.repo.test.ts` (new), `src/transactions/repo/transactions.repo.category-rules.test.ts` (new), `src/data-transfer/snapshot/with-legacy-overrides-converted.test.ts` (new), `src/data-transfer/snapshot/restore-category-rules.two-path.test.ts` (new); update every test that seeds `category_overrides` or mocks `categoryOverridesRepo`: `transactions.repo.test.ts`, `transactions.repo.sync-adoption.test.ts`, `transactions.repo.import-ledger.test.ts`, `statement-import/column-mapping/parity.test.ts`, `statement-import/import-statement/import-statement.test.ts`, `statistics/category-breakdown/category-breakdown.test.ts`, `categories/repo/categories.repo.test.ts`, `data-transfer/{round-trip,export-data,import-data}.test.ts`, `data-transfer/snapshot/{read-snapshot,restore-snapshot,restore-sets-balance.two-path,restore-bank-other.two-path,restore-exchange-pair.two-path,restore-import-time-rezone.two-path,restore-legacy-balance-set-at}.test.ts`, `crypto/envelope.test.ts`, `transaction-form/transaction-form.screen.test.tsx`. Leave `src/db/schema.category-overrides.test.ts`, `src/db/run-migrations.test.ts` and `0044-move-crypto-cash-holdings.test.ts` as they are (they read the shipped 0007/0014 SQL or migrate only through earlier tags).

**Interfaces (produces):**
```ts
// category-rules.repo.ts
export const readAllRulesDatabaseTransaction: (databaseTransaction: typeof database) => Promise<CategoryRuleRow[]>;
export const rewriteForRuleDatabaseTransaction: (
  databaseTransaction: typeof database, savedRuleId: string,
) => Promise<number>; // rows updated
export const categoryRulesRepo: {
  allQuery: () => /* select().from(categoryRules) builder, outside any write */;
  applyNameRule: (input: { name: string; category: string; sourceTransactionId: string | null }) => Promise<number>;
} satisfies Repository;
// transactions.repo.ts (internal)
const withCategoryRules: (databaseTransaction: typeof database, batch: NewTransaction[]) => Promise<NewTransaction[]>;
// with-legacy-overrides-converted.ts
export type LegacyCategoryOverrideRow = {
  normalizedName: string; category: string; displayName: string; createdAt?: number; updatedAt?: number;
};
export const withLegacyOverridesConverted: (rows: readonly LegacyCategoryOverrideRow[], now: number) => CategoryRuleRow[];
// form units (same behavior as today)
ruleCategoryFor(subject: RuleSubject, prepared: PreparedRules): string | null
```

- [ ] **Step 1/11: Rebase and base (ops).** In THIS worktree: rebase `category-rules` onto `next` (with the split). `npm ci`. Record `git rev-parse HEAD` as the task 2/6 base sha. Confirm the four form unit folders exist under `src/screens/forms/transaction-form/` and note their real file names; if they differ from this plan, use the real names and tell the orchestrator.
- [ ] **Step 2/11: Migration test first.** `drizzle/migrations/0058-add-category-rules.test.ts` (pattern: `0055-add-dismissed-tips.test.ts`; through the branch's current tail tag): seed overrides (Latin, Cyrillic "Сільпо", mixed case, inner double space, and one with `display_name = '   '`), transactions, then apply the SQL. Assert: one rule per override with the same `category`, `created_at`, `updated_at`; `parseRuleMatchers(matchers)` gives one `nameIs` whose `text` is `display_name` and `normalizeTransactionName(text) === normalized_name` (the blank one fails the guard and is still stored); ids unique, 32 hex chars; zero overrides -> zero rules; `category_overrides` is gone; `category_set_by_hand` exists, NOT NULL, default 0, every existing row 0; `PRAGMA index_list('category_rules')` holds only the PK autoindex.
  Run: `npx jest drizzle/migrations/0058-add-category-rules.test.ts` -> FAIL (file missing).
- [ ] **Step 3/11: Schema and migration.** Edit `schema.ts` as listed (`matchers: text('matchers').notNull()`, plain text so the guard, not Drizzle, parses it). Run `npx drizzle-kit generate --name add_category_rules`. If drizzle-kit asks whether `category_rules` renames `category_overrides`, answer "create table" (run it in an Orca terminal if the prompt needs a TTY). Hand-edit the SQL into the spec §4 order with `--> statement-breakpoint` between statements: CREATE TABLE; the `INSERT ... SELECT lower(hex(randomblob(16))), category, json_array(json_object('type', 'nameIs', 'text', display_name)), created_at, updated_at FROM category_overrides` (single quotes); `ALTER TABLE transactions ADD category_set_by_hand integer DEFAULT false NOT NULL`; `DROP TABLE category_overrides`. Add a SQL header comment stating copy, then commit, then drop, and that the runner commits the whole file in one transaction (precedent header: `0047_add_sets_balance.sql`). Re-check `migrations.js`; `./node_modules/.bin/biome check --write drizzle/migrations`.
  Run: step 2 test -> PASS.
- [ ] **Step 4/11: Repo tests first** (`category-rules.repo.test.ts`, real `node:sqlite` via `executingDrizzle` + `applyAllMigrations`):

  | Case | Expected | was: |
  |---|---|---|
  | P20 | today-shaped data (no flags, one-`nameIs` rules), "Apply" "Silpo" -> food: exactly the rows whose normalized name is "silpo" change, except the P21 rows | rows named "silpo", P21 rows included |
  | P10 | a flagged "silpo" row stays | was: overwritten |
  | P12 | a "silpo" row already in food: unchanged, not counted | — |
  | P21 | exchange leg, `sets_balance`, split-change row named "silpo": unchanged | was: rewritten |
  | existing rule | an existing rule that is exactly one `nameIs` "SILPO" (other category) is moved: same id, new category, `text` = typed name, `updated_at` bumped; no second rule | the override row upserted |
  | other rule | a rule `nameIs` "silpo" + direction stays untouched; a new one-`nameIs` rule is inserted | — |
  | source flag | `sourceTransactionId` row with flag 1 gets flag 0 and the new category (when the rule wins it) | — |
  | blank | `name = '   '`: no rule, no row change, returns 0 | same |
  | return | returns the updated-row count | — |
  | chunking | 32 001 distinct matching descriptions: every row updated (proves the chunked `IN`) | was: one unchunked `IN` |

  Run: `npx jest src/categories/category-rules-repo` -> FAIL.
- [ ] **Step 5/11: Implement the repo.** `readAllRulesDatabaseTransaction`: the ONE full read of `category_rules` inside a write. `rewriteForRuleDatabaseTransaction`: reads all rules once, `prepareRules`; candidate rows: if the saved rule has a name matcher, `selectDistinct(description)` then JS filter by the rule's name matchers, then rows `WHERE description IN (chunk)`; else id-keyset pages of 2 000 (`WHERE id > ? ORDER BY id LIMIT 2000`); every candidate read joins `holdings` for `currency` and filters the P21 columns and `category_set_by_hand = 0` in SQL; `planRuleRewrite`; `UPDATE transactions SET category = ? WHERE id IN (chunk) AND category_set_by_hand = 0` per `IN_CLAUSE_CHUNK_SIZE` chunk; returns the summed `rowsAffected`. `applyNameRule`: one `write`: blank -> 0; find via `matcherSetKey`; update or insert; clear the source flag; `rewriteForRuleDatabaseTransaction`.
  Run: `npx jest src/categories/category-rules-repo` -> PASS.
- [ ] **Step 6/11: Insert path tests first** (`transactions.repo.category-rules.test.ts`, real engine, `transactionsRepo.addManyDedup` and `importRows`):

  | Case | Expected | was: |
  |---|---|---|
  | P5 | Monobank MCC 5411 (bank groceries), rule `nameIs` "silpo" -> food | food (override) |
  | P6 | no rule matches: bank category kept | same |
  | P7 | Binance row (no category), rule matches: rule category | same for a name override |
  | P9 | sync adopts an import twin with a category and flag 1: twin's category and flag kept | twin's category kept |
  | M27 | rule amount = 500 UAH, MCC 4829 row -500.00 UAH: category changes; `isMccExcludedTransfer` still true | new |
  | amount rule | rule amount = 500 UAH matches a UAH holding row, not a USD holding row of -500.00 | new |
  | missing holding currency | a batch row whose holding read returns no row: a name rule applies, an amount rule does not, no throw (Review Focus 4) | — |
  | refresh | an existing row re-synced: `category` unchanged (decision 6 comes in task 3/6) | unchanged |
  | flag | insert never sets the flag; `setCategory` sets it to 1 | — |
  | statements | one `category_rules` read and one holdings read per `withCategoryRules` call (the adoption and the upsert each call it once; count statements through the test's `executingClient`) | one override read per key chunk |

  Run: `npx jest src/transactions/repo/transactions.repo.category-rules.test.ts` -> FAIL.
- [ ] **Step 7/11: Implement the insert path.** `withCategoryRules` replaces `withCategoryOverrides` at both callers (`adoptImportTwinsDatabaseTransaction`, `upsertDedupRowsDatabaseTransaction`): `prepareRules(await readAllRulesDatabaseTransaction(...))` once; when there are no readable rules return the batch unchanged; read `holdings.id, holdings.currency` for the batch's distinct `holdingId`s (`inArray`, chunked); per row `winningRule(prepared, subjectOfStoredRow({ ...row, currency }))`; a winner replaces `category`. `setCategory` sets `{ category, categorySetByHand: true }`. Update the doc comments that name `categoryOverridesRepo`.
  Guard exception (decision 10): run `semgrep --config rules/semgrep-prewrite.yml src/categories/category-rules-repo src/transactions/repo/transactions.repo.ts`. If `kiko-no-full-table-select-in-write` reports the read, put `// nosemgrep: kiko-no-full-table-select-in-write OVERRIDE(user-authored small table) every reader needs every rule; no cap by design` on that line. If it does not report it (the rule matches only a select lexically inside `write(...)`, and the read sits in a helper), add NO `nosemgrep` (it would suppress nothing) and tell the orchestrator. Either way: a WHY comment at the read, and an entry in `docs/harness/documented-exceptions.md` naming the read, the reason (decision 10: user-authored, small, every reader needs every row; no cap, no silent drop) and its call sites (insert path, `rewriteForRuleDatabaseTransaction`). Never move the read to dodge the rule.
  Run: step 6 test -> PASS; `npx jest src/transactions src/statement-import src/monobank src/crypto-sync` -> PASS.
- [ ] **Step 8/11: Category delete (same behavior).** Test first in `categories.repo.test.ts`: deleting a category moves its transactions AND its rules (case-insensitive `lower(category) = ?`) to the default key, in one write (was: overrides moved). Implement in `categoriesRepo.delete` (`update(categoryRules)`). Keep templates' clearing step if it is already there.
  Run: `npx jest src/categories` -> PASS.
- [ ] **Step 9/11: Export v3 and old backups, tests first.**
  - `envelope.test.ts`: `VERSION_DECISIONS.version: 3`, `migrationCount` = the new journal length, and a comment: through 0058, which replaces `category_overrides` with `category_rules`; a v2 build requires `categoryOverrides`, so it must refuse a v3 file by version.
  - `with-legacy-overrides-converted.test.ts`: one rule per override, `matchers` parses to one `nameIs` with `text = displayName`, timestamps kept (missing -> `now`), fresh unique ids; a blank `displayName` still converts (Review Focus 1).
  - `import-data.test.ts`: v1/v2 payload requires `categoryOverrides`, not `categoryRules`; v3 requires `categoryRules`; a v3 rule failing `parseRuleMatchers` (or a non-string id/category) fails as "not a valid Kiko export file" before the database is touched; a v2 file without `categorySetByHand` on transactions restores 0.
  - `restore-category-rules.two-path.test.ts`: a pre-0058 database migrated to the tail, and the same data exported as a v2 file and restored, end with equal rules (compare `category`, `createdAt`, `updatedAt`, parsed matchers; ignore ids) and equal flags (all 0); include the blank-name override.
  - `round-trip.test.ts`: a v3 export of rules and a flagged row restores both.
  Run: `npx jest src/data-transfer` -> FAIL.
  Implement: `DataSnapshot.categoryRules: CategoryRuleRow[]` (replaces `categoryOverrides`); `read-snapshot.ts` reads `category_rules` ordered by `id`; `restore-snapshot.ts` deletes `category_rules` with the other tables and inserts `snapshot.categoryRules` through `chunkForTable`; `import-data.ts` passes the envelope version into the payload check, converts a v1/v2 `categoryOverrides` list with `withLegacyOverridesConverted` into `categoryRules` before the restore, and checks v3 rules with the guard. No rewrite runs on restore.
  Run: `npx jest src/data-transfer` -> PASS (`snapshot-covers-every-table.test.ts` included).
- [ ] **Step 10/11: Form swap (same behavior), tests first.** In `transaction-form.screen.test.tsx`, replace the `categoryOverridesRepo` mock with `categoryRulesRepo` and assert: blur on a description with a one-`nameIs` rule pre-selects on create (P16 name-only, P18 clears, P19 none on edit, P17 user pick stays) exactly as before; "Apply" calls `applyNameRule({ name, category, sourceTransactionId: editingId })` (null on create); "Just for this one" calls `setCategory`.
  Run: `npx jest src/screens/forms/transaction-form` -> FAIL.
  Implement: `use-category-pick/` subscribes `useLiveQuery(categoryRulesRepo.allQuery(), ['category_rules'])` and `useMemo(() => prepareRules(rules), [rules])`; `category-rule/`'s `ruleCategoryFor(subject, prepared)` returns `winningRule(...)?.category ?? null`; the hook passes a NAME-ONLY subject (`normalizedName` set, every other field null), so only pure-name rules match, as today. `use-category-override/`'s `applyOverride` calls `applyNameRule`.
  Run: `npx jest src/screens/forms/transaction-form` -> PASS.
- [ ] **Step 11/11: Clean up and commit.** `git rm -r src/categories/category-overrides-repo`. `rg -n "categoryOverride|category_overrides|CategoryOverride" src` must show only the shipped-migration readers listed above, `with-legacy-overrides-converted.ts`, `import-data.ts` and the tests that seed pre-0058 databases. Commit (explicit paths): `feat(categories): category_rules table, rule insert path and export v3`.
  Close: per-task close. **Migration review (memory every-migration-gets-a-review):** a `kiko:reviewer` pass on 0058 before BATCH READY. Brief, top question: "Is 0058 crash-safe and lossless (every override becomes exactly one rule), and does any existing query change its plan?" Name these queries and their indexes for the reviewer to confirm with EXPLAIN QUERY PLAN on a migrated `node:sqlite` copy:
  - `transactions.category`: `categoriesRepo.delete` `lower(category) = ?` (full scan, no index, unchanged); `contextCategoriesQuery` GROUP BY category (scan through the holdings/accounts joins, unchanged); `reminders.repo.ts` `enteredByUser` `category IS NOT NULL` (filter on the existing reminder query plan); `readImportTwinsDatabaseTransaction` (selects category; `transactions_time` / `transactions_holding_id`); the rewrite's `UPDATE ... WHERE id IN (...) AND category_set_by_hand = 0` (PK autoindex); the rewrite's `description IN (...)` read (full scan, the same as the deleted `upsertCategoryOverride` update); the keyset page `id > ? ORDER BY id LIMIT 2000` (PK).
  - `category_overrides` (dropped): `withCategoryOverrides` (PK autoindex lookup), `upsertCategoryOverride` (PK conflict, then a full-scan `selectDistinct(description)`), `categoryOverridesRepo.allQuery` (scan), `categoriesRepo.delete` (scan), `read-snapshot` (ORDER BY PK), restore delete/insert.
  - `category_rules`: every read is a full scan of a small table (PK only); `categoriesRepo.delete` by `lower(category)` (scan). No new index, so no EXPLAIN QUERY PLAN test is required; if the review adds one, it adds that test.
  BATCH READY names the migration idx and gives the proof from "Migration index": `npx drizzle-kit check` passes and a second `npx drizzle-kit generate` is a no-op.

---

## category-rules task 3/6 — Refresh re-evaluation, manual-save flag plumbing, real-engine performance

**Starts only after the transaction-templates split is merged into `next`; rebase onto it first** (stacked on task 2/6).

**Files:**
- Modify: `src/transactions/repo/transactions.repo.ts` (`withCategoryRules` also returns which rows a rule won; `upsertDedupRowsDatabaseTransaction` upserts rule-won rows with a conditional `category` in the conflict `set`; `ManualTransaction.categorySetByHand?: boolean` written by `recordManualTransaction`; `recordManual` returns the new row id; `recordManualWithReturns` returns the payment row id and writes the flag on the payment row only)
- Test: `src/transactions/repo/transactions.repo.category-rules.test.ts` (extend), `src/transactions/repo/transactions.repo.category-rules.performance.test.ts` (new)

**Interfaces (produces):**
```ts
type ManualTransaction = { /* existing fields */ categorySetByHand?: boolean };
transactionsRepo.recordManual(input: ManualTransaction /*, alongside? from templates */): Promise<string>;           // new row id
transactionsRepo.recordManualWithReturns(input: ManualWithReturnsInput /*, alongside? */): Promise<string>;         // payment row id
```

- [ ] **Step 1/6: Refresh tests first** (P8, decision 6):

  | Case | Expected | was: |
  |---|---|---|
  | refresh, amount changed, flag 0, a rule wins at the new amount | `category` = the rule's | unchanged |
  | refresh, amount changed, flag 1, a rule wins | unchanged | unchanged |
  | refresh, amount changed, no rule wins | unchanged (the bank category is not re-applied) | unchanged |
  | refresh, amount unchanged, description changed, a rule wins | unchanged | unchanged |
  | refresh, nothing bank-owned changed | no write (`setWhere` unchanged) | same |
  | hold -> settled: 499.00 -> 501.00 UAH, rule amount > 500 UAH | category changes | unchanged |

  Run: `npx jest src/transactions/repo/transactions.repo.category-rules.test.ts` -> FAIL.
- [ ] **Step 2/6: Implement.** Split the batch into rule-won and other rows. The other rows keep today's `set`/`setWhere`. The rule-won rows add `category: sql\`CASE WHEN ${transactions.categorySetByHand} = 0 AND ${transactions.amountMinorUnits} IS NOT excluded.amount_minor_units THEN excluded.category ELSE ${transactions.category} END\`` (SQLite evaluates SET expressions on the old row). Both partitions are already folded to one row per conflict key (`dedupByConflictKey`), so chunk independence holds. Update the upsert comment that says `category` is never in the set.
  Run -> PASS.
- [ ] **Step 3/6: Manual-save flag tests first.** `recordManual({ ..., categorySetByHand: true })` stores 1 and returns the new id; omitted -> 0; `recordManualWithReturns` stores the flag on the payment row only (returns rows have no category) and returns the payment id; `recordExchange` unchanged (no flag).
  Run -> FAIL. Implement. Run -> PASS. If templates' `alongside` argument is already on these functions, keep it as the second argument.
- [ ] **Step 4/6: Real-engine performance test** (`transactions.repo.category-rules.performance.test.ts`, the task 1/6 fixture seeded into `node:sqlite`): (b) a 10 000-row `addManyDedup` with 200 rules gives the same categories as `winningRule` per row and issues one rules read and one holdings read per `withCategoryRules` call; (c) `rewriteForRuleDatabaseTransaction` for a name rule and for a no-name rule updates exactly `planRuleRewrite(...).length` rows, with `ceil(n / IN_CLAUSE_CHUNK_SIZE)` UPDATE statements and, for the no-name rule, `ceil(eligible / 2000)` page reads. Measure (b) and (c) with the temporary measure file outside battery mode; record them.
  Run: `npx jest src/transactions/repo/transactions.repo.category-rules.performance.test.ts` -> PASS.
- [ ] **Step 5/6: Commit:** `feat(transactions): re-evaluate rules on an amount refresh; manual-save flag`.
- [ ] **Step 6/6: Close.** Per-task close. Reviewer top question: "Can a refresh ever write a category onto a flagged row, or write the bank category back?" Mutation: one combined window with task 2/6 (`KIKO_MUTATION_BASE=<task 2/6 base> make mutable`, expected about 12).

---

## category-rules task 4/6 — Categories list, category page, category form, category delete

**Starts only after the transaction-templates split is merged into `next`; rebase onto it first.** If templates' category-delete line (`categories.deleteTemplates_*`, `countReferencingCategory`) is already in `next`, keep it in both new confirm places.

**Files:**
- Modify: `src/categories/repo/categories.repo.ts` (`delete`: delete rules, clear the flag on the moved rows; `create` returns the new key)
- Modify: `src/categories/category-rules-repo/category-rules.repo.ts` (`listQuery()` for the page, `countRulesOfCategory(key)`, `deleteRule(id)`)
- Modify: `src/screens/settings/categories/categories.screen.tsx` (one-column `Sortable.Grid` of cards; footer "Add category"; drag reorder only)
- Create: `src/screens/settings/categories/category-card/category-card.component.tsx` (+ `.props.d.ts`, `.styles.ts`, `index.ts`, test)
- Delete: `src/screens/settings/categories/add-category-row/` (its inputs move to the category form)
- Create: `src/screens/settings/category-detail/category-detail.screen.tsx` (+ `index.ts`, test)
- Create: `src/screens/settings/category-detail/rule-card/rule-card.component.tsx` (+ props, styles, index, test)
- Create: `src/screens/settings/category-detail/rule-summary/rule-summary.ts` (+ index, test): `ruleSummary(matchers, { t, clock, formatAmount }): string`, parts joined by `' · '`
- Create: `src/screens/forms/category-form/category-form.screen.tsx` (+ index, test): name (`HoldingIdentityField` as the add row used it), icon pool `KIKO_CATEGORIES_ICONS`, `ColorPicker` (no Delete)
- Modify: `src/navigation/settings-stack/settings.stack.tsx` (`CategoryDetail`, `CategoryForm`), `src/navigation/types/types.d.ts` (`CategoryDetail: { categoryKey: string }`, `CategoryForm: { categoryKey?: string }`)
- Modify: `src/i18n/locales/en.ts`, `uk.ts`: `categories.rulesCount_one/few/many/other`, `categories.noRules`, `categories.default`, `categories.deleteRulesNotice_one/few/many/other`, `categoryPage.rulesHeading`, `categoryPage.unreadableRule`, `categoryForm.addTitle`, `categoryForm.editTitle`, plus `ruleForm.nameIs`, `nameStartsWith`, `equal`, `more`, `atLeast`, `less`, `atMost`, `before`, `after` used by `rule-summary` (spec §9.5 texts). Remove keys left unused by the old inline row (`moveToTopLabel`, `moveToBottomLabel`, and any other the old screen alone used) if a locale-keys test or knip flags them.
- Mutable count: about 10.

- [ ] **Step 1/7: Repo tests first** (`categories.repo.test.ts`, `category-rules.repo.test.ts`):

  | Case | Expected | was: |
  |---|---|---|
  | P22 | deleting a category with rules: its rules are deleted (case-insensitive key), its rows move to the default with `category_set_by_hand = 0`, all in one write | was: overrides (rules) moved to the default |
  | default | deleting the default still throws | same |
  | count | `countRulesOfCategory(key)` counts case-insensitively | — |
  | deleteRule | deletes one rule; no transaction row changes (P15) | — |
  | create | returns the new key | void |

  Run: `npx jest src/categories` -> FAIL. Implement. Run -> PASS.
- [ ] **Step 2/7: `rule-summary` tests first:** `Name is "Silpo" · Expense · More than 500.00 UAH · After 18:00` (en, 24-hour clock), the same in a 12-hour clock, each operator label, BTC 8-place amount, matchers in stored order. Run -> FAIL; implement; PASS.
- [ ] **Step 3/7: Categories list tests first** (`categories.screen.test.tsx`, rewrite): a card per category in `sort_order` with `EntityIconTile`, title, caption "N rules" / "No rules", and "Default" on the default; tap navigates to `CategoryDetail` with the key; hold opens `CardContextMenu` delete (not on the default) whose `deleteMessage` resolves the `categories.deleteRulesNotice_*` line (plus templates' line when present) and confirming calls `categoriesRepo.delete`; drag end calls `categoriesRepo.reorder` (via `onGridDragEnd`); footer "Add category" navigates to `CategoryForm` without a key. Run -> FAIL; implement (pattern: `renderAccountCard`, `accounts.screen.tsx:231-292`, `:455-500`); PASS.
- [ ] **Step 4/7: Category page tests first** (`category-detail.screen.test.tsx`): header title = category name (default titles through `resolveDefaultCategoryTitle`); header Edit -> `CategoryForm` with the key; rule cards in priority order (`prepareRules(...).ordered` filtered by category, case-insensitive) with `ruleSummary`; an unreadable rule shows `categoryPage.unreadableRule` and only Delete; hold on a rule card -> delete confirm -> `deleteRule`; "No rules" when empty; a "Set as default" row under the rules (hidden on the default) calls `settingsRepo.setDefaultCategoryKey`; a key that no longer exists (deleted elsewhere) goes back. No "Add rule" control and no text about adding rules in this task. Run -> FAIL; implement; PASS.
- [ ] **Step 5/7: Category form tests first** (`category-form.screen.test.tsx`): create mode saves `categoriesRepo.create` and replaces the route with `CategoryDetail` of the new key; edit mode saves title, icon and colour through `updateTitle` / `updateIcon` / `updateColor` (blank title refused as today); The form has no Delete; the list card's hold menu is the only delete path. Run -> FAIL; implement; PASS.
- [ ] **Step 6/7: Commit:** `feat(categories): category cards, category page and category form`.
- [ ] **Step 7/7: Close.** Per-task close. Reviewer top question: "Is every category delete path one write that deletes rules and clears the flag on exactly the moved rows, and does any confirm under-report the rule count?" Then the user's live device check (UI). The user checks:
  - Categories list looks like Accounts: one column, icon tile, title wraps on long names, caption "N rules" / "No rules", "Default" on the default.
  - Tap opens the category page; Edit opens the form; name, icon, colour save and show on the list.
  - Hold on a card: Delete shows "Its N rules will be deleted too" (and the templates line if present); not offered on the default.
  - Drag reorders and the order stays after leaving and reopening the screen.
  - "Add category" -> form -> after Save, the new category page.
  - "Set as default" on the page moves the "Default" caption.
  - A rule card shows its summary; hold -> Delete (titled `categoryPage.deleteRuleTitle`) removes it; no transaction changes category.
  - Dark mode, the largest Dynamic Type size, VoiceOver labels on cards and the menu.
  - uk texts (plural forms 1, 2, 5, 21 rules).

---

## category-rules task 5/6 — Rule editor, rewrite count and confirm sheet

**Starts only after the transaction-templates split is merged into `next`; rebase onto it first.**

**Files:**
- Modify: `src/categories/category-rules-repo/category-rules.repo.ts` (`countRuleRewrite(rule)`, `saveRule({ rule, applyToExisting })`, `readRule(id)` query)
- Create: `src/screens/forms/category-rule-form/category-rule-form.screen.tsx` (+ index, test)
- Create: `src/screens/forms/category-rule-form/matcher-row/matcher-row.component.tsx` (+ props, styles, index, test)
- Create: `src/screens/forms/category-rule-form/rule-draft/rule-draft.ts` (+ index, test): draft rows <-> matchers
- Create: `src/screens/forms/category-rule-form/use-save-rule/use-save-rule.ts` (+ index, test)
- Create: `src/screens/forms/category-rule-form/rule-rewrite-sheet/rule-rewrite-sheet.component.tsx` (+ props, index, test; the `BottomSheet` + buttons pattern of `category-override-sheet/`)
- Modify: `src/screens/settings/category-detail/category-detail.screen.tsx` ("Add rule" button with a leading symbol; tap on a rule card opens the editor; empty-state hint `categoryPage.emptyRules`)
- Modify: `settings.stack.tsx`, `types.d.ts` (`CategoryRuleForm: { categoryKey: string; ruleId?: string }`)
- Modify: `en.ts`, `uk.ts`: `categoryPage.addRule`, `categoryPage.emptyRules`, `ruleForm.addTitle/editTitle/addMatcher/allMustMatch/amount/direction/time/deleteRule/errorNoMatchers/errorName/errorAmount/errorNeverMatches/errorDuplicate`, `ruleRewrite.title/message_one/few/many/other/applyToExisting/newOnly`, and NEW `ruleForm.timeHint` (decision 15; proposed en "Statement rows without a time count as 12:00 in the statement’s time zone." / uk "Рядки виписки без часу рахуються як 12:00 у часовому поясі виписки."; the user confirms the wording). "Matcher" reads "condition" / "умова" (the user confirms).
- Mutable count: about 8.

**Interfaces (produces):**
```ts
categoryRulesRepo.countRuleRewrite(rule: { id: string | null; category: string; matchers: readonly CategoryRuleMatcher[] }): Promise<number>;
categoryRulesRepo.saveRule(input: {
  id: string | null; category: string; matchers: readonly CategoryRuleMatcher[]; applyToExisting: boolean;
}): Promise<{ id: string; changed: number }>;
// rule-draft.ts
type MatcherDraft = { type: CategoryRuleMatcher['type']; text: string; operator: string; amountText: string;
  currency: Currency; direction: RuleDirection; minuteOfDay: number };
export const toMatcherDrafts: (matchers: readonly CategoryRuleMatcher[], baseCurrency: Currency) => MatcherDraft[];
export const fromMatcherDrafts: (drafts: readonly MatcherDraft[]) =>
  | { kind: 'valid'; matchers: CategoryRuleMatcher[] }
  | { kind: 'invalid'; errors: ReadonlyMap<number, 'errorName' | 'errorAmount'> };
```

- [ ] **Step 1/7: Repo tests first** (real engine):

  | Case | Expected | was: |
  |---|---|---|
  | count | `countRuleRewrite` of an unsaved rule = `planRuleRewrite` over all rules with the draft added as the newest (rank by its own distinct matcher count, via `prepareRules`/`distinctMatcherKeys`, never `matchers.length`, and `now`) | — |
  | P11, P12, P13 | apply: changed / unchanged-not-counted / out-ranked-not-counted | — |
  | P10, P21 | flagged and P21 rows untouched | was: overwritten |
  | N equals changed | on unchanged data, `saveRule({ applyToExisting: true }).changed` equals `countRuleRewrite` | — |
  | race | a row inserted between count and apply that the rule wins is included (re-plan inside the write) | — |
  | new only | `applyToExisting: false` saves the rule, no row changes | — |
  | no change | saving the same matchers and category writes nothing (`updated_at` unchanged) | — |
  | P14 | an edited rule that no longer matches a row it set: that row unchanged | — |
  | edit category | changing only the category of a rule: rows it wins move to the new category | — |
  | guard | a rule failing `validateRule` is refused by `saveRule` (throws), so a bad rule never lands | — |

  Run: `npx jest src/categories/category-rules-repo` -> FAIL. Implement (`saveRule`: one `write`: insert or update with `updated_at = now`, then `rewriteForRuleDatabaseTransaction` when `applyToExisting`). Run -> PASS.
- [ ] **Step 2/7: Apply-on-edit source row case (decision 17).** Add a test for "Apply" on an edit where a stronger rule wins the source row: with a 2-matcher rule of category A that wins the row, "Apply" with category B creates/updates the one-matcher nameIs rule for B, the source row gets B with category_set_by_hand = 1, and the other same-name rows that the A rule wins keep A; a same-name row where no stronger rule wins gets B with flag 0.
- [ ] **Step 3/7: `rule-draft` tests first:** each type round-trips; amount text through `Money.fromMajor` with the draft currency, exact; more decimals than `currencyScale` -> `errorAmount` (Review Focus 5); negative or blank amount -> `errorAmount`; blank name -> `errorName`; default currency = base currency. Run -> FAIL; implement; PASS.
- [ ] **Step 4/7: Editor tests first** (`category-rule-form.screen.test.tsx`, `use-save-rule.test.ts`): starts with one matcher row (create) or the rule's rows (edit); type select switches the input (name field / operator + amount + currency select / Expense-Income segment / Before-After segment + `TimeField` with `ruleForm.timeHint`); "Add matcher" adds a row; remove control on every row but the last; hint `ruleForm.allMustMatch`; Save: `noMatchers` / `neverMatches` (M23) / `duplicate` (names the other category) errors inline, nothing saved; N = 0 -> saves directly, no sheet (decision 11); N > 0 -> sheet "This changes N transactions" with "Apply to existing" (`applyToExisting: true`), "New transactions only" (`false`), Cancel (back to the editor, nothing saved); Delete rule (edit only) -> confirm -> `deleteRule`, no rewrite; a double tap saves once (`useSubmitOnce`). Run -> FAIL; implement; PASS.
- [ ] **Step 5/7: Category page tests** (extend): "Add rule" opens the editor in create mode; a tap on a readable rule card opens it in edit mode; the empty state shows `categoryPage.emptyRules`. Run -> FAIL; implement; PASS.
- [ ] **Step 6/7: Commit:** `feat(categories): rule editor with the retroactive rewrite`.
- [ ] **Step 7/7: Close.** Per-task close. Reviewer top question: "Can the count in the sheet ever differ from what 'Apply to existing' writes on unchanged data, and can any save path skip `validateRule`?" Then the user's live device check. The user checks:
  - "Add rule" -> editor; each condition type; "Add condition"; remove; the "must match every condition" hint.
  - Each inline error: no condition, blank name, bad amount (also too many decimals), never-match pair (after 22:00 + before 06:00), a duplicate of another category's rule.
  - Save with matching rows: the sheet's N; "Apply to existing" changes those rows (spot-check Home); "New transactions only" changes none; Cancel keeps the editor.
  - Save with no matching rows: no sheet.
  - Edit a rule and change its category: rows follow; a row picked "Just for this one" stays.
  - "Apply to existing" on the real database feels fast (Hermes; spec §11 final check).
  - The time hint text; times in the user's 12/24-hour setting; uk texts and plurals.

---

## category-rules task 6/6 — Form: pre-select from the whole draft, the manual-pick flag

**Starts only after the transaction-templates split is merged into `next`; rebase onto it first.** If templates' template seed is in `next`, include its cases below; if not, the templates track adds them (its boundary rule 7).

**Files:**
- Modify: `src/screens/forms/transaction-form/category-rule/category-rule.ts` (subject from the whole draft)
- Modify: `src/screens/forms/transaction-form/use-category-pick/use-category-pick.ts` (re-evaluate on description blur, suggestion tap, amount, time, mode and holding change; create only, never once picked, never in exchange mode)
- Modify: `src/screens/forms/transaction-form/use-category-override/use-category-override.ts` ("Apply" passes the created row id on create)
- Modify: `src/screens/forms/transaction-form/transaction-form.screen.tsx` (pass amount, time, mode, holding currency to the hook; pass `categorySetByHand` to `recordManual` / `recordManualWithReturns`; keep the created id for the sheet)
- Test: `transaction-form.screen.test.tsx` (extend), unit tests beside the three hook/unit files
- Mutable count: about 4-5. `transaction-form.screen.tsx` is large: budget the mutation window as long (178 min precedent).

- [ ] **Step 1/5: Tests first:**

  | Case | Expected | was: |
  |---|---|---|
  | P16 | create, no pick, a rule on amount + direction matches after the amount settles: pre-selected | pre-selected on name blur only |
  | P16b | the time changes into a time rule's range: pre-selected | new |
  | P16c | the holding changes to the rule's currency: pre-selected | new |
  | P17 | the user picked, then a rule starts to match: the pick stays | same |
  | P18 | pre-selected, then the draft stops matching: cleared to none | same |
  | P19 | edit: never pre-selects | same |
  | exchange | exchange mode: never pre-selects | same |
  | flag create | create with a hand pick: `recordManual` gets `categorySetByHand: true`; with a pre-selected category or none: `false` | — |
  | flag Duplicate | Duplicate with a seeded category: `true` (seed sets `userPickedCategory`) | — |
  | flag split | split create with a hand pick: `recordManualWithReturns` gets `true` | — |
  | flag template | template with a category: `true`; template without a category: pre-select applies, `false` (decision 13; only if the seed is in `next`) | — |
  | Apply on create | "Apply" passes the created row id as `sourceTransactionId` (its flag goes to 0) | — |
  | Apply on edit | passes `editingId` (unchanged from task 2/6) | — |
  | Just for this one | `setCategory` (flag 1, from task 2/6) | — |

  Run: `npx jest src/screens/forms/transaction-form` -> FAIL.
- [ ] **Step 2/5: Implement.** The subject: `subjectOfDraft({ description, absoluteMinorUnits: parsed amount or null, currency: the picked holding's currency or null, direction: mode, time })`. Re-evaluation runs where `reseatCategoryFromName` runs today and on the four new settle events; it seats the result or none, as today.
  Run -> PASS.
- [ ] **Step 3/5: Commit:** `feat(transactions): category pre-select from the whole draft; manual-pick flag on save`.
- [ ] **Step 4/5: Close.** Per-task close. Reviewer top question: "Is there any save path where a hand-picked category is stored with flag 0, or a pre-selected one with flag 1?"
- [ ] **Step 5/5: User's live device check.** The user checks:
  - Create: typing a name that has a rule pre-selects on blur; entering an amount / switching Expense-Income / changing the time / changing the holding pre-selects when a richer rule matches.
  - A category picked by hand is never replaced while editing the draft.
  - Edit an existing transaction: nothing is pre-selected.
  - Change a category and tap "Apply": the rule appears on the category page; same-name rows change; the edited row follows.
  - "Just for this one": that row keeps its category after a later "Apply to existing" of a matching rule.
  - Duplicate and (if shipped) a template keep their category.

---

## Skill drift (each task; retrospect + scribe)

- kiko-domain: category rules (matchers, priority, the flag table, decision 3 never-revert, decision 6, decision 12); remove the `category_overrides` text (`SKILL.md:250`, `:888`).
- kiko-architecture: migration 0058 and the next free index; "No full-table select inside a write" (the documented rule read); the `withCategoryOverrides` line (`SKILL.md:848`); export v3 and the old-backup conversion.
- kiko-design-system: category card and rule card if they become shared patterns.
- `docs/harness/documented-exceptions.md`: the rule-read entry (task 2/6).
