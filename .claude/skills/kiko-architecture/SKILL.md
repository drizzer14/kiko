---
name: kiko-architecture
description: Invoke whenever you touch storage, a repository, a screen's data hook, migrations, the Monobank sync pipeline, reminders or local notifications (`src/reminders/`), a write that connects, disconnects or deletes an account (it re-plans reminders), or backup export/import (data-transfer). Read before writing any op-sqlite/Drizzle code, any db.transaction call, any useLiveQuery consumer, any code that reads the Monobank API or the Keychain token, any reminder schedule or notification-permission code, or any `.kiko` export/import code. For currency rates, price_points, or a priced holding's value, see kiko-pricing; for statement-import parsing or column mapping, see kiko-statement-import; for Binance and crypto-sync history walks, exchange_state marks and Exchange/Convert legs, see kiko-exchange-sync.
---

# Kiko architecture

Source of truth: `docs/superpowers/specs/2026-08-30-kiko-foundation-design.md`
("Storage and migrations", "Data flow — reactive queries", "Data
collection" sections). This skill summarizes the settled contract.

## Reference files (read the one your task touches)

This skill is SKILL.md plus the reference files below; their `##` sections are cited by name
(`kiko-architecture's "Monobank sync pipeline (functional)"`) exactly as SKILL.md's own sections
are, and they hold the long per-feature detail that is read only when the task touches that
feature. Read the file before you edit the code it describes.

- [monobank-sync.md](monobank-sync.md) — "Monobank sync pipeline (functional)": the token and
  statement import steps, the balance-diff skip and crash-safe marker, the statement queue
  ("Changed-first queue order", "Jars are statement sources") and per-card from-window ("A
  reopened card reaches back to its mark"), sync-closed holdings reopening,
  `failedSyncMonobankIds` and graduation, the per-token rate limit gate and single-flight lock,
  the market refresh beside the fan-out, the three sync signals with the spinner and
  `SyncProgressBar`, and partial-progress resilience. Read it before you touch `src/monobank/`,
  `src/sync/` or the Home sync affordances.
- [reminders.md](reminders.md) — "Reminders (local notifications)": Storage (the `reminders`
  table), the repository, eligibility rules, the schedule Summary, the notification permission
  store, Shared system status, Shared UI state across screens, re-plan after a write, the
  reminder screens, the offer, the planner and scheduler with the Swift request-identifier
  contract, mount, tap routing, account delete and Backup/restore. Read it before you touch
  `src/reminders/`, anything that schedules, pauses or routes a notification, or a write that
  connects, disconnects or deletes an account (each calls `replanReminders`).

## Guideline 2.5.19 — no hidden features (formerly 2.3.1(a); Apple's rejection cited 5.6)

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
  `e2e/screenshot/`) and never ships. Allowance: a `*-test-fixtures.ts`
  module may live in `src/` when ONLY `*.test.ts(x)` files import it
  (Metro bundles only reachable modules); no app file may import it.

Mechanized lightweight, on purpose — not a heavy always-on
build-a-bundle CI gate:

- A Semgrep SOURCE rule, `kiko-no-hidden-feature-flag-or-demo-import`
  (`rules/semgrep-mobile.yml`, Class A ERROR, runs under
  `npm run check:security`; its fixture pair is verified by
  `npm run check:rules`). It flags three shapes: (a) importing a
  `SHOW_*`/`HIDE_*`/`SCREENSHOT_*` `@env` flag, (b) a static `import`
  whose specifier contains the literal `e2e/` segment, and (c) a dynamic
  `require(...)` whose specifier contains `e2e/`. No `src/` module imports
  an `e2e/` module. A jest test under `src/` may READ a committed `e2e/` fixture file as data
  through `node:fs` (precedents: `src/data-transfer/import-data.back-compat.test.ts`,
  `src/screens/forms/transaction-form/transaction-form.demo-templates.test.ts`); that is not an
  import, and Metro never bundles a test file. **Metro dead-code elimination is not
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
- A second rule, `kiko-no-test-fixture-import-in-app` (`rules/semgrep-prewrite.yml`, ERROR, denied
  at write time), sits beside `kiko-no-hidden-feature-flag-or-demo-import` and closes the same
  rule from the test side: app source never imports a `*-test-fixtures` or `*-test-helper` module
  or a path with a `/test-support/` or `/__fixtures__/` segment (an `import`, an `import type`,
  an `export ... from` or a `require`; a type-only import is flagged too, since app code would
  still depend on test scaffolding). Tests, the scaffolding modules themselves (they import each
  other), `__fixtures__/`, `test-support/` and `__mocks__/` folders, `e2e/`, `scripts/` and
  `harness/` are excluded. KNOWN LIMITS: a dynamic `import(...)`, a path alias that hides the
  ending, a barrel that re-exports a fixture, and a `require(` with a comment between the
  parenthesis and the specifier are not matched; a block-comment or template line that itself
  starts with `import ... from '...-test-helper'` is flagged wrongly.
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

Read `CLAUDE.md`'s "Guideline 2.5.19 — no hidden features" for the
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
  other file. Then run `npm run check:shipped-migrations` before
  committing, and keep only inserted lines.
- A pure rule several features need lives in a folder whose own barrel
  exports it (`src/holdings/account-currency`), never a sub-barrel of a
  plain feature: the import is denied as alias-skips-barrel.
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
  `id` so every transaction, exchange leg, loan link, `price_points` row
  attached to it stays attached. Crash-safe,
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
  A test that seeds a database below 0062 and reads accounts through today's
  schema calls `addAccountCurrencyColumn` (`src/test-support/real-sqlite.ts`);
  a seed at 0061 modelling a pre-0050 file drops `accounts_implicit_kind`
  first (see `restore-account-currency.two-path.test.ts`).
  A seed below 0063 that reads transactions calls `addTransactionOperationColumn`, and a
  pre-0063 source read of `transactions` selects
  `columnsWithout(getTableColumns(transactions), ..., 'operation')` (both in
  `src/test-support/real-sqlite.ts`).
  A two-path file built by `readDataSnapshot` on a lower world plus an older-world helper
  that adds `mccCategoriesBackfilled` is not a faithful older file: the reader writes the
  mark key, so the restore treats it as a 1.4 file. A Travel pin of an older file deletes
  the key from the JSON after the read (plan
  `docs/superpowers/plans/2026-11-03-category-automation.md`, "Upgrade worlds").
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
  (`drizzle/migrations/0053-add-loan-holding-id-index.test.ts`). The same planner
  choice hijacks a primary-key keyset page: `exchange_pair_id IS NULL` in a page
  WHERE picked `transactions_exchange_pair_id` plus a temp B-tree for ORDER BY
  (200 000 rows: 6.6 s against 0.7 s on the PK). Keep indexable NULL predicates
  out of a keyset page's SQL, re-check eligibility in JS, and pin the page with
  an EXPLAIN QUERY PLAN test built from the repo's own query builder
  (`sqlite_autoindex_transactions_1 (id>?)`, no temp B-tree) — see
  `rewritePageQuery` in `src/categories/category-rules-repo/category-rules.repo.ts`.
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
`rowIdsForNamedRule` in
`src/categories/category-rules-repo/category-rules.repo.ts` does for descriptions), or bound it with
`.limit(...)`. The one-row `settings` table is exempt. Mechanized as
`kiko-no-full-table-select-in-write` (ERROR, `rules/semgrep-prewrite.yml`).
A full scan hidden behind a repo helper called inside the write is not
caught; that stays a review item. The rule cannot see a select inside a
helper (for example `readAllRulesDatabaseTransaction`); such a read needs a
`docs/harness/documented-exceptions.md` entry.
A read of many rows inside a write pages by id-keyset (`rewriteBlankPageQuery` reads the blank
rows so), never one whole-table select. The one-time MCC back-fill (`backfillIn` in
`src/categories/category-rules-repo/backfill-mcc-categories.ts`) is the documented exception:
see its entry in `docs/harness/documented-exceptions.md`. A new unpaged read needs its own
entry there.

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
  "Local state on a cached display screen follows the row" below —
  keeps working across a pause exactly the way it already does across
  an ordinary cached mount). Flipping back to `false` runs exactly ONE
  read if the query went dirty while paused, zero if it did not; the
  MOUNT read always runs regardless of `paused`, since a screen can be
  mounted unfocused (a deep link, a restore) and still needs its first
  real data. Toggling `paused` never re-subscribes. A tab screen passes `paused: !isVisible`
  (`useIsScreenVisible`; see
  "Pane navigation") to every one of its own `useLiveQuery`/price-book calls; each screen's test
  pins that no call skips the flag and that a write made while hidden shows only once the tab
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
  `settings/categories`, `forms/category-form`, statement-import's `example-transaction` (a
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
  effect (`src/statistics/use-rate-history-backfill/`) must ALSO gate on its own upstream
  query's `isLoading` (`historyLoading`, from
  `src/statistics/statistics-sources/use-statistics-sources.ts`) in its dependency guard, not
  just on
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
read that seeds a form's fields, a one-shot seed, or a query that drives a write. For the current
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
The allowed alternative: the form passes `null` and the repo write reads
the value inside its own transaction (`newAccountValues` and
`baseCurrencyOf` in `src/accounts/accounts.repo.ts`). A create form
never writes a fallback taken from a live query that may not have
loaded.

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
`sortEnabled={isFresh}` with no item-count condition (a lone card must
lift; `kiko-sortable-grid-lone-card-lifts` enforces it) — each persists the WHOLE order
of the rows on screen. A new write from a display screen picks one of
the two, never neither. Tests call `clearLiveQueryCache()` in
`beforeEach` so one `it`'s rows never seed the next.

