# Category rules — design, 1.2
Status: SPEC, APPROVED by the user 2026-10-11 ~05:05 (track category-rules, base main 1f7a26a4).

## User rulings (approved 2026-10-11, unchanged here)
1. A category has MANY rules. A rule has ONE OR MORE matchers. ALL matchers of a rule must match (AND). An OR is a second rule for the same category.
2. Matchers: name is exactly; name starts with (both on `normalizeTransactionName`); amount `=`, `>`, `>=`, `<`, `<=` as an ABSOLUTE amount WITH a currency (500 UAH never matches 500 USD); direction expense / income; time of day before / after (device time zone, DST-safe).
3. Priority between rules of different categories: MORE matchers wins; a tie -> the NEWEST rule wins. No manual ordering.
4. Rules apply (a) at the insert of every synced / imported row, where a matching rule REPLACES the bank (MCC) category, and (b) in the manual transaction form as a pre-select from the draft (name, amount, time, direction). A category the user chose by hand is never replaced.
5. Saving a NEW or CHANGED rule shows "This changes N transactions" with "Apply to existing" / "New transactions only". The rewrite changes ONLY rows where this rule wins under ruling 3, and NEVER a row whose category the user chose by hand. A deleted rule changes no row.
6. A manual-pick flag on transactions marks a category chosen by hand ("Apply to this one" / a manual edit). Rules and rewrites never touch a flagged row. Existing rows get no flag.
7. The change-category sheet and its same-name rewrite stay, but "Apply" now creates a RULE with one "name is exactly" matcher.
8. Categories screen: cards like the Accounts list; a tap opens a CATEGORY PAGE (rules as cards, "Add rule"; Edit = name / icon / colour); a tap on a rule opens the rule editor (matcher list, "Add matcher").
9. Rules and the flag go into the `.kiko` export; an OLD backup's `category_overrides` rows restore as rules.

## 1. Goal, scope, non-goals
Goal: the user sets categories by rules that are richer than "same name", and the rules run on every new synced or imported row and in the form.

In scope: the `category_rules` table and migration, the manual-pick flag, the pure rule-evaluation module, the insert path, the retroactive rewrite and its confirm sheet, the suggestion flow on the change-category sheet, the Categories list redesign, the category page, the category edit form, the rule editor, export/restore, category delete of rules, the form pre-select (LAST, after the form split).

Non-goals (owned by transaction-templates): the transaction form SPLIT, its tabs and toggle, the Settings menu group change (Categories moves into a new group beside Transaction templates). No manual rule order. No rule on a field other than the five matcher types. No rule import/export outside `.kiko`.

## 2. Code facts (main 1f7a26a4)
- Insert path: `withCategoryOverrides` (`src/transactions/repo/transactions.repo.ts:1383-1408`) reads `category_overrides` by normalized name in chunks of `IN_CLAUSE_CHUNK_SIZE` (32 000, `:993`) and replaces `category` on a name match. Two callers:
  - `adoptImportTwinsDatabaseTransaction` (`:1477-1504`): a new sync row adopts its statement-import twin; `adoptedValuesOf` (`:1453-1465`) keeps `twin.category ?? input.category`.
  - `upsertDedupRowsDatabaseTransaction` (`:1509-1550`): the upsert; on conflict it refreshes only `BANK_OWNED_TRANSACTION_COLUMNS` (`:1334-1344`), never `category`, so a rule reaches only NEW rows.
  - Its callers: `transactionsRepo.addManyDedup` (`:2589-2601`) for Monobank (`src/monobank/sync/sync.ts:903`) and Binance (`src/crypto-sync/binance/binance.transactions.ts:147`); `insertDedupRowsDatabaseTransaction` (`:1561-1575`) from `transactionsRepo.importRows` (`:2785`) for statement import (`src/statement-import/import-statement/import-statement.ts:182`). No other importer writes rows (btc_wallet writes none, `src/db/schema.ts:248-252`).
