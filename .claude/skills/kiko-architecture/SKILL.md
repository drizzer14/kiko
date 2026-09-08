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
   SILENTLY SKIPPED (`upsertHoldings` in `src/monobank/sync.ts`)
   rather than thrown — the mapper still throws for every OTHER
   caller, but `upsertHoldings` checks `currencyFromCode` first and
   `continue`s past an unrepresentable account/jar instead of calling
   the mapper. This used to throw outside the per-card try/catch and
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
unchanged since the last sync (`isBalanceDiffSkip`). The prior
balance is read from `holdings.balanceMinorUnits` **before** this
run's `upsertHoldings` overwrites it — that column already is "the
balance as of the last sync" for a Monobank holding, since the sync
rewrites it from client-info every run, so no new holdings column was
needed for this.

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

### The sync signal clears early, before the run finishes

`useSyncStatus`/`setSyncing` (`src/monobank/sync-status.ts`) is the one
shared "a Monobank sync is running" signal, and it no longer tracks the
WHOLE run. `runSyncInner` now calls `setSyncing(false)` right after
`upsertHoldings` — the fast phase (client-info fetch + balance upsert,
so net worth is already current) — rather than only when the run
settles. The slower per-card, 60s-gated statement loop keeps running in
the BACKGROUND after that, still holding `inFlightSync` (so a joined
trigger never starts a second run); transactions land incrementally
through the reactive `useLiveQuery` consumers as each card imports. The
`release` callback in `runSync` (which also calls `setSyncing(false)`
on settle) is a harmless no-op on this normal path — the call is
idempotent — and remains the backstop that clears the signal if the
fast phase itself throws. Read the comment block around this call in
`runSyncInner` (`src/monobank/sync.ts`) rather than restating the exact
line here.

The custom `SyncingIndicator` component was REMOVED. The sole
Monobank-sync affordance is now the native Home `RefreshControl`
spinner (`src/screens/home/home.screen.tsx`), driven by the same global
`useSyncStatus` signal rather than a pull-local flag — so an
auto-sync-on-open (which also drives `runSync`) spins the pull control
WITHOUT a user pull, and a real pull spins it too. Because the signal
now reflects only the fast phase, the spinner also ends promptly rather
than spinning for the whole multi-card statement fetch. This is a known
limitation, not a bug: the signal is Monobank-only, so a pull on a
crypto-only account shows little/no spinner — see `src/screens/use-sync-all.ts`
for the fan-out that also drives crypto accounts.

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
  `applyPersistedAppearance()` (same shape, for `settings.appearance`,
  via the shared `applyAppearance` mapping in `src/appearance/appearance.ts`)
  -> `migrateLegacyToken()`. The settings row must exist before
  `applyPersistedLanguage`, `applyPersistedAppearance`, or `LockGate`
  (`lockEnabled`) reads it, which is why `ensure()` is awaited in the
  chain rather than fire-and-forget from `AppRoot`. Applying the
  persisted language and appearance here — before the gate's own first
  paint — is what makes the lock screen (and the "Preparing database…"
  text/background itself) render in the user's chosen language and
  pinned theme on a cold launch, not the device language/OS appearance.
  `applyAppearance` also drives the native iOS interface style via
  `Appearance.setColorScheme` (RN 0.87), so native chrome (tab bar, stack
  headers, system date picker) follows the same scheme — the app no
  longer hard-pins `UIUserInterfaceStyle` in Info.plist;
  `useSyncLanguageWithSettings`/`useSyncAppearanceWithSettings` (mounted
  from `AppRoot`, after both gates) only cover a LIVE switch from the
  Settings screen.

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

## Price data

- Fiat cross rates: `GET /bank/currency` (public Monobank endpoint,
  cached upstream about every 5 minutes).
- BTC price: CoinGecko free API, quoted in USD; derive other pairs
  from it.
- Store results in `CurrencyRate`. Refresh on sync, throttled to
  respect each provider's own cache window — do not poll faster than
  the upstream cache refreshes.