**Local state on a cached display screen follows the row; it is never
seeded once.** A list row keyed by its ID never remounts when the fresh
row replaces the cached one, so a `useState(row.field)` seed keeps the
cached value, and a later write can put it back over a change made
elsewhere (a `.kiko` restore). A form seeds once from the stored
row (`src/screens/forms/category-form/category-form.screen.tsx` holds a
hydrated ref); a display row follows the row. An effect that writes from rows and
records what it covered in a ref waits for `isFresh` too: Statistics'
history backfill does not start until `transactions` and
`currency_rate_history` are both fresh, because its
`backfillRanForSpanRef` marks the span covered for the rest of the
mount, so a run planned from a cached resume point would stop the fresh
read's own run from ever starting.

## Category screens and the delete path

Read these units before touching category UI: the Categories list
(`src/screens/settings/categories/`), the one CategoryForm route
(`src/screens/forms/category-form/`: create, edit and the rules below,
with `rule-card/` and `rule-summary/` under it; the list card opens
`CategoryForm { categoryKey }`; no separate category page), and the delete notice
(`src/categories/delete-notice/`). Invariants:

- One delete path: `categoriesRepo.delete` deletes the category's rules
  in the same write. The confirm count and the delete use the same
  case-insensitive `lower(category)` predicate and both count unreadable
  rules. `categoriesRepo.delete` also clears the category in every
  template that names it in that same write.
- The confirm text comes only from `categoryDeleteNoticeOf`: one line per kind of
  thing the delete touches, the rules line first, then the templates line
  (`categories.deleteTemplates` plural). A count of zero adds no line. A FAILED count
  read (rules or templates) still adds that kind's numberless line
  (`categories.deleteRulesNoticeUnknown`, `categories.deleteTemplatesUnknown`), because
  the delete removes or clears them whatever the read did, so the confirm always warns.
  Never pin a failed read as silent. A second track that adds a delete-time line appends
  it there.
- The category form has no Delete (kiko-design-system "CardContextMenu";
  pre-write rule `kiko-no-confirm-sheet-in-form`). A
  category is deleted only from its list card's hold menu, which is not
  offered on the default.
