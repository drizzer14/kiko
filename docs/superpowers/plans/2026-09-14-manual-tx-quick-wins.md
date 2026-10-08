# Manual Transaction Quick Wins — Design & Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. All 18 product decisions are LOCKED (see the "Open decisions summary (ALL LOCKED)" table). Implementation runs AFTER the round-3 track (`next-exchange-split-plan`) has landed. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four small usability bundles for the manual transaction flow — category/default quick wins, a global add-transaction entry, delete-UX consistency, and faster repeat entry.

**Architecture:** All four bundles ride the existing repository + `useLiveQuery` reactive model (see `kiko-architecture`) and the existing shared form/design-system primitives (see `kiko-design-system`). No new tables and no schema migration are required for the recommended options. The only new domain surface is read queries (a category-override lookup, a distinct-descriptions list, a recent-transactions list) and one new shared confirm component.

**Tech Stack:** React Native, `react-native-unistyles` v3, Drizzle + op-sqlite (`db.transaction()` for every write), `ts-pattern`, `react-native-gesture-handler`, i18n via `react-i18next` (catalogs `src/i18n/locales/en.ts` + `uk.ts`).

**Spec:** This document is the spec. It is grounded in the current code on branch `next-manual-tx-plan` (based on `next` @ 6b3bca7). Every `file:line` anchor was re-read on 2026-09-14; re-anchor before editing, since the round-3 track will shift line numbers in the three shared files.

Superseded for per-holding-type sites by the kiko-domain "Adding a holding type" checklist (`footerActionFor` is now `holdingDetailSpecs`).

## Global Constraints

- **This document is a plan; product decisions are now LOCKED** (see the "Open decisions summary (ALL LOCKED)" table). No app source has been written yet — implementation begins only after round-3 lands.
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
| A1 category prefill | `transaction-form.screen.tsx` (description BLUR handler + hydrate); NEW `allQuery` on `category-overrides.repo.ts` (NOT `transactions.repo.ts`); NEW optional `onBlur` on shared `TextField` | round-3 rewrites form state/prefill |
| A2 default mode | `transaction-form.screen.tsx:767` | round-3 may touch mode state |
| B global entry | `transaction-form.screen.tsx` (holding picker + new param), `navigation/types.d.ts`, `home.screen.tsx` (FAB) | round-3 edits form + home |
| C1 Home long-press delete | `home.screen.tsx` (thread delete), `transaction-row.component.tsx`, `transactions.repo.ts` (add `source` to projection) | round-3 edits home + repo |
| C2 themed confirm | `grid-interaction.ts`, `card-context-menu.component.tsx`, `transaction-form.screen.tsx` (replace `Alert.alert`) | round-3 edits form |
| D1 description autocomplete | `transaction-form.screen.tsx`, `transactions.repo.ts` (distinct-descriptions query) | round-3 edits form + repo |
| D2 duplicate only | `transaction-form.screen.tsx` (duplicate prefill), `navigation/types.d.ts`, `card-context-menu.component.tsx` (`onDuplicate`) | round-3 edits form |

