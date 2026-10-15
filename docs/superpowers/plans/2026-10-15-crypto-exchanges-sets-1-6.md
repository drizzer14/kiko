# Crypto exchanges 1.3-a, change sets 1-6: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan set by set. Steps use checkbox (`- [ ]`) syntax.

**Goal:** land change sets 1-6 of track `crypto-exchanges-1.3-a` (USDT at scale 8 with migration 0059 and `.kiko`
v4; the curated coin registry; the shared exchange layer; walk state in `sync_state` with migration 0060;
multi-coin balances; account-wide history walks), each set tip shippable alone.

**Architecture:** money stays integer minor units; every rescale is exact (`x 1000000`) and mirrored on restore;
JSON fields are touched only behind `CASE WHEN json_valid(...)`; the exchange layer lives in
`src/crypto-sync/exchange/<unit>/` (a declared container), Binance-specific code stays in `src/crypto-sync/binance/`.

**Tech stack:** React Native, op-sqlite + Drizzle (count-based runner `src/db/run-migrations.ts`), Jest with
`node:sqlite` (`src/test-support/real-sqlite.ts`), fnts `Either`/`maybe`, ts-pattern, i18next.

**Spec:** `docs/superpowers/specs/2026-10-15-crypto-exchanges-design.md` (approved at 73336657). Rulings:
`.superpowers/sdd/binance-multicoin/rulings.md` (user rulings, C-NR*, plan-prep Q1-Q12). Prep facts:
`.superpowers/sdd/binance-multicoin/prep-sets-1-6.md`.

**Base:** branch `binance-backfill-fix`, HEAD 7eafd387 (main 74b16a18 merged). Every code fact below names a
symbol or anchor text. Prep line numbers are hints only: **the developer re-greps every fact on the actual base
before relying on it.**

## Global constraints

- Sets run strictly in order 1 -> 2 -> 3 -> 4 -> 5 -> 6, each on the previous set's tip; never parallel worktrees
  (sets 1, 2, 4 change `restore-snapshot.ts`; sets 1, 4 change `VERSION_DECISIONS`).
- Each set tip is shippable alone (memory "task tip must be safe"); each new export and barrel has a consumer at
  the tip it lands in, or knip fails (a test importing through the barrel counts; if knip still flags it, stop and
  report, never add an ignore).
- Money: integer minor units, never a float in a stored value; exact-parity tests for every rescale and parse.
- Migration SQL: single-quoted string literals (`SQLITE_DQS=0`); every `json_type`/`json_extract`/`json_each` over a
  column sits behind `CASE WHEN json_valid(<column>) THEN ... END`, never `json_valid(...) AND json_type(...)`.
- Migration numbers 0059/0060 follow the base's last migration 0058; each migration set re-checks main's
  `drizzle/migrations/meta/_journal.json` before its merge and renumbers (files, journal, tests) if main moved.
- Tests: TDD, failing test first and shown red (quote the red count), then code. Test names and comments carry no
  spec scenario id, no migration number and no history ("was:") text (memories "planner: no history notes",
  "migration idx shared namespace"); the commit message carries the history and the ids.
- A "was:" pin is updated in the same step as the behaviour change; this plan lists each with its new value. A
  pin is never edited in a fix round (memory "never edit an acceptance pin in a fix round").
- Every touched test file passes `bash scripts/checks/dup.sh <file>` alone, old figure included; a new test file
  over 1000 lines must also be under 5% alone (helper + `it.each`).
- Identifiers in full words; imports through `@kiko/<feature>` barrels; `jest.mock` names the seam file.
- Copy: en + uk for every new key; kiko-translator casing; the user reviews new keys before a deploy that ships
  them.
- No flag, no hidden feature (Guideline 2.3.1(a)); every new visible text ships reachable.
- Kill/stash/checkout rules of the harness apply; commits use Bash `timeout: 300000`; never `--no-verify`.

## Run-log gaps (`run-log.mjs stats --gaps --repo kiko`, read 2026-10-15)

| Gap | This plan |
|---|---|
| `20261015T1119-kiko-harness-h7/2` TIMEOUT-HEAVY on app-wide primitives | LEFT OPEN (harness backlog). The plan routes around it: sets 1 and 2 touch `currency.ts`, `format.ts`, `decimal.ts`; each set's gate section names the plain-jest proof that clears a TIMEOUT-HEAVY file |
| `20261015T1318-kiko-harness-h7/1` kill-guard-probe flake under verify load | LEFT OPEN. A `make verify` red only in `kill-guard-probe.test.ts` with EXIT 142 is re-queued once at low load (`bash scripts/wait-load.sh 10`), never treated as green, never "fixed" by a timeout raise |
| `20261015T1035-kiko-release-1-2/1` (1.2 export drops `untracked_counterpart`; no migration on release-1.2) | LEFT OPEN (scribe). Related: set 1 makes `.kiko` v4, unreadable by 1.2.x; the release-step note of spec section 11 applies |
| `20261013T2223-kiko-harness-h5/5`, `/6`; `20261014T0952-kiko-harness-h7/1`; `20261015T0021-kiko-harness-h7/1`; `20261015T0639-kiko-harness-h7/1`; `20261015T1119-kiko-harness-h7/1` | LEFT OPEN, unrelated |

## BLOCKER for set 3 (needs a coordinator ruling before set 3 starts)

The spec says set 3 "moves code only" and puts `binance.history-walk.ts`, `binance.history-paging.ts`,
`binance.history-records.ts`, `binance.walk-write-deps.ts` into `exchange/walk/` and `exchange/paging/`. On the
base, a pure move creates a **feature value cycle**, which `check:feature-imports --tree` fails (`feature-cycle`
finding in `scripts/checks/feature-imports.js`, `findTreeViolations`):

- `binance.history-walk.ts` imports VALUES from `./binance.client` (`BINANCE_ASSET`) and `./binance.holding-keys`
  (`binanceKeyOf`, `WALLET_HOLDING_NAMES`);
- `binance.history-paging.ts` imports VALUES from `./binance.client` (`BinanceRateLimitError`) and
  `./binance.history-client` (`HISTORY_TOTAL_PAGE_SIZE`);
- `binance/` in turn imports the walk and paging values.

So `exchange/walk` -> `crypto-sync/binance` -> `exchange/walk`. The spec names the depth constants becoming a
per-exchange `DepthConfig` but names no injection for these five values. Options (the plan does not pick one):

- **A (recommended):** the moved walk and pager take those values from a per-exchange config object passed by the
  Binance callers (the same shape as `DepthConfig`: asset code, holding-key reader, default wallet names, a
  rate-limit predicate, the page size); the types `UnreadableRow`/`TotalPage` move to `exchange/paging`. Keys and
  requests stay byte-identical (set 3 step 1/9 pins them). Cost: about 5 extra parameters threaded through the
  walk entry points.
- **B:** set 3 moves only the cycle-free units (credentials, signing, budget shape, depth, amounts) and leaves
  walk, paging, records and walk-write-deps in `binance/` for 1.3-a; `exchange/walk-state` (set 4) is new and
  cycle-free. Cost: reverses the spec's unit table for four files; 1.3-b moves them later.

Set 3 steps 1/9 to 5/9 below are cycle-free under either option and may start; steps 6/9 to 9/9 are written for
option A and wait for the ruling. Sets 4-6 name walk files by their binance path; under option A the developer
re-greps the moved path.

## Review focus

1. A JSON array whose elements are not all objects (a string, a boolean, `null`, an object without the field) in
   `metadata.lots`, `metadata.contributions`, `draft.returns` or `matchers`: 0059 must rebuild it element for
   element, order kept, non-target elements byte-equal in value (`true` stays `true`, not `1`). Owner: set 1
   step 2/12, test "keeps every other array element as it was".
2. A USDT import key whose amount token collides, during the rewrite, with another row's not-yet-rewritten key:
   the UNIQUE `(source, external_id)` check fires per row inside one UPDATE. Owner: set 1 step 3/12 (two-phase
   temp-key update), test "rescales two keys whose new amount equals the other's old amount".
