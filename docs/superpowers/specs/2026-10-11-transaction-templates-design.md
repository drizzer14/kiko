# Transaction templates — design

Status: design only (not yet planned or built). Release: Kiko 1.2.
Track: `transaction-templates` (worktree base main `1f7a26a4`).

## Goal

The user enters the same transactions again and again (rent, a subscription, a
weekly shop). A template stores every field of a transaction except its date. The
Add form fills from a template in one pick, and any Add, Duplicate or Edit form can
save its content as a new template.

Success: a repeat transaction takes the Template tab, one pick, then Save.

## Decisions (user rulings, approved — do not change)

1. The Add transaction form gets two tabs: **Manual** (the default, today's form)
   and **Template**. The Template tab shows a select field (the same `SelectField`
   + `BottomSheet` pattern as the holding and category pickers) that lists the
   template names. After a pick, the full form shows below the select, filled from
   the template. The date is now. Every field stays editable before Save.
2. A toggle **"Save as a new template"** / **«Зберегти як новий шаблон»** sits at
   the bottom of the Add, Duplicate and Edit forms (all three). When it is on, a
   required **Template name** text field shows below it. Save writes the
   transaction and the template.
3. Settings gets a new group that holds **Transaction templates** and
   **Categories**. Categories moves into this group. The templates list uses the
   usual entity cards: a context menu with Edit and Delete, and a footer button
   "Add template".
4. "Add template" opens the transaction form with a template name field and no
   date. The toggle is hidden and always on. There is no "view template" screen:
   a tap on a template card opens its edit form. The edit form has a **Create
   transaction** button that opens the Add form, filled from that template.
5. A template stores ALL fields of EVERY type: income, expense, exchange and split
   (holdings, amounts, category, description, split parts, returns, as they
   apply). The loan link is excluded (user ruling 2026-10-11, decision O5). The
   amount is OPTIONAL: when it is empty, the form asks for it. The date is never
   stored.
6. When the user deletes a holding or a category that a template uses, the
   template stays and that field becomes empty. The form asks for the field when
   the template is used. The delete confirm says how many templates change.
7. Templates go into the `.kiko` export and restore.

### Rulings on the former open points (2026-10-11)

Each id `O<n>` keeps the number of the open point it closed.

- **O1 — Tabs on both Add entries** (user ruling 2026-10-11). The tabs show on
  the global entry `{}` and on the holding entry `{ holdingId }`.
  - On `{ holdingId }`, the page's holding stays unless the template names
    another one. A template with a resolved `holdingId` replaces it. A template
    whose `holdingId` is null (empty or dangling) keeps the page's holding.
  - On `{}`, a template whose `holdingId` is null clears the default holding, so
    the form asks for it (orchestrator ruling). Reason: the global default holding
    is not a holding the user chose for this page, so a template must not silently
    inherit it. Cost if wrong: one more tap on the global entry.
- **O2 — A tab switch keeps the field values** (default, no user objection).
- **O3 — Name unique, holding required** (user ruling 2026-10-11). The template
  name is trimmed and unique case-insensitively. In the template modes the name
  and the primary holding are required. All other fields are optional there.
- **O4 — The toggle is hidden on an Edit of a synced or imported row** (default,
  no user objection).
- **O5 — The loan link is not stored** (user ruling 2026-10-11). No loan field
  exists anywhere in the template flow, and the Manual form stays unchanged. A
  template made from an Edit of a row with a loan link does not carry the link.
- **O6 — "Create transaction" uses the template as stored** (default, no user
  objection). Unsaved edits on the edit form are not used.
- **O7 — Category-delete confirm** (default, no user objection). The track that
  merges into `next` SECOND rebases onto the first and adds its own line to the
  confirm. The two tracks make no shared edit to it in parallel.
- **O8 — List order is `created_at` ascending** (default, no user objection).
- **O9 — The list card is `TransactionCard` with an optional amount** (default, no
  user objection). The designer owns that change.
- **O10 — Import result counts stay unchanged** (default, no user objection).
- **O11 — The comment is left out of the draft** (user ruling 2026-10-11).
- **O12 — A category from a template counts as a hand pick** (default, no user
  objection). It sets `userPickedCategory` and the manual-pick flag of the
  category-rules track, so a rule does not replace it.

## Current state (verified)

- The form is one file:
  `src/screens/forms/transaction-form/transaction-form.screen.tsx` (2852 lines).
  Its test file `transaction-form.screen.test.tsx` has 4759 lines (178 KB). The
  component body runs from line 1583 to line 2824. Module-level helpers fill
  lines 110–1581.
- Route params: `TransactionFormParams` (`src/navigation/types/types.d.ts:32`) is
  `{ holdingId } | { transactionId } | { duplicateOfTransactionId } |
  Record<string, never>`. `readRouteEntry` (screen:858) reads them.
- The Duplicate seed path: `resolveHydration` (screen:933) returns a
  `HydrationPlan` (screen:897). The steps are `seedHolding` (which sets the
  `primaryHoldingId` seam), then `seedFields` (built by `seedFieldsFrom`,
  screen:912). The duplicate gives `time: null`, so the date stays now
  (screen:963–974). The hydrate effect applies the plan once, behind the
  `hydrated` latch (screen:1912–1975). A non-null seeded category also sets
  `userPickedCategory` (screen:1940–1951).
- **The Duplicate seed covers income and expense only.** `seedFieldsFrom` reads
  `amountMinorUnits`, `description` and `category` from a `TransactionRow`, plus
  the row's `holdingId` (through `seedHolding`). It never seeds an exchange
  destination, Value in, split returns or a loan link. Exchange and Split are
  create-only modes (`resolveModeOptions`, screen:516). An edit always opens as
  income or expense.
- The loan link is edit-only and is saved at once: `isLoanFieldVisible`
  (screen:1418) requires an `existing` row, and `selectLoanPayment` calls
  `transactionsRepo.setLoanPayment` (repo:2458) straight away. A create has no
  loan field. Templates do not change this (decision O5).
- The comment is read-only. `renderCommentRow(existing?.comment, …)`
  (screen:165) only shows a bank or statement comment. No manual write path takes
  a comment: `ManualTransaction` (`src/transactions/repo/transactions.repo.ts:71`)
  has no `comment` field.
- Save paths: `writeManual` → `recordManual` (repo:2064) or `update` (repo:2289);
  `saveSplit` → `recordManualWithReturns` (repo:2263); `saveExchange` →
  `recordExchange` (repo:2079); `saveConvert` → `recordExchangeCounterpart`. Each
  repo method opens its own `write(...)` (`src/db/client.ts:138`).
- Validation: `MODE_BEHAVIOR` (screen:461) maps each mode to its field errors,
  field order and save path. Save is always enabled. A blocked press sets
  `attemptedSave` and scrolls to the first invalid field (screen:2469).
- Settings: each setting is its own `Card`. Import/Export already share one card
  (padding 0, a row style on each row, a divider inset to the label;
  `src/screens/settings/settings/settings.screen.tsx:205–224`). Categories is a
  card of its own (settings.screen.tsx:252–259). The Settings stack
  (`src/navigation/settings-stack/settings.stack.tsx`) does not register
  `TransactionForm`, `AccountForm` or `HoldingForm`. The Home stack registers all
  three (`src/navigation/home-stack/home.stack.tsx:38–66`), because the form's
  empty pickers open the create forms.
- Holding delete: `removeHoldingDatabaseTransaction`
  (`src/holdings/repo/holdings.repo.ts:425`, called by
  `transactionsRepo.removeHolding`, repo:2389) and `accountsRepo.remove`
  (`src/accounts/accounts.repo.ts:411`, its own per-holding loop) are the only
  places that delete holdings (apart from the restore). Both clear loan links in
  the same write (`clearLoanLinksForHoldingsDatabaseTransaction`,
  holdings.repo.ts:389). The confirm text comes from `removeHoldingsNoticeOf`
  (`src/transactions/remove-notice/remove-notice.ts:200`) over
  `RemoveHoldingsPlan` (remove-notice.ts:133). Callers:
  `accounts.screen.tsx:243` (an account: all its holdings), `accounts.screen.tsx:376`
  and `account-detail.screen.tsx:519` (one holding).
- Category delete: `categoriesRepo.delete` (`src/categories/repo/categories.repo.ts:81`)
  moves transactions and override rules to the default category, then deletes the
  row, all in one write. Its confirm is a title-only `ConfirmSheet`
  (`src/screens/settings/categories/categories.screen.tsx:330–336`).
- Data transfer: `DataSnapshot` (`src/data-transfer/snapshot/data-snapshot.d.ts`)
  is the list of tables. `snapshot-covers-every-table.test.ts` fails when a schema
  table is missing from it. `deletedImportKeys` (migration 0054) is the precedent
  for an optional key on a new table. `EXPORT_VERSION = 2`
  (`src/data-transfer/crypto/envelope.ts:13`). `VERSION_DECISIONS`
  (`envelope.test.ts:99`) records the decision for each migration
  (`migrationCount`: 57 before this branch; 58 with it). `REQUIRED_TABLE_KEYS` in
  `src/data-transfer/import-data.ts` lists the keys that every file must carry.
- Migrations: the journal ends at idx 56 (`0056_add_category_rules`) before this
  branch, which ships 0057. The first branch to reach `next` keeps the number; a
  later branch renumbers at merge.

## 1. Data model

### Table `transaction_templates` (migration 0057)

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | `id()`, as other tables use |
| `name` | text NOT NULL | trimmed; unique case-insensitively (decision O3), checked in JS |
| `draft` | text NOT NULL, `mode: 'json'`, `.$type<TemplateDraft>()` | the form content; see below |
| `created_at` | integer NOT NULL default `(unixepoch() * 1000)` | list order |
| `updated_at` | integer NOT NULL default `(unixepoch() * 1000)` | set on every update |

- No foreign keys. All references live inside `draft`, and a delete clears them
  (section 2), so no NO ACTION ordering is needed on delete or restore.
- No index. The table is small and each query reads it by PK or in full (the
  list). If the plan adds an index, it must add an `EXPLAIN QUERY PLAN` test
  (kiko-architecture "An index on a nullable column…").
- The migration is additive only: one `CREATE TABLE`. It needs no data step and no
  restore mirror (kiko-architecture "A new table with no backfill is the table, in
  order, on both paths").
- **Number:** this branch ships 0057. The runner counts migrations
  (`journal.entries.slice(COUNT(*))`, kiko-architecture "Storage"), so the journal holds no
  gap. The first branch to reach `next` keeps the number; a later branch renumbers at merge.
  Never ship two migrations at one idx.

### `TemplateDraft` (refinement of the proposed "Duplicate seed shape")

The core of the draft maps one-to-one to what the Duplicate seed reads from a
`TransactionRow`: `holdingId`, `amountMinorUnits`, `description`, `category`
(screen:912, 963–974). Three refinements, each with its reason:

1. **The amount is unsigned and can be null, and the sign comes from `mode`.** A
   signed number cannot be empty (ruling 5). It also cannot express exchange or
   split, which are not signed rows.
2. **`currency` is stored next to each amount.** If the holding is deleted, the
   stored minor units still need a scale before they can be formatted exactly
   (`majorAmountText(currency, minor)`). Without the currency, a 1050 that was
   saved as USD would read as ¥1050 after the user picks a JPY holding.
3. **Mode-specific parts** (exchange, split returns). The Duplicate seed has
   nowhere to put them today.

The draft has no loan field and no comment (decisions O5 and O11).

```ts
type TemplateDraft = {
  version: 1;
  mode: FormMode;                       // 'income' | 'expense' | 'exchange' | 'split'
  holdingId: string | null;             // primary leg: payer, or exchange source
  currency: Currency | null;            // currency of holdingId at save; scales every
                                        // primary-currency amount below
  amountMinorUnits: number | null;      // unsigned; exchange: Value out; split: payment
  description: string;                  // as stored on a create (storedDescription rule)
  category: string | null;              // lowercase key; always null for exchange
  exchange: {                           // mode 'exchange' only, else null
    destinationHoldingId: string | null;
    destinationCurrency: Currency | null;
    valueInMinorUnits: number | null;
  } | null;
  returns: { holdingId: string | null; amountMinorUnits: number | null }[];
                                        // mode 'split' only (payer currency), else []
};
```

What each type stores:

| Mode | Stored fields |
|---|---|
| income / expense | holdingId, currency, amountMinorUnits, description, category |
| exchange | holdingId (source), currency, amountMinorUnits (Value out), exchange.{destinationHoldingId, destinationCurrency, valueInMinorUnits} |
| split | holdingId (payer), currency, amountMinorUnits (payment), description, category, returns[] |

A template made from an Edit form is always income or expense, because an edit
opens no other mode (screen:516). An edited exchange leg or split payment saves as
a plain income or expense template. The leg's exchange marker is not stored, the
same as Duplicate (screen:226–233). A template made from an Edit of a row with a
loan link does not carry the link (decision O5): the row's link stays on the row,
and the template has no slot for it.

The category (user ruling, 2026-10-12): a template stores a category only when the
user picked it by hand, so `category` is null for a rule pre-select and each use of
the template gets the current rule pre-select. A template being edited or filled in
that already carries a category keeps it (decision O12). On Duplicate and Edit
transaction the source row's category counts as a hand pick (user ruling,
2026-10-12): the category-rules design writes a Duplicate seed with
`categorySetByHand` 1, so a template saved from them stores it. The form's draft
builder is the one place that applies this rule.

### Type guard and the read rule

- `isTemplateDraft(value: unknown): value is TemplateDraft` uses the shared
  `isRecord` (`@kiko/type-guards`; kiko-code-style "Helper placement"). It checks
  each field: `mode` is in the `FormMode` list, a currency is in the currency
  list, an amount is null or a positive safe integer, and an id or key is a string
  or null.
- A row whose draft fails the guard reads as `EMPTY_DRAFT` (`mode: 'expense'`,
  every reference null, amounts null, description `''`), with its name kept. It
  stays listed, editable and deletable. A bad row never throws on read and never
  fails a restore.
- **A dangling reference reads as empty.** A pure helper
  `resolveDraftReferences(draft, options)` sets each id to null when the picker
  for that field does not list it: `buildPrimaryOptions` for `holdingId`,
  `buildExchangeOptions` for the destination, `buildReturnOptions` for each
  return, and the categories list for
  `category`. This covers a deleted id, and also a holding that is now closed or
  synced. The form then asks for that field (section 3). The delete paths also
  clear deleted ids (section 2), so a dangling id only remains from an outside
  cause.

### Stored by id

| Reference | Draft slot | Cleared on delete by |
|---|---|---|
| holding | `holdingId`, `exchange.destinationHoldingId`, `returns[].holdingId` | holding delete, account delete |
| category | `category` | category delete |

### Code home

A new feature container `src/transaction-templates/` (declare it in
`scripts/checks/feature-imports.js`):

- `repo/`: `transaction-templates.repo.ts` with `listQuery`, `getByIdQuery`,
  `create`, `update`, `remove`, `insertDatabaseTransaction`,
  `clearHoldingsDatabaseTransaction`, `clearCategoryDatabaseTransaction`,
  `countReferencingHoldingsDatabaseTransaction`, and `countReferencingCategory`.
  It uses `satisfies Repository`.
- `draft/`: the `TemplateDraft` type, `isTemplateDraft`, `EMPTY_DRAFT`,
  `draftReferences(draft)` (the ids and key it names), and
  `clearDraftReferences(draft, { holdingIds, categoryKey })`.

## 2. Delete paths and the confirm count

**Clearing happens in the same write as the delete.** The repo helpers filter in
SQL first and then decide in JS. This follows the rule
`kiko-no-full-table-select-in-write`.

- SQL prefilter: `WHERE instr(draft, '"' || ? || '"') > 0` for each id or key.
  This can match more rows than it should (a category key can also appear inside a
  description). The pure `draftReferences` then makes the exact decision, and
  `clearDraftReferences` rewrites only the rows that really reference the id.
  `updated_at` is not touched, because the user did not edit the template.
- **Holding:** `removeHoldingDatabaseTransaction` (holdings.repo.ts:425) and
  `accountsRepo.remove` (accounts.repo.ts:411) call
  `clearHoldingsDatabaseTransaction(databaseTransaction, holdingIds)` next to
  `clearLoanLinksForHoldingsDatabaseTransaction`. Every slot in the "Stored by id"
  table is cleared. A cleared return keeps its row with `holdingId: null`, so the
  form asks for it.
- **Category:** `categoriesRepo.delete` (categories.repo.ts:81) calls
  `clearCategoryDatabaseTransaction(databaseTransaction, key)` in its write. The
  key is matched in lowercase, like the transaction reassignment there.
  Templates are **cleared to null, not moved to the default category**, unlike
  transactions (ruling 6).
- **Confirm count, holding and account:** add `templatesChanged: number` to
  `RemoveHoldingsPlan` (remove-notice.ts:133).
  `planLinkedRowsDatabaseTransaction` (transactions.repo.ts:921) fills it from
  `countReferencingHoldingsDatabaseTransaction`. `removeHoldingsNotice`
  (remove-notice.ts:181) appends the sentence `holdings.deleteLinked.templates`
  (plural, `count`) when the count is above 0. All three callers show it without
  changes. An account delete counts across all its holdings, and counts each
  template once.
- **Confirm count, category:** `countReferencingCategory(key)` together with the
  sentence `categories.deleteTemplates` (plural). The categories screen confirm
  shows it as the `ConfirmSheet` body. The categories screen belongs to
  category-rules. Who adds the line (decision O7): the track that merges into
  `next` second rebases onto the first and adds its own line to the confirm. If
  templates is second, it adds the count line to whatever confirm category-rules
  shipped. If templates is first, it adds a `message` to today's `ConfirmSheet`,
  and category-rules keeps that line when it rebases. The two tracks never edit
  the confirm in parallel. See "Boundary with category-rules".
- A template delete (context menu) has no links. It is a title-only confirm
  (`common.deleteNamed`).

## 3. The form

### 3.0 Split first (task 1, alone, behavior unchanged)

Before any template code, one task splits `transaction-form.screen.tsx`. It moves
code only. It renames nothing apart from turning each `renderX` function that
returns JSX into a `<X />` component, which "One component per file" requires.
The tests stay unchanged, with one exception: the `canSaveSplit` import
(test:23) moves to `validation/` and its `describe` block moves with it. The
`jest.mock` paths in the test target repo modules, so they still apply. This task
lands in `next` first, as its own change set, so category-rules can build on it.
No merge into main or `next` happens in overnight mode.

Proposed units, each a folder with an `index.ts` under
`src/screens/forms/transaction-form/`:

| Unit | Moves (screen lines) | Owner after split |
|---|---|---|
| `route-entry/` | `readRouteEntry` (858–881) | templates (adds template params) |
| `hydration/` | `toAmountFields`, `HydrationPlan`, `seedFieldsFrom`, `resolveHydration` (844–987) | templates (adds the template seed) |
| `validation/` | `SaveDisabledParams`, `SaveDisabledField`, the field-error functions, `isSplitAmountInvalid`, `ActiveMode`, `resolveActiveMode`, `ModeBehavior`, `MODE_BEHAVIOR`, `firstInvalidField`, `isPositiveAmountText`, `canSaveSplit`, `areWellFormedReturns`, `returnsCoverPayment` (302–596, without the category items) | shared; templates adds `templateName` and `holding` |
| `mode-options/` | `resolveModeOptions`, `MODE_ICONS` (516–540) | — |
| `holding-options/` | `syncedHoldingIds` … `resolveDefaultPrimaryHolding` (600–803) | — |
| `convert-view/` | `ConvertView`, `convertCounterpartType`, `resolveConvertView` (997–1075) | — |
| `row-labels/` | `readOnlyNoticeKey`, `headerTitle`, `holdingSuffix`, `signedMinorUnits`, `resolveDescriptionPlaceholder`, `buildHoldingNameById`, `resolveBlankLabel`, `storedDescription` (110–300, non-JSX) | templates (adds template titles) |
| `category-rule/` | `ruleCategoryFor`, `resolveCategoryOverrideRequest`, `resolvePendingCategory` (309–316, 497–507, 1554–1581) | **category-rules** |
| `read-only-notice/`, `comment-row/`, `primary-holding-field/` | the matching `render*` (123–183, 813–839) | — |
| `field-group/` | `FieldGroupProps`, `renderFieldGroup` (1084–1258) | templates (adds `showsDate`) |
| `split-returns/` | `renderSplitReturns` (1267–1384) | — |
| `mode-and-actions/` | `showsSaveButton`, `isLoanFieldVisible`, `resolveLoanLinkState`, `renderModeAndActions` (1391–1547) | — (the loan field stays unchanged, decision O5) |
| `category-override-sheet/` | the override `BottomSheet` JSX (screen:2735–2805) | **category-rules** |
| `use-category-override/` | `pendingOverride` state, `applyOverride`, `applyOverrideOne`, `cancelOverride`, their `useSubmitOnce` instances, `pendingCategory` | **category-rules** |
| `use-category-pick/` | `selectedCategory`, `userPickedCategory`, `selectCategory`, `seedCategory`, `settleDescription`, `pickSuggestion` (and `effectiveCategory`) | **category-rules** |

The screen keeps state, the hydrate effect, the save handlers and the layout. The
file count is about 17 units, which is under the 30-file mutation cap. Count it
with `make mutable` against the task base.

### 3.1 Tabs (Add only)

- A `SegmentedControl` with **Manual** and **Template** goes at the top of the
  form. Each tab shows different fields, so this follows the tabs-vs-chips rule
  (kiko-design-system "SegmentedControl"). Manual is the default.
- It shows on both create entries, `{}` (global add) and `{ holdingId }`
  (decision O1), and on `{ templateId }`. It does not show on Duplicate, Edit,
  Add-template or Edit-template.
- **Template tab before a pick:** only the template `SelectField` (label
  "Template", placeholder "Select a template", sheet title "Template"). There are
  no other fields and no Save button. When there are no templates, the select is
  shown with an `InfoHint` below it (`forms.transaction.noTemplatesHint`).
- **After a pick:** the whole form shows below the select, filled from the
  template, with the date at now. A new pick fills every field again from the new
  template.
- A tab switch keeps the field values (no data loss). The tab only changes whether
  the select shows and whether the form waits for a pick (decision O2).
- With `{ templateId }`, the form opens on the Template tab with that template
  already picked.

### 3.2 Fill through the Duplicate seed (one path)

- `resolveHydration` gets one new input, `templateDraft` (the picked draft, after
  `resolveDraftReferences`). It uses the same two steps as Duplicate:
  `seedHolding` (set `primaryHoldingId` from `draft.holdingId`, not final), then
  `seedFields` once the holding resolves, with `time: null`.
- When `draft.holdingId` is null (dangling or empty), the plan skips `seedHolding`
  and runs `seedFields` at once. What happens to the seam depends on the entry
  (decision O1):
  - `{ holdingId }`: the seam keeps the page's holding.
  - `{}`, `{ templateId }`, Edit-template: the seam is cleared to null (the
    default holding is not a page choice), so the form asks.
  A resolved `draft.holdingId` always replaces the seam, on every entry.
- `seedFields` grows optional mode fields: `mode` (it replaces `sign`, which is
  `Sign` today), `destinationHoldingId`, `valueIn` and `returns`. The Duplicate
  and Edit plans fill them with today's values (the sign, no destination, one
  empty return), so their behavior does not change. The effect sets each one with
  its existing setter. There is no loan slot (decision O5).
