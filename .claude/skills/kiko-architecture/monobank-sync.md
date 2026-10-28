## Monobank sync pipeline (functional)

The sync pipeline is deliberately functional, not OOP — see
`kiko-code-style` for when each style applies.

The global Monobank token (`kiko.monobank.token`) moves to a per-account Keychain item once, at
bootstrap, in `src/monobank/migrate-credential/` (`migrateSingleTokenToPerAccount`); read its
header for the crash-safe order and never write a second migration path for it.

1. Read the personal token from the iOS Keychain via
   `react-native-keychain`. **Never** store the token in the
   database or write it to a log — Settings holds `baseCurrency` and
   `lastSyncAt` only, not the token.
2. `GET /personal/client-info` with header `X-Token`; map each bank
   account and jar to a Holding under one `monobank` Account. On a
   Connect, `runSync` (`src/monobank/`) marks the target
   account `institution: 'monobank'` only AFTER this call resolves —
   `resolveMonobankAccountId` (read-only: validates the
   one-connection-per-institution invariant) runs first, then
   `fetchClientInfo`, then `markMonobankAccount` writes the mark. A
   wrong token, an offline device or a 429 must never leave the
   account half-connected; mirrors `src/crypto-sync/`'s
   `runBalanceSync` ordering. `runSync` does not create the settings
   row itself — the single settings row is guaranteed to exist by the
   app-boot migrations gate (`src/migration/`) before any
   sync can run.
