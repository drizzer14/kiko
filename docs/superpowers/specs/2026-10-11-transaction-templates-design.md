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
   (holdings, amounts, category, description, split parts, loan link, returns, as
   they apply). The amount is OPTIONAL: when it is empty, the form asks for it.
   The date is never stored.
6. When the user deletes a holding or a category that a template uses, the
   template stays and that field becomes empty. The form asks for the field when
   the template is used. The delete confirm says how many templates change.
7. Templates go into the `.kiko` export and restore.

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
  loan field.
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
  (`migrationCount: 56`). `REQUIRED_TABLE_KEYS` in
  `src/data-transfer/import-data.ts` lists the keys that every file must carry.
- Migrations: the journal ends at idx 55 (`0055_add_dismissed_tips`). Another
  track takes 0056.

## 1. Data model

### Table `transaction_templates` (migration 0057)

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | `id()`, as other tables use |
| `name` | text NOT NULL | trimmed; unique case-insensitively (see Open point 3), checked in JS |
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
- **Number:** 0057 needs 0056 in the journal, because the runner counts
  migrations (`journal.entries.slice(COUNT(*))`, kiko-architecture "Storage"). If
  the 0056 track has not reached this branch's base when the migration task
  starts, generate the migration as the next free idx and renumber it at merge.
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
3. **Mode-specific parts** (exchange, split returns, loan link). The Duplicate
   seed has nowhere to put them today.

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
  loanHoldingId: string | null;         // expense only; see Open point 5
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
| income / expense | holdingId, currency, amountMinorUnits, description, category, loanHoldingId (expense) |
| exchange | holdingId (source), currency, amountMinorUnits (Value out), exchange.{destinationHoldingId, destinationCurrency, valueInMinorUnits} |
| split | holdingId (payer), currency, amountMinorUnits (payment), description, category, returns[] |

A template made from an Edit form is always income or expense, because an edit
opens no other mode (screen:516). An edited exchange leg or split payment saves as
a plain income or expense template. The leg's exchange marker is not stored, the
same as Duplicate (screen:226–233).

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
  return, `buildLoanOptions` for the loan, and the categories list for
  `category`. This covers a deleted id, and also a holding that is now closed or
  synced. The form then asks for that field (section 3). The delete paths also
  clear deleted ids (section 2), so a dangling id only remains from an outside
  cause.

### Stored by id

| Reference | Draft slot | Cleared on delete by |
|---|---|---|
| holding | `holdingId`, `exchange.destinationHoldingId`, `returns[].holdingId`, `loanHoldingId` | holding delete, account delete |
| category | `category` | category delete |
| loan | `loanHoldingId` (a loan is a holding) | holding delete, account delete |

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
  category-rules. See "Boundary with category-rules" and Open point 7.
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
lands on main before both tracks continue, because category-rules depends on it.

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
| `mode-and-actions/` | `showsSaveButton`, `isLoanFieldVisible`, `resolveLoanLinkState`, `renderModeAndActions` (1391–1547) | shared (loan field; Open point 5) |
| `category-override-sheet/` | the override `BottomSheet` JSX (screen:2735–2805) | **category-rules** |
| `use-category-override/` | `pendingOverride` state, `applyOverride`, `applyOverrideOne`, `cancelOverride`, their `useSubmitOnce` instances, `pendingCategory` | **category-rules** |
| `use-category-pick/` | `selectedCategory`, `userPickedCategory`, `selectCategory`, `reseatCategoryFromName`, `onDescriptionBlur`, `pickSuggestion` | **category-rules** |

The screen keeps state, the hydrate effect, the save handlers and the layout. The
file count is about 17 units, which is under the 30-file mutation cap. Count it
with `make mutable` against the task base.

### 3.1 Tabs (Add only)

- A `SegmentedControl` with **Manual** and **Template** goes at the top of the
  form. Each tab shows different fields, so this follows the tabs-vs-chips rule
  (kiko-design-system "SegmentedControl"). Manual is the default.