- Amounts become text through `groupAmount(majorAmountText(draft.currency, minor))`.
  This uses the stored currency and never `holding?.currency ?? 'UAH'`, so the
  scale is exact even when the holding is gone. Value in uses
  `exchange.destinationCurrency`. A null amount leaves the field empty.
- A seeded non-null category counts as a hand pick (decision O12). It sets
  `userPickedCategory`, the same as Duplicate (screen:1949), and the manual-pick
  flag of category-rules, so neither the pre-select nor a rule replaces it.
- A template pick is an event. It sets the picked draft and opens the `hydrated`
  latch again (`setHydrated(false)`). The same effect then applies the plan. There
  is no second effect and no second fill path.

### 3.3 The "Save as a new template" toggle (Add, Duplicate, Edit)

- It goes at the bottom of the form, after the comment row (screen:2722). It is a
  `Switch` with a `label` (the precedent is `term-deposit-section.component.tsx:204`),
  off by default. When it is on, a `TextField` **Template name** (required) shows
  directly below it.
- It shows on: Add (both tabs), Duplicate, and an Edit of a manual row. It is
  hidden on an Edit of a read-only (synced or imported) row (decision O4) and
  while converting.
- On an Edit of a row with a loan link, the template does not carry the link
  (decision O5). The loan field itself is unchanged.
