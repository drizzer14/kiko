---
name: kiko-architecture
description: Invoke whenever you touch storage, a repository, a screen's data hook, migrations, or the Monobank sync pipeline. Read before writing any op-sqlite/Drizzle code, any db.transaction call, any useLiveQuery consumer, or any code that reads the Monobank API or the Keychain token.
---

# Kiko architecture

Source of truth: `docs/superpowers/specs/2026-08-30-kiko-foundation-design.md`
("Storage and migrations", "Data flow — reactive queries", "Data
collection" sections). This skill summarizes the settled contract.

## Storage: op-sqlite + Drizzle

- `@op-engineering/op-sqlite` (^18.1.4) is the SQLite engine.
  `drizzle-orm` (^0.45.2) is the ORM on top of it: open the database
  with op-sqlite's `open()`, wrap it with `drizzle(opsqliteDb)`.
- The schema is defined in TypeScript (Drizzle schema, not raw SQL).
- Generate migrations with `drizzle-kit` using `driver: 'expo'` —
  this is the correct driver value for op-sqlite migration
  generation, despite the name.
- `npx drizzle-kit generate --name <slug>` writes the `.sql`, the
  `meta/NNNN_snapshot.json` and the journal entry — and it also
  REWRITES `drizzle/migrations/migrations.js` wholesale, in its own
  formatting (verified: it clobbered the repo's import/export layout
  and dropped a comma-per-line style). Re-check that file after every
  generate, and run `npx biome check --write` over the generated
  artifacts: the snapshot and journal JSON are lint-checked like any
  other file.
- Bundle migrations into the app and apply them on launch through
  `src/db/run-migrations.ts` — NOT drizzle's own
  `drizzle-orm/op-sqlite/migrator` + `useMigrations`, which misreads
  op-sqlite 18's raw-row shape and re-runs every migration on each
  launch (read that file's header). This custom count-based runner
  applies `journal.entries.slice(COUNT(*))` in idx order (`SELECT
  COUNT(*)` from `__drizzle_migrations`, then apply the remaining
  entries by idx) and stores `when` as `created_at` bookkeeping only —
  it never reads `when` to decide what to apply. So journal `when`
  order is NOT load-bearing: a non-monotonic `when` across worktrees is
  harmless (main itself carries a pre-existing 0006/0007 `when`
  disorder). `src/db/migrations.gate.tsx` owns the launch UI: a loading
  state until migrations succeed and an error state if they fail —
  never proceed past a failed migration.

## Hard rule: every write goes through `db.transaction()`

op-sqlite's reactive queries (`db.reactiveExecute`) fire their
callback **only** when the write that changed the underlying table
ran inside a `db.transaction()` call. A write issued outside a
transaction is invisible to every live query watching that table —
the UI will silently go stale.

This is non-negotiable: **every** insert, update, and delete —
including a single-statement one — must be wrapped in
`db.transaction()`. There is no exception for "it's just one
statement."

## The `useLiveQuery` pattern

Drizzle's own `useLiveQuery` hook only supports `expo-sqlite`, not
`op-sqlite`, so this project has a custom hook built directly on
op-sqlite's reactive primitive:

```ts
useLiveQuery(drizzleQuery, tables)
```

It:

1. Calls `drizzleQuery.toSQL()` to get `{ sql, params }`.
2. Registers `db.reactiveExecute({ query, arguments, fireOn: tables,
   callback })`.
3. Maps the raw rows back to the typed result shape Drizzle would
   have produced.
4. Unsubscribes on unmount.

`tables` is the list of table names the query depends on (matching
`fireOn`) — get this list wrong and the query either never refreshes
or refreshes on unrelated writes.

## Repository module shape

One functional module per entity: `accountsRepo`, `holdingsRepo`,
`transactionsRepo`, `ratesRepo`, `settingsRepo`. A repository is a
plain module of exported functions, not a class.

- **Read functions return a Drizzle query builder**, not already-
  executed data — the caller passes that query straight into
  `useLiveQuery`. Do not `await` or `.execute()` a read function's
  result inside the repository; that would make it non-reactive.
- **Write functions perform the actual transactional write** and
  return once it's durable — every write function body is (or calls
  into) a `db.transaction()` call, per the hard rule above.
- Repositories are the only place raw Drizzle rows are converted
  to/from domain types (e.g. `balanceMinorUnits` -> `Money`,
  see `kiko-domain`).
- A full-list `sortOrder` rewrite (persisting a drag-and-drop reorder)
  is one `db.transaction()` wrapping a loop that updates every row's
  `sortOrder` to its new index — see `accounts.repo.ts`'s `reorder()`
  for the canonical shape. Do not write each row's `sortOrder` in its
  own separate transaction; a partial write would leave the stored
  order inconsistent with what the grid showed.

## Monobank sync pipeline (functional)

The sync pipeline is deliberately functional, not OOP — see
`kiko-code-style` for when each style applies.

1. Read the personal token from the iOS Keychain via
   `react-native-keychain`. **Never** store the token in the
   database or write it to a log — Settings holds `baseCurrency` and
   `lastSyncAt` only, not the token.
2. `GET /personal/client-info` with header `X-Token`; map each bank
   account and jar to a Holding under one `monobank` Account. On a
   Connect, `runSync` (`src/monobank/sync.ts`) marks the target
   account `institution: 'monobank'` only AFTER this call resolves —
   `resolveMonobankAccountId` (read-only: validates the
   one-connection-per-institution invariant) runs first, then
   `fetchClientInfo`, then `markMonobankAccount` writes the mark. A
   wrong token, an offline device or a 429 must never leave the
   account half-connected; mirrors `crypto-sync/sync.ts`'s
   `runBalanceSync` ordering. `runSync` does not create the settings
   row itself — the single settings row is guaranteed to exist by the
   app-boot migrations gate (`src/db/migrations.gate.tsx`) before any
   sync can run.
3. `GET /personal/statement/{account}/{from}/{to}` per holding;
   import each item as a Transaction, UPSERTED on
   `(source, externalId)` — the Monobank statement id — by
   `addManyDedup` (`src/repositories/transactions.repo.ts`). Two
   things about that upsert are load-bearing, both verified there
   rather than restated as a column list here:
   - Re-syncing an existing external id **refreshes** the row's
     bank-owned columns (the settled amount and `hold` among them)
     and **never** its `category` or `comment` — the category may be
     the user's own override or a name-rule rewrite. Read
     `addManyDedup`'s `onConflictDoUpdate` set for the exact
     refreshable columns, and `transactions.hold` in
     `src/db/schema.ts` for why a pending item is imported at all.
   - The pipeline holds no JS-side "already imported" filter. One
     existed and was the bug: it dropped a re-fetched item before the
     database ever saw it, so a `hold: true` authorization's
     provisional amount could never be refreshed to its settled
     value. The duplicate is resolved in SQL, which is also what
     makes the refresh atomic.

   Respect the API's per-request constraints — a 31-day-max statement
   window and at most 500 items per response — by paging the window
   (see `fetchAllStatements` in `src/monobank/sync.ts` for the paging
   shape). The rate limit is *not* handled here — see "The rate limit
   is per TOKEN" below.
4. Map Monobank's ISO 4217 numeric currency codes to the app's
   currency literal with `ts-pattern` (see `kiko-domain`). Amounts
   and balances already arrive in integer minor units — no float
   conversion needed there.

   A card/jar whose currency code `currencyFromCode` cannot map is
   SILENTLY SKIPPED (`upsertAllHoldings` in `src/monobank/sync.ts`)
   rather than thrown — the mapper still throws for every OTHER
   caller, but `upsertAllHoldings` checks `currencyFromCode` first and
   skips an unrepresentable account/jar instead of calling the mapper.
   `upsertAllHoldings` collects every representable card/jar and writes
   them in ONE batched transaction (`holdingsRepo.upsertMonobankMany`),
   so op-sqlite fires the reactive `holdings` callback ONCE for the fast
   phase — not once per card. The per-card write loop it replaced fanned
   out N+M reactive fires in a tight burst at sync start, each re-running
   the Home screen's O(n) render and starving the JS thread (the laggy
   pull spinner). This used to throw outside the per-card try/catch and
   abort the whole sync on one foreign-currency sub-account; now every
   other, representable card still imports and the cursor still
   advances. The trade-off: an unrepresentable-currency holding is
   excluded from net worth. Each skip logs via `console.warn` behind a
   justified `biome-ignore lint/suspicious/noConsole: OVERRIDE(diagnostic)`
   — Biome's `noConsole` is otherwise `error` project-wide (`biome.json`),
   so this is the one sanctioned console call in the app.