3. A large USDT display value near the safe bound (`9007199254740991` minor units): `formatMoney` divides a float;
   the spec claims no digit is rounded away. Owner: set 1 step 5/12, test "shows the largest storable USDT
   amount exactly". If it fails, stop and report (the fix is a design change, not this plan's).
4. A version 1-3 `.kiko` whose `deletedImportKeys` holds a USDT key: today's restore inserts those keys as stored
   (`insertDeletedImportKeys`), so the rescale must cover them or a re-import duplicates a deleted row. Owner: set 1
   step 7/12, test "rescales a deleted import key under a USDT holding".
5. A `sync_state` row created by 0060 with null stamps: any reader that treats row existence as "synced"
   (`lastSyncAt`-free checks) would show a never-synced account as synced. Owner: set 4 step 2/12, a grep of
   `syncStateRepo` readers plus a test "an account whose state row only carries walk state reads as never synced".

---

## Gates (common to every set; each set names its own deltas)

- [ ] At the set tip: `bash scripts/job-queue.sh check-all <worktree> "<track> task N/15 check-all"` exit 0.
- [ ] `bash scripts/checks/dup.sh <file>` alone on every touched test file; new test files under 5% alone.
- [ ] `KIKO_MUTATION_BASE=<set base sha> make mutable`: quote the printed file list and `mutable files: N (cap 30)`
      in BATCH READY. Over 30: stop and report; never cut silently.
- [ ] `bash scripts/job-queue.sh verify <worktree> "<track> task N/15 verify"` at the exact set tip sha (tree clean,
      HEAD unchanged until DONE), exit 0 with the full test count, before BATCH READY.
- [ ] Coordinator (not the developer): `bash scripts/job-queue.sh gate <worktree> "<track> task N/15 deep" <base> <head>`
      (`KIKO_MUTATION_BASE=<set base sha> make deep`), detached; agents wait only for the exit code.
- [ ] TIMEOUT-HEAVY: a file named on a `TIMEOUT-HEAVY` line is cleared by the orchestrator: for each timed-out
      mutant, apply it in a scratchpad copy and run the file's own colocated tests in plain jest
      (`npx jest <own test files> --runInBand`), record Killed or equivalent; the gate stays failed for that file
      and BATCH READY carries the failed gate plus the per-mutant proof table. Never raise the timeout.
- [ ] Mutation per-file floor: a touched file below about 65 in its last score gets its kill tests inside the set
      (memory "touching weak file: tests first").
- [ ] End of plan (after set 6): one `make verify` through the queue on the set 6 tip, re-run until green.

---

## Set 1: `crypto-exchanges-1.3-a task 1/15` (USDT at scale 8, 0059, `.kiko` v4, crypto display)

Spec ids: U1-U14 (U5b-d, U8b, U12b), DP1-DP5. Expected mutable files: about 8 (`currency.ts`, `format.ts`,
`envelope.ts`, `import-data.ts`, `restore-snapshot.ts`, `with-usdt-rescaled.ts`, `import-data.screen.tsx`, the
locale files), measured by `make mutable`. TIMEOUT-HEAVY risk: `currency.ts`, `format.ts` (app-wide fan-out).

**Interfaces produced:**
- `restoreDataSnapshot(snapshot: DataSnapshot, version: number): Promise<{ accountsRestored: number }>` (version required).
- `withUsdtRescaled(tables: UsdtRescaleTables, version: number): UsdtRescaleTables` in
  `src/data-transfer/snapshot/with-usdt-rescaled.ts`, where `UsdtRescaleTables = Pick<DataSnapshot, 'holdings' |
  'transactions' | 'categoryRules' | 'transactionTemplates' | 'deletedImportKeys'>`; throws
  `Error('data-transfer/amount-too-large: ...')`; `USDT_RESCALE_BOUND_MINOR_UNITS = 9_007_199_254`.
- `EXPORT_VERSION = 4`; `READABLE_EXPORT_VERSIONS = [1, 2, 3, 4]`.

### step 1/12: crypto amounts display trimmed (DP4, DP5)

Files: `src/currency/format/format.ts`, `src/currency/format/format.test.ts`,
`src/screens/forms/category-form/category-form.screen.test.tsx`.

- [ ] Tests first in `format.test.ts`: "shows a crypto amount with trailing zeros trimmed to two decimals"
      (`Money.fromMajor('BTC', 0.05)` -> `'₿0.05'`), "keeps every significant crypto decimal"
      (`Money.of('BTC', 12345)` -> `'₿0.00012345'`), "keeps a fiat amount at its fixed scale" (`Money.of('UAH',
      123450)` -> `'₴1,234.50'`, re-grep the UAH symbol placement).
- [ ] "was:" pins changed in this step: `format.test.ts` `toContain('1.00000000')` -> `toContain('1.00')` (and not
      `'1.00000000'`); `format.test.ts` `'₿0.50000000'` -> `'₿0.50'`; `category-form.screen.test.tsx` test "shows an
      amount in the currency of its own scale" `'₿0.00100000'` -> `'₿0.001'`. Unchanged on purpose:
      `currency.test.ts` `applySymbolPlacement('BTC', '', '0.05000000')`, `rule-summary.test.ts` mocked
      `'0.00100000 BTC'`, `rule-draft.test.ts` `'0.00100000'` input.
- [ ] Re-grep other fixed-8 strings: `grep -rnE "₿-?[0-9,]+\.[0-9]{8}" src e2e` and fix each rendered pin in this step.
- [ ] Red: run the three files; quote the failing count.
- [ ] Code: in `formatMoney`, `minimumFractionDigits: isCrypto(money.currency) ? Math.min(2, scale) : scale`,
      `maximumFractionDigits: scale`.
- [ ] Check: `npx jest src/currency/format src/screens/forms/category-form` green. Commit
      `feat(currency): show crypto amounts with trailing zeros trimmed`.

### step 2/12: 0059 rescales USDT amounts and JSON minor-unit fields (U1-U6, U8, U13, U14, bond untouched)

Files: `drizzle/migrations/0059_usdt_scale_8.sql` (new, hand-authored, no snapshot, as 0049),
`drizzle/migrations/meta/_journal.json` (idx 59 entry), `drizzle/migrations/migrations.js` (import `m0059`),
`drizzle/migrations/0059-usdt-scale-8.test.ts` (new).

- [ ] Re-grep every minor-unit field: `grep -rn "MinorUnits" src/db/schema.ts src/holdings/holding-metadata
      src/holdings/lots src/transaction-templates/draft src/categories/category-rules` plus any JSON shape added
      since; the test lists each field in one table (`RESCALED_FIELDS`) and fails if a new `*MinorUnits` key appears
      in those type files without a row (read the `.ts` files, not mutated `src` output).
- [ ] Tests first (real sqlite: `applyMigrationsThrough(database, '0058_add_untracked_counterpart')`, seed, apply
      the file split on `--> statement-breakpoint`), one `it` per row, `it.each` for the field table:
      - "rescales a USDT holding balance and synced balance" (12345 -> 12345000000);
      - "rescales a row on a USDT holding" (-1 -> -1000000);
      - "leaves price points and rates untouched" (`price_points` USDT `'41.25'`; `currency_rates` `USDT:UAH`);
      - "rescales a USDT amount matcher and keeps the rule matching the same rows" (100000 -> 100000000000);
      - "rescales a USDT template amount and its returns" (5000, [700] -> 5000000000, [700000000]);
      - "rescales an exchange template on each side's own currency" (USDT->UAH: 5000000000 / 20500; UAH->USDT:
        20500 / 5000000000);
      - "leaves a UAH template that names a USDT holding" (unchanged);
      - "leaves BTC and EUR holdings" (unchanged);
      - "rescales a value at the bound exactly" (9007199254 -> 9007199254000000);
      - "rescales every minor-unit field of USDT holding metadata" (contributions[].amountMinorUnits,
        principalMinorUnits, faceValueMinorUnits, purchasePriceMinorUnits, lots[].costMinorUnits);
      - "keeps every other array element as it was" (Review focus 1: a lots array with a string, `true`, `null` and an
        object without `costMinorUnits`, order kept);
      - "leaves malformed JSON byte-unchanged and still succeeds" (U13: metadata `'{bad'`, matchers `'not json'`);
      - "leaves a string or real field and rescales its integer siblings" (U14: `"5000"`, `12.5`, integer
        `purchasePriceMinorUnits`; template `amountMinorUnits` null);
      - "leaves the bond register untouched" (Q12: `bond_register.terms` byte-identical);
      - "leaves a row with no rescaled field byte-identical" (untouched JSON texts compared as bytes).