- Manual writes never apply rules: `recordManualTransaction` (`transactions.repo.ts:217-263`, used by `recordManual`, `recordManualWithReturns`, the exchange legs) writes the form's category as given.
- Bank category: `categoryForMcc` (`src/monobank/mcc-category/mcc-category.ts:69`), set at `sync.ts:263` and `statement-import/mapping/mapping.ts:118`. Binance rows carry no category. The MCC stays on the row (`transactions.mcc`), so the bank category stays derivable after a rule replaced it.
- `category_overrides` (`src/db/schema.ts:597-603`, created in `drizzle/migrations/0007_robust_karen_page.sql`, lowercased by `0014`): `normalized_name` PK, `category`, `display_name`, `created_at`, `updated_at`.
- `categoryOverridesRepo.upsertCategoryOverride` (`src/categories/category-overrides-repo/category-overrides.repo.ts:29-63`): blank key -> no-op; upsert by `normalized_name`; then `selectDistinct(description)` over all rows, JS filter by normalized name, one `UPDATE ... WHERE description IN (...)`. That last IN list is NOT chunked (`:59-62`).
- `normalizeTransactionName` (`src/transactions/normalize-name/normalize-name.ts:8-9`): NFC, collapse whitespace, trim, full-Unicode lowercase. JS only, never SQL.
- Transactions (`schema.ts:127-300`): `amount_minor_units` is a SIGNED integer (negative = expense, positive = income; the form builds it in `signedMinorUnits`, `transaction-form.screen.tsx:213-217`); `time` is epoch ms; `holding_id` NOT NULL. The currency lives on the holding: `holdings.currency` is NOT NULL (`schema.ts:83`), so every stored row has a currency. Only a form draft with no holding has none. Minor-unit scale per currency: `currencyScale` / `Money.fromMajor` (`src/currency/money/money.ts`).
- Transfers: no transfer row type. Own-account transfers are excluded from spending by MCC / counter IBAN, NOT by category (`src/statistics/transfer-exclusion/transfer-exclusion.ts:19-20`). Exchange legs carry `exchange_pair_id` / `exchange_counterpart_holding_id`; split-change rows carry `change_group_id`; balance-setting rows carry `sets_balance`.
- Dates: device-zone wall clock is read with local `Date` getters (`src/dates/local-day.ts`); the hand-rolled zone rules (`src/dates/zone-wall-clock.ts`) serve SOURCE zones (Kyiv imports), not the device. Reminders store a time of day as `minuteOfDay` 0-1439 (`src/reminders/schedule/reminder-schedule.ts:15-22`); `TimeField` is `src/screens/forms/time-field/`.
- Categories (`schema.ts:572-588`): slug `key` PK, `title`, `icon`, `color`, `sort_order`; user categories get an `id()` key (`src/categories/repo/categories.repo.ts:44-55`). `categoriesRepo.delete` (`categories.repo.ts:81-113`) refuses the default, moves every transaction AND every override of the key to the default key, then deletes the row.
- Categories screen: `src/screens/settings/categories/categories.screen.tsx` (556 lines): a `Sortable.Grid` (`:524`) of inline-edit cards (icon, title, colour, Set as default, move top/bottom, Delete). Delete confirm: `openDeleteConfirm` / `removeCategory` (`:167-183`) and the `ConfirmSheet` (`:330-341`). Route `Categories` in `src/navigation/settings-stack/settings.stack.tsx:40-41`, type at `src/navigation/types/types.d.ts:227`.
- Accounts list (target look): `renderAccountCard` (`src/screens/accounts/accounts.screen.tsx:231-292`): `CardContextMenu` (hold = delete menu) around a `Card` with `EntityIconTile`, title + caption, tap navigates; `Sortable.Grid` single column (`:455-500`).
- Form (`src/screens/forms/transaction-form/transaction-form.screen.tsx`, 2852 lines): `ruleCategoryFor` (`:304-316`); the overrides live query (`:1652-1662`); `userPickedCategory` (`:1883`); `selectCategory` (`:2066-2069`); `reseatCategoryFromName` (create only, on description blur and suggestion tap, `:2081-2101`); `writeManual` (create writes `category: selectedCategory`, edit never writes category, `:2114-2150`); `applyOverride` ("Apply", `:2197-2212`); `applyOverrideOne` ("Just for this one", edit only, `:2232-2245`); `resolveCategoryOverrideRequest` (`:488-507`); `performSave` blank-name fallback `setCategory` (`:2501-2549`); the sheet (`:2775-2820`); strings `forms.transaction.applyCategoryToAll` / `applyCategoryMessage` / `applyToThisOne` (`src/i18n/locales/en.ts:524-528`).
- Export (`src/data-transfer/`): `EXPORT_VERSION = 2`, readable `[1, 2]` (`crypto/envelope.ts:13-22`); `envelope.test.ts:94-132` forces a version decision per migration. `DataSnapshot.categoryOverrides` (`snapshot/data-snapshot.d.ts:33`), read at `read-snapshot.ts:48-51`, restored at `restore-snapshot.ts:825, 891-892`; `REQUIRED_TABLE_KEYS` includes `categoryOverrides` (`import-data.ts:51-61`). `snapshot-covers-every-table.test.ts` fails on a table missing from the snapshot.
- Migrations: latest on main `0055_add_dismissed_tips`. Reserved: 0056 binance-pay-history, 0057 transaction-templates. This track: 0058. The runner applies each migration and its bookkeeping row in ONE transaction (`src/db/run-migrations.ts:80-98`).
- Guard: `kiko-no-full-table-select-in-write` (ERROR) denies a where-less select inside `write(...)` (kiko-architecture "No full-table select inside a write").

## 3. Data model

### 3.1 `category_rules`
| column | type | note |
|---|---|---|
| `id` | text PK | `id()` in JS; random hex in the migration |
| `category` | text NOT NULL | `categories.key` |
| `matchers` | text NOT NULL | JSON list, schema below |
| `created_at` | integer NOT NULL default now ms | |
| `updated_at` | integer NOT NULL default now ms | set on every edit |

Refinement of the proposal: NO `matcher_count` column. Reason: it is derivable from `matchers`, every reader loads all rules into JS anyway, and a second copy can drift (a restore, a hand-built test row). The priority sorts on the parsed list's length.

Indices: PK only. Reason: the table is small (hundreds of rows); every reader reads all of it, and the category page filters in JS. A secondary index would need an EXPLAIN QUERY PLAN test and buys nothing. No new index on `transactions` unless the measurement in section 10 misses the target (then: an index plan, an EXPLAIN QUERY PLAN test, a reviewer step).

