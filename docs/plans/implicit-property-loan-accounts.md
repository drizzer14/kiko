# Implicit Properties and Loans Accounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adding a property or a loan is one step. At most one `property` and one `debt` account exist ("implicit accounts"); the Accounts screen lists their holdings, one card per holding, in the Property and Debts sections.

**Architecture:** Keep the `accounts` table. A partial unique index on `accounts.kind` (`kind IN ('property','debt') AND archived_at IS NULL`) allows at most one live account per implicit kind. Migration `0050` merges the existing accounts of each kind into the oldest one. `restoreDataSnapshot` applies the same merge to an older `.kiko`. The display name comes from i18n by kind, never from the stored `name`, until the user renames the account: the localized default shows until then, and a typed name then shows everywhere (`accountDisplayName`). The account form's Property and Loan kinds swap in the holding form, in an "implicit" create mode. Its Save finds or creates the implicit account and inserts the holding in ONE `write()`.

**Tech Stack:** React Native 0.87 + TypeScript, op-sqlite 18 (bundled SQLite 3.51.3: window and JSON functions available) + Drizzle (`src/db/schema.ts`, `drizzle-kit generate`, custom runner `src/db/run-migrations.ts`), `react-native-sortables`, `fnts`, `ts-pattern`, i18next (`src/i18n/locales/{en,uk}.ts`), Jest + RNTL, `node:sqlite` real-SQLite tests (`src/test-support/real-sqlite.ts`), Maestro (`.maestro/`). **No new dependency.**

**Spec:** `docs/superpowers/specs/2026-10-03-implicit-property-loan-accounts-design.md` (approved 2026-10-03). Read the `kiko-architecture` (Storage, migrations, Reminders, Data transfer), `kiko-domain` (The three levels, Debts), `kiko-design-system` (Component set), `kiko-gestures`, `kiko-translator`, and `kiko-code-style` skills before the task that touches them.

**Base state:** `next` AFTER the `shares-cut` merge (`shares-cut` tip `be55dabb`): there is no `share` type, `holdingTypesForAccountKind.broker = ['bond', 'cash']`, the holding form uses `forms.holding.namePlaceholders.*`, and `isHoldingType` exists in `src/holdings/holding-type/`. `shares-cut` adds no migration, so the next free index is **0050**. Check this again in `drizzle/migrations/meta/_journal.json` before task 1/8. If a later index has landed, use the next free one and rename every `0050` below to match.

**Task count:** 8 change sets, `implicit-accounts task 1/8` … `task 8/8`, in build order. One branch, one editor.

**Merge unit:** tasks 1/8–7/8 merge into `next` TOGETHER, after each one is reviewed and mutation-gated on its own (memory `hold-merge-until-feature-complete`). Task 1/8 alone would break the old account form: a second Property account would hit the new unique index. Task 8/8 is docs, the whole-branch review, and `make verify`.

---

## Resolved "Open for the plan" items

1. **Stored sentinel name.** `IMPLICIT_ACCOUNT_STORED_NAME = { property: 'Properties', debt: 'Loans' }`. These are fixed English constants and do not come from i18n. They follow the seeded-category precedent (kiko-translator: "stored title is its English seed text", resolved at render time). Reasons: the column stays NOT NULL. An older build that restores a newer `.kiko` shows a sensible name. A display site that misses `accountDisplayName` shows readable English, not `''` or `property`. No code ever READS the stored name to detect an implicit account: the kind decides. The migration and every create write this value.
2. **Which account the merge keeps.** The account with the smallest `created_at`, ties broken by `sort_order`, then `id`. Reasons: `created_at` is immutable and survives a restore unchanged, so both paths pick the same row. `sort_order` changes on every drag, restarts per section, and can tie with archived rows (`accountsRepo.reorder` only rewrites active ids). The kept account keeps its `id`, so its reminders, its `reminder_offer_dismissals` key, and its holdings need no re-point.
3. **Reminder-state merge rule.** For each `(kept account, reminder kind)`, the reminder with the smallest `created_at` (ties: `id`) survives, and every other reminder of that kind on the merged accounts is deleted. The survivor keeps ALL its own state as one whole: `schedule`, `pausedAt` + `pauseReason`, `activeSince`, `lastEngagedAt`, `lastSnoozedAt`, `updatedAt`. Nothing is blended across rows: a schedule taken from one row with a pause taken from another would be a reminder the user never set. The deleted reminders' pending iOS requests and snoozes go at the first re-plan after launch, because `replaceRequests` keeps only the snoozes of reminders that still exist (`sync-reminders.ts`). A tap on an already-delivered banner routes nowhere (`routeLatestResponse`: missing reminder → no route). `settings.reminder_offer_dismissals`: the kept account's entry becomes the UNION of the kinds dismissed on every merged account, and the deleted accounts' keys are removed. Reason: a dismissal on any of them was the user's "no" for that kind. Restore keeps its own rule: every restored reminder restarts `activeSince = now` and `lastSnoozedAt = null`, so the two-path test compares reminders without those two columns.
4. **Every column that references `accounts.id`.** Checked with grep over `src/db/schema.ts` and every repo:

| Column | Where | What 0050 (and the restore mirror) does |
|---|---|---|
| `holdings.account_id` (FK) | `src/db/schema.ts:48-50` | Re-pointed to the kept account. `sort_order` is renumbered over the merged set (task 1/8 step 5, items 2 and 4). |
| `reminders.account_id` (FK, unique with `kind`) | `src/db/schema.ts:581-583`, index `reminders_account_kind` `:595` | Losers deleted first, then the survivor re-pointed (rule 3), so the unique index never collides. |
| `sync_state.account_id` (PK + FK) | `src/db/schema.ts:460-463` | Deleted for each merged-away account BEFORE the account row goes. Only a Monobank Connect creates this row, and property/debt accounts never connect, so this is defensive: without it, a stray row's NO ACTION FK would fail the whole migration. |
| `settings.reminder_offer_dismissals` (JSON keys = account ids) | `src/db/schema.ts:419-421`; writer `src/settings/settings.repo.ts:21-37` | Merged per rule 3 (union onto the kept key, deleted keys removed). |
| Keychain services `kiko.monobank.<accountId>`, `<binance service>.<accountId>` | `src/monobank/token/token.ts:19`, `src/crypto-sync/binance/binance.credentials.ts:20` | Not affected. Only bank and crypto accounts connect, so a property/debt account never owns one. SQL cannot clear the Keychain, and nothing needs clearing. |
| `transactions.external_id` prefix `<accountId>:` (synced rows) | `src/monobank/`, `src/crypto-sync/binance/binance.transactions.ts` (kiko-architecture "Namespaced synced externalId") | Not affected. Only synced bank/crypto rows carry the prefix. |
| In-memory `cooldownUntilByAccount` | `src/crypto-sync/binance/binance.cooldown.ts:12` | Not affected (crypto only, not persisted). |
| Columns that reference a HOLDING id: `transactions.holding_id`, `loan_holding_id`, `exchange_counterpart_holding_id`; `holdings.balance_set_row_id`; loan `metadata.paymentHoldingId`; `price_points.instrument = 'holding:<id>'` | `src/db/schema.ts` | Not affected. Holding ids never change; only `holdings.account_id` moves. |
| `settings.statement_mappings` (keys `bank:<bankId>` / `header:<fp>`) | `src/db/schema.ts:394-396` | Not affected (keyed by bank id, never by account id). |
| Reminder request ids `kiko.reminder.<reminderId>.*`, `kiko.snooze.<reminderId>` | `src/reminders/planner/plan-reminder.ts` | They hold reminder ids, not account ids. A deleted reminder's requests drop at the first re-plan (rule 3). |

5. **en + uk texts (PENDING USER REVIEW, see QUESTION 2):** `accounts.implicitName.property` = en "Properties" / uk "Майно"; `accounts.implicitName.debt` = en "Loans" / uk "Кредити". The plan recommends uk "Майно", not the spec's draft "Нерухомість": the kind also holds a car, valuables, and money you lent (`forms.account.kindSubtitle.property`), and "Нерухомість" means real estate only. "Майно" is already the uk kind label and the uk section heading.

## Other decisions made here (technical, not product)