3. `GET /personal/statement/{account}/{from}/{to}` per holding;
   import each item as a Transaction, UPSERTED on
   `(source, externalId)` — where `externalId` is NAMESPACED per
   connection as `` `${accountId}:${statementId}` `` (`mapStatementItem`,
   `src/monobank/`), because the `(source, external_id)` unique
   index is GLOBAL and now shared across MULTIPLE connections per
   provider (see kiko-exchange-sync's "Namespaced synced externalId") — by
   `addManyDedup` (`src/transactions/`). Two
   things about that upsert are load-bearing, both verified there
   rather than restated as a column list here:
   - A NEW external id first **adopts** a stored statement-import twin
     (same holding and signed amount, within ±60 s): `addManyDedup` only,
     never `importRows`, in the same `write(...)`. The import row becomes
     the sync's own in place (one UPDATE by its id) and the input is not
     inserted or counted. No `holdings` row is written. The rule and its
     residual live in `pairSyncInputsWithImportRows`'s header
     (`src/transactions/sync-adoption/`) and in kiko-statement-import.
   - Re-syncing an existing external id **refreshes** the row's
     bank-owned columns (the settled amount and `hold` among them)
     and **never** its `comment`. It writes `category` only for an
     unflagged (`category_set_by_hand = 0`), non-structural row (no
     `exchange_pair_id` / `exchange_counterpart_holding_id`,
     `sets_balance = 0`, no `change_group_id`) whose amount changed and a
     category rule wins (`ruleWonTransactionSet` in `transactions.repo.ts`);
     every other row keeps the stored category, which may be the user's
     own pick. Read `addManyDedup`'s `onConflictDoUpdate` set
     (`bankOwnedTransactionSet`, or `ruleWonTransactionSet` for a rule-won
     row) for the exact refreshable columns, and `transactions.hold` in
     `src/db/schema.ts` for why a pending item is imported at all.
     Its `setWhere` (`bankOwnedTransactionSetWhere`, shared by the rule-won
     branch, whose extra `category` write is gated on the amount, itself in
     the list) is DERIVED from the bank-owned `set` list
     (`BANK_OWNED_TRANSACTION_COLUMNS`), never a second hand-typed
     column list — see `transactions.repo.ts`'s own doc comment — so
     the UPDATE is skipped entirely when a re-fetched row is
     byte-identical to what is already stored, instead of firing the
     `transactions` reactive-query hook for every subscriber on every
     unchanged row. `holdingsRepo.setSyncedBalance` gets the same
     treatment for its one column, via its own exported
     `syncedBalanceUpdateWhere`.
   - The pipeline holds no JS-side "already imported" filter. One
     existed and was the bug: it dropped a re-fetched item before the
     database ever saw it, so a `hold: true` authorization's
     provisional amount could never be refreshed to its settled
     value. The duplicate is resolved in SQL, which is also what
     makes the refresh atomic.

   Respect the API's per-request constraints — a 31-day-max statement
   window and at most 500 items per response — by paging the window
   (see `fetchAllStatements` in `src/monobank/` for the paging
   shape). The rate limit is *not* handled here — see "The rate limit
   is per TOKEN" below.
4. Map Monobank's ISO 4217 numeric currency codes to the app's
   currency literal with `ts-pattern` (see `kiko-domain`). Amounts
   and balances already arrive in integer minor units — no float
   conversion needed there.

   A card/jar whose currency code `currencyFromCode` cannot map is
   SILENTLY SKIPPED (`upsertAllHoldings` in `src/monobank/`)
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
   — Biome's `noConsole` is otherwise `error` project-wide (`biome.json`).
   It is a literal-object `console.warn` (a string tag and an object
   literal), which `kiko-no-raw-error-in-console` allows; every swallowed
   failure logs through `logFailure` from `@kiko/diagnostics` instead.
5. The pipeline is a straight sequence of small transforms, not an
   `fnts` composition: map each fetched item to a row, fold duplicate
   conflict keys, hand the batch to the repository's upsert. The
   `pipe` that used to live here was removed with the JS-side dedup
   filter it wrapped (see step 3) — read `src/monobank/` end
   to end for the current shape rather than assuming a composition
   chain.

Confirm exact Monobank field names against the live API during
implementation — the spec's shape is a best-effort description, not
a verified schema.

### Balance-diff skip

`runSyncInner` (`src/monobank/`) no longer fetches every
card's statements on every run — a multi-card account synced over
minutes under the per-invocation gate alone. It now SKIPS the
statement fetch for a card whose `/personal/client-info` balance is
unchanged since its statements were last imported (`isBalanceDiffSkip`).

The prior balance is read from the CRASH-SAFE marker
`holdings.syncedBalanceMinorUnits` (migration `0024`, schema in
`src/db/schema.ts`), **not** `holdings.balanceMinorUnits`. This is
load-bearing and was a data-loss bug before: `upsertAllHoldings` overwrites
`balanceMinorUnits` (the display balance) from client-info at the START
of every run, BEFORE the per-card statement loop.

KNOWN LIMIT: that same overwrite is client-info's balance field verbatim,
with no credit-limit adjustment — a Monobank card that uses its credit
limit shows this raw provider figure, not a spent/available distinction.

A run that committed a
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
  (`src/transactions/`).
- The first-ever sync fetches every card (`shouldFullFetch`).

Safety net: `syncState.lastFullSyncAt` (per-connection; schema in
`src/db/schema.ts` — originally added as the global `settings.lastFullSyncAt`
in migration `0021`, de-globalized to `syncState` by the 2026-09-11
multi-account plan, migrations `0027`/`0028`; the old `settings` column
is retained-but-dead, per that column's own comment in `schema.ts`)
forces a periodic FULL fetch of every card regardless of balance —
`shouldFullFetch` decides when,
against the `FULL_FETCH_INTERVAL_MS` constant in `sync.ts` (read it
there, not restated here). This catches a net-zero same-window
transaction pair (a `+X` and a `-X` that leaves the balance unchanged)
that the skip would otherwise miss forever. Load-bearing: the full
fetch's from-window is derived from `lastFullSyncAt`
(`fromCursorSeconds`), **not** the incremental `lastSyncAt` cursor —
`lastSyncAt` advances on every clean run, including runs that skipped
whole cards, so using it would re-fetch only the recent window and
recover nothing. `lastFullSyncAt` graduates **only** on a fully clean
full-fetch run — the SAME partial-failure discipline as `lastSyncAt`
(see "Partial-progress resilience across cards" below), not a
divergence from it: a card's own from-window widens back to THIS
marker when its crash-safe marker is behind, so graduating it on a run
that failed that very card would become the failed card's own retry
cursor and permanently narrow away the window the failed run was
supposed to cover. See "Robust graduation: `failedSyncMonobankIds`"
below for the force-retry set that carries the actual fix for a
persistently flaky card, and the cost it accepts instead.

Migration `0021` originally added `lastFullSyncAt` (on `settings`) as
NULL with no backfill, which would otherwise force every already-synced
user into one slow, full-every-card fetch on their very next sync;
migration `0022` backfilled it from the sync cursor. Migration `0028`
(`drizzle/migrations/0028_backfill_sync_state.sql`) is the equivalent
data-only backfill for the current `syncState` table — it seeds each
connected account's `syncState.lastFullSyncAt` (and the other
`syncState` columns) from the retired global `settings` values, so an
existing user lands straight on the fast balance-diff path; read the
migration file for its exact guard rather than restating it here.

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
  `src/monobank/`). `runSyncInner` STABLE-sorts the accounts
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
- **Jars are statement sources.** `runSyncInner` builds ONE queue
  (`[...accounts, ...jars]`) that a jar and a card share through the same
  order, skip, window, fetch, crash-safe marker and failed set, under the one
  per-token 60 s request gate; a jar's rows land on its own holding. A jar's
  from-window is a card's: it reaches back to `lastFullSyncAt` (one default
  lookback on a first sync) and never earlier, except a jar the sync closed and
  that returns, which reaches back to its close mark, like a card. There is no backfill: a jar
  stored before jars had statements keeps its false net-worth drop on every
  top-up day older than that window, a known limit by user ruling. The run's
  `[monobank sync] done` diagnostic carries a `jars` count beside `cards`.