Matcher JSON (one object per matcher):
```ts
type CategoryRuleMatcher =
  | { type: 'nameIs'; text: string }
  | { type: 'nameStartsWith'; text: string }
  | { type: 'amount'; operator: 'eq' | 'gt' | 'gte' | 'lt' | 'lte'; minorUnits: number; currency: Currency }
  | { type: 'direction'; direction: 'expense' | 'income' }
  | { type: 'time'; operator: 'before' | 'after'; minuteOfDay: number };
```
- `text` is the name as the user typed it (trimmed). It is normalized at evaluation time with `normalizeTransactionName`, so one normalization stays the only one. A migrated override's `text` is its `display_name` (by construction `normalize(display_name) === normalized_name`, `category-overrides.repo.ts:31-43`; the migration test pins it).
- `minorUnits` is a non-negative integer in the currency's own scale. `minuteOfDay` is an integer 0-1439.
- Read-time type guard `parseRuleMatchers(json): CategoryRuleMatcher[] | null`: rejects bad JSON, an empty list, an unknown `type`, a bad operator, a non-integer or negative amount, an unknown currency, an out-of-range minute, a blank normalized `text`. A rule that fails the guard never matches and is skipped by every reader; the category page shows it as unreadable with only Delete. The same guard runs on restore input.
- Editor validation (save refused, inline error): at least one matcher; a valid value per matcher; no two rules with the same matcher set (the error names the other rule's category; decision 9); no rule that can never match: two directions, two currencies, an empty amount range, or after >= before, with the hint to use two rules for a window over midnight (decision 8).

### 3.2 The manual-pick flag
`transactions.category_set_by_hand` integer (boolean) NOT NULL DEFAULT 0. Every existing row gets 0 (ruling 6).

| write | flag |
|---|---|
| "Just for this one" (`applyOverrideOne` -> `setCategory`) | set 1 |
| A manual edit of a row's category that writes by id (the blank-name fallback `setCategory`, `performSave`) | set 1 |
| "Apply" on the change-category sheet (rule created) | the source row: set 0 (it follows the rule; decision 4); on an edit where a stronger rule of another category out-ranks the new rule on that row, set 1 so the pick stays (decision 17) |
| A manual create or Duplicate whose category the user picked (`userPickedCategory` true), or an edit that writes a hand-picked category | set 1 (decision 4) |
| A manual create whose category came from the rule pre-select, or no category | 0 |
| A transaction from a template that carries a category | set 1; a template without a category gets the pre-select and 0 (decision 13) |
| Insert path (sync, import, adoption) | never set; an adopted import twin keeps its own flag (the column is not in `adoptedValuesOf`) |
| Re-sync refresh | never touched (not a bank-owned column) |
| Category delete (rows moved to the default) | cleared to 0 on the moved rows (decision 12) |
| Restore | as exported; a file without the key restores 0 |

`transactionsRepo.setCategory` gains the flag write. `update` (manual edit of amount/time/description) does not touch category or flag.

## 4. Migration 0058 (`0058_add_category_rules.sql`; number may be renumbered at merge)
One migration, statements in this order:
1. `CREATE TABLE category_rules (...)`.
2. `INSERT INTO category_rules (id, category, matchers, created_at, updated_at) SELECT lower(hex(randomblob(16))), category, json_array(json_object('type', 'nameIs', 'text', display_name)), created_at, updated_at FROM category_overrides;` (single-quoted literals, per `SQLITE_DQS=0`).
3. `ALTER TABLE transactions ADD category_set_by_hand integer DEFAULT 0 NOT NULL;`
4. `DROP TABLE category_overrides;`

Crash safety: the runner commits all four statements and the bookkeeping row in ONE transaction (`run-migrations.ts:90`), so a crash leaves the database at the previous count and the whole migration retries. The SQL header still states the copy -> commit -> drop order (memory crash-safe-migration-ordering) so no edit reorders it. Drizzle schema: add `categoryRules`, add the column, remove `categoryOverrides`; regenerate the snapshot and journal with drizzle-kit and re-check `migrations.js`.

Tests (`drizzle/migrations/0058-add-category-rules.test.ts`, real `node:sqlite` through `applyMigrationsThrough`):
- Each override becomes exactly one rule: same `category`, `created_at`, `updated_at`; `matchers` parses through `parseRuleMatchers` to one `nameIs` whose `text` is `display_name`; `normalizeTransactionName(text) === normalized_name` for Cyrillic, mixed case and inner whitespace.
- Zero overrides -> zero rules. `category_overrides` is gone. Ids are unique.
- `category_set_by_hand` exists, NOT NULL, default 0; every existing row reads 0.
- No new index, so no EXPLAIN QUERY PLAN test is needed for 0058. If the plan adds one, it adds that test.
- `envelope.test.ts` version decision updated (section 9).
- A `kiko:reviewer` step reviews the migration before BATCH READY (memory every-migration-gets-a-review).

## 5. Pure rule-evaluation module
Location: `src/categories/category-rules/` (pure, no DB import). One source of truth for the insert path, the form and the rewrite.

```ts
type RuleSubject = {
  normalizedName: string;            // normalizeTransactionName(description)
  absoluteMinorUnits: number | null; // |amount|; null = unknown (blank draft)
  currency: Currency | null;         // holding currency; null = draft with no holding
  direction: 'expense' | 'income' | null; // stored row: sign (0 -> null); draft: the mode
  minuteOfDay: number | null;        // device-zone wall clock of `time`
};
prepareRules(rows): PreparedRule[]   // parse, normalize texts, sort by priority
winningRule(prepared, subject): PreparedRule | undefined // first match in priority order
```
- AND: a rule matches when every matcher matches. A matcher whose subject field is null does not match.
- `nameIs`: `normalizedName === normalize(text)`. `nameStartsWith`: `normalizedName.startsWith(normalize(text))`. A blank `normalizedName` matches no name matcher.
- `amount`: `currency === matcher.currency` AND the operator holds on `absoluteMinorUnits` vs `minorUnits`. Integer compare, no floats.
- `direction`: `amount < 0` -> expense, `> 0` -> income, `0` -> neither (decision 7).
- `time`: `minuteOfDay = getHours() * 60 + getMinutes()` of `new Date(time)` in the device zone. `before` = strictly earlier than the value; `after` = at or later than the value, so "before X" and "after X" split the day with no gap and no overlap. A wall-clock read is DST-safe: 18:30 on a 23- or 25-hour day is 1110. The zone is the device zone at evaluation time (insert, rewrite or form).
- Priority sort (total order, deterministic): matcher count DESC, then `updated_at` DESC, then `created_at` DESC, then `id` DESC (string compare). "Newest" = `updated_at` (decisions 1 and 2). The first matching rule in that order wins; rules of the same category tie harmlessly.
- `prepareRules` is called once per batch / per rewrite / per form rule-set change, never per row.

## 6. Scenario matrix (each row becomes a test before the code)
Amounts in major units; a row is a stored transaction unless marked "draft". "was:" = the result today (overrides), where the new ruling differs or the case is new.

### 6.1 Money, direction and time matchers
| # | rule | subject | expected | was: |
|---|---|---|---|---|
| M1 | amount = 500 UAH | -500.00 UAH | match | new |
| M2 | amount = 500 UAH | +500.00 UAH | match (absolute) | new |
| M3 | amount = 500 UAH | -500.00 USD | no match | new |
| M4 | amount = 500 UAH | -500.01 UAH | no match | new |
| M5 | amount > 500 UAH | -500.00 / -500.01 UAH | no / match | new |
| M6 | amount >= 500 UAH | -500.00 / -499.99 UAH | match / no | new |
| M7 | amount < 500 UAH | -500.00 / -499.99 UAH | no / match | new |
| M8 | amount <= 500 UAH | -500.00 / -500.01 UAH | match / no | new |
| M9 | amount = 0 UAH | 0.00 UAH | match | new |
| M10 | amount < 500 UAH | 0.00 UAH | match | new |
| M11 | direction expense / income | 0.00 UAH | no / no (decision 7) | new |
| M12 | direction expense | -1.00 / +1.00 | match / no | new |
| M13 | direction income + amount >= 1000 UAH | +1000.00 UAH | match | new |
| M14 | direction expense + amount >= 1000 UAH | +1000.00 UAH | no (sign vs direction) | new |
| M15 | amount = 0.001 BTC | -0.00100000 BTC (100 000 sats) | match (currency scale) | new |
| M16 | amount = 500 UAH | draft, no holding picked (currency null) | no | new |
| M17 | nameIs "Silpo" | draft, no holding picked | match (no amount matcher) | match |
| M18 | amount = 500 UAH | draft, amount blank | no | new |
| M19 | direction expense | draft, mode expense, amount blank | match | new |
| M20 | time before 09:00 | 08:59 / 09:00 local | match / no | new |
| M21 | time after 18:00 | 17:59 / 18:00 local | no / match | new |
| M22 | time after 18:00 | 18:30 local on the DST switch day | match (minute 1110) | new |
| M23 | after 22:00 + before 06:00 | 23:00 | the editor refuses to save it (never matches); the user makes two rules (decision 8) | new |
| M24 | nameIs "silpo" | "  SILPO  " / "Сільпо" vs rule "СІЛЬПО" | match / match | match / match |
| M25 | nameStartsWith "silpo" | "Silpo Market 12" / "Mega Silpo" | match / no | new |
| M26 | nameIs "x" | blank description | no | no |
| M27 | amount = 500 UAH | own-account transfer row, MCC 4829, -500.00 UAH | match; category changes; still excluded from spending (MCC-keyed) | new |
| M28 | any | holding with no currency | not reachable: `holdings.currency` is NOT NULL | — |

### 6.2 Priority and application
| # | situation | expected | was: |
|---|---|---|---|
| P1 | R1 (food, 1 matcher) and R2 (shops, 2 matchers, older) both match | R2 wins | new |
| P2 | R1 (food) and R2 (shops), 1 matcher each, R2 `updated_at` later | R2 wins | new |
| P3 | as P2, equal `updated_at`, R1 `created_at` later | R1 wins | new |
| P4 | as P3, equal `created_at` too | larger `id` wins (deterministic) | new |
| P5 | Monobank insert, MCC 5411 (bank: groceries), R (nameIs "silpo" -> food) matches | food | food (override) |
| P6 | Monobank insert, no rule matches | bank category (groceries) | same |
| P7 | Binance insert, rule matches | rule category (bank gives none) | same for a name override |
| P8 | Re-sync refresh of an existing row | category unchanged, except a refresh that changes the amount of an unflagged row: re-evaluated, written only when a rule wins (decision 6) | unchanged |
| P9 | Sync adopts an import twin with a category | twin's category and flag kept | twin's category kept |
| P10 | Rewrite, row flagged | untouched | was: same-name rewrite overwrote it |
| P11 | Rewrite, saved rule wins, row category differs | changed, counted in N | — |
| P12 | Rewrite, saved rule wins, row already has its category | unchanged, not counted | — |
| P13 | Rewrite, saved rule matches but a stronger rule wins | unchanged, not counted | — |
| P14 | Edited rule no longer matches a row it set before | unchanged (never revert; decision 3) | — |
| P15 | Rule deleted | no row changes | was: override deletion n/a (no UI) |
| P16 | Form create, rule matches, user has not picked | pre-selected | pre-selected (name only, on blur) |
| P17 | Form create, user picked a category, then a rule starts to match | user's pick stays | same |
| P18 | Form create, pre-selected, then the draft stops matching | cleared to none | same (`reseatCategoryFromName`) |
| P19 | Form edit of an existing row | no pre-select | same |
| P20 | Suggestion "Apply" on name "Silpo" -> food; today's data (no flags, one-matcher rules) | same rows change as today | rows named "silpo" |
| P21 | Rewrite, row is an exchange leg / balance-setting row / split-change row | untouched (decision 5) | name rewrite could touch it |
| P22 | Category deleted that has rules | rules deleted; rows move to the default with the flag cleared (decision 12) | was: overrides moved to the default |

## 7. Application points

### 7.1 Insert path
`withCategoryOverrides` becomes `withCategoryRules(databaseTransaction, batch)`, same two callers.
- Reads all rules once per batch (one full read of `category_rules`, a documented `nosemgrep` exception with `OVERRIDE(...)` and an entry in `docs/harness/documented-exceptions.md`; decision 10, no rule cap) and the currencies of the batch's distinct `holdingId`s (one `WHERE id IN (...)` read).
- For each row: build the `RuleSubject`; a winner replaces `category`. No winner keeps the bank category. The flag is never set here.
- Applies to every row the upsert inserts; a conflict refresh never writes `category` (unchanged contract, `transactions.repo.ts:1526-1534`), except one case: a refresh that changes the amount of an unflagged row re-evaluates it, and writes `category` only when a rule wins (decision 6).

### 7.2 Form pre-select (LAST task, on top of the split)
After the split merges; the unit layout is fixed only then. Unit names from the transaction-templates spec (5a1a65ed, not yet approved): `category-rule/` (`ruleCategoryFor`, `resolveCategoryOverrideRequest`, `resolvePendingCategory`), `use-category-pick/` (`selectedCategory`, `userPickedCategory`, `selectCategory`, `reseatCategoryFromName`, `onDescriptionBlur`, `pickSuggestion`), `use-category-override/` (`pendingOverride`, `applyOverride`, `applyOverrideOne`, `cancelOverride`, `pendingCategory`), `category-override-sheet/` (the sheet JSX). `validation/` is shared: this track adds only its own `SaveDisabledField` keys there (none planned).
- `category-rule/`: `ruleCategoryFor(description, map)` becomes `ruleCategoryFor(subject, preparedRules)` over the pure module (section 5).
- `use-category-pick/`: subscribes to `category_rules` (live query) and calls `prepareRules` in a memo. On create, when `userPickedCategory` is false, re-evaluates when a draft field settles: description blur, suggestion tap, amount change, time change, mode (direction) change, holding change. The result (or none) seats the category, as `reseatCategoryFromName` does today.
- A category seeded by Duplicate or by a template sets `userPickedCategory` (transaction-templates' design), so the pre-select never replaces it.
- Never on an edit, never in exchange mode, never once the user picked.

### 7.3 Retroactive rewrite
- Trigger: Save in the rule editor of a NEW rule, or of a rule whose matchers or category changed. A save that changes nothing writes nothing.
- One shared function `planRuleRewrite(rules, savedRule, rows)` returns the ids to change: eligible rows (flag 0; not an exchange leg, a balance-setting row or a split-change row, decision 5) where `winningRule` over ALL rules (the saved one included, as saved) is the saved rule AND the row's category differs from the rule's category.
- N = the length of that list. The sheet: "This changes N transactions" / "Apply to existing" / "New transactions only" / Cancel (returns to the editor, nothing saved). N = 0 -> no sheet, save directly (decision 11).
- "Apply to existing": ONE `write`: save the rule, re-plan on the rows as they are inside the write (so the result is exact even if a sync landed between the count and the tap), `UPDATE transactions SET category = ? WHERE id IN (chunk) AND category_set_by_hand = 0` per `IN_CLAUSE_CHUNK_SIZE` chunk. A test pins: on unchanged data the updated-row count equals N.
- "New transactions only": save the rule only.
- What it can and cannot recompute: it only writes the saved rule's category onto rows that rule wins. It never reverts a row (a narrowed, deleted or out-ranked rule's rows keep their category). So it needs no stored original category (decision 3).
- Candidate narrowing (fast path): if the saved rule has a name matcher, read `selectDistinct(description)`, filter in JS, then read only rows `WHERE description IN (chunk)`. Otherwise read all eligible rows in id-keyset pages. Rows read: `id, description, amount_minor_units, time, category, holdings.currency` (join on `holding_id`).

## 8. The suggestion flow (change-category sheet)
Form units after the split: `use-category-override/` (`applyOverride`, `applyOverrideOne`) and `category-override-sheet/` (no JSX change planned).
- The sheet, its title, message and buttons stay as today (ruling 7).
- "Apply": `categoryRulesRepo.applyNameRule(name, category)` in one write: find a rule whose matchers are exactly one `nameIs` with the same normalized text. If found, move it to the new category, set `text` to the typed name, bump `updated_at` (it becomes the newest, so the user's latest choice wins ties). If not found, insert one. A rule that has `nameIs` plus other matchers is a different rule and is not touched. Then run the 7.3 rewrite for that rule (no second sheet; today's sheet already asked). On today's data this changes the same rows as today (P20). The source row's flag goes to 0 (decision 4); on an edit, when a stronger rule of another category out-ranks the new rule on the source row, the source row still gets the picked category and the flag goes to 1 so the pick stays (decision 17).
- A blank normalized name: no sheet, no rule (unchanged guard, `:488-507`).
- "Just for this one": `setCategory` + flag 1.
- Cancel: unchanged (on a create the row keeps its picked category; on an edit nothing is written).
- The `upsertCategoryOverride` un-chunked IN list (`category-overrides.repo.ts:59-62`) goes away with the repo; the new rewrite chunks.

## 9. Screens (UI changes need the user's live confirmation on device)

### 9.1 Categories list (`Categories`)
- One-column `Sortable.Grid` of cards built like `renderAccountCard`: `EntityIconTile` (category icon + resolved colour), title (wraps, per the locked "Card titles wrap" rule), caption "N rules" / "No rules" plus "Default" on the default category.
- Tap -> category page. Hold -> `CardContextMenu` delete (not on the default). Drag -> reorder (`categoriesRepo.reorder`).
- Footer "Add category" (leading symbol) -> category edit form in create mode; after save, the new category page.
- "Set as default" moves to the category page (a row under the rules); move top/bottom goes away, reorder is by drag only, like Accounts (decision 14).

### 9.2 Category page (`CategoryDetail`, new route)
- Header title = category name; header Edit -> category edit form.
- Rules as cards, one per rule, sorted by priority (the order that decides). Each card shows its matchers as one line, joined by " · " (for example `Name is "Silpo" · Expense · More than 500.00 UAH · After 18:00`), times through `formatTime` with the user's clock.
- "Add rule" button (leading symbol) -> rule editor in create mode. Empty state when no rules.
- Unreadable rule card (failed guard): "This rule can't be read" + Delete.

### 9.3 Category edit form (`CategoryForm`, new route)
Name, icon, colour (the existing inline controls moved here), Delete at the bottom (not on the default). Create mode: the same fields.

### 9.4 Rule editor (`CategoryRuleForm`, new route)
- A list of matcher rows; each row: a type select (Name is / Name starts with / Amount / Type / Time) and its input:
  - name: text field;
  - amount: operator select (=, >, >=, <, <=) + amount field + currency select (default: the base currency);
  - type: Expense / Income segment;
  - time: Before / After segment + `TimeField`.
- "Add matcher" adds a row; each row has a remove control (not on the last row). Hint: "A transaction must match every condition."
- Save validates (section 3.1), then runs 7.3. Delete rule (edit mode): a confirm, then delete; no row changes.

### 9.5 Strings (en / uk; sentence case except titles; reviewed by the user at BATCH READY)
| key (proposed) | en | uk |
|---|---|---|
| categories.rulesCount_one/few/many/other | {{count}} rule / rules | {{count}} правило / правила / правил / правила |
| categories.noRules | No rules | Немає правил |
| categories.default | Default | Типова |
| categoryPage.rulesHeading | Rules | Правила |
| categoryPage.addRule | Add rule | Додати правило |
| categoryPage.emptyRules | Add a rule to set this category on matching transactions. | Додайте правило, щоб ставити цю категорію відповідним транзакціям. |
| categoryPage.unreadableRule | This rule can't be read | Це правило неможливо прочитати |
| categoryForm.addTitle / editTitle | New Category / Edit Category | Нова категорія / Редагування категорії |
| ruleForm.addTitle / editTitle | New Rule / Edit Rule | Нове правило / Редагування правила |
| ruleForm.addMatcher | Add matcher | Додати умову |
| ruleForm.allMustMatch | A transaction must match every condition. | Транзакція має відповідати всім умовам. |
| ruleForm.nameIs / nameStartsWith | Name is / Name starts with | Назва дорівнює / Назва починається з |
| ruleForm.amount | Amount | Сума |
| ruleForm.equal / more / atLeast / less / atMost | Equal to / More than / At least / Less than / At most | Дорівнює / Більше ніж / Щонайменше / Менше ніж / Щонайбільше |
| ruleForm.direction | Type | Тип |
| ruleForm.time / before / after | Time / Before / After | Час / До / Після |
| ruleForm.deleteRule | Delete rule | Видалити правило |
| ruleForm.errorNoMatchers | Add at least one condition. | Додайте хоча б одну умову. |
| ruleForm.errorName | Enter a name. | Введіть назву. |
| ruleForm.errorAmount | Enter an amount of 0 or more. | Введіть суму від 0. |
| ruleForm.errorNeverMatches | These conditions can never match together. | Ці умови не можуть збігтися разом. |
| ruleForm.errorDuplicate | A rule with these conditions already exists in {{category}}. | Правило з такими умовами вже є в категорії {{category}}. |
| ruleRewrite.title | Apply Rule | Застосувати правило |
| ruleRewrite.message_one/few/many/other | This changes {{count}} transaction(s). | Це змінить {{count}} транзакцію / транзакції / транзакцій / транзакції. |
| ruleRewrite.applyToExisting | Apply to existing | Застосувати до наявних |
| ruleRewrite.newOnly | New transactions only | Лише нові транзакції |
| categories.deleteRulesNotice_one/few/many/other | Its {{count}} rule(s) will be deleted too. | Його {{count}} правило / правила / правил / правила теж буде видалено. |
Expense / Income, Edit, Delete, Cancel reuse existing keys. "Matcher" in the UI reads "condition" ("умова"); the user confirms the wording.

## 10. Export / restore
- `DataSnapshot`: replace `categoryOverrides` with `categoryRules: CategoryRuleRow[]`; transactions rows carry `categorySetByHand`.
- `EXPORT_VERSION` 2 -> 3, readable `[1, 2, 3]`. Reason: a v3 file has no `categoryOverrides`, which a v2 build requires, so the v2 build must refuse it by version, not by a vague "not valid". `envelope.test.ts` records the decision with the new journal count.
- `REQUIRED_TABLE_KEYS`: `categoryOverrides` is required only for versions 1-2; `categoryRules` for version 3.
- Restore of an old file (v1/v2): `withLegacyOverridesConverted(snapshot.categoryOverrides)` builds one rule per override exactly as migration 0058 does (same matcher JSON, same timestamps, fresh ids); the guard runs on the result. No rewrite runs on restore: the file's rows already carry their categories. Rows without `categorySetByHand` restore 0. Two-path test (`restore-category-rules.two-path.test.ts`): a pre-0058 database migrated and the same data restored from an old file end with equal rules (ignoring ids) and equal flags.
- Restore of a v3 file: rules pass the guard (a bad rule fails the import as "not a valid Kiko export file" before the live DB is touched, like `isExportSecrets`); delete order: `category_rules` with the other tables.

## 11. Performance (measured at the plan stage; nothing run in this spec)
Targets: insert path adds well under 100 ms to a 10 000-row batch with 200 rules x 3 matchers; the rewrite (count + apply) about 1 s for 50 000 rows.

Design choices that serve them:
- Rules parsed and sorted once per batch; first match wins in priority order, so most rows stop early.
- A `Map` from normalized `nameIs` text to the rules that start with that matcher lets a row skip every `nameIs` rule whose text differs (the common case: most rules are converted name rules).
- Rewrite: name fast path (7.3); otherwise id-keyset pages of 2 000 rows; chunked `UPDATE ... WHERE id IN` by `IN_CLAUSE_CHUNK_SIZE`.

Method: a Jest test on real `node:sqlite` (`@kiko/test-support/real-sqlite`) with a seeded fixture: 50 000 transactions over 20 holdings in 5 currencies (UAH, USD, EUR, GBP, BTC), 3 years of times, 2 000 distinct descriptions (Cyrillic and Latin), 10% flagged, plus 200 rules: 120 `nameIs`, 40 `nameStartsWith`, 40 with 2-3 matchers (amount, direction, time). Time with `performance.now()`, median of 5 runs: (a) `prepareRules` + evaluation of a 10 000-row batch; (b) the full insert of that batch with and without rules; (c) rewrite count and apply for a name rule and for a no-name rule. The test asserts generous ceilings (5x the measured median) so it does not flake; the plan records the measured numbers in the run log. Hermes is slower than Node's JIT: the user's live device check of "Apply to existing" on the real database is the final check. Run outside battery mode only.

## 12. Category delete
- `categoriesRepo.delete` (`categories.repo.ts:81-113`) gets a rule-deletion step in its SAME write: `DELETE FROM category_rules WHERE lower(category) = ?` (the same case-insensitive key match it uses for transactions), beside transaction-templates' template-clearing step, before the category row goes (decision 12). The rows moved to the default get `category_set_by_hand = 0` in the same write. A count read for the confirm: `countRulesOfCategory(key)` (beside templates' `countReferencingCategory(key)`).
- The confirm names the count: "Its N rules will be deleted too" (`categories.deleteRulesNotice_*`), one line beside templates' `categories.deleteTemplates_*` line.
- The confirm today is the title-only `ConfirmSheet` at `categories.screen.tsx:330-341` (handlers `:167-183`), on this track's screen, which the redesign rewrites: it moves into the card context menu and the category edit form.

