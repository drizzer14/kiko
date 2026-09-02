# Redesign feedback review (extracted from session e2562572)

# PFF Redesign — Feedback Round 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each app-source task is delegated to a PFF role agent (developer/designer/qa); the coordinator never edits app files inline.

**Goal:** Apply the user's Round 1 feedback on the redesigned app — money color rules, a per-currency breakdown, multi-select filters, spacing, a navigation fix, per-account bank settings, a Settings list layout, a stable tab bar, and a new categories management sub-screen.

**Architecture:** A shared design-system foundation lands first (money color rule, a `CurrencyBreakdown` component, a scrollable `Screen` for large titles, a stable tab tint). Each screen then consumes that foundation. The categories feature adds a `categories` table keyed by a stable slug, so a rename or icon change never rewrites transaction rows.

**Tech Stack:** React Native 0.87, TypeScript, react-native-unistyles, @react-navigation/native-stack + react-native-bottom-tabs, drizzle-orm + @op-engineering/op-sqlite, react-native-nitro-sfsymbols.

**Spec:** This plan implements user feedback captured in the session (2026-09-01). There is no separate spec file; the feedback list and clarifications are the source of truth (see "Feedback source" below).

## Feedback source (verbatim intent)

- Home: net worth white when positive; list all held currencies with values under it (replace "Rates unavailable"); multi-select filters; more vertical room on transactions.
- Accounts: heading overlaps content (same in Settings); tab back-nav returns to account detail; multi-currency account must sum + convert to a base balance and list each currency underneath; move "Add account" to the bottom.
- Settings: move Monobank token + sync status into the bank account settings; redo the first boxed button section as a list; add a categories management sub-screen (rename + change icon).
- Global: bottom navigation must not change color on interaction.
- Color rule (global): positive balances render white; green stays only for transactions.

## Global Constraints

- **Location:** the phase-1 worktree (`/Users/drizzer14/orca/workspaces/pff-ios/pff-redesign-phase-1`). Hold all commits; do not commit, push, or merge without an explicit request. The held Phase 6 work stays uncommitted; new work mixes into the working tree.
- **Harness rule:** fix the underlying issue; never weaken a check. Run `npm run check:all` green before a task is done.
- **Style:** every `.ts`/`.tsx` change follows the `pff-code-style`, `pff-design-system`, `pff-domain`, and `pff-architecture` skills. Invoke the relevant skill before writing.
- **Design tokens only:** no hard-coded colors, spacing, or radii. Use `theme.colors.*`, `theme.spacing(n)`, `theme.radii.*`.
- **No new dependency** is needed for any task here.
- **Base currency:** the app already resolves a base currency for net worth (see `src/rates/net-worth-view.ts`); reuse it, do not introduce a second source.

## Money color rule (applies to Tasks 1, 5, 9)

Two contexts, resolved by `MoneyText`:

| Context | Positive | Zero | Negative |
|---|---|---|---|
| `balance` (net worth, account total, holding balance) | white (`textPrimary`) | white (`textPrimary`) | red (`negative`) |
| `transaction` (a transaction amount) | green (`positive`) | white (`textPrimary`) | red (`negative`) |

`textPrimary` is `#FFFFFF` and already exists; no new color token is added.

---

## File Structure

**Design system (designer + developer):**
- `src/design-system/components/money-text/money-text.props.ts` — add `context?: 'balance' | 'transaction'` (default `'balance'`).
- `src/design-system/components/money-text/money-text.component.tsx` — resolve tone from `context` + sign.
- `src/design-system/components/currency-breakdown/` (NEW) — `currency-breakdown.component.tsx`, `.props.ts`, `.styles.ts`, `index.ts`. A small list of per-currency totals.
- `src/design-system/components/screen/screen.component.tsx`, `.props.ts`, `.styles.ts` — add an opt-in scrollable mode for large-title screens.

**Currency aggregation (developer):**
- `src/rates/currency-totals.ts` (NEW) — pure function summing holdings per currency.

**Screens (developer):**
- `src/screens/home/home.screen.tsx`, `home.styles.ts` — net worth context, breakdown, multi-select filters, row spacing.
- `src/screens/home/transaction-filter-bar.component.tsx` — multi-select chips.
- `src/screens/accounts/accounts.screen.tsx`, `accounts.styles.ts` — scrollable screen, add-account at bottom, per-account total (already converted) unchanged, white positive.
- `src/screens/account-detail/account-detail.screen.tsx` — account total + breakdown; move Monobank token input here.
- `src/screens/settings/settings.screen.tsx`, `settings.styles.ts` — remove token block, list layout, categories entry row.