Landing order (LOCKED): **A2 → A1 → C2 → C1 → D1 → D2 → B** (B is largest and depends on the picker plumbing A/D touch; C2 lands before C1 because C1's Home menu must already route through the themed confirm; D2 is duplicate-only and hosts its menu action on C2's refactored `CardContextMenu`, so it follows C2/D1). Repeat-last is dropped, so there is no separate repeat-last step in this order.

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
4. **WHERE the lookup fires — LOCKED: on description BLUR, gated by "no explicit pick yet".** The lookup runs when the description field loses focus (the user finished typing the merchant name), NOT on every keystroke. It NEVER overwrites an explicit user pick.
   - `TextField` (`text-field.props.d.ts`) currently `Pick`s only `placeholder | keyboardType | returnKeyType | autoCapitalize | autoCorrect | multiline | secureTextEntry` from `TextInputProps` — it does NOT expose a blur callback. So this bundle adds an optional `onBlur?: () => void` (or `onEndEditing`) passthrough to `TextFieldProps`, spread onto the underlying `TextInput` per the "widen from the underlying component's props, place explicit props after the spread" rule (`kiko-design-system`). This is an additive design-system change; every existing `TextField` caller is unaffected (the prop is optional).
   - Wire the description field's blur:
   ```ts
   // onChangeText stays a bare setter (no lookup on keystroke):
   onChangeDescription: (text) => setDescription(text),
   // the lookup fires on blur only:
   onBlurDescription: () => {
     if (!userPickedCategory && !isEditing) {
       const ruleCategory = ruleCategoryFor(description, categoryByNormalizedName);
       setSelectedCategory(ruleCategory); // null clears the auto-pick when the name matches no rule
     }
   }
   ```
   Introduce a `userPickedCategory` boolean state (set `true` inside `onSelectCategory`), so the auto-pick NEVER overwrites an explicit user choice — the locked interaction rule. Blur (not keystroke) avoids re-running the lookup on every character and only acts once the name is settled; a settled name that matches no rule clears any prior auto-pick, so Save's create-time category requirement re-engages honestly.
5. **Interaction with the required-category rule:** the auto-pick satisfies `isSaveDisabled`'s create-time category requirement (`transaction-form.screen.tsx:206`) for free — the user can still override via the picker (which flips `userPickedCategory`). Clearing the description back to a non-matching string re-nulls the auto-pick (never a stale category), which correctly re-disables Save until the user picks or re-types a known name.
6. The row still carries its own category through `recordManual` (unchanged) — this bundle only pre-fills the picker; it does NOT change `recordManualTx`. The propagation sheet (`resolveCategoryOverrideRequest`) is unaffected: an auto-pick that equals no change won't trip `categoryChanged` because `originalCategoryKey` is null on create and `categoryChanged` only compares on the picked value; confirm the create path still does not raise the propagation sheet (it currently only raises when `categoryChanged && name non-blank`, and create carries its category via `recordManual` — see `save`, `transaction-form.screen.tsx:1045-1091`).