- On Save, a `TemplateDraft` is built from the form state by a pure
  `draftFromForm(...)`, which follows the save rules: `descriptionToStore`, the
  lowercase category, minor units through `Money.fromMajor` with the holding's
  currency, and returns with a positive amount. The template insert runs **inside
  the same write as the transaction** (section 6).
- With the toggle on, Save first checks the name field as well as the form's own
  fields. An empty name, or a name that is taken, blocks Save with its own field
  error and scrolls to it.

### 3.4 Add-template mode (`{ newTemplate: true }`)

- Title "Add Template". The **Template name** field goes at the top, above the
  holding picker. The holding picker shows, with the default holding seeded the
  same way as the global add. There is no date or time row (`showsDate: false`
  on `FieldGroup`). The toggle is hidden, because a template is always written.
- The modes are the same as on a create (`resolveModeOptions(false, holding)`),
  so exchange and split are offered for a cash source.
- No loan field shows (decision O5): `isLoanFieldVisible` needs an `existing`
  transaction row, and a template mode has none. No code change is needed for
  this.
- Save calls `transactionTemplatesRepo.create({ name, draft })` (its own write),
  then `goBack`. No transaction is written. The category-override sheet never
  opens in a template mode.

### 3.5 Edit-template mode (`{ editTemplateId }`)

