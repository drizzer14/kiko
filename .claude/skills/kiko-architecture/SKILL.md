---
name: kiko-architecture
description: Invoke whenever you touch storage, a repository, a screen's data hook, migrations, the Monobank sync pipeline, or backup export/import (data-transfer). Read before writing any op-sqlite/Drizzle code, any db.transaction call, any useLiveQuery consumer, any code that reads the Monobank API or the Keychain token, or any `.kiko` export/import code. For currency rates, price_points, or a priced holding's value, see kiko-pricing; for statement-import parsing or column mapping, see kiko-statement-import.
---

# Kiko architecture

Source of truth: `docs/superpowers/specs/2026-08-30-kiko-foundation-design.md`
("Storage and migrations", "Data flow — reactive queries", "Data
collection" sections). This skill summarizes the settled contract.

## Guideline 5.6 — no hidden features

Architectural, not a one-off cleanup: the App Store rejected Kiko
1.0.0 build 7 under Guideline 5.6 ("features intentionally hidden
during review") for a build-time `@env` flag that only folded a
not-ready feature out of the Release bundle. The rule going forward:

- Every feature ships VISIBLE to an App Store reviewer. There is no
  flag-gated or conditional-visibility feature in a release build —
  no `@env` flag or other build flag (a `SHOW_*`/`HIDE_*`-style
  control) that gates whether a feature or UI is visible. A not-ready
  feature is REMOVED from the build (its code paths gone), never
  flag-hidden.
- No demo/seed/screenshot/fake-data module lives in or is imported
  from app `src/`. That dev/test machinery lives outside `src/` (see
  `e2e/screenshot/`) and never ships.

Mechanized lightweight, on purpose — not a heavy always-on
build-a-bundle CI gate:

- A Semgrep SOURCE rule, `kiko-no-hidden-feature-flag-or-demo-import`
  (`rules/semgrep-mobile.yml`, Class A ERROR, runs under
  `npm run check:security`; its fixture pair is verified by
  `npm run check:rules`). It flags three shapes: (a) importing a
  `SHOW_*`/`HIDE_*`/`SCREENSHOT_*` `@env` flag, (b) a static `import`
  whose specifier contains the literal `e2e/` segment, and (c) a dynamic
  `require(...)` whose specifier contains `e2e/`. `src/` has zero `e2e/`
  crossings of any kind. **Metro dead-code elimination is not
  trusted as a substitute for (c):** build 8 shipped
  `seedScreenshotData` inside `main.jsbundle` despite it sitting behind
  a dead `if (SCREENSHOT_MODE === 'true')` branch that DCE was supposed
  to fold out — which is why a dead-branched dynamic `require` reaching
  `e2e/` is now a finding with no exemption, and why the archive-time
  bundle grep below is a required acceptance check, not a nicety. KNOWN
  LIMITS, documented so a reader trusts human review as the backstop
  rather than the rule alone: it does NOT catch a differently-named
  visibility flag (e.g. `ENABLE_*`), it does NOT catch a demo/seed
  import reached through a path alias that omits the `e2e/` substring, and
  it does NOT catch a namespace import of `@env` (e.g.
  `import * as env from '@env'; ... env.SCREENSHOT_MODE`) — the flag regex
  only matches the named-import form.
- A one-time archive-time grep of the built Release `main.jsbundle` for
  the capture/demo symbols and fake-data literals, run by ops against
  build 9's embedded bundle — required, not optional, precisely because
  DCE was proven untrustworthy (build 8, above). Precedent and full
  needle list: `docs/superpowers/plans/2026-09-15-strip-screenshot-subsystem-5.6-fix.md`
  (its Task 6, the acceptance grep) — do not grep for `Binance` or
  `Монобанк`, both legitimate shipped strings. The subsequent full
  screenshot-subsystem purge is documented in
  `docs/harness/screenshots-check.md` (the automated capture path was
  deleted outright; screenshots are now a manual procedure). It is NOT currently a standing step in the `release` skill
  (that skill's Part B "Verify the archive invariants" lists only
  `UIDeviceFamily`, signing identity, App Group, and `get-task-allow`).
  Wiring this grep into the `release` skill as a standing archive step
  is a recommended, not-yet-done follow-up.

Read `CLAUDE.md`'s "Guideline 5.6 — no hidden features" for the
project-level pointer to this section.

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
  disorder). `MigrationsGate` (`src/migration/`) owns the launch UI: a loading
  state until migrations succeed and an error state if they fail —
  never proceed past a failed migration.
- The count-based runner makes migration `idx` a SHARED NAMESPACE
  across branches, not a per-branch sequence — two branches that each
  add a migration at the same next `idx` are NOT independent: `fix/import-balance`'s own
  `0034_add_balance_set_at` must NEVER reach `main` as-is. That fix
  lands on `main` only through `feat/assets-debts`, where it was
  renumbered to `0036` (after that branch's own `0034`/`0035`) at merge
  time. A build cut from a `main` that still carries the fix's
  `0034_add_balance_set_at` verbatim would leave a device's `COUNT(*)`
  at 35 once it later upgrades to `feat/assets-debts`'s renumbered
  journal (`0034_add_statement_mappings`, `0035_add_price_points`,
  `0036_add_balance_set_at`) — the runner then applies
  `journal.entries.slice(35)`, i.e. idx 35 and 36 only. idx 35 in the
  new journal is `0035_add_price_points`, which this device has never
  run before, so it applies for the FIRST time and succeeds (not
  "already applied ... again"). idx 36 (`0036_add_balance_set_at`) is
  the one that then fails with "duplicate column name", since the
  pre-upgrade build already added that column under its own local idx
  34. `feat/assets-debts`'s own idx-34 migration,
  `0034_add_statement_mappings`, is skipped entirely by this
  `slice(35)` and is never created on that device at all, tripping
  `MigrationsGate`'s error state either way. If `fix/import-balance`
  (or any branch) ever needs a `main`-only hotfix again, re-cut ITS
  migration with a fresh number at THAT time, checked against whatever
  `main`'s own journal tail is then — never assume a branch's own next
  `idx` is still free by the time it lands.
- **A key/column whose backfill can only run in JS, not SQL, is a
  flag-adding migration plus a launch-time upgrade step.** Migration
  `0041_add_dedup_key_upgraded` only adds `settings.dedup_keys_upgraded`
  (defaulting to `false`) — the actual rewrite can't be SQL:
  `normalizeTransactionName` is JS-only, never in SQL, so SQL alone
  cannot tell a statement-import dedup key's occurrence suffix from a
  description that itself ends in a digit. `MigrationsGate` performs
  the rewrite: `upgradeStoredDedupKeys`
  (`statement-import/upgrade-stored-dedup-keys/`) runs after
  `runMigrations` and `settingsRepo.ensure()`, next to the credential
  migrations, reads the flag, and — only when it's still `false` —
  recomputes and rewrites every legacy `source = 'import'` transaction's
  `externalId` (the pure `upgradeLegacyDedupKey`,
  `statement-import/mapping/upgrade-dedup-key.ts`) inside ONE `write()`
  transaction before flipping the flag, so a crash mid-run retries the
  WHOLE upgrade on the next launch instead of leaving some rows
  unrewritten.
- **A data-only cleanup migration needs a restore mirror, not a schema
  change.** Migration `0042_uah_star_rates` is hand-authored SQL, no
  snapshot JSON (same as `0040`/`0039`): it removes every stored
  cross/inverse rate row (`currency_rates`/`currency_rate_history`,
  `quote <> 'UAH' OR base = 'UAH'`) now that every A->B conversion
  resolves at read time through the UAH pivot (kiko-pricing's
  "Currency-rate fallback chain"). Crash-safe, derive-then-delete order
  (same shape as `0040`'s snapshot-then-mutate): two additive
  `INSERT OR IGNORE` steps first — one X:UAH row from an inverse
  `UAH:X` row, one from a legacy `X:Y * Y:UAH` cross pair — so a
  currency whose only pre-star row was an inverse or a cross pair still
  ends up with its own star row before the final, irreversible DELETE
  runs; idempotent (a second run derives and deletes nothing).
  `src/data-transfer/snapshot/restore-snapshot.ts`'s
  `withRatesNormalizedToUah` applies the IDENTICAL rule to a `.kiko`
  restore, so a pre-star export normalizes exactly like a live device
  upgrade rather than reintroducing dead cross rows. Next free
  migration index: `0043`.

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

## No full-table select inside a write

A `write(...)` callback holds op-sqlite's one worker thread (see "op-sqlite's
ONE worker thread" below) until it commits. A where-less
`select().from(<table>)` inside it reads the whole table and then filters in
JS while every other read and write waits. Filter in SQL (`.where(...)`),
read only the column you need (`selectDistinct`, as
`upsertCategoryOverride` does for descriptions), or bound it with
`.limit(...)`. The one-row `settings` table is exempt. Mechanized as
`kiko-no-full-table-select-in-write` (ERROR, `rules/semgrep-prewrite.yml`).
A full scan hidden behind a repo helper called inside the write is not
caught; that stays a review item.

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

### op-sqlite's ONE worker thread — every query, whole-app, one queue

op-sqlite runs every query for the WHOLE APP on a single worker thread
per connection (`node_modules/@op-engineering/op-sqlite/cpp/OPThreadPool.cpp:14-20`;
`OPDatabase.cpp:494`). A read queued behind a write is DELAYED, not
rejected — there is no per-query timeout or failure, only queueing.
This is why an app-open write burst (the sync fan-out, `refreshRates`,
`refreshMetalPrices` — see `kiko-pricing`) can leave a screen's own
first read queued behind it for a perceptible stretch: the screen is
not broken, its read is just waiting its turn on the one thread. Two
consequences follow directly:

- A screen must never treat "my first read hasn't resolved yet" as
  "the data is empty" — see the `useDataReady` consumer rule below.
- Shrinking the app-open burst itself (fewer redundant reads/writes,
  or running two independent refreshes concurrently instead of
  sequentially) genuinely reduces how long a screen's own read sits
  queued — see `kiko-pricing`'s "Refresh throttles" section for the
  concrete `refreshRates` / `refreshMetalPrices` case.

### `useLiveQuery` consumer rule: gate an empty state on `isLoading`, never on `data.length === 0` alone

Every `useLiveQuery` (and `usePriceBook`, which wraps one) starts
`isLoading: true` — unless it opted into the live-query cache below and
the cache has rows for its key — and clears it only once its FIRST read for its CURRENT
sql+paramsKey settles — never before. Because of the
one-worker-thread queueing above, that first read can sit queued for
real, perceptible time on a busy app open. A screen that renders its
own empty state (empty list text, an empty chart, a `0` balance)
whenever `data.length === 0` — without checking `isLoading` — cannot
tell "genuinely no data yet" apart from "my read is still queued," and
shows the wrong one: a real empty state for a screen whose data hasn't
arrived yet, which self-corrects only on the NEXT reactive fire or a
fresh mount (this shipped as a production bug — every screen read
`data`, none read `isLoading`).

**`isLoading` is per query KEY, not merely per hook instance.** It goes
back to `true` the instant a query's `sql`/`paramsKey` changes — a
DEPENDENT query re-keying off data that only just arrived (e.g.
holding-detail's `accountsRepo.byIdQuery(holding?.accountId ?? '')`,
which starts on the placeholder `''` key before `holdings` has loaded
and re-keys to the real account id the moment it does) — but a
reactive re-run against the SAME key never flips it back to `true`
(verified in `use-live-query.test.ts`). `useLiveQuery` tracks this by
comparing the CURRENT render's key against the key its last-applied
result belongs to, not by a one-shot "have I ever loaded" flag. Under
a dense write burst, a finished result is applied whenever it is newer
than the last APPLIED generation — not only when it is the newest
STARTED one — so a screen's spinner clears as soon as an in-order
result lands instead of waiting for the whole burst to quiet down.

The fix is one shared mechanism, not a per-screen ad hoc guard:

- `useDataReady(...isLoading)` (`src/db/use-data-ready.ts`) takes every
  `isLoading` flag a screen's own `useLiveQuery`/`usePriceBook` calls
  return and is `true` only once ALL of them are currently settled —
  a plain `!loadingFlags.some(Boolean)`, no latch. An earlier revision
  latched (stayed ready forever once every flag had settled once), as
  a defensive backstop against `useLiveQuery`'s `isLoading` flipping
  back to `true` after the gate had already opened; that never
  actually happens for any current consumer, because a query's key
  only ever changes while at least one of that SAME screen's OTHER
  flags is still loading in that same render (the dependent-query case
  above) — concretely, in holding-detail the ACCOUNT query's own
  `isLoading` flips back to `true` the instant it re-keys off the
  just-loaded holding, so `useDataReady`'s overall gate is already
  not-ready for that render without any latch — so the latch was dead
  weight once the flip moved to the right layer (`useLiveQuery` itself,
  per-key, above). A future parameter-keyed query must keep the same
  contract: keep the previous key's data visible through a later key
  change and never show the EMPTY state for the new key before its own
  result lands — the screen's first load per mount is what gates the
  whole screen from ever showing empty on real data, not a per-key
  reset in between.
- `LoadingState` (`src/design-system/components/loading-state/`) is
  the shared "not ready yet" visual: a plain centered native
  `ActivityIndicator`, no text at all — a spinner needs no i18n
  string, so gating a screen on it never has to add one. See
  `kiko-design-system`'s "Component set" section for its own entry.
- A screen calls `useDataReady` on every query's `isLoading` (its own
  `useLiveQuery` calls plus `usePriceBook`'s), and — AFTER every hook
  call (Rules of Hooks: every `useLiveQuery`/`usePriceBook` call still
  runs unconditionally on every render; only the JSX branches) —
  returns `<LoadingState testID="<screen>-loading" />` in place of its
  normal content while `!isReady`, wrapped in the exact SAME `Screen`
  mode/props as its ready branch (same `scroll`/`bleedTop`/
  `bleedBottom` and the same `scrollableRef` when one is passed) — NOT
  a bare `<Screen>`. The first scroll view iOS walks to drive the
  native large-title collapse must exist from the very first render,
  or the collapse never engages once real content replaces the
  spinner. A screen whose ready branch's own scrollable IS its content
  (holding-detail's ledger `FlatList` under `bleedTop`) keeps that
  same component MOUNTED throughout instead of swapping to a separate
  loading branch, rendering `LoadingState` as its
  `ListHeaderComponent` and suppressing `data`/`ListEmptyComponent`
  until ready — home similarly keeps `SyncProgressBar` (it shows the
  sync the screen's own first read is queued behind) and
  pull-to-refresh available on the same scroll view while loading, not
  only once ready. Current consumers: `account-detail`,
  `holding-detail`, `home` (net-worth headline + transaction list),
  `statistics` (every chart), `accounts` (the accounts-list empty
  state), `settings/system`, `settings/settings`,
  `settings/categories`, statement-import's `example-transaction` (a
  single row inside an already-loaded parent, gated on its OWN
  categories/settings queries rather than the whole parent screen) —
  grep `useDataReady` for the current call-site list rather than
  trusting this restated one if it drifts. A screen/component that
  gates only ONE value (not its whole render) reads `isLoading`
  straight off the one `useLiveQuery` call it depends on instead —
  `bank-sync-section`'s "Last sync" status line is the example: it
  hides just that line while `sync_state` loads, leaving the
  Sync/Disconnect actions (which don't depend on that query)
  unaffected.
- An `isLoading` gate is a SEPARATE concern from a screen's own async
  UI state (e.g. statistics's rate-history backfill `loading` prop on
  `NetWorthLine`) — the backfill tracks a later, non-blocking network
  fetch that only starts once the screen's OWN base queries have
  already loaded; do not fold the two into one flag. That backfill
  effect must ALSO gate on its own upstream query's `isLoading`
  (`historyLoading`) in its dependency guard, not just on
  `transactions.length` — an empty `historyRows` reads identically to
  "nothing backfilled yet" for as long as `currency_rate_history`'s
  own query is still on its first load, and re-fetching/re-writing the
  whole span on that false-empty read adds to the same app-open DB
  burst this whole rule exists to protect screens from.
- A rejected query still ends `isLoading` — `isLoading` derives from
  whether the CURRENT key has an applied result at all, and the error
  path marks the key applied (`appliedKey.current = myKey`) exactly
  like the success path does, verified in `use-live-query.test.ts`'s
  "clears isLoading when the first query fails" case — and now also
  LOGS the failure (`console.warn('[useLiveQuery] query failed', sql,
  error)`, behind a justified `noConsole` OVERRIDE) — previously a
  rejected query set `error` with no diagnostic anywhere a device log
  could see, and no screen read `error` at all. So a `useDataReady`
  gate never spins forever on a genuinely failed query; it just never
  shows the raw error either (no consumer reads `error` today). A
  rejection for a KEY THAT JUST CHANGED (the previously applied key
  differs from this render's) also resets `data` to `[]` — it must not
  keep showing the OLD key's rows as this key's result; a rejection
  against the SAME key that was already applied keeps that previous
  data, matching what a same-key success does.

`usePriceBook(enabled?, options?, loanPaymentsEnabled?)`
(`src/prices/use-price-book/`) returns `{ book, isLoading }`, not a bare
`PriceBook` — every consumer destructures
`const { book: priceBook } = usePriceBook();` (or additionally
`isLoading: priceBookLoading` when gating). It runs TWO live reads —
`price_points` and every linked loan payment
(`transactionsRepo.loanLedgerPaymentsQuery()`, ONE read across all loans,
never one per holding: the one worker thread above) — and its `isLoading`
is true while either is on its first load. See `kiko-pricing` for the
full contract, and the section below for its two gate arguments.

### The live-query cache: a reopened screen shows its data on the first frame

Rule: a DISPLAY screen reopened within seconds shows its data at once,
on the first frame — never a `LoadingState` (a native-stack pop
UNMOUNTS the screen, so every reopen is a fresh mount, and on the dark
`Screen` background the spinner's delayed empty container reads as a
black screen). `useLiveQuery` keeps a module-level LRU cache
(`LIVE_QUERY_CACHE_LIMIT`, 100 keys) of the last successful read per
full query key (`sql` + serialized `params` — different params never
share an entry). EVERY successful read writes it, even one that
settles after its screen unmounted (a form's Save + `goBack()`, a quick
pop); the per-instance generation guard still runs first, so an older
read never overwrites a newer one. A rejected read is never cached.

**The cache is OPT-IN, for display screens only.** Only a call that
passes `{ cached: true }` (the 4th argument:
`useLiveQuery(query, tables, true, { cached: true })`, or
`usePriceBook(enabled, { cached: true })`) READS it. Only a display screen's readiness query opts in — never a
form, a one-shot seed, or a query that drives a write. For the current
set, grep `cached: true` under `src/`. A mount
with a cache hit seeds `data` with the cached rows and `appliedKey`
with the current key, so `isLoading` is `false` on the very first
render; it STILL runs the query and subscribes, and the fresh result
replaces the rows. Only a mount reads the cache — a later re-key waits
for its own read as above.

**Never opt in a query that seeds a form or drives a write.** A write
made while no subscriber of a key is mounted (the lot form's
`holdingsRepo.update` while the holding form is closed) leaves that
key's entry one read old. A one-shot form seed (`hydrated` latch)
reading it would latch the stale row, and Save would write it back over
the newer one — this shipped as a data-loss bug (edit metal, cancel,
add a lot, edit again, Save: the new lot was gone). Forms,
statement import, `useTargetHoldingOptions`, `useBondIsinMode`, and
every other one-shot seed never pass `cached`.

**A write started from a cached display screen must not trust its
rows.** `useLiveQuery` also returns `isFresh`: `true` once THIS
mount's own read for the current key has applied (always `true` while
disabled). Every write a display screen starts either passes only IDs
(plus the user's explicit new value) to a repo that re-reads inside its
own transaction (every `remove`, `categoriesRepo.delete`, the sync
jobs, `holdingsRepo.removeOwnershipChange` started from Holding
detail — a holding id plus a share change's day key;
`editOwnershipChange` is ID-shaped the same way but starts from the
uncached `OwnershipChangeForm`), or is gated on `isFresh`. The drag reorders (Accounts' three
grids, Account detail's holdings grid, Categories) set
`sortEnabled={isFresh && …}`, and Categories' move-to-top/bottom
buttons ignore a press until `isFresh` — each persists the WHOLE order
of the rows on screen. A new write from a display screen picks one of
the two, never neither. Tests call `clearLiveQueryCache()` in
`beforeEach` so one `it`'s rows never seed the next.

**Local state on a cached display screen follows the row; it is never
seeded once.** A list row keyed by its ID never remounts when the fresh
row replaces the cached one, so a `useState(row.field)` seed keeps the
cached value, and a later write can put it back over a change made
elsewhere (a `.kiko` restore). Categories' rename field syncs its local
title from `category.title` whenever the stored title changes while the
field is not being edited, and commits only text the user changed (not
the title the edit started from). Syncing on a change, rather than
rendering the row field directly, keeps a just-committed rename on
screen until its write flows back. An effect that writes from rows and
records what it covered in a ref waits for `isFresh` too: Statistics'
history backfill does not start until `transactions` and
`currency_rate_history` are both fresh, because its
`backfillRanForSpanRef` marks the span covered for the rest of the
mount, so a run planned from a cached resume point would stop the fresh
read's own run from ever starting.

## App-open and refresh work is gated on data presence

Standing rule: the app never performs a request or a query for data
the user does not have. Every app-open/refresh step reads one cheap
gate first — an `EXISTS`/`LIMIT 1` check or a small `SELECT DISTINCT`,
never a per-holding loop — and skips its own work entirely when the
gate says there is nothing to do.

- **Rate/price refresh**: `openCurrencies()`
  (`src/rates/open-currencies-gate/`) is the ONE gate implementation
  `refreshRates` (`rates-refresh.ts`) and `runBackfill`
  (`history-backfill.ts`) both read — the same gate pattern for every
  refresh, not a per-call-site copy. It resolves `{ needsFiat,
  cryptoCurrencies }` from a single `settings` read plus
  `holdingsRepo.openCurrenciesQuery()` (a `SELECT DISTINCT currency`
  over ACTIVE holdings — open, and whose account is not archived,
  mirroring `activeHoldings`). The fiat leg (Monobank/NBU, or NBU
  history) runs only when `needsFiat` — some active holding's currency
  differs from the base (display) currency, which also covers the
  crypto leg's own USD:UAH anchor need, since a held crypto currency
  always differs from a fiat base. The crypto leg (CoinGecko current
  price or history) runs only for `cryptoCurrencies`, and
  `fetchCryptoPrices`/`fetchCryptoHistory` fetch only those currencies,
  never the full supported set. `refreshMetalPrices`
  (`src/prices/metal-refresh/`) is the original template this
  generalizes: `earliestDays.size === 0` (no held metal) is a zero-
  network, zero-write early return, verified by test. It also reads
  the cheap presence input first and returns before any heavier read
  — `holdings` before `price_points` — the same order every gated
  refresh follows.
  `shouldThrottle` (`src/rates/rates-refresh/rates-refresh.ts`) skips
  its own throttle window when a held currency has no rate row yet —
  a "never fetched" escape so the data-presence gate can never hide a
  currency's rate entirely. `UAH` is filtered out of that presence
  check first: a star row's `quote` is always `UAH` and its `base`
  never is, so `presentCurrenciesQuery` (a distinct `base` read) can
  never list `UAH` — without the filter, a base-USD user who holds
  UAH would read as permanently "unrated" and bypass the throttle on
  every sync instead of only a genuine gap.
  The history backfill resumes per currency: a newly held currency
  with no history rows forces a run from the earliest day
  (`src/rates/history-backfill/history-backfill.ts`) — once per app
  run: a currency whose providers all answered for the whole span but
  returned no row for it (a held coin CoinGecko never returns) is kept
  in an in-memory `knownEmptyCurrenciesThisRun` set and no longer
  resets the cursor, so Statistics does not refetch the full span on
  every focus (a rejected leg is never recorded — it retries; nor is a
  coin whose OWN CoinGecko request failed while another coin's succeeded:
  `fetchCryptoHistory` settles per coin and returns `failedCurrencies`
  beside its `entries`. The metal twin, `emptyBackwardFloorByMetal`,
  records only an ANSWERED empty backward range — a failed request
  throws before it is recorded). A create/restore
  that may add the first holding of a new currency or type triggers
  these gated refreshes WITHOUT awaiting them, so Save never blocks on
  the network.
- **`usePriceBook`'s `enabled` argument**: `useLiveQuery`'s own
  `enabled` parameter (default `true`) skips BOTH the query and the
  reactive subscription while `false`, reporting `data: []` and
  `isLoading: false` — ready, never stuck (a gated-off screen must
  still flip its overall readiness, never spin forever on a query it
  deliberately never ran). `usePriceBook(enabled)` forwards straight
  through; a screen passes `holdingsLoading || holdings.some((holding) =>
  needsPriceBook(holding.type))` (or the one displayed holding, for a
  detail screen) — never a conditional call to the hook itself, which
  Rules of Hooks forbids. The `holdingsLoading ||` is required: without
  it `holdings` reads `[]` during its first load, so the price_points
  read only STARTS after holdings resolve (a waterfall that doubled
  readiness for a loan/property/metal user); with it both reads run in
  parallel and price_points disables afterwards if nothing needs it. `needsPriceBook` (`src/holdings/priced-value/`)
  is true for a priced type (`property_item`/`metal`) OR `loan` (not
  priced, but reads its own `holding:<id>` series the same way,
  kiko-pricing) — the one predicate every call site uses. The third
  argument, `loanPaymentsEnabled` (default: `enabled`), gates the
  linked-loan-payments read the same way: every display screen passes
  `holdingsLoading || holdings.some((holding) => holding.type === 'loan')`
  (or the one displayed holding), so a metal- or property-only user never
  runs it. It never runs while `enabled` is `false`.
- **The first add triggers the gated refresh**: creating the FIRST
  metal/foreign-currency/crypto holding (`holding-form.screen.tsx`'s
  manual create) or restoring a `.kiko` export (`importData`,
  `src/data-transfer/import-data.ts`) triggers
  `refreshMarketData({ throttled: false, metals: true })`
  (`src/sync/refresh-market-data/`) explicitly right after its own
  write commits, since neither path runs through the sync fan-out that
  otherwise triggers this — so the price/rate appears without an app
  restart. Both underlying steps gate themselves, so this is a no-op
  when neither is needed; `refreshMarketData` never rejects, and a
  failure is only logged (`warnRefreshFailure`), never shown, so it
  never turns a successful create/import into a shown error. `throttled:
  false`: a manual create/import is a deliberate user action, not a
  background poll, so it never reads the throttle cursor. An EDIT never
  needs this trigger — a holding's type and currency are immutable once
  created.

## Bulk insert: chunk when row count is caller- or API-controlled

SQLite (op-sqlite's bundled SQLCipher) caps bound parameters at
`SQLITE_MAX_VARIABLE_NUMBER` = 32766 per statement. A bulk insert
whose row count comes from an external source (an API page, a
user-picked file) can blow past that — the insert throws, the
transaction rolls back, and a swallowed error can make the failure
silent (this happened: a live Monobank refresh, back when it wrote
every ordered cross pair rather than one `X:UAH` row per priced
currency — ~11,990 rows x 5 params, overflowed the limit and rates
never saved). The chunking stays even though a live write is now only
~109 rows (kiko-pricing's "Currency-rate fallback chain") — it costs
nothing at this size and keeps the function safe against the same
bound-parameter limit regardless of row count. This is NOT because a
`.kiko` restore routes through `ratesRepo.upsertMany` — it doesn't:
`restore-snapshot.ts` normalizes and chunks `currencyRates` rows
itself, with its own `chunkForTable` call (see "Examples" below).

Rule: chunk with `chunkForTable(table, rows)`
(`src/db/chunk-for-table.ts`) — it derives the safe row-per-chunk
size from the table's column count — and issue every chunk inside
the SAME `db.transaction()`/`write()` call. Never hand-roll a fixed
row-count chunk; the safe size depends on the table's column count,
which only `chunkForTable` knows.

Examples: `ratesRepo.upsertMany` (`src/rates/repo/rates.repo.ts`) and the
shared `insertDedupRowsDatabaseTransaction`
(`src/transactions/repo/transactions.repo.ts`, called by both
`transactionsRepo.addManyDedup` and `importRows`) — the latter also
chunks its two per-row `inArray(...)` selects (the category-override
rule lookup and the existing-external-id lookup) directly at a safe
item-count margin, since a one-column `inArray` list has no table to
derive a column count from.

`rateHistoryRepo.upsertMany` and the restore-snapshot import path
have their own, older, pre-existing chunking — don't assume they use
`chunkForTable` too; check before touching either.

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
  to/from domain types (e.g. `balanceMinorUnits` -> `Money` via
  `holdingsRepo.balanceOf`, and a write input's `Money` -> minor
  units in `holdingsRepo.create`/`updateWithBalanceDelta`/
  `setSyncedBalance` and `accountsRepo.createCashAccount`,
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
   provider (see "Namespaced synced externalId" below) — by
   `addManyDedup` (`src/transactions/`). Two
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
   — Biome's `noConsole` is otherwise `error` project-wide (`biome.json`),
   so this is the one sanctioned console call in the app.
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
recover nothing. `lastFullSyncAt` now GRADUATES even on a partial
failure — see "Robust graduation: `failedSyncMonobankIds`" below; this
is a deliberate DIVERGENCE from `lastSyncAt`'s own partial-failure
discipline (see "Partial-progress resilience across cards" below), not
a copy of it.

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

The fix is `syncState.failedSyncMonobankIds` (per-connection; schema in
`src/db/schema.ts` — originally added as global `settings.failedSyncMonobankIds`
in migration `0023`, de-globalized to `syncState` by migrations `0027`/`0028`,
same as `lastFullSyncAt` above): a persisted set of Monobank account ids whose
statement fetch FAILED on the last run. The next run force-fetches
exactly those ids regardless of balance — the same carve-out shape as
the outstanding-hold case in "Balance-diff skip" above — while
`lastFullSyncAt` now graduates even when this run had a partial
failure, as long as it was a full fetch. A card is dropped from the set
the moment it succeeds, and the set is pruned to ids still present in
client-info (so a removed card is not force-fetched forever). Read
`nextFailedSet` and `isBalanceDiffSkip` (`src/monobank/`) for
the exact set algebra rather than a restated one here.

This is a genuine divergence, not a relaxation of the existing
discipline: the statement CURSOR (`syncState.lastSyncAt`) still advances
**only** on a fully clean run (unchanged "Partial-progress resilience
across cards" behavior below), so a force-fetched card's window is
re-derived from that un-advanced cursor and re-covered idempotently
(the `(source, external_id)` upsert). Only the full-fetch MARKER now
graduates early — the thing that was starving, not the thing that
protects against data loss. Read the end-of-run sequence in
`runSyncInner` (`src/monobank/`) for the exact ordering: the
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
when a token is stored) PLUS every connected crypto account — under
`Promise.allSettled`. So a crypto balance + Binance transaction import
now happens on app open, not only on pull. `useAutoSync` is throttled by
`throttleElapsed(syncState.lastSyncAt)` and never touches the pull spinner
signal (it reads no `fastPhaseDone`), so an app-open sync drives only the
determinate progress bar.

so two of them firing at once produced two concurrent runs, two
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
   `src/monobank/`. A path that registers ZERO work publishes
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

Read `runSync`/`runSyncInner` (`src/monobank/`) for the exact
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

## DB encryption (always on)

The SQLCipher database-encryption migration is **always on** —
`DB_ENCRYPTION_ENABLED` (`src/db/db-config.ts`) is `true` today, not a
rollout flag a build can ship off. This is a security invariant, not a
feature toggle (Guideline 5.6 sensitivity: a build/env flag that
changes what a user's data protection looks like must never ship in
the "off"/hidden state). Read these files directly rather than
trusting a restated summary here, since the exact migration steps are
the kind of thing that can still change:

- `src/db/db-config.ts` — `DB_ENCRYPTION_ENABLED`, the master switch;
  read the live value there rather than trusting this line if it
  drifts. Read the comment above it for what it gates. The app lock
  has no build-time switch of its own: it is a live `settings.lockEnabled`
  toggle read by `useAppLock` (`src/auth/use-app-lock.ts`) and the
  `AppLockSetting` settings card — see kiko-domain "App lock / security
  settings".
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
- `MigrationsGate` (`src/migration/`) — the launch sequencing: `initDatabase()`
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

See `kiko-domain`'s "Spending-exclusion pipeline" section for the
transfer-exclusion/internal-transfers/exchange-exclusion/loan-payments
module pointers — read it there rather than a duplicated list here.

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
- **Per-invocation pacing gate.** A first sync fans out many 89-day
  windows × two endpoints; fired back-to-back they trip a Binance
  weight-429. `runSync` builds ONE `createRequestGate` (the same helper
  Monobank uses, `src/monobank/`) from the injected
  `now`/`sleep` and threads it through EVERY deposit/withdraw page
  request, spacing them by `BINANCE_REQUEST_INTERVAL_MS` (small — a
  background import, not Monobank's 60s). `sleep` is a `BinanceTransactionSyncDeps`
  seam so a test paces instantly; there is no `gate` seam (same rationale
  as Monobank — the gate is built from `now`/`sleep`).
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
  `source: 'binance'` with `externalId`
  `` `${accountId}:deposit:<id>` `` / `` `${accountId}:withdraw:<id>` ``
  (the target account id, then Binance's own record id, falling back to the
  on-chain `txId`), imported through `transactionsRepo.addManyDedup`. The
  account-id prefix is REQUIRED, not cosmetic: Binance record ids are only
  PER-ACCOUNT unique, so on the GLOBAL `(source, external_id)` index a bare
  `deposit:<id>` would let a second Binance connection's upsert refresh the
  first's row (see "Namespaced synced externalId" below). A re-sync refreshes
  rather than duplicates. The withdrawal `applyTime` is a UTC datetime STRING, NOT
  epoch ms — `parseWithdrawTime` pins it to UTC (a bare `Date.parse` would
  shift it by the device's local offset). Amounts convert through
  `Money.fromMajor('BTC', …)`; the withdrawal network fee is excluded from
  the ledger line. The rows carry an EMPTY description, so the holding
  detail + Home lists render the shared income/expense default label; a
  bespoke "Deposit"/"Withdrawal" label is a deferred follow-up.

### Namespaced synced externalId (multi-account correctness)

The `(source, external_id)` unique index (`transactions_source_external`,
`src/db/schema.ts`) is GLOBAL — one keyspace shared across EVERY connection of
every provider. The multi-account plan lets a user connect more than one
Monobank and more than one Binance account, so a SYNCED row's `externalId` is
namespaced by its holding's account id: `` `${accountId}:${sourceId}` `` —
`` `${accountId}:${statementId}` `` for Monobank (`mapStatementItem`,
`src/monobank/`) and `` `${accountId}:deposit:<id>` `` /
`` `${accountId}:withdraw:<id>` `` for Binance
(`src/crypto-sync/binance/binance.transactions.ts`). Without the prefix, two
Binance connections — whose deposit/withdrawal record ids are only PER-ACCOUNT
sequences, NOT globally unique — could each emit the same `deposit:<id>`, and
the upsert would refresh the WRONG connection's row. Monobank statement ids are
globally unique, so its rows never collided, but they carry the same prefix for
one consistent shape. The write-time key and migration `0029`'s backfill produce
the IDENTICAL string (`account_id || ':' || external_id`, joining
`transactions.holding_id -> holdings.account_id`, idempotent behind a
`NOT LIKE account_id || ':%'` guard), so a re-sync of a pre-migration,
then-backfilled row matches in place — no duplicate insert. A `manual` row has a
null `externalId` and is never namespaced.

## Price data

See `kiko-pricing` for the currency-rate fallback chain (Monobank →
NBU → bundled fiat seed), the `price_points` table, and `PriceBook`.

- Writing a live refresh's rows: `ratesRepo.upsertMany` chunks via
  `chunkForTable` — see "Bulk insert: chunk when row count is
  caller- or API-controlled" above.
- Fiat cross rates, live: Monobank's `GET /bank/currency` (public,
  cert-pinned host, cached upstream about every 5 minutes) is the
  PREFERRED source, tried with a bounded retry. Only if that fails
  entirely does `src/rates/rates-refresh/rates-refresh.ts` fall back
  to NBU's current-rate feed (`src/rates/nbu-rates/nbu-rates.ts`,
  `bank.gov.ua`, deliberately UNPINNED, fewer currencies than
  Monobank). It's a sequential fallback, not a second concurrent
  source — only one provider's rows are composed and written per
  refresh; both failing writes nothing.
- Fiat cross rates, offline floor: a bundled STATIC seed,
  `src/rates/fiat-rate-seed/fiat-rate-seed.ts`, covers all 107 fiat
  currencies vs UAH from a Monobank snapshot (see the file for the
  capture date — it is a real, fixed date, not "current"). In
  `buildRateTable` (`src/rates/net-worth-view/net-worth-view.ts`) the
  seed is overlaid by live DB rows — `{ ...FIAT_RATE_SEED_TABLE,
  ...liveRows }` — so a live rate always wins per pair and the seed
  only fills a gap. This is a read-time overlay, never written to the
  DB, and is why a non-UAH fiat holding values correctly immediately,
  even fully offline on a fresh install before any live refresh has
  ever run. Crypto has no seed entry — see below.
- BTC price: CoinGecko free API, quoted in USD; derive other pairs
  from it. No offline seed for crypto; an unrated crypto holding is
  excluded until a live CoinGecko price lands.
- Store live results in `CurrencyRate`. Refresh on sync, throttled to
  respect each provider's own cache window — do not poll faster than
  the upstream cache refreshes.

## Statement import — column mapping

See `kiko-statement-import` for the format registry, encodings, the
detect → import pipeline, column mapping, saved mappings, and dedup.

## Data transfer (backup export/import)

`src/data-transfer/` implements the encrypted `.kiko` export/import feature:
`export-data.ts` / `import-data.ts` at the top, `crypto/envelope.ts` (AES-256-GCM
via `@noble/ciphers`), `snapshot/{read,restore}-snapshot.ts`,
`secrets/{read,restore}-secrets.ts`, `payload.d.ts` for the plaintext JSON
shape, and hand-rolled `utf8/utf8.ts` + `base64/base64.ts` codecs.

- **Every schema table must be in the snapshot.** `snapshot/data-snapshot.d.ts`
  (`DataSnapshot`) is the one list every table `db/schema.ts` exports must
  appear in. This is mechanized, not prose: `src/data-transfer/snapshot/
  snapshot-covers-every-table.test.ts` derives BOTH sides at runtime (Drizzle's
  `is(x, SQLiteTable)` over `schema.ts`'s exports vs. the live keys
  `readDataSnapshot()` returns) and fails the moment a new table is added to
  one side but not the other. Read that file for the current field list and
  its (currently empty) documented-exclusion array — do not copy the table
  list here.
- **Every Keychain secret class the export carries is read and restored.**
  `payload.d.ts`'s `ExportSecrets` covers `monobankTokens` and
  `binanceCredentials` only — the export never carries the SQLCipher DB key
  at all. `secrets/read-secrets.ts` reads both from the Keychain (skipping an
  account with no stored secret) and `secrets/restore-secrets.ts` restores
  both, each back to its original account id. `restoreExportSecrets` still
  never imports `db/keys/db-key.ts`: an older file that still carries a
  `dbKeyHex` field (from before that field was dropped) is read through
  as an unknown, unrestored property — re-storing a FOREIGN device's
  SQLCipher key into this device's own `kiko.db.key` Keychain item would
  brick the importing device's own encrypted database on its very next
  launch (wrong key at `resolveDbKey()`), which is why the field was
  dropped rather than kept display-only.
- **A legacy export missing a newer field must still restore.**
  `restoreExportSecrets` treats an entirely absent `secrets` object (an export
  written before the credentials toggle, or with it off) as a no-op, not an
  error — `import-data.ts` still restores `payload.tables` regardless. Follow
  the same pattern for any future field added to `ExportPayload`: make its
  absence in an older file a no-op, never a hard failure.
- **A legacy snapshot's missing `balanceSetAt` is BACKFILLED, not left
  `null`.** A build-25-shaped `.kiko` export has no `balanceSetAt` key at all
  on its holdings. `restoreDataSnapshot` (`snapshot/restore-snapshot.ts`)
  detects that with an `Object.hasOwn` check (an already-migrated snapshot's
  value, including an explicit `null`, is left alone) and reproduces
  migration 0036's own heuristic in JS. The rule itself stays stated in full
  only in `transactionsRepo.importRows`'s doc comment
  (`transactions/repo/transactions.repo.ts`). Generalize this: a migration
  that adds a column needing a backfill must apply the IDENTICAL backfill on
  BOTH paths that can produce a row missing it — the migration path itself
  and the restore/import path (`restoreDataSnapshot`) — never only one.
  Follow the `balanceSetAt` / `loan_interest` re-seed precedent above for the
  next such column.
- **A data-only cleanup migration follows the SAME two-path rule.**
  Migration `0040_cleanup_stray_deposit_bond_balance.sql` removes a
  pre-existing stray create-time artifact (a term_deposit/bond holding whose
  hidden Card balance field was carried into `balanceMinorUnits` before
  63f9073's fix, plus its matching `'manual'` opening transaction and
  `balanceSetAt` stamp) — data-only, no schema change, so it carries no
  `meta/NNNN_snapshot.json` (same as `0039_seed_loan_interest_category.sql`).
  It snapshots the qualifying set into a `CREATE TEMP TABLE ... AS SELECT`
  first so neither of the two mutating statements (the holding reset, the
  transaction delete) needs the ORIGINAL, about-to-be-mutated columns to
  still match — read the migration's own doc comment for the exact
  predicate and why it can only ever match the pre-fix bug, never a real
  balance (term_deposit/bond are ledgerless; every current write path either
  writes 0 unconditionally or never touches `balanceMinorUnits` at all).
  `restoreDataSnapshot`'s `withStrayDepositBondBalanceCleaned` mirrors the
  identical predicate in JS, applied AFTER `withLegacyBalanceSetAtBackfilled`
  so a legacy (pre-0036) snapshot's freshly-backfilled boundary still gets
  cleaned. Proven against the ACTUAL shipped SQL (not a restated predicate)
  by `drizzle/migrations/0040-cleanup-stray-deposit-bond-balance.test.ts`,
  which runs the real migration statements through `node:sqlite`
  (`DatabaseSync`, built into the Node 22 runtime this project already
  requires) — the strongest available evidence for a migration that
  deletes real rows, since op-sqlite itself is a native module unavailable
  under Jest; every other migration's test coverage here stays at the
  plumbing level (`run-migrations.test.ts`) or the restore-side JS mirror.
- **A launch-time upgrade step (not a migration) needs the SAME restore-side
  mirror as a migration's own backfill.** Migration 0041's flag
  (`settings.dedupKeysUpgraded`) and its launch-time rewrite
  (`upgradeStoredDedupKeys`) only run on live data — a `.kiko` restore
  REPLACES the whole `transactions`/`settings` tables, so a pre-0041
  export's legacy statement-import dedup keys need the identical rewrite
  applied on restore too. `restoreDataSnapshot`'s
  `withLegacyDedupKeysUpgraded` mirrors it: `Object.hasOwn` on the settings
  row detects the `dedupKeysUpgraded` key's PRESENCE (a pre-0041 export
  carries none at all), not its value — an already-0041-shaped snapshot's
  `false` (a device that hadn't upgraded yet) is left exactly as exported,
  since that device's own next launch runs the identical rewrite anyway.
  Applied AFTER `withStrayDepositBondBalanceCleaned`, to the FINAL
  transaction set that cleanup produces (a different table than the
  balanceSetAt/stray-balance backfills above, so order between them
  doesn't matter — it runs last only because it has to act on what's
  actually being inserted).
- **A value that lives inside `holdings.metadata` needs NO restore
  mirror.** A property's dated ownership share (`metadata.ownership`,
  kiko-pricing "Ownership share") rides in the opaque JSON column: a
  newer export restores it byte-identical, and an older `.kiko` has no
  key, which reads the whole asset — no migration, no `DataSnapshot`
  key, nothing in `restoreDataSnapshot`
  (`restore-snapshot.test.ts` pins both directions). An OLDER build
  restoring a newer export ignores the key and values the whole asset.
  Reach for metadata over a new table when the data is per holding,
  user-typed, and small; a new table (and its restore mirror) is for a
  series shared across holdings or bulk-written, like `price_points`.
- **No `TextDecoder`/`TextEncoder`.** Hermes has no working `TextDecoder`
  (confirmed on device — see `utf8/utf8.ts`'s header comment); use the
  hand-rolled `utf8Encode`/`utf8Decode` and `encodeBytesToBase64`/
  `decodeBase64ToBytes` instead. This is a Semgrep ERROR rule
  (`kiko-no-textdecoder-textencoder` in `rules/semgrep-mobile.yml`), not prose
  only.
- **Encryption envelope:** `crypto/envelope.ts` encrypts the JSON payload with
  AES-256-GCM under a fresh random 12-byte nonce per export; `decryptEnvelope`
  rejects an unrecognized `format`/`version` header before attempting to
  decrypt, and relies on `@noble/ciphers`' GCM tag verification to fail closed
  on a wrong key or tampered ciphertext — see the file for the exact error
  strings. State nothing about the envelope beyond what `envelope.ts` shows.

## Native iOS shell

`ios/Kiko/AppDelegate.swift` + `ios/Kiko/SceneDelegate.swift` implement the
mandatory UIScene lifecycle: `AppDelegate` builds the single `RCTReactNativeFactory`
and captures `launchOptions`, but `SceneDelegate` owns the actual `UIWindow` — it
constructs the window FROM the connected `UIWindowScene` and calls
`factory.startReactNative(withModuleName:in:launchOptions:)` from
`scene(_:willConnectTo:options:)`. A `UIWindow` not bound to a scene is never
displayed under this lifecycle. `applicationWillResignActive` /
`applicationDidEnterBackground` / `applicationDidBecomeActive` do NOT fire once
the app adopts the scene lifecycle — the privacy-overlay and backup-exclusion
logic use the `UIWindowSceneDelegate` equivalents (`sceneWillResignActive`,
`sceneDidEnterBackground`, `sceneDidBecomeActive`) instead. See
`ios27-crash-uiscene-lifecycle-gap` and `scene-lifecycle-appdelegate-window-crash`
in memory for the crash history this fixed.

- **Biometric Keychain reads need `NSFaceIDUsageDescription`.** A
  `BIOMETRY_CURRENT_SET` Keychain read SIGABRTs without it. Verify the key is
  present in `ios/Kiko/Info.plist` before adding or changing any biometric
  Keychain call (see memory `biometric-keychain-needs-nsfaceidusagedescription`).
- **`useAnimatedKeyboard()` is banned** — see `kiko-gestures`'s "`useAnimatedKeyboard()`
  is banned" section for why, and the Semgrep ERROR rule
  `kiko-no-use-animated-keyboard` (`rules/semgrep-prewrite.yml`) that enforces it.
- **Release-only crash classes.** Some crashes reproduce ONLY in a Release
  build, not Debug: a plain function used inside a worklet without the
  `'worklet'` directive (Debug swallows the mismatch, Release SIGABRTs — see
  memory `worklet-directive-debug-swallows-release-aborts`), and any code path
  Hermes handles differently from Debug's JSC-like behavior (see the Data
  transfer section above on `TextDecoder`/`TextEncoder`). Verify a fix for
  either class on an actual Release build, not just Debug/Jest.