- [ ] Red: the file does not exist yet; quote the failing count.
- [ ] Code: SQL shape (bound guard comes in step 4/12; keys in step 3/12):
      ```sql
      UPDATE holdings SET balance_minor_units = balance_minor_units * 1000000,
        synced_balance_minor_units = synced_balance_minor_units * 1000000 WHERE currency = 'USDT';
      --> statement-breakpoint
      UPDATE transactions SET amount_minor_units = amount_minor_units * 1000000
        WHERE holding_id IN (SELECT id FROM holdings WHERE currency = 'USDT');
      --> statement-breakpoint
      -- scalar JSON field, one statement per path ($.principalMinorUnits, $.faceValueMinorUnits, ...):
      UPDATE holdings SET metadata = json_set(metadata, '$.principalMinorUnits',
          json_extract(metadata, '$.principalMinorUnits') * 1000000)
        WHERE currency = 'USDT'
          AND CASE WHEN json_valid(metadata) THEN json_type(metadata, '$.principalMinorUnits') END = 'integer';
      --> statement-breakpoint
      -- array field, rebuilt in order ($.lots / costMinorUnits; $.contributions / amountMinorUnits):
      UPDATE holdings SET metadata = json_set(metadata, '$.lots', (
          SELECT json_group_array(CASE
              WHEN element.type = 'object'
                AND json_type(element.value, '$.costMinorUnits') = 'integer'
                THEN json_set(element.value, '$.costMinorUnits',
                  json_extract(element.value, '$.costMinorUnits') * 1000000)
              WHEN element.type IN ('object', 'array') THEN json(element.value)
              WHEN element.type = 'true' THEN json('true')
              WHEN element.type = 'false' THEN json('false')
              WHEN element.type = 'null' THEN json('null')
              ELSE element.value END ORDER BY element.key)
          FROM json_each(metadata, '$.lots') AS element))
        WHERE currency = 'USDT'
          AND CASE WHEN json_valid(metadata) THEN json_type(metadata, '$.lots') END = 'array'
          AND EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(metadata) THEN metadata END, '$.lots') AS element
            WHERE element.type = 'object' AND json_type(element.value, '$.costMinorUnits') = 'integer');
      ```
      `category_rules.matchers`: the same array rebuild over the top-level array, target element = object with
      `$.type = 'amount'`, `$.currency = 'USDT'`, integer `$.minorUnits`. `transaction_templates.draft`: amount and
      `returns[]` keyed on `$.currency = 'USDT'`; `$.exchange.valueInMinorUnits` keyed on
      `$.exchange.destinationCurrency = 'USDT'`; every guard as `CASE WHEN json_valid(draft) THEN ... END`. The
      test asserts `SELECT sqlite_version()` is at least 3.44 on `node:sqlite` (aggregate `ORDER BY`); op-sqlite
      bundles 3.51.3 (kiko-architecture "Storage").
- [ ] Check: `npx jest drizzle/migrations/0059-usdt-scale-8.test.ts` green; `drizzle/migrations` suite green;
      `./node_modules/.bin/biome check --write drizzle/migrations/meta/_journal.json drizzle/migrations/migrations.js`.
      Commit `feat(db): rescale stored USDT amounts to scale 8`. This commit alone is not a tip (scale still 2):
      steps 2-5 land in one set.

### step 3/12: 0059 rewrites USDT statement-import keys (U11, U12, U12b)

Files: `0059_usdt_scale_8.sql`, `0059-usdt-scale-8.test.ts`.

- [ ] Tests first: "rescales the amount token of a USDT import key and of its occurrence-suffixed twin"
      (`<id> 1700000000 -1250 coffee` -> `... -1250000000 coffee`; `<id> 1700000000 -500 tea␟1` in
      `deleted_import_keys` -> `-500000000 tea␟1`); "leaves a bank-issued key alone"; "decides by the key's first
      token, not the row's holding" (USDT-keyed row now on a UAH holding: rewritten; UAH-keyed row now on the USDT
      holding: unchanged; same two keys in `deleted_import_keys`); "rescales two keys whose new amount equals the
      other's old amount" (Review focus 2); "a re-import of the same statement after the migration adds no row"
      (compute the key with `computeDedupKey` at scale 8 and assert it equals the stored key).
- [ ] Red; quote the count.
- [ ] Code: a `CREATE TEMP TABLE usdt_import_keys (table_name text, row_key text, old_key text, new_key text)` filled
      from `transactions` (`source = 'import'`) and `deleted_import_keys`, tokens by `instr`/`substr` (first token =
      holding id joined to `holdings.id` with `currency = 'USDT'`; third token kept only when it is an integer text:
      `CAST(token AS INTEGER) || '' = token`); phase 1 sets each listed key to `'usdt-rescale␟' || row_key`; phase 2
      sets `new_key`; `DROP TABLE usdt_import_keys`. Every other byte of the key kept.
- [ ] Check: test file green. Commit `feat(db): rescale the amount in USDT statement-import keys`.

### step 4/12: 0059 bound guard aborts before any write (U8b, migration side)

Files: `0059_usdt_scale_8.sql`, `0059-usdt-scale-8.test.ts`,
`src/migration/migrations-gate/migrations.gate.test.tsx` (re-grep the gate's test file name).

- [ ] Tests first: "aborts on a value over the bound and writes nothing" (9007199255 in each field class of the
      table: holding balance, row, metadata field, matcher, template, key token; error message contains `CHECK
      constraint failed: usdt_rescale_guard`; every table byte-equal to the seed); "skips malformed JSON in the bound
      count" (U13 seed + an in-bound value: succeeds); "the bound literal equals `USDT_RESCALE_BOUND_MINOR_UNITS`"
      (reads the `.sql` text; the constant lands in step 7/12, so this case is added there). Gate test: "shows the
      migration error with the guard message" (`runMigrations` rejects with that message; `migrations-gate-error`
      shows `migrations.error` with it; children not rendered).
- [ ] Red; quote the count.
- [ ] Code: first statements of the file: `DROP TABLE IF EXISTS usdt_rescale_bound`; `CREATE TEMP TABLE
      usdt_rescale_bound (over_bound integer CONSTRAINT usdt_rescale_guard CHECK (over_bound = 0))`; one `INSERT INTO
      usdt_rescale_bound (over_bound) SELECT (<count>) + (<count>) + ...` over every field of steps 2 and 3, each
      JSON count behind the CASE guard (`json_each(CASE WHEN json_valid(c) THEN c END, '$.path')`), `abs(value) >
      9007199254`; last statement `DROP TABLE usdt_rescale_bound`.
- [ ] Check: test files green. Commit `feat(db): refuse the USDT rescale over the safe-integer bound`.

### step 5/12: `currencyScale.USDT` = 8 and the USDT pin sweep (DP1-DP3, U9)

Files: `src/currency/currency/currency.ts`, `format.test.ts`, `currency.test.ts`,
`src/rates/rates-refresh/crypto-coverage.test.ts`, `src/rates/conversion/uah-star-parity.test.ts`, any other
test re-grep finds (`grep -rn "USDT" src --include=*.test.ts* | grep -i "minor\|balance\|scale"`).

- [ ] Tests first: `format.test.ts` "shows a USDT amount with two decimals" (12345000000 -> `'₮123.45'`),
      "shows a sub-cent USDT amount" (12345 -> `'₮0.00012345'`), "shows one USDT with two decimals" (100000000 ->
      `'₮1.00'`), "shows the largest storable USDT amount exactly" (Review focus 3); `currency.test.ts` "parses
      0.00012345 USDT to its minor units" (`Money.fromMajor('USDT', 0.00012345).minorUnits` = 12345; Binance USDT
      balances are read from set 5, so U9 is pinned on the parse here and through the provider in set 5).
