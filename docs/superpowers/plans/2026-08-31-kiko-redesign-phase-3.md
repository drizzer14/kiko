# Kiko Redesign Phase 3 — Accounts Screen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build the Accounts screen (list of active accounts with balances, create-by-type for Bank/Cash), give Account Detail the account's identity and a Monobank connect/sync action, and parameterize the sync so it targets a user-created Bank account.

**Architecture:** Extract the net-worth view helpers into a shared module so Home and Accounts share them. Replace the Accounts stub with an inset-grouped list. Extend the account form for Cash initial value and restrict the create UI to Bank/Cash. Fetch the account row in Account Detail and add Connect-Monobank / Sync-now actions. Refactor `runSync` to accept a target account id.

**Tech Stack:** React Native 0.87, react-native-unistyles v3, drizzle-orm + op-sqlite live queries, react-native-keychain, Jest + RNTL.

**Spec:** `docs/superpowers/specs/2026-08-31-kiko-redesign-design.md`

**Base branch:** `drizzer14/pff-redesign-phase-1` (Phase 3 stacks on Phase 2, head `47d9f98`).

## Global Constraints

- Native Apple iOS look, dark-only; iOS dark tokens from Phase 1. Prefer iOS inset-grouped list styling for the Accounts list.
- Domain hierarchy unchanged: Account → Holding → Transaction. No schema migration (`accounts.kind`, `holdings.type` already exist).
- Create-account UI offers ONLY Bank and Cash; Crypto and Broker stay in the schema enum but are hidden from the picker.
- Monobank personal API = one connection. "Connected" = an account whose `institution === 'monobank'`. Only one account is connected at a time.
- The design-system `Text`/`MoneyText` `style` prop excludes `color`; use `tone` for text color.
- Commit per task on the worktree branch only; never push/merge/main.
- Harness standing rule: fix the real issue, never weaken a check; no bare `biome-ignore`.
- Delegation: each task names its owner role agent. Naming: full names; uppercase abbreviations keep case (MCC, ID); `import type`.

---

### Task 1: Extract shared net-worth view helpers

**Owner:** `kiko:developer`

**Files:**
- Create: `src/rates/net-worth-view.ts`
- Modify: `src/screens/home/home.screen.tsx` (import from the new module)
- Test: `src/rates/net-worth-view.test.ts` (create)

**Interfaces:**
- Produces: `buildRateTable(rows)`, `canConvert(currency, base, rates)`, `guardedNetWorth(holdings, base, rates)` — moved verbatim from `home.screen.tsx` (currently lines ~35-64). Types unchanged: `guardedNetWorth(holdings: {accountId?; currency; balanceMinorUnits}[], base, rates): Money`.

- [ ] **Step 1: Write the failing test** in `net-worth-view.test.ts` covering `buildRateTable` (string→number, drops non-finite), `canConvert` (same-currency true, missing-rate false), and `guardedNetWorth` (sums convertible, skips unconvertible). Base the cases on the existing behavior.
- [ ] **Step 2: Run it, confirm it fails** (module absent). `npx jest src/rates/net-worth-view.test.ts`.
- [ ] **Step 3: Create the module** by moving `buildRateTable`, `canConvert`, `guardedNetWorth` (and the `RateTable`/`ConvertibleHolding` types they need) out of `home.screen.tsx` into `net-worth-view.ts`, exported.
- [ ] **Step 4: Update `home.screen.tsx`** to import them from `../../rates/net-worth-view` and delete the local copies. Keep Home behavior identical.
- [ ] **Step 5: Run tests.** `npx jest src/rates src/screens/home` green.
- [ ] **Step 6: Lint + full suite + commit.** `npx jest`, `npm run check:lint`; commit on the branch.

---

### Task 2: Accounts screen — active accounts with balances

**Owner:** `kiko:developer` (+ `kiko:designer` for the grouped-list style if needed)

**Files:**
- Modify: `src/screens/accounts/accounts.screen.tsx`
- Create: `src/screens/accounts/accounts.styles.ts` (if needed)
- Test: `src/screens/accounts/accounts.screen.test.tsx` (create)

**Interfaces:**
- Consumes: `accountsRepo.listQuery()`, `holdingsRepo.allQuery()`, `ratesRepo.allQuery()`, `settingsRepo.getQuery()`, `net-worth-view` (Task 1).
- Produces: an Accounts list screen with per-account balance and an Add-account entry point.