- **Per-card from-window** (`fromSecondsForCard`, `src/monobank/`).
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
- **A reopened card reaches back to its mark** (`fromSecondsForCard` takes the
  POST-upsert holding too). When the holding carries `statementFromMs`, the
  from-window is `min(normal, floor(statementFromMs / 1000))`, never
  narrower than the normal one, and `isBalanceDiffSkip` returns false for it
  (otherwise an unchanged-balance card would be skipped and the key would
  linger). See "Sync-closed holdings reopen" below.

This fix carries NO data backfill: marking the just-changed card
synced-through-its-new-balance (a backfill) would SKIP its unimported
transaction. The recovery re-fetch (a NULL marker fetches every card
once) is the deliberate one-time cost that recovers stranded cards —
read `runSyncInner` end to end rather than trusting a restated shape.

### Sync-closed holdings reopen

Rule: a Monobank card or jar the SYNC closed reopens when Monobank returns
it; one the USER closed never does. Two `holdings.metadata` keys, one role
each (no migration; `holding-metadata.ts` owns the constants and readers
`syncClosedFromOf` / `statementFromOf`):

- `syncClosedFromMs` — written by `holdingsRepo.closeManyBySync(ids, fromMs)`
  in the SAME update as `closedAt`, only by the Monobank reconcile
  (`reconcileClosedHoldings`, a clean FULL fetch with a non-empty snapshot).
  `fromMs` is the `lastFullSyncAt` the closing run READ before it graduated it
  (null falls back to one default lookback below `now`), and the mark keeps
  the earlier of it and a pending `statementFromMs`. A row that is already
  closed is skipped, so the first mark is kept. The user's Close sheet calls
  `closeMany`, which writes no mark: that is the whole "user-closed stays
  closed" rule.