- **D1. Archived accounts are out of scope.** The merge, the partial index, and the sections all consider only accounts with `archived_at IS NULL`. No code path writes `archivedAt` (only a restore copies it), and an archived account's holdings already count in no total (`src/rates/active-holdings/`). Merging one in would change net worth.
- **D2. The implicit account stays when its last holding is deleted.** No data or reminder vanishes behind the user's back. The next create reuses the account. Its section hides because it has no open holding.
- **D3. Icon and color.** 0050 and the restore mirror set `icon = NULL, color = NULL` on each implicit account, and the implicit create writes NULL. `accountIdentity` then shows the kind defaults beside the localized name (Settings > Reminders, the filter menus). A custom glyph picked for one former account would misrepresent all of them.
- **D4. The create flow swaps screens, not fields.** In create mode, picking Property or Loan in the account form calls `navigation.replace('HoldingForm', { implicitKind, draft })` with `animation: 'none'`. The draft carries the typed name, icon, and color. The implicit HoldingForm keeps the "Add Account" title and shows the same `AccountKindField` at the top. Picking any other kind replaces back to `AccountForm { initialKind, draft }`. Reason: the holding form already owns the property and loan fields, their validation, the "Paid from" picker, the loan auto-link, and the market refresh. Embedding them in the account form would duplicate ~400 lines (the `check:dup` 5% cap) and fork the save path. On screen it looks like the same form swapping its fields (spec decision 4). The user confirms it on the device.
- **D5. Display-name scope.** `accountDisplayName(account, t)` is applied wherever an implicit account's name can show: the Home account filter and rows, the Statistics account filter and account-contribution chart, Settings > Reminders, and the transaction form's account-name map (its loan-payment picker lists loans, so it can name the debt account; its return picker uses the same `isTransactionEligibleType` gate as the primary picker, so it never lists a loan or a property item and cannot name either implicit account (it used to accept any holding type, which let a change return land on a ledgerless holding; fixed in round C); the exchange pickers never list loans or property items). The AccountReminders page renders no account name (its nav title is the static "Reminders"), so it needs no change. The loan "Paid from" picker and the statement-import target picker drop ledgerless holdings, and `property_item` and `loan` are ledgerless, so neither can show an implicit account name: verified unaffected, with no change. A reminder notification never names its account.
- **D6. Reminder routing.** SUPERSEDED by device fix 6 (the section heading on the Accounts screen opens the implicit account's own AccountDetail): a tap on one of its reminders now opens that AccountDetail like any other account's, and the paused notice opens `AccountReminders` above it. Originally: an implicit account has no AccountDetail page, so a tap opened the Accounts tab with the pages it already showed kept.

## Questions for the user

- **QUESTION 1: Where are reminders for the implicit accounts created?** Today the only "add reminder" entry is the bell on AccountDetail, which no longer exists for these accounts. Note: property and loan holdings are ledgerless, so an "add transactions" reminder on them always reads "No transactions added yet", and a tap can open no form.
  - (A) A bell on the Property and Debts section headings on the Accounts screen opens that implicit account's reminders page. It needs one added task: header item, `AccountReminders` params, tests.
  - (B) A bell on a property/loan holding's detail page opens the implicit account's reminders page. One added task. It reads as a per-holding reminder, but it covers every holding of that kind.
  - (C) No new entry point. Existing (merged) reminders stay visible and can be paused or deleted in Settings > Reminders. No new ones can be created for these two kinds.
  - **Recommendation: C.** It needs no new UI, and it matches what a ledgerless holding can do. The plan builds C (task 7/8 routing only). If the user picks A or B, add `implicit-accounts task 8/9` before the docs task.
- **QUESTION 2: Final en/uk names** (pending user text review). Options: (A) en "Properties" / "Loans", uk "Майно" / "Кредити" (recommended, reasons in item 5). (B) uk "Нерухомість" / "Кредити" as the spec draft says. (C) en "Property" to match the existing section heading `accounts.propertySection`. The plan builds A. Changing it later is a two-line catalogue edit.

## Global Constraints

- **Branch and editor.** One branch from `next` (after the `shares-cut` merge), one editor, tasks in order. Never `git checkout`/`restore`/`stash`/`clean`. Move files only with `git mv`, then edit them with Edit/Write (the kill-guard denies `cp`/`mv`/`sed -i` into `src/`).
- **Guideline 5.6.** No flag and no conditional visibility: the sections render from data, and the create path is always on.
- **Writes.** Every write goes through `write()` / `db.transaction()`. No full-table select inside a write (`kiko-no-full-table-select-in-write`). The implicit-account lookup filters in SQL with `LIMIT 1`.
- **Migration.** One migration, `0050_implicit_property_debt_accounts`. It is crash-safe: it derives into TEMP tables first, then mutates, and creates the index last. The runner wraps it in one transaction, so a crash rolls back to 0049. It is idempotent. Its restore mirror applies the IDENTICAL rule. The restore mirror is mandatory: without it, inserting an older `.kiko` with two property accounts fails on the new index.
- **Every fake updated.** In each task that changes a repo function's shape, grep every hand-rolled fake transaction and DB handle that drives it (`src/accounts/accounts.repo.test.ts`, `src/holdings/repo/holdings.repo.test.ts`, `src/data-transfer/snapshot/restore-snapshot.test.ts`, `src/db/capture-set-tx.ts`, and the 34 test files that `jest.mock` `@kiko/accounts` / `@kiko/holdings/repo`; find them with `grep -rln "accountsRepo: {\|holdingsRepo: {\|jest.mock('@kiko/accounts'\|jest.mock('@kiko/holdings/repo'" src`), and add the new methods and columns. A fake that returns `undefined` for an unknown column hides bugs (memory `fake-db-masks-bugs`).
- **Cross-screen rule.** `src/screens/accounts/` must not import from `src/screens/account-detail/` (`check:screen-imports`), so the shared holding card moves to `src/design-system/components/` (task 4/8).
- **i18n.** `en.ts` and `uk.ts` change together (parity test). The uk apostrophe is ’. The user reviews the new keys before any deploy that ships them.
- **Gestures.** Every new grid copies the accounts grid's tuning: `activeItemScale={1.03}`, `autoScrollActivationOffset={75}`, `overDrag="vertical"`, `columns={1}`, `sortEnabled={<query fresh>}` (a lone card lifts on a hold and drops back). `onDragStart`/`onActiveItemDropped` come from `useGridLiftGuard`, and each card's open handler is wrapped in its `openUnlessLifted`. `onDragEnd` always goes through `onGridDragEnd`. The long-press menu is `CardContextMenu`, never a swipe.
- **Checks.** Per task: a scoped `npx jest <paths>` red → green cycle, then `make typecheck && make lint`, then `make gate`. Per change set, the coordinator runs the mutation gate: `KIKO_MUTATION_BASE=<that task's base sha> make mutable` (it must print ≤ 30), then `KIKO_MUTATION_BASE=<that task's base sha> make deep`, detached, never across the whole branch. At the end: `make verify`, repeated until green (task 8/8). Never weaken a check.
- **Skills change in the same task as the code** (a `(scribe)` step), then `kiko:retrospect` + `kiko:scribe` after the iteration.
- **Commits.** Conventional Commits, one or more per task. End each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Two accounts of one kind with the same `created_at`** (an old default, or a restore). The tie-break `sort_order`, then `id`, must pick the same kept account on both paths. Test in task 1/8 (SQL) and task 2/8 (two-path).
2. **The Accounts screen when the only property/debt data is an EMPTY implicit account** (its last holding deleted, D2). The empty-state text shows, and no empty section heading renders. Test in task 5/8.
3. **An archived property/debt account** (D1). 0050 leaves it alone, the index allows it, and its holdings show in no section and no total. Tests in tasks 1/8 and 5/8.
4. **Name-keyed filters** (Home, Statistics). The options and the rows both go through `accountDisplayName`, so selecting "Properties" under uk still matches. Test in task 7/8.
5. **Merged order.** Holdings from several former accounts land in the old visible order: the accounts in their section order, then each account's own drag order. A later drag persists only the implicit account's open holdings. Tests in tasks 1/8 and 5/8.
6. **The swap keeps the draft, and Back leaves the flow.** The name, icon, and color typed before picking Property survive the swap both ways, and Back from the implicit HoldingForm returns to Accounts, not to a stale AccountForm. Test in task 6/8.

---

### implicit-accounts task 1/8: implicit-account unit, partial unique index, migration 0050 (developer)

**Files:**
- Create: `src/holdings/implicit-account/{implicit-account.ts,implicit-account.test.ts,index.ts}`
- Modify: `src/db/schema.ts` (the `accounts` table gains its third `sqliteTable` argument)
- Generate, then hand-edit: `drizzle/migrations/0050_implicit_property_debt_accounts.sql`, `drizzle/migrations/meta/0050_snapshot.json`, `drizzle/migrations/meta/_journal.json`, `drizzle/migrations/migrations.js`
- Create: `drizzle/migrations/0050-implicit-property-debt-accounts.test.ts`
- Modify: `src/i18n/locales/en.ts`, `src/i18n/locales/uk.ts` (add `accounts.implicitName.{property,debt}`)

**Interfaces (Produces):**
```ts
export const implicitAccountKinds = ['property', 'debt'] as const satisfies readonly AccountRow['kind'][];
export type ImplicitAccountKind = (typeof implicitAccountKinds)[number];
export const isImplicitAccountKind = (kind: AccountRow['kind']): kind is ImplicitAccountKind;
// A live (non-archived) property/debt account is THE implicit account of its kind.
export const isImplicitAccount = (account: Pick<AccountRow, 'kind' | 'archivedAt'>): boolean;
export const IMPLICIT_ACCOUNT_STORED_NAME: Record<ImplicitAccountKind, string>; // { property: 'Properties', debt: 'Loans' }
export const accountDisplayName = (account: Pick<AccountRow, 'kind' | 'name' | 'archivedAt'>, t: TFunction): string;
```

- [ ] **step 1/7: Failing unit tests** (`implicit-account.test.ts`). `isImplicitAccountKind` is true only for `property` and `debt`, over every value of the `accounts.kind` enum. `accountDisplayName` returns `t('accounts.implicitName.property')` for a live property account whatever its stored name, and the same for `debt`. It returns the stored name for an archived property account and for every other kind. Under uk it returns "Майно" / "Кредити", using the real i18n instance as the translator tests do.
- [ ] **step 2/7: Implement** the unit and the two catalogue keys (en + uk, with a comment: "pending user review").
- [ ] **step 3/7: Schema.** Add `(table) => ({ implicitKindUnique: uniqueIndex('accounts_implicit_kind').on(table.kind).where(sql\`${table.kind} IN ('property', 'debt') AND ${table.archivedAt} IS NULL\`) })`, with a comment pointing at 0050 and `isImplicitAccount`. Run `npx drizzle-kit generate --name implicit_property_debt_accounts`. Check that the generated SQL holds `CREATE UNIQUE INDEX \`accounts_implicit_kind\` ON \`accounts\` (\`kind\`) WHERE …`. **If drizzle-kit drops the `WHERE`, STOP and report to the coordinator**: do not hand-edit the snapshot. Then re-check `migrations.js` and run `./node_modules/.bin/biome check --write` over the generated files.
- [ ] **step 4/7: Failing real-SQLite migration tests** (`0050-…test.ts`, the shape of `0049-bank-accounts-other-bank.test.ts`: `applyMigrationsThrough(db, '0049_bank_accounts_other_bank')`, seed rows, run the SQL split on `--> statement-breakpoint`). Cases:
  1. No property/debt accounts: every table is byte-equal before and after.
  2. One account of each kind: its holdings, reminders, and dismissals are unchanged. Its name becomes the sentinel, and its icon and color become NULL.
  3. Three property and two debt accounts with holdings, reminders on several of them, and a dismissal map: the oldest of each kind is kept. Every holding moves to it, with `sort_order` = 0..n-1 in (account `sort_order`, `created_at`, `id`), then (holding `sort_order`, `created_at`, `id`) order. Closed holdings move too. For each reminder kind, only the earliest-created reminder survives, re-pointed, with its schedule, pause, snooze, and engagement columns unchanged. The dismissal map's kept key holds the union (compare as sorted arrays), and the deleted keys are gone. `sync_state` rows of merged-away accounts are deleted. Merged-away accounts are deleted.
  4. A `created_at` tie: `sort_order`, then `id`, decides.
  5. An archived property account next to a live one: the archived one is untouched (name, holdings, reminders), and no merge touches it.
  6. Unchanged across the merge: `transactions` (holding_id, loan_holding_id), `price_points` (`holding:<id>` keys), each holding's `balance_minor_units` and `metadata`, and the count of holdings per kind. Together these prove net worth is unchanged.
  7. After the migration, `INSERT` of a second live `property` account throws `UNIQUE constraint failed`, while a second ARCHIVED one inserts.
  8. Idempotent: running the data statements again changes nothing.
  9. `applyAllMigrations` on an empty DB succeeds (the runner path).
- [ ] **step 5/7: Hand-author the data part** ABOVE the generated `CREATE UNIQUE INDEX` line, with a header comment in the style of 0047/0049 (what, why, crash-safety, the restore mirror's name). Order, each statement ending in `--> statement-breakpoint`:
  1. `CREATE TEMP TABLE implicit_account_members AS SELECT id AS account_id, kind, FIRST_VALUE(id) OVER (PARTITION BY kind ORDER BY created_at, sort_order, id) AS kept_id, ROW_NUMBER() OVER (PARTITION BY kind ORDER BY sort_order, created_at, id) AS account_rank FROM accounts WHERE kind IN ('property','debt') AND archived_at IS NULL;` then `DELETE FROM implicit_account_members WHERE kind IN (SELECT kind FROM implicit_account_members GROUP BY kind HAVING COUNT(*) = 1);`. A kind with one account is never re-numbered or re-pointed.
  2. `CREATE TEMP TABLE implicit_holding_order AS SELECT h.id AS holding_id, m.kept_id, ROW_NUMBER() OVER (PARTITION BY m.kept_id ORDER BY m.account_rank, h.sort_order, h.created_at, h.id) - 1 AS new_sort_order FROM holdings h JOIN implicit_account_members m ON m.account_id = h.account_id;`
  3. `CREATE TEMP TABLE implicit_reminder_rank AS SELECT r.id AS reminder_id, m.kept_id, ROW_NUMBER() OVER (PARTITION BY m.kept_id, r.kind ORDER BY r.created_at, r.id) AS reminder_rank FROM reminders r JOIN implicit_account_members m ON m.account_id = r.account_id;`
  4. `UPDATE holdings SET account_id = (SELECT kept_id …), sort_order = (SELECT new_sort_order …) WHERE id IN (SELECT holding_id FROM implicit_holding_order);`
  5. `DELETE FROM reminders WHERE id IN (SELECT reminder_id FROM implicit_reminder_rank WHERE reminder_rank > 1);` then `UPDATE reminders SET account_id = (SELECT kept_id …) WHERE id IN (… WHERE reminder_rank = 1);`
  6. Dismissals, only when there is anything to merge: `UPDATE settings SET reminder_offer_dismissals = (SELECT json_group_object(account_id, json(kinds)) FROM (SELECT coalesce(m.kept_id, d.key) AS account_id, json_group_array(DISTINCT k.value) AS kinds FROM json_each(settings.reminder_offer_dismissals) d JOIN json_each(d.value) k LEFT JOIN implicit_account_members m ON m.account_id = d.key GROUP BY 1)) WHERE reminder_offer_dismissals IS NOT NULL AND EXISTS (SELECT 1 FROM implicit_account_members);` (an entry with an empty kind list drops out, and the mirror does the same).
  7. `DELETE FROM sync_state WHERE account_id IN (SELECT account_id FROM implicit_account_members WHERE account_id <> kept_id);`
  8. `DELETE FROM accounts WHERE id IN (SELECT account_id FROM implicit_account_members WHERE account_id <> kept_id);`
  9. `UPDATE accounts SET name = CASE kind WHEN 'property' THEN 'Properties' ELSE 'Loans' END, icon = NULL, color = NULL WHERE kind IN ('property','debt') AND archived_at IS NULL;`. The literals must equal `IMPLICIT_ACCOUNT_STORED_NAME`. A step-4 test reads the constant and asserts it against the migrated rows.
  10. `DROP TABLE implicit_reminder_rank; DROP TABLE implicit_holding_order; DROP TABLE implicit_account_members;` then the generated `CREATE UNIQUE INDEX`.
- [ ] **step 6/7: Green.** `npx jest drizzle/migrations/0050 src/holdings/implicit-account src/db src/i18n`, then `make typecheck && make lint && make gate`.
- [ ] **step 7/7 (scribe):** kiko-architecture "Storage" gains a 0050 bullet (data merge plus partial index, restore mirror name, tests), and the "next free index" line is updated. kiko-domain "The three levels" gains "implicit accounts" (one live property/debt account, display name by kind, stored sentinel). Commit.

**Mutation:** about 2 files (`implicit-account.ts`, `schema.ts`; `.sql`/`.js`/`.json` are not mutated).

### implicit-accounts task 2/8: restore mirror and the two-path test (developer)

**Files:**
- Create: `src/data-transfer/snapshot/with-implicit-accounts-merged.ts` (+ `.test.ts`)
- Modify: `src/data-transfer/snapshot/restore-snapshot.ts`
- Create: `src/data-transfer/snapshot/restore-implicit-accounts.two-path.test.ts`
- Modify (fakes/expectations): `src/data-transfer/snapshot/restore-snapshot.test.ts`, `src/data-transfer/import-data.test.ts`, `src/data-transfer/round-trip.test.ts` (wherever a fixture holds two property/debt accounts or counts `accountsRestored`)

**Interfaces:**
- Consumes: `IMPLICIT_ACCOUNT_STORED_NAME`, `isImplicitAccount` (task 1/8).
- Produces: `withImplicitAccountsMerged({ accounts, holdings, reminders, settings }): { accounts, holdings, reminders, settings }`. A pure function with the SAME rules and order as 0050 steps 1–9. It returns the same array references when no kind has more than one live account and every implicit account already carries the sentinel name and NULL icon/color (a true no-op, like `withCryptoCashHoldingsMoved`).

- [ ] **step 1/5: Failing unit tests** (`with-implicit-accounts-merged.test.ts`): the same 8 data cases as task 1/8 step 4 (except the index cases), on plain row arrays, plus the reference-equality no-op.
- [ ] **step 2/5: Failing two-path test**, in the shape of `restore-bank-other.two-path.test.ts`. Seed ONE pre-0050 DB (`applyMigrationsThrough(…, '0049_bank_accounts_other_bank')`) with case 3 (several accounts of each kind, reminders, dismissals, a tie, an archived account, a `holding:` price point, a linked loan payment). Path 1 runs the real 0050 SQL. Path 2 reads the same seeded DB the way the older build exported it (`readDataSnapshot` over `executingClient`), then `restoreDataSnapshot` into a fresh `applyAllMigrations` DB. Assert equality of accounts, holdings, transactions, price points, settings `reminderOfferDismissals` (sorted kinds), and reminders through `columnsWithout(getTableColumns(reminders), 'activeSince', 'lastSnoozedAt')`, because restore restarts those two by design.
- [ ] **step 3/5: Implement.** In `restoreDataSnapshot`, call `withImplicitAccountsMerged` right after `withBankAccountsOtherBank` (the order a live device runs 0044 → 0049 → 0050). Feed it the holdings the crypto-cash move produced, the snapshot reminders (`?? []`), and the final `settingsToInsert`. Use its outputs for the account, holding, reminder, and settings inserts. Update the doc comment: the returned `accountsRestored` is the number of rows inserted AFTER the merge.
- [ ] **step 4/5: Green.** `npx jest src/data-transfer`, then `make typecheck && make lint && make gate`.
- [ ] **step 5/5 (scribe):** kiko-architecture "Data transfer" names `withImplicitAccountsMerged` and the two-path test. Commit.

**Mutation:** 2 files.

### implicit-accounts task 3/8: one-write create of a holding in the implicit account (developer)

**Files:**
- Modify: `src/holdings/repo/holdings.repo.ts`: extract the body of `holdingsRepo.create` into an exported `insertHoldingDatabaseTransaction(databaseTransaction, input: NewHolding): Promise<string>`, exported from the barrel like `clearLoanLinksForHoldingsDatabaseTransaction`. `create` becomes `write((databaseTransaction) => insertHoldingDatabaseTransaction(databaseTransaction, input))`, with unchanged behavior.
- Modify: `src/accounts/accounts.repo.ts`: add `createImplicitHolding`, and make `create` refuse an implicit kind.
- Create: `src/accounts/accounts.repo.implicit-account.test.ts` (real SQLite, `executingClient`)
- Modify (fakes): `src/accounts/accounts.repo.test.ts`, `src/holdings/repo/holdings.repo.test.ts`, and every `accountsRepo: {` / `holdingsRepo: {` mock that a later task's screen test reaches (add `createImplicitHolding`).

**Interfaces (Produces):**
```ts
// accountsRepo
createImplicitHolding: (kind: ImplicitAccountKind, input: Omit<NewHolding, 'accountId'>) => Promise<{ accountId: string; holdingId: string }>;
```
In ONE `write()`: `SELECT id FROM accounts WHERE kind = ? AND archived_at IS NULL LIMIT 1`. When there is none, insert `{ id: id(), name: IMPLICIT_ACCOUNT_STORED_NAME[kind], kind, icon: null, color: null, institution: null, bankId: null, sortOrder: await nextSortOrder(tx, kind) }`. Then `insertHoldingDatabaseTransaction(tx, { ...input, accountId })`. A dependency direction check: `accounts` already imports `@kiko/holdings/repo`, and holdings never imports accounts, so no new cycle.
`accountsRepo.create({ kind: 'property' | 'debt' })` throws `accountsRepo.create: a property/debt account is implicit; use createImplicitHolding`.

- [ ] **step 1/4: Failing real-SQLite tests:** the first property create makes one account (sentinel name, NULL icon/color, `sortOrder` before every debt account) and one holding. A second property create reuses it, so the count of live property accounts stays 1. A loan create makes the debt account and appends it after every account. An existing archived property account is never reused, and a live one is created beside it. A rejected holding (a currency not allowed for the type) rolls back the account insert too, so no empty implicit account is left. `create` with `kind: 'debt'` throws. `holdingsRepo.create` existing tests stay green unchanged.
- [ ] **step 2/4: Implement.**
- [ ] **step 3/4: Green.** `npx jest src/accounts src/holdings/repo`, then `make typecheck && make lint && make gate`.
- [ ] **step 4/4 (scribe):** kiko-domain "The three levels": the implicit create path. Commit.

**Mutation:** 2 files.

### implicit-accounts task 4/8: move the holding card and the close sheet to the design system; drop "Add loan" (developer)

**Files:**
- `git mv` `src/screens/account-detail/holding-card/` → `src/design-system/components/holding-card/`, and `src/screens/account-detail/close-holding-sheet/` → `src/design-system/components/close-holding-sheet/` (tests move with them; fix the `./` imports and the styles import).
- Create: `src/design-system/components/close-holding-sheet/use-close-holding-action.ts` (+ `.test.ts`). It holds `closeActionFor` and the sheet state lifted out of `account-detail.screen.tsx`.
- Modify: `src/screens/account-detail/account-detail.screen.tsx`: import from the new paths, use the hook, and remove the debt branches of `addHoldingLabelKey`/`addHoldingSymbol` (and the `debtAccount` route param it passes to HoldingForm, if nothing else reads it).
- Modify: `src/i18n/locales/en.ts`, `uk.ts`: remove `accountDetail.addLoan`.
- Modify: `src/screens/account-detail/account-detail.screen.test.tsx`: remove the "Add loan" footer cases.

**Interfaces (Produces):**
```ts
export const useCloseHoldingAction: (account: AccountRow | undefined) => {
  closeActionFor: (holding: HoldingRow) => { label: string; onPress: () => void } | undefined;
  closeSheet: ReactNode; // <CloseHoldingSheet …/> or null
};
```
The account argument is the HOLDING's own account, passed to `isSyncedHolding(holding, account)`. The Accounts screen passes the implicit account row.

- [ ] **step 1/4: Failing hook tests:** a synced holding gets no close action. A manual loan gets `accountDetail.closeLoanAction`. A manual property gets `accountDetail.closeHoldingAction`. Pressing the action renders the sheet.
- [ ] **step 2/4: Move and implement.** Account-detail behavior is unchanged except the footer.
- [ ] **step 3/4: Green.** `npx jest src/design-system/components/holding-card src/design-system/components/close-holding-sheet src/screens/account-detail`, `make typecheck && make lint && make gate` (`check:screen-imports`, `check:feature-imports`, `check:dup` included).
- [ ] **step 4/4 (scribe):** kiko-design-system "Component set" lists `HoldingCard` and `CloseHoldingSheet` + `useCloseHoldingAction`. Update the kiko-gestures source-file list. Commit.

**Mutation:** about 5 files (`holding-card.component.tsx`, `close-holding-sheet.component.tsx`, `close-holding-copy.ts`, `use-close-holding-action.ts`, `account-detail.screen.tsx`).

### implicit-accounts task 5/8: Accounts screen shows one card per property/loan holding (developer)

**Files:**
- Modify: `src/screens/accounts/accounts.screen.tsx`, `src/screens/accounts/accounts.styles.ts` (only if a style key is needed)
- Modify: `src/screens/accounts/accounts.screen.test.tsx`

**Behavior:**
- Partition `activeAccounts` into `mainAccounts` (every non-implicit kind) and `implicitAccountByKind` (the live property and debt rows, `isImplicitAccount`). Section data = that account's OPEN holdings from `holdingsByAccount`, in query order (`sort_order`, `created_at`). Read `isFresh` from the holdings query.
- The Property and Debts sections render when their holding list is non-empty. Same heading, same `testID`s, same section totals: `propertyTotal`/`debtsTotal` = `guardedNetWorth(<that section's holdings>, …)`, the same value as before.
- Each section is a `Sortable.Grid` of holdings with the shared tuning (Global Constraints), `keyExtractor={(holding) => holding.id}`, and `sortEnabled={holdingsFresh}`. `onDragEnd` goes through `onGridDragEnd(…, holdingsRepo.reorder)`, which persists that implicit account's open holdings only (the account-detail contract).
- Each item: `<CardContextMenu name={holding.name} deletable={!isSyncedHolding(holding, account)} onDelete={() => holdingsRepo.remove(holding.id)} closeAction={closeActionFor(holding)}>` wrapping `<HoldingCard … onOpen={() => navigation.navigate('HoldingDetail', { holdingId, name })} />`. Render `closeSheet` once per screen (a per-section hook instance is fine).
- The main grid persists `accountsRepo.reorder([...mainIds, ...implicitAccountIds])` (property first, then debt, keeping the full-order rule of kiko-gestures).
- Empty state: shown when `mainAccounts`, the property holdings, and the debt holdings are all empty (Review Focus 2).
- Implicit accounts never render as account cards. (Device fix 6 later made each section heading open the account's AccountDetail.)

- [ ] **step 1/4: Failing screen tests:** the property section renders one `holding-card` per open property holding (closed ones excluded) and no `account-card` for the implicit account. Its total equals the sum of those holdings. The debts total is negative and unchanged. A tap navigates to `HoldingDetail { holdingId, name }`. A long-press menu offers Close loan / Delete for a loan, with Delete calling `holdingsRepo.remove`. A drag end with `fromIndex !== toIndex` calls `holdingsRepo.reorder` with that section's ids only. A main-grid drag persists main ids + implicit ids. An empty implicit account alone shows the empty state. An archived property account's holdings show nowhere. Sort is disabled with one holding.
- [ ] **step 2/4: Implement.**
- [ ] **step 3/4: Green.** `npx jest src/screens/accounts`, `make typecheck && make lint && make gate`.
- [ ] **step 4/4 (scribe):** kiko-gestures "Sortables grid conventions" and "Section-scoped grids must persist the FULL order": the Property and Debts grids are now holding grids, and the main grid persists main + implicit account ids. Commit.

**Mutation:** 1–2 files.

### implicit-accounts task 6/8: create flow, Property/Loan kind swaps in the implicit holding form (developer)

**Files:**
- Modify: `src/navigation/types/types.d.ts`: `AccountForm: { accountId?: string; initialKind?: AccountRow['kind']; draft?: FormDraft }`. `HoldingForm` becomes `({ accountId: string } | { implicitKind: ImplicitAccountKind; draft?: FormDraft }) & { holdingId?; debtAccount?; returnTo? }`, with `type FormDraft = { name: string; icon: string | null; color: string | null }`.
- Create: `src/screens/forms/holding-form/holding-form-target/{holding-form-target.ts,holding-form-target.test.ts,index.ts}`. It is a pure resolver: `holdingFormTarget(params): { kind: 'account'; accountId: string } | { kind: 'implicit'; implicitKind: ImplicitAccountKind }` (ts-pattern `match`).
- Modify: `src/screens/forms/holding-form/holding-form.screen.tsx`, `src/screens/forms/account-form/account-form.screen.tsx`, `src/navigation/accounts-stack/accounts.stack.tsx` (HoldingForm `options={({ route }) => ({ animation: 'draft' in route.params ? 'none' : 'default' })}`, AccountForm likewise for `draft`).
- Modify tests: `holding-form.screen.test.tsx`, `account-form.screen.test.tsx`, `accounts.stack.test.tsx`.
- Modify: `.maestro/property-metals-debts.yaml` (qa). Its Property and Debt steps now create the item and the loan straight from "Add account" (no separate account step). Assert `accounts-property-grid` / `accounts-debts-grid` contain the holding names.

**Behavior:**
- AccountForm, create mode: `handleSelectKind(next)` with `isImplicitAccountKind(next)` calls `navigation.replace('HoldingForm', { implicitKind: next, draft: { name, icon: iconIsDirty ? icon : null, color } })` (keep the user's picked icon, not the kind default). `initialKind`/`draft` seed the form on mount. Edit mode never reaches this (the kind field is disabled).
- HoldingForm, implicit mode (`holdingFormTarget(...).kind === 'implicit'`): the type options are `creatableHoldingTypesForAccount(implicitKind, false, null)` (`['property_item']` / `['loan']`). `debtAccount = implicitKind === 'debt'`. The title stays `forms.account.addTitle`. It renders `AccountKindField` (the same labels, subtitles, and icons as AccountForm; move the two label maps into a shared `useAccountKindLabels()` in `src/screens/forms/account-kind-field/` so the two screens do not duplicate them) above the identity block, `selected = implicitKind`. Picking a non-implicit kind calls `navigation.replace('AccountForm', { initialKind, draft })`. Picking the other implicit kind does `navigation.setParams({ implicitKind })`. The draft seeds name, icon, and color once. Save calls `accountsRepo.createImplicitHolding(implicitKind, { name, type, currency, color, ...active.createPayload() })`, then the existing `setIcon`, `refreshMarketData`, `runLoanAutoLinkIfLoan`, and `goBack()`, all unchanged. The account query is skipped (`byIdQuery('')`, as today in create mode).
- The account-mode HoldingForm is unchanged.

- [ ] **step 1/5: Failing resolver tests** (`holding-form-target.test.ts`): `{ accountId }` → account. `{ implicitKind: 'debt' }` → implicit.
- [ ] **step 2/5: Failing screen tests.** AccountForm: picking Property calls `replace('HoldingForm', { implicitKind: 'property', draft })` with the typed name and the picked icon/color. `initialKind: 'bank'` + draft seeds the form. HoldingForm implicit property: shows the property fields and no bank/account pickers. Save calls `createImplicitHolding('property', …)` once and `goBack`. An implicit loan Save calls `createImplicitHolding('debt', …)` and `runLoanAutoLink`. Picking Bank in the implicit form calls `replace('AccountForm', { initialKind: 'bank', draft })`. A second create reuses the account: covered by task 3/8's real-SQLite test, and here asserted as a single repo call per Save. accounts.stack: the swapped routes have `animation: 'none'`.
- [ ] **step 3/5: Implement.**
- [ ] **step 4/5: Green.** `npx jest src/screens/forms src/navigation`, `make typecheck && make lint && make gate`. Run the Maestro flow when a simulator is available (ops), otherwise flag it for the device check.
- [ ] **step 5/5 (scribe):** kiko-domain "`property_item` / `metal` create-form sections" and "Loan form + detail": the implicit entry and the swap. Commit.

**Mutation:** about 4–5 files (`holding-form-target.ts`, `holding-form.screen.tsx`, `account-form.screen.tsx`, `accounts.stack.tsx`, `use-account-kind-labels.ts`).

### implicit-accounts task 7/8: localized implicit names everywhere, reminder routing without AccountDetail (developer)

**Files:**
- Modify: `src/screens/home/home.screen.tsx` (filter options and row matching). Map `accounts` once through `{ ...account, name: accountDisplayName(account, t) }`. Rows: add `accountKind: accounts.kind` and `accountArchivedAt: accounts.archivedAt` to the projection in `src/transactions/repo/transactions.repo.ts:~813` and resolve `accountName` with the same helper in the screen.
- Modify: `src/screens/statistics/statistics.screen.tsx` (map `accounts` once through the helper before the filter options, the `filtered` memo, and `accountContribution`).
- Modify: `src/screens/settings/reminders/reminders.screen.tsx` (`name: accountDisplayName(account, t)`; `listWithAccountQuery` already reads `kind` and `archivedAt`).
- Modify: `src/screens/settings/account-reminders/account-reminders.screen.tsx` (title from the loaded account through the helper, falling back to `route.params.name`).
- Modify: `src/reminders/routing/route-response.ts`: `routeFor`'s `account` becomes `Pick<AccountRow, 'id' | 'name' | 'kind' | 'archivedAt'>`, and `ReminderRoute.accountDetail` becomes optional. For `isImplicitAccount(account)`: an open response → `{}` (the Accounts tab with its current pages kept; the root only when the tab is unmounted or at its root). The paused notice → `{ next: { screen: 'AccountReminders', params: { accountId } } }`. `navigateNow` skips `withAccountOnTop` when `accountDetail` is undefined.
- Modify tests: `home.screen.test.tsx`, `statistics.screen.test.tsx`, `reminders.screen.test.tsx`, `account-reminders.screen.test.tsx`, `route-response.test.ts`, `route-response.navigator.test.tsx`, `transactions.repo.test.ts` (projection keys).

- [ ] **step 1/4: Failing tests.** Under uk, the Home account filter lists "Майно" for a property account stored as "Properties", and selecting it filters that account's rows (Review Focus 4). Statistics shows "Кредити" in the filter and the contribution chart. Settings > Reminders headings use the implicit name. The AccountReminders page renders no account name (its nav title is the static "Reminders"), so it has no title to localize. `routeFor` for an implicit account returns no `accountDetail` (open) and AccountReminders only (paused). The navigator test: one `navigate('AccountsTab', …)` whose routes end `[Accounts, AccountReminders]`. A bank account routes exactly as before.
- [ ] **step 2/4: Implement.**
- [ ] **step 3/4: Green.** `npx jest src/screens/home src/screens/statistics src/screens/settings src/reminders src/transactions`, `make typecheck && make lint && make gate`.
- [ ] **step 4/4 (scribe):** kiko-architecture "Reminders" → "Tap routing": the implicit-account route. kiko-translator: "an implicit account is named by `accountDisplayName`, never by `account.name`" (the seeded-category rule's sibling). Commit.

**Mutation:** about 6 files.

### implicit-accounts task 8/8: docs, whole-branch review, verify, device checklist (coordinator → scribe, reviewer, ops)

- [ ] **step 1/5:** `kiko:retrospect` over both skill locations and `harness/kiko/agents/`, then `kiko:scribe` fixes any drift (or "no drift found"). Update `docs/harness/documented-exceptions.md` only if an exception was added (none is planned).
- [ ] **step 2/5:** One whole-branch review (`kiko:reviewer`), including the Review Focus list above.
- [ ] **step 3/5:** `make verify` (lint → full jest → `check:all`), run until green. The full jest run is required: the 34 mocked-repo test files are exactly where a scoped run misses a regression (memory `scoped-tests-miss-cross-file-regressions`).
- [ ] **step 4/5:** Mutation evidence: for each of tasks 1/8–7/8, the coordinator's `KIKO_MUTATION_BASE=<task base sha> make mutable` count (≤ 30) and the `make deep` result.
- [ ] **step 5/5:** The user reviews the i18n keys (below), then a Release device build (ops, physical device), then the device checks (below). The feature is done only when the user confirms on the device.

## i18n keys

- **Added:** `accounts.implicitName.property` (en "Properties", uk "Майно"), `accounts.implicitName.debt` (en "Loans", uk "Кредити"). Both PENDING USER REVIEW (QUESTION 2).
- **Removed:** `accountDetail.addLoan` (en "Add loan", uk "Додати кредит"). Its only caller, the debt account page footer, is no longer reachable.
- **Unchanged, now used by the implicit HoldingForm:** `forms.account.addTitle`, `forms.account.kind*`, `forms.holding.namePlaceholders.propertyItem` / `.loan`, `forms.holding.addLoanTitle` (still the title of an account-mode loan create).

## Device checks (user, Release build, physical device)

1. Before installing: Settings → Export a `.kiko` file, and write down the Home net worth plus the Accounts Property and Debts totals.
2. After the upgrade: net worth and both section totals are EXACTLY equal to step 1. Every former property item and loan shows as its own card, in the old order: the old accounts top to bottom, then each one's own order.
3. Settings → Reminders: each former property/debt reminder kind appears once, under "Properties"/"Loans", with its schedule and pause state as before.
4. Accounts → Add account → kind Property: the fields swap in place, with no slide animation. The name typed before the swap is kept. Save → the new card appears in Property. Add a second property: still ONE Property section, now with two cards.
5. Add account → Loan with a schedule and "Paid from": Save → the card appears in Debts, and the total moves by minus the outstanding. Matching past payments link automatically (the Home loan glyph).
6. In the implicit form, switch the kind back to Bank: the bank fields return with the name kept. Back from the implicit form returns to Accounts.
7. Property/Debts cards: a tap opens holding detail. Hold still → the menu (Close holding / Close loan, Delete). Hold and move → drag. The new order survives an app relaunch.
8. Delete the last loan: the Debts section disappears, and nothing else changes.
9. Settings → Import the `.kiko` from step 1: the result is the same as step 2 (cards, order, totals, reminders).
10. Switch the language to Ukrainian: "Майно"/"Кредити" in the Home account filter, the Statistics filter and contribution chart, and Settings → Reminders.