- [ ] **Step 1: Write the failing test.** Seed two accounts (one archived) and holdings; assert the active account renders with its name and a symbol-formatted balance, and the archived account does NOT render. Assert an "Add account" control navigates to `AccountForm`. Use the existing live-query mock harness (see `home.screen.test.tsx`).
- [ ] **Step 2: Run it, confirm it fails.** `npx jest src/screens/accounts`.
- [ ] **Step 3: Implement.** Props: `NativeStackScreenProps<AccountsStackParamList, 'Accounts'>`. Read accounts + holdings + rates + settings via `useLiveQuery`. Filter accounts to `archivedAt == null`. For each account, compute its balance: `guardedNetWorth(holdings.filter(h => h.accountId === account.id && h.closedAt == null), base, rates)`. Render an inset-grouped list: each row shows `account.name`, a small kind label (`account.kind`), and a `MoneyText` of the subtotal; pressing a row navigates to `AccountDetail` with `{ accountId }`. Add an "Add account" button (top or a header action) that navigates to `AccountForm` with `{}`. iOS grouped styling via a screen-local `accounts.styles.ts` or a reused `ListRow`.
- [ ] **Step 4: Run the test.** `npx jest src/screens/accounts` green.
- [ ] **Step 5: Lint + full suite + commit.**

---

### Task 3: Account form — Bank/Cash only + Cash initial value

**Owner:** `kiko:developer`

**Files:**
- Modify: `src/screens/forms/account-form.screen.tsx`
- Modify/Create: `src/screens/forms/account-form.screen.test.tsx`

**Interfaces:**
- Consumes: `accountsRepo.create`, `holdingsRepo.create`.
- Produces: a create form offering Bank/Cash; Cash also creates a `cash` holding with an initial value.

- [ ] **Step 1: Write the failing tests.** (a) The kind picker shows only `Bank` and `Cash` (not Crypto/Broker). (b) Creating a Cash account with an initial value writes the account AND a `cash` holding with that balance. (c) Creating a Bank account writes only the account. Assert against mocked `accountsRepo.create`/`holdingsRepo.create`.
- [ ] **Step 2: Run, confirm fail.** `npx jest src/screens/forms/account-form.screen.test.tsx`.
- [ ] **Step 3: Implement.** Restrict the `kinds` array shown in the picker to `['bank', 'cash']` (keep the DB enum untouched). When `kind === 'cash'`, reveal an `initialValue` decimal input and a `currency` picker (reuse the currency list `['BTC','USD','EUR','UAH']`, default `'UAH'`). On submit:
  - `bank`: `await accountsRepo.create({ name, kind: 'bank' })`.
  - `cash`: create the account, then get its id and `await holdingsRepo.create({ accountId, name: name, type: 'cash', currency, balanceMinorUnits: Money.fromMajor(currency, Number(initialValue) || 0).minorUnits })`.
    - NOTE: `accountsRepo.create` does not return the new id. Add a small `accountsRepo.create` variant or read it back: prefer generating the id in the form is NOT possible (repo owns id). Instead, add `createReturningId` to `accounts.repo.ts` OR after create, query the newest account by createdAt. RULING for the implementer: add `accountsRepo.createAndReturn(input): Promise<string>` that inserts and returns the generated id (mirror `id()` usage), and use it here; keep the existing `create` for callers that ignore the id. Add a repo test for it.
  Keep the inline chip pattern already used in the file (do not introduce a new shared component in this task).
- [ ] **Step 4: Run tests.** `npx jest src/screens/forms/account-form.screen.test.tsx src/repositories` green.
- [ ] **Step 5: Lint + full suite + commit.**

---

### Task 4: Account Detail — identity + Monobank actions

**Owner:** `kiko:developer`

**Files:**
- Modify: `src/screens/account-detail/account-detail.screen.tsx`
- Modify: `src/screens/account-detail/account-detail.screen.test.tsx`
- Add to `src/repositories/accounts.repo.ts`: a single-account query.

**Interfaces:**
- Consumes: `accountsRepo` (new `byIdQuery`), `holdingsRepo.listByAccountQuery`, `readToken` (`src/monobank/token.ts`), the sync trigger from Task 5.
- Produces: Account Detail showing the account name; Connect-Monobank and Sync-now actions for a bank account.

- [ ] **Step 1: Add `accountsRepo.byIdQuery(accountId)`** — `database.select().from(accounts).where(eq(accounts.id, accountId))` — with a repo test.
- [ ] **Step 2: Write the failing screen test.** Assert the screen renders the account's real NAME (not the static "Account"); for a `bank` account not yet connected (`institution == null`), a "Connect Monobank" control renders; for a connected bank account (`institution === 'monobank'`), a "Sync now" control renders; a `cash` account shows neither.
- [ ] **Step 3: Run, confirm fail.**
- [ ] **Step 4: Implement.** Read the account via `useLiveQuery(accountsRepo.byIdQuery(accountId), ['accounts'])`; render `account.name` as the title/large content. Keep the holdings list + "Add holding". For a `bank` account: if `institution !== 'monobank'`, show "Connect Monobank" (Task 5 wires its action); if `institution === 'monobank'`, show "Sync now" (Task 5 wires it) plus the last-sync time from settings if available. Use `tone`, not color styles.
- [ ] **Step 5: Run tests.** `npx jest src/screens/account-detail src/repositories` green.
- [ ] **Step 6: Lint + full suite + commit.**

