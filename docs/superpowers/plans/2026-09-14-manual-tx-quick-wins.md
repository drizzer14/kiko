# Manual Transaction Quick Wins — Design & Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task, AFTER the user has approved the open product decisions below and AFTER the round-3 track (`next-exchange-split-plan`) has landed. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four small usability bundles for the manual transaction flow — category/default quick wins, a global add-transaction entry, delete-UX consistency, and faster repeat entry.

**Architecture:** All four bundles ride the existing repository + `useLiveQuery` reactive model (see `kiko-architecture`) and the existing shared form/design-system primitives (see `kiko-design-system`). No new tables and no schema migration are required for the recommended options. The only new domain surface is read queries (a category-override lookup, a distinct-descriptions list, a recent-transactions list) and one new shared confirm component.

**Tech Stack:** React Native, `react-native-unistyles` v3, Drizzle + op-sqlite (`db.transaction()` for every write), `ts-pattern`, `react-native-gesture-handler`, i18n via `react-i18next` (catalogs `src/i18n/locales/en.ts` + `uk.ts`).

**Spec:** This document is the spec. It is grounded in the current code on branch `next-manual-tx-plan` (based on `next` @ 6b3bca7). Every `file:line` anchor was re-read on 2026-09-14; re-anchor before editing, since the round-3 track will shift line numbers in the three shared files.

## Global Constraints

- **This is PLAN ONLY until approved.** Do not implement any bundle until the user approves the "Open decisions summary" at the end.
- **Sequencing:** implementation runs AFTER `next-exchange-split-plan` (round-3) lands its transaction-form work (split-change + exchange-prefill). Round-3 edits the SAME three files several bundles touch: `src/screens/forms/transaction-form.screen.tsx`, `src/transactions/repo/transactions.repo.ts`, `src/screens/home/home.screen.tsx`. Every REBASE NOTE below flags a shared surface to re-anchor after round-3.
- **Every write goes through `db.transaction()`** via `write(...)` in a repo module (`kiko-architecture`). No write outside a repo.
- **Read functions return a Drizzle query builder**, never executed data — the caller passes it into `useLiveQuery` (`kiko-architecture`).
- **`Money` at the boundary:** amounts convert to/from `Money` only at the repository/form boundary; columns stay integer minor units (`kiko-domain`).
- **Categories are a lowercase `categories.key` slug**, folded through `resolveCategoryKey`/`resolveCategoryDisplay`; matching a name uses `normalizeTransactionName` in JS, never SQL (`kiko-domain`, `kiko-architecture`).
- **Code style:** functional-first; `ts-pattern` for closed unions; blank line before every `return`/`if`/`for`/`while`/`switch`; import groups (external / `../` / `./`) each length-sorted ascending; `import type` for type-only imports; components default-export with `.component.tsx`, one component per folder with a barrel; no runtime constant exported from a `*.screen.tsx` (`kiko-code-style`).
- **Copy:** every user-facing string is an i18n key in BOTH `en.ts` and `uk.ts`; UI headings/section titles are title case, Button labels sentence case (`kiko-design-system`, `kiko-translator`).
- **Harness:** run `npm run check:all` (or `make gate`) at each checkpoint; run `npm run check:deep` (or `make deep`) once before declaring the feature done. Full `npm run check:jest` (`make jest`) before green — scoped runs miss cross-file regressions.

---

## Shared-file conflict map (round-3 overlap)

| Bundle | Touches shared file | Why it overlaps round-3 |
|---|---|---|
| A1 category prefill | `transaction-form.screen.tsx` (description handler + hydrate); NEW read query added to `category-overrides.repo.ts` (NOT `transactions.repo.ts`) | round-3 rewrites form state/prefill |
| A2 default mode | `transaction-form.screen.tsx:767` | round-3 may touch mode state |
| B global entry | `transaction-form.screen.tsx` (holding picker + new param), `navigation/types.d.ts`, `home.screen.tsx` (FAB) | round-3 edits form + home |
| C1 Home long-press delete | `home.screen.tsx` (thread delete), `transaction-row.component.tsx`, `transactions.repo.ts` (add `source` to projection) | round-3 edits home + repo |
| C2 themed confirm | `grid-interaction.ts`, `card-context-menu.component.tsx`, `transaction-form.screen.tsx` (replace `Alert.alert`) | round-3 edits form |
| D1 description autocomplete | `transaction-form.screen.tsx`, `transactions.repo.ts` (distinct-descriptions query) | round-3 edits form + repo |
| D2 duplicate/repeat | `transactions.repo.ts` (recent query), surface TBD by decision | round-3 edits repo |