## 13. Coordination with transaction-templates
- Form: transaction-templates splits `transaction-form.screen.tsx` first. This track's form work (7.2 pre-select, section 8 sheet changes, the flag on create/edit) is the LAST task, written on top of the split once it is in `next`. Data, repo, insert path, rewrite and screens come first and do not touch the form file, except: the form reads `category_overrides` today (`:1652-1662`, `:2203`), so dropping the table in 0058 forces a minimal form change in the SAME task as the migration (swap the live query in `use-category-pick/` and `applyOverride` in `use-category-override/` to the rules repo, same behavior; unit names fixed only once the split merges). That task must land after the split or rebase on it (coordination point A; decision 16: the migration + repo task lands on top of the split once it is in `next`; before that the track does only the pure rule module, the scenario-matrix tests and the performance fixture).
- Delete confirm (coordination point B, agreed): both tracks edit `categoriesRepo.delete` (one write: templates clears template category ids, this track deletes rules, then the existing reassign and row delete) and the confirm (`categories.screen.tsx:330-341` today; this track's redesign moves it). The track that merges into `next` second rebases onto the first and adds its own line to the confirm (`categories.deleteTemplates_*` for templates, `categories.deleteRulesNotice_*` here).
- Settings stack (coordination point C): both tracks add routes to `src/navigation/settings-stack/settings.stack.tsx` and `types.d.ts`; transaction-templates also moves the Categories row. This track adds `CategoryDetail`, `CategoryForm`, `CategoryRuleForm` only.
- Templates (coordination point D): a template's category is a hand pick, flag 1; a template without a category gets the pre-select, flag 0 (decision 13). Confirmed: a template transaction saves through the normal form path (`recordManual` for income / expense, `recordManualWithReturns` for split, `recordExchange` for exchange, no category); `transaction_templates` stores no flag.
- Migration numbers: 0058 here, after 0056 and 0057; renumber at merge against the destination's journal tail.

## 14. Risks
- R1: Existing rows have no flag (ruling 6), so an old "Just for this one" pick can be overwritten by a later rewrite, as today's same-name rewrite already does. No change proposed; the user may want a backfill (not proposed: the old picks are not knowable exactly).
- R2: A rewrite holds op-sqlite's one queue for its write. Mitigated by the fast path and measured (section 11).
- R3: Shared migration-number namespace: never deploy a build with 0058 before 0056/0057 are fixed in the merge order.
- R4: The form file is 2852 lines and being split; the form task must start from the split, not from main.
- R5: A rule with only amount / direction / time matchers can rewrite many rows at once; N in the sheet is the guard.

## 15. Decisions (2026-10-11)
Source: USER = the user's ruling, relayed by the coordinator; DEFAULT = the coordinator-recommended option, no user objection; ORCHESTRATOR = an orchestrator ruling.
1. "Newest" for the priority tie = `updated_at`; an edited rule and a suggestion re-apply win ties. Not chosen: `created_at`. DEFAULT.
2. Identical `updated_at`: then `created_at` DESC, then `id` DESC, so the order is total. DEFAULT.
3. A row a rule no longer wins is never reverted (a narrowed, deleted or out-ranked rule's rows keep their category); no `original_category` column. Not chosen: reverting via `categoryForMcc`; storing `original_category`. USER.
4. ANY hand-picked category sets the flag: on create, Duplicate, edit, and from a template. "Apply" to all clears the flag on the source row (it follows the rule). USER.
5. The rewrite skips exchange legs, balance-setting rows and split-change rows. DEFAULT.
6. A re-sync refresh that changes the amount of an unflagged row re-evaluates it; `category` is written only when a rule wins. DEFAULT.
7. A zero amount matches neither expense nor income. DEFAULT.
8. The editor refuses a rule that can never match (two directions, two currencies, an empty amount range, after >= before), with the hint to use two rules for a window over midnight. DEFAULT.
9. The editor refuses a second rule with the same matcher set and names the other category; the suggestion flow updates the existing one-matcher rule in place. DEFAULT.
10. The insert path reads every rule inside its write under a documented guard exception: `nosemgrep` with `OVERRIDE(...)` on that one read, plus an entry in `docs/harness/documented-exceptions.md` (the table is user-authored and small; every reader needs every row by design). No rule cap, no silent drop. Not chosen: a cap at every writer with a `.limit(MAX_RULES + 1)` read (migration 0058 and an old restore cannot refuse rows); reading rules before the write (a rule saved in between misses that batch). DEFAULT (ORCHESTRATOR ruling toward no-known-limit-for-data-correctness).
11. N = 0: no sheet, save directly. DEFAULT.
12. Deleting a category deletes its rules in the same `categoriesRepo.delete` write; the confirm shows "N rules"; its rows move to the default as today, with the flag cleared on the moved rows. Was: overrides moved to the default. USER.
13. A template's category counts as a hand pick (flag 1); a template without a category gets the pre-select on its draft, flag 0. Confirmed by the transaction-templates orchestrator: a transaction made from a template goes through the normal form save path, with no template-only path: income / expense -> `transactionsRepo.recordManual`; split -> `recordManualWithReturns`; exchange -> `recordExchange` (no category). Rules never apply on these paths. A seeded template category sets `userPickedCategory = true`, the same as Duplicate. So the flag write covers `recordManual` AND `recordManualWithReturns`. The template row itself (`transaction_templates`) stores no flag. DEFAULT.
14. "Set as default" moves to the category page; reorder is by drag only, like Accounts. DEFAULT.
15. A date-only statement row's stored instant decides the time matcher; the time matcher's hint says so. The plan checks the current date-only mapping. DEFAULT.
16. Task order: the migration + repo task lands on top of the transaction-templates split once it is in `next`. Before that, the track does only work that touches neither the form nor the schema: the pure rule module with the scenario-matrix tests and the performance fixture. Not chosen: a form swap on the unsplit file (conflicts on the moved lines); keeping `category_overrides` until the last task (a data gap at an intermediate tip). DEFAULT.
17. "Apply" (to all) on an EDIT, when a stronger rule of another category out-ranks the new name rule on the source row: the source row always gets the picked category. It gets the manual-pick flag (1) only when a stronger rule out-ranks the new rule on that row, so the pick stays. Otherwise "Apply" clears the flag as decision 4 says. Not chosen: (b) the row keeps the stronger rule's category; (c) the picked category with the flag cleared (a later "Apply to existing" on the stronger rule would change it back). USER, 2026-10-11 12:20, relayed by the coordinator.