- The rule editor is the CategoryRuleForm route
  (`src/navigation/types/types.d.ts`), in
  `src/screens/forms/category-rule-form/` (`matcher-row/`, `rule-draft/`,
  `use-save-rule/`, `rule-rewrite-sheet/`). It has no Delete either; a
  rule is deleted from its rule card's hold menu on the category form.
  The rewrite confirm is a `BottomSheet` with buttons, opened from
  `use-save-rule/`, not a `ConfirmSheet`; a save that would rewrite
  zero rows saves with no sheet.

### Category rules repo

`src/categories/category-rules-repo/category-rules.repo.ts`:
`saveRule` runs `validateRule` and reads the rule back through
`parseRuleMatchers` inside the write, before any insert.
`countRuleRewrite` and the apply share one plan function
(`rowIdsRewrittenBy` over `planRuleRewrite`) and one unchanged-save
short-circuit (`isStoredAsGiven`), so the count shown never differs from
the write. `REWRITE_GUARD_FIELDS` (`src/categories/category-rules/`) is the
one list of rows a rule never rewrites (by-hand, balance-setting and split-change rows only;
read the list in `plan-rule-rewrite.ts`); `isRewriteEligible` and the
refresh CASE in `src/transactions/repo/transactions.repo.ts` both derive
from it. The list names none of the structural markers `exchangeExcludedTransactionIds`
reads (`plan-rule-rewrite.test.ts` pins that), so an exchange leg is rewritable. The insert path
(`withCategoryRules`), the rewrite of a saved rule with its count, and the re-sync refresh
CASE (`ruleWonTransactionSet`) all reach exchange legs and untracked-wallet legs and skip only
the rows a `REWRITE_GUARD_FIELDS` field marks (user ruling B, 2026-10-25). Statistics exclude
legs by their markers (`exchange-exclusion.ts`), never by category.
A name matcher reads `ruleDescriptionOf` (`src/transactions/row-description/rule-description.ts`):
the stored description, or for a blank one the label the row shows in the current language. Every
apply path reads it so: the insert (`withCategoryRules`, which evaluates legs by their label), the
rewrite and its count (`rowIdsRewrittenBy`), `giveSourceRowCategory`, and the form's
`resolveRuleDescription`. A named rule's rewrite pages the blank rows by id-keyset
(`rewriteBlankPageQuery`); a leg is rewritten like any row, and only the guard fields keep a
row out. A leg is judged by its real label: `readHoldingLabels` (`category-rules.repo.ts`;
every holding name and currency, read once per count or rewrite) feeds `withVisibleDescription`,
and `giveSourceRowCategory` reuses it.
A sync input that adopts its import twin is judged as the adopted row (`adoptedRowOf` in
`src/transactions/repo/transactions.repo.ts`): with the twin's own exchange markers and operation
when it keeps them (`keepsExchangeMarkers`), so a kept leg reads by its exchange label; the twin's
own category still wins over the rule's.
`saveRule`, `countRuleRewrite` and `applyNameRule` go through one
`stageDraft` (the stored rule, the row it becomes, every rule prepared with
that row in place), so the rules are read once per write; `storeRule` is the
one insert-or-update. `prepareRules` lowercases a rule's category once, so
every consumer (insert, refresh, form picker) gets the key form. Compare with
`isSameCategory` and key a map with `categoryKeyOf`
(`src/categories/category-rules/same-category.ts`), never `===` or a
hand-written `toLowerCase()` in a screen.

### Transaction form pre-select

`src/screens/forms/transaction-form/category-rule/` and `use-category-pick/`
(read the hook's comments). A held category wins; otherwise the category is
derived from the whole draft. Seed a loaded draft only through `seedCategory`
(one call sets the category, the hand-pick flag and the settled description);
the nav-bar Save settles the description first. Rule: coupled state is set by
one seed function, never by a pair of exported setters. `useCategoryPick` takes a required
`initial: { category, isPicked }` and opens with its description settled, so a restored draft shows
the category and pick flag it was saved with; every caller passes `initial`, and a
`ruleDescription` mapper (the form's `resolveRuleDescription`): a blank name field with
a holding reads as the placeholder label, and with no holding it stays blank, so name
matchers refuse it. On a create, the name-rule sheet
("Apply to all transactions named X?") is offered only when the
user picked the category by hand or a Duplicate/template seed carries one
(what a template stores is kiko-domain "Transaction templates"); a
category the rules pre-selected saves flag 0 with no sheet; an edit is
unchanged. Otherwise Apply rewrites every same-name row to a category the user
never chose (`resolveCategoryOverrideRequest` in
`src/screens/forms/transaction-form/category-rule/category-rule.ts`).

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
  mirroring `activeHoldings`) plus
  `accountsRepo.openCurrenciesQuery()` (a `SELECT DISTINCT currency`
  over non-archived accounts: an account card totals in its own
  currency, so a currency only an account names, with no holding in it,
  still gets its rate or coin price). The fiat leg (Monobank/NBU) runs only
  when `needsFiat` — some active holding's currency, or some non-archived
  account's currency, differs from the base (display) currency, which also
  covers the crypto leg's own USD:UAH anchor need, since a held or account
  crypto currency always differs from a fiat base. The crypto leg (CoinGecko current price) runs
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
  its own throttle window when a held or account currency has no rate row
  yet — a "never fetched" escape so the data-presence gate can never hide a
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
  backfill" section has the full rule). A currency the providers answered
  empty for, and one that settled from a later first day (a young coin),
  is excluded from that minimum by a persisted settled mark, so
  Statistics does not refetch the full span on every focus; a failed
  request earns no mark and retries (kiko-pricing's "History backfill"
  section has the marks, the empty-mark expiry, the 429 rotation and the
  outcome rule).
  The metal twin, `emptyBackwardFloorByMetal`,
  records only an ANSWERED empty backward range — a failed request
  throws before it is recorded). A create/restore
  that may add the first holding of a new currency or type triggers
  these gated refreshes WITHOUT awaiting them, so Save never blocks on
  the network.