5. The pipeline is a straight sequence of small transforms, not an
   `fnts` composition: map each fetched item to a row, fold duplicate
   conflict keys, hand the batch to the repository's upsert. The
   `pipe` that used to live here was removed with the JS-side dedup
   filter it wrapped (see step 3) — read `src/monobank/sync.ts` end
   to end for the current shape rather than assuming a composition
   chain.

Confirm exact Monobank field names against the live API during
implementation — the spec's shape is a best-effort description, not
a verified schema.

### Balance-diff skip

`runSyncInner` (`src/monobank/sync.ts`) no longer fetches every
card's statements on every run — a multi-card account synced over
minutes under the per-invocation gate alone. It now SKIPS the
statement fetch for a card whose `/personal/client-info` balance is
unchanged since its statements were last imported (`isBalanceDiffSkip`).

The prior balance is read from the CRASH-SAFE marker
`holdings.syncedBalanceMinorUnits` (migration `0024`, schema in
`src/db/schema.ts`), **not** `holdings.balanceMinorUnits`. This is
load-bearing and was a data-loss bug before: `upsertAllHoldings` overwrites
`balanceMinorUnits` (the display balance) from client-info at the START
of every run, BEFORE the per-card statement loop. A run that committed a
card's new balance up front and was then interrupted (app background/kill)
before importing that card's statements — and before the failed-set
persist — left `balanceMinorUnits` == client-info, so a display-balance
comparison skipped the card on every later run and its transactions never
imported until the 24h full fetch. `syncedBalanceMinorUnits` advances ONLY
after a card's statements commit (`deps.setSyncedBalance` in the per-card
loop, `holdingsRepo.setSyncedBalance`), so an interrupted card's marker
stays behind and the next run re-imports it. A NULL marker (a fresh column
on upgrade, or a never-imported holding) never equals a balance, so the
first post-upgrade sync fetches every Monobank card once — which also
RECOVERS any card the old bug had stranded — then sets the marker. The
column is deliberately NOT backfilled to `balanceMinorUnits`: that would
re-hide a currently-stranded card.

