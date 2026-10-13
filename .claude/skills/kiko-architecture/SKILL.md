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
- op-sqlite (package.json version; verify there) bundles SQLite
  3.51.3 in both `cpp/sqlite3.c` and `cpp/sqlcipher/sqlite3.c`: JSON
  functions (built in since 3.38) and window functions (since 3.25)
  are available in migration SQL, and the podspec sets no OMIT flag
  for them. Write string literals in migration SQL with SINGLE
  quotes: op-sqlite's optional performance flags include
  `SQLITE_DQS=0`, which rejects double-quoted string literals (double
  quotes stay fine for identifiers).
- The schema is defined in TypeScript (Drizzle schema, not raw SQL).
  The `@kiko/db` barrel exports the tables flat (`export * from
  './schema'`) and also as a namespace (`schema`). Mock the connection
  with `jest.mock('@kiko/db/client')`. A test inside `src/db/` uses
  `jest.mock('./client')`, because B2 denies `alias-into-own-feature`.
- Generate migrations with `drizzle-kit` using `driver: 'expo'` —
  this is the correct driver value for op-sqlite migration
  generation, despite the name.
- `npx drizzle-kit generate --name <slug>` writes the `.sql`, the
  `meta/NNNN_snapshot.json` and the journal entry — and it also
  REWRITES `drizzle/migrations/migrations.js` wholesale, in its own
  formatting (verified: it clobbered the repo's import/export layout
  and dropped a comma-per-line style). Re-check that file after every
  generate, and run `./node_modules/.bin/biome check --write` (never `npx biome`: RTK
  rewrites it in agent Bash and it fails) over the generated
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
  upgrade rather than reintroducing dead cross rows.
