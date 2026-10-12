# Transaction templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every code task follows superpowers:test-driven-development: the failing test first, then the code.

**Goal:** A template stores every field of a transaction except its date. The Add form fills from it in one pick, and Add, Duplicate and Edit can save their content as a new template.

**Architecture:** First, split the 2852-line `transaction-form.screen.tsx` into unit folders. The split moves code only, and category-rules builds on it. Then a new feature container `src/transaction-templates/` adds three units: `draft/` (the `TemplateDraft` type and its guard), `template-name/` (the name key and the taken check) and `repo/`. They store templates in one new table (`transaction_templates`, migration 0057) with no foreign keys. The holding, account and category deletes clear the references in the same write. The form fills from a template through the existing Duplicate hydration plan (one fill path). A `.kiko` file carries the templates as an optional key. A new Settings card holds Transaction templates and Categories.

**Tech Stack:** React Native 0.87, op-sqlite + Drizzle, react-navigation 7 (native stack), react-i18next, unistyles v3, Jest/RNTL with `node:sqlite` (`@kiko/test-support/real-sqlite`).

**Spec:** `docs/superpowers/specs/2026-10-11-transaction-templates-design.md` (commit bfa6a63c, approved). Its "Decisions" and "Rulings on the former open points" (O1–O12) are user rulings. This plan does not change them.

## Spec claims checked against the code (mismatches first)

Read these before task 1/18. Each line says what the code shows and what this plan does.