**REBASE NOTES.**
- **`transaction-form.screen.tsx`** — round-3 rewrites the form's state/prefill. Re-anchor: the new `useLiveQuery(categoryOverridesRepo.allQuery())` subscription (near the other `useLiveQuery` calls ~lines 686-712), the `userPickedCategory` state (near line 781), the description field's new `onBlur` wiring inside the income/expense field group (currently `renderFieldGroup`'s description `TextField`, lines 489-495 / prop wiring 1164-1166), and `onSelectCategory` (currently `setSelectedCategory`, line 1187). If round-3 adds its own description-driven prefill, MERGE the two handlers rather than stacking two `setSelectedCategory` calls.
- **`text-field.props.d.ts` / `text-field.component.tsx`** — NOT round-3 files; the optional `onBlur` passthrough should apply cleanly. Its component test is separate.
- **`category-overrides.repo.ts`** — NOT a round-3 file; the `allQuery` addition should apply cleanly. Its test file is separate.

**Open PRODUCT decisions.**
- **A1-Q1 (LOCKED: on BLUR, never overwrite an explicit pick):** The rule lookup fires when the description field loses focus, not on keystroke, and never overwrites an explicit user pick. This requires adding an optional `onBlur` passthrough to the shared `TextField` (see Design step 4).
- **A1-Q2 (LOCKED: silent auto-pick):** The auto-pick is silent — it seats the picker's selection like any pick, with no "auto-selected" hint chip.

**Test surface (qa writes later).**
- `category-overrides.repo.test.ts` — `allQuery` returns a builder whose SQL targets `category_overrides` (mirrors the `holdings.repo.test.ts` `toSQL()` assertions).
- `text-field.component.test.tsx` — the new optional `onBlur` fires on the underlying `TextInput` blur and is a no-op when omitted.
- `transaction-form.screen.test.tsx` — blurring a description that matches an existing rule pre-selects that category on a create; an explicit picker choice is NOT overwritten by a later matching blur; blurring a non-matching name re-nulls the pick and re-disables Save. (RNTL, existing suite pattern.)

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
- **A2-Q1 (LOCKED: expense):** A fresh manual transaction defaults to the expense chip (a negative amount), overriding the current `'income'` default at line 767.

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
- **B-Q1 (LOCKED: FAB on Home):** The global entry is a floating "+" FAB over the Home list, navigating `TransactionForm` with empty params. No Home-header re-plumbing; always reachable.
- **B-Q2 (LOCKED: most-recent-manual, else first eligible):** The default primary-leg holding is the holding of the user's MOST RECENT manual transaction, resolved by a Bundle-B-owned single-row read query (`{ holdingId }`, `source = 'manual'`, ordered `time desc`, `limit 1` — this query is NOT shared with the dropped repeat-last work), falling back to the first holding in the picker's Accounts-ordered eligible list when there is no manual history. Seeded once behind a hydrate latch so a live refresh cannot clobber an in-progress pick.
- **B-Q3 (LOCKED: eligible manual holdings only):** The primary picker lists only open, non-synced, non-bond holdings (the `'transaction'`-eligible set matching `footerActionFor`), never synced holdings.
- **B-Q4 (LOCKED: reuse `HoldingSelectField`):** The existing `HoldingSelectField` picker is reused for the primary leg — it already carries account-name captions and the accent-selected row.

**Test surface.**
- `navigation` type-level: covered by `check:typecheck` (the widened union must still make the shapes mutually exclusive at call sites).
- `transactions.repo.test.ts` — the Bundle-B most-recent-manual-holding query filters `source = 'manual'`, orders `time desc`, and limits to 1.
- `transaction-form.screen.test.tsx` — opening with empty params renders the primary-leg picker, seeds the default holding (most-recent-manual, else first eligible), and a create writes against the picked holding; picking a cash holding surfaces the Exchange chip.
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
- **C2-Q1 (LOCKED: yes — theme all long-press deletes, app-wide):** Refactoring `CardContextMenu` themes the delete confirm for ALL its consumers (account/holding cards + accounts/holdings grids + holding-detail + the new Home rows), not only Home. The user ACCEPTS this app-wide theming AND the resulting update to the three screens' `ActionSheetIOS`-asserting tests (`account-detail.screen.test.tsx`, `holding-detail.screen.test.tsx`, `accounts.screen.test.tsx`) — see the test surface below.
- **C2-Q2 (LOCKED: `Delete "<name>"` title, no body):** The card menus reuse `common.deleteNamed` as the sheet title with a bare `Delete` confirm and no body. The transaction form passes its existing `deleteConfirmTitle`/`deleteConfirmMessage` (`en.ts:223-224`) through the same `ConfirmSheet`.
- **C2-Q3 (LOCKED: state-in-`CardContextMenu`):** The `ConfirmSheet` state lives inside `CardContextMenu` — self-contained, no per-screen wiring, matching the existing per-screen sheet pattern.

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
- **D1-Q1 (LOCKED: inline suggestion row, tap-to-fill):** A tappable suggestion row under the description field fills the field on tap; not a native keyboard autocomplete.
- **D1-Q2 (LOCKED: distinct manual descriptions, newest-first, top 5 — recency):** The autocomplete DATA SOURCE is distinct MANUAL transaction descriptions, ordered newest-first (recency, not frequency), capped at 5 matches. Synced/bank descriptions are excluded. Frequency ranking is an explicit later refinement, out of scope here.
- **D1-Q3 (LOCKED: create only):** Suggestions show on create only; an edit already has its description.

**Test surface.**
- `transactions.repo.test.ts` — `distinctDescriptionsQuery` SQL is distinct + ordered by `time desc`.
- `description-suggestions.component.test.tsx` — given past descriptions and a typed prefix, renders matched suggestions; tapping one fills the field; no matches renders nothing.
- `transaction-form.screen.test.tsx` — typing surfaces suggestions; picking one fills the description and (with A1) seats the category.

---

### D2 — Duplicate this transaction (duplicate ONLY)

**Scope (LOCKED):** Bundle D2 is DUPLICATE-ONLY. Repeat-last is DROPPED per the user's deviation — there is no global "repeat last" button, no recency read query for a repeat mode, and no repeat-last step anywhere in this plan.

**Current state.** No duplicate affordance exists. `recordManual` (`transactions.repo.ts:278`) is the create path a duplicate re-invokes. `getByIdQuery` (`transactions.repo.ts:216`) already returns a single row by id — enough to seed a duplicate; no new "recent"/"frequent" query is needed for duplicate-only.

**Design.**
1. **Duplicate from an existing row, via the row's long-press context menu (now the themed menu from C2).** Selecting Duplicate opens the create form pre-filled from that row's amount, description, category, and holding, dated to NOW — the user confirms/edits and saves a NEW row. This reuses the whole create path (no new write path) and composes with A1 and D1.
2. **Mechanics — LOCKED: prefill via a route param.** Add a create param `{ duplicateOfTransactionId: string }` to `TransactionFormParams`. The form reads it, loads the source row through the existing `getByIdQuery`, and seeds amount/description/category/holding on mount (guarded by the same hydrate latch the edit path uses, so a live refresh cannot clobber an in-progress edit). Stateless and deep-link-safe — no shared store.
3. **Menu wiring.** Extend `CardContextMenu` (from C2) with an optional `onDuplicate` action alongside the destructive Delete, so a manual row's long-press offers both "Duplicate" and "Delete"; the transaction rows pass a handler that navigates `TransactionForm` with `{ duplicateOfTransactionId: <row id> }`. A synced row is not duplicated into a manual create here (out of scope) — offer Duplicate only for manual, deletable rows, or gate it on the same manual check.
4. **Surface for the pre-fill:** the existing create form with the primary-leg picker from Bundle B seeded to the source row's holding.

**REBASE NOTES.**
- **`transaction-form.screen.tsx`** — the `duplicateOf` prefill path must MERGE with round-3's prefill/hydrate rewrite; do NOT add a second independent hydrate effect — extend round-3's final one.
- **`navigation/types.d.ts`** — the `{ duplicateOfTransactionId }` param joins the `TransactionFormParams` union alongside Bundle B's empty-create shape; keep the union members mutually exclusive.
- **`card-context-menu.component.tsx`** — the optional `onDuplicate` action is additive on top of C2's refactor; land C2 first.
- Depends on **Bundle B** (the primary-leg picker for the seeded holding) and **Bundle C2** (the themed menu that hosts the Duplicate action). Sequence D2 last.

**Open PRODUCT decisions.**
- **D2-Q1 (LOCKED: duplicate only):** Duplicate a specific row via its context menu. Repeat-last is DROPPED (user deviation).
- **D2-Q3 (LOCKED: prefill via route param):** Seed the duplicate through a `{ duplicateOfTransactionId }` route param — stateless, no shared store.
- **D2-Q4 (LOCKED: date = now):** A duplicate dates to now — it is a new event today, not a copy of the original's timestamp.

**Test surface.**
- `transaction-form.screen.test.tsx` — opening with `{ duplicateOfTransactionId }` seeds amount/description/category/holding from the source row, dated to now, and saves a NEW row (no edit of the source).
- `card-context-menu.component.test.tsx` (or the transaction row test) — the Duplicate action navigates with the duplicate param; a synced/non-manual row does not offer Duplicate.
- Maestro (later): long-press a Home row → Duplicate → save → a second row appears.

---

## Self-review

- **Spec coverage:** A1 (category prefill via new `categoryOverridesRepo.allQuery` + form description BLUR handler + optional `TextField.onBlur`), A2 (default mode expense), B (new create param + primary picker + FAB + most-recent-manual default holding query), C1 (`source` in projection + `CardContextMenu` on Home), C2 (`ConfirmSheet` + `CardContextMenu` refactor + form `Alert` swap, app-wide), D1 (`distinctDescriptionsQuery` + suggestion row, recency top-5), D2 (duplicate-only prefill via `getByIdQuery` + `{ duplicateOfTransactionId }` route param + `CardContextMenu` `onDuplicate` action; repeat-last dropped). All four bundles' sub-items have a task home.
- **No shipped-feature re-proposals:** keyboard Done, amount grouping, locale-tolerant parse, description placeholder preview, category→all-same-name propagation, convert-to-exchange, and double-submit guards are all pre-existing and are only REFERENCED (e.g. `useSubmitOnce`, `groupAmount`, `resolveCategoryOverrideRequest`, `resolveDescriptionPlaceholder`), never re-designed.
- **Type consistency:** `HoldingSelectOption`/`HoldingSelectFieldProps` reused verbatim; `HomeTransactionRow` stays query-derived (so adding `source` needs no manual type edit); `TransactionFormParams` union members named consistently across `navigation/types.d.ts` and the form.
- **Anchors re-read on 2026-09-14.** Round-3 will shift the three shared files; every REBASE NOTE names the file and the likely merge.

## Open decisions summary (ALL LOCKED)

Every row below is LOCKED. Two rows deviate from the plan's original recommendation, marked "(deviation)": A1-Q1 (blur, not on-change) and the D2 bundle (duplicate only, repeat-last dropped).

| ID | Decision | Locked resolution | Status |
|---|---|---|---|
| A1-Q1 | When the category rule lookup fires | On description BLUR; never overwrite an explicit user pick (adds optional `onBlur` to `TextField`) — *(deviation)* | LOCKED |
| A1-Q2 | Show an "auto-selected" hint? | No — silently seat the pick | LOCKED |
| A2-Q1 | Default create mode | Expense | LOCKED |
| B-Q1 | Global entry placement | Floating "+" FAB on Home | LOCKED |
| B-Q2 | Default primary-leg holding | Most recent manual tx's holding, else first eligible | LOCKED |
| B-Q3 | Primary picker option set | Eligible manual holdings only (open, non-synced, non-bond) | LOCKED |
| B-Q4 | Reuse `HoldingSelectField` for the primary leg? | Yes | LOCKED |
| C1-Q1 | Home rows must know synced-vs-manual | Add `source` to `listAllWithContextQuery` | LOCKED |
| C2-Q1 | Theme ALL `CardContextMenu` deletes app-wide (cards + grids + holding-detail + Home)? | Yes — user accepts app-wide theming + the 3 flipped ActionSheet tests | LOCKED |
| C2-Q2 | Card-menu confirm copy | `Delete "<name>"` title, bare `Delete`, no body | LOCKED |
| C2-Q3 | Where the confirm state lives | Inside `CardContextMenu` | LOCKED |
| D1-Q1 | Autocomplete surface | Inline tappable suggestion row | LOCKED |
| D1-Q2 | Autocomplete data source | Distinct manual descriptions, newest-first, top 5 (recency, not frequency) | LOCKED |
| D1-Q3 | Show on edit too? | Create only | LOCKED |
| D2-Q1 | Duplicate vs repeat-last | Duplicate ONLY — repeat-last dropped — *(deviation)* | LOCKED |
| D2-Q2 | Duplicate data source | The specific row via `getByIdQuery`; no recency/frequency source (repeat-last dropped) | LOCKED |
| D2-Q3 | Duplicate prefill mechanism | `{ duplicateOfTransactionId }` route param | LOCKED |
| D2-Q4 | Duplicate date | Now | LOCKED |

## Execution handoff (after round-3 lands)

All decisions are LOCKED; implementation may proceed once `next-exchange-split-plan` (round-3) has landed. Landing order (LOCKED): **A2 → A1 → C2 → C1 → D1 → D2 → B** — repeat-last is dropped, so there is no repeat-last step. Each bundle is an independently reviewable, independently testable unit ending in a `make gate` checkpoint; run `make jest` (full) before green and `make deep` once after the last bundle lands. Dispatch per-task via superpowers:subagent-driven-development, re-anchoring every REBASE NOTE against the round-3 final form first.