Two carve-outs keep the skip safe, read the code rather than trusting
a restated list:

- A card carrying an outstanding `hold: true` transaction is ALWAYS
  fetched (a same-amount hold->settled refresh doesn't move the
  balance) — the set comes from `holdingIdsWithHoldQuery`
  (`src/repositories/transactions.repo.ts`).
- The first-ever sync fetches every card (`shouldFullFetch`).

Safety net: a new `settings.lastFullSyncAt` column (migration
`0021`, schema in `src/db/schema.ts`) forces a periodic FULL fetch of
every card regardless of balance — `shouldFullFetch` decides when,
against the `FULL_FETCH_INTERVAL_MS` constant in `sync.ts` (read it
there, not restated here). This catches a net-zero same-window
transaction pair (a `+X` and a `-X` that leaves the balance unchanged)
that the skip would otherwise miss forever. Load-bearing: the full
fetch's from-window is derived from `lastFullSyncAt`
(`fromCursorSeconds`), **not** the incremental `lastSyncAt` cursor —
`lastSyncAt` advances on every clean run, including runs that skipped
whole cards, so using it would re-fetch only the recent window and
recover nothing. `lastFullSyncAt` now GRADUATES even on a partial
failure — see "Robust graduation: `failedSyncMonobankIds`" below; this
is a deliberate DIVERGENCE from `lastSyncAt`'s own partial-failure
discipline (see "Partial-progress resilience across cards" below), not
a copy of it.

Migration `0021` adds `lastFullSyncAt` as NULL with no backfill, which
would otherwise force every already-synced user into one slow,
full-every-card fetch on their very next sync. Migration `0022`
(`drizzle/migrations/0022_backfill_last_full_sync_at.sql`) is a
data-only follow-up (no schema change, no snapshot — same class as
`0014_lowercase_categories.sql`) that backfills
`settings.lastFullSyncAt = settings.lastSyncAt` for a user who already
has a non-null sync cursor, so they land straight on the fast
balance-diff path; read the migration file for its exact guard rather
than restating it here.

This does not add a per-card cursor — see the note at the end of
"Partial-progress resilience across cards": `lastFullSyncAt` is a
single global full-fetch marker, not a per-card one.

### Statement queue priority AND per-card from-window

The serial per-card statement loop is gated at one card per ~60s (the
per-token rate limit), and `upsertAllHoldings` writes every card's
DISPLAY balance up front at t0. Two consequences fixed a
missing-today-transaction bug where a monthly-updating card that is
LATE in client-info order dropped a real transaction:

- **Changed-first queue order** (`orderStatementQueue`,
  `src/monobank/sync.ts`). `runSyncInner` STABLE-sorts the accounts
  before the loop into three groups: (0) a card whose /client-info
  balance differs from its PRIOR STORED balance
  (`priorHoldingByMonobankId`, captured BEFORE the up-front upsert),
  (1) a card with an outstanding hold or in the force-retry set, (2)
  the rest. So a genuinely-active card imports in the FIRST 60s slot
  even when it sits last in client-info order, and an interrupted run
  (app background/kill partway through the loop) no longer starves it.
  The priority signal is deliberately the prior STORED balance, NOT the
  crash-safe marker — the marker is NULL for every card on the recovery
  build, so it cannot discriminate there, whereas the stored display
  balance still moves. This changes only the ORDER; `isBalanceDiffSkip`
  still decides WHICH cards are fetched, unchanged, inside the loop.
- **Per-card from-window** (`fromSecondsForCard`, `src/monobank/sync.ts`).
  The from-cursor is now computed PER CARD, not once for the whole run.
  A card whose marker is NULL or BEHIND its /client-info balance
  (unimported activity, or the recovery build) — or any card on a full
  fetch — widens back to the `lastFullSyncAt` cursor, re-covering a
  transaction older than the incremental `lastSyncAt` (which advances on
  every clean run, including runs that skip whole cards, so a stranded
  older transaction sits behind it). A normally-in-sync card
  (marker == balance) keeps the narrow `lastSyncAt` cursor. Both cases
  route through the shared `fromCursorSeconds` (its null-cursor fallback
  to `DEFAULT_LOOKBACK_SECONDS` is unchanged), so a full fetch still
  widens to `lastFullSyncAt` for every card exactly as before.

This fix carries NO data backfill: marking the just-changed card
synced-through-its-new-balance (a backfill) would SKIP its unimported
transaction. The recovery re-fetch (a NULL marker fetches every card
once) is the deliberate one-time cost that recovers stranded cards —
read `runSyncInner` end to end rather than trusting a restated shape.

### Robust graduation: `failedSyncMonobankIds`

Before this, `lastFullSyncAt` (above) graduated **only** on a fully
clean full-fetch run. That made ONE persistently flaky card starve the
periodic safety net forever: `lastFullSyncAt` froze, `shouldFullFetch`
kept returning true past `FULL_FETCH_INTERVAL_MS`, and every run became
a full N×60s fetch of every card — the balance-diff skip never got a
chance to engage again.