- [ ] "was:" pins: `currency.test.ts` `expect(currencyScale.USDT).toBe(2)` -> `8`; `crypto-coverage.test.ts`
      `balanceMinorUnits: 100_000_00` (100,000.00 USDT) -> `100_000_00000000`; `uah-star-parity.test.ts`
      `usdtWallet.balanceMinorUnits: 10_000` -> `10_000_000_000`; every valued UAH total in those tests stays equal
      (U1 "valued in UAH equal").
- [ ] Red; quote the count. Code: `USDT: 8` in `currencyScale`.
- [ ] Check: `npx jest src/currency src/rates` green. Commit `feat(currency): store USDT at scale 8`.

### step 6/12: `restoreDataSnapshot` takes a required version (Q2)

Files: `src/data-transfer/snapshot/restore-snapshot.ts`, `src/data-transfer/import-data.ts`, the 16 test files
that call it (78 calls; re-grep `restoreDataSnapshot(` in `src`, `e2e`, `drizzle`).

- [ ] Test first in `import-data.test.ts`: "restores with the file's own version" (a spy on the restore seam
      receives `envelope.version`).
- [ ] Red; then code: signature `(snapshot: DataSnapshot, version: number)`, no default; `import-data.ts` passes
      `envelope.version`. Every test call passes `EXPORT_VERSION`, except a test whose subject is an older file
      (two-path tests of legacy mirrors, `restore-across-reminders-migration.test.ts`, back-compat cases), which
      passes the version it models (3). `build-demo-snapshot.ts` does not call `restoreDataSnapshot` on the base
      (comment only): nothing to change there; re-grep.
- [ ] Check: `npx tsc --noEmit` clean; `npx jest src/data-transfer` green. Commit
      `refactor(data-transfer): restore takes the file's version`.

### step 7/12: `withUsdtRescaled` (U1-U5d, U11-U14 on the restore side; U8b restore side)

Files: `src/data-transfer/snapshot/with-usdt-rescaled.ts` (new), `with-usdt-rescaled.test.ts` (new),
`restore-snapshot.ts`, `0059-usdt-scale-8.test.ts` (bound literal case).

- [ ] Tests first (pure, row objects): one case per field class of step 2 and 3 with the same values; "returns the
      tables unchanged for a version 4 file" (same references); "rescales a deleted import key under a USDT holding"
      (Review focus 4); "decides a key by its first token's holding" (U12b); "leaves malformed matchers text and a
      non-object metadata as stored" (U13); "leaves a string or real field" (U14); "throws amount-too-large over the
      bound and names nothing restored" (message starts `data-transfer/amount-too-large`; pin the full message
      literal); "the bound literal equals the migration's" in the migration test.
- [ ] Red; quote the count.
- [ ] Code: a field is rescaled only when its column parsed (metadata/draft: a plain object; matchers: `JSON.parse` in
      a try, rewritten with `JSON.stringify` only when a field changed) and the value is `Number.isSafeInteger`;
      `abs(value) > USDT_RESCALE_BOUND_MINOR_UNITS` throws. Key holding lookup over the holdings the restore inserts.
      In `restoreDataSnapshot`, call it LAST among the mirrors (after `withImportTimesRezoned`), on
      `holdingsToInsert`, `transactionsToInsert`, `snapshot.categoryRules`, `snapshot.transactionTemplates`,
      `snapshot.deletedImportKeys`, before `readLiveDeviceSettings` and `deleteAllTables`, and insert its output.
- [ ] Check: `npx jest src/data-transfer` green. Commit `feat(data-transfer): rescale USDT in an older backup`.

### step 8/12: two-path parity, migration vs restore (U7, U10, U13, U14, U8b)

Files: `src/data-transfer/snapshot/restore-usdt-rescale.two-path.test.ts` (new).

- [ ] Tests (follow `restore-import-time-rezone.two-path.test.ts`): seed one scale-2 database through 0058 with U1-U5c
      rows, a legacy pre-`␟` dedup key and the U13/U14 rows; path 1 applies 0059 (+ the launch-time key upgrade and
      rezone the gate runs); path 2 exports the seed as a version 3 snapshot and restores it on a fresh migrated
      database. Assert every table equal (JSON columns compared parsed for rewritten rows, bytes for untouched rows):
      "a version 3 backup restores equal to the migrated database"; "a version 4 backup restores byte-unchanged"
      (12345000000 stays); "a version 3 backup over the bound is refused and the live data stays" (U8b: error prefix,
      every table equal to before).
- [ ] Red against step 6's tip (restore without the rescale): quote the count. Check: green. Commit
      `test(data-transfer): migration and restore agree on the USDT rescale`.

### step 9/12: `.kiko` v4 and the refused-import message (Q3, Q7)

Files: `src/data-transfer/crypto/envelope.ts`, `envelope.test.ts`,
`src/screens/settings/import-data/import-data.screen.tsx`, its test, `src/i18n/locales/en.ts`, `uk.ts`.

- [ ] Tests first: `envelope.test.ts` `VERSION_DECISIONS` -> `version: 4`, `migrationCount: 60`, with the reason
      comment "Through <0059 tag>, which rescales USDT to scale 8: an older build would read every USDT value 10^6
      too large, so it must refuse the file by its version; this build rescales an older file on restore."
      (this comment block is the established place for migration tags); readable-version case adds 4.
      Import screen test: "shows the too-large message when a backup is refused by the USDT bound" (restore rejects
      with the prefix; `settings.dataImport.errorTitle` + `amountTooLargeError` text).
- [ ] "was:" pins: `VERSION_DECISIONS` `{ version: 3, migrationCount: 59 }` -> `{ version: 4, migrationCount: 60 }`;
      `generate-demo-kiko.test.ts` `expect(envelope.version).toBe(EXPORT_VERSION)` stays and now reads 4.
- [ ] Red; code: `EXPORT_VERSION = 4`; `READABLE_EXPORT_VERSIONS = [1, 2, 3, 4]`; `IMPORT_ERROR_KEYS` gains
      `['data-transfer/amount-too-large', 'settings.dataImport.amountTooLargeError']`; key en "This backup has a USDT
      amount too large for Kiko to store exactly, so nothing was imported. Your current data is unchanged."; uk «У
      цій резервній копії є сума в USDT, завелика, щоб Кіко зберіг її точно, тому нічого не імпортовано. Ваші поточні
      дані не змінено.»
- [ ] Check: `npx jest src/data-transfer src/screens/settings src/i18n` green. Commit
      `feat(data-transfer): export version 4 and the too-large import message`.

### step 10/12: demo files regenerated

Files: `e2e/screenshot/fixtures/kiko-demo-en.kiko`, `kiko-demo-uk.kiko`.

- [ ] `KIKO_REGEN_DEMO=1 npx jest e2e/screenshot/fixtures/generate-demo-kiko.test.ts`, then the same command without
      the variable green; `kiko-demo-en-1.1.kiko` untouched. Commit `chore(demo): regenerate demo files at version 4`.

### step 11/12: reviews and the device check

- [ ] `kiko:reviewer` on 0059 before BATCH READY, briefed with the top question: "can any field, key or array element
      be rescaled twice, missed, or aborted on malformed JSON, and do migration and restore agree byte for byte?"
      plus: the queries that read the touched columns and tables (no index added, so no EXPLAIN QUERY PLAN test).
- [ ] Translator review of `settings.dataImport.amountTooLargeError` (en + uk) against kiko-translator by the
      reviewer; the en/uk diff goes to the coordinator for the user before deploy.
- [ ] Device check (kiko:ops "Device verification checklist"): build with `scripts/deploy-device.sh`'s
      `CONFIGURATION` (Release-AdHoc; re-verify), install per the Device-deploy recipe; run first launch + migrations
      gate on the upgraded device, export -> import round trip, net worth + statistics, uk locale; the user confirms
      the Q1 display live: a BTC holding shows `₿0.05`-style trimmed amounts, a USDT holding `₮123.45`, fiat unchanged.
      The migration-behaviour change is device-verified before archiving. Ops installs; the user confirms; set 1 is
      not done before that.

### step 12/12: skill text (kiko:scribe, same set)

