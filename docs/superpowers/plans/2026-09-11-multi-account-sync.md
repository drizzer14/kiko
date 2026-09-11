# Multi-Account Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Before touching any file, invoke the `kiko-architecture`, `kiko-domain`, and `kiko-translator` skills — every task below assumes their contracts.

**Goal:** Let a user connect and sync MORE THAN ONE bank (Monobank) and crypto (Binance, BTC wallet) account per provider, with zero data loss for users who already have a single connection.

**Architecture:** The `accounts` row already models a connection 1:1 (`institution` marks it, `holdings.accountId` FKs to it). We keep that identity and add a per-connection `sync_state` table so the Monobank cursor stops being a single global row on `settings`. Secrets move from one global Keychain item per provider to one item PER connected account, keyed by the account id. The single global Monobank single-flight lock becomes a per-account `Map` — the exact shape the crypto side (`inFlightBalanceSyncs`) already uses. The one-connection-per-institution invariant is relaxed in both resolvers and in the UI.

**Tech Stack:** op-sqlite + drizzle-orm, `react-native-keychain`, React Native / React, i18next, ts-pattern, Jest + RNTL.

**Spec:** This plan's driving brief (the orchestrator's multi-account task) is the spec; it has no standalone spec doc. Background contracts: `docs/superpowers/specs/2026-08-30-kiko-foundation-design.md` (Domain model, Storage and migrations) and `docs/superpowers/specs/2026-09-04-crypto-btc-sync-design.md`.

## Global Constraints

- `.env` is public-only. Secrets live in the iOS Keychain (`react-native-keychain`), NEVER in `.env`, SQLite, `holdings.metadata`, or a log. (CLAUDE.md, `kiko-architecture`.)
- Every insert/update/delete goes through `db.transaction()` — no exception for a single statement (`kiko-architecture`).
- A read repo function returns a Drizzle query builder (for `useLiveQuery`); a write function performs the transactional write and returns when durable (`kiko-architecture`).
- Keychain items keep `accessible: ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY` and NO `accessControl` — a per-item biometric prompt would break silent background auto-sync (`src/monobank/token.ts:22`, `binance.credentials.ts:24`). The biometric gate is `LockGate`, not the item.
- Never prefill a stored secret back into an editable input or React state — only its existence (`hasToken`) may be read back (`monobank-token-field.component.tsx:36`).
- Monobank's rate limit is PER TOKEN. One `createRequestGate` per invocation threads every request of that run; two different tokens may run concurrently and safely (`kiko-architecture` "rate limit is per TOKEN").
- The two i18n catalogues (`src/i18n/locales/en.ts`, `uk.ts`) carry the identical key set; `en.uk.parity.test.ts` enforces it. Ukrainian is sentence case. `en.ts` must NOT end `as const` (check before adding a key) (`kiko-translator`).
- Never persist a display string; resolve labels with `t` at render time (`kiko-translator`).
- Convert every amount to/from `Money` at the repository boundary; minor units are integers, never floats (`kiko-domain`).
- Crash-safe migration ordering for any irreversible move: reversible-expensive step first, COMMIT, delete the irreversible source LAST. Gate on the credential/export-file PRESENCE, not on key-absence (memory: `crash-safe-migration-ordering`, `ios-keychain-survives-reinstall`).
- `npx drizzle-kit generate --name <slug>` also rewrites `drizzle/migrations/migrations.js` and the snapshot/journal JSON — re-run `npx biome check --write` over the generated artifacts and re-check `migrations.js` after every generate (`kiko-architecture`).
- Harness gates: run `npm run check:all` (lint, dup, knip, deps, security, rules, plist, secrets, overrides, typecheck) AND `npx jest` at the end of EVERY task; both must be green before the next task. Run `npm run check:deep` once at the very end (do not run it per task). Fix the underlying issue — never weaken a check.

---

## Current-State Findings (read before planning any task)

These are the facts every task below is grounded in:

- **Monobank token — ONE global Keychain item.** `src/monobank/token.ts:3` service `'kiko.monobank.token'`; `saveToken`/`readToken`/`hasToken`/`clearToken` take no account id. `migrateLegacyToken` (`token.ts:66`) already migrates the pre-`kiko` `'pff.monobank.token'` item and is called in the boot chain (`src/migration/migrations.gate.tsx:72`).
- **Binance credential — ONE global Keychain item.** `src/crypto-sync/binance/binance.credentials.ts:4` service `'kiko.binance.credentials'`, stored as one JSON item; `save/read/clearCredentials` take no account id.
- **BTC wallet — no secret.** The wallet address lives in `holdings.metadata.walletAddress` (public key), so a wallet needs no Keychain change; only its one-connection invariant must relax.
- **Monobank sync cursor is GLOBAL.** `settings.lastSyncAt` (`schema.ts:171`), `lastFullSyncAt` (`:225`), `failedSyncMonobankIds` (`:248`), and `lastSyncDisplayAt` (migration 0020) are single-row columns written via `settingsRepo.setLastSyncAt`/`setLastFullSyncAt`/`setFailedSyncMonobankIds` (`src/settings/settings.repo.ts:21,46,83`). A second Monobank connection would share and corrupt this one cursor.
- **One-connection-per-institution invariant** is enforced in `resolveMonobankAccountId` (`src/monobank/sync.ts:302`, rejects a second `monobank` account via `monobankAlreadyConnected`) and `resolveTargetAccount` (`src/crypto-sync/sync.ts:65`, rejects via `sourceConnectedElsewhere`), and in the UI: `account-detail.screen.tsx:146` (`otherAccountConnected`, `connectedElsewhere` hint) and `crypto-sync-section.component.tsx:57`.
- **Monobank single-flight is a single global lock** `inFlightSync` (`src/monobank/sync.ts:898`). The crypto side already does the right thing: `inFlightBalanceSyncs = new Map<string, ...>` keyed by `targetAccountId ?? institution:${provider.id}` (`src/crypto-sync/sync.ts:130-153`) — this is the "BUG1/R1" per-account single-flight join the brief names. Monobank must adopt the same Map shape.
- **Fan-out.** `syncJobsFor` (`src/sync/sync-jobs.ts:28`) returns a SINGLE `runSync({})` job for the one Monobank account (no `targetAccountId`), and one `runCryptoSync(resyncRequest(...))` per crypto account. `useAutoSync` (`src/sync/use-auto-sync.ts`) and `useSyncAll` (`src/sync/use-sync-all.ts`) both fan out over `accountsRepo.connectedQuery()` (default `'monobank'`). `readToken()` gates the Monobank job in `useAutoSync:66`.
- **Holdings match is already per-account.** `upsertByMetadataKey` scopes by `and(eq(holdings.accountId, ...), keyMatch)` (`src/holdings/holdings.repo.ts:72`), so two Monobank connections' holdings never collide. Good — no change needed there.
- **Transactions unique index is GLOBAL.** `transactions_source_external` on `(source, external_id)` (`schema.ts:113`). See Risk R-1.
- **Create form binds the global token.** `account-form.screen.tsx:146` calls `saveToken(token)` (no account id); its comment (`:135`) explicitly records the "ONE global Keychain slot per institution" assumption this plan removes.
- **Disconnect composes DB-then-Keychain.** `disconnectMonobank` (`src/monobank/disconnect.ts`) and `disconnectCryptoAccount` (`src/crypto-sync/disconnect.ts:16`) clear the DB `institution` first, then the global Keychain item. Both must clear the PER-ACCOUNT item instead.

## File Structure

New files:
- `src/sync-state/sync-state.repo.ts` — per-connection sync cursor repository (reads return a query builder; writes are transactional). Co-located test `sync-state.repo.test.ts`.
- `drizzle/migrations/00NN_add_sync_state.sql` (+ snapshot/journal) — `CREATE TABLE sync_state`.
- `drizzle/migrations/00NN_backfill_sync_state.sql` — data-only backfill of the connected Monobank account's cursor (no snapshot, same class as `0022`).
- `src/monobank/migrate-credential.ts` (+ test) — idempotent, crash-safe bootstrap that moves the single global Monobank token to its per-account service. (Binance equivalent lives beside `binance.credentials.ts`.)

Modified files (each named in its task): `src/db/schema.ts`, `src/settings/settings.repo.ts`, `src/settings/settings-columns.test.ts`, `src/monobank/token.ts`, `src/monobank/sync.ts`, `src/crypto-sync/binance/binance.credentials.ts`, `src/crypto-sync/sync.ts`, `src/crypto-sync/disconnect.ts`, `src/monobank/disconnect.ts`, `src/sync/sync-jobs.ts`, `src/sync/use-auto-sync.ts`, `src/migration/migrations.gate.tsx`, `src/screens/account-detail/account-detail.screen.tsx`, `src/screens/account-detail/monobank-token-field/monobank-token-field.component.tsx`, `src/screens/account-detail/binance-credentials-field/binance-credentials-field.component.tsx`, `src/screens/account-detail/crypto-sync-section/crypto-sync-section.component.tsx`, `src/screens/forms/account-form.screen.tsx`, `src/i18n/locales/en.ts`, `src/i18n/locales/uk.ts`.

Unchanged by design (reused as-is): `src/screens/account-detail/monobank-token-input/*` (the shared `MonobankTokenInput`), `src/monobank/throttle.ts` (per-invocation gate), `src/holdings/holdings.repo.ts` `upsertByMetadataKey` (already per-account).

---

## Phase 1 — De-globalize the Monobank sync cursor (`sync_state` table)

**Why first:** This is the load-bearing data-model change and must exist before a second Monobank connection can run without corrupting the shared cursor. It stays single-connection at the end of the phase, so it is independently shippable and green.

### Task 1.1: Add the `sync_state` schema + repository

**Files:**
- Modify: `src/db/schema.ts` (add `syncState` table after `settings`)
- Create: `drizzle/migrations/00NN_add_sync_state.sql` (+ `meta/00NN_snapshot.json`, journal entry, regenerated `migrations.js`)
- Create: `src/sync-state/sync-state.repo.ts`
- Test: `src/sync-state/sync-state.repo.test.ts`

**Interfaces:**
- Produces: `syncState` table `{ accountId (text PK, FK accounts.id), lastSyncAt (int, null), lastFullSyncAt (int, null), lastSyncDisplayAt (int, null), failedSyncMonobankIds (json string[] | null) }`; `type SyncStateRow = typeof syncState.$inferSelect`.
- Produces: `syncStateRepo` with `getQuery(accountId: string)` (returns a select query builder filtered by `accountId`), `ensure(accountId: string): Promise<void>` (idempotent insert-if-absent, one `db.transaction()`), `setLastSyncAt(accountId, timestamp)`, `setLastFullSyncAt(accountId, timestamp)`, `setLastSyncDisplayAt(accountId, timestamp)`, `setFailedSyncMonobankIds(accountId, ids: string[] | null)` — each a transactional write mirroring `settings.repo.ts:21-85`.
- Consumes (later): `runSyncInner` reads/writes these per `accountId`. Read `src/settings/settings.repo.ts` and `src/db/schema.ts` for the EXACT current cursor-column set before copying — the set drifts; do not trust this list as final.