1. **`draft` typed `.$type<TemplateDraft>()` in `src/db/schema.ts`.** Then `src/db` would import `src/transaction-templates`, which is the wrong direction (the onboarding plan's mismatch 2 is the precedent). The column is typed `.$type<unknown>()`. The repo narrows it with `isTemplateDraft` in `toTransactionTemplate(row)`, which the read rule needs in any case (a bad row reads as `EMPTY_DRAFT`).
2. **`FormMode` is declared in a screen file** (`src/screens/forms/mode-select-field/mode-select-field.props.d.ts:6`), and a feature must not import a screen. `draft/` declares `TEMPLATE_MODES = ['income', 'expense', 'exchange', 'split'] as const`. The form assigns `TemplateMode` to `FormMode` and back (in `draft-from-form/` and `hydration/`), so `tsc` fails if the two unions drift.
3. **SQLite `lower()` folds only ASCII.** "Оренда" and "оренда" would both pass a SQL `lower(name) = ?` check. The case-insensitive name check therefore runs in JS (`templateNameKey = name.trim().toLowerCase()`). Inside the write it reads `selectDistinct({ id, name })`, which is the form `kiko-no-full-table-select-in-write` itself names as the fix. Review Focus 1.
4. **SQL prefilter text.** The spec writes `instr(draft, '"' || ? || '"') > 0`. The plan binds `JSON.stringify(id)` to `instr(draft, ?) > 0`, so the needle is the exact JSON encoding, even for a key that JSON escapes. The intent is the same: the prefilter can match too many rows, and `draftReferences` makes the exact decision.
5. **This branch ships migration 0057** (`0057_add_transaction_templates`). The first branch to reach `next` keeps the number; a later branch renumbers at merge. `migrationCount` in `envelope.test.ts` is 58, the journal length with this migration (category-rules ships 0056).
6. **`settings-card-categories` is pinned by `settings.screen.test.tsx`** (lines 160, 193 and 562: the card order). The new two-row card gets `settings-card-templates-and-categories`. Task 15/18 updates those order assertions. The Categories row keeps `settings-row-categories`.
7. **The split table leaves out some module-level items.** The plan places them as follows. `Sign` and `ChangeReturnRow` go to `row-labels/` (their first user), `SplitReturn` and `TransactionFieldErrors` go to `validation/`, and `buildLoanOptions` and `compareByAccountThenHolding` (inside 600–803) go to `holding-options/`. `SpecialSaves` goes with `ModeBehavior`. `PendingCategoryView` goes with `resolvePendingCategory`. The module `styles` object (screen:2826) is split: each extracted component takes the entries it uses into its own `<unit>.styles.ts`, and the screen keeps the rest.
8. **O7 and the coordinator's brief.** The brief says to plan the confirm line as a step that applies only if this track merges second. Spec §2 and decision 6 also cover the first-merge case: "If templates is first, it adds a `message` to today's `ConfirmSheet`". Task 16/18 plans both branches and runs exactly one of them, chosen by the merge order at that time. Without the first branch, decision 6 would ship unmet on a first merge.
9. **category-rules writes the manual-pick flag from `userPickedCategory`** (category-rules spec §3.2, row "A transaction from a template that carries a category: set 1"). This track only sets `userPickedCategory = true` for a seeded template category (O12). It adds no flag column and no flag write. Whichever track merges second checks the wiring (spec boundary point 7). For this track, that is the last step of task 16/18.
10. **The form's `navigation` prop has no `push`** (screen:87–94). Task 10/18 adds `push: (name: 'TransactionForm', params: TransactionFormParams) => void`. Home's native stack already has it, and task 14/18 registers the form in the Settings stack.
11. **No ruling reverses an earlier shipped rule.** The new `holding` field error is a new rule. Today's Manual form has no holding error (`plainFieldErrors`, screen:414). So no scenario matrix needs a "was:" column.

## Global Constraints

- No new dependency, no native code, no new permission.
- Guideline 5.6: no flag, and no build or env gate. The Settings row, the list, both template modes and the tabs show in every build. The Template tab shows even with zero templates (with the hint). A screen is reachable only from the task that makes it complete (see "Change sets").
- Every user string goes into `en.ts` and `uk.ts` in the same task, with the same key set. Plural keys carry `_one/_few/_many/_other` in both. uk `_other` is the fraction form. Every uk text is marked **REVIEW** (task 17/18).
- Every write goes through `write()`. The template insert that goes with a transaction runs inside that transaction's own `write()` (`alongside`).
- No foreign key on `transaction_templates`. No index. If an index is ever added, it needs an `EXPLAIN QUERY PLAN` test.
- No loan field and no comment in any template path (O5, O11). `isLoanFieldVisible` stays as it is.
- A template category is a hand pick: it sets `userPickedCategory` (O12). This track adds no manual-pick column.
- Writes to `src/`, `__tests__/` and `rules/` go through Edit/Write only (the kill-guard SHELL-WRITE deny). Rename with `git mv`.
- Migration 0057 is never edited once it ships (`check:shipped-migrations`).
- The worktree has no `node_modules`. The developer runs `npm ci` once in this worktree before task 1/18, when the machine is on power (BATTERY MODE pauses gates). Never share the main checkout's `node_modules`.

## Review Focus

1. **Cyrillic name uniqueness.** "Оренда" equals " оренда " (mismatch 3). Pinned in task 3/18 (`templateNameKey`), task 6/18 (the repo rejects it inside the write) and task 10/18 (the form's taken error).
2. **One fill path.** A template pick reopens the `hydrated` latch, and the one hydrate effect applies the plan. The Duplicate and Edit plans are byte-equal to today's (`seedFields` with `mode` = today's sign, no destination, one empty return). Pinned in task 9/18.
3. **The seam on each entry (O1).** On `{ holdingId }`, a null template holding keeps the page holding. On `{}`, `{ templateId }` and Edit-template it clears the seam. A resolved holding always replaces the seam. Pinned in task 9/18.
4. **Atomicity.** If the template insert fails, the transaction rolls back, and the reverse. Pinned in task 8/18 (repo) and task 11/18 (form).
5. **Exact scale with a deleted holding.** A UAH, JPY or BTC amount formats from `draft.currency`, never from `holding?.currency ?? 'UAH'`. Pinned in task 9/18.
6. **An account delete counts each template once.** Pinned in task 7/18.
7. **Split = no behavior change.** In tasks 1/18 and 2/18, the diff of `transaction-form.screen.test.tsx` is only the `canSaveSplit` import and its `describe` block.

---

## Change sets and the mutation gate

The coordinator runs each change set's gate detached, after review and a green `make verify`: `KIKO_MUTATION_BASE=<change set base> make deep`. The cap is 30 mutable files (`MUTATION_FILE_CAP`, `scripts/checks/mutation.sh`). Tests, `index.ts`, `*.styles.ts`, `.d.ts` and locales are excluded. Before BATCH READY, the orchestrator confirms the count with `KIKO_MUTATION_BASE=<base> make mutable`. The counts below are estimates from the file lists. If a change set has merged into `next`, the next change set's base is that `next` tip (harness-workflow "Mutation base after a track merged next").

| Change set | Tasks | Base point | Estimated mutable files | Merge into `next` |
|---|---|---|---|---|
| CS1 (the split) | 1/18, 2/18 | the branch tip when task 1/18 starts (this plan's commit) | ~19: the screen, plus 18 new unit sources (`route-entry`, `hydration`, `validation`, `mode-options`, `holding-options`, `convert-view`, `row-labels`, `category-rule`, `read-only-notice`, `comment-row`, `primary-holding-field`, `field-group`, `split-returns`, `mode-and-actions` (component + helpers), `category-override-sheet`, `use-category-override`, `use-category-pick`) | **alone, first. The task 2/18 tip is the merge point for category-rules.** |
| CS2 (draft, table, `.kiko`, repo) | 3/18–6/18 | the CS1 tip, or the `next` tip with CS1 in it | 6: `template-draft.ts`, `template-name.ts`, `transaction-templates.repo.ts`, `src/db/schema.ts` (counted, but its score is excluded), `read-snapshot.ts`, `restore-snapshot.ts` | alone, since nothing is reachable |
| CS3 (deletes, atomicity) | 7/18–8/18 | the CS2 tip, or `next` | 5: `holdings.repo.ts`, `accounts.repo.ts`, `categories.repo.ts`, `transactions.repo.ts`, `remove-notice.ts` | alone. The count sentence needs a template, and none can exist yet |
| CS4 (the form) | 9/18–12/18 | the CS3 tip, or `next` | ~12: the screen, `route-entry`, `hydration`, `validation`, `row-labels`, `field-group`, `mode-and-actions`, plus new `template-references`, `draft-from-form`, `template-name-field`, `save-as-template`, `template-select` | **held** after its gate. It merges with CS5 and CS6 (harness-workflow: the hint and toggle promise a list that only CS5 ships) |
| CS5 (list and Settings) | 13/18–15/18 | the CS4 tip | ~5: `transaction-card.component.tsx`, `entity-symbols.ts`, `settings.stack.tsx`, `transaction-templates.screen.tsx`, `settings.screen.tsx` | together with CS4 and CS6 |
| CS6 (category confirm line) | 16/18 | the CS5 tip, or the rebased tip (see the task) | 1: the confirm's screen file | together with CS4 and CS5 |

Tasks 17/18 and 18/18 change no mutable source.

Mutation time, from `memory/refs/duration-log.md` (main checkout): `transaction-form.screen.tsx` alone has 1131 mutants and took 178 min ("implicit device fix 4"). 20–25 files took 94–224 min. CS1 re-homes those same mutants, so expect **180–240 min** on a quiet machine. Run it alone, never beside a planner or a full jest. CS4 holds the screen again: 60–180 min. CS2: 20–60 min ("1–3 files: 2–12 min"; `restore-snapshot.ts` is 39 KB). CS3: 40–120 min (big repos; "6 files, 58 min", "6 files under load, ~170 min"). CS5: 10–40 min. CS6: under 10 min.

---

### transaction-templates task 1/18: split, part 1: the pure units (developer)

**Estimate:** 60–100 min to BATCH READY. Source: duration log "Round C task 3A TX-C2, 20+ mutable, dev 46 min + fix" and "TX-C3 16 mutable dev 58 min". No row for a move-only split exists, so the range is wide.

**Files** (each unit is a folder under `src/screens/forms/transaction-form/` holding `<unit>.ts` and `index.ts`):
- Create: `route-entry/` (`readRouteEntry`), `hydration/` (`toAmountFields`, `HydrationPlan`, `seedFieldsFrom`, `resolveHydration`), `validation/` (screen 302 and 330–596 without the category items: `isPositiveAmountText`, `SaveDisabledParams`, `SaveDisabledField`, `TransactionFieldErrors`, the four `*FieldErrors`, `isSplitAmountInvalid`, `ActiveMode`, `resolveActiveMode`, `SpecialSaves`, `ModeBehavior`, `MODE_BEHAVIOR`, `firstInvalidField`, `SplitReturn`, `canSaveSplit`, `areWellFormedReturns`, `returnsCoverPayment`), `mode-options/` (`resolveModeOptions`, `MODE_ICONS`), `holding-options/` (600–803), `convert-view/` (997–1075), `row-labels/` (the non-JSX helpers at 110–300, plus `Sign` and `ChangeReturnRow`), `category-rule/` (`ruleCategoryFor`, `resolveCategoryOverrideRequest`, `PendingCategoryView`, `resolvePendingCategory`)
- Create: `validation/validation.test.ts`, which holds the `describe('canSaveSplit')` block (test:4022–4118) moved verbatim
- Modify: `transaction-form.screen.tsx` (delete the moved code and import from `./<unit>`), `transaction-form.screen.test.tsx` (only line 23 changes to `import TransactionFormScreen from './transaction-form.screen';`, and the `canSaveSplit` describe is removed)

**Interfaces:** Each unit exports what the screen or a sibling unit uses, with names unchanged. `canSaveSplit` stays exported from `validation/`. Sibling units import each other with `../<unit>`.

- [ ] **step 1/6:** Move the `canSaveSplit` describe into `validation/validation.test.ts` with an import from `./validation`. Run `npx jest src/screens/forms/transaction-form/validation`. Expected: FAIL (module missing).
- [ ] **step 2/6:** Create the eight unit folders and move each item's code with its WHY comment unchanged. Write each new file with Write: the pre-write guard checks the moved text as new code. If it denies a moved comment (line width, a history id), reword that comment minimally. Never add an override.
- [ ] **step 3/6:** Delete the moved code from the screen and add the imports in import-order. Run `npx jest src/screens/forms/transaction-form`. Expected: PASS, with the same total test count as on the task base (the moved describe counts once).
- [ ] **step 4/6:** Run `npx tsc --noEmit && npm run check:feature-imports && npm run check:knip && npm run check:import-order && npm run check:dup && npm run check:lint`. Expected: PASS.
- [ ] **step 5/6:** Check that `git diff <task base> -- src/screens/forms/transaction-form/transaction-form.screen.test.tsx` shows only line 23 and the removed describe block.
- [ ] **step 6/6:** Commit `refactor(transaction-form): move pure helpers into unit folders`.

### transaction-templates task 2/18: split, part 2: the components and hooks, then the CS1 review (developer, reviewer)

**Estimate:** 70–120 min to BATCH READY (same source as 1/18, plus one review: "review 4–11 min").

**Files** (folders under `src/screens/forms/transaction-form/`):
- Create components (`<unit>.component.tsx`, `<unit>.props.d.ts`, `<unit>.styles.ts` when it has styles, `index.ts`): `read-only-notice/` (`renderReadOnlyNotice` becomes `<ReadOnlyNotice />`), `comment-row/` (`<CommentRow />`), `primary-holding-field/` (`<PrimaryHoldingField />`), `field-group/` (`FieldGroupProps` becomes `field-group.props.d.ts`, plus `<FieldGroup />`), `split-returns/` (`<SplitReturns />`), `mode-and-actions/` (`<ModeAndActions />`, plus `mode-and-actions.ts` for `showsSaveButton`, `isLoanFieldVisible` and `resolveLoanLinkState`), `category-override-sheet/` (the override `BottomSheet` JSX, screen:2735–2805, as `<CategoryOverrideSheet />`)
- Create hooks (`<unit>.ts`, `index.ts`): `use-category-pick/` (`useCategoryPick` owns `selectedCategory`, `effectiveCategory`, `userPickedCategory`, `selectCategory`, `seedCategory`, `settleDescription`, `pickSuggestion`), `use-category-override/` (`useCategoryOverride` owns `pendingOverride`, `applyOverride`, `applyOverrideOne`, `cancelOverride`, their `useSubmitOnce` instances, `pendingCategory`)
- Modify: `transaction-form.screen.tsx` (render `<X />` where it called `renderX(...)`, call the two hooks, and move the style entries into the components)

**Interfaces:** Each component's props are the old function's argument object, unchanged. Each hook takes the values it closed over as one argument object and returns the same names the body used, plus the one setter the hydrate effect calls, `seedCategory(category, seededDescription)`, which holds the category, flags a non-null one as a hand pick and settles the description in one step. The screen keeps the state, the hydrate effect, the save handlers and the layout.

- [ ] **step 1/6:** Run `npx jest src/screens/forms/transaction-form` on the task base and record the pass count. That suite is this task's failing-first guard: every step below keeps it green.
- [ ] **step 2/6:** Extract the seven components one at a time. Each reads the theme through `useUnistyles()` and uses an explicit `return`. Re-run the step 1/6 command after each one.
- [ ] **step 3/6:** Extract `useCategoryPick` and `useCategoryOverride`. Keep each `useEffect` dependency list exact (no new `exhaustive-deps` override). Re-run the step 1/6 command.
- [ ] **step 4/6:** Run `npx tsc --noEmit && npm run check:all`. Expected: PASS. Then check that `git diff <CS1 base> -- src/screens/forms/transaction-form/transaction-form.screen.test.tsx` is still only the task 1/18 lines. Commit `refactor(transaction-form): one component or hook per unit folder`.
- [ ] **step 5/6:** Dispatch `kiko:reviewer` on the CS1 diff (`<CS1 base>..HEAD`). Top question: "Is any behavior changed? Compare each moved block with its source, each hook's dependency list, and each style entry. Also: is the test diff only the canSaveSplit move?" The developer fixes Critical and Important findings in a fix round.
- [ ] **step 6/6:** The orchestrator runs `make verify` until it is green, then `KIKO_MUTATION_BASE=<CS1 base> make mutable` (expected ~19, at most 30), then BATCH READY. The coordinator runs `make deep` and merges CS1 into `next`. **This tip is the merge point for category-rules.**

### transaction-templates task 3/18: draft module and name key (developer)

**Estimate:** 30–45 min. Source: duration log "cleanup 14/15, 1 mutable, 31 min" and "cleanup 13/15, 3 mutable, 51 min".

**Files:**
- Create: `src/transaction-templates/draft/template-draft.ts`, `template-draft.test.ts`, `index.ts`. Create `src/transaction-templates/template-name/template-name.ts`, `template-name.test.ts`, `index.ts`.
- Modify: `scripts/checks/feature-imports.js` (add `'transaction-templates'` to `CONTAINERS`)

**Interfaces (produces):**
```ts
// draft/
export const TEMPLATE_MODES = ['income', 'expense', 'exchange', 'split'] as const;
export type TemplateMode = (typeof TEMPLATE_MODES)[number];
export type TemplateDraft = { version: 1; mode: TemplateMode; holdingId: string | null; currency: Currency | null;
  amountMinorUnits: number | null; description: string; category: string | null;
  exchange: { destinationHoldingId: string | null; destinationCurrency: Currency | null; valueInMinorUnits: number | null } | null;
  returns: { holdingId: string | null; amountMinorUnits: number | null }[] };
export const EMPTY_DRAFT: TemplateDraft; // mode 'expense', every reference and amount null, description '', exchange null, returns []
export const isTemplateDraft: (value: unknown) => value is TemplateDraft; // uses isRecord from @kiko/type-guards
export const draftReferences: (draft: TemplateDraft) => { holdingIds: string[]; categoryKey: string | null };
export const clearDraftReferences: (draft: TemplateDraft, cleared: { holdingIds: readonly string[]; categoryKey: string | null }) => TemplateDraft;
// template-name/
export const templateNameKey: (name: string) => string; // name.trim().toLowerCase(), JS (Unicode) folding
export const isTemplateNameTaken: (name: string, templates: readonly { id: string; name: string }[], exceptId: string | null) => boolean;
```

- [ ] **step 1/5:** Write the failing tests.
  - `isTemplateDraft`: a valid draft for each mode. Each field invalid in turn: `mode` not in the list, an unknown currency, an amount of 0, a negative amount, 1.5 or `Number.MAX_SAFE_INTEGER + 1`, an id of the wrong type, `returns` not an array, `exchange` an array, `version` 2. Each field missing in turn. An extra key is ignored. `null`, an array and a string are rejected.
  - `draftReferences`: holdings in the primary, destination and each return slot, no duplicates, and the category lowercased.
  - `clearDraftReferences`: it clears a holding in each slot (a cleared return keeps its row with `holdingId: null`) and it clears the category. An id that only appears inside `description` is left alone. An unrelated draft comes back equal.
  - `templateNameKey(' Оренда ') === templateNameKey('оренда')`. `isTemplateNameTaken` ignores case and surrounding spaces, excludes `exceptId`, and returns false for an empty list.
- [ ] **step 2/5:** Run `npx jest src/transaction-templates`. Expected: FAIL (module missing).
- [ ] **step 3/5:** Implement, and add the container to `feature-imports.js`.
- [ ] **step 4/5:** Run `npx jest src/transaction-templates && npx tsc --noEmit && npm run check:feature-imports`. Expected: PASS.
- [ ] **step 5/5:** Commit `feat(transaction-templates): draft type, guard and name key`.

### transaction-templates task 4/18: migration 0057, schema table and `.kiko` carry (developer)

The data transfer is part of this task, because the tip would not be green without it. `snapshot-covers-every-table.test.ts` calls the real `readDataSnapshot()` and fails for a schema table that has no snapshot key. `envelope.test.ts` pins `migrationCount`.

**Estimate:** 45–70 min. Source: duration log "guard task 1/5 (check:shipped-migrations + 0036 restore), 36 min", plus the onboarding 0055 and restore tasks.

**Files:**
- Create: `drizzle/migrations/0057_add_transaction_templates.sql`, `drizzle/migrations/meta/0057_snapshot.json` (generated), `drizzle/migrations/0057-add-transaction-templates.test.ts`, `src/data-transfer/snapshot/restore-transaction-templates.test.ts` (real SQLite, shaped like `restore-deleted-import-keys.test.ts`)
- Modify: `drizzle/migrations/meta/_journal.json`, `drizzle/migrations/migrations.js` (generated; check its layout again), `src/db/schema.ts` (the new table after `deletedImportKeys`, and `TransactionTemplateRow` beside `DeletedImportKeyRow`), `src/data-transfer/snapshot/data-snapshot.d.ts` (`transactionTemplates?: TransactionTemplateRow[]`), `read-snapshot.ts` (select all, ordered by `id`), `restore-snapshot.ts` (`deleteAllTables` deletes `transactionTemplates`; the insert of `snapshot.transactionTemplates ?? []` goes through `chunkForTable`, as exported), `src/data-transfer/crypto/envelope.test.ts` (one `VERSION_DECISIONS` sentence for 0057, and `migrationCount` = the journal length)
- Not modified: `import-data.ts` (`REQUIRED_TABLE_KEYS` stays as it is) and `EXPORT_VERSION`.

**Interfaces (produces):**
```ts
export const transactionTemplates = sqliteTable('transaction_templates', {
  id: text('id').primaryKey(),                    // the repo generates it, as other repos do
  name: text('name').notNull(),
  draft: text('draft', { mode: 'json' }).$type<unknown>().notNull(), // narrowed by the repo (mismatch 1)
  createdAt: integer('created_at').notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer('updated_at').notNull().default(sql`(unixepoch() * 1000)`),
});
export type TransactionTemplateRow = typeof transactionTemplates.$inferSelect;
```

- [ ] **step 1/6:** Write `0057-add-transaction-templates.test.ts` in the shape of `0054-add-deleted-import-keys.test.ts`, starting from `applyMigrationsThrough(database, '<previous tag>')`. Assert: (1) no table before the migration; (2) after it, `pragma_table_info` gives exactly the five columns with their types, `notnull` values and the `pk` on `id`; (3) an insert of `(id, name, draft)` reads `created_at` and `updated_at` close to `unixepoch()*1000`; (4) a NULL `name` or `draft` throws; (5) `pragma_foreign_key_list('transaction_templates')` is empty, and `pragma_index_list` lists only the PK's autoindex (no index, so no EXPLAIN QUERY PLAN test).
- [ ] **step 2/6:** Write `restore-transaction-templates.test.ts`: a round trip keeps the templates (ids, names, drafts, timestamps). A file without the key restores an empty table and imports. A draft such as `{"version":9}` restores verbatim. A restore over existing templates replaces them. Update `envelope.test.ts` with the 0057 sentence ("a new table carried as an optional key, like 0054; no version bump").
- [ ] **step 3/6:** Run `npx jest drizzle/migrations/0057-add-transaction-templates.test.ts src/data-transfer`. Expected: FAIL.
- [ ] **step 4/6:** Add the table to `schema.ts` with a WHY comment: no FK because the references live in `draft` and a delete clears them; no index because the table is small and read by PK or in full. Run `npx drizzle-kit generate --name add_transaction_templates`, then `./node_modules/.bin/biome check --write drizzle/migrations`. The `.sql` must be one `CREATE TABLE`. Prepend a `/* */` header in the 0054 style: additive only, so a crash leaves the database at the previous idx and it retries whole; no data step; no restore mirror (an older file restores an empty table). Numbering: see mismatch 5. Then add the snapshot key, the read and the restore.
- [ ] **step 5/6:** Run `npx jest drizzle/migrations src/db src/data-transfer && npx tsc --noEmit`. Expected: PASS (`snapshot-covers-every-table.test.ts` and the two-path restore tests included).
- [ ] **step 6/6:** Commit `feat(db): migration 0057 transaction_templates and its .kiko carry`.

### transaction-templates task 5/18: migration 0057 review (reviewer)

**Estimate:** 10–20 min. Source: duration log "mutation-gate review, 11 min".

**Files:** none (read-only).
- [ ] **step 1/2:** Dispatch `kiko:reviewer` on the task 4/18 diff. The brief asks: (1) Is the SQL one additive `CREATE TABLE` that matches the snapshot and the schema? (2) Which existing queries touch the new table (`readDataSnapshot`, `restoreDataSnapshot`, `deleteAllTables`), and does any of them break on a database at the previous idx or on an old `.kiko` without the key? (3) Is the journal idx free on `next` and on `binance-pay-history`, and is the renumber rule written down? (4) Does the header state the crash-safe order? (5) There is no index, so no EXPLAIN QUERY PLAN test. The reviewer confirms that.
- [ ] **step 2/2:** The developer fixes Critical and Important findings before task 6/18. The CS2 BATCH READY names "migration 0057".

### transaction-templates task 6/18: templates repo (developer)

**Estimate:** 40–60 min. Source: duration log "cleanup 13/15, 3 mutable, 51 min".

**Files:**
- Create: `src/transaction-templates/repo/transaction-templates.repo.ts`, `transaction-templates.repo.test.ts` (real SQLite: `executingClient` + `applyAllMigrations`, shaped like `holdings.repo.create-icon.test.ts`), `index.ts`

**Interfaces:**
- Consumes: `transactionTemplates` and `TransactionTemplateRow` (task 4/18), plus `isTemplateDraft`, `EMPTY_DRAFT`, `draftReferences`, `clearDraftReferences` and `isTemplateNameTaken` (task 3/18).
- Produces:
```ts
export type TransactionTemplate = { id: string; name: string; draft: TemplateDraft; createdAt: number; updatedAt: number };
export class TemplateNameTakenError extends Error {}
export const toTransactionTemplate: (row: TransactionTemplateRow) => TransactionTemplate; // a bad draft reads as EMPTY_DRAFT, name kept
export const transactionTemplatesRepo = {
  listQuery: () => /* select all, order by created_at asc, id asc */,
  getByIdQuery: (id: string) => /* select where id */,
  create: (input: { name: string; draft: TemplateDraft }) => Promise<string>,        // own write()
  update: (input: { id: string; name: string; draft: TemplateDraft }) => Promise<void>, // own write(), updated_at = Date.now()
  remove: (id: string) => Promise<void>,
  insertDatabaseTransaction: (databaseTransaction: typeof database, input: { name: string; draft: TemplateDraft }) => Promise<string>,
  clearHoldingsDatabaseTransaction: (databaseTransaction: typeof database, holdingIds: readonly string[]) => Promise<void>,
  clearCategoryDatabaseTransaction: (databaseTransaction: typeof database, key: string) => Promise<void>,
  countReferencingHoldingsDatabaseTransaction: (databaseTransaction: typeof database, holdingIds: readonly string[]) => Promise<number>,
  countReferencingCategory: (key: string) => Promise<number>,
} satisfies Repository;
```
Every insert or update stores `name.trim()`. The name check inside the write reads `selectDistinct({ id, name })` and calls `isTemplateNameTaken` (mismatch 3). The clear and count methods prefilter with `instr(draft, ?) > 0`, bound to `JSON.stringify(id or lowercase key)` (mismatch 4). The ids are chunked by `chunkForTable` so the variable limit holds. Then they decide with `draftReferences`. A clear rewrites only the rows that really reference the id, and leaves `updated_at` as it is. A count adds each template id once across all holding ids.

- [ ] **step 1/5:** Write the failing tests:
  - create, list (`created_at` ascending), getById, update (moves `updated_at`, not `created_at`), remove.
  - create and update store the trimmed name. "Оренда" after " оренда " throws `TemplateNameTakenError` and writes nothing. An update to the row's own name passes.
  - A row whose raw `draft` is `'{"version":9}'` lists as `EMPTY_DRAFT` with its name kept, and it can be updated and removed.
  - `clearHoldingsDatabaseTransaction` clears each slot, keeps a cleared return row, and leaves a template that only names the id inside `description` byte-equal, with `updated_at` unchanged.
  - `clearCategoryDatabaseTransaction('groceries')` sets `category` to null. It never sets the default key.
  - The counts: two holding ids in one template count 1. A description-only hit counts 0.
- [ ] **step 2/5:** Run `npx jest src/transaction-templates/repo`. Expected: FAIL.
- [ ] **step 3/5:** Implement.
- [ ] **step 4/5:** Run `npx jest src/transaction-templates && npx tsc --noEmit && npm run check:security && npm run check:feature-imports`. Expected: PASS (no `kiko-no-full-table-select-in-write` finding).
- [ ] **step 5/5:** Commit `feat(transaction-templates): repository`. Then: `kiko:reviewer` reviews the CS2 diff (tasks 3–6), `make verify` runs until it is green, `KIKO_MUTATION_BASE=<CS2 base> make mutable` (expected 6), and BATCH READY.

### transaction-templates task 7/18: deletes clear templates and the holding confirm counts them (developer)

**Estimate:** 50–80 min. Source: duration log "Round C task 9/14 TX-C1, 5 mutable, dev ~35 min, 2 regression fix rounds" and "cleanup 13/15, 51 min".

**Files:**
- Modify: `src/holdings/repo/holdings.repo.ts` (`removeHoldingDatabaseTransaction`, next to the `clearLoanLinksForHoldingsDatabaseTransaction` call at :451), `src/accounts/accounts.repo.ts` (`remove`: one call with all the account's holding ids, next to :458), `src/categories/repo/categories.repo.ts` (`delete`: clear before the category row is deleted, using `key.toLowerCase()`), `src/transactions/remove-notice/remove-notice.ts` (`RemoveHoldingsPlan.templatesChanged: number`; `removeHoldingsNotice` appends `t('holdings.deleteLinked.templates', { count })` when the count is above 0), `src/transactions/repo/transactions.repo.ts` (`planLinkedRowsDatabaseTransaction` fills `templatesChanged`), `src/i18n/locales/en.ts`, `uk.ts`, `src/i18n/init/init.plural-rules.test.ts` (one case for the new plural)
- Tests: `src/transaction-templates/repo/transaction-templates.delete-paths.test.ts` (real SQLite), `src/transactions/remove-notice/remove-notice.test.ts` (extend it), and every existing fixture that builds a `RemoveHoldingsPlan` (add `templatesChanged: 0`; find them with Grep for `unlinkedPlain:`)

**Strings:** `holdings.deleteLinked.templates_one/_few/_many/_other` (see the Strings table).

- [ ] **step 1/5:** Write the failing tests:
  - `transactionsRepo.removeHolding(id)` clears that holding in every draft slot. `accountsRepo.remove(accountId)` clears every holding of the account. `categoriesRepo.delete('groceries')` clears the category to null and still moves transactions to the default. A forced throw after the clearing step (mock the final delete) rolls the template rewrite back, which proves it shares the write.
  - `transactionsRepo.removeHoldingsPlan([a, b])` gives `templatesChanged: 1` for one template that names both (Review Focus 6), and 0 for a description-only hit.
  - `removeHoldingsNotice`: the en text at 1 and 2. The uk text at 1, 2, 5 and 21 (`_one`/`_few`/`_many`/`_one`). No sentence at 0.
- [ ] **step 2/5:** Run `npx jest src/transaction-templates src/transactions/remove-notice src/holdings/repo src/accounts src/categories`. Expected: FAIL.
- [ ] **step 3/5:** Implement and add the strings.
- [ ] **step 4/5:** Run the step 2/5 command plus `npx jest src/i18n src/transactions/repo && npx tsc --noEmit && npm run check:feature-imports`. Expected: PASS, with no feature cycle (`transaction-templates` imports none of holdings, accounts, categories or transactions).
- [ ] **step 5/5:** Commit `feat(transaction-templates): deletes clear template references`.

### transaction-templates task 8/18: `alongside` on the transaction writes (developer)

**Estimate:** 30–45 min. Source: duration log "Round C task 13/14, 5 mutable, ~25 min" and "cleanup 14/15, 31 min".

**Files:**
- Modify: `src/transactions/repo/transactions.repo.ts` (`recordManual` :2064, `recordExchange` :2078, `recordManualWithReturns` :2263 and `update` :2289 each get an optional second argument `alongside?: (databaseTransaction: typeof database) => Promise<void>`, awaited last inside the same `write`; `recordExchangeCounterpart` stays as it is)
- Create: `src/transactions/repo/transactions.repo.alongside.test.ts` (real SQLite)

- [ ] **step 1/4:** Write the failing tests for each of the four methods: an `alongside` that inserts a template commits both. An `alongside` that throws leaves no transaction row (and for `update`, the old values). A transaction write that fails (for example `recordExchange` with destination = source) never calls `alongside` and writes no template. With no `alongside`, behavior is unchanged.
- [ ] **step 2/4:** Run `npx jest src/transactions/repo/transactions.repo.alongside.test.ts`. Expected: FAIL.
- [ ] **step 3/4:** Implement. Run `npx jest src/transactions && npx tsc --noEmit`. Expected: PASS.
- [ ] **step 4/4:** Commit `feat(transactions): optional alongside step inside the write`. Then: `kiko:reviewer` reviews the CS3 diff (tasks 7–8; top question: "does each clear or count share the delete's write, and is every Cyrillic or JSON edge case covered?"), `make verify` runs until it is green, `KIKO_MUTATION_BASE=<CS3 base> make mutable` (expected 5), and BATCH READY.

### transaction-templates task 9/18: template params, reference resolution and the template seed (developer)

**Estimate:** 60–90 min. Source: duration log "TX-C3 16 mutable dev 58 min". This task has many pure tests.

**Files:**
- Modify: `src/navigation/types/types.d.ts` (`TransactionFormParams` += `{ templateId: string } | { editTemplateId: string } | { newTemplate: true }`), `src/screens/forms/transaction-form/route-entry/route-entry.ts` (returns `templateId`, `editTemplateId`, `isNewTemplate`, and no seat field; the screen fallback `holdingParamId` restores the page holding on `{ holdingId }`), `hydration/hydration.ts`, `transaction-form.screen.tsx` (the live query for the picked template, `pickedDraft` state, the effect applying the new fields with their existing setters)
- Create: `src/screens/forms/transaction-form/template-references/template-references.ts`, `template-references.test.ts`, `index.ts`. Create `hydration/hydration.test.ts`. Create `src/screens/forms/transaction-form/transaction-form.templates.test.tsx`.

**Interfaces (produces):**
```ts
export const resolveDraftReferences: (draft: TemplateDraft, options: {
  primaryIds: ReadonlySet<string>; exchangeIds: ReadonlySet<string>; returnIds: ReadonlySet<string>; categoryKeys: ReadonlySet<string>;
}) => TemplateDraft; // the id sets come from buildPrimaryOptions / buildExchangeOptions / buildReturnOptions and the categories list
// hydration: seedFields replaces `sign: Sign` with `mode: FormMode` and gains optional
// destinationHoldingId, valueIn, returns, templateName and clearsHolding; resolveHydration gains
// templateDraft: TemplateDraft | null, templateName: string | null
```
The plan rules:
- The template branch runs before the default-holding branch.
- A resolved `draft.holdingId` that differs from the seam gives `seedHolding(draft.holdingId, final: false)`. After that, `seedFields` runs once the holding has loaded.
- A null `draft.holdingId` gives `seedFields` at once, with `clearsHolding = true`: a null template holding always clears the seam (`setPrimaryHoldingId(null)`).
- Amounts become text with `groupAmount(majorAmountText(draft.currency, minor))`, and Value in uses `exchange.destinationCurrency`. A null amount or currency gives `''`. `time` is always null.
- A non-null category also sets `userPickedCategory` (O12).
- A pick is an event: `setPickedDraft(...)` plus `setHydrated(false)`. There is no second effect.

- [ ] **step 1/6:** Write the failing pure tests:
  - `resolveDraftReferences`: a deleted, closed or synced holding becomes null in each slot. A missing category becomes null.
  - `resolveHydration`: the two steps for a resolved holding. One step for a null holding, with `clearsHolding` true. Exact text for UAH 105000 ("1 050"), JPY 1050 and BTC 12345678. A re-pick to a different holding seeds that holding first.
  - The Duplicate and Edit plans `toEqual` today's values, with `mode` in place of `sign`, no destination, `valueIn: ''` and one empty return (Review Focus 2).
- [ ] **step 2/6:** Write the failing screen tests in `transaction-form.templates.test.tsx`. Each mounts the form with `{ templateId }` (the tabs come in task 12/18) and mocks `transactionTemplatesRepo.getByIdQuery` in the existing `useLiveQuery` mock pattern. Cover: each mode fills with the date at now; on `{}`, a null holding leaves the holding picker empty; a seeded category is not replaced by the description pre-select (`userPickedCategory`); a dangling destination leaves Destination empty.
- [ ] **step 3/6:** Run `npx jest src/screens/forms/transaction-form`. Expected: FAIL.
- [ ] **step 4/6:** Implement.
- [ ] **step 5/6:** Run `npx jest src/screens/forms/transaction-form && npx tsc --noEmit && npm run check:feature-imports`. Expected: PASS, with `transaction-form.screen.test.tsx` unchanged and green.
- [ ] **step 6/6:** Commit `feat(transaction-form): fill from a template through the hydration plan`. Safety: no caller passes the new params yet, so nothing new is reachable.

### transaction-templates task 10/18: Add-template and Edit-template modes (developer)

**Estimate:** 70–110 min. Source: duration log "Round C w2 dev round, 22 mutable, 90 min". No exact row exists.

**Files:**
- Modify: `validation/validation.ts` (`SaveDisabledField` += `'templateName' | 'holding'`; `SaveDisabledParams` += `primaryHoldingId`, `templateName`, `templateNameRequired`, `isTemplateMode`, `templateNames: readonly { id: string; name: string }[]` and `editTemplateId`; new `templateModeFieldErrors`, where an amount is checked only when filled and the destination, return holding and category are optional; `holding` is required in every mode; the order is `templateName` first in the template modes and last when the toggle is on), `field-group/` (`showsDate?: boolean`, default true), `mode-and-actions/` (Edit-template footer: Save plus the secondary **Create transaction**), `row-labels/row-labels.ts` (`headerTitle` gets the template titles), `transaction-form.screen.tsx` (template mode: name field on top, no toggle; Save calls `transactionTemplatesRepo.create` or `update`, then `goBack`, and maps `TemplateNameTakenError` to the taken error; Create transaction calls `navigation.push('TransactionForm', { templateId })` and uses the template as stored (O6); the override sheet never opens; `push` is added to the navigation prop), `src/i18n/locales/en.ts`, `uk.ts`, `title-keys.ts`
- Create: `draft-from-form/draft-from-form.ts` and its test, `template-name-field/` (component: a `TextField` with a `FieldError`, used by both the template modes and the toggle)
- Tests: `validation/validation.test.ts` (extend it), `transaction-form.templates.test.tsx` (extend it)

**Interfaces (produces):** `draftFromForm(state: { mode; primaryHoldingId; currency; amount; description; prefilledLabel; selectedCategory; destinationHoldingId; destinationCurrency; valueIn; changeReturns }) => TemplateDraft`. It follows the save rules: `storedDescription`, the lowercase category, `Money.fromMajor` with the holding's currency, an empty amount as null, and only returns with a holding or an amount. It has no loan and no comment field.

**Strings:** `templateName`, `templateNamePlaceholder`, `templateNameError`, `templateNameTakenError`, `selectHoldingError`, `createTransaction`, `addTemplateTitle`, `editTemplateTitle` (the last two go in `TITLE_KEYS`).

- [ ] **step 1/5:** Write the failing tests:
  - `draftFromForm`: one case per mode. An exchange stores no category or description. A split keeps a return row with a holding and no amount. An Edit-sourced income gives a plain income draft.
  - Validation: in template modes only `templateName` and `holding` block. A filled amount of 0 blocks. Every error shows only after `attemptedSave`. Manual mode with a null holding gives `selectHoldingError`.
  - Screen: `{ newTemplate: true }` has no date row, no toggle and no loan field, and the title is "Add Template". Save with only a name and a holding calls `create`. A taken name (" оренда " against "Оренда") shows the taken error and never calls `create`. `{ editTemplateId }` fills the name and fields, and Save calls `update`. Create transaction calls `push('TransactionForm', { templateId })` with the stored template, not the unsaved edits.
- [ ] **step 2/5:** Run `npx jest src/screens/forms/transaction-form`. Expected: FAIL.
- [ ] **step 3/5:** Implement and add the strings (uk REVIEW).
- [ ] **step 4/5:** Run `npx jest src/screens/forms/transaction-form src/i18n && npx tsc --noEmit`. Expected: PASS.
- [ ] **step 5/5:** Commit `feat(transaction-form): add and edit template modes`. Safety: no caller passes `newTemplate` or `editTemplateId` until task 14/18.

### transaction-templates task 11/18: the "Save as a new template" toggle (developer)

**Estimate:** 45–70 min. Source: duration log "cleanup 13/15, 51 min" and "Round C task 2/14, dev 58 min".

**Files:**
- Create: `src/screens/forms/transaction-form/save-as-template/` (component: a `Switch` with a `label`, as in `term-deposit-section.component.tsx:204`, with `<TemplateNameField />` below it when it is on; props, test and `index.ts`)
- Modify: `transaction-form.screen.tsx` (render after the comment row; it shows on Add, Duplicate and a manual Edit, and hides on a read-only row and while converting (O4); with the toggle on, `writeManual`, `saveSplit` and `saveExchange` pass `alongside: (databaseTransaction) => transactionTemplatesRepo.insertDatabaseTransaction(databaseTransaction, { name, draft: draftFromForm(...) })`), `en.ts`, `uk.ts`
- Tests: `save-as-template.component.test.tsx`, `transaction-form.templates.test.tsx` (extend it)

**Strings:** `saveAsTemplate`.

- [ ] **step 1/5:** Write the failing tests:
  - Component: off by default, and the name field shows only when it is on.
  - Screen: on Add, Duplicate and Edit, toggle on plus Save calls the write once, with an `alongside` that inserts the expected draft. With the toggle off, no `alongside` is passed. The toggle is hidden on a monobank row, an imported row and in convert. An Edit of a loan-linked row writes a draft with no loan key and the row keeps its link. An empty name, or a taken name, blocks Save, shows its error and scrolls to it last in the order. A rejected `alongside` shows the shared save-error alert and leaves the form open (Review Focus 4).
- [ ] **step 2/5:** Run `npx jest src/screens/forms/transaction-form`. Expected: FAIL.
- [ ] **step 3/5:** Implement and add the string.
- [ ] **step 4/5:** Run `npx jest src/screens/forms/transaction-form src/i18n && npx tsc --noEmit`. Expected: PASS.
- [ ] **step 5/5:** Commit `feat(transaction-form): save as a new template`. Safety: this is reachable, works alone and writes atomically. The templates it writes become usable in task 12/18 and editable in CS5, which merges together with CS4.

### transaction-templates task 12/18: Manual and Template tabs on Add (developer)

**Estimate:** 45–70 min (same source as 11/18).

**Files:**
- Create: `src/screens/forms/transaction-form/template-select/` (component: `SelectField` + `BottomSheet`, as the category picker does, over `transactionTemplatesRepo.listQuery()`; the `InfoHint` when the list is empty)
- Modify: `transaction-form.screen.tsx` (a `SegmentedControl` at the top, on `{}`, `{ holdingId }` and `{ templateId }` only; before a pick, the Template tab shows only the select, with no fields and no Save; a pick calls the task 9/18 pick event; a tab switch keeps the values (O2); `{ templateId }` opens on Template with that template picked), `en.ts`, `uk.ts`, `title-keys.ts`
- Tests: `template-select.component.test.tsx`, `transaction-form.templates.test.tsx` (extend it)

**Strings:** `tabManual`, `tabTemplate`, `entryModeLabel`, `template`, `templateSheetTitle` (in `TITLE_KEYS`), `selectTemplate`, `noTemplatesHint`.

- [ ] **step 1/5:** Write the failing tests: the tabs show on `{}` and `{ holdingId }` and are absent on Duplicate, Edit and both template modes. Manual is the default. Template before a pick shows no Save. Zero templates show the hint. A pick fills, and a second pick fills again from the new template. Back to Manual keeps the values. On `{ holdingId }`, a resolved template holding replaces the page holding and a null one keeps it (Review Focus 3). `{ templateId }` opens picked.
- [ ] **step 2/5:** Run `npx jest src/screens/forms/transaction-form`. Expected: FAIL.
- [ ] **step 3/5:** Implement and add the strings.
- [ ] **step 4/5:** Run `npx jest src/screens/forms/transaction-form src/i18n && npx tsc --noEmit && npm run check:all`. Expected: PASS.
- [ ] **step 5/5:** Commit `feat(transaction-form): manual and template tabs`. Then: `kiko:reviewer` reviews the CS4 diff (top question: "does any template path change the Duplicate, Edit or Manual behavior, and is there exactly one fill path?"), `make verify` runs until it is green, `KIKO_MUTATION_BASE=<CS4 base> make mutable` (expected ~12), and BATCH READY. After its gate, **CS4 is held** and merges with CS5 and CS6.

### transaction-templates task 13/18: `TransactionCard` with an optional amount (designer)

**Estimate:** 20–35 min. Source: duration log "cleanup 14/15, 1 mutable, 31 min".

**Files:**
- Modify: `src/design-system/components/transaction-card/transaction-card.props.d.ts` (`money?: Money`), `transaction-card.component.tsx` (no `MoneyText` when `money` is absent, and the title row keeps its layout), `transaction-card.component.test.tsx`, `.claude/skills/kiko-design-system/SKILL.md` (the TransactionCard entry, in the same task)

- [ ] **step 1/3:** Write the failing test: without `money`, there is no amount text and the title and footer still render. With `money`, the output is unchanged (the existing tests stay green). Run `npx jest src/design-system/components/transaction-card`. Expected: FAIL.
- [ ] **step 2/3:** Implement and update the skill entry. Run the same command plus `npx tsc --noEmit`. Expected: PASS.
- [ ] **step 3/3:** Commit `feat(design-system): TransactionCard amount is optional`.

### transaction-templates task 14/18: templates list screen and Settings stack routes (developer)

**Estimate:** 50–80 min. Source: the onboarding "Help & Tips screens and Settings row" task (5 mutable). Duration log "cleanup 13/15, 51 min".

**Files:**
- Create: `src/screens/settings/transaction-templates/` (`transaction-templates.screen.tsx`, `transaction-templates.screen.test.tsx`, `index.ts`)
- Modify: `src/holdings/entity-symbols/entity-symbols.ts` (`genericEntitySymbol.template = 'doc.on.doc'`), `src/navigation/types/types.d.ts` (`SettingsStackParamList` += `TransactionTemplates: undefined`, `TransactionForm: TransactionFormParams`, `AccountForm` and `HoldingForm`, with the Home types), `src/navigation/settings-stack/settings.stack.tsx` (register the four screens; the three forms use the same options and listeners as `home.stack.tsx:38–66`), `settings.stack.test.tsx`, `en.ts`, `uk.ts`, `title-keys.ts`

**Interfaces:** The list reads `useLiveQuery(transactionTemplatesRepo.listQuery(), ['transaction_templates'])`, mapped through `toTransactionTemplate` and gated on `useDataReady`. Each card is a `CardContextMenu` (`name`, `deletable`, `onEdit`, no `deleteMessage`; the delete calls `transactionTemplatesRepo.remove` behind a `common.deleteNamed` confirm) around a `TransactionCard`: the title is the template name, the icon tile is the category's (or a neutral tile when there is none), `footerMeta` is "holding · type", and `money` is set only when an amount and a currency are stored. A tap navigates `TransactionForm { editTemplateId }`. The footer "Add template" opens `{ newTemplate: true }` (as in `accounts.screen.tsx:419–431`). With no templates, it shows `EmptyState` (`genericEntitySymbol.template`, title, message, action) and hides the footer.

**Strings:** `transactionTemplates.title` (in `TITLE_KEYS`), `transactionTemplates.addTemplate`, `transactionTemplates.empty.title`, `transactionTemplates.empty.message`.

- [ ] **step 1/5:** Write the failing tests:
  - Screen: no empty state while not ready. The empty state shows when ready with 0 templates, and its action opens `{ newTemplate: true }`. The cards come in `created_at` order. A card with an amount shows it, and one without shows none. A tap opens `{ editTemplateId }`. Context-menu Edit opens the same. Delete confirms, then calls `remove`.
  - Stack: `TransactionTemplates`, `TransactionForm`, `AccountForm` and `HoldingForm` are registered. An empty picker's "Add holding" from a Settings-opened form navigates `HoldingForm`.
- [ ] **step 2/5:** Run `npx jest src/screens/settings/transaction-templates src/navigation/settings-stack`. Expected: FAIL.
- [ ] **step 3/5:** Implement and add the strings.
- [ ] **step 4/5:** Run the step 2/5 command plus `npx jest src/i18n && npx tsc --noEmit && npm run check:screen-imports && npm run check:feature-imports`. Expected: PASS.
- [ ] **step 5/5:** Commit `feat(settings): transaction templates list`. Safety: the screen is registered, but no row opens it until task 15/18.

### transaction-templates task 15/18: Settings group card (developer)

**Estimate:** 25–40 min. Source: duration log "cleanup 14/15, 31 min".

**Files:**
- Modify: `src/screens/settings/settings/settings.screen.tsx` (the Categories card at :252–259 is replaced by `<Card testID="settings-card-templates-and-categories" padding={0}>`: first `settings-row-transaction-templates` (`genericEntitySymbol.template`, navigates `TransactionTemplates`), then the inset divider, then `settings-row-categories`; both rows use the data-transfer row style and the divider style from :205–224), `settings.screen.test.tsx` (the order assertions at :160, :193 and :562 use the new card id, per mismatch 6), `en.ts`, `uk.ts`

**Strings:** `settings.transactionTemplates`.

- [ ] **step 1/4:** Write the failing tests: the card holds both rows in order. Each row navigates. The card sits where the Categories card was (before `settings-card-help`).
- [ ] **step 2/4:** Run `npx jest src/screens/settings/settings`. Expected: FAIL.
- [ ] **step 3/4:** Implement. Run `npx jest src/screens/settings src/i18n && npx tsc --noEmit`. Expected: PASS.
- [ ] **step 4/4:** Commit `feat(settings): templates and categories group`. Then: `kiko:reviewer` reviews the CS5 diff (top question: Guideline 5.6, "is every template path reachable in a release build, with no flag?"), `make verify` runs until it is green, `KIKO_MUTATION_BASE=<CS5 base> make mutable` (expected ~5), and BATCH READY.

### transaction-templates task 16/18: category-delete confirm line (developer; follows decision O7)

**Estimate:** 20–35 min, plus the rebase time if branch (a) applies. Source: duration log "cleanup 14/15, 31 min".

The two tracks never edit this confirm in parallel. Pick exactly one branch from the state of `next` when CS4–CS6 merge:

- **(a) This track merges SECOND** (category-rules' confirm is already in `next`). This is the coordinator's rule: this step applies only in this case. `kiko:ops` rebases the track onto `next`, and `make verify` must be green. Then add the count line to the confirm that category-rules shipped (its context menu and its category edit form, category-rules spec §12), next to its `categories.deleteRulesNotice_*` line.
- **(b) This track merges FIRST.** This branch comes from spec §2 and decision 6, so the count still ships (mismatch 8). Add a `message` to today's `ConfirmSheet` (`src/screens/settings/categories/categories.screen.tsx:334–342`). category-rules keeps the line when it rebases.

**Files:** the confirm's screen file (branch (b): `categories.screen.tsx` and `categories.screen.test.tsx`), `en.ts`, `uk.ts`, `src/i18n/init/init.plural-rules.test.ts`

**Strings:** `categories.deleteTemplates_one/_few/_many/_other`.

- [ ] **step 1/5:** Write the failing test: when the confirm opens for a category that 2 templates use, `countReferencingCategory` is read and the confirm body says "This also clears it in 2 templates." With 0, there is no body (branch (b)) or no extra line (branch (a)). The uk text at 1, 2, 5 and 21.
- [ ] **step 2/5:** Run `npx jest src/screens/settings/categories src/i18n` (branch (a): the screen folder category-rules used). Expected: FAIL.
- [ ] **step 3/5:** Implement. The count is read when the confirm opens (as `removeHoldingsNoticeOf` does).
- [ ] **step 4/5:** Run the step 2/5 command plus `npx tsc --noEmit`. Expected: PASS. If branch (a) applies, also check boundary point 7: a template with a category, used through the Template tab, saves with category-rules' manual-pick flag set to 1. Write that as a test in `transaction-form.templates.test.tsx` with the repo mocked: the `recordManual` input carries the flag that category-rules derives from `userPickedCategory`.
- [ ] **step 5/5:** Commit `feat(categories): delete confirm counts templates`. Then the review, `make verify` and `KIKO_MUTATION_BASE=<CS6 base> make mutable` (expected 1), then BATCH READY. CS4, CS5 and CS6 merge into `next` together.

### transaction-templates task 17/18: translation review (coordinator, then the user; the developer applies edits)

**Estimate:** 10–20 min of agent time, plus the user's time.

**Files:** `src/i18n/locales/en.ts`, `uk.ts` (edits only if the user asks for them)
- [ ] **step 1/3:** The coordinator sends the user `git diff <CS1 base>..HEAD -- src/i18n/locales/`. Every uk entry is marked REVIEW. Call out two points: the account delete reusing the "it" sentence (`holdings.deleteLinked.templates`, spec §8: an account-specific twin key if the user wants "them"), and `transactionTemplates.addTemplate` ("Add template", button) beside `addTemplateTitle` ("Add Template", nav title).
- [ ] **step 2/3:** The developer applies the user's wording and runs `npx jest src/i18n`. Expected: PASS.
- [ ] **step 3/3:** Commit `fix(i18n): transaction templates wording per review` (skip it if there are no edits).

### transaction-templates task 18/18: verify, whole-branch review and device check (ops, reviewer, coordinator)

**Estimate:** verify 7–9 min on a quiet machine (duration log "merge-result verifies"), review 15–30 min.

- [ ] **step 1/4:** `kiko:ops` runs `bash scripts/wait-load.sh 8 && env -u FORCE_COLOR make verify` in the worktree in the background and waits only for its exit code. Fix and re-run until it is green.
- [ ] **step 2/4:** `kiko:reviewer` reviews the whole branch (`git diff main...transaction-templates`): correctness, conventions, compliance (5.6: nothing hidden, no new permission) and the Review Focus list. Fix Critical and Important findings, then re-run `make verify`.
- [ ] **step 3/4:** The coordinator checks that every change set has its `make deep` result in the run log (none is run over the whole branch). Then `kiko:retrospect` and `kiko:scribe` handle skill drift: kiko-architecture (the new table, `alongside`), kiko-domain (templates, the clear-on-delete rule), kiko-design-system (`TransactionCard` optional `money`) and kiko-code-style (the transaction-form unit layout). The report names the drift-fix sha.
- [ ] **step 4/4:** The user checks it live on a device (memory `ui-changes-need-device-confirm-vs-intent`): the tabs, the toggle, the Settings group, the list, both template modes, and the holding and category delete confirms.

---

## Strings (en / uk; every uk text is **REVIEW**)

The text is the spec §8 table, verbatim. Task column: the task that adds the key.

| Key | Task | en | uk (REVIEW) |
|---|---|---|---|
| `holdings.deleteLinked.templates_one` | 7 | This also clears it in {{count}} template. | Також його буде очищено в {{count}} шаблоні. |
| `holdings.deleteLinked.templates_few` / `_many` | 7 | This also clears it in {{count}} templates. | Також його буде очищено в {{count}} шаблонах. |
| `holdings.deleteLinked.templates_other` | 7 | This also clears it in {{count}} templates. | Також його буде очищено в {{count}} шаблону. |
| `forms.transaction.templateName` | 10 | Template name | Назва шаблону |
| `forms.transaction.templateNamePlaceholder` | 10 | Rent | Оренда |
| `forms.transaction.templateNameError` | 10 | Enter a template name. | Введіть назву шаблону. |
| `forms.transaction.templateNameTakenError` | 10 | A template with this name already exists. | Шаблон із такою назвою вже існує. |
| `forms.transaction.selectHoldingError` | 10 | No holding selected. | Актив не вибрано. |
| `forms.transaction.createTransaction` | 10 | Create transaction | Створити транзакцію |
| `forms.transaction.addTemplateTitle` | 10 | Add Template | Додати шаблон |
| `forms.transaction.editTemplateTitle` | 10 | Edit Template | Редагувати шаблон |
| `forms.transaction.saveAsTemplate` | 11 | Save as a new template | Зберегти як новий шаблон |
| `forms.transaction.tabManual` | 12 | Manual | Вручну |
| `forms.transaction.tabTemplate` | 12 | Template | Шаблон |
| `forms.transaction.entryModeLabel` | 12 | Entry mode | Спосіб введення |
| `forms.transaction.template` | 12 | Template | Шаблон |
| `forms.transaction.templateSheetTitle` | 12 | Template | Шаблон |
| `forms.transaction.selectTemplate` | 12 | Select a template | Оберіть шаблон |
| `forms.transaction.noTemplatesHint` | 12 | No templates yet. Turn on "Save as a new template" when you save a transaction. | Шаблонів ще немає. Увімкніть «Зберегти як новий шаблон», коли зберігаєте транзакцію. |
| `transactionTemplates.title` | 14 | Transaction Templates | Шаблони транзакцій |
| `transactionTemplates.addTemplate` | 14 | Add template | Додати шаблон |
| `transactionTemplates.empty.title` | 14 | No templates yet | Шаблонів ще немає |
| `transactionTemplates.empty.message` | 14 | Save a transaction you enter often as a template, then add it again in a few taps. | Збережіть транзакцію, яку вводите часто, як шаблон, і додавайте її знову кількома дотиками. |
| `settings.transactionTemplates` | 15 | Transaction templates | Шаблони транзакцій |
| `categories.deleteTemplates_one` | 16 | This also clears it in {{count}} template. | Також її буде очищено в {{count}} шаблоні. |
| `categories.deleteTemplates_few` / `_many` | 16 | This also clears it in {{count}} templates. | Також її буде очищено в {{count}} шаблонах. |
| `categories.deleteTemplates_other` | 16 | This also clears it in {{count}} templates. | Також її буде очищено в {{count}} шаблону. |

Nav titles go in `title-keys.ts` (`addTemplateTitle`, `editTemplateTitle`, `templateSheetTitle`, `transactionTemplates.title`). The casing, final-stop and `TITLE_KEYS` call-site tests run in `npx jest src/i18n` in each task that adds keys.

## Self-review against the spec

- §1 data model and the read rule: tasks 3, 4 and 6. `resolveDraftReferences`: task 9. §2 deletes and counts: tasks 7 and 16. §3.0 split: tasks 1 and 2. §3.1 tabs: task 12. §3.2 fill: task 9. §3.3 toggle: task 11. §3.4 and §3.5 modes: task 10. §3.6 validation: tasks 10 and 11. §4 navigation and Settings: tasks 9, 10, 14 and 15. §5 data transfer: task 4. §6 atomicity: tasks 8 and 11. §7 testing: in each task. §8 strings: the table above. Boundary: tasks 2 (units), 7 (`categories.repo`), 16 (O7 and point 7).
- The out-of-scope items get no task (no loan, comment, date, Convert toggle, reorder or quick actions).
