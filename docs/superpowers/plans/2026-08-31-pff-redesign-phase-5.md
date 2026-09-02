# PFF Redesign Phase 5 — Token Flow + Auto-Sync + Categories — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Finish the redesign: derive transaction categories from Monobank MCC, streamline Monobank token capture (open the token page + paste from clipboard + validate), and run a throttled sync automatically when the app opens.

**Architecture:** Add an MCC→category lookup and set `category` in the sync mapper. Add the clipboard dependency. Enhance the Settings token section with an "Open api.monobank.ua" (Linking) action, a "Paste from clipboard" action, and validation via `fetchClientInfo` on save. Add a throttled auto-sync effect at the app root, gated on a connected account and `lastSyncAt`.

**Tech Stack:** React Native 0.87 (`Linking` from core), react-native-keychain, `@react-native-clipboard/clipboard` (new), drizzle-orm live queries, Jest + RNTL.

**Spec:** `docs/superpowers/specs/2026-08-31-pff-redesign-design.md`

**Base branch:** `drizzer14/pff-redesign-phase-1` (Phase 5 stacks on Phase 4, head `533b2f2`).

## Global Constraints

- Native Apple iOS look, dark-only; iOS dark tokens; `tone` for text color (the `style` prop excludes `color`).
- The Monobank token stays in the Keychain; never render it in plain text (keep `secureTextEntry`), never log it.
- Monobank personal API = one connection; auto-sync and on-demand sync both target the single connected account (`institution === 'monobank'`).
- Auto-sync must be throttled (do not sync on every render/open within the window) and must never crash the app on failure (swallow errors like `useSync` does).
- New dependency respects `.npmrc` `min-release-age=7` (pick a version older than 7 days).
- Commit per task on the worktree branch only; never push/merge/main.
- Harness standing rule: fix the real issue, never weaken a check; no bare `biome-ignore`.
- Manual-entry categories on the transaction form are OUT of scope (spec covers MCC categories from sync only).
- Naming: full names; uppercase abbreviations keep case (MCC, ID, ATM); `import type`.

---

### Task 1: MCC → category mapping in sync

**Owner:** `pff:developer`

**Files:**
- Create: `src/monobank/mcc-category.ts`
- Create: `src/monobank/mcc-category.test.ts`
- Modify: `src/monobank/sync.ts` (`mapStatementItem`)
- Modify: `src/monobank/sync.test.ts`

**Interfaces:**
- Produces: `categoryForMcc(mcc: number): string` — maps an MCC to a human category, `'Other'` fallback. `mapStatementItem` sets `category: categoryForMcc(item.mcc)`.

- [ ] **Step 1: Write the failing test** for `categoryForMcc`: a grocery MCC (`5411`) → `'Groceries'`; a dining MCC (`5812`) → `'Dining'`; a transport MCC (`4111`) → `'Transport'`; an ATM MCC (`6011`) → `'Cash'`; an unknown MCC (`9999`) → `'Other'`.
- [ ] **Step 2: Run, confirm fail.** `npx jest src/monobank/mcc-category.test.ts`.
- [ ] **Step 3: Implement `categoryForMcc`.** A `Record<number, string>` (or a small set of `Set`s per category) covering a modest, well-known MCC set, with an `'Other'` fallback. Starter categories and representative MCCs (extend as reasonable):
  - Groceries: 5411, 5422, 5451, 5462, 5499
  - Dining: 5812, 5813, 5814
  - Transport: 4111, 4121, 4131, 4784, 5541, 5542, 7523
  - Shopping: 5651, 5691, 5732, 5912 (drugstore), 5941, 5944, 5945, 5977
  - Utilities: 4814, 4899, 4900
  - Entertainment: 7832, 7922, 7996, 7997
  - Health: 8011, 8021, 8042, 8062
  - Cash: 6011
  - Transfers: 4829, 6012, 6540
  Keep the map data-only; document that it is intentionally partial and MCC-approximate.