---

### Task 5: Parameterize sync to a target account + wire Connect/Sync

**Owner:** `kiko:developer`

**Files:**
- Modify: `src/monobank/sync.ts`
- Modify: `src/monobank/sync.test.ts`
- Modify: `src/screens/use-sync.ts` (accept a target account id)
- Modify: `src/screens/account-detail/account-detail.screen.tsx` (wire Connect + Sync)

**Interfaces:**
- Consumes: `runSync`, `useSync`, `accountsRepo.update`, `readToken`.
- Produces: `runSync({ targetAccountId? })` that targets a specific account; a Connect action that marks an account `institution: 'monobank'` and syncs it; a Sync-now action.

- [ ] **Step 1: Write the failing sync test.** For `runSync` given a `targetAccountId`: it uses that account (does NOT create a new 'Monobank' account) and marks it `institution: 'monobank'`. For `runSync` with no id: it finds the existing `institution === 'monobank'` account; if none exists, it throws a clear error (no silent auto-create in the new model). Update the existing auto-create test to the new behavior.
- [ ] **Step 2: Run, confirm fail.**
- [ ] **Step 3: Refactor `runSync`.** Add an optional `targetAccountId` (via the params object or `SyncDeps`). Replace `ensureMonobankAccount` so: if `targetAccountId` is given, ensure that account exists and set its `institution: 'monobank'` (via `accountsRepo.update`), return it; else find the account with `institution === 'monobank'` and return it; else throw `Error('No Monobank account connected')`. Remove the `createMonobankAccount` auto-create default (or keep it only as an explicit fallback not used by the new callers — prefer removing it and updating tests). Keep the statement/holdings import logic unchanged.
- [ ] **Step 4: Update `useSync`** to accept an optional `targetAccountId` and pass it to `runSync`. Keep its `{ isSyncing, error, sync }` shape.
- [ ] **Step 5: Wire Account Detail.** Connect Monobank action: if `readToken()` returns undefined, show a message directing the user to add the token in Settings (do NOT crash); if a token exists, call `sync(accountId)` (which marks institution + imports). Sync-now action (connected account): call `sync(accountId)`. Surface `isSyncing`/`error`.
- [ ] **Step 6: Run tests.** `npx jest src/monobank src/screens/account-detail` green; fix fallout in any test asserting the old auto-create.
- [ ] **Step 7: Lint + full suite + commit.**

---

### Task 6: Suite + harness green + Metro

**Owner:** `kiko:qa`

- [ ] **Step 1:** `npx jest` — full suite green; fix fallout without weakening.
- [ ] **Step 2:** Confirm coverage exists for: the Accounts list (active-only + balance), Cash-account create writing a holding, Account Detail showing the name + Connect/Sync gating, and the sync target-account behavior. Add any missing.
- [ ] **Step 3:** `npm run check:all` — all seven green; resolve findings the right way.
- [ ] **Step 4:** Metro sanity: background reset-cache Metro, `curl` the iOS bundle → 200.
- [ ] **Step 5:** Commit if anything changed. Do NOT run check:deep (Stryker known-broken in this worktree).

---

## Self-Review

**Spec coverage (Phase 3):** Accounts list active + balances → Task 2. Create Bank/Cash, Cash initial value → Task 3. Account Detail identity + Connect Monobank + on-demand Sync → Tasks 4, 5. Sync targets a user account → Task 5. Shared net-worth helper (removes Home duplication) → Task 1. Full green → Task 6.
Out of scope (later): streamlined token CAPTURE + auto-sync-on-open + MCC categories (Phase 5); Settings inset-grouped redesign (Phase 4).

**Placeholder scan:** No TBD. The `createAndReturn` ruling in Task 3 and the `runSync` refactor in Task 5 are concrete.

**Type consistency:** `net-worth-view` exports (Task 1) consumed by Task 2; `accountsRepo.byIdQuery`/`createAndReturn` names consistent across tasks; `runSync({ targetAccountId })` shape consistent between Tasks 5 and its callers.

## Verification (end of phase)
- `npx jest` green; `npm run check:all` green; Metro 200. Hold the branch for user review.