- `statementFromMs` — the from-cursor of a reopened card's or jar's next
  statement fetch. `upsertByMetadataKey`'s update branch reopens a row only when
  `closedAt` is set AND `syncClosedFromMs` is a number: it clears `closedAt`,
  drops the mark (an upsert carries only the carried keys) and writes
  `statementFromMs = the mark`, whatever the holding type (a jar is a statement
  source like a card). A reopen moves no
  balance (the upsert writes the bank's own, as on every run). Binance and
  wallet rows never carry the mark, so they never reopen.
  `fetchCardWithProgress` calls `holdingsRepo.clearStatementFrom` AFTER
  `setSyncedBalance`, so a failed or interrupted fetch keeps the key (carried
  across upserts) and the next run force-fetches again; a crash between the two
  re-fetches the wide window, which is idempotent.

Why a window is needed: while the card was absent no run fetched its
statements, and the closing run already moved the normal cursor past the gap.
The cost is `ceil((now - mark) / 31 d)` requests behind the 60 s gate, once per
reopen; the progress weight follows through `estimateWindows`. The window has no
clamp: Monobank answers an old `from` (13 months back, probed 2026-10-06) with
200, so the sync completes, but rows older than the bank's own history depth
may be missing without an error.

Known limit (device-checked, no repair built): a holding the sync closed
BEFORE the mark existed has no mark, looks exactly like a user close, and stays
closed. A blanket mark could reopen a holding the user closed by hand while
disconnected. A disconnect keeps the mark and the `sync_state` cursors, so a
sync-closed card still reopens after a reconnect; a backup round-trips both keys
whole (`restore-sync-reopen.test.ts`).

### Robust graduation: `failedSyncMonobankIds`

`lastFullSyncAt` (above) GRADUATES (advances to this run's ceiling)
**only** on a fully clean full-fetch run — never on a partial failure.
An earlier version of this fix made it graduate even on a partial
failure, reasoning that ONE persistently flaky card would otherwise
starve the periodic safety net forever (`lastFullSyncAt` frozen,
`shouldFullFetch` stuck true past `FULL_FETCH_INTERVAL_MS`, every run a
full N×60s fetch of every card). That reasoning missed a load-bearing
consequence: `fromSecondsForCard` widens a failed or behind-marker
card's OWN from-window back to `lastFullSyncAt`, so graduating the
marker on the very run that failed that card made its next retry widen
to the JUST-ADVANCED marker instead of the window the failed run itself
needed to cover — permanently dropping the first-connect 31-day
lookback, or the span since the prior clean full fetch, for that one
card (the balance still looked right, because `holdings.balanceMinorUnits`
is overwritten from client-info regardless — see "Balance-diff skip"
above — so nothing else surfaced the gap). Graduating only on a fully
clean run is the SAME discipline `lastSyncAt` already used (see
"Partial-progress resilience across cards" below).

A first-ever full fetch (both `lastSyncAt` and `lastFullSyncAt` null on
entry) that fails is a SEPARATE case `resolveFullSyncAtToPersist`
(`src/monobank/`) still handles: it ANCHORS `lastFullSyncAt` — to this
run's own FROM cursor (`fromCursorSeconds`' null-cursor fallback,
`toSeconds - DEFAULT_LOOKBACK_SECONDS`), never its ceiling — rather than
leaving it null. Without this, a first sync that fails keeps the marker
null forever (it never had a clean run to graduate from), so every
retry's `fromCursorSeconds` null-cursor fallback recomputes fresh from
`toSeconds`, which SLIDES FORWARD with the real clock — a user who
reopens the app days after a failed first Connect gets a retry window
that starts days later too, silently losing the days in between.
Anchoring the FIRST attempt's own from-cursor keeps every later retry,
however delayed, deriving the identical window; `lastSyncAt` staying
null (it never advances on any failure) is what keeps `shouldFullFetch`
forcing a full fetch on every one of those retries, so the anchor is
never bypassed by a narrower incremental window in between. A periodic
(non-first-sync) full fetch that fails never reaches this branch — it
already had a real anchor before this run, which the graduation guard
above already leaves untouched.

There is no per-card cursor to divide the difference between cards, so
the accepted trade-off stands: a persistently flaky card keeps the
WHOLE account in full N×60s fetch mode, refetching every card from that
one fixed start, until a run finally comes back fully clean — a cost
that GROWS over time (the fixed start ages further behind `now` on
every calendar day the card stays flaky, so each of those full fetches
pages further back). A per-card retry-from cursor (e.g. persisted in
`holdings.metadata` JSON, no schema change) would let `lastFullSyncAt`
graduate normally for the OTHER cards while only the flaky one keeps
retrying from its own anchor — a real improvement, but a tracked
follow-up, not implemented here.

`syncState.failedSyncMonobankIds` (per-connection; schema in
`src/db/schema.ts` — originally added as global `settings.failedSyncMonobankIds`
in migration `0023`, de-globalized to `syncState` by migrations `0027`/`0028`,
same as `lastFullSyncAt` above) is a persisted set of Monobank account ids
whose statement fetch FAILED on the last run. The next run force-fetches
exactly those ids regardless of balance — the same carve-out shape as
the outstanding-hold case in "Balance-diff skip" above — from the SAME
un-advanced window the failed run used, re-covered idempotently (the
`(source, external_id)` upsert dedups a re-fetch). A card is dropped
from the set the moment it succeeds, and the set is pruned to ids still
present in client-info (so a removed card is not force-fetched
forever). Read `nextFailedSet`, `isBalanceDiffSkip`,
`shouldGraduateFullSync`, and `resolveFullSyncAtToPersist`
(`src/monobank/`) for the exact set algebra, the graduation guard, and
the first-sync anchor case rather than a restated one here.

The statement CURSOR (`syncState.lastSyncAt`) advances **only** on a
fully clean run too (unchanged "Partial-progress resilience across
cards" behavior below) — both cursors share the SAME graduation
discipline: neither GRADUATES (advances past problems) until the run
that would graduate it is fully clean. Read the end-of-run sequence in
`runSyncInner` (`src/monobank/`) for the exact ordering: the failed-set
persist happens BEFORE the partial-failure throw; `lastFullSyncAt`'s
own write is gated by `resolveFullSyncAtToPersist`, which returns a
value on a partial failure ONLY for the first-sync anchor case above —
every other partial failure leaves it untouched, same as the cursor.

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
helper. The throttle module (`src/monobank/`) owns it: `createRequestGate`
returns a one-slot gate whose `wait()` resolves immediately the first
time and thereafter only once the interval has elapsed since the
previous resolution. Read that module for the interval and the gate's
exact semantics rather than trusting a number restated here.

`runSync` (`src/monobank/`) creates **exactly one** gate per
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

- `useAutoSync` (`src/sync/`) on app open,
- `useSyncAll` (`src/sync/`) on pull-to-refresh,
- `useSync` (`src/sync/`) on the manual button —

`useAutoSync` and `useSyncAll` share ONE fan-out job builder
(`syncJobsFor`, `src/sync/`), so the app-open sync drives
EXACTLY the pull-to-refresh set — the connected Monobank account (only
when a token is stored) PLUS each connected crypto account whose id the exchange registry
wires (read `src/sync/sync-jobs/sync-jobs.ts`) — under
`Promise.allSettled`. So a crypto balance + Binance transaction import
now happens on app open, not only on pull. `useAutoSync` is throttled by
`throttleElapsed(syncState.lastSyncAt)` and never touches the pull spinner
signal (it reads no `fastPhaseDone`), so an app-open sync drives only the
determinate progress bar.

### The market refresh beside the sync fan-out

Both also run `refreshMarketData` (rates, metals) BESIDE the
fan-out under a `Promise.all` of two never-rejecting promises, not after
it: the provider requests are gated at one per minute per token, so a
refresh queued behind K cards started K minutes late on the first open of
the day. `runLoanAutoLink` stays after both, because the matcher needs the
imported debits and the refreshed rates. The refresh's open-currencies
gate reads the holdings when it starts, before the fan-out has written a
currency it brings in for the first time, so when the held set gained one
a rates-only refresh runs after the jobs (the rates throttle skips it
unless that currency has no rate yet), and the new holding is priced in
the same run. A run never asks a rate source twice: both passes share one
`FiatRatesOfRun` (`refreshRates`), so the top-up reads the fiat answer, or
the failure, of the first pass instead of calling Monobank (one
`/bank/currency` call per client per five minutes, and its one response
carries every fiat currency) or NBU again. A pass that already got an answer
composes its rows from it, source label included; a pass after a failed
answer reports the same failed fiat leg with no request. CoinGecko is the
one exception: the top-up asks CoinGecko once more, for every held coin, since
the first answer cannot include a coin the jobs added. The top-up does not
rewrite the fiat rows the first pass already stored (kiko-pricing).
`settle-jobs-beside-market-refresh.network-calls.test.ts` pins the
request count per scenario.

### The single-flight lock (continued)

Two sync triggers firing at once produced two concurrent runs, two
independent gates, and colliding 429s (the reported "inconsistent"
sync). `runSync` therefore holds a **module-level single-flight lock**
(`inFlightSync` in `src/monobank/`): while a run is in flight,
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

The sync-status module (`src/monobank/`) holds THREE separate module-level stores.
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
     card completion; a Monobank JAR in `toFetch` weighs its window count the same way
     (it is a statement source like a card); each crypto/exchange balance
     fetch weighs ONE unit. A balance-diff-skipped card or jar and every manual
     holding weigh NOTHING.
   - `completed` / `total` count HOLDINGS for the "N/M" label only (holdings
     doing work this run / holdings finished), DECOUPLED from the fill (the
     file-copy pattern: "1 / 2 holdings" can sit at a small fill while a heavy
     card still fetches).
   Each sync path brackets its work with `beginProgressSession()` /
   `endProgressSession()` (first begin resets, last end clears), calls
   `registerWork(holdings, work)` up front, then `commitWork(units)` as it
   fetches and `commitHolding(count)` as each holding finishes — see
   `src/monobank/`. A path that registers ZERO work publishes
   nothing, so the bar never appears for a run that fetches nothing (the no-op
   guard, spanning the fan-out). There is NO whole-app active-holdings count
   denominator any more — `total` is the syncing holdings only.

   The WORK sources ("weight by real work", the user's decision; confirm on
   device):
   - a Monobank CARD in `toFetch` (NOT balance-diff-skipped, `selectCardsToFetch`)
     — weight = its statement-window count, committed per page in
     `fetchCardWithProgress` / `fetchAllStatements`'s `onPage` callback;
   - a Monobank JAR in `toFetch` — the same weight and per-page commit as a
     card, since a jar is a statement source in the same queue (`runSyncInner`);
   - every crypto/exchange holding a `runBalanceSync` upserts (Binance: one
     per coin and wallet; or a wallet) — a crypto sync has NO balance-diff skip,
     it always reads live balances, so each returned holding is one work unit.
   ZERO work = every MANUAL holding and every balance-diff-skipped card or jar.
3. `fastPhaseDone` (`isFastPhaseDone`/`setFastPhaseDone`/`subscribeFastPhase`)
   — a one-shot "balances have landed" signal. `runSyncInner` fires
   `setFastPhaseDone(true)` the instant `upsertAllHoldings` commits the
   client-info balances, LONG before the statement loop finishes.
   `runSync` resets it `false` at run start and clears it on settle. It
   is a plain imperative signal (no React hook): the pull path reads it
   inside an event handler, not during render.

Read `runSync`/`runSyncInner` (`src/monobank/`) for the exact
call sites rather than restating the lines here.

The custom syncing-indicator component was REMOVED. There are now TWO
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
  slow per-card fetch to the progress bar. Do not end the whole-run
  SIGNAL early — `isSyncing` must still track the whole run and drive
  the progress bar, so activity stays visible until "Last sync" lands.
  Only the SPINNER ends early, by design.
- The flag clears on the FIRST of `fastPhaseDone` OR the run settling
  (`onRefresh`'s `.finally`). The settle path is the fallback for a
  fan-out with NO Monobank job (a crypto-only account, or no syncable
  account — see `useSyncAll`, `src/sync/`), which fires no
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
regardless). The per-connection `syncState.lastSyncAt` cursor advances **only on
a fully clean run**; on a partial failure it stays put and `runSync`
re-throws, so the failed card's window is re-covered next time. A
re-fetch is idempotent (the `(source, external_id)` upsert refreshes
rather than duplicates), so nothing already imported is lost or
re-imported. Kiko has no per-CARD cursor — that would need a schema
change — so a partial failure does re-fetch the cards that already
finished; the dedup layer keeps that correct, only slower.