- It shows on the create entries `{}` (global add) and `{ holdingId }` (Open
  point 1), and on `{ templateId }`. It does not show on Duplicate, Edit,
  Add-template or Edit-template.
- **Template tab before a pick:** only the template `SelectField` (label
  "Template", placeholder "Select a template", sheet title "Template"). There are
  no other fields and no Save button. When there are no templates, the select is
  shown with an `InfoHint` below it (`forms.transaction.noTemplatesHint`).
- **After a pick:** the whole form shows below the select, filled from the
  template, with the date at now. A new pick fills every field again from the new
  template.
- A tab switch keeps the field values (no data loss). The tab only changes whether
  the select shows and whether the form waits for a pick (Open point 2).
- With `{ templateId }`, the form opens on the Template tab with that template
  already picked.

### 3.2 Fill through the Duplicate seed (one path)

- `resolveHydration` gets one new input, `templateDraft` (the picked draft, after
  `resolveDraftReferences`). It uses the same two steps as Duplicate:
  `seedHolding` (set `primaryHoldingId` from `draft.holdingId`, not final), then
  `seedFields` once the holding resolves, with `time: null`.
- When `draft.holdingId` is null (dangling or empty), the plan skips `seedHolding`.
  It clears the seam to null (the default holding from `{}` is replaced, so the
  form asks), then runs `seedFields` at once.
- `seedFields` grows optional mode fields: `mode` (it replaces `sign`, which is
  `Sign` today), `destinationHoldingId`, `valueIn`, `returns`, and
  `loanHoldingId`. The Duplicate and Edit plans fill them with today's values
  (the sign, no destination, one empty return, no loan), so their behavior does
  not change. The effect sets each one with its existing setter.
- Amounts become text through `groupAmount(majorAmountText(draft.currency, minor))`.
  This uses the stored currency and never `holding?.currency ?? 'UAH'`, so the
  scale is exact even when the holding is gone. Value in uses
  `exchange.destinationCurrency`. A null amount leaves the field empty.
- A seeded non-null category sets `userPickedCategory`, the same as Duplicate
  (screen:1949). The category pre-select from category-rules must not overwrite
  it.
- A template pick is an event. It sets the picked draft and opens the `hydrated`
  latch again (`setHydrated(false)`). The same effect then applies the plan. There
  is no second effect and no second fill path.

### 3.3 The "Save as a new template" toggle (Add, Duplicate, Edit)

- It goes at the bottom of the form, after the comment row (screen:2722). It is a
  `Switch` with a `label` (the precedent is `term-deposit-section.component.tsx:204`),
  off by default. When it is on, a `TextField` **Template name** (required) shows
  directly below it.
- It shows on: Add (both tabs), Duplicate, and an Edit of a manual row. It is
  hidden on a read-only (synced or imported) row and while converting (Open
  point 4).
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
- The loan field: see Open point 5.
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
  It uses the template as stored (Open point 6). After that transaction is saved,
  `goBack` returns to the edit form.

### 3.6 Validation

Add new `SaveDisabledField` keys: `templateName` and `holding`.