- [ ] **Step 1: Write the failing test** in `sync-state.repo.test.ts`: `ensure` creates exactly one row per account id and is a no-op on a second call; each setter updates only its column for the given account id and never touches another account id's row. Use the same in-memory/op-sqlite harness the existing repo tests use (`src/settings/*.test.ts`, `src/db/schema.*.test.ts` read `drizzle/migrations` via `node:fs` + `__dirname`).

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx jest src/sync-state/sync-state.repo.test.ts`
Expected: FAIL (module/table not defined).

- [ ] **Step 3: Add the `syncState` table to `src/db/schema.ts`.** One `sqliteTable('sync_state', {...})` with the columns above; `accountId` is `text('account_id').primaryKey().references(() => accounts.id)`. Add a header comment explaining this de-globalizes the former `settings` Monobank cursor (point at the dead-column note added in Task 1.3).

- [ ] **Step 4: Generate the migration.**

Run: `npx drizzle-kit generate --name add_sync_state` then `npx biome check --write drizzle/`
Then re-open `drizzle/migrations/migrations.js` and confirm it still imports every entry (drizzle-kit rewrites it — `kiko-architecture`).
Expected: a new `00NN_add_sync_state.sql` with `CREATE TABLE sync_state`, a snapshot, a journal entry.

- [ ] **Step 5: Implement `src/sync-state/sync-state.repo.ts`** per the Interfaces block. `ensure` uses `insert(...).onConflictDoNothing()` inside `db.transaction()`. Each setter is an `update().where(eq(syncState.accountId, accountId))` inside `db.transaction()`. `getQuery` returns the builder (no `.execute()`), for `useLiveQuery` compatibility.

- [ ] **Step 6: Run the test to confirm it passes**

Run: `npx jest src/sync-state/sync-state.repo.test.ts`
Expected: PASS.

- [ ] **Step 7: Gate + commit**

Run: `npm run check:all && npx jest`
```bash
git add src/db/schema.ts drizzle/migrations src/sync-state
git commit -m "feat(sync-state): add per-connection sync_state table and repo"
```

### Task 1.2: Route the Monobank cursor through `syncStateRepo` (still single-connection)

**Files:**
- Modify: `src/monobank/sync.ts` (the `SyncDeps` seam + the cursor read/write helpers at `:207-220` and the end-of-run sequence in `runSyncInner`)
- Modify: `src/monobank/sync.test.ts`

**Interfaces:**
- Consumes: `syncStateRepo` (Task 1.1). Add a `syncStateRepo` field to `SyncDeps` (mirrors the existing `settingsRepo` seam at `sync.ts:186`) and to `defaultDeps` (`:189`).
- The resolved `accountId` (from `resolveMonobankAccountId`, `sync.ts:944`) is the key for every cursor read/write. `runSyncInner` must call `deps.syncStateRepo.ensure(accountId)` right after `resolveMonobankAccountId` so the row exists before any setter.
- `readLastSyncAt`/`readLastFullSyncAt`/`readFailedSyncIds` (`sync.ts:207-217`) take `accountId` and read `syncStateRepo.getQuery(accountId)` instead of `settingsRepo.getQuery()`.

- [ ] **Step 1: Update `sync.test.ts`** to stub a `syncStateRepo` in deps and assert the cursor setters are called with `(accountId, …)` and that a second in-flight trigger still joins (unchanged). Keep an assertion that the per-card balance-diff skip, `lastFullSyncAt` graduation, and `failedSyncMonobankIds` set-algebra behave exactly as before for a single connection (regression guard — see `kiko-architecture` "Balance-diff skip", "Robust graduation").

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx jest src/monobank/sync.test.ts`
Expected: FAIL (setters still global / new dep missing).

- [ ] **Step 3: Implement.** Add `syncStateRepo` to `SyncDeps`/`defaultDeps`. Thread `accountId` into the cursor read helpers and every `setLastSyncAt`/`setLastFullSyncAt`/`setLastSyncDisplayAt`/`setFailedSyncMonobankIds` call in `runSyncInner`, replacing the `settingsRepo` cursor calls. Call `ensure(accountId)` after resolving the account. Leave `settingsRepo` in `SyncDeps` for `baseCurrency`/non-cursor reads (read the file — keep whatever non-cursor reads remain).

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx jest src/monobank/sync.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate + commit**

Run: `npm run check:all && npx jest`
```bash
git add src/monobank/sync.ts src/monobank/sync.test.ts
git commit -m "refactor(monobank): read/write sync cursor per account via syncStateRepo"
```

### Task 1.3: Backfill migration + retire the global cursor columns as documented-dead

**Files:**
- Create: `drizzle/migrations/00NN_backfill_sync_state.sql` (data-only, no snapshot — same class as `0022_backfill_last_full_sync_at.sql`)
- Modify: `src/settings/settings-columns.test.ts` (`DOCUMENTED_READERLESS_COLUMNS` at `:15`)
- Modify: `src/settings/settings.repo.ts` (remove the now-readerless cursor setters OR keep them unused — see Step 3 decision)