- [ ] `kiko-domain`: the "`minorUnits` is always an integer" scale text near "Scale is" and the "A small closed set
      (`BTC` at scale 8, everything else at scale 2)" paragraph -> USDT at 8, pointer to `currencyScale`; the 0044
      legacy BTC/ETH/USDT paragraph gains a pointer to the 0059 rescale and `withUsdtRescaled`.
- [ ] `kiko-domain` / `kiko-design-system` money display (`formatMoney` mentions): crypto trims trailing zeros, at
      least 2 decimals; fiat fixed. Pointers to code, no copied counts. Commit by scribe.

Set 1 gate deltas: migration set -> kiko:reviewer done; device confirmation recorded; TIMEOUT-HEAVY proofs for
`currency.ts`/`format.ts` if named.

---

## Set 2: `crypto-exchanges-1.3-a task 2/15` (coin registry, parser, CoinGecko isolation, 0044 frozen, picker)

Spec ids: R1-R5, registry invariants, parser exact-parity property. Expected mutable files: about 12 (spec) /
8-10 (prep). TIMEOUT-HEAVY risk: `currency.ts`, `decimal.ts`.

**Interfaces produced:**
- `decimalToMinorUnits(text: string, scale: number, rounding: 'exact' | 'half-away-from-zero'):
  Either<DecimalAmountError, number>` in `src/currency/decimal/decimal.ts`, `DecimalAmountError = 'amount-malformed' |
  'amount-precision' | 'amount-too-large'`. Grammar `^-?[0-9]+(\.[0-9]+)?$` (no exponent, no spaces); BigInt inside.
- `coinScale(entry: { baseAssetPrecision: number; maxUnits: number }): number`, `MIN_COIN_SCALE = 2`,
  `curatedCoins: Readonly<Record<CryptoCurrency, CoinEntry>>` in `src/currency/coins/coins.ts` (barrel
  `src/currency/coins/index.ts`).
- `FROZEN_1_0_CRYPTO_CODES = ['BTC', 'ETH', 'USDT'] as const` in `restore-snapshot.ts`.

### step 1/10: exact decimal-to-minor-units parser (Q5)

Files: `decimal.ts`, `decimal.test.ts`.
- [ ] Tests first: "parses an exact decimal at the scale" (`'0.00012345'`, 8 -> 12345); "pads missing decimals"
      (`'4150'`, 2 -> 415000); "drops trailing zeros past the scale" (`'4150.000'`, 2 -> 415000); "refuses a non-zero
      digit past the scale" (`'4150.001'` -> `amount-precision`); "rounds half away from zero when asked"
      (`'1.23456789'`, 3 -> 1235; `'-1.2345'`, 3 -> -1235); "refuses an exponent form" (`'1e-8'` -> `amount-malformed`);
      "refuses a value above the safe integer" (`'90071992.54740992'`, 8 -> `amount-too-large`; `'90071992.54740991'`
      -> 9007199254740991, exact limit case); property "round-trips every safe integer at every scale 0-8" (BigInt
      reference, `shiftDecimal` text) as the exact-parity property.
- [ ] Red; code; check `npx jest src/currency/decimal`. Commit `feat(currency): exact decimal to minor units parser`.

### step 2/10: coin registry with the scale formula (R1-R5, invariants)

Files: `src/currency/coins/coins.ts`, `index.ts`, `coins.test.ts` (new).
- [ ] Curation (network reads, public endpoints, recorded with date, URL and result in the commit message): CoinGecko
      `/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=50`, `/coins/list` (verify `chaingpt` and every
      id), Binance `GET /api/v3/exchangeInfo` (`baseAssetPrecision`, `<CODE>USDT` symbol status). List rule of spec
      section 3 (user coins BTC, USDT, CGPT; top 30 minus excluded classes and fiat-colliding codes; USDC, FDUSD, DAI;
      BNB kept). `maxUnits` per coin from supply (stablecoins 90,000,000); `dustBelow` near 1 USD at the curation price.
- [ ] Tests first: "derives scale 8 for a stablecoin" (R1); "reduces scale for a huge supply" (R2: precision 8,
      maxUnits 10^12 -> 3, reduced; `decimalToMinorUnits('1.23456789', 3, 'half-away-from-zero')` = 1235); "keeps a
      coin under the minimum scale off the registry" (R3: 10^15 -> 0 < 2); "keeps the exchange precision when
      smaller" (R4: precision 6, 10^6 -> 6, not reduced; a 7-decimal row refused `amount-precision`); "keeps BTC and ETH
      at scale 8" (R5); invariants per entry with `it.each(Object.values(curatedCoins))`: keys equal the crypto block,
      unique CoinGecko ids, scale = formula, scale >= 2, `maxUnits * 10^scale <= MAX_SAFE_INTEGER`, `reducedScale =
      scale < baseAssetPrecision`, `binanceSymbol` ends in `USDT` except USDT.
- [ ] Red; code; check. Commit `feat(currency): curated coin registry` (curation record in the body).

### step 3/10: crypto lists derive from the registry

Files: `currency.ts`, `src/rates/coingecko-ids/coingecko-ids.ts`, `currency.test.ts`, `coingecko-ids.test.ts`.
- [ ] Tests first: "lists every curated code after the fiat block"; "derives scale, symbol and CoinGecko id from
      the registry".
- [ ] "was:" pins: `currency.test.ts` `currencyOptions.slice(-3)` `['BTC','ETH','USDT']` -> the curated block in
      registry order; test "treats BTC, ETH, and USDT as crypto and everything else as fiat" -> every curated code is
      crypto; `[...cryptoCurrencyOptions]` -> the curated list; `coingecko-ids.ts` record type -> `Record<CryptoCurrency,
      string>` from the registry.
- [ ] Code: `currencyOptions` crypto block written literally; `CryptoCurrency`, `cryptoCurrencies`, crypto
      `currencyScale`, crypto `currencySymbol`, `cryptoCoinGeckoId` derived from `curatedCoins`; USDT's literal 8 from
      set 1 now comes from the registry (same value). Check `npx tsc --noEmit`, `npx jest src/currency src/rates`.
      Commit `refactor(currency): derive the crypto lists from the registry`.

### step 4/10: coin names en + uk

Files: `en.ts`, `uk.ts`, `currency-names.i18n.test.ts`.
- [ ] Test first: "names every curated coin in en and uk" (`it.each` over the registry). "was:" pins: the USDT-only
      name asserts stay; add the rest. Code: `currencyNames.<CODE>` per coin (proper nouns per kiko-translator).
      Commit `feat(i18n): names for the curated coins`.

### step 5/10: 0044 stays frozen on restore

Files: `restore-snapshot.ts`, `drizzle/migrations/0044-move-crypto-cash-holdings.test.ts`,
`restore-crypto-cash.two-path.test.ts`.
- [ ] Tests first: "moves only the 1.0 crypto codes" (a `cash` USDC holding stays `cash`); in the 0044 test, "the
      restore's frozen list equals the migration's IN list" (reads the `.sql`).
- [ ] "was:" pin: 0044 test `expect(['BTC', 'ETH', 'USDT']).toEqual(cryptoCurrencyOptions)` ->
      `toEqual(FROZEN_1_0_CRYPTO_CODES)`. Code: `withCryptoCashHoldingsMoved` uses `FROZEN_1_0_CRYPTO_CODES` instead of
      `!isFiat`. Commit `fix(data-transfer): keep the frozen 1.0 crypto list on restore`.

### step 6/10: CoinGecko price per coin (closes "crypto price all-or-nothing")

Files: `src/rates/coingecko/coingecko.ts`, `coingecko.test.ts`, `rates-refresh.ts`, its test.
- [ ] Tests first: "returns the priced coins when one coin is missing"; refresh "writes a UAH row per priced coin and
      none for the missing one".
- [ ] "was:" pin: `coingecko.test.ts` "rejects when any requested coin is missing a finite usd price" -> resolves
      with that coin absent (whole response failure still rejects). Code; check `npx jest src/rates`. Commit
      `feat(rates): price each coin on its own`.

### step 7/10: crypto prices and history only for held coins (Q9)