- **A read that only ORDERS a picker never gates**: `useHeldCurrencies` renders the picker
  unordered on `[]` until its first read, and never shows a loading state. Settings keeps this
  subscription for the app's lifetime by design: one `SELECT DISTINCT` per holdings/accounts
  write, and a paused query would reorder the rows when the sheet opens. Add `paused` only if
  the cost shows up.
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
  `git grep -n 'refreshMarketData(' src` (the account form passes
  `metals: false`). Restoring a `.kiko`
  export (`importData`, `src/data-transfer/import-data.ts`) calls
  `refreshMarketData` itself. None of these runs through the sync
  fan-out that otherwise triggers this, so the price/rate appears without
  an app restart. Every step gates itself, so this is a no-op when
  nothing is needed; it never rejects, and a failure is only
  logged, never shown, so it never turns a successful save into a shown
  error. `throttled: false`: the write is a deliberate user action, not
  a background poll. A currency pick on the account form fires the same
  refresh as the holding form, as `refreshMarketData({ throttled: false,
  metals: false })`: after an edit that changes `accounts.currency`, a
  create with a picked currency, and a cash create. It is never fired for
  an unchanged pick or a failed write. An account currency is a fiat or a
  coin, never a metal, so it needs no metal prices. Any other edit needs no
  trigger: a holding's type and currency are immutable once created.
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

A long `a or b or ...` chain has a SECOND limit: SQLite refuses an expression tree
deeper than 1000 ("Expression tree is too large"), separate from bound parameters.
Chunk such a chain by term count (`MAX_OR_TERMS` in
`src/transaction-templates/repo/transaction-templates.repo.ts`).

Examples: `ratesRepo.upsertMany` (`src/rates/repo/rates.repo.ts`) and the
shared `upsertDedupRowsDatabaseTransaction`
(`src/transactions/repo/transactions.repo.ts`, called by both
`transactionsRepo.addManyDedup` and, through
`insertDedupRowsDatabaseTransaction`, `importRows`) — two shared helpers
also chunk a per-row `inArray(...)` select directly at a safe item-count
margin (the category-rule lookup in `withCategoryRules`, the
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
- `src/help/help-topics.ts`: topics and groups are keyed records
  (`topicsById`, `groupsById`, each `satisfies Record<Id, Entry>`);
  `HELP_TOPICS` and `HELP_GROUPS` are derived from them (record order =
  section and row order). A topic's `action` may be `null`:
  `help-topic.screen.tsx` then passes `footer` as `undefined`, so no
  footer is drawn. The Help page renders by group; read the file for the
  current groups and topics.
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
- A decision that depends on whether a row exists, taken while another
  screen may have a queued insert, reads through `write()`
  (`accountsRepo.exists`), never through a plain query, which skips
  op-sqlite's JS write queue. Find the callers with
  `grep -rn accountsRepo.exists src`, never from a list here. A test that
  mocks that read keeps the queue's order (FIFO): it answers only after the
  writes registered before its call.

## DB encryption (always on)

The SQLCipher database-encryption migration is **always on** —
`DB_ENCRYPTION_ENABLED` (`src/db/db-config.ts`) is `true` today, not a
rollout flag a build can ship off. This is a security invariant, not a
feature toggle (Guideline 2.5.19 sensitivity: a build/env flag that
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
module pointers (the section lists them) — read it there rather than a
duplicated list here.

For the crypto re-sync request (`resyncRequest`) and the Binance exchange sync (balance reads,
history walks, walk marks) see `kiko-exchange-sync`.

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
- **Export version 3 carries `categoryRules`.** Versions 1 and 2 carry
  `categoryOverrides`; `snapshot/with-legacy-overrides-converted.ts` converts
  them to rules on import (`import-data.ts`). The v3 restore guard checks SHAPE
  only (id, category and matchers are strings; createdAt and updatedAt are
  numbers). A rule whose `matchers` fail `parseRuleMatchers` restores as an
  unreadable rule, because the migration and the legacy conversion store such
  rules and the app exports every rule: a restore guard never rejects a state
  the app itself writes.
- **Every Keychain secret class the export carries is read and restored.**
  Read `payload.d.ts`'s `ExportSecrets` for the classes it carries: the
  per-account `monobankTokens` and `binanceCredentials`. The
  export never carries the SQLCipher DB key at all. Secrets are written only
  with the credentials toggle on. `secrets/read-secrets.ts` reads every class
  from the Keychain (skipping an account with no stored secret) and
  `secrets/restore-secrets.ts` restores each account secret back to its
  original account id — a legacy file that still carries the removed
  `eodhdKey` imports fine, the key ignored and never written to the
  Keychain. A restore keeps this device's live value of each device-local settings
  column, never the file's (the app lock is turned off only after
  `confirmOwner` in Settings, so a file never decides it). They are the
  members of `KEPT_FROM_LIVE_ON_RESTORE` (`src/db/kept-from-live-on-restore.ts`;
  read the file for the list and each member's reason), read
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
  next such column. A mark-gated variant: `withTravelReseeded`
  (`src/data-transfer/snapshot/restore-snapshot.ts`) re-adds `travel` only when the file's
  settings row lacks the key `mccCategoriesBackfilled` (PRESENCE, not value), so a Travel
  the user deleted in a 1.4 file stays deleted. A once-only mark is per data set, not per
  device: a restore of an older file runs the one-time step again.
  `transactions.setsBalance` and
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
  `accountsRepo.remove`); a table with no FK (`transaction_templates`) has no
  delete-order constraint. A write that moves a holding's balance anchor (a
  closing balance that applies, a hand-set balance, the bank figure of a sync)
  clears all its keys in the same write
  (`clearDeletedImportKeysDatabaseTransaction`): the sync clears but never
  reads them, so it never revives a row. A restore (`restoreDataSnapshot`) deletes the
  table BEFORE `holdings` and inserts it AFTER them, skipping a key whose
  holding it did not insert, with `?? []` for a file without the key (the
  snapshot field is optional). The composite primary key is its only index.
  Proven by `drizzle/migrations/0054-add-deleted-import-keys.test.ts` and
  `src/data-transfer/snapshot/restore-deleted-import-keys.test.ts`.