| Field | Add / Duplicate / Edit (toggle off) | toggle on | Add-template / Edit-template |
|---|---|---|---|
| Template name | — | required, and not taken | required, and not taken (the edit's own row is excluded) |
| Holding (primary) | required (new error, needed once a template can leave it empty) | same | required (Open point 3b) |
| Amount / Value out / payment | required > 0 (today) | same | optional; when filled, > 0 |
| Value in, return amounts | required (today) | same | optional; when filled, > 0 |
| Category | required on create (today) | same | optional |
| Destination, return holding | required (today) | same | optional |

- Every error is computed from its own field and gated by `attemptedSave`
  (kiko-code-style "Form validation model"). The field order puts `templateName`
  first in the template modes and last when the toggle is on.
- The name is trimmed. "Taken" means equal to another template's name,
  compared case-insensitively. The form checks it against the live list. The repo
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
    gated on `useDataReady`, ordered by `created_at` (Open point 8).
  - Each template is a card wrapped in `CardContextMenu`: `name` is the template
    name, `deletable`, `onEdit` opens the edit form, and there is no
    `deleteMessage`. A tap on the card opens `TransactionForm` with
    `{ editTemplateId }`.
  - Card content: the template name, the category icon tile (or a neutral tile
    when there is none), a caption with the holding name and the type, and the
    amount when one is stored (Open point 9).
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
  must still import. The result counts stay unchanged (Open point 10).
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
  fills again; the toggle on Add, Duplicate and Edit writes both, and with the
  toggle off only the transaction is written; the name error and the taken error;
  Add-template (no date, no toggle, optional amount); Edit-template Save and
  Create transaction (`push`).
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

The uk text uses the ’ apostrophe and «» quotes (kiko-translator "Ukrainian
catalogue rules"). For an account delete, the `holdings.deleteLinked.templates`
text says "it". The account notice is built from the same plan, so if the
reviewer wants "them" for an account, the account delete needs an
account-specific twin key.

## Boundary with category-rules

- **This track owns:** the split (task 1, which lands first and alone), the tabs,
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
     confirm body is rendered on the Categories screen (Open point 7).
  4. `validation/`: each track adds only its own keys to `SaveDisabledField`.
  5. Migrations: this track uses 0057, category-rules uses 0058 and later. Both
     can be renumbered at merge.
  6. Catalogues: the keys are in separate subtrees (`forms.transaction.template*`,
     `transactionTemplates.*`). Only `categories.deleteTemplates_*` sits in the
     category subtree.

## Out of scope

- Reordering templates by drag, template icons or colors, and template folders.
- A template that stores a date or time, or a recurring schedule (Reminders
  covers recurrence).
- A template from a synced or imported row (Open point 4), and a template made
  from Convert.
- Template quick actions outside the form (Home shortcuts, widgets, Siri).
- A comment input on manual rows (Open point 11).

## Open points

1. **Tabs on the `{ holdingId }` entry** (holding detail Add). (a) Tabs on both
   create entries. A pick sets the template's holding through the seam and shows
   the holding picker. (b) Tabs on the global add only. Recommendation: (a).
2. **A tab switch after editing.** (a) Keep the values. (b) Reset to blank on
   Manual. Recommendation: (a).
3. **Name uniqueness and required fields in a template mode.** (3a) The name is
   unique case-insensitively, or (3b) duplicates are allowed. Required fields: name
   and holding, or name only. Recommendation: unique, with name and holding
   required.
4. **Toggle on a read-only (synced or imported) Edit.** (a) Hidden. (b) Shown, and
   the holding is cleared because synced holdings are not pickable. Recommendation:
   (a).
5. **Loan link.** (a) Store it, and show `LoanPaymentField` as draft state on
   every create debit (the same visibility rule as edit, from the typed sign).
   Save writes the link in the same write (`ManualTransaction` gets
   `loanHoldingId`). (b) Store it, and show the field only in the template modes
   and after a template pick. (c) Do not store it and let the matcher link it
   later, which contradicts ruling 5. Recommendation: (a).
6. **Create transaction with unsaved edits.** (a) Use the template as stored.
   (b) Save first, then open. (c) Fill from the current form state without saving.
   Recommendation: (a).
7. **Who renders the category-delete count.** (a) category-rules renders it in
   its redesigned confirm, using this track's count and keys. (b) This track adds
   a `message` to today's `ConfirmSheet` and category-rules keeps it.
   Recommendation: (a) if category-rules lands first, otherwise (b).
8. **List order.** (a) `created_at` ascending. (b) Name A–Z. (c) Last used first.
   Recommendation: (a).
9. **The card.** (a) Make `TransactionCard`'s `money` optional (designer owns
   this). (b) A new `TemplateCard`. Recommendation: (a).
10. **Import result counts.** (a) Unchanged. (b) Add `templatesRestored` to the
    import outcome text. Recommendation: (a).
11. **Comment.** The ruling lists "comment", but no manual path writes one, and
    the field is read-only display. (a) Leave it out of the draft. (b) Add a
    comment input to manual creates (a new feature). Recommendation: (a).