**Interfaces:**
- The backfill inserts one `sync_state` row for the account that currently holds `institution = 'monobank'` (at most one today), copying `settings.last_sync_at`, `last_full_sync_at`, `last_sync_display_at`, `failed_sync_monobank_ids` into it. Guard so it is re-runnable (`INSERT ... SELECT ... WHERE NOT EXISTS`). Read the exact `0022` guard shape before writing.

- [ ] **Step 1: Write the backfill SQL.** `INSERT INTO sync_state (account_id, last_sync_at, last_full_sync_at, last_sync_display_at, failed_sync_monobank_ids) SELECT a.id, s.last_sync_at, s.last_full_sync_at, s.last_sync_display_at, s.failed_sync_monobank_ids FROM accounts a CROSS JOIN settings s WHERE a.institution = 'monobank' AND NOT EXISTS (SELECT 1 FROM sync_state x WHERE x.account_id = a.id);`. Add the journal entry by hand the way `0022` is wired (data-only migrations carry no snapshot — confirm against `0022`).

- [ ] **Step 2: Decide the fate of the old `settings` cursor columns.** Per project precedent (`trendCategoryKeys`, `lockGraceSeconds`, `appearance`), DO NOT drop them in a migration — mark them reader-less. Remove the four cursor SETTERS from `settings.repo.ts` (nothing calls them after Task 1.2) and add `lastSyncAt`, `lastFullSyncAt`, `lastSyncDisplayAt`, `failedSyncMonobankIds` to `DOCUMENTED_READERLESS_COLUMNS` in `settings-columns.test.ts` with a justifying comment ("moved to `sync_state` per 2026-09-11 multi-account plan"). Keep `settings.baseCurrency`/`language`/`lockEnabled`/etc. readers intact.

- [ ] **Step 3: Run the dead-column test**

Run: `npx jest src/settings/settings-columns.test.ts`
Expected: PASS (the readerless set now equals the documented set).

- [ ] **Step 4: Gate + commit**

Run: `npm run check:all && npx jest`
```bash
git add drizzle/migrations src/settings
git commit -m "feat(sync-state): backfill connected Monobank cursor and retire global columns"
```

---

## Phase 2 — Per-account Monobank token in the Keychain

**Why second:** With the cursor per-connection, the token must also bind to a specific account before fan-out can drive N tokens. Ends single-connection but per-account-keyed; independently green.

### Task 2.1: Key the Monobank token service by account id + crash-safe credential migration

**Files:**
- Modify: `src/monobank/token.ts`
- Create: `src/monobank/migrate-credential.ts`
- Test: `src/monobank/token.test.ts`, `src/monobank/migrate-credential.test.ts`
- Modify: `src/migration/migrations.gate.tsx:72`

**Interfaces:**
- Produces: `serviceFor(accountId: string): string` → `` `kiko.monobank.token.${accountId}` ``. `saveToken(accountId, token)`, `readToken(accountId)`, `hasToken(accountId)`, `clearToken(accountId)` — all take the account id and use `serviceFor(accountId)` as the Keychain `service`. The `HARDENED` options (`token.ts:22`) are unchanged except `service` is computed per call.
- Produces: `migrateSingleTokenToPerAccount(connectedMonobankAccountId: string | undefined): Promise<void>` — the crash-safe move (see Step 3). Keep the existing `migrateLegacyToken` (legacy `pff` → global `kiko`) running FIRST, then this new step, in the boot chain.
- Consumes: the account id is the stable `accounts.id` (text PK). An account id is NOT a secret — it is a local uuid — so embedding it in the Keychain service string leaks nothing.