Files: `coingecko.ts`, `coingecko-history.ts`, `history-backfill.ts`, `rates-refresh.ts`, their tests.
- [ ] Tests first: "never requests a curated coin no holding uses" (live and history); "requests a held coin's
      history once". Code: remove the `currencies = cryptoCurrencyOptions` defaults; callers pass the held crypto
      codes (re-grep the holdings read the refresh already does); the `currencyOptions.filter(isCrypto)` loop in
      `history-backfill.ts` iterates held codes. Commit `feat(rates): fetch crypto only for held coins`.

### step 8/10: picker lists every curated coin

Files: `holding-form.screen.test.tsx`, `currency-field.component.test.tsx` (code needs none: `holding-currency.ts`
derives; re-grep).
- [ ] "was:" pins: `holding-form.screen.test.tsx` `codes.slice(0, 4)` `['BTC','ETH','USDT','UAH']` -> curated block
      then `'UAH'`; `currency-field.component.test.tsx` test "groups crypto (BTC, ETH, USDT) after every fiat
      currency..." -> every curated coin, alphabetical within; base-currency setting test "offers fiat only" kept or
      added. Commit `test(forms): the holding picker lists every curated coin`.

### step 9/10: demo seed

Files: `e2e/screenshot/fixtures/build-demo-snapshot.ts`, `build-demo-snapshot.test.ts`, both demo `.kiko`.
- [ ] Test first: "the demo crypto account holds at least five curated coins, a UAH and a EUR holding, one coin with a
      dated price history". Code; `KIKO_REGEN_DEMO=1` regen. Commit `chore(demo): curated coins in the demo`.

### step 10/10: skill text (kiko:scribe)

- [ ] `kiko-domain` scale text -> pointer to `curatedCoins` and `coinScale`; `kiko-pricing` CoinGecko paragraph
      ("`ETH`/`USDT` derive the same way"): stablecoins priced from the market, never 1:1; per-coin isolation; history
      only for held coins. Translator review of the coin names (reviewer + user before deploy).

---

## Set 3: `crypto-exchanges-1.3-a task 3/15` (layer extraction, code moves only) — see BLOCKER

Spec: "today's suites green unchanged; a byte-identical key and request snapshot test". Expected mutable files:
20-26 (prep). First commit = moves + importers; then `KIKO_MUTATION_BASE=<set 3 base> make mutable`; over 30 ->
split into 3a (steps 2-5) and 3b (steps 6-8), each with its own base, before review. Moves are `git mv` with only
import lines edited, so `--find-renames` keeps the mutated lines small; a file edited beyond its imports is
mutated whole (`binance.history-walk.ts` is 1470 lines: keep its body unchanged).

### step 1/9: key and request snapshot (characterization, green before and after)

Files: `src/crypto-sync/binance/binance.layer-snapshot.test.ts` (new).
- [ ] Tests: for each endpoint the walks call, the signed query string and headers for a fixed clock and key; every
      external id the capital, Pay, Transfer and Earn walks write for one fixture each. Green on the base (no red:
      it is a characterization pin; state so in BATCH READY). Commit `test(binance): pin keys and signed requests`.

### step 2/9: `exchange/` container, signing unit

Files: `scripts/checks/feature-imports.js` (`CONTAINERS` gains `'crypto-sync/exchange'`), `git mv
binance.hmac.ts exchange/signing/signing.ts` (+ test), `exchange/signing/index.ts`, importers.
- [ ] `SignRequest` type per spec section 2; Binance signer keeps HMAC-SHA256 hex + `X-MBX-APIKEY`. Check:
      `npm run check:feature-imports` (incl. `--tree`), step 1 test green. Commit.

### step 3/9: credentials unit with Binance wrappers kept (Q8)

Files: `exchange/credentials/` (`credentialServiceFor`, save/load/clear over `react-native-keychain`), `binance.
credentials.ts` thin wrappers (`saveCredentials`, `readCredentials`, `clearCredentials`), `migrate-binance-
credential.ts`. Outside importers unchanged (`accounts.repo.ts`, `account-form.screen.tsx`, `migrations.gate.tsx`,
`binance-credentials-field.component.tsx`, `restore-secrets.ts`, `read-secrets.ts`, `disconnect.ts`,
`run-crypto-sync.ts`; re-grep).
- [ ] Test first: "the Binance service string is byte-identical" (`kiko.binance.credentials.<accountId>`). Commit.

### step 4/9: budget shape and depth config

Files: `exchange/budget/` (`RunBudget<Lane>`, `RequestGate`, `createExchangeRun`), Binance numbers and weight
headers stay in `binance.history-budget.ts`; `binance.history-depth.ts` constants -> a Binance `DepthConfig`
passed to the moved depth functions. Today's budget and depth suites green unchanged. Commit.

### step 5/9: amounts unit (no production caller yet)

Files: `exchange/amounts/amounts.ts`, `index.ts`, `amounts.test.ts`.
- [ ] Tests first (imported through `@kiko/crypto-sync/exchange/amounts`, so knip sees a consumer):
      "`exchangeMinorUnits` returns exact minor units", "refuses more decimals than the scale", "rounds on a
      reduced-scale coin", "refuses above the safe integer", "refuses an exponent form". Code wraps
      `decimalToMinorUnits` with the registry's scale and `reducedScale`. Commit.

### steps 6/9-8/9 (wait for the BLOCKER ruling; option A shown)

- [ ] step 6/9: `exchange/paging/` (`Pager`, `SpanRead`, `offsetPager` = today's paging moved; `UnreadableRow`,
      `TotalPage` types move here; the page size and rate-limit predicate come from the Binance config).
- [ ] step 7/9: `exchange/walk/` (history-walk, history-records, walk-write-deps moved; `BINANCE_ASSET`,
      `binanceKeyOf`, `WALLET_HOLDING_NAMES` come from the Binance config); `btcSatoshis`/`sumSatoshis` unchanged.
- [ ] step 8/9: `BINANCE_ASSET` defined once (re-grep both definitions); every suite and step 1's snapshot green
      unchanged; `npm run check:feature-imports -- --tree` clean.

### step 9/9: skill text (kiko:scribe)

- [ ] `kiko-architecture` "Binance exchange sync" and "Binance transaction history" sections: the `exchange/` units as
      far as set 3 lands them; the container rule in `kiko-linter`/`kiko-code-style` if it names containers.

Set 3 gate deltas: `check:feature-imports --tree` clean is the set's main proof; mutation expected low (moves).

---

## Set 4: `crypto-exchanges-1.3-a task 4/15` (walk state to `sync_state`, 0060)

Spec ids: Z1-Z6, X1-X4, walk properties at 0 / 1 h / 1 day. Expected mutable files: about 18. TIMEOUT-HEAVY risk:
none app-wide; the walk files have large related-test fan-out: name proofs if flagged.

**Interfaces produced:** `ExchangeState`, `WalkMarks`, `WalkId` (spec section 2) and `parseExchangeState(text: string |
null): ParsedExchangeState` in `src/crypto-sync/exchange/walk-state/`; `syncStateRepo.patchExchangeState(accountId,
exchangeId, patch: ExchangeStatePatch)`; test helper `walkMarksOf(database | rows, accountId, walkId)` /
`withWalkMarks(seed, accountId, walkId, marks)` in `src/test-support/walk-marks.ts`.

### step 1/12: test-only helper commit (Q11)

Files: `src/test-support/walk-marks.ts` (new; `test-support/**` is already `TEST_ONLY`), the 17 test files that read
or seed the 24 old keys (re-grep `binance(History|Pay|Transfer|Earn)(HistoryCursor|Cursor|PendingOverlap|
PointCursor|RangeCursor|RescanCursor|SpanHints)` in tests; about 400 lines).
- [ ] No app change; every seed and read goes through the helper, mapping (walk id, field) to today's metadata key on
      the holding that carries it (re-grep `setBinanceWalkCursor` callers). Check: every touched suite green, same
      test and assertion counts; dup.sh alone per touched file. Commit `test(binance): one helper for walk marks`.

### step 2/12: schema and 0060 (Z1-Z5)