- **A stored value that needs a hand-rolled zone reading, not just a
  flag flip, still follows the flag-plus-launch-step shape.** Migration
  `0043_add_import_times_rezoned` only adds
  `settings.import_times_rezoned` (defaulting to `false`) — a stored
  statement-import row's `time` was written as if its bank wall clock
  were UTC, and rewriting it needs a real zone reading no SQL
  expression can perform. `rezoneImportTimes`
  (`statement-import/rezone-import-times/`) runs after
  `upgradeStoredDedupKeys` in `MigrationsGate`, and again as the first
  step of `importParsedStatement` (refusing the import if the flag is
  still `false` afterward, so a new-convention row never lands next to
  a not-yet-rezoned one): reads every `source = 'import'` row's legacy
  `time` back as Kyiv time, the zone every named format (and a column
  mapping with no zone of its own) reads a wall clock in, so a rezoned
  row keeps the key a fresh re-import of the same file computes on any
  device (`planImportTimeRezone`, pure) — except a real `00:00:00` row,
  which a legacy row cannot tell from a date-only one, so it rezones to
  Kyiv noon; a re-import finds it there through its noon alias
  (`kiko-statement-import`'s "A real `00:00:00` row never duplicates"),
  then
  rewrites `time` and the dedup key's time token through a
  two-phase temp-key SQL update (SQLite checks UNIQUE per row even
  inside one UPDATE, so a direct final-key write can transiently
  collide with a row not yet rewritten), and moves a holding's
  `balanceSetAt` only when it equals one of that holding's OWN import
  rows' old time. `restore-snapshot.ts`'s `withImportTimesRezoned`
  mirrors the identical planner for a `.kiko` restore, applied after
  `withLegacyDedupKeysUpgraded` — unlike that mirror's presence-only
  check, it ALSO rewrites an explicit `false`, since a restore replaces
  the whole database and leaves no live device to retry on its own next
  launch.
- **A data-only migration that reassigns rows between tables follows the
  SAME derive-then-mutate, restore-mirrored shape.** Migration
  `0044_move_crypto_cash_holdings` (its own doc comment is the full
  statement of the matching rule, including the archived-source
  carve-out) moves a 1.0-era `cash` holding in a crypto currency onto a
  `crypto_asset` holding under a crypto account, keeping the holding's own
  `id` so every transaction, exchange leg, loan link, `price_points` row,
  and category override attached to it stays attached. Crash-safe,
  additive-then-mutate order (no delete): a TEMP table snapshots the
  affected holdings, a TEMP table captures the reuse target BEFORE any
  account is created (so a just-created account is never mistaken for a
  pre-existing one), an `INSERT` creates one `crypto-from-<source account
  id>` account per affected source needing its own, then one `UPDATE`
  moves the holdings. `run-migrations.ts`'s single transaction makes a
  crash mid-run roll back cleanly; a second run (or restoring an
  already-migrated export) finds the affected set already empty — every
  matching holding is already `crypto_asset` — so it is a true no-op, not
  an effect of the `INSERT`'s own conflict handling. `restore-snapshot.ts`'s
  `withCryptoCashHoldingsMoved` applies the IDENTICAL rule to a `.kiko`
  restore, sharing the SAME deterministic `crypto-from-` id so the two
  paths always agree on the same account for the same source.
  `0045_add_reminders` (additive: the `reminders` table and two
  `settings` columns) follows `0044` on `next`; `0046_add_quote_quota`
  (the `settings.quote_quota` column) follows it.
- **A column whose backfill SQL can derive adds it and backfills it in ONE
  migration, mirrored on restore.** `0047_add_sets_balance` adds
  `transactions.sets_balance` (the stored balance-set mark, kiko-domain's
  "A balance-set row is a STORED mark") and `holdings.balance_set_row_id` (the
  current set's row) and, in the same transaction, points each holding at
  its smallest-id row shaped like a balance-set row and dated at
  `holdings.balance_set_at`, then marks that row (its doc comment is the
  full statement). Additive only, so a crash rolls back to 0046 and retries
  whole. `restore-snapshot.ts`'s `withLegacyBalanceSetMarksDerived` applies
  the identical rule to a `.kiko` file whose rows carry no `setsBalance`
  key, after the 0040 stray cleanup and before the import-time rezone — the
  order a live device runs them. A two-path or migration test that reads
  `holdings` from a database migrated only through an older tag selects
  `columnsWithout(getTableColumns(holdings), 'balanceSetRowId')`
  (`src/test-support/real-sqlite.ts`). Proven on both paths by
  `drizzle/migrations/0047-add-sets-balance.test.ts` and
  `restore-sets-balance.two-path.test.ts`.
- **A NULL meaning replaced by a stored sentinel id is a kind-scoped
  data-only migration, mirrored on restore.** `0049` is hand-authored SQL
  with no snapshot: it sets `bank_id = 'other'` on `kind = 'bank'` rows
  with NULL and never touches a bank account naming a bank (a removed one
  too). `0051_monobank_accounts_bank_id` corrects it: one atomic, idempotent
  UPDATE sets `bank_id = 'monobank'` where `kind = 'bank'`, `institution =
  'monobank'` (the provider id the sync writes; Disconnect clears it) and
  `bank_id = 'other'`, because 0049 ignored `institution` and left a
  connected Monobank account as Other bank (no step order to protect, so no
  crash-safe ordering is needed). The mirror for both is
  `withBankAccountsBankIdBackfilled` in
  `src/data-transfer/snapshot/restore-snapshot.ts` (NULL or absent `bankId`
  becomes `other`, then `other` on a Monobank-connected account becomes
  `monobank`; it runs before `withImplicitAccountsMerged`, which never reads
  `bankId`); tests
  `drizzle/migrations/0049-bank-accounts-other-bank.test.ts`,
  `drizzle/migrations/0051-monobank-accounts-bank-id.test.ts` and
  `src/data-transfer/snapshot/restore-bank-other.two-path.test.ts`.
  **Wording note (the `0049` header comment is shipped and must not be
  edited, so the correction lives here):** a bank account stored with
  `bank_id = 'other'` ("Other bank") cannot be connected later, whether it
  was never connected or is a pre-`0051` ex-Monobank account that was
  disconnected before `0051` ran. The bank is chosen at create time and the
  field is locked afterwards (`account-form.screen.tsx`); Connect exists
  only for a provider bank. Any 0049 header wording that suggests an
  Other-bank account can be connected afterwards is wrong.
- **A uniqueness rule a merge must satisfy first is data merge, then
  partial unique index, in ONE migration.** `0050_implicit_property_debt_accounts`
  (its own header comment states the merge rule; for name/icon/color see
  `withDefaultIdentity` in the restore mirror below) merges the
  live property/debt accounts of a kind into the oldest, then creates the
  partial unique index `accounts_implicit_kind` (declared in
  `src/db/schema.ts`) LAST, so the index never meets a duplicate. The data
  part is hand-authored above the generated index line; after
  `drizzle-kit generate`, check the index kept its `WHERE`. The restore
  mirror `withImplicitAccountsMerged`
  (`src/data-transfer/snapshot/with-implicit-accounts-merged.ts`, called by
  `restore-snapshot.ts`; see "Data transfer") is mandatory: without it
  a `.kiko` with two property accounts fails on the index. Proven by
  `drizzle/migrations/0050-implicit-property-debt-accounts.test.ts`.
- **An index on a nullable column that a query filters with `IS NULL` is
  PARTIAL (`WHERE col IS NOT NULL`).** The app never runs `ANALYZE`, so SQLite
  has no row statistics and prefers an equality on the indexed column over a
  range on another index: a full index on `loan_holding_id` made the loan
  matcher (`loanMatchCandidatesQuery`, `loan_holding_id IS NULL AND time >= ?`)
  read nearly every row instead of using `transactions_time`. Pin every new
  index with an `EXPLAIN QUERY PLAN` test that builds the queries from the repo
  builders (no copied SQL) and asserts which index each query uses. Write the
  partial index in `src/db/schema.ts` with `index(...).on(...).where(sql\`...\`)`;
  if drizzle-kit wants a new migration for an unshipped one, hand-edit the
  unshipped `.sql` and snapshot and re-run `generate` until it reports no schema
  changes. Pointer: migration 0053 is the partial index
  `transactions_loan_holding_id`
  (`drizzle/migrations/0053-add-loan-holding-id-index.test.ts`).
- **A flag whose work SQL cannot do follows the flag-plus-launch-step
  shape.** `0048_add_lots_recosted` only adds `settings.lots_recosted`
  (`false`): re-costing a sale needs the BigInt decimal helpers, so the
  JS pass `recostStoredLots` runs it once at app open (see "A launch step
  cheap enough to run after the first paint" below). The next free
  migration index is one past the last `idx` in
  `drizzle/migrations/meta/_journal.json`; read it there.

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

**A create writes everything the user typed in its own `write()`.** The
icon (and color) are part of the create input: `holdingsRepo.create`,
`accountsRepo.createImplicitHolding`, `accountsRepo.create`, and
`accountsRepo.createCashAccount` insert them with the row. Never call
`setIcon` after a create: if that second write fails, the form shows the
save error with the row already stored, and the retry inserts it again.
A one-write create that fails leaves no row, so the retry is the first
attempt. `setIcon` on an EDIT is fine (it re-applies the same value on
retry). Tests: `holdings.repo.create-icon.test.ts` and
`accounts.repo.implicit-account.test.ts` (real SQLite, forced failure
after the row insert).

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
useLiveQuery(query, tables)
```

It:

1. Registers `db.reactiveExecute({ query: 'SELECT 1', arguments: [],
   fireOn: tables, callback })` — a CONSTANT trigger, never the real
   `query`/its params, on the same `fireOn` tables. op-sqlite
   would otherwise execute the real query on its worker and build a
   native HostObject per row on EVERY fire, purely to hand `callback`
   a result it never reads (see step 2) — a constant trigger still
   fires on the same writes for a fraction of the cost.
2. Awaits `query` itself (a thenable, mapped to the typed
   result shape Drizzle would have produced) once on mount and again
   on every `callback` fire — this is the ONLY place the real rows
   come from.
3. Unsubscribes on unmount.

`tables` is the list of table names the query depends on (matching
`fireOn`) — get this list wrong and the query either never refreshes
or refreshes on unrelated writes.

### `paused` vs `enabled`: a hidden-but-mounted tab defers reads, it does not disable them

Both options stop `useLiveQuery` from doing work, but for different
callers and with a different resulting contract — never substitute
one for the other:

- **`enabled: false`** (`LiveQueryOptions`'s sibling argument, not part
  of `LiveQueryOptions` itself) is for data the screen structurally
  does not need right now (a gate like `needsPriceBook`/loan-only
  reads — see "App-open and refresh work is gated on data presence"
  below). It skips the read AND the subscription entirely: `data`
  reads `[]`, `isLoading` reads `false`. The hook forgets the rows it
  read: flipping it back to `true` re-subscribes and re-reads from
  scratch, and until that read lands `isLoading` is `true`, `isFresh`
  is `false` and `data` is `[]` — never the rows from before the
  disable (a key that did not change in between, such as a
  parameterless read, would otherwise pass them off as the new
  read's result).
- **`paused: true`** (`LiveQueryOptions.paused`) is for a screen that
  is mounted but not visible right now — a background tab under a
  native tab bar, which stays mounted the whole time the app is open.
  The subscription STAYS (a write elsewhere still fires the reactive
  callback); only the READ that fire would start is deferred, and
  marks the query dirty instead. `data` keeps its last rows (never
  `[]`), `isLoading` stays `false`, and `isFresh` turns `false` for a
  dirty query (so a `backfillRanForSpanRef`-style effect guard —
  "Local state on a cached display screen follows the row" above —
  keeps working across a pause exactly the way it already does across
  an ordinary cached mount). Flipping back to `false` runs exactly ONE
  read if the query went dirty while paused, zero if it did not; the
  MOUNT read always runs regardless of `paused`, since a screen can be
  mounted unfocused (a deep link, a restore) and still needs its first
  real data. Toggling `paused` never re-subscribes. `statistics.screen.tsx`,
  `home.screen.tsx` and `accounts.screen.tsx` pass `paused: !isFocused`
  (`useIsFocused` from `@react-navigation/native`) to every one of their own
  `useLiveQuery`/price-book calls; each screen's test pins that no call
  skips the flag and that a write made while hidden shows only once the tab
  regains focus. `enabled: false` unsubscribes and
  returns `[]`, the wrong contract for a tab that stays mounted and must
  show its last rows the instant it regains focus — use `paused`, not
  `enabled`, for a hidden-but-mounted tab.

  **Device check** (a real device or profiler catches what a mocked Jest
  test cannot): 10 fast/slow Home↔Statistics switches show no blank frame;
  a profiler on a debug build shows no Statistics render/memo work while
  hidden during a Home sync; a dirty return shows exactly one update and
  the JS-thread stall it causes on a 3-year ledger; a clean return shows
  exactly one recompute (check whether the net-worth line's own animation
  replays); no backfill request fires while hidden, only after the fresh
  read lands; an unfocused mount still loads its charts.

### Home reads a windowed ledger, not every transaction

The ledger grows with every transaction ever synced, and a read of it
re-runs on every transactions/holdings/accounts write. Home therefore
reads three queries on those tables instead of one whole-ledger list:
`transactionsRepo.listWithContextBetweenQuery(from, to)` (the picked date
range's rows, the screen's own inclusive day-aligned bounds, an
`undefined` side open-ended; ordered `time desc` on the
`transactions_time` index, so same-time rows keep their order),
`contextSpanQuery()` (earliest and latest time of the whole
ledger, for the date-range field) and `contextCategoriesQuery()` (each
stored category once, newest-first, for the category filter). Those two
aggregates are the only things Home needs from rows outside the range, so
the window needs no earlier rows. The JavaScript range filter stays, and
the screen test's mock answers the three queries by `kind`; the real SQL
is pinned against a full-ledger filter in
`transactions.repo.home-window.test.ts`.

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

Every `useLiveQuery` (and `useCurrentPriceBook`/`usePriceBook`, which wrap one) starts
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
  a plain `!loadingFlags.some(Boolean)`, no latch. The flip lives in
  the right layer (`useLiveQuery` itself, per-key, above): in
  holding-detail the ACCOUNT query's own `isLoading` flips back to
  `true` the instant it re-keys off the just-loaded holding, so the
  gate is not-ready for that render with no latch. The gate also goes
  not-ready again after it was ready whenever a query re-keys on
  something the user picks or on the clock. A screen that would rather
  keep its content mounted then latches its own first ready and gates
  EACH re-keyable value locally, never by the latch: Home does, because a
  date-range pick, a Clear and the local midnight re-key its windowed
  ledger read, and the first priced holding (metal, property,
  loan), a restore and the local midnight turn on or re-key its price
  book. Swapping the whole screen for the spinner would drop its filter
  bar and the open range sheet, so the list shows a `LoadingState` for
  its window read and the net-worth card shows one for the price book:
  the headline and the breakdown never render while that read loads,
  because an empty book values a metal at its cost and a loan without
  its payments, which is a wrong balance. A query turned on again
  (`enabled` flipping back to `true`) reads as loading with `data` `[]`
  until its new read lands, so the book is empty until then; a query
  that RE-KEYS (the day roll, a picked date range) still holds the
  previous key's rows while the new key loads (the price book holds
  the earlier day's rows after a day roll). The screen must
  never show either (or the EMPTY state) under the new key: Home keeps its
  list mounted (it carries pull-to-refresh and the large-title scroll
  target), gives it no sections, and renders the `LoadingState` as its
  empty component until the read lands. The screen's first load per mount
  still gates the whole screen.
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
  LOGS the failure through `logFailure` (`@kiko/diagnostics`), tagged
  `[useLiveQuery] query failed: <sql>`: the placeholder text from
  `toSQL()` and the error's name and code, never the params or the
  message (kiko-compliance "5.1.5 / data storage"). So a `useDataReady`
  gate never spins forever on a genuinely failed query; it just never
  shows the raw error either (no consumer reads `error` today). A
  rejection for a KEY THAT JUST CHANGED (the previously applied key
  differs from this render's) also resets `data` to `[]` — it must not
  keep showing the OLD key's rows as this key's result; a rejection
  against the SAME key that was already applied keeps that previous
  data, matching what a same-key success does.

`useCurrentPriceBook(enabled?, options?, loanPaymentsEnabled?, now?)`
(`src/prices/use-current-price-book/`), and `usePriceBook(...)` for past
days (`src/prices/use-price-book/`), return `{ book, isLoading }`, not a
bare `PriceBook` — every consumer destructures
`const { book: priceBook } = useCurrentPriceBook();` (or additionally
`isLoading: priceBookLoading` when gating). Each runs TWO live reads —
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
`holdingsRepo.changeLots` while the holding form is closed) leaves that
key's entry one read old. A one-shot form seed (`hydrated` latch)
reading it would latch the stale row, and Save would write it back over
the newer one — this shipped as a data-loss bug (edit metal, cancel,
add a lot, edit again, Save: the new lot was gone). Forms,
statement import, `useTargetHoldingOptions`, `useBondIsinMode`, and
every other one-shot seed never pass `cached`. An uncached seed is still
one read old once a background write can land while the form is open:
the bond edit form fires the register refresh, whose backfill can add
`payments` to the very row the form seeded, so the bond edit saves
through `holdingsRepo.updateMetadataFromStored` and takes that key from
the row re-read inside its own write.

**A Save that derives a stored value from a query waits for that
query.** Disable Save while the query's `isLoading` is true; saving
early writes a value built from missing data (the loan edit once saved
before the price book loaded and wrote a permanent manual point).

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
`sortEnabled={isFresh}` (only Categories adds `&& categories.length > 1`), and Categories' move-to-top/bottom
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
  (`src/rates/open-currencies-gate/`) is `refreshRates`'s
  (`rates-refresh.ts`) own gate. It resolves `{ needsFiat,
  cryptoCurrencies }` from a single `settings` read plus
  `holdingsRepo.openCurrenciesQuery()` (a `SELECT DISTINCT currency`
  over ACTIVE holdings — open, and whose account is not archived,
  mirroring `activeHoldings`). The fiat leg (Monobank/NBU) runs only
  when `needsFiat` — some active holding's currency differs from the
  base (display) currency, which also covers the crypto leg's own
  USD:UAH anchor need, since a held crypto currency always differs
  from a fiat base. The crypto leg (CoinGecko current price) runs
  only for `cryptoCurrencies`, and `fetchCryptoPrices` fetches only
  those currencies, never the full supported set. `runBackfill`
  (`history-backfill.ts`) reads the sibling `historyCurrencies()` gate
  instead, scoped to EVERY holding (open and closed — the net-worth
  line's past buckets still need a closed holding's own currency
  converted): the same gate pattern, not a per-call-site copy, but its
  own `{ fiatCurrencies, cryptoCurrencies }` result, fetched by
  `fetchCryptoHistory` (and NBU history) for those currencies only.
  `refreshMetalPrices`
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
  The history backfill's resume cursor is PER CURRENCY, not one shared
  max(day) across every stored row:
  `resolveResumeCursor` (`src/rates/history-backfill/history-backfill.ts`)
  takes the OLDEST last-backfilled day among every currently-held
  currency — every fiat currency `historyCurrencies()` reports (the
  held fiat set, not a hard-coded USD/EUR pair — see kiko-pricing's
  "History backfill"), plus every held crypto — fed by
  `deriveLastBackfilledDayByCurrency(historyRows)`. A currency with no
  stored day at all forces the whole span from the earliest day, same
  as before; the fix is that a currency which already HAS some rows
  but fell behind (its own provider leg kept failing while a DIFFERENT
  currency's leg kept succeeding and advancing the shared max to
  today) is no longer masked by that other currency's progress — the
  minimum always reflects the most-lagging held currency, so its own
  gap keeps getting re-derived and re-fetched on every run instead of
  going permanently stale. That minimum is itself OVERRIDDEN by an
  explicit `null` from the caller's own `lastBackfilledDay` — the signal
  `planBackfillRun` sends when an older transaction extends the
  transaction span earlier than any prior run covered, which the
  per-currency minimum alone cannot see (kiko-pricing's "History
  backfill" section has the full rule). A currency whose providers all answered for
  the whole span but returned no row for it (a held coin CoinGecko
  never returns) is kept in an in-memory `knownEmptyCurrenciesThisRun`
  set and excluded from that minimum, so Statistics does not refetch
  the full span on every focus (a rejected leg is never recorded — it
  retries; nor is a coin whose OWN CoinGecko request failed while
  another coin's succeeded: `fetchCryptoHistory` settles per coin and
  returns `failedCurrencies` beside its `entries` — `runBackfill` itself
  reports `'failed'`, never `'complete'`, whenever an attempted
  currency's fetch failed and nothing composed for it this run (see
  kiko-pricing's "History backfill" section for the full outcome rule).
  The metal twin, `emptyBackwardFloorByMetal`,
  records only an ANSWERED empty backward range — a failed request
  throws before it is recorded). A create/restore
  that may add the first holding of a new currency or type triggers
  these gated refreshes WITHOUT awaiting them, so Save never blocks on
  the network.
- **`useCurrentPriceBook`'s and `usePriceBook`'s `enabled` argument**: `useLiveQuery`'s own
  `enabled` parameter (default `true`) skips BOTH the query and the
  reactive subscription while `false`, reporting `data: []` and
  `isLoading: false` — ready, never stuck (a gated-off screen must
  still flip its overall readiness, never spin forever on a query it
  deliberately never ran); turning it on again reads as loading with no
  rows until the new read lands, never the rows read before it was
  turned off. `usePriceBook(enabled)` forwards straight
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
- **The first add triggers the gated refresh**: a user's own holding
  write that can change what is priced runs
  `refreshMarketData({ throttled: false, metals: true })`
  (`src/sync/refresh-market-data/`) right after the write commits. Rule:
  every user write that can add, re-date, or re-source a priced holding
  or lot calls it. Find the current callers with
  `git grep -n 'throttled: false, metals: true' src`. Restoring a `.kiko`
  export (`importData`, `src/data-transfer/import-data.ts`) calls
  `refreshMarketData` itself. None of these runs through the sync
  fan-out that otherwise triggers this, so the price/rate appears without
  an app restart. Every step gates itself, so this is a no-op when
  nothing is needed; it never rejects, and a failure is only
  logged, never shown, so it never turns a successful save into a shown
  error. `throttled: false`: the write is a deliberate user action, not
  a background poll. Any other edit needs no trigger: a holding's type
  and currency are immutable once created.
- **`refreshMarketData` steps**: rates and metals; the `metals` option
  gates the second. Read each call site
  (`grep -rn "refreshMarketData(" src`) for its own flags.
- **Reminders re-plan**: `syncReminders` reads
  `remindersRepo.hasAnyQuery()` (`LIMIT 1`) before any plan-input query
  — see "Reminders (local notifications)". `drainReminderResponses` runs
  before it and touches the database only when the native queue holds
  responses (`recordEngagements` returns early on an empty list).

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
shared `upsertDedupRowsDatabaseTransaction`
(`src/transactions/repo/transactions.repo.ts`, called by both
`transactionsRepo.addManyDedup` and, through
`insertDedupRowsDatabaseTransaction`, `importRows`) — two shared helpers
also chunk a per-row `inArray(...)` select directly at a safe item-count
margin (the category-override rule lookup in `withCategoryOverrides`, the
existing-key lookup in `partitionNewRows`), since a one-column `inArray`
list has no table to derive a column count from.

`rateHistoryRepo.upsertMany` and the restore-snapshot import path
have their own, older, pre-existing chunking — don't assume they use
`chunkForTable` too; check before touching either.

## Help (the tips are removed)

- The first-use tips were removed by user ruling ("Hints still look bad, let's remove them for
  now"): no tips feature folder, no tip card component, no dismiss-tip or reset-tips settings function, and the Help
  page has no "Show tips again" button. Do not bring a tip or hint back without asking the user.
- `settings.dismissed_tips` (a JSON `string[]`, migration 0055, `src/db/schema.ts`) is kept but
  unused: no reader and no writer. Migration 0055 already shipped and migrations are
  additive-only, so the column stays instead of a new migration dropping it. A backup still
  carries and restores it (`TAKEN_FROM_FILE_ON_RESTORE` in `src/db/settings-columns.test.ts`,
  `src/data-transfer/snapshot/restore-dismissed-tips.test.ts`), and
  `DOCUMENTED_READERLESS_COLUMNS` lists it. A new reader
  of it needs the user's approval first.
- Any condition or empty state that depends on a query must include that query's loading
  state, the same as the `useDataReady` rule above; otherwise it flashes while the query loads.
- `hasNoAccounts` (`src/holdings/implicit-account/`) drives the
  no-accounts empty state. `openAccountForm`
  (`src/navigation/open-account-form/`) takes
  `Pick<NavigationProp<TabParamList>, 'navigate'>` and makes one
  cross-tab navigate; its test uses the real-router helper
  `src/test-support/real-tab-navigator.tsx`.
- `src/help/help-topics.ts`: one `topicsById` entry per topic;
  `HELP_TOPICS` is derived from it.
- A new `settings` column also needs: the demo `.kiko` fixtures
  regenerated (`KIKO_REGEN_DEMO=1 npx jest
  e2e/screenshot/fixtures/generate-demo-kiko.test.ts`, as in commit
  62e7664b), the `migrationCount` in
  `src/data-transfer/crypto/envelope.test.ts` bumped, and, until the
  first `src/` reader lands, an interim entry in
  `DOCUMENTED_READERLESS_COLUMNS` (`src/db/settings-columns.test.ts`)
  that the task adding that reader removes.

## Repository module shape

One functional module per entity: each `*.repo.ts` under `src/` ends
`satisfies Repository` (`src/db/repository.d.ts`); grep that for the
current set. A repository is a plain module of exported functions,
not a class.

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
   - A NEW external id first **adopts** a stored statement-import twin
     (same holding and signed amount, within ±60 s): `addManyDedup` only,
     never `importRows`, in the same `write(...)`. The import row becomes
     the sync's own in place (one UPDATE by its id) and the input is not
     inserted or counted. No `holdings` row is written. The rule and its
     residual live in `pairSyncInputsWithImportRows`'s header
     (`src/transactions/sync-adoption/`) and in kiko-statement-import.
   - Re-syncing an existing external id **refreshes** the row's
     bank-owned columns (the settled amount and `hold` among them)
     and **never** its `category` or `comment` — the category may be
     the user's own override or a name-rule rewrite. Read
     `addManyDedup`'s `onConflictDoUpdate` set for the exact
     refreshable columns, and `transactions.hold` in
     `src/db/schema.ts` for why a pending item is imported at all.
     Its `setWhere` is DERIVED from that same `set` list
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
when a token is stored) PLUS every connected crypto account — under
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
   - every crypto/exchange holding a `runBalanceSync` upserts (Binance
     Spot/Funding/Earn, or a wallet) — a crypto sync has NO balance-diff skip,
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
  state rather than data loss. A missing Keychain key with an encrypted
  file already on disk and no populated `kiko.db` beside it is never
  "fresh install": a new key would not open that file and would brick it,
  so `establishKey` probes both files BEFORE `migrateLegacyDatabase()`
  (which would rebuild a populated `kiko.db` from a surviving `pff.db`
  and hide the loss) and throws `DatabaseKeyMissingError` (no key
  generated or stored, no file created or deleted); `MigrationsGate`
  shows `migrations.keyMissing` and the next launch retries. "Encrypted
  file exists" is a `react-native-fs` path check on op-sqlite's base
  directory OR a keyless open, because a failed open cannot tell an
  absent file from an unopenable one. The only delete of an existing
  encrypted file is in the populated-`kiko.db` branch: `kiko.db` is
  removed only after the copy is verified (and a new key stored), and
  the app opens the encrypted file only after that, so a populated
  `kiko.db` (and ONLY `kiko.db`) means the encrypted file beside it
  never served the app. It is a partial, empty, or keyless leftover of
  an interrupted export (a kill after `ATTACH` leaves an empty file
  that even the stored key opens), never to be trusted, so the build
  path deletes it and re-exports. That holds with or without a stored
  key: `resolveDbKey` rebuilds whenever the encrypted file is gone OR
  `kiko.db` holds user tables, an UNREADABLE `kiko.db` count counting
  as "holds data" there (the rebuild then fails safely, before any
  delete; the no-key guard counts it as "no data" and refuses)
  (`buildEncryptedDatabase(storedKey)`, the first-launch path under the
  EXISTING key, which is never stored again): `migrateLegacyDatabase()`,
  export, verify (the key opens the copy, it holds tables; its own
  error text names the export, not the stored key), then delete the
  plaintext. An empty plaintext yields a fresh encrypted database.
  `pff.db` never decides this: it is the OLDER safety net, so beside a
  present encrypted file it now comes only from the OLD delete order
  (kiko.db first, before this branch) or from a pff.db delete that
  throws, and rebuilding from it would replace newer data.
  `removeLeftoverPlaintext` therefore deletes `pff.db` BEFORE `kiko.db`,
  and throws if either file is still on disk afterwards (op-sqlite's
  remove ignores failures, and a surviving populated `kiko.db` would
  make a later launch delete an encrypted database already in use).
  With a key present, the file on disk, and no populated `kiko.db`, the
  key just has to open that file (first read, opened with
  `failOnCreate` so the proof can never create an empty keyed file)
  before the plaintext residue is scrubbed; a 0-table file is accepted
  there, because a fresh install killed before its migrations is
  legitimately empty. A failure's message carries the cause's own
  message, because `MigrationsGate` shows only `error.message`.
  Known limits (reviewed 2026-10-09), each as state; consequence; why
  not fixed:
  1. Keychain key really gone (access-group or signing change,
     Keychain reset); `DatabaseKeyMissingError` every launch, no in-app
     recovery, data stays on disk; a new key cannot open the file, so
     stopping is the only safe action.
  2. op-sqlite base folder moves (App Group added later) and the keyless
     open fails on a present file; the no-key path treats the file as
     absent and stores a new key over it; unreachable without a config
     change (comment at `encrypted-database.ts` ~:50-57).
  3. Spurious "item not found" read in the key-store crash window, then
     `setGenericPassword` fails to delete K1; the proof fails every
     launch, plaintext kept, generic error until the key matches; no
     data lost; native Keychain behaviour.
  4. Encrypted file with no tables (or 0 bytes) and no plaintext data is
     accepted; a truncated real file cannot be told apart from a fresh
     install killed before schema migrations; the loss already happened
     and nothing recoverable is deleted.
  5. `kiko.db` table count stays unreadable while a key is present;
     launch blocked with a generic error until it reads; deliberate
     fail-closed.
  6. iCloud restore of an old backup (the encrypted file is excluded
     from backup); rebuilt from the restored plaintext, data as of the
     backup; newer data was never in the backup.
  7. Plaintext file that exists but cannot be opened, or survives its
     delete; launch throws "could not be removed" until the delete
     succeeds; deliberate, so a surviving `kiko.db` can never trigger
     deletion of a database in use.
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
NOT one aggregated "Binance BTC" holding. The
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
  rather than clobbering it with a fabricated 0, and logs one `logFailure`
  (`@kiko/diagnostics`: the wallet in the tag, the error's name and code
  only). A successful read of 0 writes 0
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
holding already exists. It is SUPPLEMENTARY — the arm runs it under
`logOnFailure('[binance sync] capital history failed', …)`
(`@kiko/diagnostics`, name and code only), so a 429 or a permission gap never
fails the balance sync. TRADES are deliberately out of scope for this
milestone; only DEPOSIT and WITHDRAWAL history is imported.

Load-bearing rules, verified in `binance.transactions.test.ts` rather
than restated here:

- **Two signed reads.** `GET /sapi/v1/capital/deposit/hisrec` and
  `GET /sapi/v1/capital/withdraw/history`, both `coin=BTC`, both fetched
  by `binance.history-client.ts` and signed through `signedRequestPage`
  (`binance.client.ts`), the same HMAC as the balance reads (read-only key).
  The history reads (`fetchDepositHistory`, `fetchWithdrawHistory`) live in
  `binance.history-client.ts`, not `binance.client.ts`, and return a
  `HistoryPage` of strictly parsed rows; a malformed record throws
  `BinanceHistoryParseError`, so the window stops and the cursor stays (spec
  section 7, "Strict capital parse").
  Each client call is ONE offset page of ONE window; the offset-paging
  lives in `binance.transactions.ts`, not the client. The walk shared by
  every Binance history walk lives in `binance.history-walk.ts` (read it for
  its exports: `planWalkPasses`, `runWalkPlan`, `walkSpans`,
  `buildWalkWindows`, the mark readers/writers, `btcSatoshis`,
  `BinanceWalkStop`); the per-record commits live in
  `binance.history-records.ts` (`settleRecords`, `commitSettledSpan`). The
  capital caller is `binance.transactions.ts` (`WINDOW_MS`, `MAX_WINDOWS`,
  `MAX_PAGES_PER_WINDOW`), the Pay caller `binance.pay-history.ts`
  (`PAY_WINDOW_MS`, `MAX_WINDOWS`; see "Binance Pay" below). The Transfer
  caller is `binance.transfer-history.ts` (`syncBinanceTransferHistory`, run
  third in `run-crypto-sync.ts`; see "Binance Transfer" below); the paging
  helpers live in `binance.history-paging.ts` (`fetchAllByTotal`,
  `readSeriesSpan`) and the write seam in `binance.walk-write-deps.ts`
  (`BinanceWalkWriteDeps`).
- **Two passes per walk; 89-day windows on capital and Pay, 30-day on Transfer.**
  The Transfer walk reads 30-day windows within a six-month floor
  (`TRANSFER_WINDOW_MS`, `transferFloorMs`). Binance rejects a `startTime`/
  `endTime` span of 90 days or more and caps a page at 1000 rows
  (`HISTORY_PAGE_LIMIT` in `binance.history-client.ts`); every walk
  reads windows under 90 days. A run is the FORWARD pass (the cursor to
  now, moving the cursor) and the window RE-SCAN (a stored mark; never
  writes the forward cursor). The capital, Pay and Transfer walks all
  run it. `WalkPass` is `'forward' | 'pending' | 'rescan'` (read it in
  `binance.history-walk.ts`); a run reads the forward pass, the owed
  ranges (`pending`, in a round-robin from the range cursor), the re-scan,
  then the owed points last.
- **One pacing gate per run.** `createBinanceHistoryRun`
  (`binance.history-budget.ts`) builds ONE `createRequestGate` (the helper
  Monobank uses, `src/monobank/`) plus the run budget; `runCryptoSync`'s
  Binance arm passes that `run` to `syncBinanceTransactions`, which waits on
  `run.gate` before EVERY history page, spacing them by
  `BINANCE_REQUEST_INTERVAL_MS` (a background import, not Monobank's 60s).
  The clock and `sleep` are inputs to `createBinanceHistoryRun`, not
  `BinanceTransactionSyncDeps` seams, and there is no `gate` seam (same
  rationale as Monobank).
- **The watermark: a walk-owned key on the Spot holding's metadata, NOT
  `sync_state`.** `sync_state.last_sync_at` already means the Monobank
  statement-window cursor for a Monobank account (the table's own doc
  comment in `db/schema.ts`; no crypto-sync code has ever read or written
  it), so the history walk does not reuse it — the same reasoning that
  puts a balance sync's own `SYNCED_AT_FIELD` stamp on the holding rather
  than `settings.lastSyncAt`. The watermark instead lives at
  `holdings.metadata.binanceHistoryCursor` on the Spot holding (the one
  deposits/withdrawals attach to): "every window ending at or before this
  instant is imported." `binanceWalkCursorOf(field, metadata)`
  (`holding-metadata.ts`) and `holdingsRepo.setBinanceWalkCursor`
  (`holdings.repo.ts`) are the reader/writer. The plan comes from
  `planWalkPasses` (`binance.history-walk.ts`; read its input type for the
  cursor, re-scan cursor, point cursor, pending list, floor, window and
  `RESYNC_OVERLAP_MS`). The capital walk feeds it
  `planCursor = cursor ?? latestTransactionTime ?? null`, so a LEGACY holding
  (transactions, no watermark yet) starts from its newest imported row and
  adopts the watermark at its first committed window; a first sync walks from
  the 2017 floor. The forward pass starts at `max(floor, cursor)`. The
  re-scan covers `[base, forward start)` with
  `base = max(floor, min(end - window, forward start - RESYNC_OVERLAP_MS))`,
  kept in its own mark (one per walk; read `binanceWalkCursorFields` in
  `holding-metadata.ts` for the keys); it stores the floor
  when finished, and a mark behind the base starts a new pass.
- **`upsertByMetadataKey` carries the watermark across a balance sync.** A
  balance sync's own upsert (`runBalanceSyncInner` -> `upsertExchangeMany`)
  writes a FRESH `{ syncedAt }` metadata object on every run, for every
  provider — a blind overwrite that would otherwise wipe
  `binanceHistoryCursor` the instant the NEXT balance sync ran (the
  Binance arm always runs balance-then-history in the same invocation, so
  this bites on literally every subsequent sync). The upsert reads the
  stored row's metadata inside the same write and carries over any
  `carriedMetadataKeys` entry (read it in `holding-metadata.ts`: the walk
  cursors `binanceWalkCursorFields`, the owed lists `binanceWalkPendingFields`,
  the point cursors `binanceWalkPointCursorFields`, the range cursors
  `binanceWalkRangeCursorFields` and the span hints
  `binanceWalkSpanHintFields`, plus a reopened
  Monobank card's `statementFromMs`):
  `withWalkOwnedMetadataCarried` ALWAYS overwrites the target's own key
  with the stored value when the stored row has it, regardless of
  whether the caller's object also set that key; every other key is still
  fully replaced exactly as before. The two lists differ on purpose:
  `withWalkOwnedMetadataResetToFloor` (the Binance disconnect) resets only
  the Binance walk keys and never touches `statementFromMs`. A
  wallet holding never carries either kind of key.
- **Per-record commits, crash-safe.** The walk goes oldest -> newest.
  Rows commit (`transactionsRepo.addManyDedup`) BEFORE the mark moves
  (`setBinanceWalkCursor`) — separate writes, so a crash between them
  re-imports idempotently rather than losing progress. In the pending pass
  and the re-scan one list write follows the rows (the read span out, its
  points in), then the mark. A stop tied to one record with a time inside
  the span owes only that record's point; any other stop, or a record with
  no usable time, owes the whole span; every record the walk can trust
  imports either way. The forward pass leaves a span uncommitted on any
  stop, except in the Transfer lane, where a stop tied to one transfer with
  a usable time owes that point and the span commits (`TRANSFER_FORWARD_OWES`). `setBinanceWalkCursor` also
  gates the write on the holding's OWN account still being
  `institution = 'binance'` (joined in the same query) and is a no-op
  otherwise — a walk holds the account's credentials for its whole run, so
  a disconnect can commit while a window write is still in flight; without
  the gate that late write would resurrect a forward watermark over the
  floor `resetBinanceWalkCursors` just wrote (see below).
- **A per-lane call budget, refreshed from Binance's own headers.**
  `createBinanceRunBudget` (`binance.history-budget.ts`) caps each
  `BudgetLane` at its `LANE_CALL_CAPS` entry and charges `COSTS` per call.
  The UID reading is `X-SAPI-USED-UID-WEIGHT-1M` (parsed by
  `usedWeightsFromHeaders` in `binance.client.ts`, returned as
  `HistoryPage.usedUidWeight1m`) against `UID_WEIGHT_BUDGET_1M`; the IP
  reading is checked against `IP_BUDGET_1M`. Deposits are bounded by the IP
  reading, not by a call cap. A window whose withdrawals cannot be FULLY
  paged within the remaining budget is not committed and not marked; the
  next run redoes it from the same, unmoved watermark.
  The budget keeps calls for later passes: `RESCAN_KEEP` and `POINT_KEEP`
  (`binance.history-walk.ts`) are the calls an owed range must leave for
  the re-scan and for the points, and `canAfford` takes the calls to keep.
  `syncBinanceTransactions` returns the `WalkResult` `{ imported, complete }`
  (`binance.history-walk.ts`) — `complete: false` means history remains
  behind and a later run (or sync press) resumes from the marks.
- **A thrown error under `src/crypto-sync` is a named class with a fixed
  message.** Semgrep `kiko-no-literal-sync-error` flags
  `throw new Error(<literal>)`, and `logFailure` logs only the error's name.
  Example: `BinanceHistoryParseError` in `binance.history-client.ts`.
- **A 429/418 sets a per-account cooldown and stops cleanly, without
  failing the balance sync.** `signedRequestPage` (`binance.client.ts`)
  throws `BinanceRateLimitError(status, retryAfterMs)` for a 429 or 418,
  checked BEFORE the body is read (`retryAfterMs` from `Retry-After`,
  seconds -> ms, defaulting to 60s on a missing/non-positive header). The
  cooldown (`binance.cooldown.ts`'s `setBinanceCooldownUntil` /
  `isBinanceCoolingDown`) is SHARED between the history walk and the
  balance sync — a 429/418 from EITHER path means the same UID is over its
  weight budget. The walk catches ONLY this error type, sets the cooldown
  to `now + retryAfterMs`, and returns `complete: false` without
  rethrowing — every EARLIER window's commit stays in place. Any OTHER
  error still rethrows (unchanged: the Binance arm's `logOnFailure`
  logs it and never fails the balance sync). The balance sync
  (`binanceProvider.fetchBalances`) checks the SAME cooldown before its
  first request and makes ZERO Binance requests while it is active
  (returning no balances — a quiet skip, never a thrown error, so a
  history-walk-caused cooldown can never fail the balance sync); a 429/418
  from the Spot balance request ITSELF also sets the cooldown and is
  surfaced as the localized `accountDetail.binanceRequestFailed` message
  (never the raw `BinanceRateLimitError` text) — Spot's failure still
  fails the whole balance sync, per its own strict rule above.
- **Disconnect resets the walk keys, not the whole metadata object.**
  `disconnectCryptoAccount`'s Binance path
  calls `holdingsRepo.resetBinanceWalkCursors(accountId, HISTORY_FLOOR_MS)`
  (built on `withWalkOwnedMetadataResetToFloor`) BEFORE `accountsRepo.disconnect`
  — a failure after the reset only causes a harmless, idempotent re-walk
  from the floor. It touches ONLY the walk keys: each cursor in
  `binanceWalkCursorFields` already present is set to `HISTORY_FLOOR_MS`, each
  owed list in `binanceWalkPendingFields` to `[]`, and each point cursor in
  `binanceWalkPointCursorFields`, `binanceWalkRangeCursorFields` and
  `binanceWalkSpanHintFields` is DELETED (no key = before the oldest point
  or range, no span to resume). A cursor is never deleted: a DELETED cursor falls back
  to the legacy `latestTransactionTime` cursor, which a reconnected
  DIFFERENT Binance account would inherit as if it were its own
  already-imported history, silently skipping that account's own older
  records. `binanceAsset`/`walletAddress` are untouched, so a SAME-account
  reconnect still re-adopts the holding (`upsertByMetadataKey`'s
  match-by-key) and simply re-walks from the floor. Connecting a DIFFERENT
  Binance account afterward walks its own history from the floor instead
  of inheriting a stale, forward watermark.
- **A BTC wallet re-sync fetches every OPEN holding's stored address.**
  `bitcoinWalletProvider` (`src/crypto-sync/btc-wallet/`) syncs the Connect
  address first, then each open holding's stored address (a closed holding's
  address is never sent to the explorer), one request at a time, all-or-nothing:
  the first failure throws and the orchestrator upserts nothing. A wallet
  whose stored addresses are all closed re-syncs nothing (an empty result,
  not an error); only a wallet that never stored an address throws.
- **The lagging-history caption.** `isBinanceHistoryBehind` /
  `walkCursorsOf` (`screens/account-detail/crypto-sync-section/binance-history-status.ts`)
  derive purely from the account's own `holdings` (already a screen prop —
  no extra query): `walkCursorsOf` reads the four forward cursors (capital, Pay,
  Transfer, Earn) off the holding that carries `binanceHistoryCursor` (only Spot
  ever does; four nulls when none does), `isBinanceHistoryBehind`
  compares them against `latestSyncedAt(holdings)` (the existing balance-sync
  stamp), true when ANY walk never caught up (`null` cursor) or is behind by more than
  a day, false before the account's own first balance sync. An owed point never
  shows it (user ruling: the caption is about the cursors). `CryptoSyncSection`
  renders the `accountDetail.binanceHistoryPending` caption under the
  status line only when `connectedProvider === 'binance'`, so a wallet
  account never evaluates or shows it.
- **Settled records only, on the wallet Binance names.** Only a credited
  deposit (`status === 1`) and a completed withdrawal (`status === 6`) are
  imported. `walletOf` in `binance.transactions.ts` places each row by
  `walletType`: 0 or absent is Spot, 1 is Funding, any other value stops the
  walk (`capital-wallet-unknown`). The stop codes are the `BinanceWalkStop`
  codes (`binance.history-walk.ts`; the spec lists them): read them there. The wallet holding is found by `binanceKeyOf`
  (`binance.holding-keys.ts`) and, only for a row whose key is new, created
  at zero by `holdingsRepo.ensureExchangeHoldings` (insert-only); a row
  already stored keeps its holding. Earn gets no capital rows.
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

### Binance Transfer

The Transfer walk (`binance.transfer-history.ts`) imports BTC transfers between the user's own
wallets on the same two passes (see above), in 30-day windows (`TRANSFER_WINDOW_MS`) within a
six-month floor (`transferFloorMs`). One window is one read per transfer type (the series;
`callsOf` counts them, `LANE_CALL_CAPS.transfer` in `binance.history-budget.ts` caps the lane). A
record imports only at `TRANSFER_SETTLED_STATUS`; BTC only. The stop codes live in
`binance.transfer-history.ts`; the design is in the spec and plan named under "Binance Pay".

- **Transfer forward stops (O1, Transfer lane only).** A stop tied to ONE transfer with a usable
  time is owed at that transfer's own point and the forward pass goes past it
  (`TRANSFER_FORWARD_OWES`:
  `transfer-failed`, `-not-settled`, `-type-mismatch`, `-id-missing`,
  `-amount-invalid`, `-row-unreadable` with a `timestamp`): the span's other
  transfers commit, the cursor moves on, the point stays owed until the
  transfer settles or the floor drops it. `commitSettledSpan` still stops the
  forward pass (R28) for any stop that owes more than a point: a row with no
  usable time (it owes the whole span), `transfer-page-drift`,
  `transfer-holding-missing`, a record outside the span. Pay and capital keep
  the A2 stop (every stop holds the cursor).

### Binance Earn

The Earn walk (`binance.earn-history.ts`) imports BTC Simple Earn history on the same shared walk
(see above and "Binance Transfer"), in 30-day windows (`EARN_WINDOW_MS`) from `EARN_FLOOR_MS`
(2022-01-01). One window is one read per record kind (`EARN_SERIES`: the flexible and locked
rewards first, then subscriptions and redemptions; `callsOf` counts them, `LANE_CALL_CAPS.earn`
caps the lane). It keeps six walk-owned keys on the Spot holding (`BINANCE_EARN_*_FIELD`:
forward cursor, re-scan, pending list, point cursor, range cursor, span hints), carried on a
balance sync and dropped on a disconnect through the field arrays. The stop codes live in
`binance.earn-history.ts`; the design is in the spec (section 6, matrix E1-E27) and the plan.

- **A reward group is ONE record.** Binance gives a reward no id: the rows of a group
  (`rewardGroupsOf`: product, project or position, type, time) are numbered from 0 by satoshis,
  so one member that cannot be trusted stops the whole group (a member left out would shift the
  numbers of the others and a later read would write a second row). A reward row the client could
  not read blocks every reward group of its kind at that time, with one point owed.
- **Settled status, per record kind (OVERNIGHT DEFAULT 23, pending user).** A subscription
  settles on `SUCCESS` (`EARN_SUBSCRIPTION_SETTLED_STATUS`), a redemption on `PAID`
  (`EARN_REDEMPTION_SETTLED_STATUS`; a redemption is never `SUCCESS`). `FAILED` is a final
  failure: ignored, nothing owed. Any other value (`PURCHASING`, `CREATED`, unknown) is
  `earn-not-settled`, owed at its point, and so is a locked redemption whose `isComplete` is
  `false` (left out or `true`: no effect).
- **Placement.** Flexible `REALTIME` rewards go to the Earn holding, flexible `BONUS` and every
  locked reward to Spot. A flexible redemption goes to its `destAccount`. A locked redemption
  record has no destination field, so its `type` decides (OVERNIGHT DEFAULT 24, pending user):
  `MATURE` ("redeem to Spot Wallet") goes to Spot; `NEW_TRANSFERRED`, `AHEAD`, any other type or
  none is `earn-redemption-type-unconfirmed`, owed at its point, no row (Q14: never an assumed
  wallet). A subscription imports from `sourceAccount` or the split only when its `type` is in
  its product's list (`WALLET_FUNDED_SUBSCRIPTION_TYPES`, one constant, per product: flexible
  `NORMAL` or `AUTO`, locked `NORMAL` only; OVERNIGHT DEFAULT 24 extended, pending user); any
  other value (a locked `AUTO`, most likely the auto-renewal at maturity, `RESTAKE`, `TRIAL`,
  `ACTIVITY`, `CONVERT`, `LOAN`, `AI`, `TRANSFER`, unknown) or none is
  `earn-subscription-type-unconfirmed` the same way, because the money of those types is not
  documented to come from the wallet `sourceAccount` names. A field
  the walk decides by (a split amount, those `type`s, `isComplete`) that is present with another
  JSON type is an unreadable row, never absent. These type points are permanent: Binance fixes a
  record's `type` when it creates it, so such a point never imports by itself; it waits for the
  user's answer or the probe (task 7/7) and stays owed meanwhile (the Earn floor never moves for
  it). Flexible `REWARDS` rewards and a reward that rounds to 0 satoshis stay stopped (user
  rulings pending).
- **Earn forward stops (OVERNIGHT DEFAULT, pending user, 2026-10-13).** The Earn forward pass
  follows the Transfer rule: a stop tied to one record with a usable time is owed at its own point
  and the cursor goes past it (`EARN_FORWARD_OWES`, one constant: emptying it restores R28 for
  every stop). A span stop (`earn-page-drift`, `earn-holding-missing`) and a row with no time keep
  R28.

### Binance Pay

The Pay walk (`binance.pay-history.ts`) imports BTC Pay orders on the same
two passes as the capital walk (see above). Design: spec section 4
(`docs/superpowers/specs/2026-10-09-binance-pay-history-design.md`); plan
`docs/superpowers/plans/2026-10-10-binance-history.md`. Read the spec for the
stop codes and scenario rows.

- **The owed list.** Each walk keeps one walk-owned list of owed ground
  (`binanceWalkPendingFields`, `holding-metadata.ts`): a range (no `kind`) or
  a point (`kind: 'point'`); the kind alone tells them apart. At most
  `MAX_PENDING_RANGES` ranges (`binance.history-walk.ts`; the two nearest
  merge); a point is never merged with, held by or dropped with a range;
  equal points are one.
- **Canonical points.** A stuck record owes `[t - 1, t + 1]` (Pay, a
  deposit) or `[T - 1000, T + 1000]` (a withdrawal, whose `applyTime` may be
  cut or rounded to the second); never cut to the span.
- **The point-leave rule.** A point leaves only when a WINDOW read to its end
  holds all of it and returned a record whose own point equals it (a point
  window's progress across runs is the resume below), or by the floor.
  A read that returned nothing, only neighbours, or a span holding part of it
  keeps it. A range with no record leaves once read. A record is told by its
  point, not an id: a trusted twin at the same millisecond lets the point
  leave though the stuck record was never returned (a filter mismatch); spec
  VERIFY 14 is a merge blocker for it (the point would have to carry the
  stuck record's identity).
- **Round-robin over points.** One point cursor per walk
  (`binanceWalkPointCursorFields`) holds the start of the point read last; it
  moves once a point read starts, finished or not. Each of P points is read
  within `ceil(P / L)` runs whose forward pass leaves a call (L >= 1, the
  points such a run reads). A malformed cursor is repaired at once and logged
  (`point-cursor-malformed`). The rotation is deterministic and bounded; a
  random or fail-closed-by-length rotation has no testable bound.
- **Round-robin over owed WINDOWS (R31) and span hints (R32).** One range
  cursor per walk (`binanceWalkRangeCursorFields`) holds the END of the window
  of a range read last; `planWalkPasses` builds the windows of all owed ranges
  first (oldest first), and the pending pass reads the windows that start AT OR
  AFTER the cursor first (`windowsFrom`), then wraps. It rotates windows, not
  ranges: a range longer than a window whose first window is owed whole every
  run merges back and starts before the cursor, so a rotation over ranges
  reads that window every run and starves the ones behind it. `>=`, not `>`:
  the next window starts exactly at the cursor, and `>` skips every second
  window of a long range. The cursor moves once a window's read has started,
  finished or not. Each of W owed windows is read within `ceil(W / L)` runs
  that enter the pending pass (L >= 1, the windows such a run reads). A
  malformed cursor is repaired at once and logged (`range-cursor-malformed`).
  One hints key per walk (`binanceWalkSpanHintFields`) holds, per pass (forward, pending, re-scan,
  point), the narrowest span a window was left at when `walkSpans` stopped
  before any span committed; a window whose start the hint HOLDS
  (`hint.start <= window.start < hint.end`, `holdsStart`) begins with what is
  left of it from its own start (never wider than the window), and it drops
  when a span of the window commits (for a point window it becomes a resume,
  below) or no window of the pass holds its start. A containment, not an equal
  start: the start of a re-scan window (`endTime - windowMs`) and the cut start
  of an owed range at a Pay or Transfer floor move with the clock every run, so
  an exact match would drop the hint every run and the halvings would restart
  forever. A point window takes only an exact start (its point never moves,
  and two points' windows overlap). A window that needs h halvings commits
  its first span within h + 1 runs of one read each, at any gap between runs
  (the properties run at 0, an hour and a day). A malformed value is
  ignored, stored over at once and logged (`span-hints-malformed`).
- **A point window keeps its progress across runs (R34).** A point leaves
  the list only when its WHOLE window was read to its end, so a window left
  after some spans committed would start over every run. `walkSpans` reports a
  `resume` in the hint then (`BinanceSpanHint.resume`: `from` = the next
  span's start, `returned` = the points of the records the committed spans
  returned, `stuck` = the ground the untrusted ones owe, `series` = the series
  the window was read in); `runWalkPlan` keeps it for the points list ONLY
  (the other passes keep progress in their cursor, list and re-scan mark; the
  parser drops a resume found in another list). The next run begins at `from`
  and folds `returned` and `stuck` into what it hands `onComplete`, so the
  point-leave rule above holds across runs. `hintsOfPlan` drops a resume made
  for other series than the window has now (`isHintOf`): it would skip ground.
  A malformed resume makes the whole value malformed (`span-hints-malformed`).
  A point window whose first span needs h halvings, one span a run, completes
  within 2h + 1 runs, while no later span comes back full (a later span that is
  too full halves again, one more run a halving).
- **STOP_ENDS_PASS and R28** (plan OVERNIGHT item 17). `STOP_ENDS_PASS` (`binance.history-walk.ts`) says a stop
  in the forward pass ends only that pass, so the run goes on to the owed
  ranges, the re-scan and the points; the cursor never passes a stuck record
  (but see the Transfer ruling next); a budget or rate limit ends every read.
- **R13.** Pay direction comes from the uid alone (`payDirection`): payer id =
  uid is out, receiver id = uid is in.
- **C1.** The Pay walk does not read the capital cursor (spec section 4).
- **Wallets.** Sends (R20, B5, B7; B4 stops funds that are not BTC on sends
  only): `walletType` 2 is Spot, 1 Funding, 5 Earn, any other untracked
  (`walletOf`). Receives (R22, B6) are placed by DATE:
  before `PAY_RECEIPTS_TO_SPOT_FROM_MS` (2026-09-29T00:00Z) Funding, from
  then Spot.
- **Ruling A.** A non-BTC order the user paid with BTC funds
  (`pay-btc-funded-other-coin`) is owed at its own point in the pending pass
  and the re-scan and the other orders import; the forward pass keeps the A2
  stop (cursor unmoved).
- **Announcement.** Binance's January 2027 Funding -> Spot auto-migration:
  https://www.binance.com/en/support/announcement/detail/01cbe42ead1e4f1a9382363754d2eb5a
  (source checked 2026-10-11). The 2026-09-29 Spot-from-date comes from a different
  announcement (spec), which needs its own check date.
- **Open probe items** (range-end semantics per endpoint, the withdraw filter
  field and `applyTime` rounding, late Pay orders, the migration's transfer
  history shape): the spec's "VERIFY gate" and the plan's probe items list
  them.
- **Disconnect and carry** are the capital rules above: the balance sync
  carries the cursors, lists, point cursors, range cursors and span hints;
  disconnect resets them.
- **Delete notice.** A same-currency linked transfer's confirm uses
  `transactions.deleteLinked.transfer`, `.transferUnlinked` and
  `.transferUnlinkedPlain` (`src/transactions/remove-notice/remove-notice.ts`).

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
- Store live results in the `currencyRates` table (row type `CurrencyRateRow`,
  `src/db/schema.ts`). Refresh on sync, throttled to
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
  Read `payload.d.ts`'s `ExportSecrets` for the classes it carries: the
  per-account `monobankTokens` and `binanceCredentials`. The
  export never carries the SQLCipher DB key at all. Secrets are written only
  with the credentials toggle on. `secrets/read-secrets.ts` reads every class
  from the Keychain (skipping an account with no stored secret) and
  `secrets/restore-secrets.ts` restores each account secret back to its
  original account id — a legacy file that still carries the removed
  `eodhdKey` imports fine, the key ignored and never written to the
  Keychain. A restore keeps this device's live `settings.lockEnabled` (the app lock is turned off only after
  `confirmOwner` in Settings, so a file never decides it), and
  `settings.notificationsDeliverableSince` (when iOS first allowed
  notifications on this device), never the file's. They are the one list
  `KEPT_FROM_LIVE_ON_RESTORE` (`src/db/kept-from-live-on-restore.ts`), read
  by `restore-snapshot.ts` and by `settings-columns.test.ts`, which
  classifies every settings column as kept-live or from-file. A file with
  no key for one of them, or no settings row at all, still keeps the live
  value: the restore always inserts the live settings row. `restoreExportSecrets` still
  never imports `db/keys/db-key.ts`: an older file that still carries a
  `dbKeyHex` field (from before that field was dropped) is read through
  as an unknown, unrestored property — re-storing a FOREIGN device's
  SQLCipher key into this device's own `kiko.db.key` Keychain item would
  brick the importing device's own encrypted database on its very next
  launch (wrong key at `resolveDbKey()`), which is why the field was
  dropped rather than kept display-only.
- **The `secrets` block is validated BEFORE the restore, not during it, and
  reads tolerantly.** `importData` writes the Keychain items after
  `restoreDataSnapshot` commits, so a malformed block (`isExportSecrets`,
  `secrets/is-export-secrets.ts`: a field that is present with the wrong
  shape, checked through a `Record<keyof ExportSecrets, …>` so a new field
  needs its own check) is refused as "not a valid Kiko export file" while the
  live database is still untouched. A field a file lacks is not a fault:
  a missing or empty `monobankTokens`/`binanceCredentials` means no
  secrets and the restore goes on, and a secret whose account the file does
  not carry (an account deleted before the export) is dropped by
  `restoreExportSecrets(secrets, accountIds)` with no error. A new secret
  class in `ExportSecrets` extends that guard in the same change. A Keychain
  write that fails after the commit is not an import failure:
  `restoreExportSecrets` never rejects, tries every secret on its own, and
  resolves with the connections it could not write (`'monobank'`,
  `'binance'`); `importData` returns them as
  `unrestoredCredentials`, still runs the market refresh and the loan
  auto-link, and the screen shows the success plus a line naming the
  connections to set up again.
- **A legacy export missing a newer field must still restore.**
  `restoreExportSecrets` treats an entirely absent `secrets` object (an export
  written before the credentials toggle, or with it off), and a missing or
  empty array in it, as a no-op, not an error — `import-data.ts` still restores `payload.tables` regardless. Follow
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
  next such column. `transactions.setsBalance` and
  `holdings.balanceSetRowId` (migration 0047) follow it: a file whose
  rows carry no `setsBalance` key gets the migration's own marks and
  current-row ids (`withLegacyBalanceSetMarksDerived`); a row or holding
  that carries its key restores it as exported, so a mark on a since
  re-dated row survives an export round trip. Both fields ride inside their
  `transactions`/`holdings` rows, so they need no `EXPORT_VERSION` change:
  an older build ignores the keys (Drizzle inserts only its own schema's
  columns), and this build derives them for an older file.
- **`transactions.exchangePairId` (migration 0052) follows the same two-path
  rule.** The migration pairs a leg with a row only where the stored data proves
  it, 1:1 (read `drizzle/migrations/0052_add_exchange_pair_id.sql` for the full
  rule), with an `UPDATE ... FROM` over a derived table. A `.kiko` file whose
  rows carry no `exchangePairId` key gets the same ids from
  `withLegacyExchangePairsDerived` (`snapshot/restore-snapshot.ts`); a row that
  carries the key restores it as exported, a null included. Never change one
  path's rule without the other.
- **A new table with no backfill is the table, in order, on both paths.**
  `0054_add_deleted_import_keys` (the stored key of every deleted import row,
  per holding; kiko-statement-import has the rule) is additive only: past
  deletes are unknowable, so there is no data step and no derived mirror. Its
  foreign key to `holdings` is NO ACTION, so the order carries it: a holding
  or account delete removes the keys first (`removeHoldingDatabaseTransaction`,
  `accountsRepo.remove`). A write that moves a holding's balance anchor (a
  closing balance that applies, a hand-set balance, the bank figure of a sync)
  clears all its keys in the same write
  (`clearDeletedImportKeysDatabaseTransaction`): the sync clears but never
  reads them, so it never revives a row. A restore (`restoreDataSnapshot`) deletes the
  table BEFORE `holdings` and inserts it AFTER them, skipping a key whose
  holding it did not insert, with `?? []` for a file without the key (the
  snapshot field is optional). The composite primary key is its only index.
  Proven by `drizzle/migrations/0054-add-deleted-import-keys.test.ts` and
  `src/data-transfer/snapshot/restore-deleted-import-keys.test.ts`.
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
  under Jest; `applyAllMigrations`
  (`src/test-support/real-sqlite.ts`) applies every shipped migration
  to `node:sqlite` in journal order; a new migration's test uses it
  (see `src/db/schema.reminders.test.ts`).
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
- **A launch-time upgrade step whose rewrite needs a real zone reading
  gets the SAME restore-side mirror, applied AFTER the dedup-key
  upgrade.** Migration 0043's flag (`settings.importTimesRezoned`) and
  its launch-time rewrite (`rezoneImportTimes`) only run on live data —
  a `.kiko` restore REPLACES the whole `transactions`/`holdings`/`settings`
  tables, so a pre-0043 export's legacy (wall-clock-as-UTC) import times
  need the identical rewrite applied on restore too.
  `restoreDataSnapshot`'s `withImportTimesRezoned` mirrors the SAME pure
  planner (`planImportTimeRezone`) the launch step runs, applied to the
  FINAL settings/transactions/holdings sets `withLegacyDedupKeysUpgraded`
  produces. UNLIKE that mirror's presence-only check, this one ALSO
  rewrites an explicit `false` — a restore replaces the whole database,
  so there is no live device left to retry the rewrite on its own next
  launch, and the restored database must be final at once.
- **A launch step cheap enough to run after the first paint is an
  `AppRoot` effect, and its restore mirror is the same function called
  from `importData`.** Migration 0048's flag (`settings.lotsRecosted`,
  `false` by default) and `recostStoredLots` (`src/holdings/lot-recost/`,
  kiko-pricing's "Stored lots are costed again once per device"):
  `useLotRecost` runs it from an `AppRoot` effect in `App.tsx`, which fires
  after the screens' own effects, so their first reads queue ahead of it on
  op-sqlite's one worker thread; after the first run an open reads one
  flag. The lots and the flag commit in ONE `write`, re-reading both inside
  it, so a crash or a failed write leaves the flag unset and the next open
  starts over; it never rejects (a failure is logged). A restore carries
  no planner: a backup without the key restores the flag as `false`, and
  `importData` awaits `recostStoredLots()` right after the restore, before
  any screen reads the restored lots.
- **A migration that reassigns rows between tables gets the SAME
  restore-side mirror, run FIRST.** Migration 0044 moves a 1.0-era `cash`
  holding in a crypto currency onto a `crypto_asset` holding under a
  crypto account — a `.kiko` restore REPLACES the whole `accounts`/
  `holdings` tables, so a pre-0044 export's stray crypto cash holding
  needs the identical move applied on restore too, or it would land back
  in a state no create path allows. `restoreDataSnapshot`'s
  `withCryptoCashHoldingsMoved` applies the SAME reuse-or-create rule,
  sharing the SAME deterministic `crypto-from-<source id>` account id the
  SQL migration derives, so both paths pick the same account for the
  same source. A restore of an already-migrated export is a no-op
  because its affected set is empty (no `cash` holding in a crypto
  currency is left; `restore-snapshot.ts`'s early return), not because
  of the shared id. Runs FIRST (before `withLegacyBalanceSetAtBackfilled` and
  every later backfill), feeding its own output into every step after it,
  since it is the one step that can add a NEW account row.
- **A merge migration's restore mirror covers every row it re-points or
  deletes, and a two-path test proves it on ONE seeded database.**
  `withImplicitAccountsMerged` (`snapshot/with-implicit-accounts-merged.ts`)
  applies migration 0050's steps to the snapshot: holdings, reminders, the
  `reminderOfferDismissals` map, AND the `syncState` rows of a merged-away
  account (its foreign key would fail the insert), so it takes all five
  row arrays and returns the same references when no kind has 2+ live
  accounts. Unlike the migration (which reset every live implicit account's
  name, icon and color, before a user could rename one), a restore keeps a
  lone account's name, icon and color, and resets them (sentinel name, NULL
  icon and color) only on the KEPT account of a merge, so one custom name or
  glyph never stands for several former accounts. It runs right after `withBankAccountsBankIdBackfilled` (a live device
  runs 0044, 0049, 0050, 0051; the bank id rule never reads what the merge
  writes), and its output feeds every later
  step. It compares ids with `<` and `>`, never `localeCompare`, because
  that matches SQLite's BINARY collation for ASCII and UUID ids, and a
  `created_at` tie must pick the same kept account on both paths. The
  returned `accountsRestored` counts the accounts inserted AFTER the merge.
  `snapshot/restore-implicit-accounts.two-path.test.ts` seeds one pre-0050
  database, runs the real 0050 SQL on it (path 1), exports it first with
  `readDataSnapshot` and restores that into a fresh database (path 2),
  then compares accounts (the lone-account seed differs on purpose in name,
  icon and color only), holdings, transactions, price points, sync state,
  dismissal kinds (sorted) and reminders without `activeSince` and
  `lastSnoozedAt`, which a restore restarts by design. The seed holds a
  three-way tie whose ids differ by case, so a `localeCompare` fails it.
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
- **A migration forces an `EXPORT_VERSION` decision.** A build refuses a file
  whose `version` it does not read, which keeps an older build from restoring
  a newer file and then running a launch-time upgrade (the import-time
  rezone) a second time on data that already had it. A new reader keeps
  reading the older versions (`READABLE_EXPORT_VERSIONS`). `envelope.test.ts`
  pins the version to the migration count at the last decision, so a new
  migration fails it until the version is bumped or the count is recorded
  with the reason no bump is needed: a column riding inside an existing row
  and derived on restore needs none, and neither does an idempotent data
  rewrite that the restore mirror re-applies to an older file (0049, 0050, 0051).
  The decision per migration is recorded in `VERSION_DECISIONS` in
  `src/data-transfer/crypto/envelope.test.ts`, which is where to read it (see
  `VERSION_DECISIONS` for the recorded kinds). A new
  table the file carries as an OPTIONAL snapshot key (0054's
  `deletedImportKeys`) needs none either: an older build drops the key and
  keeps its old rule, and this build restores an older file with the table empty.
  A column riding inside an existing row that the restore leaves null (0056
  `untrackedCounterpart`) or fills with its schema default (0055 `dismissedTips`)
  because no older build ever wrote it needs none either. Known cost: a
  downgrade round trip (new file -> older build -> export -> new build) drops the
  value; accepted, since a bump would make an older build refuse every new file.
  Any migration that changes the snapshot shape (a new table, a column on any
  table, a changed default) must, in the same commit: regenerate the demo
  `.kiko` (see kiko-compliance's demo fixture section for the command), add a
  `VERSION_DECISIONS` comment and bump `migrationCount` in
  `src/data-transfer/crypto/envelope.test.ts`; the scoped jest run must include
  `e2e/screenshot` and `src/data-transfer/crypto`.

## Reminders (local notifications)

`src/reminders/` owns user-set local reminders. Each unit's header
comment holds its rules; this section says where each part lives and
what a change must keep.

- **Storage.** Table `reminders` (`src/db/schema.ts`): one row per
  `(account_id, kind)` (unique index `reminders_account_kind`;
  `account_id` is NOT NULL, so there is no global reminder), a NO
  ACTION foreign key to `accounts`. `schedule` is the whole
  `ReminderSchedule` as JSON; the planner re-validates it with
  `isReminderSchedule`, since a restored row may carry another build's
  shape. `last_snoozed_at` is the latest "Tomorrow" tap while that
  snooze is still pending. Two nullable `settings` columns hold state
  that is not a rule: `reminder_offer_dismissals` (JSON map account id
  -> dismissed kinds; `settingsRepo.dismissReminderOffer` /
  `isReminderOfferDismissed`; `recordReminderOfferDismissal(databaseTransaction,
  accountId, kind)` is the same read-modify-write inside a caller's own
  `write()`) and `notifications_deliverable_since`
  (`settingsRepo.notificationsDeliverableSinceQuery` /
  `setNotificationsDeliverableSince`). Read `schema.ts` for the
  columns; do not copy them here.
- **Repository.** `remindersRepo` (`src/reminders/repo/reminders.repo.ts`).
  Page reads: `listByAccountQuery`, `byIdQuery`, `hasImportQuery`
  (`LIMIT 1`, any holding of the account; only the after-import offer
  reads it), `listWithAccountQuery`
  (every reminder with its account's name/institution/archivedAt, in
  accounts-list order: `sort_order`, `created_at`, `id`; it reads no
  transactions, so the list subscribes to `reminders` and `accounts`
  only), and `manualEntryDaysQuery(accountId,
  since)` (see "Offer"). Restore: no repository method:
  `restoreDataSnapshot` inserts each restored reminder with `activeSince`
  set to the restore time and `lastSnoozedAt` null, the pause and
  engagement columns kept, inside its own transaction. User writes: `create`,
  `update` (a changed schedule restarts `activeSince` and ends a
  back-off pause, but not a user pause; it keeps a pending snooze,
  because iOS keeps it), `setPaused` (resume restarts `activeSince`; a
  no-op when already in the target state), and `remove` (one `write()`:
  `DELETE ... RETURNING` the account and kind, then
  `recordReminderOfferDismissal` for the deleted row, so the offer for
  that kind never returns on that account; an unknown id records
  nothing). Re-plan side: `hasAnyQuery`, `planInputsQuery`,
  `recordEngagements`, `markBackoffPaused`, `clearSnoozes`. Read the
  file for signatures.
- **Rules.** `src/reminders/rules/` is pure.
  `eligibleReminderKinds(account)` takes the account's `kind` and
  `institution`: an import reminder is allowed on every BANK account no
  sync owns (`kind === 'bank' && !isSyncedAccount(account)`, user
  decision 2026-10-01), ones with no import yet included, and on no
  other account, since only such an account takes a statement import
  (`account-detail.screen.tsx` shows Import and handles the
  `importStatement` intent only there, and `importRows` refuses a
  synced account); add-transactions reminders need a non-synced account
  of any kind.
  The scheduler's `isSchedulable` uses the same function (with
  `planInputsQuery`'s `accountKind` column, since that row's `kind` is
  the reminder's), so a reminder the page shows as unavailable is never
  scheduled. With no
  import yet, an import reminder plans as usual with a null day count
  (body `reminders.notification.statementImportBodyNoData`); the first
  import is its first `lastDataAt`. The form draft helpers are exported
  from `src/reminders/rules/reminder-draft.ts` (read it for the current
  set). `withFrequency` preselects today's weekday when switching to
  weekly and 7 when switching to every-N-days. The interval field's
  plural "days" suffix takes its count from `everyDaysPluralCount` (the
  typed text), not from the validated interval, so the unit agrees with
  what the user typed even out of range. The page
  lists eligible kinds plus any saved kind that is no longer eligible.
  A saved reminder on a synced account is unavailable, of either kind;
  `reminder-row.component.tsx`'s `unavailableCaption` shows
  `reminders.unavailable.statementImport` or
  `reminders.unavailable.addTransactions` per kind. A synced account of
  any kind (a Monobank bank, Binance, a BTC wallet) has no eligible
  kind; with no saved reminder either, its page shows the caption
  `reminders.emptyNoKinds` instead of rows.
- **Summary.** `describeSchedule(schedule, t, firstDay, clock)`
  (`src/reminders/schedule/describe-schedule.ts`) reads the time on the
  device's clock (`clock` from `useTimeClock`; see "Time of day" in
  kiko-translator). The uk preposition comes from `{{at}}` and follows the
  hour as shown (`hourOnClock`), choosing between `reminders.schedule.at`
  and `reminders.schedule.atEleven`; the uk "о"/"об" rule itself lives in
  kiko-translator ("Time of day") — read it there.
- **Shared system status.** Any cached OS/system status (a permission,
  a sync status) that several screens show lives in ONE module store
  (`useSyncExternalStore`; see `src/monobank/sync-status/`,
  `src/reminders/permission/`), never in per-component `useState`.
- **Permission.** `useNotificationPermission()`
  (`src/reminders/permission/`) returns `{ status, request }` and never
  rejects. `status` is ONE module-level store read through
  `useSyncExternalStore` (the `src/monobank/sync-status/` pattern), so a
  read or an answer in one instance re-renders every mounted one: the
  reminder form's prompt clears the list's notice with no AppState
  change. Never hold it in per-component `useState` (the notice then
  stayed until tapped). It reads the status on mount and on every
  AppState `active` (for a change made in iOS Settings), and exposes no
  public refresh. A generation counter, bumped on every publish, drops a
  read that started before a newer answer (the system prompt itself
  fires AppState `active`, so its read races `request()`). When the last
  instance unmounts the store resets to `undefined`: nothing watched
  iOS Settings meanwhile, so a remount never shows a stale status (this
  also isolates tests, with no test-only reset export).
  `request()` is the only way to show the system prompt: a direct
  `remindersNative.requestAuthorization` call publishes no answer to the
  store and does not count a failed prompt as denied. Semgrep
  `kiko-no-direct-notification-permission-request`
  (`rules/semgrep-prewrite.yml`) denies it outside
  `src/reminders/permission/`, tests, and `src/test-support/`.
  `useNotificationPreAlert(onAnswered?)`
  is the one ask flow: pre-alert sheet, then `request()` after the
  sheet has closed, then `replanReminders()`, then `onAnswered`. iOS is
  asked only (a) on a form save while `status === 'notDetermined'` or
  (b) from a reminders list's NoticeBanner. `usePermissionNotice(hasReminders)`
  (`src/reminders/permission/`) builds that notice and the pre-alert
  sheet props for BOTH lists (the account page and Settings >
  Reminders). With no saved reminder there is no notice. A
  denied status still saves; the page's banner then offers
  `Linking.openSettings()`.
- **Re-plan after a write.** `replanReminders` (exported from
  `src/reminders/use-reminder-scheduler/`) is the module-level
  single-flight trigger that the scheduler hook ALSO uses. Every
  reminder write (form save, pause, delete, permission answer), and
  every write that changes what may be scheduled (an account delete,
  which takes its reminder rows; a Monobank, Binance or wallet connect,
  after its sync whatever the result, and a successful disconnect, since
  a synced account sends no reminder), calls it rather than
  `syncReminders` directly, so an older re-plan can never overwrite a
  newer one. A page write goes through `writeThenReplan(write, t)`
  (same unit): a failed write shows the save-error alert and does not
  re-plan. After a backup restore, `importData` calls
  `replanRestoredReminders()` instead (see "Backup/restore").
- **Screens.** `ReminderForm` (`src/screens/forms/reminder-form/`,
  params `{ reminderId } | { accountId, kind }`) and `AccountReminders`
  (`src/screens/settings/account-reminders/`, params `{ accountId }`) — `AccountReminders` is registered in the Accounts stack.
  The Home stack registers `HoldingForm` (`HoldingFormParams`, no `returnTo`) and `AccountForm` as
  well as the Accounts stack, because leaving the tab resets its stack and would lose the
  transaction form's draft; both take options from `src/navigation/swapped-form-options/`. A form
  that stays mounted underneath uses `navigate`, but a `HoldingForm` opening another `HoldingForm`
  uses `push` (navigate to its own name only changes params).
  `ReminderForm` is registered in BOTH the Accounts and Settings
  stacks, so its props type is structural (`route.params:
  ReminderFormParams` plus the `goBack`/`setOptions` it reads), not
  `NativeStackScreenProps` of one stack. `Reminders`
  (`src/screens/settings/reminders/`, Settings stack) lists every
  reminder under a heading for its account: the account's
  `EntityIconTile` (its stored icon/color, else the kind defaults, as
  on the account card) beside its name, so `listWithAccountQuery`
  reads the account's `kind`, `icon`, and `color` too. It uses the
  same `ReminderRow` and has no Add (reminders are created from an account's
  page). It opens from its own Settings card directly below System
  (`settings-row-reminders`). The account page is reached from a
  native `bell` bar item in `AccountDetail`'s
  `unstable_headerRightItems`, left of Edit in its own glass capsule
  (see kiko-design-system's "Header bar items"), shown on every account
  EXCEPT a live implicit property or debt account (which takes no new
  reminders; see "Tap routing" below). The form has NO Delete: a reminder is deleted only
  from the page row's touch-and-hold `CardContextMenu`, the same as a
  transaction.
- **Offer.** `useReminderOffer({ accountId, account, settings, trigger })`
  (`src/reminders/offer/`) returns `{ kind, dismiss }` or `undefined`.
  It takes the page's OWN account and settings rows, because a second
  subscription would queue the same reads again on op-sqlite's one
  worker. With no `trigger`, it does no reads. The offer shows only
  while the account is not archived, can have that kind
  (`eligibleReminderKinds`), has no reminder of that kind, and was not
  dismissed there (`isReminderOfferDismissed`). Deleting a reminder
  counts as a dismissal: a delete is the user's decision, so the offer
  for that kind never shows again on that account (the bell and Settings
  still add one). A paused reminder (user or back-off) keeps its row, so
  it blocks the offer too. KNOWN LIMITS: a delete made on a build that
  did not record it left no dismissal, so that offer shows once more
  until the user taps "Not now"; a `.kiko` restore replaces the
  dismissals with the backup's. Each trigger read waits
  for that decision. `afterImport` reads `hasImportQuery` and needs a
  row: the import is the trigger (eligibility itself needs no import).
  `manualActivity` reads `manualEntryDaysQuery` only for an eligible
  (non-synced) account and needs at least 2 entries. The window starts
  at local midnight 30 calendar days back and is fixed once per mount.
  `manualEntryDaysQuery` counts only rows the user entered: `source =
  'manual'` AND (`category` OR `exchange_counterpart_holding_id` OR
  `change_group_id` set); opening-balance and balance-edit rows have
  none of these. It counts one key per entry: `coalesce(change_group_id,
  time || sorted holding pair, created_at)`, so a transfer's legs, or a
  payment and its change returns, count once even a second apart in
  `created_at`. Wiring: `AccountDetail` passes `route.params.reminderOffer
  ?? 'manualActivity'`. `reminderOffer?: 'afterImport'` is set by the
  `popTo` in `useImportResultSheet`, shared by BOTH import screens
  (`statement-import.screen.tsx`, `column-mapping.screen.tsx`). A per-mount `offerDecided` latch, set
  on accept and on a successful dismiss, makes the trigger `undefined`,
  so a visit shows at most ONE offer; a live implicit account (property or
  debt) always gets an `undefined` trigger, so it never shows one. Accept and dismiss both clear the
  param. Accept ("Set up") is the user's answer too: it opens the form
  at once, then records the decision through the offer's `dismiss`, so
  the offer never returns on that account even when the form is left
  unsaved; a failed write there is only logged (no alert over the
  form). A failed dismiss ("Not now") shows the save-error alert and
  keeps the card. The card (`ReminderOfferCard`) sits first in
  `account-detail-content`. The hook runs above the page's loading
  gate, so a cached offer is there on the first ready frame. There is
  no offer on holding detail (user decision Q9).
- **Planner.** `planReminder` / `planAllReminders`
  (`src/reminders/planner/`) are pure; the rules are in
  `plan-reminder.ts`'s header. The smart-skip rule changed more than once, so it lives only in
  `plan-reminder.ts`'s header and the spec's "Smart skip" (worked cases):
  read them, do not restate it here. `activeSince` plays no part in the
  skip. The ignored count
  starts at the latest of `activeSince`, `deliverableSince`,
  `lastEngagedAt` and `lastDataAt`; `lastSnoozedAt` frees the regular occurrence at the
  snooze minute. The sync passes `lastSnoozedAt: null` once data
  arrived at or after the snooze.
- **Scheduler.** `src/reminders/scheduler/sync-reminders.ts` has two
  steps, run in this order by every re-plan. `drainReminderResponses()`
  is the ONE reader of the native response queue: it drains it, stores
  the engagements (a tap on the paused notice is not engagement), and
  returns the responses. `syncReminders(t, now?)` does not touch the
  queue. It calls `registerCategories` with
  the active language's `reminders.notification.snoozeAction` and
  `hiddenPreviewsPlaceholder` on EVERY sync, before any
  `replaceRequests`. `reminderContent` gives a reminder the
  `kiko.reminder` category (the one "Tomorrow" action) and the paused
  notice `kiko.reminder.notice` (no action); the ids are
  `REMINDER_CATEGORY_IDENTIFIER`/`NOTICE_CATEGORY_IDENTIFIER` in
  `reminders-native.ts` and must equal
  `reminderCategoryIdentifier`/`noticeCategoryIdentifier` in
  `ios/Kiko/Reminders/KikoRemindersCenter.swift`. The request
  identifiers are a JS<->Swift contract too: `plan-reminder.ts`
  (`requestIdentifier`/`pausedNoticeIdentifier`) names a regular request
  `kiko.reminder.<reminder id>.<yyyyMMddHHmm>` (the local fire minute on
  the GREGORIAN calendar, `fireStamp`) and the paused notice
  `kiko.reminder.<reminder id>.paused`; a snooze is
  `kiko.snooze.<reminder id>`. The native "Tomorrow"
  (`ios/Kiko/Reminders/KikoNotificationDelegate.swift`,
  `requestsReplacedBySnooze`) rebuilds the first two to remove the regular
  request at the snooze minute and the paused notice, and `tomorrow`
  builds its day on `Calendar.gregorian` (`KikoRemindersCenter.swift`:
  `Calendar(identifier: .gregorian)`, time zone = autoupdatingCurrent),
  never `Calendar.current`, so its stamp equals `fireStamp` under any
  device calendar; it returns that Gregorian `LocalDateTime`, and
  `requestsReplacedBySnooze` reads it. Every `UNCalendarNotificationTrigger`
  takes `.floatingDateComponents` (`KikoRemindersCenter.swift`): the
  Gregorian DAY built into a noon Date and converted with
  `Calendar.current.dateComponents([.era, .year, .month, .day]`; the planned
  hour and minute pass through unchanged (a DST gap would shift a Date
  built at 03:30 to 04:30, away from the JS stamp). The components go over
  with NO `calendar:` and NO `timeZone:`. The trigger reads components in the
  device calendar, so a Buddhist or Japanese device needs that conversion;
  a `Calendar` on the components is banned, since it always carries a zone,
  the trigger is archived with it, and the reminder would stop floating
  with the device zone. `__tests__/reminders-gregorian-calendar.test.ts`
  pins it. Change the format on both sides together.
  `replaceRequests` also removes every DELIVERED notification in the
  `kiko.reminder` category (a regular reminder or a snooze) whose
  reminder has no planned request and no kept snooze
  (`orphanedReminderIdentifiers` in `KikoRemindersCenter.swift`), so a
  deleted or paused reminder's banner offers no "Tomorrow"; the paused
  notice (`kiko.reminder.notice`) stays. Then it gates
  on `hasAnyQuery` (no
  reminders -> `replaceRequests([], [])` and no plan-input query).
  Then it syncs `notifications_deliverable_since` from
  `authorizationStatus()` (written only when it changes; while iOS
  cannot show notifications, nothing is back-off paused), plans,
  persists back-off pauses, clears stale snoozes, and replaces the
  pending requests.
- **Mount.** `useReminderScheduler()`
  (`src/reminders/use-reminder-scheduler/`) runs in `AppRoot`
  (`App.tsx`), below `MigrationsGate` and `LockGate`. It re-plans on
  mount, on AppState `active` and `background`, on an i18n
  `languageChanged` event, and on `remindersNative.onResponse` (a tap
  that lands after the `active` re-plan drained the queue). It is
  single-flight with at most one queued follow-up via `replanReminders`,
  and it never rejects (a failed drain, plan or route is logged). A
  failed drain plans and routes nothing, since the plan must see the
  engagements first. A failed plan still routes the drained taps, since
  the queue no longer holds them. The `onResponse` subscribe loads the
  native module synchronously, so it is wrapped in `eitherSync`: on a
  binary without the module it logs once, gets a no-op `remove`, and
  on a real binary without the module, `drainReminderResponses` then also
  rejects on every trigger, so each one logs "re-plan failed" and plans
  nothing, without crashing the app. `use-reminder-scheduler.lazy-load.test.ts`
  pins only the mount: no throw, one log, and the other triggers still run
  (it mocks the scheduler).
- **Tap routing.** Every re-plan whose drain succeeded hands the responses
  it returned to
  `routeLatestResponse(responses, navigationRef)`
  (`src/reminders/routing/`), so every trigger routes. It routes the latest `open` response (the
  last one in the queue, which appends in tap order); a snooze never
  routes. A reminder that is gone (deleted,
  or deleted with its account) routes nowhere. `routeFor` is pure: an
  import reminder opens `AccountDetail` with `intent: 'importStatement'`;
  add transactions with exactly ONE open holding, of a type that takes
  transactions (`!isLedgerlessHoldingType(type)`,
  `src/holdings/holding-descriptor/holding-descriptors.ts`; grep
  `ledgerless: true` for the current ledgerless set), opens
  `TransactionForm { holdingId }` above `AccountDetail`, and otherwise
  `AccountDetail` only (a single ledgerless holding included);
  the paused notice opens `AccountReminders` above `AccountDetail`. An
  IMPLICIT account (`isImplicitAccount`: a live property or debt account)
  routes like any other account, since it has its own `AccountDetail` (its
  section heading on the Accounts screen opens it): the page title is
  `accountDisplayName(account, i18n.t)` (the stored name is an English
  sentinel while unrenamed; `routeFor` is pure but reads the module-level
  `i18n`, as the other non-React modules do), and a merged reminder on one
  opens `AccountDetail` only (its holdings are ledgerless), or its paused
  notice `AccountReminders` above `AccountDetail`. That AccountDetail has no
  Reminders bell and never shows the reminder offer (the screen passes
  `useReminderOffer` no trigger for a live implicit account), so nothing
  builds an entry point to create a reminder for one; a merged reminder that
  survives stays in Settings > Reminders (pause, delete) and is still
  scheduled, which is why `eligibleReminderKinds` is NOT narrowed for the
  implicit kinds (it also decides `isSchedulable` and the "available" state
  of a saved reminder). `AccountReminders` closes the last path to the
  create form: for a live implicit account it lists ONLY the reminders
  saved on it (`kinds = isImplicitAccount(account) ? saved : eligible ∪
  saved`; a saved one still reads as available, since `available` keeps
  using `eligibleReminderKinds`), so deleting the merged reminder leaves no
  unset `add_transactions` row to open `ReminderForm` in create mode. An
  implicit account with none saved shows the empty caption.
  `AccountDetail` takes an optional `kind` route param (the account's kind;
  every navigate site passes it: the Accounts heading row, the main-grid
  card, `routeFor`; a `popTo` with `merge` keeps the one already there):
  the header items are set before the account row loads, so the bell is
  decided from the loaded account's kind, else the `kind` hint, and with
  neither it is left out until the row loads, so it never flashes on an
  implicit account.
  A reminder NOTIFICATION never names its account (its title and body are
  generic catalogue text), so the planner needs no display name. The
  navigate is ONE `navigate('AccountsTab', { state })` carrying the whole
  Accounts stack: the routes it has now (or `Accounts` while the tab has
  not mounted), then the new ones. Two nested navigates back to back lose
  the first, because the second replaces the tab's nested params before
  the stack reads them (`route-response.navigator.test.tsx`, on the real
  routers). The tapped account's page, when already on top, takes the new
  params in place. Before `navigationRef.isReady()` (a tap that launched
  the app) the route waits for the container's `ready` event. Routes that
  waited all navigate in the same tick, so the newest one's stack wins.
  `navigationRef` (`src/navigation/navigation-ref/`) is the
  `NavigationContainer` ref in `AppRoot`, below `LockGate`, so nothing
  routes before unlock. No URL scheme and no `linking` prop. On
  `intent: 'importStatement'`, `AccountDetail` waits for its loading gate,
  clears the param, then opens the file picker once, on a bank account
  only.
- **Account delete.** `accountsRepo.remove` first runs
  `cascadeLinkedRowsDatabaseTransaction` (`transactions.repo.ts`) over ALL the
  account's holdings, closed ones included, so the other legs of an Exchange,
  Convert or split and a deposit's contributions on OTHER accounts' holdings go
  with it, in the same transaction. The confirm text for it is
  `removeHoldingsNoticeOf(holdingIds, t)` (`transactions/remove-notice/`, which
  composes `transactionsRepo.removeHoldingsPlan` and `removeHoldingsNotice`),
  whose sentences are the `holdings.deleteLinked.*` keys. It also deletes the account's
  `reminders` rows in the same transaction, before the account row (NO
  ACTION FK), next to the `sync_state` delete. The Accounts screen runs
  it through `writeThenReplan`, so the deleted reminders' pending
  requests go at once. After the commit it also clears the account's own
  Keychain items (`clearToken`, `clearCredentials`): a failed first
  Connect stores a token or key pair under the account's id while the
  account still reads as manual, so a deletable account can own one. The
  clear never rejects (a failed one is logged): the delete has committed,
  and a rejection would show the save error and skip the re-plan. On the
  create form, a Binance connect that cannot create the account row
  clears the key pair the field stored first (`connectBinance` in
  `account-form.screen.tsx`, through `logOnFailure`), so no pair stays
  under an id with no account. The create inserts the picked icon in the
  same write (a second write that failed after the row existed would
  read as no row and clear the pair of an account that is there).
- **Backup/restore.** `DataSnapshot.reminders` is read ordered by
  `id`. `restoreDataSnapshot` deletes `reminders` before
  `holdings`/`accounts` and inserts them last, with `snapshot.reminders
  ?? []`, so a pre-reminders `.kiko` restores with no reminders. The
  settings row comes from the backup except the columns this device
  keeps (`KEPT_FROM_LIVE_ON_RESTORE`), so of the two reminder settings
  columns only `reminderOfferDismissals` comes from the backup:
  `notificationsDeliverableSince` stays this device's, because a file
  from another device cannot know when iOS first allowed notifications
  here (`restore-across-reminders-migration.test.ts` pins the old-backup
  case). `importData` awaits
  `replanRestoredReminders()` (`src/reminders/use-reminder-scheduler/`)
  right after the snapshot commits, ahead of every later step: the
  re-plan drops the replaced data's pending requests and snoozes, and a
  later step that threw would leave them on the device to fire beside
  the restored reminders; the screen applies the restored language only
  after `importData` resolves, and that language change re-plans too, so
  it sees the restarted counts. The restart itself (counted from the
  backup, every reminder would read as ignored and back-off pause at once;
  a restored snooze has no request on this device) happens inside the
  restore's transaction, so a kill or a re-plan right after the commit
  cannot see the backup's start. The helper runs
  `remindersNative.replaceRequests([], [])` (every pending request goes,
  snoozes included: a snooze pending here belongs to the replaced data
  and would fire beside the regular reminder), then `replanReminders()`.
  A failed drop is logged and still re-plans; it never rejects.
- SQLite's multi-argument `max(a, b)` returns NULL as soon as one
  argument is NULL; for "latest of a column and a value" use
  `coalesce(max(col, v), col, v)` (see `latest()` in
  `reminders.repo.ts`).

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

- **The stored URL cache is purged once, in `AppDelegate`.**
  `purgeStoredURLCacheOnce()` (called from
  `application(_:didFinishLaunchingWithOptions:)`) calls
  `URLCache.shared.removeAllCachedResponses()` behind a `UserDefaults`
  once-key that it writes only AFTER the purge, so an interrupted launch
  retries. The key is in `UserDefaults`, not a `settings` column, because
  Kiko's snapshot import restores the settings row: an imported export
  must not mark the purge done on a device whose cache still holds rows. Pinned by code shape in
  `__tests__/url-cache-purge.test.ts`.
- **The notification delegate is set in `AppDelegate`.**
  `UNUserNotificationCenter.current().delegate = KikoNotificationDelegate.shared`
  must stay in `application(_:didFinishLaunchingWithOptions:)`, before
  `return true`. Set later, a tap that cold-launches the app and a background
  "Tomorrow" action are lost. It must not touch `window` (see memory
  `scene-lifecycle-appdelegate-window-crash`). The center holds its delegate
  weakly, so the delegate is a `static let shared`.
- **Only the wrapper loads the reminders TurboModule spec.**
  `src/reminders/native/NativeKikoReminders.ts` calls
  `TurboModuleRegistry.getEnforcing` at module load, which throws on a binary
  built without the module. `reminders-native.ts` loads it with a lazy
  `require` on first use, so importing reminders code can never crash the
  app; every other module calls `remindersNative` from
  `@kiko/reminders/native`, and a type is imported with `import type`. A test
  reaches the global mock (`jest/setup.js`) through `jest.requireMock`.
  `reminders-native.lazy-load.test.ts` proves the lazy load, and the Semgrep
  rule `kiko-no-native-reminders-module-import` (`rules/semgrep-prewrite.yml`)
  denies any other value import, re-export, `require`, or dynamic `import()`.
- **`KikoReminders` is the app's one TurboModule, so it also carries the one
  non-reminder read: `uses24HourClock()`.** A SYNCHRONOUS method (spec
  `NativeKikoReminders.ts`, `- (NSNumber *)uses24HourClock` in
  `RCTKikoReminders.mm`): the iOS 24-Hour Time setting, read as "the `j`
  hour skeleton of `[NSLocale autoupdatingCurrentLocale]` has no `a`".
  Only `useTimeClock` (`src/i18n/use-time-clock/`) calls it, through
  `remindersNative.uses24HourClock`, which throws where the module is
  missing; the hook falls back then (en 12-hour, uk 24-hour). A new method
  on the spec changes codegen: run `make pods` and commit
  `ios/Podfile.lock` with the spec when it changes. The global jest mock
  (`jest/setup.js`) returns `true`.
- **An ObjC++ (`.mm`) file that imports `Kiko-Swift.h` must first import
  every framework the app target's `@objc` Swift classes use.** Xcode's
  generated `Kiko-Swift.h` declares EVERY `@objc` class in the app target,
  internal ones included (`AppDelegate`, `SceneDelegate`, `ReactNativeDelegate`,
  `KikoNotificationDelegate`, …). Its own `@import` lines sit inside
  `#if __has_feature(objc_modules)`, which is off in Objective-C++, so they
  are skipped. See the import block before `#import "Kiko-Swift.h"` in
  `ios/Kiko/Reminders/RCTKikoReminders.mm` for the current set. When a new
  `@objc` Swift class uses another framework in a signature, add that
  framework's import there. Do not turn on `-fcxx-modules` instead: it
  changes how the React C++ headers compile.
- **Biometric Keychain reads need `NSFaceIDUsageDescription`.** A
  `BIOMETRY_CURRENT_SET` Keychain read SIGABRTs without it. Verify the key is
  present in `ios/Kiko/Info.plist` before adding or changing any biometric
  Keychain call (see memory `biometric-keychain-needs-nsfaceidusagedescription`).
- **`authenticate` (`src/auth/biometrics.ts`) is a TOTAL function whose
  `classifyCode` helper handles BOTH shapes a native rejection can carry: a
  real REJECTION and a resolved `{ success: false, errorCode }`** —
  `authenticateWithOptions` rejects with an `Error` carrying `code` on real
  iOS, so a mock in a test that means to exercise the real device path must
  reject, not resolve, even though the resolved shape is also handled.
  `confirmOwner` (`src/auth/confirm-owner/`) wraps it for
  every sensitive-action re-auth (turning the app lock off, a credential
  export); read `docs/security/README.md`'s "App lock re-authentication" and
  "Data export/import" sections for the full contract, including why the two
  call sites deliberately read `confirmOwner`'s `noPasscode` result
  oppositely.
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