- [ ] **Step 1: Write failing tests.** `token.test.ts`: save/read/has/clear round-trip under a per-account service; two different account ids see isolated items (one's `clearToken` never clears the other). `migrate-credential.test.ts`: (a) a global `kiko.monobank.token` item + a connected account id ⇒ after migration the per-account item holds the token and the global item is GONE; (b) idempotent — a second run is a no-op; (c) gate on PRESENCE: no global item ⇒ no-op even if per-account item absent; (d) crash-safety — if the per-account write succeeds but the global delete is simulated to fail, a re-run still converges (per-account present, global cleared on retry).

- [ ] **Step 2: Run them to confirm they fail**

Run: `npx jest src/monobank/token.test.ts src/monobank/migrate-credential.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `token.ts`** with `serviceFor` and the account-keyed functions. Implement `migrate-credential.ts` with this EXACT ordering (reversible-expensive first, commit, delete-irreversible last — `crash-safe-migration-ordering`):
  1. Read the global item `getGenericPassword({ service: 'kiko.monobank.token' })`. If absent → return (gate on PRESENCE, not key-absence — `ios-keychain-survives-reinstall`).
  2. If no `connectedMonobankAccountId` → return (cannot bind a token to no account; the global item stays put for a later connect to adopt, or for manual re-entry).
  3. If the per-account item already exists → just clear the global item and return (idempotent convergence).
  4. Write the token to the per-account service (`saveToken(accountId, token)`) and READ IT BACK to verify it is durable.
  5. ONLY after the verified write, delete the global item (`resetGenericPassword({ service: 'kiko.monobank.token' })`).

- [ ] **Step 4: Wire the boot chain.** In `migrations.gate.tsx`, after `migrateLegacyToken`, resolve the connected Monobank account id (read `accountsRepo` once in the init chain) and call `migrateSingleTokenToPerAccount(id)`. A language/lock preference must still resolve before first paint — do not reorder the existing chain's `ensure()`/`applyPersistedLanguage` steps (`kiko-architecture` "migrations.gate").

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `npx jest src/monobank/token.test.ts src/monobank/migrate-credential.test.ts`
Expected: PASS.

- [ ] **Step 6: Gate + commit**

Run: `npm run check:all && npx jest`
```bash
git add src/monobank/token.ts src/monobank/migrate-credential.ts src/monobank/*.test.ts src/migration/migrations.gate.tsx
git commit -m "feat(monobank): per-account token Keychain service + crash-safe migration"
```

### Task 2.2: Thread the per-account token through sync and the token UI

**Files:**
- Modify: `src/monobank/sync.ts` (`readToken` dep signature at `:161,193`, and its call in `runSyncInner:939`), `src/monobank/disconnect.ts`
- Modify: `src/monobank/sync.test.ts`
- Modify: `src/screens/account-detail/monobank-token-field/monobank-token-field.component.tsx`, `src/screens/forms/account-form.screen.tsx`
- Modify: `src/sync/use-auto-sync.ts` (the `readToken()` gate at `:58,66`)

**Interfaces:**
- `SyncDeps.readToken` becomes `(accountId: string) => Promise<string | undefined>`; `runSyncInner` resolves `accountId` FIRST (move `resolveMonobankAccountId` above the token read), then `deps.readToken(accountId)`. A missing token still throws `accountDetail.noMonobankToken`.
- `MonobankTokenField` gains an `accountId` prop; `hasToken(accountId)` / `saveToken(accountId, token)`. The account-detail screen passes `account.id`.
- The create form (`account-form.screen.tsx:146`) saves the token to the NEW account id after `accountsRepo.create` returns it (`:202`). The token write must happen AFTER the account row exists (it needs the id).
- `disconnectMonobank(accountId)` clears `clearToken(accountId)` (the per-account item), not the global one.
- `useAutoSync`: the Monobank gate can no longer be one global `readToken()`. Gate each Monobank job on `hasToken(account.id)` (see Phase 3, where `syncJobsFor` goes async or the gate moves into the job). For THIS task, keep single-connection: resolve the one connected Monobank account's id and gate on `hasToken(id)`.

- [ ] **Step 1: Update tests.** `sync.test.ts`: `readToken` stub now receives the resolved account id. Component tests for `MonobankTokenField` (if present) and the create-form flow: token saved under the account id.

- [ ] **Step 2: Run to confirm failure**

Run: `npx jest src/monobank/sync.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** the signature changes above. In `runSyncInner`, reorder so `resolveMonobankAccountId` runs before the token read and pass its id to `readToken`. Update `MonobankTokenField`, `account-form.screen.tsx`, `disconnect.ts`, and the `useAutoSync` gate.

- [ ] **Step 4: Run to confirm pass**

Run: `npx jest`
Expected: PASS.

- [ ] **Step 5: Gate + commit**

Run: `npm run check:all && npx jest`
```bash
git add src/monobank src/screens/account-detail/monobank-token-field src/screens/forms/account-form.screen.tsx src/sync/use-auto-sync.ts
git commit -m "feat(monobank): bind token read/write to the account id end to end"
```

---

## Phase 3 — Monobank fan-out over N connections

**Why third:** Cursor and token are now per-connection; this phase removes the one-connection invariant and makes the fan-out drive every connected Monobank account with its own single-flight join.

### Task 3.1: Per-account single-flight for `runSync` + relax the resolver

**Files:**
- Modify: `src/monobank/sync.ts` (`inFlightSync` at `:898`, `runSync` at `:900`, `resolveMonobankAccountId` at `:302`)
- Modify: `src/monobank/sync.test.ts`

**Interfaces:**
- Replace the scalar `let inFlightSync: Promise<SyncResult> | null` with `const inFlightSyncs = new Map<string, Promise<SyncResult>>()`, keyed by the resolved target account id — the EXACT shape of `inFlightBalanceSyncs` in `src/crypto-sync/sync.ts:130-153` (check-and-set synchronously before any `await`; release in `run.then(release, release)` guarding `get(key) === run`). This is the "BUG1/R1" per-account single-flight extension the brief names; read `crypto-sync/sync.ts:106-153` and mirror it.
- Because the key must be known synchronously, `runSync` resolves the target account id from `overrides.targetAccountId` directly (every fan-out job now passes one — Task 3.2). A no-`targetAccountId` call is only the legacy "the single connected account" path; keep it resolving to `institution:monobank` as a fallback key so behavior is unchanged when exactly one connection exists.
- `resolveMonobankAccountId` (`:314-319`): DELETE the `otherConnected` rejection (`monobankAlreadyConnected`). A `targetAccountId` sync now only validates the target exists and is a bank account. The no-target path keeps `existing = accounts.find(institution === 'monobank')` but returns the FIRST (there may be several — the no-target path is now only used by legacy callers; prefer always passing a target).
- The progress-session begin/reset and `fastPhaseDone` reset (`:912-916`) move to be PER the keyed run (they already live inside `runSync`; keep them there, they are reference-counted across the fan-out — `kiko-architecture` "Three sync signals").

- [ ] **Step 1: Update `sync.test.ts`** to assert: two `runSync({ targetAccountId: 'A' })` and `runSync({ targetAccountId: 'B' })` in flight concurrently do NOT join each other (distinct keys, distinct tokens, distinct gates — safe by the per-token rate limit); two `runSync({ targetAccountId: 'A' })` DO join; `resolveMonobankAccountId` no longer throws `monobankAlreadyConnected` for a second connected account.

- [ ] **Step 2: Run to confirm failure**

Run: `npx jest src/monobank/sync.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** the `Map`-keyed single-flight and the resolver relaxation, mirroring `crypto-sync/sync.ts`.

- [ ] **Step 4: Run to confirm pass**

Run: `npx jest src/monobank/sync.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate + commit**

Run: `npm run check:all && npx jest`
```bash
git add src/monobank/sync.ts src/monobank/sync.test.ts
git commit -m "feat(monobank): per-account single-flight join and multi-connection resolver"
```

### Task 3.2: Fan out `syncJobsFor` over every connected Monobank account

**Files:**
- Modify: `src/sync/sync-jobs.ts`
- Modify: `src/sync/use-auto-sync.ts`, `src/sync/use-sync-all.ts` (callers already iterate `connectedAccounts`; confirm they pass ALL monobank accounts, not `.find`)
- Modify: `src/sync/sync-jobs.test.ts`, `src/sync/use-auto-sync.test.ts`, `src/sync/use-sync-all.test.ts`

**Interfaces:**
- `syncJobsFor(account)` for `institution === 'monobank'` returns `[{ name: account.name, run: () => runSync({ targetAccountId: account.id }) }]` (was `runSync({})` at `sync-jobs.ts:30`). Now each Monobank account gets its OWN job keyed to its own token + cursor + single-flight.
- The per-account token gate: `useAutoSync` currently drops the Monobank job when no global token is stored (`:71`). With per-account tokens this gate must be per account. Option chosen: make the gate async per account in `useAutoSync` — build the job list with `await Promise.all(connectedAccounts.map(async a => a.institution === 'monobank' && !(await hasToken(a.id)) ? [] : syncJobsFor(a)))`. `useSyncAll` (pull) does not pre-gate (a tokenless connected Monobank job throws and is reported as a failure, which is acceptable and already the partial-failure contract); keep `useSyncAll` fanning out over all accounts unchanged.

- [ ] **Step 1: Update tests.** `sync-jobs.test.ts`: a monobank account yields a job that calls `runSync({ targetAccountId: id })`. `use-auto-sync.test.ts`: two connected Monobank accounts with tokens yield two jobs; one without a token is dropped; crypto accounts still included. `use-sync-all.test.ts`: fan-out covers every connected Monobank + crypto account.

- [ ] **Step 2: Run to confirm failure**

Run: `npx jest src/sync`
Expected: FAIL.

- [ ] **Step 3: Implement** the `targetAccountId` job and the per-account token gate.

- [ ] **Step 4: Run to confirm pass**

Run: `npx jest src/sync`
Expected: PASS.

- [ ] **Step 5: Gate + commit**

Run: `npm run check:all && npx jest`
```bash
git add src/sync
git commit -m "feat(sync): fan out over every connected Monobank account with its own token"
```

---

## Phase 4 — Monobank multi-connection UI + i18n

### Task 4.1: Remove the single-connection gate from account-detail; per-account connect copy

**Files:**
- Modify: `src/screens/account-detail/account-detail.screen.tsx`
- Modify: `src/i18n/locales/en.ts`, `src/i18n/locales/uk.ts`
- Test: the account-detail component test (if present) + `src/i18n/locales/en.uk.parity.test.ts` (must stay green)

**Interfaces:**
- Delete `otherAccountConnected` (`:146`), `showConnectedElsewhereHint` (`:216`), and the `connectedElsewhere` hint render (`:314-317`). `showActionButton` (`:214`) becomes `isBankAccount && (isConnectedToMonobank || true)` → simply `isBankAccount` for the connect/sync affordance; each bank account shows Connect independently.
- `connectedAccounts` live query (`:94`) is no longer needed for the gate; remove it if nothing else uses it (check for other readers first).
- i18n: the keys `accountDetail.connectedElsewhere` (`en.ts:243`) and `accountDetail.monobankAlreadyConnected` (`:266`) lose their only readers. Remove BOTH from `en.ts` AND `uk.ts` together (parity test enforces identical key sets). Also remove `accountDetail.sourceConnectedElsewhere` (`:280`) once Phase 5 removes its crypto reader — defer that deletion to Task 5.2 so each phase stays green. `Connect Monobank` copy is fine as-is; no new Monobank string is strictly required.

- [ ] **Step 1: Update the account-detail test** (or add one) asserting two bank accounts both render the Connect button with no "connected elsewhere" hint.

- [ ] **Step 2: Run to confirm failure**

Run: `npx jest src/screens/account-detail`
Expected: FAIL (hint still present / gate still there).

- [ ] **Step 3: Implement** the gate removal and delete the two now-readerless i18n keys from BOTH catalogues.

- [ ] **Step 4: Run the parity test + component test**

Run: `npx jest src/i18n/locales/en.uk.parity.test.ts src/screens/account-detail`
Expected: PASS.

- [ ] **Step 5: Gate + commit**

Run: `npm run check:all && npx jest`
```bash
git add src/screens/account-detail/account-detail.screen.tsx src/i18n/locales
git commit -m "feat(ui): allow connecting multiple Monobank accounts independently"
```

---

## Phase 5 — Per-account Binance credentials + multi crypto connections

### Task 5.1: Key Binance credentials by account id + crash-safe migration

**Files:**
- Modify: `src/crypto-sync/binance/binance.credentials.ts`
- Create: `src/crypto-sync/binance/migrate-binance-credential.ts` (+ test)
- Test: `src/crypto-sync/binance/binance.credentials.test.ts`
- Modify: `src/migration/migrations.gate.tsx`, `src/crypto-sync/binance/binance.provider.ts` (wherever `readCredentials` is called — it needs the account id), `src/crypto-sync/disconnect.ts`

**Interfaces:**
- `serviceFor(accountId)` → `` `kiko.binance.credentials.${accountId}` ``; `save/read/clearCredentials` take `accountId`. Preserve the `HARDENED` options and the JSON-shape validation (`isCredentials`). The one-time `hasRepairedAccessPolicy` re-save latch (`:40,77`) stays but is now per-process and account-agnostic (it only upgrades access policy; keep its behavior).
- `migrateBinanceCredentialToPerAccount(connectedBinanceAccountId: string | undefined)` — identical crash-safe ordering to Task 2.1 (write per-account, verify read-back, delete global last; gate on the global item's PRESENCE; idempotent).
- `binanceProvider.fetchBalances` and `syncBinanceTransactions` read credentials — thread the target `accountId` (available as `SyncTarget.accountId` / the request's `targetAccountId`) into `readCredentials(accountId)`. Read `binance.provider.ts`/`binance.transactions.ts` for the exact call sites.
- `disconnectCryptoAccount(accountId, 'binance')` clears `clearCredentials(accountId)`.

- [ ] **Step 1: Write failing tests** mirroring Task 2.1 for Binance (isolation between two account ids, idempotent + crash-safe migration, gate on presence).

- [ ] **Step 2: Run to confirm failure**

Run: `npx jest src/crypto-sync/binance/binance.credentials.test.ts src/crypto-sync/binance/migrate-binance-credential.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** the account-keyed credential functions, the migration, the boot-chain wiring (after the Monobank credential migration), and the `accountId`-threaded `readCredentials` call sites.

- [ ] **Step 4: Run to confirm pass**

Run: `npx jest src/crypto-sync`
Expected: PASS.

- [ ] **Step 5: Gate + commit**

Run: `npm run check:all && npx jest`
```bash
git add src/crypto-sync src/migration/migrations.gate.tsx
git commit -m "feat(binance): per-account credentials Keychain service + crash-safe migration"
```

### Task 5.2: Relax the crypto one-connection invariant + UI

**Files:**
- Modify: `src/crypto-sync/sync.ts` (`resolveTargetAccount` at `:79-85`)
- Modify: `src/screens/account-detail/crypto-sync-section/crypto-sync-section.component.tsx` (`:57-66`)
- Modify: `src/i18n/locales/en.ts`, `uk.ts` (delete `accountDetail.sourceConnectedElsewhere:280` — now readerless)
- Test: `src/crypto-sync/sync.test.ts`, the crypto-sync-section test, `en.uk.parity.test.ts`

**Interfaces:**
- `resolveTargetAccount`: DELETE the `otherConnected` rejection (`sync.ts:79-85`). A `targetAccountId` sync validates the target exists; multiple `binance` (and multiple `btc_wallet`) connections are now allowed. The per-account single-flight `inFlightBalanceSyncs` already keys by `targetAccountId` (`:137`), so concurrent distinct-account crypto syncs already work — no lock change needed.
- `crypto-sync-section.component.tsx`: remove the `walletAccounts`/`binanceAccounts` "connected elsewhere" gate (`:57-66`); each crypto account connects independently.
- NOTE on BTC wallet: multiple wallets are now supported because the address lives per-holding in `metadata.walletAddress` and there is no secret; only the invariant blocked it. Confirm the wallet connect form writes the address to the NEW account's holding.

- [ ] **Step 1: Update tests** — two Binance accounts resolve without `sourceConnectedElsewhere`; two wallet accounts likewise; the crypto-sync-section renders Connect for each.

- [ ] **Step 2: Run to confirm failure**

Run: `npx jest src/crypto-sync src/screens/account-detail/crypto-sync-section`
Expected: FAIL.

- [ ] **Step 3: Implement** the resolver relaxation, the UI gate removal, and delete the readerless i18n key from BOTH catalogues.

- [ ] **Step 4: Run to confirm pass**

Run: `npx jest src/crypto-sync src/screens/account-detail/crypto-sync-section src/i18n/locales/en.uk.parity.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate + commit**

Run: `npm run check:all && npx jest`
```bash
git add src/crypto-sync/sync.ts src/screens/account-detail/crypto-sync-section src/i18n/locales
git commit -m "feat(crypto): allow multiple Binance and wallet connections"
```

---

## Phase 6 — Namespace synced transaction externalIds per connection (correctness)

**Why last, and conditional:** See Risk R-1. This addresses a cross-connection `(source, external_id)` collision. Gated on the open question about whether we namespace now or defer. If deferred, skip this phase and record the accepted risk in `docs/security/README.md`.

### Task 6.1 (conditional): Namespace `externalId` by account id for synced rows

**Files:**
- Modify: `src/monobank/sync.ts` (`mapStatementItem:239` sets `externalId: item.id`), `src/crypto-sync/binance/binance.transactions.ts` (`deposit:<id>`/`withdraw:<id>`)
- Create: `drizzle/migrations/00NN_namespace_external_ids.sql` (data migration rewriting existing synced rows' `external_id` to include their holding's account id)
- Test: the sync tests + a migration test

**Interfaces:**
- New `externalId` format for synced rows: `` `${accountId}:${sourceId}` `` (Monobank statement id; Binance `deposit:<id>`/`withdraw:<id>`). The `(source, external_id)` unique index (`schema.ts:113`) then cannot collide across connections.
- The backfill migration rewrites every existing `monobank`/`binance` transaction's `external_id` to the namespaced form, derived by joining `transactions.holding_id → holdings.account_id`. Idempotent: only rewrite rows whose `external_id` does not already contain the account-id prefix.

- [ ] **Step 1–5:** TDD as above — failing test asserting two connections with the same raw statement id import two distinct rows; implement the namespaced key + the idempotent backfill; gate + commit. (Full steps mirror Phase 1 Task structure.)

---

## Security review hooks (for the `auditor`, run before done)

Call these out explicitly in the review request:

1. **Keychain access control unchanged.** Every per-account item must keep `ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY` and NO `accessControl` (no per-item biometric prompt — it would break silent auto-sync). Verify `token.ts`/`binance.credentials.ts` `HARDENED` options are reused verbatim, only `service` changes.
2. **Credential isolation between connections.** Verify `readToken(A)` / `readCredentials(A)` can never return connection B's secret — the service string must include the account id on EVERY read and write. Grep for any stray no-argument `readToken()` / `readCredentials()` left behind.
3. **No secret to DB or logs.** `sync_state` holds cursors only — never a token. Confirm no token/credential is written to `holdings.metadata`, `settings`, `sync_state`, or any `console.*`. Grep the diff for the token/secret variable names near `console`.
4. **Migration never strands a secret.** Verify the crash-safe ordering (write-verify-then-delete, gate on presence) in `migrate-credential.ts` and the Binance equivalent; a crash before the global delete must leave a recoverable state, never a lost token.
5. **Semgrep mobile rules.** Run `npm run check:rules` (the `rules/semgrep-mobile.yml` fixtures — Keychain/App-Group/secret-in-state rules) and `npm run check:security`. Confirm the new Keychain call sites match the approved patterns in `rules/fixtures/`.
6. **External-id collision (R-1).** If Phase 6 is deferred, the auditor must confirm the accepted-risk note is recorded and that Monobank statement ids are in fact globally unique (they are) while Binance record ids are per-account (they are NOT globally unique — this is the real exposure).

---

## Risks & Open Questions for the user (bring these BEFORE implementation)

- **R-1 / Q-1 — Cross-connection `externalId` collision.** `(source, external_id)` is a GLOBAL unique index (`schema.ts:113`). Monobank statement ids are globally unique, so two Monobank connections are safe. But Binance deposit/withdrawal record ids are PER-ACCOUNT sequences — two Binance connections could emit the same `deposit:<id>`, and the upsert would refresh the wrong holding's row (a real correctness bug). **Do we namespace synced externalIds by account id now (Phase 6, includes a backfill migration of existing rows) or accept the risk until a second Binance account is actually added?**
- **Q-2 — Per-connection display names / labels.** Two "Monobank" accounts and two "Binance" accounts will look identical in lists. **Do we let the user label each connection (free-text account name is already editable), and should Connect prompt for a name, or is the existing account name enough?**
- **Q-3 — Providers that genuinely allow only one credential.** Is there any provider we must CAP at one connection (regulatory or API-key scope), or is N-per-provider acceptable for all three (Monobank, Binance, BTC wallet)?
- **Q-4 — Holdings when a connection is removed.** Today disconnect KEEPS the holdings (clears `institution`, turns them manual, preserves `walletAddress`/`binanceAsset` for re-adopt — `accounts.repo.ts:143`, `disconnect.ts`). With multiple connections, **should disconnecting one connection still keep its holdings as manual, or offer to delete them?** (Recommended: keep current behavior — it is crash-safe and reversible — but confirm.)
- **Q-5 — Concurrency vs. battery/rate on fan-out.** N Monobank tokens can sync concurrently (distinct rate-limit buckets). **Is unbounded concurrency across connections acceptable, or do we cap parallelism (e.g. 2) to limit device load on an open with many connections?** (`Promise.allSettled` over all jobs is the current shape.)
- **Q-6 — Migration binding for an existing user.** The single global token migrates to the ONE currently-connected Monobank account. **Is there any scenario where a user has a global token stored but NO connected Monobank account (e.g. mid-connect crash)?** If so, the token cannot be auto-bound — we leave the global item for manual re-entry. Confirm that is acceptable.
- **Q-7 — BTC wallet multi-connection.** Multiple wallets work once the invariant relaxes (address is public, per-holding). **Confirm the user wants multiple independent wallet accounts too, not just bank/Binance.**

---

## Self-Review

- **Spec coverage:** Keychain scheme (Phase 2/5 Task x.1) ✓; data model + migration shape (Phase 1) ✓; sync fan-out reusing the per-account single-flight join (Phase 3 Task 3.1, mirroring `inFlightBalanceSyncs`) ✓; UI add/list/remove reusing `MonobankTokenInput` + syncable forms (Phase 4, Phase 5 Task 5.2) ✓; crash-safe idempotent migration with exact ordering (Task 2.1 Step 3) ✓; security review hooks ✓; phasing with per-task green gates ✓; risks/open questions ✓.
- **Type consistency:** `serviceFor(accountId)`, `readToken(accountId)`, `readCredentials(accountId)`, `syncStateRepo.setLastSyncAt(accountId, timestamp)`, `runSync({ targetAccountId })`, `inFlightSyncs: Map<string, Promise<SyncResult>>` — used consistently across tasks.
- **Placeholder scan:** no TBD/TODO; every schema column, function signature, and migration SQL shape is concrete. Enum/column lists defer to `schema.ts`/`settings.repo.ts` as the drift-prone source of truth per Layer-2 discipline, as the skills require.