Files: `src/db/schema.ts` (`syncState.exchangeState: text('exchange_state')`), `npx drizzle-kit generate --name
exchange_state` -> `0060_*.sql` + snapshot + journal + `migrations.js` (re-check the file after generate; biome
write), the hand-appended copy, `drizzle/migrations/0060-exchange-state.test.ts` (new).
- [ ] Tests first (real sqlite through 0059): "creates the state row for an account with walk keys and leaves its
      stamps null" (Z1); "copies a disconnected account's floor values as stored" (Z2); "copies every walk field into
      its walk entry" (Z3, field map pinned as a table; lists and objects stay JSON via `json(...)`); "skips an
      account whose metadata is not JSON and still succeeds" (Z4); "copies a malformed pending value as stored" (Z5);
      "an account whose state row only carries walk state reads as never synced" (Review focus 5; grep every
      `syncStateRepo`/`syncState` reader for row-existence checks first and list them in the commit body).
- [ ] Code: `ALTER TABLE sync_state ADD exchange_state text;` then `INSERT INTO sync_state (account_id, exchange_state)
      SELECT h.account_id, json_object('version', 1, 'walks', json_object('capital', json_object('cursor',
      json_extract(...), ...), 'pay', ..., 'transfer', ..., 'earn', ...)) FROM holdings h WHERE CASE WHEN
      json_valid(h.metadata) THEN json_extract(h.metadata, '$.binanceAsset') END = 'BTC' AND <has a walk key, guarded>
      ON CONFLICT(account_id) DO UPDATE SET exchange_state = excluded.exchange_state;` every `json_extract` behind the
      CASE guard; `json(...)` for `pending` and `spanHints`; a field absent in metadata stays absent.
- [ ] Commit `feat(db): walk state column on sync_state`.

### step 3/12: per-walk parse (X1 parse side, Z5 parse side)

Files: `exchange/walk-state/walk-state.ts`, `index.ts`, `walk-state.test.ts`.
- [ ] Tests first: top level malformed (not JSON, wrong version) -> `malformed`; each walk field parsed by today's rule
      (`binanceWalkCursorOf`, `readPendingMark`, `readRoundRobinCursor`, `readSpanHints`; re-grep each), a malformed
      field never empties its siblings; a non-object walk entry reads as empty values with the walk tag; `trades`,
      `untrackedCoins`, `oversizedCoins` parse alone. Commit.

### step 4/12: gated writer (X2-X4)

Files: `src/sync-state/sync-state.repo.ts`, `sync-state.repo.test.ts` (real sqlite).
- [ ] Tests first: "replaces only the named field and keeps a malformed sibling byte-identical" (X2); "writes nothing
      once the account left the exchange" (X3); "inserts the row when none exists" (X4); "never overwrites a malformed
      top level". Code: inside `write(...)`, re-read, gate on `accounts.institution = exchangeId`. Commit.

### step 5/12: walks read and write `exchange_state`; helper switched

Files: walk readers/writers (`binance.walk-write-deps.ts`, `binance.history-walk.ts`, `binance.transactions.ts`,
pay/transfer/earn walk entry points), `holdings.repo.ts` (`setBinanceWalkCursor`, `setBinanceWalkPending`,
`setBinanceWalkSpanHints`, `resetBinanceWalkCursors` removed; `carriedMetadataKeys` stops carrying the 24 keys),
`holding-metadata.ts` walk readers removed or moved, `src/test-support/walk-marks.ts` now seeds/reads `exchange_state`.
- [ ] Test first: "reads back every BTC walk mark equal to the old metadata" (Z3 read-back through the parse, all four
      passes of span hints). Then the full binance suites green with the switched helper. Commit
      `feat(binance): walk state lives in sync_state`.

### step 6/12: malformed state pauses history, balance still syncs (X1, paused caption)

Files: run wiring (`run-crypto-sync.ts` / `binance.transactions.ts`), `binance-history-status.ts`,
`crypto-sync-section.component.tsx`, its test, `en.ts`, `uk.ts`.
- [ ] Tests first: "writes the balance and runs no history walk on a malformed state" (tag `exchange-state-malformed`
      logged once, nothing written to the column); "shows the paused caption" (`accountDetail.exchangeHistoryPaused`
      with `exchange: 'Binance'`). Key en "{{exchange}} history import is paused because Kiko could not read its saved
      import progress. Disconnect and reconnect {{exchange}} to repair it; your holdings and transactions stay."; uk
      «Імпорт історії {{exchange}} призупинено, бо Кіко не зміг прочитати збережений прогрес імпорту. Відʼєднайте й знову
      підключіть {{exchange}}, щоб це виправити; ваші активи й транзакції залишаться.» Commit.

### step 7/12: disconnect resets the state

Files: `src/crypto-sync/disconnect/disconnect.ts`, test.
- [ ] Test first: "resets walks to the floor, removes lists and replaces a malformed value, then clears the key";
      holdings and rows stay. Commit.

### step 8/12: restore mirror (Z6)

Files: `restore-snapshot.ts` (`withWalkStateMoved`), `restore-walk-state.two-path.test.ts` (new).
- [ ] Tests first: "a backup without walk state restores equal to the migrated database" (Z1-Z5 seeds); "adds a state
      row when the backup has none" (Z6); "a backup with walk state restores it unchanged". Commit.

### step 9/12: version decision and demo

Files: `envelope.test.ts`, demo `.kiko` files.
- [ ] `VERSION_DECISIONS` gains the reason "Through <0060 tag>, a nullable column riding inside the sync state row,
      derived on restore: an older build drops the key and its walks read from their floors, where keys dedupe; so it
      needed no bump." -> `{ version: 4, migrationCount: 61 }` ("was:" `migrationCount: 60`). `KIKO_REGEN_DEMO=1` regen.
      Commit.

### step 10/12: walk properties at three clock gaps

Files: `binance.history-walk.properties.test.ts` (has `RUN_GAPS = [0, HOUR_MS, DAY_MS]`; re-grep).
- [ ] Every property runs on the `exchange_state` store at each gap; add "a patch never loses another walk's marks
      across runs" at the three gaps. Commit.

### step 11/12: reviews