- [ ] **Step 4: Wire into `mapStatementItem`** (`src/monobank/sync.ts`): add `category: categoryForMcc(item.mcc)` to the returned object. Update `sync.test.ts` to assert a synced statement item carries the mapped category (pick a fixture MCC and assert its category).
- [ ] **Step 5: Run tests.** `npx jest src/monobank` green.
- [ ] **Step 6: Lint + full suite + commit.**

---

### Task 2: Add the clipboard dependency

**Owner:** `pff:ops`

**Files:**
- Modify: `package.json`, `package-lock.json`, `ios/Podfile.lock`

**Interfaces:**
- Produces: `@react-native-clipboard/clipboard` resolvable from source, pods installed.

- [ ] **Step 1: Choose a min-age-safe version.** `npm view @react-native-clipboard/clipboard time --json`; pick the newest version published more than 7 days ago. If none qualifies, STOP and report.
- [ ] **Step 2: Install.** `npm install @react-native-clipboard/clipboard@<pinned>`.
- [ ] **Step 3: Pods.** `cd ios && pod install`; confirm the new pod in `ios/Podfile.lock`.
- [ ] **Step 4: Verify.** `npm run check:deps`. The package is imported from source in Task 3, so it should not be flagged unused once Task 3 lands; if depcheck flags it now (before Task 3), leave it — Task 3 consumes it. Do NOT add a blanket ignore.
- [ ] **Step 5: Report** the version, Xcode version, and commit on the branch. Do not run app builds.

---

### Task 3: Streamlined token capture in Settings

**Owner:** `pff:developer`

**Files:**
- Modify: `src/screens/settings/settings.screen.tsx`
- Modify: `src/screens/settings/settings.screen.test.tsx`

**Interfaces:**
- Consumes: `Linking` (react-native), `Clipboard` (`@react-native-clipboard/clipboard`), `fetchClientInfo` (`src/monobank/monobank.client.ts`), `saveToken`.
- Produces: a token section with Open / Paste / validated Save.

- [ ] **Step 1: Write failing tests** (mock `Linking.openURL`, `Clipboard.getString`, and `fetchClientInfo`): (a) "Open api.monobank.ua" calls `Linking.openURL('https://api.monobank.ua/')`; (b) "Paste" fills the token field from `Clipboard.getString()`; (c) Save with a token that `fetchClientInfo` accepts calls `saveToken` and shows a success indication (e.g. the returned client `name`); (d) Save with a token that `fetchClientInfo` REJECTS (throws) does NOT call `saveToken` and shows an "Invalid token" error (`tone="negative"`).
- [ ] **Step 2: Run, confirm fail.** `npx jest src/screens/settings`.
- [ ] **Step 3: Implement.** In the Monobank token section:
  - An "Open api.monobank.ua" `PressableButton` → `void Linking.openURL('https://api.monobank.ua/')`.
  - A "Paste from clipboard" `PressableButton` → `Clipboard.getString().then(setToken)` (mark the field user-edited so the prefill effect does not clobber it).
  - Change Save to validate first: set a "checking" state, `await fetchClientInfo(token)`; on success `await saveToken(token)` and show a success line (the client `name`); on a thrown error show "Invalid token" (`tone="negative"`) and do NOT save. Keep `secureTextEntry`; never log the token.
  - Keep the field prefill from `readToken` and the edit-tracking ref.
- [ ] **Step 4: Run tests.** `npx jest src/screens/settings` green.
- [ ] **Step 5: Lint + full suite + commit.** `npm run check:all` green (deps now sees the clipboard import).

---

### Task 4: Auto-sync on app open (throttled)

**Owner:** `pff:developer`

**Files:**
- Create: `src/screens/use-auto-sync.ts` (a mount hook) + `src/screens/use-auto-sync.test.ts`
- Modify: `App.tsx` (attach the hook in `AppRoot`)

**Interfaces:**
- Consumes: `runSync`, `refreshRates`, `settingsRepo.getQuery`, `accountsRepo.connectedQuery`, `ratesRepo.latestFetchedAt`.
- Produces: `useAutoSync()` — on mount, runs one throttled background sync of the connected account.