Recommended landing order to minimise churn: **A2 → A1 → C2 → C1 → D1 → D2 → B** (B is largest and depends on the picker plumbing A/D touch; C2 lands before C1 because C1's Home menu should already route through the themed confirm).

---

## BUNDLE A — category & default quick wins

### A1 — Pre-select category from existing name rules on CREATE

**Current state.**
- `recordManualTx` (`src/transactions/repo/transactions.repo.ts:74`) inserts a manual row with `category: category ?? null` (line 91). It does NOT consult the `categoryOverrides` rules table.
- The name-rule table IS consulted by the sync path only: `addManyDedup` (`transactions.repo.ts:500`) normalizes each incoming description and looks the rule up by exact equality on the normalized key (`transactions.repo.ts:509-524`), applying `override ? { ...input, category: override } : input`.
- The rule table: `categoryOverrides` (`src/db/schema.ts:338-346`) — PK `normalizedName`, plus `category`, `displayName`. There is currently **no read query** exposed on `categoryOverridesRepo` (`src/categories/category-overrides-repo/category-overrides.repo.ts` exposes only `upsertCategoryOverride`).
- On the form, category is a manual `useState<string | null>` (`transaction-form.screen.tsx:781`), seeded to `null` on create, and required on create (`isSaveDisabled`, `transaction-form.screen.tsx:206`). The description field's `onChangeText` is a bare `setDescription` (`transaction-form.screen.tsx:1165`). `normalizeTransactionName` is already imported into the form (`transaction-form.screen.tsx:45`).

**Design.**
1. Add a read query to `categoryOverridesRepo` (NOT to `transactions.repo.ts`, to keep the round-3 conflict off the busiest file):
   ```ts
   // category-overrides.repo.ts — returns a query builder (reactive)
   allQuery: () => database.select().from(categoryOverrides),
   ```
   Rationale: the rule table is tiny (one row per named merchant the user categorised), so loading all of it and matching in JS mirrors `addManyDedup`'s own in-JS normalize-then-match, and avoids a SQL `lower()` that cannot fold Cyrillic (`kiko-architecture`). A per-name query builder cannot be memoized across keystrokes anyway.
2. In the form, subscribe once:
   ```ts
   const { data: overrideRules } = useLiveQuery(categoryOverridesRepo.allQuery(), ['category_overrides']);
   const categoryByNormalizedName = useMemo(
     () => new Map(overrideRules.map((rule) => [rule.normalizedName, rule.category])),
     [overrideRules],
   );
   ```
   (Confirm the reactive table name is `category_overrides` against `db/schema.ts`.)
3. Add a pure module-level helper (keeps the branch out of the component's cognitive-complexity budget, per the file's established pattern):
   ```ts
   // Returns the rule-matched category for a typed description, or null when no
   // rule matches or the normalized name is blank.
   const ruleCategoryFor = (
     description: string,
     categoryByNormalizedName: ReadonlyMap<string, string>,
   ): string | null => { /* normalizeTransactionName → map.get → ?? null */ };
   ```
4. **WHERE the lookup fires — recommended: on description CHANGE, gated by "no explicit pick yet".** Wrap the description handler:
   ```ts
   onChangeDescription: (text) => {
     setDescription(text);
     if (!userPickedCategory && !isEditing) {
       const ruleCategory = ruleCategoryFor(text, categoryByNormalizedName);
       setSelectedCategory(ruleCategory); // null clears the auto-pick when the name no longer matches
     }
   }
   ```
   Introduce a `userPickedCategory` boolean state (set `true` inside `onSelectCategory`), so the auto-pick NEVER overwrites an explicit user choice — the interaction rule the task calls out. On-change (not blur) is recommended because `TextField` wraps RN `TextInput` and blur/`onEndEditing` plumbing is not currently exposed through the design-system prop set (`text-field.props.d.ts`), whereas `onChangeText` already is; on-change also gives live feedback as the user types a known merchant.
5. **Interaction with the required-category rule:** the auto-pick satisfies `isSaveDisabled`'s create-time category requirement (`transaction-form.screen.tsx:206`) for free — the user can still override via the picker (which flips `userPickedCategory`). Clearing the description back to a non-matching string re-nulls the auto-pick (never a stale category), which correctly re-disables Save until the user picks or re-types a known name.
6. The row still carries its own category through `recordManual` (unchanged) — this bundle only pre-fills the picker; it does NOT change `recordManualTx`. The propagation sheet (`resolveCategoryOverrideRequest`) is unaffected: an auto-pick that equals no change won't trip `categoryChanged` because `originalCategoryKey` is null on create and `categoryChanged` only compares on the picked value; confirm the create path still does not raise the propagation sheet (it currently only raises when `categoryChanged && name non-blank`, and create carries its category via `recordManual` — see `save`, `transaction-form.screen.tsx:1045-1091`).

**REBASE NOTES.**
- **`transaction-form.screen.tsx`** — round-3 rewrites the form's state/prefill. Re-anchor: the new `useLiveQuery(categoryOverridesRepo.allQuery())` subscription (near the other `useLiveQuery` calls ~lines 686-712), the `userPickedCategory` state (near line 781), the wrapped `onChangeDescription` (currently line 1165), and `onSelectCategory` (currently `setSelectedCategory`, line 1187). If round-3 adds its own description-driven prefill, MERGE the two handlers rather than stacking two `setSelectedCategory` calls.
- **`category-overrides.repo.ts`** — NOT a round-3 file; the `allQuery` addition should apply cleanly. Its test file is separate.

**Open PRODUCT decisions.**
- **A1-Q1 (RECOMMENDED: on-change, auto-clear):** Fire the rule lookup on every description CHANGE and auto-clear the pick when the name stops matching — vs. fire once on blur / vs. fill-once-and-never-clear. Recommended keeps the picker honest as the user edits and needs no new TextField plumbing.
- **A1-Q2 (RECOMMENDED: yes):** Should the auto-pick be silent (no visual "auto-selected" hint)? Recommended silent — it just seats the picker's selection like any pick; a hint chip is extra surface for a quick win.

**Test surface (qa writes later).**
- `category-overrides.repo.test.ts` — `allQuery` returns a builder whose SQL targets `category_overrides` (mirrors the `holdings.repo.test.ts` `toSQL()` assertions).
- `transaction-form.screen.test.tsx` — typing a description that matches an existing rule pre-selects that category on a create; an explicit picker choice is NOT overwritten by a later matching keystroke; clearing to a non-matching name re-nulls the pick and re-disables Save. (RNTL, existing suite pattern.)

---

### A2 — Default create mode to EXPENSE

**Current state.** `const [mode, setMode] = useState<FormMode>('income');` (`transaction-form.screen.tsx:767`). The hydrate effect (`transaction-form.screen.tsx:794-809`) overrides `mode` from the loaded row's sign on EDIT, so this default only affects a fresh CREATE.

**Design.** Change the initial state to `'expense'`:
```ts
const [mode, setMode] = useState<FormMode>('expense');
```
No other change. Edit hydration (`setMode(fields.sign)`, line 801) still wins for existing rows. `signedMinorUnits` (line 128) already maps `'expense'` to a negative amount, and `resolveDescriptionPlaceholder` (line 145) already keys the preview off `mode === 'expense'`, so the placeholder and sign stay consistent from first render.

**REBASE NOTES.**
- **`transaction-form.screen.tsx:767`** — round-3 may relocate or restructure the mode state (e.g. a split-change variant). Re-anchor the single-word `'income'` → `'expense'` change to whatever initializes create-mode sign after round-3. If round-3 introduces a derived initial mode, set its create-default to expense there instead.

**Open PRODUCT decisions.**
- **A2-Q1 (RECOMMENDED: expense):** Default a fresh manual transaction to expense (matches the task and the reality that most hand-entered rows are spending) — vs. keep income. Straightforward; recommended expense.

**Test surface.**
- `transaction-form.screen.test.tsx` — a fresh create (holdingId param, no transactionId) opens with the expense chip selected and the amount treated as negative on save; an edit still opens on the stored row's sign.

---

## BUNDLE B — global add-transaction entry

**Current state.**
- The ONLY create path today: Home/Accounts → an Account → a Holding → the holding-detail footer button (`holding-detail.screen.tsx:605-608`), which navigates `TransactionForm` with `{ holdingId }`.
- `TransactionFormParams = { holdingId: string } | { transactionId: string }` (`navigation/types.d.ts:18`) — the two entry points are mutually exclusive; there is **no** "create with no holding fixed" shape.
- The form fixes the primary holding by navigation: `holdingId` comes from `route.params` (`transaction-form.screen.tsx:721-722`); there is no primary-leg holding picker (only the Exchange DESTINATION picker and the convert COUNTERPART picker use `HoldingSelectField` via `buildExchangeOptions`).
- `buildExchangeOptions` (`transaction-form.screen.tsx:281-304`) already projects open holdings to `HoldingSelectOption`s (id, name, icon, color, currency, accountName), ordered to match the Accounts screen. `HoldingSelectField` (`src/screens/forms/holding-select-field/`) is the reusable picker.
- `TransactionForm` is registered in the Home stack (`home.stack.tsx`) and Accounts stack. Home stack sets Home's own header hidden (`headerShown: false`), so there is no Home header slot for a "+" button without enabling the header. The tab bar is the native `@bottom-tabs/react-navigation` bar (`root.navigator.tsx`) — no center-button slot.

**Design.**
1. **New param shape — a create-with-picker entry.** Widen `TransactionFormParams`:
   ```ts
   export type TransactionFormParams =
     | { holdingId: string }        // create, holding fixed by navigation
     | { transactionId: string }    // open existing
     | Record<string, never>;       // create, pick the primary holding in-form
   ```
   Register the empty-param entry in the Home stack (and, if the FAB lives elsewhere, that stack too). The form's `editingId`/`holdingId` derivation already tolerates absence: `holdingId` falls back to `undefined` when neither `holdingId` nor `transactionId` is in params (`transaction-form.screen.tsx:721-722`).
2. **Primary-leg holding picker in the form.** When there is no fixed `holdingId` and this is a create (`!isEditing`), render a `HoldingSelectField` ABOVE the amount field for the income/expense path, backed by a new `primaryHoldingId` state seeded per the default-holding rule below. Feed it options from a new `buildExchangeOptions(...)` call with an "all creatable manual holdings" type filter (open, non-synced, non-bond; a manual add already only makes sense on a plain holding — mirror `footerActionFor`'s `'transaction'` gate in `holding-detail.screen.tsx:168-185`). The rest of the form already derives `holding`/`currency`/`amountSuffix` from `holdingId` (`transaction-form.screen.tsx:721-730`); point that derivation at `primaryHoldingId` when the picker is active, so amount suffix, currency scale, category, and Exchange-eligibility all follow the picked holding with no further wiring.
   - Exchange mode from a picker-selected cash holding: `resolveModeOptions` (line 236) keys off `holding.type`, so once a cash holding is picked, Exchange becomes available exactly as today. No change needed.
3. **Default holding choice — recommended: most-recently-used, else first Accounts-ordered eligible holding.** Add a read query returning the holding id of the newest manual transaction (a `{ holdingId }` single-row builder ordered by `time desc, source = 'manual'`), or fall back to the first option from the picker's ordered list. Seed `primaryHoldingId` from it once loaded (guarded by a `hydrated`-style latch so a live refresh does not clobber an in-progress pick, mirroring the form's existing hydrate latch at line 782).
4. **Placement of the global entry — recommended: a floating action button (FAB) on Home.** Add a `Pressable` FAB pinned bottom-right over the Home `SectionList` (inside `home.screen.tsx`, above the tab-bar clearance), navigating `TransactionForm` with `{}`. It is the most idiomatic quick-add for a native-tab app with no center-button slot and a header-less Home. Extract it as its own component folder (`src/screens/home/add-transaction-fab/`) with a barrel, per the one-component-per-folder rule.

**REBASE NOTES.**
- **`navigation/types.d.ts:18`** — widening `TransactionFormParams` is low-conflict but round-3 may also touch the form's param handling; keep the union member names stable (`Record<string, never>`), and update BOTH the `HomeStackParamList` and `AccountsStackParamList` occurrences (lines 22, 43) if round-3 re-shapes them.
- **`transaction-form.screen.tsx`** — HIGH overlap. Round-3's split-change/exchange-prefill rewrites the field group and holding derivation (`holdingId`, `holding`, `currency`, lines 721-730) and `renderFieldGroup` (lines 434-516). The primary-leg picker must be inserted into round-3's FINAL field-group shape, and `primaryHoldingId` must feed round-3's holding derivation, not a pre-round-3 copy. Re-anchor after round-3; do NOT assume `renderFieldGroup`'s current prop list.
- **`home.screen.tsx`** — round-3 edits Home. The FAB is an additive sibling of the `SectionList` inside `home-content` (line 401-471); re-anchor its placement into round-3's final Home JSX, keeping it OUTSIDE the scroll content and clearing `listBottomClearance`.

**Open PRODUCT decisions.**
- **B-Q1 (RECOMMENDED: FAB on Home):** Where does the global entry live — a floating "+" FAB over the Home list (recommended), a Home header "+" (requires enabling Home's hidden header), or a Home net-worth-card action row? Recommended FAB: no header re-plumbing, always reachable, standard iOS quick-add.
- **B-Q2 (RECOMMENDED: most-recent-manual, else first eligible):** How is the default primary holding chosen — the holding of the user's most recent manual transaction (recommended), the first holding in Accounts order, or no default (force a pick)? Recommended most-recent matches "repeat entry" ergonomics.
- **B-Q3 (RECOMMENDED: eligible manual holdings only):** Should the primary picker list ALL open non-synced non-bond holdings (recommended — a manual row only makes sense there, matching `footerActionFor`), or every holding including synced (which would then no-op)? Recommended: eligible only.
- **B-Q4 (RECOMMENDED: reuse `HoldingSelectField`):** Confirm reuse of the existing `HoldingSelectField` picker rather than a new primary-holding component. Recommended reuse — it already carries account-name captions and the accent-selected row.

**Test surface.**
- `navigation` type-level: covered by `check:typecheck` (the widened union must still make the three shapes mutually exclusive at call sites).
- `transaction-form.screen.test.tsx` — opening with empty params renders the primary-leg picker, seeds the default holding, and a create writes against the picked holding; picking a cash holding surfaces the Exchange chip.
- `add-transaction-fab.component.test.tsx` — the FAB renders and navigates `TransactionForm` with empty params (RNTL, mock navigation).
- Maestro (qa, later): a global add flow — FAB → pick holding → enter amount → save → row appears on Home. Note the Maestro BottomSheet dismiss caveat (point-tap `50%,15%`, per memory) for the picker sheet.

---

## BUNDLE C — delete UX consistency

### C1 — Long-press delete on the Home transaction list

**Current state.**
- Home rows render through `TransactionRow` (`src/screens/home/transaction-row/transaction-row.component.tsx`), wrapped only in a `Pressable` for tap-to-open (lines 66-116). There is NO `CardContextMenu`, so no long-press delete on Home.
- The holding-detail ledger DOES wrap each stored row in `CardContextMenu` (`holding-detail.screen.tsx:307-312`): `deletable={!isSyncedTransaction(row.transaction)}`, `onDelete={() => transactionsRepo.remove(row.transaction.id)}`.
- `CardContextMenu` (`src/design-system/components/card-context-menu/card-context-menu.component.tsx`) composes a `LongPress` gesture; a non-deletable entity renders bare (no gesture).
- Home's row projection `listAllWithContextQuery` (`transactions.repo.ts:245-268`) does NOT select `source`, so the row cannot currently tell synced from manual. `isSyncedTransaction` needs only `Pick<TransactionRow, 'source'>` (`src/holdings/deletable/deletable.ts:11`).

**Design.**
1. Add `source: transactions.source` to the `listAllWithContextQuery` projection (`transactions.repo.ts:245-268`). `HomeTransactionRow` is DERIVED from that query's return type (`transaction-row.props.d.ts:8-10`), so the row shape picks up `source` automatically — no manual type edit.
2. Wrap `TransactionRow`'s content in `CardContextMenu`, mirroring holding-detail:
   ```tsx
   <CardContextMenu
     name={description}
     deletable={!isSyncedTransaction(item)}
     onDelete={() => transactionsRepo.remove(item.id)}
   >
     <Pressable ...>{/* existing GlassSurface row */}</Pressable>
   </CardContextMenu>
   ```
   `transactionsRepo.remove` (`transactions.repo.ts:455`) already guards synced rows (throws) and reverses the balance inside one transaction — no repo change needed for delete. `deletable` still gates the gesture so a synced row shows no menu at all (matching holding-detail).
3. Home's `SectionList` uses `stickySectionHeadersEnabled={false}` and a plain vertical list (no drag-to-reorder), so there is no sortables-drag coexistence concern here — the `HOLD_MAX_DISTANCE` cancel path (which exists to hand a moving finger to the reorder drag) is simply never contended on Home. A scroll gesture still moves the finger and cancels the hold, as designed.

**REBASE NOTES.**
- **`transactions.repo.ts:245-268`** — round-3 edits this repo. Adding `source` to the projection is additive; re-anchor into round-3's final `listAllWithContextQuery` column list and confirm round-3 did not already add `source` (if it did, reuse it).
- **`transaction-row.component.tsx`** — not a round-3 file directly, but its props come from the shared query; land the projection change first.
- **`home.screen.tsx`** — no change strictly required (the wrap lives in `TransactionRow`), UNLESS C2's themed confirm needs Home to host the shared confirm sheet (see C2 decision). If the themed confirm is state-in-`CardContextMenu` (recommended), Home needs no edit here.

**Test surface.**
- `transactions.repo.test.ts` — `listAllWithContextQuery` SQL now selects `source`.
- `transaction-row.component.test.tsx` — a manual row exposes the hold-to-delete gesture (`getByGestureTestId(HOLD_GESTURE_TEST_ID)`) and routes to `transactionsRepo.remove`; a synced row renders bare (no gesture), mirroring the holding-detail tests.

---

### C2 — One themed BottomSheet confirm replacing the two native dialogs

**Current state — two native, unthemed delete dialogs.**
- `ActionSheetIOS` in `openDeleteMenu` (`src/design-system/grid-interaction/grid-interaction.ts:54-68`) — fired imperatively via `runOnJS` from `CardContextMenu`'s `LongPress.onStart` (`card-context-menu.component.tsx:59-64`). Used by every `CardContextMenu` consumer: holding cards, account cards, the accounts grid, and holding-detail rows.
- `Alert.alert` in `confirmDelete` (`transaction-form.screen.tsx:1102-1116`) — the transaction form's own delete button.

**The app's own confirm pattern to reuse — cite:** the category-override confirmation is already a themed `BottomSheet` with an accent-primary action, a secondary action, and a red-label ghost Cancel (`transaction-form.screen.tsx:1204-1236`). That is the pattern to generalise. `BottomSheet` (`src/design-system/components/bottom-sheet/`) is the shared primitive; `Button` variants (`destructive`, `ghost`) supply the actions.

**Design — a shared `ConfirmSheet` component + state-driven confirm.**
1. **New shared component** `src/design-system/components/confirm-sheet/` (folder + `.component.tsx` + `.props.d.ts` + `.styles.ts` + `.component.test.tsx` + `index.ts`, per the folder rule). Props (signatures only):
   ```ts
   type ConfirmSheetProps = {
     visible: boolean;
     title: string;
     message?: string;
     confirmLabel: string;
     onConfirm: () => void;   // wrap in useSubmitOnce at the call site or inside
     onCancel: () => void;    // scrim/back dismiss behaves like cancel
     destructive?: boolean;   // true → confirm uses Button variant="destructive"
     confirmTestID?: string;
   };
   ```
   It renders a `BottomSheet` (`visible`, `onDismiss={onCancel}`) with the title in the header, an optional body message, a `destructive` primary Button, and a red-label `ghost` Cancel — exactly the shape of the existing override sheet, minus the "just for this one" middle action.
2. **Refactor `CardContextMenu` to hold confirm state.** A `BottomSheet` must live in the render tree, whereas `openDeleteMenu` is imperative. Move the confirm into the component:
   - The `LongPress.onStart` callback becomes: play the haptic (`trigger('impactMedium')`) and `runOnJS(setConfirmVisible)(true)` — it no longer calls `ActionSheetIOS`.
   - `CardContextMenu` renders its children plus a `ConfirmSheet` whose `onConfirm` runs the passed `onDelete` then closes, and whose `title`/`confirmLabel` use the existing `common.deleteNamed` copy (`en.ts:34`) — e.g. title `Delete "<name>"`, confirm `Delete`.
   - Because Home (C1) and holding-detail and both card grids all already route delete through `CardContextMenu`, this single refactor themes ALL of their long-press deletes at once — the consistency win.
3. **`grid-interaction.ts`:** `openDeleteMenu` (the `ActionSheetIOS` body) is deleted; the haptic move into `CardContextMenu`. Keep `onGridDragEnd` (unrelated reorder logic) untouched. Update `grid-interaction.test.ts` accordingly (the `ActionSheetIOS` assertions move to `card-context-menu.component.test.tsx`).
4. **`transaction-form.screen.tsx`:** replace `Alert.alert` in `confirmDelete` (lines 1102-1116) with a `ConfirmSheet` driven by a `deletePending` boolean state, rendered as a sibling of the existing override `BottomSheet` (lines 1204-1236). `onConfirm` runs `transactionsRepo.remove(editingId)` then `navigation.goBack()`; reuse `useSubmitOnce` for the double-submit guard consistent with the rest of the form. Drop the `Alert` import (line 1).

**REBASE NOTES.**
- **`transaction-form.screen.tsx`** — round-3 edits the form. The `Alert.alert` → `ConfirmSheet` swap in `confirmDelete` (currently 1098-1117) and the new sibling sheet near the override sheet (1204-1236) must re-anchor into round-3's final JSX. If round-3 also touches `confirmDelete`, merge into one delete handler.
- **`grid-interaction.ts` / `card-context-menu.component.tsx`** — NOT round-3 files; should apply cleanly. But note the blast radius: this refactor changes the delete UX for account cards, holding cards, the accounts grid, and holding-detail rows simultaneously (all `CardContextMenu` consumers). That is the intended consistency, but every one of those screens' tests that asserts `ActionSheetIOS` (`account-detail.screen.test.tsx`, `holding-detail.screen.test.tsx`, `accounts.screen.test.tsx`) must be updated to assert the themed sheet instead.

**Open PRODUCT decisions.**
- **C2-Q1 (RECOMMENDED: yes, theme all long-press deletes):** Refactoring `CardContextMenu` themes the delete confirm for ALL its consumers (account/holding cards + grids + holding-detail + Home), not only Home. Recommended: yes — that IS the "delete UX consistency" the bundle asks for, and leaving account/holding cards on `ActionSheetIOS` would re-introduce the exact inconsistency being removed. If the user wants to scope narrower, say so.
- **C2-Q2 (RECOMMENDED: `Delete "<name>"` title, no body):** Confirm copy — reuse `common.deleteNamed` as the sheet title with a bare `Delete` confirm and no body message (recommended, matches the current ActionSheet's single named destructive row) vs. a two-line title+message like the transaction form's current `deleteConfirmTitle`/`deleteConfirmMessage` (`en.ts:223-224`). Recommended the named single line for the card menus; the transaction form can pass its existing title+message through the same `ConfirmSheet`.
- **C2-Q3 (RECOMMENDED: state-in-`CardContextMenu`):** Put the `ConfirmSheet` state inside `CardContextMenu` (recommended — self-contained, no per-screen wiring) vs. an app-level imperative confirm service. Recommended in-component; simplest and matches the existing per-screen sheet pattern.

**Test surface.**
- `confirm-sheet.component.test.tsx` — renders when `visible`; confirm calls `onConfirm`; scrim/cancel calls `onCancel`; destructive uses the destructive Button variant. (Hermetic RNTL, modeled on `bottom-sheet` tests.)
- `card-context-menu.component.test.tsx` — a hold opens the themed `ConfirmSheet` (no `ActionSheetIOS`); confirming routes to `onDelete`; a non-deletable entity renders bare.
- `grid-interaction.test.ts` — `onGridDragEnd` unchanged; the removed `openDeleteMenu` assertions relocate to the component test.
- `transaction-form.screen.test.tsx` — the delete button opens the themed sheet; confirm removes and navigates back; cancel/dismiss removes nothing.
- Update `account-detail.screen.test.tsx`, `holding-detail.screen.test.tsx`, `accounts.screen.test.tsx` to the themed sheet.
- en/uk parity + button-casing tests (`en.uk.parity.test.ts`, `en.button-casing.test.ts`) still pass for any new/changed keys.

---

## BUNDLE D — faster repeat entry

### D1 — Description autocomplete from past transactions

**Current state.** The description field is a plain `TextField` with `onChangeText: setDescription` (`transaction-form.screen.tsx:490-495`, wired at 1164-1166). There is no suggestion source; `TextField` (`text-field.props.d.ts`) exposes no suggestions affordance. Distinct past descriptions are not queried anywhere.

**Design.**
1. Add a read query to `transactions.repo.ts` returning distinct non-empty manual descriptions, newest-first, for suggestion matching:
   ```ts
   // returns a query builder (reactive on 'transactions')
   distinctDescriptionsQuery: () =>
     database
       .selectDistinct({ description: transactions.description })
       .from(transactions)
       .where(/* description <> '' */)
       .orderBy(desc(transactions.time)),
   ```
   (Confirm the `<> ''` predicate shape against Drizzle; a JS `.filter(Boolean)` in the consumer is an acceptable fallback since the list is small.)
2. In the form, subscribe and derive up to N (e.g. 5) case-insensitive prefix/substring matches of the current `description` via `normalizeTransactionName` (already imported). Pairs with A1: a chosen suggestion also re-fires A1's rule lookup, so picking a known merchant name auto-seats its category.
3. **Surface — recommended: a lightweight suggestion row under the description field** (a horizontal `ChipRow`-style list of matched past descriptions, or a small vertical list), each tappable to fill `setDescription(value)` and dismiss. Extract as its own component folder (`src/screens/forms/description-suggestions/`). Keep it inline in the income/expense field group, shown only on create, only while the field is non-empty and has matches, and hidden once the typed value exactly equals a suggestion.

**REBASE NOTES.**
- **`transactions.repo.ts`** — round-3 edits this file; the `distinctDescriptionsQuery` addition is additive but re-anchor into the round-3 repo. Confirm round-3 did not add a similar query.
- **`transaction-form.screen.tsx`** — round-3 rewrites the field group; the suggestion row and the wrapped description handler must land in round-3's final income/expense group, MERGED with A1's description handler (both react to description change — combine into one handler, don't stack).

**Open PRODUCT decisions.**
- **D1-Q1 (RECOMMENDED: inline suggestion row, tap-to-fill):** A tappable suggestion row under the field (recommended) vs. a native keyboard autocomplete (not available through the current `TextField` prop set without new plumbing). Recommended the inline row — themable, testable, no native dependency.
- **D1-Q2 (RECOMMENDED: manual descriptions, newest-first, top 5):** Source = distinct MANUAL descriptions newest-first, capped at 5 matches (recommended) vs. include synced descriptions (noisier, many bank merchant strings) vs. frequency-ranked. Recommended manual + recency for a quick win; frequency ranking is a later refinement.
- **D1-Q3 (RECOMMENDED: create only):** Show suggestions on create only (recommended) vs. also on edit. Recommended create-only — edit already has a description.

**Test surface.**
- `transactions.repo.test.ts` — `distinctDescriptionsQuery` SQL is distinct + ordered by `time desc`.
- `description-suggestions.component.test.tsx` — given past descriptions and a typed prefix, renders matched suggestions; tapping one fills the field; no matches renders nothing.
- `transaction-form.screen.test.tsx` — typing surfaces suggestions; picking one fills the description and (with A1) seats the category.

---

### D2 — Duplicate / repeat-last transaction action

**Current state.** No duplicate or repeat affordance exists. `transactionsRepo` has `listAllQuery`, `listByHoldingQuery`, `listAllWithContextQuery`, `getByIdQuery` — none scoped to "recent manual for repeat". `recordManual` (`transactions.repo.ts:278`) is the create path a repeat would re-invoke.

**Design.**
1. **Data source — recommended: recency (most-recent manual transaction), not frequency.** A "repeat last" is deterministic and cheap; frequency requires ranking and a "frequent" definition the user must reason about. Add a read query returning the most recent manual transaction(s):
   ```ts
   recentManualQuery: (limit = 5) =>
     database.select().from(transactions)
       .where(eq(transactions.source, 'manual'))
       .orderBy(desc(transactions.time))
       .limit(limit),
   ```
2. **Which action — recommended: DUPLICATE from an existing row (a per-row action), not a global "repeat last" button.** Duplicate is discoverable in context and unambiguous (you duplicate the row you're looking at); a global "repeat last" is a hidden mode. Recommended: add a "Duplicate" action to the transaction row's existing long-press menu (now the themed `ConfirmSheet`/context menu from C2). Selecting Duplicate opens the create form pre-filled from that row's amount/description/category/holding, dated to now — the user confirms/edits and saves. This reuses the whole create path (no new write path) and composes with A1/D1.
   - Mechanically: extend `CardContextMenu` (or a sibling menu action) with an optional `onDuplicate`, and on the transaction rows pass a handler that navigates `TransactionForm` with a new prefill param, OR seeds the form via route params. Simplest: a new create param `{ duplicateOfTransactionId: string }` that the form reads to seed amount/description/category/holding on mount (guarded by the hydrate latch). Decide param-vs-store at implementation; param is preferred (stateless, deep-link-safe).
3. **Surface for the pre-fill:** the existing create form with the primary-leg picker from Bundle B seeded to the source row's holding.

**REBASE NOTES.**
- **`transactions.repo.ts`** — round-3 file; `recentManualQuery` is additive, re-anchor.
- **`transaction-form.screen.tsx`** — a `duplicateOf` prefill path must merge with round-3's prefill/hydrate rewrite; do NOT add a second independent hydrate effect — extend round-3's final one.
- **`navigation/types.d.ts`** — the duplicate param joins the `TransactionFormParams` union alongside Bundle B's empty-create shape; keep the union members mutually exclusive.
- Depends on **Bundle B** (the primary-leg picker) and **Bundle C2** (the themed menu that hosts the Duplicate action). Sequence D2 last.

**Open PRODUCT decisions.**
- **D2-Q1 (RECOMMENDED: duplicate-from-row):** Duplicate a specific row via its context menu (recommended) vs. a global "repeat last" button vs. both. Recommended duplicate-from-row: discoverable, unambiguous, reuses the create form.
- **D2-Q2 (RECOMMENDED: recency):** Underlying data = most-recent manual (recency, recommended) vs. most-frequent (needs a frequency definition + ranking). Recommended recency for a quick win.
- **D2-Q3 (RECOMMENDED: prefill via route param):** Seed the duplicate through a `{ duplicateOfTransactionId }` route param (recommended, stateless) vs. a shared store. Recommended param.
- **D2-Q4 (RECOMMENDED: date = now):** A duplicate dates to now (recommended) vs. copies the original's date. Recommended now — a repeat is a new event today.

**Test surface.**
- `transactions.repo.test.ts` — `recentManualQuery` filters `source = 'manual'`, orders `time desc`, honors `limit`.
- `transaction-form.screen.test.tsx` — opening with `{ duplicateOfTransactionId }` seeds amount/description/category/holding from the source row, dated to now, and saves a NEW row (no edit of the source).
- `card-context-menu.component.test.tsx` (or the transaction row test) — the Duplicate action navigates with the duplicate param.
- Maestro (later): long-press a Home row → Duplicate → save → a second row appears.

---

## Self-review

- **Spec coverage:** A1 (category prefill via new `categoryOverridesRepo.allQuery` + form handler), A2 (default mode expense), B (new create param + primary picker + FAB + default holding), C1 (`source` in projection + `CardContextMenu` on Home), C2 (`ConfirmSheet` + `CardContextMenu` refactor + form `Alert` swap), D1 (`distinctDescriptionsQuery` + suggestion row), D2 (`recentManualQuery` + duplicate-from-row prefill). All four bundles' sub-items have a task home.
- **No shipped-feature re-proposals:** keyboard Done, amount grouping, locale-tolerant parse, description placeholder preview, category→all-same-name propagation, convert-to-exchange, and double-submit guards are all pre-existing and are only REFERENCED (e.g. `useSubmitOnce`, `groupAmount`, `resolveCategoryOverrideRequest`, `resolveDescriptionPlaceholder`), never re-designed.
- **Type consistency:** `HoldingSelectOption`/`HoldingSelectFieldProps` reused verbatim; `HomeTransactionRow` stays query-derived (so adding `source` needs no manual type edit); `TransactionFormParams` union members named consistently across `navigation/types.d.ts` and the form.
- **Anchors re-read on 2026-09-14.** Round-3 will shift the three shared files; every REBASE NOTE names the file and the likely merge.

## Open decisions summary (for user approval)

| ID | Decision | Recommended |
|---|---|---|
| A1-Q1 | When the category rule lookup fires | On description change, auto-clear when name stops matching |
| A1-Q2 | Show an "auto-selected" hint? | No — silently seat the pick |
| A2-Q1 | Default create mode | Expense |
| B-Q1 | Global entry placement | Floating "+" FAB on Home |
| B-Q2 | Default primary holding | Most recent manual tx's holding, else first eligible |
| B-Q3 | Primary picker option set | Eligible manual holdings only (open, non-synced, non-bond) |
| B-Q4 | Reuse `HoldingSelectField`? | Yes |
| C2-Q1 | Theme ALL `CardContextMenu` deletes (cards + grids + holding-detail + Home)? | Yes — that is the consistency win |
| C2-Q2 | Card-menu confirm copy | `Delete "<name>"` title, bare `Delete`, no body |
| C2-Q3 | Where the confirm state lives | Inside `CardContextMenu` |
| D1-Q1 | Autocomplete surface | Inline tappable suggestion row |
| D1-Q2 | Suggestion source/ranking | Distinct manual descriptions, newest-first, top 5 |
| D1-Q3 | Show on edit too? | Create only |
| D2-Q1 | Duplicate vs repeat-last | Duplicate-from-row (context menu) |
| D2-Q2 | Recent vs frequent | Recency |
| D2-Q3 | Prefill mechanism | `{ duplicateOfTransactionId }` route param |
| D2-Q4 | Duplicate date | Now |

## Execution handoff (after approval + after round-3 lands)

Recommended landing order: **A2 → A1 → C2 → C1 → D1 → D2 → B**. Each bundle is an independently reviewable, independently testable unit ending in a `make gate` checkpoint; run `make jest` (full) before green and `make deep` once after the last bundle lands. Dispatch per-task via superpowers:subagent-driven-development, re-anchoring every REBASE NOTE against the round-3 final form first.