- **`restoreDataSnapshot` takes a required `version` and runs `withUsdtRescaled`
  LAST,** after the key rewrites that build keys from amounts. A value above the
  bound throws the Error message data-transfer/amount-too-large before any delete or insert; the
  import screen maps it through `IMPORT_ERROR_KEYS`. A new error code needs that
  map entry plus an i18n key. `withUsdtRescaled` leaves a value the 0059
  migration leaves as REAL (exponent, >= 1e21) alone, bounds an import-key
  amount token to int64, and returns the same object and byte-identical
  matchers text when nothing is rescaled; pinned by
  `src/data-transfer/snapshot/with-usdt-rescaled.test.ts`.
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
  A temp table that a later statement looks up by key is created WITH a primary
  or unique key (0059's list is keyed by `(table_name, row_key)`), with an
  `EXPLAIN QUERY PLAN` test; an arithmetic data migration guards its bound with
  exactly the predicate of the statement it guards.
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
  `App.tsx` then runs `useMccBackfill()`
  (`src/categories/category-rules-repo/use-mcc-backfill.ts`) after `useLotRecost()`;
  `backfillMccCategories` writes the mark `settings.mccCategoriesBackfilled` in the SAME
  write as the rows, and `importData` (`src/data-transfer/import-data.ts`) calls the
  back-fill after a restore.
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
  A second example is `defaultNameRenameSettled` (pinned by
  `restore-default-name-rename.test.ts`).
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
  A non-idempotent data rewrite bumps `EXPORT_VERSION`; its restore mirror is
  version-gated: `restoreDataSnapshot(snapshot, version)` and `withUsdtRescaled`
  are the model.
  A backfill derived from rows already in the file uses a per-FILE presence
  check instead: `withAccountCurrencyDerived`
  (`snapshot/with-account-currency-derived.ts`) fills `currency` only when
  none of the file's accounts carries it.
  The decision per migration, each optional snapshot key included, is recorded in
  `VERSION_DECISIONS` in `src/data-transfer/crypto/envelope.test.ts`: read it there.
  A new table the file carries as an OPTIONAL key needs no bump: an older build
  drops the key, and this build restores an older file with the table empty
  (`?? []`). A column riding inside an existing row that the restore leaves null (0058
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
  Migration 0061 (`exchange_state`) has a restore mirror,
  `withWalkStateMoved` (`snapshot/with-walk-state-moved.ts`, keys in
  `legacy-walk-keys.ts`), called in `restore-snapshot.ts`: a stored string
  `exchangeState` (even malformed) is kept; null or absent is filled from the
  account's first Spot BTC holding's metadata, stamps kept; an account with
  walk keys and no row gets a new row with null stamps; the old holding keys
  stay. Read `restore-walk-state.two-path.test.ts`,
  `drizzle/migrations/0061-exchange-state.test.ts` and its `VERSION_DECISIONS`
  entry in `envelope.test.ts`.
  Migration 0062 (`accounts.currency`, NOT NULL DEFAULT 'UAH') backfills by
  USER RULING 2026-10-19: open holdings only, every account, archived
  included. One currency among them gives that currency; several or none
  give `settings.base_currency`. The pure rule is `accountCurrencyOf`
  (`src/holdings/account-currency/`); it backfills and restores only, and
  create paths do not use it (see the kiko-domain Account bullet). Its restore mirror
  `withAccountCurrencyDerived` runs after `withImplicitAccountsMerged`.
  `assertKnownCurrencies` covers `accounts.currency`. Export version 5; read
  the decision in `VERSION_DECISIONS` in `envelope.test.ts`.
  Migration 0063 (`transactions.operation`, nullable, insert-only; files
  `drizzle/migrations/0063_add_transaction_operation.sql` and its test) is a label column
  riding inside the transaction row, like 0058; its data-transfer decision is the
  `VERSION_DECISIONS` entry in `envelope.test.ts`: read it there.
  Worked example of a device-local settings column: 0060
  `settings.history_backfill_state` (nullable; the history backfill's resume
  state). It is listed in `KEPT_FROM_LIVE_ON_RESTORE`, so a file never
  decides it, it needs no `EXPORT_VERSION` bump, and its reason is the
  `VERSION_DECISIONS` entry in `envelope.test.ts` (read it there).
  Renaming an UNSHIPPED migration needs no new `when`: the journal `when` in
  `drizzle/migrations/meta/_journal.json` is bookkeeping only, and
  `src/db/run-migrations.ts` gates on the COUNT of recorded rows. A device that ran the old
  name already counts that entry as applied, so it never runs the renamed file's SQL; fix
  such a device with a new migration, not a `when`.

## Pane navigation

On a wide window (a `LayoutMode` other than `single`, from `@kiko/display-regions`) a tab's
stack shows two panes (`companion`, `primary`); on a narrow one it is one native stack. The code is
the `src/navigation/pane-stack/` feature; its barrel (`src/navigation/pane-stack/index.ts`) is
the whole public surface, so read it for the exports. The units are one folder each under
`src/navigation/pane-stack/` (`pane-assignment` is the pure pane maths, `pane-router` is
`PaneRouter`, a `StackRouter` wrapper); list the folder for the rest. The four tab stacks
(`src/navigation/*-stack/*.stack.tsx`)
are built with `createPaneStackNavigator`.

- **The one rule: route 0 shows in the list pane (`rootPane`); every other route shows in the
  detail pane (the pane opposite `rootPane`), whichever pane its opener is in** (`useOpenInPane`,
  or a plain `navigate` from a screen; both become `PANE_OPEN`). `openFrom` in
  `pane-assignment.ts` first pops every route above the opener, so a tap in the list replaces
  the detail stack and a tap in the detail pane goes one step deeper there. The exception is a
  route named in `PaneConfig.wholeWindowRoutes`: it sits in the pane of the route below it
  (`resolvePanes`, `openFrom`; Back stays in that slice) and the other pane keeps its screen
  hidden.
- **`state.panes` is keyed by route key.** A stored pane wins; otherwise `resolvePanes` decides
  by position alone: index 0 takes `rootPane`, every other route, a default included, takes the
  detail pane (so a route pushed while folded, or a reminder rebuild, never lands in the list
  pane). `retainPanes` drops the entry of every closed route; the router calls it after every
  action.
- **Per-tab config.** Each stack file declares its own `PANE_CONFIG` (`rootPane`, and optionally
  `companionDefault` / `primaryDefault` as `{ name, isDefault: true }`, and `wholeWindowRoutes`;
  the keys are in
  `src/navigation/pane-stack/pane-assignment/pane-assignment.types.d.ts`). Read the four
  `src/navigation/*-stack/*.stack.tsx` `PANE_CONFIG`s for the current defaults, not this skill.
  A config with no default can still get a RUNTIME default (below): the Accounts stack's config
  declares none, and `use-accounts-pane.ts` shows one through `useShowPaneDefault`. A config
  default is a stand-in, not a tapped page: a fold drops it, a form opened above it replaces it,
  and closing that form brings the stand-in back (it is not a real Back target, and the
  stand-in screen's own state, a scroll position say, is lost).
- **Static defaults are not in the state.** An empty pane shows its config default as a synthetic
  route keyed `pane-default:<pane>` that `pane-slice.ts` describes without materializing it.
  React Navigation hands such a screen one shared per-navigator placeholder navigation whose
  every helper throws; `standInNavigation` (in `pane-stack-view/`) mutates that object in place:
  `navigate`/`push` of a name of this stack becomes `PANE_OPEN` from the default, a name the
  stack lacks goes on to the parent (a tab, say); the stand-in keeps an options store
  (`stand-in-options.ts`, `pane-slice.ts`), see `stand-in-navigation.ts` for the other helpers.
  An opener that is a static default is made a real route below the opened page by
  `realizeStaticDefault` (`src/navigation/pane-stack/pane-router/pane-router.ts`); `openFrom`'s
  static-key branch is only the fallback. A whole-window route opened from a static default skips
  it (`isWholeWindow`): the stand-in stays, under the same key, and is never remounted. Two tests
  pin React Navigation assumptions (the two `PINS React Navigation` cases in
  `src/navigation/root-navigator/default-pane-navigation.test.tsx`); re-check them on every React
  Navigation upgrade.
- **Screen rule for anything that can be a default** (Home, Statistics, Settings Categories and
  the Accounts list, as the rule's path globs say). In a default `useIsFocused()` is false and
  `useFocusEffect` never runs, so such a screen uses `useIsScreenVisible()` (two panes: the top
  route of either pane while the tab is focused, but only the expanded pane's top route while a
  pane is expanded, see `visibleKeys` in
  `src/navigation/pane-stack/pane-stack-view/use-pane-visibility-value.ts`; one pane:
  `useIsFocused`) and passes
  `paused: !isVisible` to its live queries (the "paused vs enabled" rule above). Semgrep rule
  `kiko-no-focus-hook-in-pane-default-screen` (`rules/semgrep-prewrite.yml`) bans
  `useIsFocused` / `useFocusEffect` under
  `src/screens/{home,accounts,statistics,settings/categories}/X
- **Runtime defaults.** `useShowPaneDefault` (`show-pane-default.ts`; it takes no pane
  argument) dispatches `PANE_SHOW_DEFAULT`, handled by `showDefault` in `pane-router.ts`. It
  fills the detail pane only, is a no-op when not `isSplit`, returns the state unchanged when the
  detail pane's floor is a tapped page, and otherwise replaces the shown default in place,
  keeping a page opened from a placeholder on top of it. `PANE_OPEN` from an `isDefault` route
  clears the flag (materializes it), except for a placeholder (`isPlaceholder`, e.g.
  `AccountsEmptyPane`): that keeps `isDefault`, the pane hook replaces it once an account
  exists, and `PANE_FOLD` drops it (`pane-assignment.ts`; R37). `PANE_CLOSE`
  (`useClosePaneRoute`, `pane-router.ts` `close`) closes a route by key AND every route opened
  above it, and is a no-op once the key is gone; the stack router pops the root. It serves a
  deleted entity: the Accounts list closes the detail pane's first page, and `useCloseWhenGone`
  (`src/screens/holding-detail/use-close-when-gone/use-close-when-gone.ts`) closes this page and
  the steps opened from it, in panes only, after a fresh read (R38).
- **Row marking.** A list row that opens a page is marked `selected` when the detail pane's
  first page is that page: read `useDetailPaneRoute()` (`pane-visibility`; null in one pane or
  an empty detail pane) and compare with `detailParamOf(route, name, param)`, which reads a
  string param, for every row kind that opens a page. The mark persists while deeper steps cover
  the page. The markers are in `use-accounts-pane.ts`, the Settings menu and the Home
  transaction row (`home.screen.tsx`, `TransactionRow` `selected`). Read the exports in the
  `pane-stack` barrel. See the design-system `selected` rule (R32).
- **While split, the action's source is not the focused route.** The router reads `isSplit` from
  a ref that `createPaneStackNavigator` sets in `useInsertionEffect` (current before any child's
  effect). `isSplit` also gates `PANE_SHOW_DEFAULT`. With a source route present and not on top, or
  an `isDefault` source even on top (a bystander, `pane-router.ts` `fromBystander`):
  `NAVIGATE`/`PUSH` = `PANE_OPEN` from the source; `GO_BACK`/`POP`/`POP_TO`/`REPLACE` act on the
  source (REPLACE keeps the replaced route's pane); from an `isDefault` source `GO_BACK`/`POP` are
  handled no-ops; `POP_TO_TOP` is standard; a `POP` with count above 1 closes that many routes of
  the source pane's own stack (a pane keeps its first). In single mode, or with a focused
  non-default or absent source, it is the plain `StackRouter`.
- **Fold and unfold.** `useSettledLayoutMode` delays a change between `single` and split by
  `SETTLE_DELAY_MS` (a pose change reports a burst of snapshots) and applies a rotation between
  split modes at once. `usePaneFold` dispatches `PANE_FOLD` / `PANE_UNFOLD` when `isSplit`
  changes (nothing on mount). `PANE_FOLD` drops `isDefault` routes (placeholders too) and keeps
  every tapped route's
  pane. A tab re-tap pops a page only when the stack holds one (`hasPageToPop` in
  `create-pane-stack-navigator.tsx`), so it skips a runtime default. Screens remount when the
  mode crosses single/split (ruling 3A);
  `TwoPaneLayout` takes the
  settled mode through its `mode` prop instead of reading the live one.
- **Reminder tap rebuilds the Accounts stack from the root.** Rule (user ruling option B): a
  reminder notification tap sets the Accounts stack to `[Accounts, AccountDetail <tapped account>,
  next screen?]` (`openAccountsPages`, `src/navigation/open-accounts-pages/open-accounts-pages.ts`,
  shared by the reminder tap and Home's View actions); nothing opened earlier stays. The holding
  detail's View account / View holding go through `useOpenInPane` instead (`use-view-actions/`),
  a push in the pane rule below, not this rebuild. The list route keeps its key (no remount).
  A page of the tapped account the user
  opened right above the list (index 1, not flagged `isDefault`) keeps its key and takes the new
  params in place; an `isDefault` page is never reused. Why: an earlier page left below would
  close the reminder's page with it when its entity is deleted, and the list marks the detail
  pane's FIRST route. In single mode, Back from the reminder's page goes to the Accounts list
  (accepted trade-off). Known limit (user ruling D): the rebuild discards an open form
  (`TransactionForm`, `AccountForm`, `HoldingForm`, `ReminderForm`, ...) in the Accounts stack
  together with its draft, with no confirm. Keeping the form on the stack would let the close of
  an earlier account's page close the reminder's page (the pane router's close slices every route
  above the closed one). A `beforeRemove` / `usePreventRemove` guard does not fire on this path:
  the nested `state` param is applied as a reset, not a dispatched action. Pinned by the tests
  "discards an open form of the tapped account, and its draft, ..." and "... of another
  account ..." in `route-response.navigator.test.tsx`.
- **Form drafts.** A form restores what the user typed after the remount through its route's
  `draft` param: `useDraftParam` / `isSavedDraft` (`src/navigation/use-draft-param/`) read it
  once at mount. `useDraftAutosave(draft, saveDraft, restored?)`
  (`src/navigation/use-draft-autosave/`) saves after a blur commit (`Screen`'s `onFieldBlur`) and
  on the RAW `useLayoutMode` change, not the settled one; never per keystroke, and never when the
  JSON text is unchanged. The save is `setParams` on the asking route: `SET_PARAMS` stays on its
  source route and changes no router state (`pane-router.test.ts`). Params hold JSON only.
  Every form route under `src/screens/forms/` keeps a draft: the account, contribution, reminder,
  holding, ownership-change, price-point, lot, transaction, category and category-rule forms
  (template entries of the transaction form excepted, see kiko-domain "Form drafts"). The
  category form's draft is `{ name, icon, color }`, the colour being the tapped one (null until a
  swatch is tapped), not the preview hue; the rule editor's is `{ rows }`, each row without its
  React key. In both an edit's draft wins over the stored record, yet Save still compares with
  the stored values, and the rule editor still closes for a rule deleted meanwhile. A saved or
  cancelled form leaves no draft: it lives on the popped route, and a saved new category opens
  its own screen on a fresh route. The first blur writes a draft once: a new rule's blank row (the
  row appears after the settings read), and an edited category's or rule's stored values even
  unchanged (the autosave starts from the blank first render). Secrets, tokens, wallet and
  Binance keys never go in a draft (a lender IBAN lives only in the in-memory loan draft). Not
  saved: scroll, `attemptedSave`, open sheets, `pickedImplicitKind`, `leavingKind`. The "Add
  holding" and "Add template" round-trip auto-select (`use-select-created-option`, an exact
  handback id) does not survive a fold: the fold unmounts the picker, which closes the handback,
  so the user picks the new option by hand (known limit, user-accepted 2026-10-10, no fix
  planned). The handback id is a correlation id in the `handbackId` route param, not a secret,
  so it may ride in params. The Add template row pushes
  `TransactionForm {newTemplate:true, handbackId}` (push, because a navigate to the form's own
  route name adds no route and would replace the unsaved form); the return
  and the selection in every stack and the split layout are pinned by
  `create-template-return.navigator.test.tsx`, `create-holding-return.navigator.test.tsx` and
  `home.stack.create-template.navigator.test.tsx`. The account form joins the handback; the detail
  is in kiko-design-system's "Empty holding picker". Likewise a remounted
  account form does not show the "Connected as <client name>" status of a Connect made before the
  fold: the status is local state in `MonobankConnectField`
  (`src/design-system/components/monobank-connect-field/`), the name comes from the token's
  `fetchClientInfo`, and no name is stored. A re-tap of Connect re-syncs the same account (known
  limit, user-accepted 2026-10-10, no fix planned). Proof on two panes:
  `accounts.stack.draft.navigator.test.tsx`.
- **`resetTabStackOnBlur`** (`src/navigation/reset-tab-stack-on-blur/`) is unchanged and every
  tab stack still passes it as `screenListeners`. It dispatches `popToTop` when the parent tab
  is not focused and the state's `index > 0`; in a split navigator that is the router's standard
  `POP_TO_TOP`, and `retainPanes` then clears the closed routes' panes. A static default is not
  in the state, but a runtime default is (`index > 0`), so a blur pops it and the Accounts pane
  hook inserts it again.
- **Cost.** Home and Statistics are each mounted in two tabs on a wide window (a root in one, a
  default in the other), so their live queries run twice. Opening Tables does not mount a second
  Statistics: it has no mount reads and the stand-in stays, paused.

## Transaction form: holding change and template seeding

Every user primary-holding pick goes through ONE path: `pickPrimaryHolding` in
`src/screens/forms/transaction-form/transaction-form.screen.tsx` calls `applyHoldingChange`
(`holding-change/`). It settles the mode to one the new holding offers (`settleMode` /
`DEFAULT_MODE`, `mode-options/`) and empties a split return row whose holding is in another
currency (`emptyReturnsInOtherCurrency`; the amount stays). Hydration (`hydration/`) reuses
the same helpers for a template seed. A holding-dependent invariant lives in that one
function; when a review finds hidden state on one holding path, grep every
`setPrimaryHoldingId` caller and every seed path, share one helper, and pin one red test per
path.

Field visibility is sticky within one mount: on Add-from-holding the holding field shows once a
template seats a different holding (`revealsHoldingField` / `resolveHoldingField`,
`route-entry/`). It is local state, not in the draft; a remount recomputes it from the draft's
holding. Known limit: it can hide after a remount (a re-pick of the page's own holding, or a
template with no holding after one with a holding). The write target stays the page's holding.

## Navigator-layer title behaviour

`screenLayout` is the navigator-layer hook for per-screen title behaviour: React Navigation
calls it per screen with the merged options, so `options.title` and `navigation.setOptions`
titles are both covered and no screen passes it (`src/navigation/fitting-large-title/`). Put
title-fit logic there, not in screens. Cross-cutting chrome wraps screen content only, never the
native header or the safe areas.

The restore (`largeTitleRestoredOptions`) reads the screen's own options from before the switch
(the `ownOptions` ref), so a screen's own `headerTransparent`, `headerShadowVisible` and
`headerTitle` survive a heading round trip; a value changed during heading mode is not kept.

Testing: `jest/setup.js` globally mocks `useTitleFit` (`{ fits: true, measurer: null }`); a test
that needs "does not fit" uses `jest.mocked(useTitleFit).mockReturnValue(...)`;
`use-title-fit.test.tsx` unmocks it to test the real hook.

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
- **Only the wrapper loads a TurboModule spec.**
  A spec in `src/native-specs/` (for example `NativeKikoReminders.ts`) calls
  `TurboModuleRegistry.getEnforcing` at module load, which throws on a binary
  built without the module. The wrappers
  `src/reminders/native/reminders-native.ts` and
  `src/display-regions/display-regions-native/display-regions-native.ts`
  lazy-`require` their spec from `@kiko/native-specs` on first use, so
  importing feature code can never crash the app; every other module calls the
  wrapper through its feature barrel, and a type is imported with
  `import type`. A test reaches the global mock (`jest/setup.js`) through
  `jest.requireMock`. Each wrapper has a `*.lazy-load.test.ts` proving the lazy
  load, and a Semgrep rule in `rules/semgrep-prewrite.yml`
  (`kiko-no-native-reminders-module-import`,
  `kiko-no-native-display-regions-module-import`) denies any other value
  import, re-export, `require`, or dynamic `import()`.
- **`DisplayRegions` feeds the layout hooks.** Feature `src/display-regions/`
  (barrel exports `useDisplayRegions`, `useLayoutMode`, `useFoldRegion`,
  `useVerticalBarEdge`); native `ios/Kiko/DisplayRegions/`
  (`DisplayRegionsCenter.swift`, `RCTDisplayRegions.h`/`.mm`). Swift guards the
  iOS 27.1 symbols with a compile-time SDK check plus `#available(iOS 27.1, *)`
  (read the exact guard in `DisplayRegionsCenter.swift`), observes the hinge
  with a `UIHingeInteraction` (a change of hinge status reads at once; only
  `closed` and `fullyOpen` read as no fold, any other status including
  `unknown` leaves the region query to decide, and `UIScene.didActivateNotification`
  clears the last status; an angle tick with the same status starts the settle
  reads when none are pending and never cancels a pending pair, so a tick
  stream cannot postpone a pair's reads past 1.2 s; a tick that lands inside a
  pair sets a flag, and the pair's end starts one more, so the last read comes
  at least 1.2 s after the last tick), re-reads at 0.3 s and 1.2 s after
  every trigger because the reserved region lands after the trigger and nothing
  reports it, emits under the emitter lock so no emit outlives
  `removeChangeEmitter`, and logs `os.Logger` `.debug` lines (category
  `DisplayRegions`; read them with `log stream --level debug`): one per emit,
  one per read (`read source=… changed=…`), one per hinge update (status and
  angle). The JS wrapper reads native once, keeps its cache current from
  `onChange`, and falls back to `FALLBACK_SNAPSHOT` when the module is
  missing.
- **`KikoReminders` also carries the one non-reminder read:
  `uses24HourClock()`.** A SYNCHRONOUS method (spec
  `src/native-specs/NativeKikoReminders.ts`, `- (NSNumber *)uses24HourClock` in
  `RCTKikoReminders.mm`): the iOS 24-Hour Time setting, read as "the `j`
  hour skeleton of `[NSLocale autoupdatingCurrentLocale]` has no `a`".
  Only `useTimeClock` (`src/i18n/use-time-clock/`) calls it, through
  `remindersNative.uses24HourClock`, which throws where the module is
  missing; the hook falls back then (en 12-hour, uk 24-hour). `package.json`
  `codegenConfig.jsSrcsDir` is `src/native-specs`, so every codegen spec goes
  there. A new method on the spec changes codegen: run `make pods` and commit
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