- [ ] **Step 1: Write the failing test** for the throttle + gating logic. Factor the decision into a pure, testable function, e.g. `shouldAutoSync({ connected: boolean; lastSyncAt: number | null; now: number }): boolean` — true only when `connected` AND (`lastSyncAt === null` OR `now - lastSyncAt >= AUTO_SYNC_INTERVAL_MS`). Test: not connected → false; connected + null lastSyncAt → true; connected + recent lastSyncAt → false; connected + old lastSyncAt → true. Use a defined `AUTO_SYNC_INTERVAL_MS` (5 minutes, matching the rates cache window; document the choice).
- [ ] **Step 2: Run, confirm fail.**
- [ ] **Step 3: Implement `useAutoSync`.** On mount (a `useEffect` with an empty dep array, guarded so it runs once): read the connected account (`accountsRepo.connectedQuery`) and `lastSyncAt` (`settingsRepo.getQuery`) once (a one-shot read, not a live subscription — use a direct `await`/`.then`, mirroring how `sync.ts` reads settings, not `useLiveQuery`, to avoid re-firing on every data change). If `shouldAutoSync(...)`, run the sync in the background: `runSync({ targetAccountId: <connected account id> })` then `refreshRates({ lastRefreshAt })`, all wrapped so a thrown error is swallowed (never crash the app — mirror `useSync`'s error handling but with no UI). Do nothing when not connected or within the throttle window.
- [ ] **Step 4: Attach in `App.tsx`.** Call `useAutoSync()` inside `AppRoot` (it is a component; hooks are legal), after the existing `settingsRepo.ensure()` effect. Ensure it does not block first render.
- [ ] **Step 5: Run tests.** `npx jest src/screens/use-auto-sync.test.ts` green; full `npx jest` green (App test, if any, still green).
- [ ] **Step 6: Lint + commit.**

---

### Task 5: Suite + harness green + Metro

**Owner:** `pff:qa`

- [ ] **Step 1:** `npx jest` — full suite green; fix fallout without weakening.
- [ ] **Step 2:** Confirm coverage: `categoryForMcc` mapping + sync sets category; token capture (open/paste/validate-save/invalid); `shouldAutoSync` throttle/gating. Add any missing.
- [ ] **Step 3:** `npm run check:all` — all seven green; resolve findings the right way. `.superpowers/.*` already gitleaks path-allowlisted.
- [ ] **Step 4:** Metro sanity: background reset-cache Metro; `curl` the iOS bundle → 200. Fix any bad import.
- [ ] **Step 5:** Commit if anything changed. Do NOT run check:deep (Stryker known-broken in this worktree).

---

## Device build (NOT a task — needs the user)

Testing the token flow on a physical iPhone needs a **signed build**, which requires the user's Apple ID / provisioning. This cannot be automated in the worktree. After Phase 5, tell the user how to run it: `npx react-native run-ios --device "<their iPhone>"` with their signing team selected in Xcode, or attach the Orca emulator pane for the simulator. Flag this in the final report.

## Self-Review

**Spec coverage (Phase 5):** MCC categories from sync → Task 1. Streamlined token capture (open page + paste + validate) → Tasks 2, 3. Auto-sync on app open, throttled, targeting the connected account → Task 4. Full green → Task 5. Device build → surfaced to the user (needs signing).
Out of scope (accepted): manual-entry categories on the transaction form; provider OAuth; Android clipboard/glass parity.

**Placeholder scan:** No TBD. The MCC map is concrete (starter set + fallback); the throttle interval is defined (5 min).

**Type consistency:** `categoryForMcc` (Task 1) consumed by `mapStatementItem`; `shouldAutoSync`/`AUTO_SYNC_INTERVAL_MS` (Task 4) self-contained; clipboard import (Task 2) consumed by Task 3.

## Verification (end of phase)
- `npx jest` green; `npm run check:all` green; Metro 200. Hold the branch for user review.
