# PFF Redesign Phase 4 — Settings Screen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Redesign Settings to native-iOS inset-grouped sections — base currency, Monobank token, and read-only sync status — removing the duplicate in-screen title and the now-misplaced Sync button; and clear the small deferred cosmetics from earlier phases.

**Architecture:** Reorganize `settings.screen.tsx` into iOS grouped sections with a screen-local styles file. Drop the in-screen `<Text variant="title">Settings</Text>` (the native large-title header already shows it) and the Settings-level Sync button (on-demand sync now lives in Account Detail; auto-sync is Phase 5). Keep the token entry + Save and the last-sync status line.

**Tech Stack:** React Native 0.87, react-native-unistyles v3, react-native-keychain, drizzle-orm live queries, Jest + RNTL.

**Spec:** `docs/superpowers/specs/2026-08-31-pff-redesign-design.md`

**Base branch:** `drizzer14/pff-redesign-phase-1` (Phase 4 stacks on Phase 3, head `282dc50`).

## Global Constraints

- Native Apple iOS look, dark-only; iOS dark tokens. Prefer iOS inset-grouped section styling (a section title above a rounded `surface` card of rows with `separator` hairlines).
- The design-system `Text`/`MoneyText` `style` prop excludes `color`; use `tone`.
- Detail/tab screens get their title from the native large-title header — screens must NOT render their own duplicate title text.
- The Monobank token stays in the Keychain (`saveToken`/`readToken`); never render it in plain text (keep `secureTextEntry`) and never log it.
- Sync is per-account (Account Detail "Sync now"); Settings shows sync STATUS only (last-sync time), no Sync button.
- Commit per task on the worktree branch only; never push/merge/main.
- Harness standing rule: fix the real issue, never weaken a check; no bare `biome-ignore`.
- Naming: full names; uppercase abbreviations keep case (ID); `import type`.

---

### Task 1: Settings screen — iOS grouped redesign

**Owner:** `pff:developer` (+ `pff:designer` styling)

**Files:**
- Modify: `src/screens/settings/settings.screen.tsx`
- Create: `src/screens/settings/settings.styles.ts`
- Modify: `src/screens/settings/settings.screen.test.tsx`

**Interfaces:**
- Consumes: `settingsRepo.getQuery()/setBaseCurrency`, `readToken`/`saveToken`, `CurrencySwitch`.
- Produces: a grouped Settings screen with base-currency, token, and sync-status sections; no in-screen title; no Sync button.

- [ ] **Step 1: Write the failing tests.** (a) The screen does NOT render its own "Settings" title text (the native header provides it) — assert `queryByText('Settings')` inside the screen body is null (adjust: the test renders the screen component only, without the native header, so a literal "Settings" text should be absent). (b) A base-currency control renders and selecting a currency calls `settingsRepo.setBaseCurrency`. (c) The token field renders (secureTextEntry) and Save calls `saveToken`. (d) The last-sync status line renders the formatted time (and "Never" when null). (e) There is NO "Sync" button (assert `queryByText('Sync')` is null). Reuse the existing mock harness in `settings.screen.test.tsx`.
- [ ] **Step 2: Run, confirm fail.** `npx jest src/screens/settings`.
- [ ] **Step 3: Implement.**
  - Remove `<Text variant="title">Settings</Text>`.
  - Reorganize into three iOS inset-grouped sections, each = a small section header (`tone="textSecondary"`, caption/footnote) above a rounded `surface` card:
    1. **Base currency** — the `CurrencySwitch`.
    2. **Monobank token** — the `secureTextEntry` `TextInput` (keep the existing behavior: prefill from `readToken`, edit-tracking ref) + a Save button (`saveToken`). Move the inline TextInput style into `settings.styles.ts`.
    3. **Sync status** — a read-only line "Last sync: <formatted time>" (keep `formatLastSyncAt`; "Never" when null). NO Sync button. Remove `useSync` and the Sync button + its `syncError` display from this screen.
  - Style the sections in `settings.styles.ts` (grouped card: `surface` background, `radii.lg`, row padding, `separator` hairlines between rows where there is more than one row).
  - Keep `tone` for text color; do not use the narrowed `style` prop for color.
- [ ] **Step 4: Run tests.** `npx jest src/screens/settings` green.
- [ ] **Step 5: Lint + full suite + commit.** `npx jest`, `npm run check:lint` (knip must stay green — if removing `useSync` from Settings makes any import unused, delete it). Commit on the branch.

---

### Task 2: Clear deferred cosmetics

**Owner:** `pff:developer`

**Files:**
- Modify: `src/screens/accounts/accounts.screen.tsx` (kind label)
- Modify: `src/screens/accounts/accounts.styles.ts` (stale comment)
- Modify: `src/screens/accounts/accounts.screen.test.tsx` (if the label assertion changes)

**Interfaces:**
- Produces: a capitalized account-kind label and a corrected style comment.

- [ ] **Step 1: Fix the stale comment** in `accounts.styles.ts` — the `content`/`group` comment describes a "scrollable list / fixed header" that this screen (a plain `Box`, no `FlatList`) does not have. Replace it with an accurate one-line description of what the style does here.
- [ ] **Step 2: Capitalize the kind label.** In `accounts.screen.tsx`, the account kind currently renders as raw lowercase `"bank"`/`"cash"`. Render a display label instead: capitalize the first letter (e.g. a small `const kindLabel = { bank: 'Bank', cash: 'Cash', crypto: 'Crypto', broker: 'Broker' }` map, or `kind[0].toUpperCase() + kind.slice(1)`). Keep it a `tone="textSecondary"` caption.
- [ ] **Step 3: Update the test** if it asserted the lowercase label; assert the capitalized form.
- [ ] **Step 4: Run tests + lint + commit.** `npx jest src/screens/accounts` green; `npm run check:lint`; commit on the branch.

---

### Task 3: Suite + harness green + Metro

**Owner:** `pff:qa`

- [ ] **Step 1:** `npx jest` — full suite green; fix fallout without weakening.
- [ ] **Step 2:** Confirm coverage: Settings renders base-currency + token + last-sync status and NO Sync button / NO in-screen title; add any missing.
- [ ] **Step 3:** `npm run check:all` — all seven green.
- [ ] **Step 4:** Metro sanity: background reset-cache Metro, `curl` the iOS bundle → 200.
- [ ] **Step 5:** Commit if anything changed. Do NOT run check:deep (Stryker known-broken in this worktree).

---

## Self-Review

**Spec coverage (Phase 4):** Settings base-currency (kept), token entry surface (kept, regrouped), sync status = last-sync time (Task 1). iOS inset-grouped styling (Task 1). No Settings Sync button — resolves the Phase 3 "Settings sync() throws when nothing connected" note by removing the Settings sync trigger (Task 1). Duplicate in-screen title removed (Task 1). Deferred cosmetics cleared (Task 2). Full green (Task 3).
Out of scope (Phase 5): streamlined token CAPTURE (open api.monobank.ua + clipboard paste), auto-sync on app open, MCC categories, signed device build.

**Placeholder scan:** No TBD. Concrete.

**Type consistency:** `settings.styles.ts` consumed by Task 1 only; no cross-task type sharing.

## Verification (end of phase)
- `npx jest` green; `npm run check:all` green; Metro 200. Hold the branch for user review.