- Title "Edit Template". It is the same as Add-template, filled through the
  template seed (3.2), with the name filled too.
- The footer has **Save** (primary; `transactionTemplatesRepo.update`, then
  `goBack`) and **Create transaction** (secondary). Create transaction pushes
  `TransactionForm` with `{ templateId }`, using `navigation.push`, because a
  `navigate` to the current route name would only change this route's params.
  It uses the template as stored (decision O6): unsaved edits on the edit form
  are not used and not saved. After that transaction is saved,
  `goBack` returns to the edit form.

### 3.6 Validation

Add new `SaveDisabledField` keys: `templateName` and `holding`.

| Field | Add / Duplicate / Edit (toggle off) | toggle on | Add-template / Edit-template |
|---|---|---|---|
| Template name | — | required, and not taken | required, and not taken (the edit's own row is excluded) |
| Holding (primary) | required (new error, needed once a template can leave it empty) | same | required (decision O3) |
| Amount / Value out / payment | required > 0 (today) | same | optional; when filled, > 0 |
| Value in, return amounts | required (today) | same | optional; when filled, > 0 |
| Category | required on create (today) | same | optional |
| Destination, return holding | required (today) | same | optional |

- In the template modes only the name and the primary holding are required; every
  other field is optional (decision O3).
- Every error is computed from its own field and gated by `attemptedSave`
  (kiko-code-style "Form validation model"). The field order puts `templateName`
  first in the template modes and last when the toggle is on.
- The name is trimmed and must be unique (decision O3). "Taken" means equal to
  another template's trimmed name, compared case-insensitively. The form checks it against the live list. The repo
  checks it again inside the write and throws a typed error, which the shared
  save-error alert shows.

## 4. Navigation

- `TransactionFormParams` gets three members: `{ templateId: string }`,
  `{ editTemplateId: string }`, and `{ newTemplate: true }`. The union stays
  mutually exclusive. `readRouteEntry` returns them.
- `SettingsStackParamList` gets `TransactionTemplates: undefined`,
  `TransactionForm: TransactionFormParams`, `AccountForm` and `HoldingForm` (the
  same types as in `HomeStackParamList`). `settings.stack.tsx` registers the three
  forms with the same options and listeners as `home.stack.tsx:38–66`, so the
  "Add holding" row of an empty picker works from Settings.
- The screen's `navigation` prop type (screen:87) gets `push`.
- **Settings group:** the Categories card (settings.screen.tsx:252–259) is
  replaced by one card that holds two rows: **Transaction templates**
  (`settings-row-transaction-templates`, icon `genericEntitySymbol.template`,
  which navigates to `TransactionTemplates`), then **Categories** (the existing
  row, which keeps its testID). The card uses the padding-0 card, the row style
  on each row and the inset divider of the data-transfer card
  (settings.screen.tsx:205–224). It sits where the Categories card is now.
- **Templates list screen** (`src/screens/settings/transaction-templates/`):
  - `useLiveQuery(transactionTemplatesRepo.listQuery(), ['transaction_templates'])`,
    gated on `useDataReady`, ordered by `created_at` ascending (decision O8).
  - Each template is a card wrapped in `CardContextMenu`: `name` is the template
    name, `deletable`, `onEdit` opens the edit form, and there is no
    `deleteMessage`. A tap on the card opens `TransactionForm` with
    `{ editTemplateId }`.
  - Card content: the template name, the category icon tile (or a neutral tile
    when there is none), a caption with the holding name and the type, and the
    amount when one is stored. The card is `TransactionCard` with its `money`
    made optional (decision O9); the designer owns that change.
  - Footer: an "Add template" primary button that opens `TransactionForm` with
    `{ newTemplate: true }`. The precedent is `accounts.screen.tsx:419–431`.
  - Empty: `EmptyState` (icon `genericEntitySymbol.template`, title, message, and
    the action "Add template"). The footer is hidden while the empty state shows,
    as on Accounts.
- Add `genericEntitySymbol.template` = `doc.on.doc` (iOS 13+) to
  `src/holdings/entity-symbols/entity-symbols.ts:123`.
- **Guideline 5.6:** there is no flag. The Settings row, the list, both template
  modes and the tabs show in every build. The Template tab shows even with zero
  templates (with the hint).

## 5. Data transfer

- `DataSnapshot`: add `transactionTemplates?: TransactionTemplateRow[]`. It is
  optional, like `deletedImportKeys`, because an older file has no such key.
- `read-snapshot.ts`: select all rows, ordered by `id`.
- `restore-snapshot.ts`: `deleteAllTables` deletes `transaction_templates` (in any
  order, since it has no FK). The restore inserts
  `snapshot.transactionTemplates ?? []` through `chunkForTable`. Drafts are
  inserted as exported. A draft that fails the guard still restores and reads as
  `EMPTY_DRAFT`. No mirror is needed: the template ids point at holding ids, and
  `withCryptoCashHoldingsMoved` and `withImplicitAccountsMerged` both keep holding
  ids.
- `import-data.ts`: do **not** add the key to `REQUIRED_TABLE_KEYS`. An older file
  must still import. The result counts stay unchanged (decision O10).
- **Version:** no `EXPORT_VERSION` bump. This is a new table carried as an
  optional key, the same case as 0054: an older build drops the key, and this
  build restores an older file with the table empty. Add a 0057 sentence to
  `VERSION_DECISIONS` and raise `migrationCount` by one.
- `snapshot-covers-every-table.test.ts` passes once the key is added.

## 6. Save atomicity

- `transactionsRepo.recordManual`, `recordManualWithReturns`, `recordExchange` and
  `update` each get an optional second argument
  `alongside?: (databaseTransaction: typeof database) => Promise<void>`. It runs
  inside the same `write(...)`, after the rows are written. Through this argument
  the transactions feature does not import templates.
- With the toggle on, the form passes
  `(databaseTransaction) => transactionTemplatesRepo.insertDatabaseTransaction(databaseTransaction, { name, draft })`.
  If either part fails, both roll back. Retrying is then the first attempt
  (kiko-architecture "A create writes everything the user typed in its own
  `write()`").
- An edit with a category change still opens the override sheet after the write,
  as today. The template already holds the picked category.
- Convert has no toggle, so `recordExchangeCounterpart` is not changed.

## 7. Testing

- **Unit (pure):** `isTemplateDraft` (each field valid, invalid and missing; an
  extra key is ignored); `draftFromForm` for each mode; `draftReferences` and
  `clearDraftReferences` (a holding in each slot, a category, an id that also
  appears inside a description); `resolveDraftReferences` (deleted, closed and
  synced become null); `resolveHydration` with a template (two steps, a dangling
  holding that seeds in one step, exact formatting for UAH, JPY and BTC scales,
  and Duplicate and Edit plans that match the current ones exactly); validation
  in the template modes and with the toggle on.
- **Repo (real SQLite through `applyAllMigrations`):** create, update, remove and
  list; the name taken inside the write; a holding delete clears templates through
  both `removeHolding` and `accountsRepo.remove`; a category delete clears
  templates; the counts; `alongside` atomicity in both directions (a forced
  failure in the template insert rolls the transaction back, and the reverse). The
  precedent is `holdings.repo.create-icon.test.ts`.
- **Migration:** `drizzle/migrations/0057-add-transaction-templates.test.ts`
  checks the table, its columns and its defaults. No index is added, so there is
  no `EXPLAIN QUERY PLAN` test. If the plan adds an index, it adds that test.
- **Form:** new test files next to the units, plus a new
  `transaction-form.templates.test.tsx`, so the 178 KB file does not grow. Cover:
  tabs on each entry; a pick fills each type with the date at now; a second pick
  fills again; a tab switch keeps the values; on `{ holdingId }` a template with
  a resolved holding replaces the page's holding and one with a null holding
  keeps it; on `{}` a template with a null holding clears the default holding;
  a template category is a hand pick (`userPickedCategory` and the category-rules
  manual-pick flag set, no rule replaces it); the toggle on Add, Duplicate and
  Edit writes both, and with the toggle off only the transaction is written; the
  toggle is hidden on a synced or imported Edit; an Edit of a row with a loan
  link writes a template with no loan link and leaves the row's link as it was;
  the name error and the taken error (case and surrounding spaces ignored);
  Add-template (no date, no toggle, no loan field, holding required, every other
  field optional); Edit-template Save and Create transaction (`push`, the stored
  template, not the unsaved form).
- **Screens:** the Settings group (both rows, navigation); the templates list (the
  empty state gated on readiness, the cards, Edit and Delete in the context menu,
  the footer).
- **Delete confirms:** `removeHoldingsNotice` with `templatesChanged` (en and uk
  plurals); the category count sentence.
- **Data transfer:** a round trip with templates; an older file without the key
  restores an empty table; a draft that fails the guard restores; the
  `VERSION_DECISIONS` entry.
- **i18n:** parity, casing by role, full stop, and the `TITLE_KEYS` call sites.
- **Gates:** `make verify` once at the end, until it is green. Run `make deep` for
  each change set with `KIKO_MUTATION_BASE=<that change set's base>`, counted
  first with `make mutable`. The split task is one change set of its own. Expect a
  long Stryker run, because it re-homes about 1600 lines that the 178 KB test file
  covers.
- **Migration review:** a `kiko:reviewer` step on the 0057 migration before BATCH
  READY.

## 8. Strings (en / uk; every uk text is marked for review)

| Key | en | uk (review) | Role |
|---|---|---|---|
| `forms.transaction.tabManual` | Manual | Вручну | segment |
| `forms.transaction.tabTemplate` | Template | Шаблон | segment |
| `forms.transaction.entryModeLabel` | Entry mode | Спосіб введення | a11y label |
| `forms.transaction.template` | Template | Шаблон | field label |
| `forms.transaction.templateSheetTitle` | Template | Шаблон | sheet title (`TITLE_KEYS`) |
| `forms.transaction.selectTemplate` | Select a template | Оберіть шаблон | placeholder |
| `forms.transaction.noTemplatesHint` | No templates yet. Turn on "Save as a new template" when you save a transaction. | Шаблонів ще немає. Увімкніть «Зберегти як новий шаблон», коли зберігаєте транзакцію. | hint |
| `forms.transaction.saveAsTemplate` | Save as a new template | Зберегти як новий шаблон | switch label (user text) |
| `forms.transaction.templateName` | Template name | Назва шаблону | field label |
| `forms.transaction.templateNamePlaceholder` | Rent | Оренда | placeholder |
| `forms.transaction.templateNameError` | Enter a template name. | Введіть назву шаблону. | error |
| `forms.transaction.templateNameTakenError` | A template with this name already exists. | Шаблон із такою назвою вже існує. | error |
| `forms.transaction.selectHoldingError` | No holding selected. | Актив не вибрано. | error ("No X selected." form) |
| `forms.transaction.createTransaction` | Create transaction | Створити транзакцію | button |
| `forms.transaction.addTemplateTitle` | Add Template | Додати шаблон | nav title (`TITLE_KEYS`) |
| `forms.transaction.editTemplateTitle` | Edit Template | Редагувати шаблон | nav title (`TITLE_KEYS`) |
| `settings.transactionTemplates` | Transaction templates | Шаблони транзакцій | Settings row |
| `transactionTemplates.title` | Transaction Templates | Шаблони транзакцій | nav title (`TITLE_KEYS`) |
| `transactionTemplates.addTemplate` | Add template | Додати шаблон | button |
| `transactionTemplates.empty.title` | No templates yet | Шаблонів ще немає | empty title |
| `transactionTemplates.empty.message` | Save a transaction you enter often as a template, then add it again in a few taps. | Збережіть транзакцію, яку вводите часто, як шаблон, і додавайте її знову кількома дотиками. | empty message |
| `holdings.deleteLinked.templates_one` | This also clears it in {{count}} template. | Також його буде очищено в {{count}} шаблоні. | confirm body |
| `holdings.deleteLinked.templates_few` | This also clears it in {{count}} templates. | Також його буде очищено в {{count}} шаблонах. | |
| `holdings.deleteLinked.templates_many` | This also clears it in {{count}} templates. | Також його буде очищено в {{count}} шаблонах. | |
| `holdings.deleteLinked.templates_other` | This also clears it in {{count}} templates. | Також його буде очищено в {{count}} шаблону. | (uk other = fractions) |
| `categories.deleteTemplates_one` | This also clears it in {{count}} template. | Також її буде очищено в {{count}} шаблоні. | confirm body |
| `categories.deleteTemplates_few` | This also clears it in {{count}} templates. | Також її буде очищено в {{count}} шаблонах. | |
| `categories.deleteTemplates_many` | This also clears it in {{count}} templates. | Також її буде очищено в {{count}} шаблонах. | |
| `categories.deleteTemplates_other` | This also clears it in {{count}} templates. | Також її буде очищено в {{count}} шаблону. | |

Checked against the 2026-10-11 rulings: no key served a removed item (loan link,
comment), so no key is removed. Every key has en and uk text, and every uk text
stays marked for review.

The uk text uses the ’ apostrophe and «» quotes (kiko-translator "Ukrainian
catalogue rules"). For an account delete, the `holdings.deleteLinked.templates`
text says "it". The account notice is built from the same plan, so if the
reviewer wants "them" for an account, the account delete needs an
account-specific twin key.

## Boundary with category-rules

- **This track owns:** the split (task 1, which lands in `next` first, as its own
  change set, so category-rules can build on it), the tabs,
  the template select, the toggle and the name field, both template modes, the
  `route-entry/`, `hydration/` and `row-labels/` changes, the `templateName` and
  `holding` validation keys, the Settings group card (it moves the Categories row
  into it), the Settings stack routes, `src/transaction-templates/`, the templates
  list screen, template clearing in `holdings.repo.ts`, `accounts.repo.ts` and
  `categories.repo.ts`, `RemoveHoldingsPlan.templatesChanged`, and data transfer.
- **category-rules owns:** the Categories screen (including its delete
  `ConfirmSheet`), category rules, the form's category pre-select, and the "apply
  category" sheet. After the split these are the `category-rule/`,
  `use-category-pick/`, `use-category-override/` and `category-override-sheet/`
  units.
- **Shared touch points and their rule:**
  1. Screen file: this track edits only the top block (tabs and select), the
     bottom block (toggle and name), the hydrate effect inputs, and the `alongside`
     argument at the save calls. category-rules edits only its hook and sheet call
     sites.
  2. A seeded category (from Duplicate or a template) sets `userPickedCategory`.
     The pre-select from category-rules respects that flag.
  3. Category delete: this track adds `categoriesRepo.delete`'s clearing step,
     `countReferencingCategory` and the `categories.deleteTemplates` keys. The
     confirm body is rendered on the Categories screen. The track that merges
     into `next` second rebases onto the first and adds its own line to the
     confirm (decision O7). No shared edit to the confirm happens in parallel.
  4. `validation/`: each track adds only its own keys to `SaveDisabledField`.
  5. Migrations: this branch ships 0057; the first branch to reach `next` keeps the number, and
     the other renumbers at merge (see the migration folder).
  6. Catalogues: the keys are in separate subtrees (`forms.transaction.template*`,
     `transactionTemplates.*`). Only `categories.deleteTemplates_*` sits in the
     category subtree.
  7. A category that comes from a template counts as a hand pick (decision O12):
     it sets `userPickedCategory` and the manual-pick flag of category-rules, so
     a category rule does not replace it. Whichever track merges into `next`
     second wires the template seed to that flag.

## Out of scope

- Reordering templates by drag, template icons or colors, and template folders.
- A template that stores a date or time, or a recurring schedule (Reminders
  covers recurrence).
- A template from a synced or imported row (decision O4), and a template made
  from Convert.
- Template quick actions outside the form (Home shortcuts, widgets, Siri).
- A comment in a template, and a comment input on manual rows (decision O11).
- A loan link in a template, and any loan field on a create (decision O5).

## Open points

None. Every former open point is now a decision (see "Rulings on the former open
points (2026-10-11)").