**Navigation (developer):**
- `src/navigation/root.navigator.tsx` — stable tab tint; pop each tab stack to top on blur.

**Categories feature (developer + designer + qa):**
- `src/db/schema.ts` — `categories` table.
- `src/db/migrations/` — new migration for the table + seed.
- `src/repositories/categories.repo.ts` (NEW) — read/update category title + icon.
- `src/screens/settings/categories.screen.tsx` (NEW) + styles — list, rename, change icon.
- `src/navigation/settings.stack.tsx` + `src/navigation/types.ts` — `Categories` route.
- `src/monobank/mcc-category.ts` / `src/screens/home/home.screen.tsx` — resolve display title + icon from the repo.

---

## Phase 0 — Design-system + global foundation

### Task 1: MoneyText balance/transaction color rule

**Files:**
- Modify: `src/design-system/components/money-text/money-text.props.ts`
- Modify: `src/design-system/components/money-text/money-text.component.tsx`
- Test: `src/design-system/components/money-text/money-text.component.test.tsx`

**Interfaces:**
- Produces: `MoneyText` gains `context?: 'balance' | 'transaction'` (default `'balance'`). Tone resolution per the "Money color rule" table.

- [ ] **Step 1: Write failing tests.** Add cases: `context="balance"` positive → `tone="textPrimary"`; balance negative → `tone="negative"`; balance zero → `tone="textPrimary"`; `context="transaction"` positive → `tone="positive"`; transaction negative → `tone="negative"`; default (no context) behaves as `balance`. Assert on the rendered `Text` `tone` prop (mirror the existing test's query approach).
- [ ] **Step 2: Run the tests; confirm they fail.** Run `npm test -- money-text`. Expected: FAIL (context not handled).
- [ ] **Step 3: Implement.** Add the prop; compute tone:

```tsx
const isNegative = money.minorUnits < 0;
const tone = isNegative
  ? 'negative'
  : context === 'transaction' && money.minorUnits > 0
    ? 'positive'
    : 'textPrimary';
```

Update the props file with `context?: 'balance' | 'transaction'` and a comment that balances are white and only transactions go green.
- [ ] **Step 4: Run the tests; confirm they pass.** Run `npm test -- money-text`. Expected: PASS.
- [ ] **Step 5: `npm run check:lint` on the touched files.** Fix any finding.

### Task 2: `currency-totals` aggregation + `CurrencyBreakdown` component

**Files:**
- Create: `src/rates/currency-totals.ts`
- Create: `src/design-system/components/currency-breakdown/currency-breakdown.component.tsx`, `.props.ts`, `.styles.ts`, `index.ts`
- Test: `src/rates/currency-totals.test.ts`, `src/design-system/components/currency-breakdown/currency-breakdown.component.test.tsx`

**Interfaces:**
- Produces: `sumByCurrency(holdings: { currency: CurrencyCode; balanceMinorUnits: number }[]): Money[]` — one `Money` per distinct currency, summing minor units, ordered by descending absolute value. Reuse the `Money` value object (`src/currency/money.ts`) and `CurrencyCode` from the domain.
- Produces: `CurrencyBreakdown` — props `{ items: Money[] }`. Renders each as a small caption row: currency + formatted amount, using `MoneyText context="balance"` for the amount so positives stay white.

- [ ] **Step 1: Write failing test for `sumByCurrency`.** Given holdings `[UAH 100, USD 50, UAH 25]`, expect `[UAH 125, USD 50]` (order by absolute value). Empty input → `[]`.
- [ ] **Step 2: Run it; confirm it fails.** `npm test -- currency-totals`. Expected: FAIL.
- [ ] **Step 3: Implement `sumByCurrency`** as a pure reduce over holdings into a `Map<CurrencyCode, number>`, then map to `Money.of(currency, minor)` and sort by `Math.abs(minorUnits)` descending. Follow `pff-domain` for `Money` construction.
- [ ] **Step 4: Run it; confirm it passes.** `npm test -- currency-totals`. Expected: PASS.
- [ ] **Step 5: Write failing test for `CurrencyBreakdown`.** Given two `Money` items, expect two formatted rows rendered. Mirror existing RNTL component-test patterns.
- [ ] **Step 6: Run it; confirm it fails.** `npm test -- currency-breakdown`. Expected: FAIL.
- [ ] **Step 7: Implement `CurrencyBreakdown`** — a `Box` column with `gap` from `theme.spacing`, each row a caption-sized line. Amounts via `MoneyText context="balance"`. Follow `pff-design-system`.
- [ ] **Step 8: Run it; confirm it passes.** `npm test -- currency-breakdown`. Expected: PASS.
- [ ] **Step 9: `npm run check:lint`; `npm run check:knip`** (the new exports must be consumed by Tasks 5 and 9; if knip flags them as unused now, that is expected until those tasks land — note it, do not add ignores).

### Task 3: Scrollable `Screen` for large titles (heading overlap)

**Files:**
- Modify: `src/design-system/components/screen/screen.props.ts`, `screen.component.tsx`, `screen.styles.ts`
- Modify: `src/screens/accounts/accounts.screen.tsx`, `src/screens/settings/settings.screen.tsx` (opt in)
- Test: `src/design-system/components/screen/screen.component.test.tsx` (create if absent)

**Root cause:** `headerLargeTitle: true` needs a scrollable content root with `contentInsetAdjustmentBehavior="automatic"`. The current `Screen` uses a non-scrolling `View` inside a top-edge `SafeAreaView`, which double-offsets and overlaps the native large title.

**Interfaces:**
- Produces: `Screen` gains `scroll?: boolean` (default `false`). When `true`, it renders a `ScrollView` with `contentInsetAdjustmentBehavior="automatic"` and drops the top safe-area edge (the native header owns the top inset); it keeps the horizontal + bottom padding. When `false`, behavior is unchanged.

- [ ] **Step 1: Write failing test.** Assert that with `scroll` the root is a `ScrollView` and `contentInsetAdjustmentBehavior === 'automatic'`; without it, the current `View` root is preserved.
- [ ] **Step 2: Run it; confirm it fails.** `npm test -- screen`. Expected: FAIL.
- [ ] **Step 3: Implement.** Add the prop; in scroll mode render `<ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.scrollContent}>`, and set `SafeAreaView` edges to `['left','right','bottom']`. Keep `padding: theme.spacing(4)` on the content container.
- [ ] **Step 4: Run it; confirm it passes.** `npm test -- screen`. Expected: PASS.
- [ ] **Step 5: Opt in** Accounts and Settings: wrap their content with `<Screen scroll>`. Do not change their inner layout yet beyond this.
- [ ] **Step 6: Run the full suite for the touched screens.** `npm test -- accounts settings screen`. Expected: PASS.
- [ ] **Step 7: `npm run check:lint`.**

**Manual check (record, do not skip):** on an iOS 26 simulator, the Accounts and Settings large titles must no longer overlap the first row.

### Task 4: Stable bottom-tab tint

**Files:**
- Modify: `src/navigation/root.navigator.tsx`
- Modify: `src/navigation/dark-theme.ts` (only if an explicit tint is chosen there)

**Root cause:** `react-native-bottom-tabs` derives the active tint from the navigation theme `primary` (accent blue), so the tab color shifts to blue on selection/press. The user wants the tab bar to stay stable.

**Decision to confirm with the reviewer/user during execution:** set explicit `tabBarActiveTintColor` and `tabBarInactiveTintColor` so the tab bar has one intentional scheme and does not flash accent-blue. Default choice: active = `theme.colors.textPrimary` (white), inactive = `theme.colors.textSecondary`. If the user prefers the accent as the active color but without the press flash, set active = `theme.colors.accent` and inactive = `textSecondary` — still stable, just blue when selected.

- [ ] **Step 1:** Read `react-native-bottom-tabs` current options via the `context7` MCP (confirm the exact `tabBarActiveTintColor`/`tabBarInactiveTintColor` option names for this version before coding).
- [ ] **Step 2:** Add `screenOptions` to the `Tabs.Navigator` setting the active/inactive tint per the decision above, from theme tokens.
- [ ] **Step 3:** Run `npm test -- navigation` (or the app-render smoke test). Expected: PASS.
- [ ] **Step 4:** `npm run check:lint`.

**Manual check:** pressing and switching tabs no longer changes the bar color unexpectedly.

---

## Phase 1 — Home

### Task 5: Net worth white + per-currency breakdown (replace "Rates unavailable")

**Files:**
- Modify: `src/screens/home/home.screen.tsx`, `src/screens/home/home.styles.ts`
- Test: `src/screens/home/home.screen.test.tsx`

**Interfaces:**
- Consumes: `MoneyText context="balance"` (Task 1), `sumByCurrency` + `CurrencyBreakdown` (Task 2).

**Behavior:** The net-worth amount uses `context="balance"` (white when ≥ 0). Directly under it, always render `CurrencyBreakdown` built from `sumByCurrency(activeHoldings)` — one line per held currency with its own-currency total. Remove the `hasUnconvertible` "Rates unavailable" branch: instead of hiding data when a rate is missing, show the converted net-worth total for convertible holdings (as today) plus the full per-currency breakdown so the user always sees their real holdings.

- [ ] **Step 1: Write failing tests.** (a) When holdings span UAH + USD, the breakdown shows a UAH line and a USD line with the summed amounts. (b) When a rate is missing, "Rates unavailable" no longer renders and the breakdown still shows every currency. (c) The net-worth amount renders with `tone="textPrimary"` for a positive total.
- [ ] **Step 2: Run them; confirm they fail.** `npm test -- home.screen`. Expected: FAIL.
- [ ] **Step 3: Implement.** Add `context="balance"` to the net-worth `MoneyText`. Compute `sumByCurrency(activeHoldings)` and render `CurrencyBreakdown` under the balance. Delete the `hasUnconvertible` gate and the "Rates unavailable" node. Keep `guardedNetWorth` for the converted headline total.
- [ ] **Step 4: Run them; confirm they pass.** `npm test -- home.screen`. Expected: PASS.
- [ ] **Step 5: `npm run check:lint`; `npm run check:knip`** (the Task 2 exports are now consumed).

### Task 6: Multi-select transaction filters

**Files:**
- Modify: `src/screens/home/transaction-filter-bar.component.tsx`
- Modify: `src/screens/home/home.screen.tsx`
- Test: `src/screens/home/transaction-filter-bar.component.test.tsx` (create if absent), `home.screen.test.tsx`

**Interfaces:**
- Produces: `FilterChipRow` selection becomes a set. Props change from `selected: string` + `onSelect(value)` to `selected: Set<string>` (or `string[]`) + `onToggle(value)`. Selecting `FILTER_ALL` clears the set to "all"; selecting a specific value toggles it and clears the `FILTER_ALL` pseudo-state. An empty set means "all".

**Filter semantics:** a transaction matches when (account set is empty OR includes its account) AND (category set is empty OR includes its category). Selecting `All` empties that dimension's set.

- [ ] **Step 1: Write failing tests.** (a) Toggling two categories keeps both active and shows transactions from either. (b) Toggling a value off removes it. (c) Selecting `All` clears the dimension. (d) A chip is styled active when in the set.
- [ ] **Step 2: Run them; confirm they fail.** `npm test -- transaction-filter-bar home.screen`. Expected: FAIL.
- [ ] **Step 3: Implement** the set-based state in `home.screen.tsx` (`useState<Set<string>>` per dimension), the `onToggle` handler, the multi-match filter predicate, and the active-styling by `selected.has(option)` in the chip row.
- [ ] **Step 4: Run them; confirm they pass.** Expected: PASS.
- [ ] **Step 5: `npm run check:lint`.**

### Task 7: More vertical room on transaction rows

**Files:**
- Modify: `src/screens/home/home.styles.ts`

- [ ] **Step 1:** Increase the transaction row `paddingVertical` from `theme.spacing(2)` to `theme.spacing(3)` (8 → 12); if the row's internal `Box gap` is 1, raise it to 2 for legibility. Keep the hairline border.
- [ ] **Step 2:** Run `npm test -- home.screen`. Expected: PASS (snapshot/logic unaffected; update any snapshot deliberately).
- [ ] **Step 3:** `npm run check:lint`.

**Manual check:** transactions read with more breathing room.

---

## Phase 2 — Accounts

### Task 8: Pop each tab stack to top on blur (back-nav fix)

**Files:**
- Modify: `src/navigation/root.navigator.tsx`

**Root cause:** each tab's native stack keeps its state across tab switches, so leaving `AccountDetail` pushed and returning to the Accounts tab restores `AccountDetail` instead of the list.

- [ ] **Step 1:** Confirm the correct option name for this navigator version via `context7` (`popToTopOnBlur` on native-stack, or a `tabPress` listener that calls `navigation.popToTop()`), then choose the supported one.
- [ ] **Step 2:** Apply it so switching away from a tab resets that tab's stack to its root. Prefer `popToTopOnBlur: true` on the stack screens if supported; otherwise add a `tabPress`/`blur` listener in the tab navigator.
- [ ] **Step 3:** Run `npm test -- navigation`. Expected: PASS.
- [ ] **Step 4:** `npm run check:lint`.

**Manual check:** Account detail → Home → Accounts now lands on the accounts list.

### Task 9: Account total + per-currency breakdown

**Files:**
- Modify: `src/screens/account-detail/account-detail.screen.tsx`
- Test: `src/screens/account-detail/account-detail.screen.test.tsx` (create if absent)

**Interfaces:**
- Consumes: `guardedNetWorth` (converted total), `sumByCurrency` + `CurrencyBreakdown` (Task 2), `MoneyText context="balance"` (Task 1).

**Behavior:** At the top of account detail, show one overall balance = that account's holdings converted to the base currency (`guardedNetWorth(accountHoldings, base, rateTable)`), rendered white when positive. Under it, render `CurrencyBreakdown` from `sumByCurrency(accountHoldings)` so each currency shows its own total. The existing per-holding list stays below. The accounts-list total (already converted) only needs `context="balance"` so positives are white.

- [ ] **Step 1: Write failing tests.** (a) An account with UAH + USD holdings shows a converted overall balance and a two-line breakdown. (b) The overall balance renders `tone="textPrimary"` when positive.
- [ ] **Step 2: Run them; confirm they fail.** `npm test -- account-detail`. Expected: FAIL.
- [ ] **Step 3: Implement** the overall balance + breakdown block at the top of account detail. Reuse the accounts-list conversion pattern (`buildRateTable` + `guardedNetWorth`).
- [ ] **Step 4:** Also set `context="balance"` on the accounts-list amount in `src/screens/accounts/accounts.screen.tsx`.
- [ ] **Step 5: Run them; confirm they pass.** Expected: PASS.
- [ ] **Step 6:** `npm run check:lint`; `npm run check:knip`.

### Task 10: Move "Add account" button to the bottom

**Files:**
- Modify: `src/screens/accounts/accounts.screen.tsx`, `src/screens/accounts/accounts.styles.ts`

**Behavior:** the "Add account" button pins to the bottom of the Accounts screen, easy to reach. Because Task 3 made the screen scrollable, place the button in a non-scrolling footer under the `ScrollView` (full-width, comfortable tap target), not as the last scrolled child.

- [ ] **Step 1:** Restructure the Accounts layout: scrollable list content in `<Screen scroll>`, then a fixed footer `Box` holding the full-width "Add account" `PressableButton`. Use theme spacing for the footer padding; respect the bottom safe-area inset.
- [ ] **Step 2:** Run `npm test -- accounts`. Expected: PASS.
- [ ] **Step 3:** `npm run check:lint`.

**Manual check:** the button sits at the bottom and stays reachable while the list scrolls.

---

## Phase 3 — Settings

### Task 11: Move Monobank token input into the bank account settings

**Files:**
- Modify: `src/screens/account-detail/account-detail.screen.tsx`
- Modify: `src/screens/settings/settings.screen.tsx`
- Test: `src/screens/account-detail/account-detail.screen.test.tsx`, `src/screens/settings/settings.screen.test.tsx`

**Behavior:** the Monobank token `TextInput`, the paste/open-link helpers, the save action, and the sync-status line move from global Settings into the bank account's detail screen (which already hosts Connect/Sync). Settings no longer shows any Monobank token UI. The token still persists via the same `token.ts`/Keychain path; only its location moves.

- [ ] **Step 1: Write failing tests.** (a) The bank account detail renders a token input and a save action. (b) Settings renders no token input. Keep the existing token-save behavior covered.
- [ ] **Step 2: Run them; confirm they fail.** `npm test -- account-detail settings.screen`. Expected: FAIL.
- [ ] **Step 3: Implement.** Move the token block (input + paste + open-link + save + status) into `account-detail.screen.tsx` under the bank branch (`kind === 'bank'`). Remove it from `settings.screen.tsx`. Reuse the existing `readToken`/save helpers and the sync-status formatting; do not duplicate logic — extract a shared piece if both screens still need part of it. Follow `pff-architecture` for the token/Keychain path.
- [ ] **Step 4: Run them; confirm they pass.** Expected: PASS.
- [ ] **Step 5:** `npm run check:lint`; `npm run check:dup` (the moved block must not become a duplicate — extract if needed).

### Task 12: Redo the Settings first section as a list

**Files:**
- Modify: `src/screens/settings/settings.screen.tsx`, `src/screens/settings/settings.styles.ts`
- Test: `src/screens/settings/settings.screen.test.tsx`

**Behavior:** replace the boxed side-by-side button block (which overflowed on narrow screens) with a vertical list of full-width rows, each a single tappable list row (label + optional icon + chevron), following the grouped-list style already used elsewhere. After Task 11 removed the token block, this section holds the remaining Settings entries (including the new "Categories" row from Task 15).

- [ ] **Step 1: Write failing test.** Assert the section renders as stacked full-width rows, not a single horizontal `row` Box, and that each row is independently pressable.
- [ ] **Step 2: Run it; confirm it fails.** `npm test -- settings.screen`. Expected: FAIL.
- [ ] **Step 3: Implement** the list layout in `settings.screen.tsx` + `settings.styles.ts`. Reuse the `GlassSurface` grouped-list container; each row full-width with a hairline separator. Follow `pff-design-system`.
- [ ] **Step 4: Run it; confirm it passes.** Expected: PASS.
- [ ] **Step 5:** `npm run check:lint`.

**Manual check:** no button clips; the section reads as a clean list.

---

## Phase 4 — Categories management sub-screen

**Model decision (flagged for user review):** add a `categories` table keyed by a stable slug so a rename or icon change never rewrites transaction rows. Transactions keep storing the stable category key. The display layer resolves key → `{ title, icon }`.

### Task 13: `categories` table + migration + repo

**Files:**
- Modify: `src/db/schema.ts`
- Create: a new migration under `src/db/migrations/` (follow the existing drizzle migration flow and `pff-architecture`)
- Create: `src/repositories/categories.repo.ts`
- Test: `src/repositories/categories.repo.test.ts`

**Interfaces:**
- Produces: `categories` table — `{ key: text primary key, title: text not null, icon: text not null }`.
- Produces: `categoriesRepo` — `allQuery()` (live), `updateTitle(key, title)`, `updateIcon(key, icon)`. Follow the existing repository pattern (see `src/repositories/*.repo.ts`).
- Seed: on migration, insert one row per canonical category from `MCC_CATEGORIES` keys plus `Other`, each with a default SF Symbol icon (merge the existing `CATEGORY_ICON` map defaults; pick sensible SF Symbols for the rest, e.g. `cart` groceries, `fork.knife` dining, `car` transport, `bag` shopping, `bolt` utilities, `gamecontroller` entertainment, `cross.case` health, `banknote` cash, `arrow.left.arrow.right` transfers, `square.grid.2x2` other).

- [ ] **Step 1: Write failing test.** After migration, `categoriesRepo.allQuery()` returns one seeded row per canonical category with a non-empty title and icon; `updateTitle`/`updateIcon` persist.
- [ ] **Step 2: Run it; confirm it fails.** `npm test -- categories.repo`. Expected: FAIL.
- [ ] **Step 3: Implement** the schema table, the migration (with the seed insert), and the repo. Regenerate the migration through the project's drizzle flow — do not hand-write SQL that bypasses it. Follow `pff-architecture` for `db.transaction` and query shape (mind the op-sqlite read shim).
- [ ] **Step 4: Run it; confirm it passes.** Expected: PASS.
- [ ] **Step 5:** `npm run check:lint`; `npm run check:knip`; `npm run check:deps`.

### Task 14: Resolve display title + icon from the repo

**Files:**
- Modify: `src/screens/home/home.screen.tsx` (transaction row title + icon)
- Modify: `src/monobank/mcc-category.ts` if a shared resolver helps (keep MCC→key mapping; add key→display resolution via the repo)
- Test: `src/screens/home/home.screen.test.tsx`

**Behavior:** transaction rows show the category's user-set `title` and `icon` from `categoriesRepo`, not the hard-coded `CATEGORY_ICON` map. The MCC→key mapping stays; only the display resolution changes to read the table.

- [ ] **Step 1: Write failing test.** After renaming a category via the repo, a transaction in that category shows the new title; its icon follows the repo value.
- [ ] **Step 2: Run it; confirm it fails.** `npm test -- home.screen`. Expected: FAIL.
- [ ] **Step 3: Implement.** Load categories via `categoriesRepo.allQuery()`; build a `key → { title, icon }` lookup; use it for the row label and the `SymbolIcon` name. Remove the hard-coded `CATEGORY_ICON` map. Keep case-insensitive matching by key.
- [ ] **Step 4: Run it; confirm it passes.** Expected: PASS.
- [ ] **Step 5:** `npm run check:lint`; `npm run check:knip` (the old map must be gone, not orphaned).

### Task 15: Categories settings sub-screen + route

**Files:**
- Create: `src/screens/settings/categories.screen.tsx`, `categories.styles.ts`
- Modify: `src/navigation/settings.stack.tsx`, `src/navigation/types.ts`
- Modify: `src/screens/settings/settings.screen.tsx` (add the "Categories" list row from Task 12 that navigates here)
- Test: `src/screens/settings/categories.screen.test.tsx`

**Behavior:** a Settings sub-screen lists every category. Each row shows the current icon + title. Tapping a row lets the user rename it (text field) and pick a new SF Symbol icon (from a curated set). Changes persist via `categoriesRepo` and reflect immediately (live query).

- [ ] **Step 1: Write failing tests.** (a) The screen lists all seeded categories. (b) Renaming a category calls `updateTitle` and shows the new title. (c) Choosing a new icon calls `updateIcon`.
- [ ] **Step 2: Run them; confirm they fail.** `npm test -- categories.screen`. Expected: FAIL.
- [ ] **Step 3: Implement** the screen (grouped list, `SymbolIcon` per row, an edit affordance with a text input and an icon picker from a curated SF Symbol list), the `Categories` route in the Settings stack + `types.ts`, and the navigating list row in Settings. Follow `pff-design-system`. For the icon picker, use a fixed curated array of SF Symbol names (no dynamic/user free-text), consistent with `symbol.color.ts`'s current safe scope.
- [ ] **Step 4: Run them; confirm they pass.** Expected: PASS.
- [ ] **Step 5:** `npm run check:all` (full fast+medium tier) must be green.

**Manual check:** Settings → Categories lists categories; a rename and an icon change persist and appear on Home transaction rows.

---

## Final verification (after all tasks)

- [ ] `npm run check:all` green (lint, dup, knip, deps, security, secrets, overrides).
- [ ] Full Jest suite green (`npm test`).
- [ ] `pff:reviewer` `/ponytail-review` on the working-tree diff for correctness + over-engineering.
- [ ] Manual walkthrough on the iOS 26 simulator: Home (white net worth, currency breakdown, multi-select filters, roomier rows) → Accounts (no heading overlap, bottom Add button, per-currency account totals, correct back-nav) → account detail (Monobank token here) → Settings (list layout, Categories sub-screen) → tab bar stays stable.
- [ ] `npm run check:deep` is optional here (slow, manual) and remains the user's call per the standing handoff.

## Self-review notes

- **Spec coverage:** every feedback item maps to a task — net-worth white (Task 1/5), currency list under net worth (2/5), multi-select filters (6), transaction spacing (7), heading overlap (3), back-nav (8), multi-currency account sum + breakdown (2/9), Add-account bottom (10), Monobank into bank settings (11), Settings list layout (12), categories sub-screen (13/14/15), stable tab color (4), white-balance/green-transaction rule (1 applied in 5/9). No gap found.
- **Type consistency:** `sumByCurrency` and `CurrencyBreakdown` (Task 2) are consumed with the same signatures in Tasks 5 and 9. `MoneyText context` (Task 1) is used consistently. `categoriesRepo` methods (`allQuery`/`updateTitle`/`updateIcon`) are consumed identically in Tasks 14 and 15.
- **Open decision for the user:** the categories model (a `categories` table keyed by stable slug; transactions keep the key). Confirm before Task 13.