The fix is `settings.failedSyncMonobankIds` (migration `0023`, schema
in `src/db/schema.ts`): a persisted set of Monobank account ids whose
statement fetch FAILED on the last run. The next run force-fetches
exactly those ids regardless of balance — the same carve-out shape as
the outstanding-hold case in "Balance-diff skip" above — while
`lastFullSyncAt` now graduates even when this run had a partial
failure, as long as it was a full fetch. A card is dropped from the set
the moment it succeeds, and the set is pruned to ids still present in
client-info (so a removed card is not force-fetched forever). Read
`nextFailedSet` and `isBalanceDiffSkip` (`src/monobank/sync.ts`) for
the exact set algebra rather than a restated one here.

This is a genuine divergence, not a relaxation of the existing
discipline: the statement CURSOR (`settings.lastSyncAt`) still advances
**only** on a fully clean run (unchanged "Partial-progress resilience
across cards" behavior below), so a force-fetched card's window is
re-derived from that un-advanced cursor and re-covered idempotently
(the `(source, external_id)` upsert). Only the full-fetch MARKER now
graduates early — the thing that was starving, not the thing that
protects against data loss. Read the end-of-run sequence in
`runSyncInner` (`src/monobank/sync.ts`) for the exact ordering: the
failed-set persist and the `lastFullSyncAt` stamp both happen BEFORE
the partial-failure throw.

`runSyncInner` also emits one diagnostic per run —
`console.warn('[monobank sync] done', {isFullFetch, cards, fetched,
skipped, failures, elapsedMs})`, behind a justified `noConsole`
OVERRIDE — so a dev can tell from a device log whether a run is
actually taking the fast balance-diff path or is stuck in full-fetch
mode. This is in addition to, not a replacement for, the
unrepresentable-currency skip warn in "Map Monobank's ISO 4217..."
above.

### The rate limit is per TOKEN, not per call site

Monobank's personal API allows one request per interval **per
token**, so the throttle cannot live inside any single request
helper. `src/monobank/throttle.ts` owns it: `createRequestGate`
returns a one-slot gate whose `wait()` resolves immediately the first
time and thereafter only once the interval has elapsed since the
previous resolution. Read that file for the interval and the gate's
exact semantics rather than trusting a number restated here.

`runSync` (`src/monobank/sync.ts`) creates **exactly one** gate per
invocation and threads it through **every** request that invocation
makes — `fetchClientInfo` first, then each card's statement pages via
`importAccount` -> `fetchAllStatements`. A gate scoped any narrower
is a bug, not an optimization: when the throttle was a local
first-request flag inside one `fetchAllStatements` call, the second
card's opening request fired with zero delay, Monobank returned 429,
the error escaped `runSync` before `setLastSyncAt`, and no card after
the first ever imported.

The gate is deliberately **not** a `SyncDeps` seam. It is built from
the already-injectable `now`/`sleep` deps, so a test controls it
without a new seam — and a `gate` dep would let a test share one gate
across two `runSync` calls, defeating the per-invocation scoping.

### Two complementary rate-limit invariants: the gate AND the single-flight lock

The per-invocation gate above paces requests **within** one run. It is
NOT enough on its own: the rate limit is per token, and all three sync
entry points drive the same connected token —

- `useAutoSync` (`src/screens/use-auto-sync.ts`) on app open,
- `useSyncAll` (`src/screens/use-sync-all.ts`) on pull-to-refresh,
- `useSync` (`src/screens/use-sync.ts`) on the manual button —

`useAutoSync` and `useSyncAll` share ONE fan-out job builder
(`syncJobsFor`, `src/screens/sync-jobs.ts`), so the app-open sync drives
EXACTLY the pull-to-refresh set — the connected Monobank account (only
when a token is stored) PLUS every connected crypto account — under
`Promise.allSettled`. So a crypto balance + Binance transaction import
now happens on app open, not only on pull. `useAutoSync` is throttled by
`throttleElapsed(settings.lastSyncAt)` and never touches the pull spinner
signal (it reads no `fastPhaseDone`), so an app-open sync drives only the
determinate progress bar.

so two of them firing at once produced two concurrent runs, two
independent gates, and colliding 429s (the reported "inconsistent"
sync). `runSync` therefore holds a **module-level single-flight lock**
(`inFlightSync` in `src/monobank/sync.ts`): while a run is in flight,
every new trigger JOINS (awaits) the in-flight promise and observes its
result rather than starting a second run; the lock releases the instant
the run settles (success OR failure). Read `runSync`/`runSyncInner` for
the exact shape rather than trusting a restated one here.

The two invariants are **complementary, not interchangeable** — the
gate throttles requests inside a run; the lock forbids two runs at once.
Do NOT remove or weaken either to "simplify" the other. **Join** (not
queue) semantics are safe because the three triggers are equivalent
syncs of the same token: `useAutoSync`/`useSyncAll` only fire for an
already-connected account, so no run competes with a first-time Connect
(a `targetAccountId` sync), and a re-sync that joins an in-flight run of
the same connected token gets exactly the result it would have computed.

### Three sync signals; the spinner is DECOUPLED from the whole run

`src/monobank/sync-status.ts` holds THREE separate module-level stores.
Do NOT collapse them — each drives a different affordance:

1. `isSyncing` (`useSyncStatus`/`setSyncing`) — the WHOLE-run "a sync is
   running" signal. It now RIDES the progress session (see signal 2):
   `beginProgressSession` lights it on the FIRST contributor and
   `endProgressSession` clears it on the LAST, so it spans the whole
   fan-out — the Monobank `runSync` PLUS any concurrent crypto
   `runBalanceSync` — not the Monobank run alone. A crypto-only fan-out
   (no Monobank run) still lights it. It stays lit across the 60s-gated
   per-card statement loop, so it is still on when the "Last sync" stamp
   lands at the END of `runSyncInner`. `setSyncing` remains the low-level
   primitive the session drives; `runSync` no longer calls it directly.
2. `progress` (`useSyncProgress`/`getProgressSnapshot`/`setSyncProgress`,
   `{ completed, total, workCompleted, workTotal }`) — the determinate
   progress, WEIGHTED BY REAL WORK and DERIVED by a reference-counted
   progress SESSION that spans the whole fan-out. There is NO pre-filled
   baseline (the earlier "start at 2/3" model was REVERSED on device
   feedback: a multi-holding run filled to ~80% instantly). Two quantities:
   - `workCompleted` / `workTotal` drive the bar FILL. `workTotal` is the SUM
     of every syncing holding's work units; `workCompleted` STARTS at 0 and
     rises as work is DONE. Work UNITS: a Monobank CARD in `toFetch` weighs its
     up-front statement-window count (`estimateWindows` = `ceil(span / 31d)`,
     the honest per-page granularity — the 1-req/60s statement fetch dominates
     the run), committed one unit per page then reconciled to the estimate on
     card completion; a CHANGED Monobank jar and each crypto/exchange balance
     fetch weigh ONE unit. A balance-diff-skipped card, an unchanged jar, and
     every manual holding weigh NOTHING.
   - `completed` / `total` count HOLDINGS for the "N/M" label only (holdings
     doing work this run / holdings finished), DECOUPLED from the fill (the
     file-copy pattern: "1 / 2 holdings" can sit at a small fill while a heavy
     card still fetches).
   Each sync path brackets its work with `beginProgressSession()` /
   `endProgressSession()` (first begin resets, last end clears), calls
   `registerWork(holdings, work)` up front, then `commitWork(units)` as it
   fetches and `commitHolding(count)` as each holding finishes — see
   `src/monobank/sync-status.ts`. A path that registers ZERO work publishes
   nothing, so the bar never appears for a run that fetches nothing (the no-op
   guard, spanning the fan-out). There is NO whole-app `countActiveHoldings`
   denominator any more — `total` is the syncing holdings only.

   The WORK sources ("weight by real work", the user's decision; confirm on
   device):
   - a Monobank CARD in `toFetch` (NOT balance-diff-skipped, `selectCardsToFetch`)
     — weight = its statement-window count, committed per page in
     `fetchCardWithProgress` / `fetchAllStatements`'s `onPage` callback;
   - a Monobank JAR whose /client-info balance MOVED since its prior stored
     balance, or a new jar — weight 1, committed at the fast phase (jars have
     no statements; an UNCHANGED jar has no crash-safe marker, so a moved
     balance is its only "changed" signal, `runSyncInner`);
   - every crypto/exchange holding a `runBalanceSync` upserts (Binance
     Spot/Funding/Earn, or a wallet) — a crypto sync has NO balance-diff skip,
     it always reads live balances, so each returned holding is one work unit.
   ZERO work = every MANUAL holding, every balance-diff-skipped card, and every
   unchanged jar.
3. `fastPhaseDone` (`isFastPhaseDone`/`setFastPhaseDone`/`subscribeFastPhase`)
   — a one-shot "balances have landed" signal. `runSyncInner` fires
   `setFastPhaseDone(true)` the instant `upsertAllHoldings` commits the
   client-info balances, LONG before the statement loop finishes.
   `runSync` resets it `false` at run start and clears it on settle. It
   is a plain imperative signal (no React hook): the pull path reads it
   inside an event handler, not during render.

Read `runSync`/`runSyncInner` (`src/monobank/sync.ts`) for the exact
call sites rather than restating the lines here.

The custom `SyncingIndicator` component was REMOVED. There are now TWO
distinct Monobank-sync affordances on Home, DECOUPLED from each other:

1. The native `RefreshControl` spinner — the PULL GESTURE indicator ALONE.
2. A determinate `SyncProgressBar`
   (`src/screens/home/sync-progress-bar/`) — the WHOLE-RUN indicator,
   with a label ("Syncing holdings N/M", i18n key `home.syncingHoldings`,
   counting HOLDINGS) above a WORK-weighted fill (`workCompleted /
   workTotal`); the label and the fill are decoupled — see the `progress`
   store above.

**The spinner is decoupled from the whole run (do NOT re-bind it).**
Binding `RefreshControl.refreshing` to the whole-run `isSyncing` flag
(the design before this decouple) fought iOS across navigation,
window-detach and scroll: the spinner froze, vanished every other Home
navigation, or drew behind the list cells. `useRefreshControlSignal(onRefresh)`
(`src/screens/home/use-refresh-control-signal.ts`) now drives `refreshing`
from a LOCAL pull flag ALONE — no `isSyncing` mirror, no `useFocusEffect`
re-drive:

- It sets the local flag `true` SYNCHRONOUSLY inside the `onRefresh` it
  wraps (before any await), so `refreshing` is already true in the commit
  right after the pull — the native iOS `RefreshControl` retracts on
  finger-release unless `refreshing` is ALREADY true at that commit.
- It ends the spinner when the FAST balance phase resolves — on the
  `fastPhaseDone` signal — NOT on the whole run. This is deliberate: the
  spinner shows a brief native spin while balances load, then hands the
  slow per-card fetch to the progress bar. (An earlier R6-3 revision
  ended the whole-run SIGNAL early and was reverted as R7; that concern
  does not apply here — `isSyncing` still tracks the whole run and drives
  the progress bar, so activity stays visible until "Last sync" lands.
  Only the SPINNER ends early, by design.)
- The flag clears on the FIRST of `fastPhaseDone` OR the run settling
  (`onRefresh`'s `.finally`). The settle path is the fallback for a
  fan-out with NO Monobank job (a crypto-only account, or no syncable
  account — see `src/screens/use-sync-all.ts`), which fires no
  `fastPhaseDone`, so the spinner can never hang. A pull that JOINS a run
  whose fast phase already committed clears immediately.
- The `fastPhaseDone` signal is read only inside the pull handler, so an
  auto-sync-on-open (same signal, NO pull) never lights the spinner — it
  drives only the progress bar.

The hook's behavior is unit-tested in isolation
(`use-refresh-control-signal.test.tsx`); the native spin itself is not.

`SyncProgressBar` is the WHOLE-RUN indicator, driven by `isSyncing` +
`useSyncProgress` (never `fastPhaseDone`), so it tracks every trigger —
a pull, the manual button, and an auto-sync-on-open — across the whole
fan-out (the Monobank run AND every connected crypto account; a
crypto-only fan-out lights it too, since `isSyncing` now rides the
session). It is PINNED above
the `SectionList` in `home.screen.tsx`, OUTSIDE the scroll content —
NOT a `ListHeaderComponent`. As the header it scrolled away and drew
behind the cells; pinning it above the list keeps it in view for the
whole run and removes the z-index symptom by construction. It renders a
reanimated fill that creeps toward the next step so a card's multi-page
fetch does not look frozen (per-card is the honest granularity) and
hides when `!isSyncing || total <= 0`. Statistics does NOT render the
bar — it lists no transactions, only charts.

### Partial-progress resilience across cards

`runSync`'s per-card import loop is **fault-isolated**: one card's
transient failure (a 429/timeout) no longer aborts the whole run —
every other card still imports (each `importAccount` -> `addTransactions`
is its own `db.transaction()`, so a completed card's rows are durable
regardless). The shared `settings.lastSyncAt` cursor advances **only on
a fully clean run**; on a partial failure it stays put and `runSync`
re-throws, so the failed card's window is re-covered next time. A
re-fetch is idempotent (the `(source, external_id)` upsert refreshes
rather than duplicates), so nothing already imported is lost or
re-imported. Kiko has no per-CARD cursor — that would need a schema
change — so a partial failure does re-fetch the cards that already
finished; the dedup layer keeps that correct, only slower.

## DB encryption + flag gate

The SQLCipher database-encryption migration (cluster 2) is flag-gated
off by default. Read these files directly rather than trusting a
restated summary here, since the flag values and the migration's exact
steps are the kind of thing that changes as the rollout progresses:

- `src/db/db-config.ts` — `DB_ENCRYPTION_ENABLED` and
  `APP_LOCK_ENABLED`, the two master switches. Read the comment above
  each for what stays inert while its flag is off.
- `src/db/encrypted-database.ts` — `openEncryptedDatabase()`, the
  one-time plaintext -> SQLCipher export. Its crash-safety ordering is
  the load-bearing fact: export first, persist the key second, delete
  the plaintext file last — a crash at any point leaves a resumable
  state rather than data loss.
- `src/db/keys/db-key.ts` — the Keychain-backed SQLCipher key (service
  `'kiko.db.key'`), generated from SQLite's `randomblob()` rather than
  `Math.random` or a WebCrypto call Hermes doesn't have.
- `src/db/client.ts` — the lazy `rawDatabase` Proxy (the connection
  can't open at module load anymore, since the Keychain read is async)
  and `initDatabase()`/`openConnection()`, gated on
  `DB_ENCRYPTION_ENABLED`. Also documents a drizzle/op-sqlite
  `executeRawAsync` shape landmine — read that file's comment on
  `DrizzleOPSQLiteClient`/`wrapClientForDrizzle` before touching the
  read path.
- `src/db/migrations.gate.tsx` — the launch sequencing: `initDatabase()`
  -> `runMigrations()` -> `settingsRepo.ensure()` -> the module-level
  `applyPersistedLanguage()` helper (reads `settings.language` through
  the repo and calls `i18n.changeLanguage`, swallowing a failure — a
  language preference is cosmetic and must never block boot) ->
  `migrateLegacyToken()`. The settings row must exist before
  `applyPersistedLanguage` or `LockGate` (`lockEnabled`) reads it, which
  is why `ensure()` is awaited in the chain rather than fire-and-forget
  from `AppRoot`. Applying the persisted language here — before the
  gate's own first paint — is what makes the lock screen (and the
  "Preparing database…" text/background itself) render in the user's
  chosen language on a cold launch, not the device language.
  `useSyncLanguageWithSettings` (mounted from `AppRoot`, after both
  gates) only covers a LIVE switch from the Settings screen. The app is
  dark-only — `UIUserInterfaceStyle = Dark` is pinned in
  `ios/Kiko/Info.plist`, so there is no appearance to apply here at
  all; `settings.appearance` is a retained-but-dead schema column (see
  `kiko-domain`'s "App lock / security settings").

## Spending-exclusion pipeline

A transaction that is really an internal money movement (a cash-out,
an own-account transfer, one leg of a same-user transfer) must not
count as spending on the category chart. Two files own this, read
them directly rather than restating their exact MCC/matching logic
here:

- `src/statistics/transfer-exclusion.ts` — the MCC/description-based
  rule (own-IBAN-aware; backed by `transactions.counterIban` and
  `settings.defaultCategoryKey`).
- `src/statistics/internal-transfers.ts` — the matched-pair fallback
  for transfers the MCC rule can't see (paired by amount/time/holding).
- `src/statistics/exchange-exclusion.ts` — the Exchange/Convert rule,
  keyed on the structural marker column
  `transactions.exchangeCounterpartHoldingId` (see `src/db/schema.ts`
  and `recordExchange` / `recordExchangeCounterpart` in
  `src/repositories/transactions.repo.ts`, which write it on both legs).
  It catches what the other two structurally cannot: a cross-currency
  pair, and the single debit leg of an exchange into a term deposit.
  The legs persist no description — the label is resolved at render time
  through `t` (`src/transactions/exchange-description.ts`, applied by
  `src/transactions/row-description.ts`), so a marker column and a
  persisted sentence are not interchangeable here. See `kiko-domain`.

## Binance exchange sync — every wallet, three holdings (Spot / Funding / Earn)

`binanceProvider` (`src/crypto-sync/binance/binance.provider.ts`) reads a
user's BTC across ALL of Binance's wallets and writes THREE separate
holdings — Spot, Funding, and Earn (Simple Earn Flexible + Locked
COMBINED into one Earn holding) — each its own `binanceAsset` match key,
NOT one aggregated "Binance BTC" holding (that was the prior model). The
four reads, all signed by the one shared `signedRequest` helper in
`binance.client.ts` (HMAC-SHA256 over the same `timestamp=…&recvWindow=…`
query; read-only key is enough):

| Wallet | Client fn | Method + path | BTC amount |
|---|---|---|---|
| Spot | `fetchAccount` | `GET /api/v3/account` | `free + locked` |
| Funding | `fetchFundingAsset` | `POST /sapi/v1/asset/get-funding-asset` | `free + locked + freeze + withdrawing` |
| Simple Earn Flexible | `fetchFlexiblePosition` | `GET /sapi/v1/simple-earn/flexible/position` | `totalAmount` |
| Simple Earn Locked | `fetchLockedPosition` | `GET /sapi/v1/simple-earn/locked/position` | `amount` |

Load-bearing rules, verified in `binance.provider.test.ts` rather than
restated here:

- **Three holdings, one match key each.** Spot reuses the LEGACY `'BTC'`
  key, Funding is `'BTC:funding'`, Earn is `'BTC:earn'` (stored under
  `metadata.binanceAsset`, matched by `upsertByMetadataKey`). Earn combines
  Simple Earn Flexible + Locked into ONE holding. The keys are asymmetric on
  purpose: see the data transition below.
- **Data transition from the old single holding.** The pre-split model wrote
  one aggregated holding keyed `'BTC'`. Because Spot reuses that same key, the
  first post-split sync UPDATES that existing row IN PLACE into the Spot
  holding (no orphan, no duplicate), while Funding and Earn are created under
  their new keys. The Spot balance carries `renameFromDefault: 'Binance BTC'`
  (the old default name), so the upsert relabels the legacy holding to
  `'Binance Spot'` ONLY IF its name is still that exact default — a user-edited
  name never matches and is preserved. This is the one exception to the upsert's
  name-preserve-on-update rule (`upsertByMetadataKey`); a wallet omits the
  marker and is never renamed.
- **Spot is strict; Funding and Earn are per-holding error-tolerant.** Spot's
  failure fails the whole sync (its balance must be trusted) and Spot is ALWAYS
  written — a genuine zero included — as the connection's anchor. Each other
  wallet runs through `walletSatoshis`, which returns `null` (NOT 0) on a
  missing API-key permission, a throttle, or a malformed body: `appendWallet`
  then OMITS that holding, leaving any existing one at its last-good balance
  rather than clobbering it with a fabricated 0, and logs one `console.warn`
  (behind a justified `noConsole` OVERRIDE). A successful read of 0 writes 0
  ONLY when a holding for that wallet already exists (to zero an emptied
  wallet); an all-zero never-used wallet creates no empty holding. A Spot-only
  key still writes the Spot holding.
- **The Simple Earn position reads MUST paginate, and Earn skips as a whole.**
  The flexible and locked position endpoints are paged (`current` from 1,
  `size` per page capped at 100, response `{ rows, total }`); reading page 1
  alone UNDER-COUNTS a user whose positions span more than one page (locked
  especially — each locked subscription is its own row). `fetchAllPositions`
  in `binance.client.ts` loops `current` until the gathered rows cover `total`
  (short-page and a hard 50-page cap are the backstops). Both Earn reads sit
  inside ONE `walletSatoshis` guard, so a failure on EITHER read (or any page)
  skips the WHOLE Earn holding rather than writing a partial, silently
  under-counted total. The funding read is a full array — NOT paginated. All
  three SAPI reads send `asset=BTC` to shrink the payload.
- **Amounts sum as `Money`, never as floats.** Each decimal-string field
  is converted with `Money.fromMajor('BTC', …)` and added via `sumSatoshis`
  (see `kiko-domain`); a non-finite amount is rejected before it can reach
  the `notNull` satoshi column. Cross-wallet addition is plain integer
  satoshis, so no drift is possible there.

Confirm each Binance endpoint's path, params, and response shape against
the live API (or the official Binance Postman collection / SDK models)
during any change — the field names above (`totalAmount` for flexible,
`amount` for locked, funding's four fields) are the ones the parse keys on.

### Binance transaction history — deposits + withdrawals on the Spot holding

The Binance BALANCE sync (`runBalanceSync`) still writes no transaction
rows — the generic balance sync gives a live number, not a ledger. A
SEPARATE step imports the ledger: `syncBinanceTransactions`
(`src/crypto-sync/binance/binance.transactions.ts`), which
`runCryptoSync`'s Binance arm runs AFTER the balance sync so the Spot
holding already exists. It is SUPPLEMENTARY — the arm captures it in an
`either` and only logs a diagnostic `console.warn` (behind a justified
`noConsole` OVERRIDE) on failure, so a 429 or a permission gap never
fails the balance sync. TRADES are deliberately out of scope for this
milestone; only DEPOSIT and WITHDRAWAL history is imported.

Load-bearing rules, verified in `binance.transactions.test.ts` rather
than restated here:

- **Two signed reads.** `GET /sapi/v1/capital/deposit/hisrec` and
  `GET /sapi/v1/capital/withdraw/history`, both `coin=BTC`, both signed
  by the same `signedRequest` HMAC as the balance reads (read-only key).
  Each client call is ONE offset page of ONE window; the offset-paging
  and the window walk live in `binance.transactions.ts`, not the client.
- **90-day windows, offset paging.** Binance rejects a `startTime`/
  `endTime` span of 90 days or more and caps a page at 1000 rows
  (`HISTORY_PAGE_LIMIT`). The sync walks contiguous 89-day windows and
  offset-pages each window until a short page. `MAX_WINDOWS` /
  `MAX_PAGES_PER_WINDOW` are the loop backstops.
- **Incremental cursor, no schema column.** The window start is derived
  from the newest already-imported Binance transaction time
  (`transactionsRepo.latestSyncedTimeQuery(holdingId, 'binance')`), minus
  a one-day overlap, and never earlier than a 2017 floor. A first sync
  (no imported row) walks the full history from the floor; a steady-state
  re-sync always re-scans at least the last 89-day window, so a
  late-settling withdrawal is still caught. This mirrors Monobank's
  incremental-and-cheap philosophy without adding a per-holding cursor
  column.
- **Settled records only, on the Spot holding.** Only a credited deposit
  (`status === 1`) and a completed withdrawal (`status === 6`) are
  imported — a pending/rejected record never shows as a balance movement.
  Deposits/withdrawals are account-level on-chain movements, so every row
  attaches to the SPOT holding (match key `'BTC'`); Funding/Earn get no
  transaction rows.
- **Idempotent via `(source, external_id)`.** Each row is
  `source: 'binance'` with `externalId` `deposit:<id>` / `withdraw:<id>`
  (Binance's own record id, falling back to the on-chain `txId`), imported
  through `transactionsRepo.addManyDedup`. A re-sync refreshes rather than
  duplicates. The withdrawal `applyTime` is a UTC datetime STRING, NOT
  epoch ms — `parseWithdrawTime` pins it to UTC (a bare `Date.parse` would
  shift it by the device's local offset). Amounts convert through
  `Money.fromMajor('BTC', …)`; the withdrawal network fee is excluded from
  the ledger line. The rows carry an EMPTY description, so the holding
  detail + Home lists render the shared income/expense default label; a
  bespoke "Deposit"/"Withdrawal" label is a deferred follow-up.

## Price data

- Fiat cross rates: `GET /bank/currency` (public Monobank endpoint,
  cached upstream about every 5 minutes).
- BTC price: CoinGecko free API, quoted in USD; derive other pairs
  from it.
- Store results in `CurrencyRate`. Refresh on sync, throttled to
  respect each provider's own cache window — do not poll faster than
  the upstream cache refreshes.