- [ ] `kiko:reviewer` on 0060 before BATCH READY (top question: "can any walk mark be lost, doubled or misread between
      migration, restore, parse and writer?"; queries touching `sync_state`; no index -> no EXPLAIN test).
- [ ] Translator review of `exchangeHistoryPaused` (en + uk); diff to the coordinator for the user.

### step 12/12: skill text (kiko:scribe)

- [ ] `kiko-architecture` Binance history section: walk state in `sync_state.exchange_state`, parse per field, gated
      writer, disconnect reset; pointers only.

---

## Set 5: `crypto-exchanges-1.3-a task 5/15` (multi-coin balances, holdings, price fallback)

Spec ids: H1-H13, N2 (balance part), A1-A4 (balances). Expected mutable files: about 14-16; optional 5a (steps 1-6)
/ 5b (steps 7-8) if `make mutable` passes 30.

### step 1/10: `ProviderBalance.currency`

Files: `src/crypto-sync/provider/provider.ts`, `src/crypto-sync/sync/sync.ts`, btc-wallet provider, tests.
- [ ] Test first: "writes the balance in the provider's currency" (was hard-coded `'BTC'` in `runBalanceSyncInner`).
      Commit.

### step 2/10: balances through `exchangeMinorUnits` (A1-A4 balance arms)

Files: `binance.provider.ts` (`sumSatoshis`, `Money.fromMajor(BINANCE_ASSET, Number(...))`), tests.
- [ ] Tests: A1 `"0.00012345"` -> 12345 (same); A3 `"1e-8"` -> the wallet keeps its last good balance ("was:" 1);
      A4 JSON number `0.5` via `decimalFromJsonNumber` -> 50000000 (same); a balance with more decimals than the
      scale rounds half away from zero with `balance-precision-rounded`. Commit.

### step 3/10: every asset, per-coin and fiat keys, LD* skip (H1, H5, H7, H8)

Files: `binance.client.ts` (`asset=` dropped from funding and Earn reads), `binance.holding-keys.ts` (open key form
`<CODE>`, `<CODE>:funding`, `<CODE>:earn`; BTC keys unchanged), `binance.provider.ts`, tests.
- [ ] Test first per row; "was:" pins in `binance.client.test.ts`/`binance.provider.test.ts` that assert `asset=BTC` in
      a query -> no `asset` parameter. Commit.

### step 4/10: appear, stay, dust, Spot anchor, wallet failure (H2-H4, H11, H13)

- [ ] Tests first per row, H13 on fixture UA-1 (Spot BTC only non-zero: no USDT/UAH holding from the balance read).
      Commit.

### step 5/10: names and BTC rename (H9, H10)

Files: `provider.ts` (`renameFromDefaults: readonly string[]`), `holdings.repo.ts`, `binance.holding-keys.ts`, tests.
- [ ] Tests first: Spot BTC from `'Binance BTC'` or `'Binance Spot'` -> `'Binance Spot · BTC'`; Funding/Earn; a user name
      kept. "was:" pins: default names `'Binance Spot'`/`'Binance Funding'`/`'Binance Earn'` in 16 test files
      (re-grep `WALLET_HOLDING_NAMES` and the literals) -> `'Binance <Wallet> · <CODE>'`. Commit.

### step 6/10: not-tracked and oversized lines (H6, H12, N2 balance part)

Files: `exchange/history-status/` (`untrackedCoinsOf`), `binance.provider.ts` (writes `untrackedCoins`,
`oversizedCoins` via `patchExchangeState`), `crypto-sync-section.component.tsx`, `en.ts`, `uk.ts`, tests.
- [ ] Keys `accountDetail.untrackedCoins`, `accountDetail.oversizedAmount` with the spec section 10 en/uk text.
      Tests first: "lists PEPE as not tracked"; "skips the write and shows the oversized line above the safe bound".
      Commit.

### step 7/10: Binance public price fallback

Files: `src/rates/binance-market/` (new; `ticker/price`, `klines` on the pinned host, no key), `rates-refresh.ts`,
`history-backfill.ts`, tests.
- [ ] Tests first: "prices a coin CoinGecko missed through its USDT symbol and USDT's price"; "prices USDT through
      EURUSDT and the EUR anchor when USDT is unpriced"; "never assumes 1:1"; "one coin missing from both stays out of
      net worth"; no key header sent. `check:plist` unchanged (no new host). Commit.

### step 8/10: privacy wording (Q10)

Files: `docs/privacy-policy.en.md`, `docs/privacy-policy.md`, `docs/privacy-site/en.html`, `docs/privacy-site/index.html`.
- [ ] Spec section 9 "Privacy policy, price fallback" text, same commit for all four. Commit.

### step 9/10: reviews

- [ ] Translator review of the two new keys and the uk privacy text; the reviewer checks each label at its screen.

### step 10/10: skill text (kiko:scribe)

- [ ] `kiko-architecture` "Binance exchange sync" (`asset=BTC` line, keys, names), the sync lines on crypto upserts
      (re-grep "every crypto/exchange holding a `runBalanceSync` upserts" and the "crypto balance + Binance transaction
      import" line); `kiko-compliance` Binance bullets (privacy-site files); pointers only.

---

## Set 6: `crypto-exchanges-1.3-a task 6/15` (account-wide walks; 6a matcher filter first)

Spec ids: S1-S3 (6a); Y1-Y8, E1-E2, W1-W2, A1-A4 (rows), N2 (Pay part), BTC key byte identity, key uniqueness
property, walk properties at 0 / 1 h / 1 day (6b). Expected mutable files: about 12.

### step 1/10 (6a): 2-minute matcher sees only unmarked rows (S1-S3)

Files: `src/statistics/internal-transfers/internal-transfers.ts` (pure helper `rowsForTransferMatch(rows)` beside
`internalTransferTransactionIds`), `internal-transfers.test.ts`, `src/screens/statistics/statistics.screen.tsx`
(call site over `ledgerWithCurrency`).
- [ ] Tests first in `internal-transfers.test.ts` (not the 3134-line screen test): "a Pay send counts when the
      same-amount rows nearby are exchange legs" (S1); "a BTC Pay send counts beside a Transfer pair" (S2); "two
      unmarked opposite rows are still matched" (S3). Keep `statistics.screen.test.tsx`'s existing matcher case as is.
      Commit `fix(statistics): exchange legs never consume an unmarked row`.

### step 2/10: capital account-wide (W1, W2)

Files: `binance.history-client.ts` (`coin=` dropped), `binance.transactions.ts`, tests.
- [ ] Tests first: "imports a USDT withdrawal as spending in the default category" (W1); "a hand-linked withdrawal stays
      excluded" (W2); BTC keys `${accountId}:deposit:<id>` / `:withdraw:<id>` unchanged; walletType placement.
      "was:" pins: `binance.history-client.test.ts` "parses the readable rows of a page beside an unreadable one and a
      row of another asset" and "is told from a BTC row by its asset alone: a row with a lowercase btc asset is another
      asset" -> the other-asset row is parsed. Commit.

### step 3/10: Pay any curated coin, cross-coin, keys (Y1-Y8, N2 Pay part)

Files: `binance.pay-history.ts`, `binance.history-client.ts`, tests.
- [ ] Tests first per Y row; keys: BTC row of a BTC order byte-identical; others `...:${walletType}:${currency}`.
- [ ] "was:" pins: `binance.pay-history.test.ts` every `code: 'pay-btc-funded-other-coin'` stop and the tests "stops
      the window, cursor unmoved, on a non-BTC order the user paid with BTC funds" (-> one BTC row, Y4) and "ignores a
      non-BTC order the user received though the payer paid with BTC funds" (-> one receive row in the order's coin,
      Y6); `binance.pay-history.direction.test.ts` "stops a send whose cost-less BTC funds entry is below the amount,
      the rest paid in another coin" / "... with no other coin listed" / "stops a send with no BTC funds entry at all
      and funds in another coin" / "stops when the funds named are not BTC, so no BTC movement is guessed"
      (`pay-funds-not-btc`) -> rows per debited coin (Y3, Y5) or `pay-split-mismatch` (Y8);
      `binance.history-client.test.ts` "lists the Binance ids of the parties of a non-BTC order that was paid with BTC
      funds" and "reads a malformed fundsDetail of a non-BTC order as no BTC funds, never an error" -> per-coin funds.
      Commit.

### step 4/10: Transfer account-wide

Files: `binance.transfer-history.ts`, tests. "was:" pins in `binance.transfer-history.test.ts`: "a row of another asset
gives no row", "a transfer of another asset is ignored, and counted for the pager...", "an off-contract row of another
asset does not stall the BTC rows of its page" -> the other asset imports on its own wallet holding. Commit.

### step 5/10: Earn account-wide, reward grouping per asset (E1, E2)

Files: `binance.earn-history.ts`, `binance.earn-history.rewards.test.ts`.
- [ ] Tests first: E1 keys `...:0`, `...:1` unchanged; E2 BTC keys byte-equal to E1, USDT `...:0:USDT` (0.1),
      `...:1:USDT` (0.5). Commit.

### step 6/10: row amounts through `exchangeMinorUnits` (A1-A4 rows)

Files: `binance.history-walk.ts` (`btcSatoshis`, or its moved path), walk callers, tests.
- [ ] Tests first: A2 `"0.000000001"` -> stop `amount-precision`, owed point ("was:" 0); A3 `"1e-8"` -> stop ("was:" 1);
      A1/A4 unchanged. Commit.

### step 7/10: `multiCoinSince`

Files: walk entry points, `exchange/walk-state` patch, tests.
- [ ] Tests first: "records the cursor at the first multi-coin run"; "records none when the cursor is null". Commit.

### step 8/10: key identity and properties

- [ ] "every BTC key equals today's key for the same record" (set 3 step 1 snapshot reused); property "keys stay unique
      across coins, wallets and walks"; walk properties at gaps 0, 1 h, 1 day over mixed-coin fixtures. Commit.

### step 9/10: reviews

- [ ] `kiko:reviewer` with the top question "can any BTC key, cursor or row change, or any coin's row be dropped or
      doubled?"; exact-parity sums per coin.

### step 10/10: skill text (kiko:scribe)

- [ ] `kiko-architecture`: `coin=BTC` capital line, Pay/Transfer/Earn per-coin rules and keys; `kiko-compliance`
      Binance history bullets (re-grep "transaction history import failed" context) where set 6 changes them.

End of plan: `make verify` through the queue on the set 6 tip, re-run until green.
