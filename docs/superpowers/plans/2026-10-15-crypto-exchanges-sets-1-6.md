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

**Spec:** `docs/superpowers/specs/2026-10-15-crypto-exchanges-design.md` (approved at 73336657; C-NR8 at
ee08b145). Rulings: `.superpowers/sdd/binance-multicoin/rulings.md` (user rulings, C-NR*, plan-prep Q1-Q12, NR8,
NR9). Prep facts: `.superpowers/sdd/binance-multicoin/prep-sets-1-6.md`.

**Base:** branch `binance-backfill-fix` at the plan commit. Every code fact below names a symbol or anchor text.
Prep line numbers are hints only: **the developer re-greps every fact on the actual base before relying on it.**

## Global constraints

- Sets run strictly in order 1 -> 2 -> 3 -> 4 -> 5 -> 6, each on the previous set's tip; never parallel worktrees
  (sets 1, 2, 4 change `restore-snapshot.ts`; sets 1, 4 change `VERSION_DECISIONS`).
- Each set tip is shippable alone (memory "task tip must be safe"); each new export and barrel has a consumer at
  the tip it lands in, or knip fails (a test importing through the barrel counts; if knip still flags it, stop and
  report, never add an ignore).
- Every commit passes the pre-commit typecheck (`scripts/checks/commit-typecheck.sh`). Inside a set, a commit that
  is not the tip may leave a named suite red only where its step says so; the set tip is green.
- Money: integer minor units, never a float in a stored value; exact-parity tests for every rescale and parse.
- Migration SQL: single-quoted string literals (`SQLITE_DQS=0`); every `json_type`/`json_extract`/`json_each`/`->`
  over a column, or over a `json_each` element value, sits behind `CASE WHEN ... THEN ... END`, never joined by a
  logical and (`json_type('abc', '$.x')` raises).
- Migration numbers 0059/0060 follow the base's last migration 0058; each migration set re-checks main's
  `drizzle/migrations/meta/_journal.json` before its merge and renumbers (files, journal, tests) if main moved.
- Tests: TDD, failing test first and shown red (quote the red count), then code. Tests never read `src` source
  text (rule `kiko-no-source-text-read-in-test`). Test names and comments carry no spec scenario id, no migration
  number and no history ("was:") text (memories "planner: no history notes", "migration idx shared namespace");
  the commit message carries the history and the ids.
- A "was:" pin is updated in the same step as the behaviour change; this plan lists each with its new value. A
  pin is never edited in a fix round (memory "never edit an acceptance pin in a fix round").
- Tickers and coin codes from Binance compare case-insensitively and are upper-cased once where a record is
  parsed (memories "compare keys case-insensitively", "normalize key once").
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
| `20261015T1119-kiko-harness-h7/2` TIMEOUT-HEAVY on app-wide primitives | LEFT OPEN (harness backlog). Sets 1 and 2 touch `currency.ts`, `format.ts`, `decimal.ts`; the gate section names the plain-jest proof that clears a TIMEOUT-HEAVY file |
| `20261015T1318-kiko-harness-h7/1` kill-guard-probe flake under verify load | LEFT OPEN. A `make verify` red only in `kill-guard-probe.test.ts` with EXIT 142 is re-queued once at low load (`bash scripts/wait-load.sh 10`), never treated as green, never "fixed" by a timeout raise |
| `20261013T2223-kiko-harness-h5/5`, `/6`; `20261014T0952-kiko-harness-h7/1`; `20261015T0021-kiko-harness-h7/1`; `20261015T0639-kiko-harness-h7/1`; `20261015T1119-kiko-harness-h7/1` | LEFT OPEN, unrelated |

Set 1 makes `.kiko` v4, unreadable by 1.2.x; the release-step note of spec section 11 applies.

## Set 3 layer direction (ruled: option A, coordinator 2026-10-15)

A pure move of `binance.history-walk.ts`, `binance.history-paging.ts`, `binance.history-records.ts` and
`binance.walk-write-deps.ts` into `exchange/` would create a feature value cycle, which
`check:feature-imports --tree` fails (`feature-cycle`, `findTreeViolations` in `scripts/checks/feature-imports.js`;
a type-only import adds no edge): the walk imports `BINANCE_ASSET` (`binance.client`), `binanceKeyOf` and
`WALLET_HOLDING_NAMES` (`binance.holding-keys`); the pager imports `BinanceRateLimitError` (`binance.client`) and
`HISTORY_TOTAL_PAGE_SIZE` (`binance.history-client`); and `binance/` imports both back.

Ruling A: the moved walk and pager read those values from one per-exchange config object that the Binance callers
pass in, like `DepthConfig`. Keys and requests stay byte-identical, pinned by set 3 step 1/9.

- Type `ExchangeWalkConfig`, in `src/crypto-sync/exchange/walk/walk-config.ts`, exported by the `exchange/walk`
  barrel (the pager depends on the walk, never the reverse):
  ```ts
  type ExchangeWalkConfig<RateLimitError extends Error, Weights> = {
    asset: string;                                                  // 'BTC' for Binance in 1.3-a
    metadataField: string;                                          // 'binanceAsset'
    holdingKeyOf: (holding: Pick<HoldingRow, 'metadata'>) => string | undefined;
    walletHoldingNameOf: (key: string) => string;                   // wallet key -> default name
    isRateLimitError: (error: unknown) => error is RateLimitError;
    totalPageSize: number;
    refusedCallWeights: Weights;                                    // today's REFUSED_CALL
    depth: DepthConfig;                                             // set 3 step 4/9
  };
  ```
  `onRateLimit` callers keep reading `error.retryAfterMs` (`binance.earn-history.ts`,
  `binance.transfer-history.ts`, `setBinanceCooldownUntil`) because the guard narrows to `RateLimitError`.
- `TotalPage<Row, Weights>` (`{ rows; unreadable; total; gathered } & Weights`) lands in `exchange/paging`;
  `UnreadableRow` lands in `exchange/walk` (records need it before paging moves). Binance keeps its weight
  fields in `binance.history-client.ts` as `BinancePageWeights = { usedUidWeight1m; usedIpWeight1m }`
  (`HistoryPage`, `usedWeightsFromHeaders`) and instantiates both types with it.
- The Binance instance `BINANCE_WALK_CONFIG` is in `src/crypto-sync/binance/binance.walk-config.ts`, built from
  `BINANCE_ASSET`, `'binanceAsset'`, `binanceKeyOf`, `(key) => WALLET_HOLDING_NAMES[key]`,
  `error instanceof BinanceRateLimitError`, `HISTORY_TOTAL_PAGE_SIZE`, today's `REFUSED_CALL` value and
  `BINANCE_DEPTH_CONFIG`. Every Binance walk entry point (capital in `binance.transactions.ts`, Pay, Transfer,
  Earn) passes it.
- `btcSatoshis` moves out of the walk before the walk moves, to `src/crypto-sync/binance/binance.amounts.ts`
  (its only callers are Binance walk files; the moved walk never value-imports `binance/`).
- `SignRequest` is not added in set 3: it has no consumer until a second signer exists (1.3-b).
- Sets 4-6 name walk files by their pre-move binance path; the developer re-greps the moved path in `exchange/walk/`.

## Review focus

1. A JSON array whose elements are not all objects (a string, a boolean, `null`, an object without the field) in
   `metadata.lots`, `metadata.contributions`, `draft.returns` or `matchers`: 0059 must rebuild it element for
   element, order kept, non-target elements byte-equal in value (`true` stays `true`, not `1`), and never call
   `json_type` on a non-object element. Owner: set 1 step 2/11, tests "keeps every other array element as it was",
   "rebuilds an array holding a string element".
2. A USDT import key whose amount token collides, during the rewrite, with another row's not-yet-rewritten key:
   the UNIQUE `(source, external_id)` check fires per row inside one UPDATE. Owner: set 1 step 3/11 (two-phase
   temp-key update), test "rescales two keys whose new amount equals the other's old amount".
3. The bound count and the rescale must select the same values: a value the rescale leaves (UAH, a string, a
   real) never aborts 0059 or a restore. Owner: set 1 steps 4/11 and 7/11, tests "a UAH value over the bound
   migrates", "an over-bound string or real USDT field migrates".
4. A version 1-3 `.kiko` whose `deletedImportKeys` holds a USDT key: today's restore inserts those keys as stored
   (`insertDeletedImportKeys`), so the rescale must cover them or a re-import duplicates a deleted row. Owner: set 1
   step 7/11, test "rescales a deleted import key under a USDT holding".
5. A `sync_state` row created by 0060 with null stamps: any reader that treats row existence as "synced"
   (`lastSyncAt`-free checks) would show a never-synced account as synced. Owner: set 4 step 2/11, a grep of
   `syncStateRepo` readers plus a test "an account whose state row only carries walk state reads as never synced".

## Release-note items (input to set 15's What's New and Notes for Review)

- Crypto amounts show their exact value with trailing zeros trimmed, never fewer than 2 decimals (set 1).
- The manual holding picker lists every curated coin, about 35 (set 2; the count is the registry's, quoted from
  `curatedCoins` at set 15, not this line).
- Two new import errors: a backup with a USDT amount too large to store exactly (set 1), and a backup made by a
  newer Kiko with a currency this version does not know (set 2).

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

Known red between commits (none is a tip): `envelope.test.ts`'s decision case from step 2 to step 6 (0059 counts
before the bump); `generate-demo-kiko.test.ts` from step 5 to step 9 (demo regenerated once, at step 9).

**Interfaces produced:**
- `restoreDataSnapshot(snapshot: DataSnapshot, version: number): Promise<{ accountsRestored: number }>` (version required).
- `withUsdtRescaled(tables: UsdtRescaleTables, version: number): UsdtRescaleTables` in
  `src/data-transfer/snapshot/with-usdt-rescaled.ts`, where `UsdtRescaleTables = Pick<DataSnapshot, 'holdings' |
  'transactions' | 'categoryRules' | 'transactionTemplates' | 'deletedImportKeys'>`; throws
  `Error('data-transfer/amount-too-large: ...')`; `USDT_RESCALE_BOUND_MINOR_UNITS = 9_007_199_254`;
  `LAST_SCALE_2_USDT_VERSION = 3`.
- `EXPORT_VERSION = 4`; `READABLE_EXPORT_VERSIONS = [1, 2, 3, 4]`.

### step 1/11: crypto amounts formatted exactly, trailing zeros trimmed (DP4, DP5, Q1)

Files: `src/currency/format/format.ts`, `src/currency/format/format.test.ts`,
`src/screens/forms/category-form/category-form.screen.test.tsx`.

- [ ] Tests first in `format.test.ts`: "shows a crypto amount with trailing zeros trimmed to two decimals"
      (`Money.fromMajor('BTC', 0.05)` -> `'₿0.05'`), "keeps every significant crypto decimal"
      (`Money.of('BTC', 12345)` -> `'₿0.00012345'`), "keeps a fiat amount at its fixed scale" (`Money.of('UAH',
      123450)` -> `'1,234.50 ₴'`; re-grep the UAH suffix placement), "shows the largest safe crypto amount with every
      digit" (`Money.of('BTC', 9007199254740991)` -> `'₿90,071,992.54740991'`), "uses the locale's decimal
      separator and grouping for crypto" (`formatMoney(Money.of('BTC', 123_456_700_000), 'uk-UA')` contains
      `'1 234,567'`; the existing uk-UA fiat case stays).
- [ ] "was:" pins changed in this step: `format.test.ts` `toContain('1.00000000')` -> `toContain('1.00')` (and not
      `'1.00000000'`); `format.test.ts` `'₿0.50000000'` -> `'₿0.50'`; `category-form.screen.test.tsx` test "shows an
      amount in the currency of its own scale" `'₿0.00100000'` -> `'₿0.001'`. Unchanged on purpose:
      `currency.test.ts` `applySymbolPlacement('BTC', '', '0.05000000')`, `rule-summary.test.ts` mocked
      `'0.00100000 BTC'`, `rule-draft.test.ts` `'0.00100000'` input.
- [ ] Re-grep other fixed-8 strings: `grep -rnE "₿-?[0-9,]+\.[0-9]{8}" src e2e` and fix each rendered pin in this step.
- [ ] Red: run the three files; quote the failing count.
- [ ] Code: `formatMoney` keeps today's fiat path unchanged. For `isCrypto(money.currency)`: `absolute =
      Math.abs(minorUnits)`; `remainder = absolute % 10 ** scale`; `whole = (absolute - remainder) / 10 ** scale`
      (both exact for safe integers); whole text = `whole.toLocaleString(locale, { maximumFractionDigits: 0 })`;
      decimal separator = the non-digit text of `(1.5).toLocaleString(locale, { minimumFractionDigits: 1 })`;
      fraction = `String(remainder).padStart(scale, '0')` with trailing zeros trimmed down to
      `Math.min(2, scale)` digits; then `applySymbolPlacement` as today. No float division of the amount.
- [ ] Check: `npx jest src/currency/format src/screens/forms/category-form` green. Commit
      `feat(currency): show crypto amounts exactly with trailing zeros trimmed`.

### step 2/11: 0059 rescales USDT amounts and JSON minor-unit fields (U1-U6, U8, U13, U14, bond untouched)

Files: `drizzle/migrations/0059_usdt_scale_8.sql` (new, hand-authored, no snapshot, as 0049),
`drizzle/migrations/meta/_journal.json` (idx 59 entry), `drizzle/migrations/migrations.js` (import `m0059`),
`drizzle/migrations/0059-usdt-scale-8.test.ts` (new).

- [ ] Re-grep every minor-unit field (`grep -rn "MinorUnits" src/db/schema.ts src/holdings/holding-metadata
      src/holdings/lots src/transaction-templates/draft src/categories/category-rules`, plus any JSON shape added
      since) and list each in the test's field table, one row per field; the commit body lists the grep output.
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
      - "keeps every other array element as it was" (a lots array with a string, `null` and an object without
        `costMinorUnits` beside a rescaled object, order kept);
      - "rebuilds an array holding a string element" (a string element in `lots`, in `matchers` and in
        `draft.returns`, each beside a rescaled object: the migration succeeds, the string stays);
      - "keeps a boolean element a boolean" (`json_each` reports `true`/`false` as `1`/`0`; after the migration the
        element reads back with `json_type` = `'true'` and `'false'`, never `'integer'`; also in a `matchers` array);
      - "leaves malformed JSON byte-unchanged and still succeeds" (U13: metadata `'{bad'`, matchers `'not json'`);
      - "leaves a string or real field and rescales its integer siblings" (U14: `"5000"`, `12.5`, integer
        `purchasePriceMinorUnits`; template `amountMinorUnits` null);
      - "leaves the bond register untouched" (Q12: `bond_register.terms` byte-identical);
      - "leaves a row with no rescaled field byte-identical" (untouched JSON texts compared as bytes).
- [ ] Red: the file does not exist yet; quote the failing count.
- [ ] Code: SQL shape (bound guard comes in step 4/11; keys in step 3/11). Element predicate, used verbatim in the
      rebuild, in `EXISTS` and in step 4's count: `CASE WHEN element.type = 'object' THEN json_type(element.value,
      '<field>') END = 'integer'`.
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
              WHEN CASE WHEN element.type = 'object'
                  THEN json_type(element.value, '$.costMinorUnits') END = 'integer'
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
            WHERE CASE WHEN element.type = 'object'
              THEN json_type(element.value, '$.costMinorUnits') END = 'integer');
      ```
      `category_rules.matchers`: the same array rebuild over the top-level array, target element = `CASE WHEN
      element.type = 'object' THEN ... END` over `$.type = 'amount'`, `$.currency = 'USDT'`, integer `$.minorUnits`.
      `transaction_templates.draft`: amount and `returns[]` keyed on `$.currency = 'USDT'`;
      `$.exchange.valueInMinorUnits` keyed on `$.exchange.destinationCurrency = 'USDT'`; every guard a CASE. The
      test asserts `SELECT sqlite_version()` is at least 3.44 on `node:sqlite` (aggregate `ORDER BY`); op-sqlite
      bundles 3.51.3 (kiko-architecture "Storage").
- [ ] Check: `npx jest drizzle/migrations/0059-usdt-scale-8.test.ts` green; `drizzle/migrations` suite green;
      `./node_modules/.bin/biome check --write drizzle/migrations/meta/_journal.json drizzle/migrations/migrations.js`.
      Commit `feat(db): rescale stored USDT amounts to scale 8`.

### step 3/11: 0059 rewrites USDT statement-import keys (U11, U12, U12b)

Files: `0059_usdt_scale_8.sql`, `0059-usdt-scale-8.test.ts`, `src/db/schema.ts` (the `deletedImportKeys` comment
only: "the key-rewrite passes (`upgradeStoredDedupKeys`, `rezoneImportTimes`) leave them as they were" gains that
0059 rescales a USDT key's amount token in both tables).

- [ ] Tests first: "rescales the amount token of a USDT import key and of its occurrence-suffixed twin"
      (`<id> 1700000000 -1250 coffee` -> `... -1250000000 coffee`; `<id> 1700000000 -500 tea␟1` in
      `deleted_import_keys` -> `-500000000 tea␟1`); "leaves a bank-issued key alone"; "decides by the key's first
      token, not the row's holding" (USDT-keyed row now on a UAH holding: rewritten; UAH-keyed row now on the USDT
      holding: unchanged; same two keys in `deleted_import_keys`); "rescales two keys whose new amount equals the
      other's old amount" (two USDT rows on one holding at one time and description, amounts -1 and -1000000; the
      test also runs a one-statement final-key UPDATE on the same seed and expects the UNIQUE error, then expects the
      migration to succeed); "leaves a key whose amount token is not a plain integer" (`007`, `-0`,
      `99999999999999999999`, `12.5`: unchanged in both tables); "a re-import of the same statement after the
      migration adds no row" (compute the key with `computeDedupKey` at scale 8 and assert it equals the stored key).
- [ ] Red; quote the count.
- [ ] Code: `DROP TABLE IF EXISTS usdt_import_keys`; `CREATE TEMP TABLE usdt_import_keys (table_name text, row_key
      text, old_key text, new_key text)` filled from `transactions` (`source = 'import'`, `row_key` = `id`) and
      `deleted_import_keys` (`row_key` = `rowid`), tokens by `instr`/`substr` (first token = holding id joined to
      `holdings.id` with `currency = 'USDT'`; third token kept only when `CAST(token AS INTEGER) || '' = token`);
      phase 1 sets each listed key to `'usdt-rescale␟' || row_key`; phase 2 sets `new_key`; `DROP TABLE
      usdt_import_keys`. Every other byte of the key kept.
- [ ] Check: test file green. Commit `feat(db): rescale the amount in USDT statement-import keys`.

### step 4/11: 0059 bound guard aborts before any write (U8b, migration side)

Files: `0059_usdt_scale_8.sql`, `0059-usdt-scale-8.test.ts`,
`src/migration/migrations-gate/migrations.gate.test.tsx` (re-grep the gate's test file name).

- [ ] Tests first: "aborts on a value over the bound and writes nothing" (9007199255 in each field class of the
      table: holding balance, row, metadata field, lots element, matcher, template amount, return, exchange value,
      key token; error message contains `CHECK constraint failed: usdt_rescale_guard`; every table byte-equal to the
      seed); "a UAH value over the bound migrates" (a UAH property holding at 10_000_000_000 (100,000,000.00 UAH), a
      UAH rule matcher and a UAH template amount at 9_007_199_255: succeeds, unchanged); "an over-bound string or
      real USDT field migrates" (`"9007199255"` and `9007199255.5` in USDT metadata, matchers, lots: succeeds, those
      values unchanged); "skips malformed JSON in the bound count" (U13 seed + an in-bound value: succeeds).
      Gate test: "shows the migration error with the guard message" (`runMigrations` rejects with that message;
      `migrations-gate-error` shows `migrations.error` with it; children not rendered).
- [ ] Red; quote the count.
- [ ] Code: first statements of the file: `DROP TABLE IF EXISTS usdt_rescale_bound`; `CREATE TEMP TABLE
      usdt_rescale_bound (over_bound integer CONSTRAINT usdt_rescale_guard CHECK (over_bound = 0))`; one `INSERT INTO
      usdt_rescale_bound (over_bound) SELECT (<count>) + (<count>) + ...`, one count per rescale statement of steps 2
      and 3, each with EXACTLY that statement's predicate (`currency = 'USDT'`; the row's holding's currency; the
      CASE-guarded `json_type ... = 'integer'`; the element predicate of step 2; the matcher's own `$.currency`; the
      draft's own `$.currency` / `$.exchange.destinationCurrency`; the key's USDT first token and integer-token rule)
      plus `abs(value) > 9007199254`; last statement `DROP TABLE usdt_rescale_bound`.
- [ ] Check: test files green. Commit `feat(db): refuse the USDT rescale over the safe-integer bound`.

### step 5/11: `currencyScale.USDT` = 8 and the USDT pin sweep (DP1-DP3, U9)

Files: `src/currency/currency/currency.ts`, `format.test.ts`, `currency.test.ts`,
`src/rates/rates-refresh/crypto-coverage.test.ts`, `src/rates/conversion/uah-star-parity.test.ts`, any other
test re-grep finds (`grep -rn "USDT" src --include=*.test.ts* | grep -i "minor\|balance\|scale"`).

- [ ] Tests first: `format.test.ts` "shows a USDT amount with two decimals" (12345000000 -> `'₮123.45'`),
      "shows a sub-cent USDT amount" (12345 -> `'₮0.00012345'`), "shows one USDT with two decimals" (100000000 ->
      `'₮1.00'`), "shows the largest storable USDT amount exactly" (9007199254740991 -> `'₮90,071,992.54740991'`);
      `currency.test.ts` "parses 0.00012345 USDT to its minor units" (`Money.fromMajor('USDT',
      0.00012345).minorUnits` = 12345; Binance USDT balances are read from set 5, so U9 is pinned on the parse here
      and through the provider in set 5).
- [ ] "was:" pins: `currency.test.ts` `expect(currencyScale.USDT).toBe(2)` -> `8`; `crypto-coverage.test.ts`
      `balanceMinorUnits: 100_000_00` (100,000.00 USDT) -> `100_000_00000000`, and in the same test
      `expect(converted.minorUnits).toBe(Math.round(pegged.minorUnits * CRYPTO_USD.USDT))` (it multiplies a scale-8
      USDT amount into a scale-2 USD amount) -> `toBe(10_007_000)` (100,070.00 USD; `not.toBe(pegged.minorUnits)`
      stays); `uah-star-parity.test.ts` `usdtWallet.balanceMinorUnits: 10_000` -> `10_000_000_000`; every valued UAH
      total in those tests stays equal (U1 "valued in UAH equal").
- [ ] Red; quote the count. Code: `USDT: 8` in `currencyScale`.
- [ ] Check: `npx jest src/currency src/rates` green. Commit `feat(currency): store USDT at scale 8`.

### step 6/11: `restoreDataSnapshot` takes a required version; `.kiko` v4 (Q2, Q7)

Files: `src/data-transfer/snapshot/restore-snapshot.ts`, `src/data-transfer/import-data.ts`,
`src/data-transfer/import-data.test.ts`, `src/data-transfer/crypto/envelope.ts`, `envelope.test.ts`, the 15 test
files with 77 calls (re-grep `restoreDataSnapshot(` in `src`, `e2e`, `drizzle`; the 78th is `import-data.ts`).

- [ ] Why the bump lands here, before the rescale: every test call that passes `EXPORT_VERSION` then models a
      version 4 file, which step 7 restores byte-unchanged, so no restore pin whose subject is not an old file
      moves at step 7 (for example `restore-snapshot.test.ts` "never moves an archived source holding onto a live
      reuse target", USDT `balanceMinorUnits: 100`, passes `EXPORT_VERSION` and keeps 100: its subject is the
      account move, not the file version). Only tests that pass 3 see the rescale, and step 7 lists them.
- [ ] Tests first: `import-data.test.ts` "restores with the file's own version" (the `jest.mock('./snapshot/
      restore-snapshot')` factory forwards only `snapshot` today; it forwards `(snapshot, version)` to
      `mockRestoreDataSnapshot`, and the case asserts `envelope.version` arrives); `envelope.test.ts`
      `VERSION_DECISIONS` -> `version: 4`, `migrationCount: 60`, with the reason comment "Through <0059 tag>, which
      rescales USDT to scale 8: an older build would read every USDT value 10^6 too large, so it must refuse the file
      by its version; this build rescales an older file on restore." (the established place for migration tags);
      readable-version case adds 4.
- [ ] "was:" pins: `VERSION_DECISIONS` `{ version: 3, migrationCount: 59 }` -> `{ version: 4, migrationCount: 60 }`;
      `generate-demo-kiko.test.ts` `expect(envelope.version).toBe(EXPORT_VERSION)` stays and reads 4 after step 9.
- [ ] Red; then code: signature `(snapshot: DataSnapshot, version: number)`, no default; `import-data.ts` passes
      `envelope.version`; `EXPORT_VERSION = 4`; `READABLE_EXPORT_VERSIONS = [1, 2, 3, 4]`. Every test call passes
      `EXPORT_VERSION`, except a test whose subject is an older file (two-path tests of legacy mirrors,
      `restore-across-reminders-migration.test.ts`, back-compat cases), which passes the version it models (3).
      `build-demo-snapshot.ts` does not call `restoreDataSnapshot` on the base (comment only); re-grep.
- [ ] Check: `npx tsc --noEmit` clean; `npx jest src/data-transfer` green. Commit
      `feat(data-transfer): restore takes the file's version; export version 4`.

### step 7/11: `withUsdtRescaled` and the two-path parity (U1-U5d, U7, U8b, U10-U14 restore side)

Files: `src/data-transfer/snapshot/with-usdt-rescaled.ts` (new), `with-usdt-rescaled.test.ts` (new),
`src/data-transfer/snapshot/restore-usdt-rescale.two-path.test.ts` (new), `restore-snapshot.ts`,
`0059-usdt-scale-8.test.ts` (bound literal case), any test passing version 3 with a USDT value (re-grep).

- [ ] Tests first, pure (row objects): one case per field class of steps 2 and 3 with the same values; "returns
      the tables unchanged for a version 4 file" (same references); "returns the tables unchanged for a future
      version 5 file" (same references); "rescales a deleted import key under a USDT holding"; "decides a key by
      its first token's holding" (U12b); "leaves a key whose amount token is not a plain integer" (`007`, `-0`,
      `99999999999999999999`, `12.5`); "leaves malformed matchers text and a non-object metadata as stored" (U13);
      "leaves a string or real field" (U14); "a UAH value over the bound restores"; "an over-bound string or real
      USDT field restores"; "throws amount-too-large over the bound and names nothing restored" (message starts
      `data-transfer/amount-too-large`; pin the full message literal). In the migration test: "the bound literal
      equals `USDT_RESCALE_BOUND_MINOR_UNITS`" (reads the `.sql` text, not `src`).
- [ ] Two-path test, written in this step and shown red before the code (follow
      `restore-import-time-rezone.two-path.test.ts`): seed one scale-2 database through 0058 with U1-U5c rows, a
      legacy pre-`␟` dedup key, a two-holding USDT seed and the U13/U14 rows; path 1 applies 0059 and then the launch
      steps the gate runs (`upgradeStoredDedupKeys`, `rezoneImportTimes`); path 2 exports the seed as a version 3
      snapshot, restores it on a fresh migrated database, then runs the same launch steps. Assert every table equal
      (JSON columns compared parsed for rewritten rows, bytes for untouched rows): "a version 3 backup restores
      equal to the migrated database"; "a version 4 backup restores byte-unchanged" (12345000000 stays); "a version
      3 backup over the bound is refused and the live data stays" (error prefix, every table equal to before).
- [ ] Red; quote the count (the two-path file fails on every USDT value).
- [ ] Code: rescale only files with `version <= LAST_SCALE_2_USDT_VERSION` (named constant 3, never `<
      EXPORT_VERSION`). Per field: the predicate first (column parsed: metadata/draft a plain object; matchers
      `JSON.parse` in a try, rewritten with `JSON.stringify` only when a field changed; the field's own currency;
      `Number.isSafeInteger(value)`), then the bound (`Math.abs(value) > USDT_RESCALE_BOUND_MINOR_UNITS` throws). A
      key's amount token qualifies exactly when SQL's rule does: `/^-?[0-9]+$/`, `String(BigInt(token)) === token`,
      and `BigInt(token)` inside the signed 64-bit range. Key holding lookup over the holdings the restore inserts.
      In `restoreDataSnapshot`, call it LAST among the mirrors (after `withImportTimesRezoned`), on
      `holdingsToInsert`, `transactionsToInsert`, `snapshot.categoryRules`, `snapshot.transactionTemplates`,
      `snapshot.deletedImportKeys`, before `readLiveDeviceSettings` and `deleteAllTables`, and insert its output.
- [ ] "was:" pins: each test that passes version 3 and holds a USDT amount gets its value x 1000000 in this step
      (list each file and value in the commit body).
- [ ] Check: `npx jest src/data-transfer drizzle/migrations/0059-usdt-scale-8.test.ts` green. Commit
      `feat(data-transfer): rescale USDT in an older backup`.

### step 8/11: the refused-import message (Q3)

Files: `src/screens/settings/import-data/import-data.screen.tsx`, its test, `src/i18n/locales/en.ts`, `uk.ts`.

- [ ] Test first: "shows the too-large message when a backup is refused by the USDT bound" (restore rejects with the
      prefix; `settings.dataImport.errorTitle` + `amountTooLargeError` text).
- [ ] Code: `IMPORT_ERROR_KEYS` gains `['data-transfer/amount-too-large', 'settings.dataImport.amountTooLargeError']`;
      its comment ("The error copy for a failed import, picked by the prefix `importData`'s own decrypt step puts on
      the message") now names the restore's prefixes too. Key en "This backup has a USDT amount too large for Kiko to
      store exactly, so nothing was imported. Your current data is unchanged."; uk «У цій резервній копії є сума в
      USDT, завелика, щоб Кіко зберіг її точно, тому нічого не імпортовано. Ваші поточні дані не змінено.»
- [ ] Check: `npx jest src/screens/settings src/i18n` green. Commit `feat(data-transfer): the too-large import message`.

### step 9/11: demo files regenerated

Files: `e2e/screenshot/fixtures/kiko-demo-en.kiko`, `kiko-demo-uk.kiko`.

- [ ] `KIKO_REGEN_DEMO=1 npx jest e2e/screenshot/fixtures/generate-demo-kiko.test.ts`, then the same command without
      the variable green; `kiko-demo-en-1.1.kiko` untouched. Full `npx jest` green at this commit. Commit
      `chore(demo): regenerate demo files at version 4`.

### step 10/11: reviews and the device check

- [ ] `kiko:reviewer` on 0059 before BATCH READY, briefed with the top question: "can any field, key or array element
      be rescaled twice, missed, counted by the bound but not rescaled (or the reverse), or aborted on malformed
      JSON, and do migration and restore agree byte for byte?" plus: the queries that read the touched columns and
      tables (no index added, so no EXPLAIN QUERY PLAN test).
- [ ] Translator review of `settings.dataImport.amountTooLargeError` (en + uk) against kiko-translator by the
      reviewer; the en/uk diff goes to the coordinator for the user before deploy.
- [ ] Device check (kiko:ops "Device verification checklist"): build with `scripts/deploy-device.sh`'s
      `CONFIGURATION` (Release-AdHoc; re-verify), install per the Device-deploy recipe; run first launch + migrations
      gate on the upgraded device, export -> import round trip, net worth + statistics, uk locale; the user confirms
      the Q1 display live: a BTC holding shows `₿0.05`-style trimmed amounts, a USDT holding `₮123.45`, fiat
      unchanged, uk shows a comma decimal on a crypto amount. Ops installs; the user confirms; set 1 is not done
      before that.

### step 11/11: skill text (kiko:scribe, same set)

- [ ] `kiko-domain`: the "`minorUnits` is always an integer" scale text near "Scale is" and the "A small closed set
      (`BTC` at scale 8, everything else at scale 2)" paragraph -> USDT at 8, pointer to `currencyScale`; the 0044
      legacy BTC/ETH/USDT paragraph gains a pointer to the 0059 rescale and `withUsdtRescaled`.
- [ ] `kiko-domain` / `kiko-design-system` money display (`formatMoney` mentions): crypto formatted exactly from the
      integer, trailing zeros trimmed, at least 2 decimals; fiat fixed.
- [ ] `kiko-statement-import`: the "key rewrites (`upgradeStoredDedupKeys`, `rezoneImportTimes`) leave it" text near
      `deleted_import_keys` and the `upgradeStoredDedupKeys` launch-pass paragraph in "Dedup": 0059 and
      `withUsdtRescaled` rescale a USDT key's amount token in `transactions` and `deleted_import_keys`. Pointers to
      code, no copied counts. Commit by scribe.

Set 1 gate deltas: migration set -> kiko:reviewer done; device confirmation recorded; TIMEOUT-HEAVY proofs for
`currency.ts`/`format.ts` if named.

---

## Set 2: `crypto-exchanges-1.3-a task 2/15` (coin registry, parser, CoinGecko isolation, 0044 frozen, picker)

Spec ids: R1-R5, registry invariants, parser exact-parity property, NR9. Expected mutable files: about 12 (spec) /
8-10 (prep). TIMEOUT-HEAVY risk: `currency.ts`, `decimal.ts`.

**Interfaces produced:**
- `decimalToMinorUnits(text: string, scale: number, rounding: 'exact' | 'half-away-from-zero'):
  Either<DecimalAmountError, number>` in `src/currency/decimal/decimal.ts`, `DecimalAmountError = 'amount-malformed' |
  'amount-precision' | 'amount-too-large'`. Grammar `^-?[0-9]+(\.[0-9]+)?$` (no exponent, no spaces); BigInt inside.
- `CURATED_COIN_CODES = [...] as const`, `CuratedCoinCode`, `coinScale(entry: { baseAssetPrecision: number;
  maxUnits: number }): number`, `MIN_COIN_SCALE = 2`, `curatedCoins: Readonly<Record<CuratedCoinCode, CoinEntry>>`
  in `src/currency/coins/coins.ts` (barrel `src/currency/coins/index.ts`). `coins.ts` imports nothing from
  `currency.ts`; `currency.ts` derives from it (no circular derivation).
- `FROZEN_1_0_CRYPTO_CODES = ['BTC', 'ETH', 'USDT'] as const` in `restore-snapshot.ts`.
- Restore error `Error('data-transfer/unknown-currency: ...')`; key `settings.dataImport.unknownCurrencyError`.

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
- [ ] Input (no network read by the developer): `.superpowers/sdd/binance-multicoin/coin-curation-2026-10-15.md`
      (the date in the name is the check date; a later read gets a new file). kiko:researcher does the live reads of
      the public endpoints, read-only, with a source URL and a check date per claim: CoinGecko
      `/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=50`, CoinGecko `/coins/list` (verifies every id,
      including `chaingpt`), Binance `GET /api/v3/exchangeInfo`. The orchestrator writes the result to the file
      before the developer starts. One row per candidate coin: `code`; `name` (en); `coinGeckoId` (verified on
      `/coins/list`); `binanceSymbol` (`<CODE>USDT`, its `status`; none for USDT); `baseAssetPrecision` (from
      `exchangeInfo`); the top-30 rank and its source (URL + check date; or "user coin" / "stablecoin rule" / "BNB
      rule"); `maxUnits`; the USD price used for `dustBelow`; the list-rule decision (kept, or excluded with the
      class: other stablecoin, wrapped/bridged/liquid-staking, no USDT spot market, fiat-code collision).
      `maxUnits` is fixed by the spec for six coins (USDT, USDC, FDUSD, DAI 90,000,000; BTC 21,000,000; ETH
      90,000,000); every other coin's `maxUnits` comes with its supply source. The registry is built only from this
      file; the commit body cites the file and its check date.
- [ ] Tests first: "derives scale 8 for a stablecoin" (R1); "reduces scale for a huge supply" (R2: precision 8,
      maxUnits 10^12 -> 3, reduced; `decimalToMinorUnits('1.23456789', 3, 'half-away-from-zero')` = 1235); "keeps a
      coin under the minimum scale off the registry" (R3: 10^15 -> 0 < 2); "keeps the exchange precision when
      smaller" (R4: precision 6, 10^6 -> 6, not reduced; a 7-decimal row refused `amount-precision`); "keeps BTC and ETH
      at scale 8" (R5, `maxUnits` 21,000,000 and 90,000,000); invariants per entry with
      `it.each(Object.values(curatedCoins))`: keys equal `CURATED_COIN_CODES`, unique CoinGecko ids, scale = formula,
      scale >= 2, `maxUnits * 10^scale <= MAX_SAFE_INTEGER`, `reducedScale = scale < baseAssetPrecision`,
      `binanceSymbol` ends in `USDT` except USDT, the four stablecoins at `maxUnits` 90,000,000.
- [ ] Red; code (keyed by its own `CURATED_COIN_CODES`, nothing from `currency.ts`); check `npx tsc --noEmit`,
      `npx jest src/currency/coins`. Commit `feat(currency): curated coin registry` (the body cites the curation file).

### step 3/10: crypto lists and coin names derive from the registry

Files: `currency.ts`, `src/rates/coingecko-ids/coingecko-ids.ts`, `currency.test.ts`, `coingecko-ids.test.ts`,
`en.ts`, `uk.ts`, `currency-names.i18n.test.ts`. One commit: the new codes in `currencyOptions` need their
`currencyNames` entries in the same commit, or the typecheck fails (`en.currencyNames[code]` over every `Currency`).
- [ ] Tests first: "lists every curated code after the fiat block"; "derives scale, symbol and CoinGecko id from
      the registry"; "names every curated coin in en and uk" (`it.each` over the registry).
- [ ] "was:" pins: `currency.test.ts` `currencyOptions.slice(-3)` `['BTC','ETH','USDT']` -> the curated block in
      registry order; test "treats BTC, ETH, and USDT as crypto and everything else as fiat" -> every curated code is
      crypto; `[...cryptoCurrencyOptions]` -> the curated list; `coingecko-ids.ts` record type -> `Record<CryptoCurrency,
      string>` from the registry. The USDT-only name asserts stay.
- [ ] Code: `currencyOptions` crypto block written literally; `CryptoCurrency = CuratedCoinCode`; `cryptoCurrencies`,
      crypto `currencyScale`, crypto `currencySymbol`, `cryptoCoinGeckoId` derived from `curatedCoins` (USDT's
      literal 8 from set 1 now comes from the registry, same value); `currencyNames.<CODE>` per coin (proper nouns
      per kiko-translator). Check `npx tsc --noEmit`, `npx jest src/currency src/rates src/i18n`. Commit
      `refactor(currency): derive the crypto lists and names from the registry`.

### step 4/10: 0044 stays frozen on restore

Files: `restore-snapshot.ts`, `drizzle/migrations/0044-move-crypto-cash-holdings.test.ts`,
`restore-crypto-cash.two-path.test.ts`.
- [ ] Tests first: "moves only the 1.0 crypto codes" (a `cash` USDC holding stays `cash`); in the 0044 test, "the
      restore's frozen list equals the migration's IN list" (reads the `.sql`).
- [ ] "was:" pin: 0044 test `expect(['BTC', 'ETH', 'USDT']).toEqual(cryptoCurrencyOptions)` ->
      `toEqual(FROZEN_1_0_CRYPTO_CODES)`. Code: `withCryptoCashHoldingsMoved` uses `FROZEN_1_0_CRYPTO_CODES` instead of
      `!isFiat`. Commit `fix(data-transfer): keep the frozen 1.0 crypto list on restore`.

### step 5/10: restore refuses an unknown currency code (NR9 a)

Files: `restore-snapshot.ts`, `restore-snapshot.test.ts` (or a new `restore-unknown-currency.test.ts`),
`import-data.screen.tsx`, its test, `en.ts`, `uk.ts`.
- [ ] No "made by a newer Kiko" key exists on the base (`settings.dataImport.*Error` keys: `invalidFileError`,
      `keyTooShortError`, `noFileError`, `wrongFileTypeError`, `wrongKeyError`; re-grep), so one new key.
- [ ] Tests first: "refuses a backup with a currency code this build does not know and writes nothing" (a
      holding in `'XYZ'`: rejects with prefix `data-transfer/unknown-currency`, every table equal to before); the same
      for a price point, a rate pair, the base currency setting, an amount matcher `currency`, a template
      `draft.currency` and `draft.exchange.destinationCurrency` (`it.each`); "restores a matchers text that is not
      JSON as today" (the unknown-code check reads only parsed JSON); import screen: "shows the newer-Kiko message
      for an unknown currency".
- [ ] Code: the check runs first in `restoreDataSnapshot`, before any mirror and before `readLiveDeviceSettings`;
      a code is known when `code in currencyScale`; fields = every `{ enum: currencyOptions }` column of
      `src/db/schema.ts` (`holdings.currency`, rate and rate-history `base`/`quote`, `settings.base_currency`,
      `price_points.currency`; re-grep) plus the JSON currency fields above. If any committed fixture or demo file
      holds a code outside `currencyScale`, stop and report. `IMPORT_ERROR_KEYS` gains `['data-transfer/unknown-
      currency', 'settings.dataImport.unknownCurrencyError']`; key en "This backup was made by a newer version of Kiko
      and holds a currency this version does not know, so nothing was imported. Update Kiko and try again. Your
      current data is unchanged."; uk «Цю резервну копію створено новішою версією Кіко, і в ній є валюта, якої ця
      версія не знає, тому нічого не імпортовано. Оновіть Кіко й спробуйте ще раз. Ваші поточні дані не змінено.»
- [ ] Check: `npx jest src/data-transfer src/screens/settings src/i18n` green. Commit
      `feat(data-transfer): refuse a backup with an unknown currency`.

### step 6/10: CoinGecko price per coin (closes "crypto price all-or-nothing")

Files: `src/rates/coingecko/coingecko.ts`, `coingecko.test.ts`, `rates-refresh.ts`, its test.
- [ ] Tests first: "returns the priced coins when one coin is missing"; refresh "writes a UAH row per priced coin and
      none for the missing one".
- [ ] "was:" pin: `coingecko.test.ts` "rejects when any requested coin is missing a finite usd price" -> resolves
      with that coin absent (whole response failure still rejects). Code; check `npx jest src/rates`. Commit
      `feat(rates): price each coin on its own`.

### step 7/10: held coins only, and a concurrency cap on CoinGecko history (Q9, NR9 b)

Files: `src/rates/coingecko-history/coingecko-history.ts`, `coingecko-history.test.ts`, `history-backfill.test.ts`,
`rates-refresh.test.ts`.
- [ ] Q9 already holds on the base: callers pass the held codes (`open-currencies-gate.ts` `historyCurrencies`,
      `rates-refresh.ts`); the `currencies = cryptoCurrencyOptions` defaults of `fetchCryptoPrices` and
      `fetchCryptoHistory` stay, and `coingecko.test.ts` / `coingecko-history.test.ts` default calls stay. Pin it
      with the full registry (characterization, green, state so in BATCH READY): "never requests a curated coin no
      holding uses" (refresh and backfill, one held coin of about 35).
- [ ] Tests first: "never has more than the cap of coin requests in flight" (a fake fetch counting open requests
      over 6 coins); "still fetches every coin under the cap" (6 coins, one rejecting: `failedCurrencies` names it,
      the other five's entries returned).
- [ ] Red; code: `fetchCryptoHistory` runs `fetchOneCoinHistory` through a small pool of
      `CRYPTO_HISTORY_CONCURRENCY` (start at 2; the developer measures a backfill of the full registry against the
      CoinGecko free-tier limit and records the value and the measurement in the commit body); result order and
      `failedCurrencies` stay per coin. Commit `feat(rates): cap concurrent crypto history requests`.

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

### step 10/10: reviews and skill text

- [ ] Translator review of the coin names and `settings.dataImport.unknownCurrencyError` (reviewer + user before
      deploy).
- [ ] kiko:scribe: `kiko-domain` scale text -> pointer to `curatedCoins` and `coinScale`; `kiko-pricing` CoinGecko
      paragraph ("`ETH`/`USDT` derive the same way"): stablecoins priced from the market, never 1:1; per-coin
      isolation; history only for held coins, at most `CRYPTO_HISTORY_CONCURRENCY` in flight; kiko-statement-import
      or kiko-domain restore text: unknown currency refused.

---

## Set 3: `crypto-exchanges-1.3-a task 3/15` (layer extraction, code moves only; layer direction per the ruled option A above)

Spec: "today's suites green unchanged; a byte-identical key and request snapshot test". Expected mutable files:
20-26 (prep). One commit per step, each with its moves and their importers. Moves are `git mv` with only import
lines and the named config reads edited, so `--find-renames` keeps the mutated lines small; a file edited beyond
that is mutated whole (`binance.history-walk.ts` is 1470 lines: keep its body unchanged).

Mutation split, measured: after step 5's commit, `KIKO_MUTATION_BASE=<set 3 base> make mutable` (3a = steps 1-5);
after step 8's commit, `KIKO_MUTATION_BASE=<step 5 sha> make mutable` (3b = steps 6-8). 3a and 3b are separate deep
gates, each with its own base; either over 30: stop and report.

Test placement: a test moves with its source only when it imports nothing from `binance/`; a test that needs a
Binance module (fixtures such as `binance.depth-test-fixtures.ts`, `binance.earn-test-fixtures.ts`) stays in
`binance/` and imports the moved unit through `@kiko/crypto-sync/exchange/<unit>` (never a module path under the
barrel: `alias-skips-barrel`).

Commit order has no value cycle at any commit: depth (step 4) and the walk (step 6) land in `exchange/walk` before
the pager (step 7), which imports them as `../walk`; `binance/` imports `exchange/` only.

### step 1/9: key and request snapshot (characterization, green before and after)

Files: `src/crypto-sync/binance/binance.layer-snapshot.test.ts` (new).
- [ ] Tests: for each endpoint the walks call, the signed query string and headers for a fixed clock and key; every
      external id the capital, Pay, Transfer and Earn walks write for one fixture each. Green on the base (no red:
      it is a characterization pin; state so in BATCH READY). Commit `test(binance): pin keys and signed requests`.

### step 2/9: `exchange/` container, signing unit

Files: `scripts/checks/feature-imports.js` (`CONTAINERS` gains `'crypto-sync/exchange'`), `git mv
binance.hmac.ts exchange/signing/signing.ts` (+ test if it imports nothing from `binance/`),
`exchange/signing/index.ts`, importers.
- [ ] Binance signer keeps HMAC-SHA256 hex + `X-MBX-APIKEY`; no `SignRequest` type (no consumer in 1.3-a). Check:
      `npm run check:feature-imports` (incl. `--tree`), knip, step 1 test green. Commit
      `refactor(exchange): signing unit`.

### step 3/9: credentials unit with Binance wrappers kept (Q8)

Files: `exchange/credentials/` (`credentialServiceFor`, save/load/clear over `react-native-keychain`), `binance.
credentials.ts` thin wrappers (`saveCredentials`, `readCredentials`, `clearCredentials`), `migrate-binance-
credential.ts`. Outside importers unchanged (`accounts.repo.ts`, `account-form.screen.tsx`, `migrations.gate.tsx`,
`binance-credentials-field.component.tsx`, `restore-secrets.ts`, `read-secrets.ts`, `disconnect.ts`,
`run-crypto-sync.ts`; re-grep).
- [ ] Test first: "the Binance service string is byte-identical" (`kiko.binance.credentials.<accountId>`). Commit
      `refactor(exchange): credentials unit`.

### step 4/9: budget shape, and depth functions into `exchange/walk`

Files: `exchange/budget/` (`RunBudget<Lane>`, `RequestGate`, `createExchangeRun`), Binance numbers and weight
headers stay in `binance.history-budget.ts`; `binance.history-depth.ts` functions -> `src/crypto-sync/exchange/walk/
depth.ts` (exported by a new `exchange/walk/index.ts`), its constants -> `BINANCE_DEPTH_CONFIG: DepthConfig` in
`binance.history-depth.ts`, passed to the moved functions; importers (`binance.history-paging.ts`,
`binance.transfer-history.ts`, `binance.depth-test-fixtures.ts`) import through `@kiko/crypto-sync/exchange/walk`.
- [ ] Today's budget and depth suites green unchanged (depth tests stay in `binance/`); `check:feature-imports --tree`
      clean. Commit `refactor(exchange): budget shape and depth functions`.

### step 5/9: amounts unit (no production caller yet)

Files: `exchange/amounts/amounts.ts`, `index.ts`, `amounts.test.ts`.
- [ ] Signature: `exchangeMinorUnits(currency: CryptoCurrency | Currency, text: string, use: 'balance' | 'row'):
      Either<AmountError, number>`. `'balance'` rounds half away from zero past the scale and logs
      `balance-precision-rounded`; `'row'` refuses past the scale (`amount-precision`) unless the coin is
      reduced-scale, where it rounds and logs `row-precision-rounded`; both refuse an exponent form
      (`amount-malformed`) and a result above the safe integer (`amount-too-large`). The tags are fixed text, no amount.
- [ ] Tests first (imported through `@kiko/crypto-sync/exchange/amounts`, so knip sees a consumer):
      "returns exact minor units", "refuses more decimals than the scale for a row", "rounds a balance with more
      decimals than the scale half away from zero", "rounds a row on a reduced-scale coin", "refuses above the safe
      integer", "refuses an exponent form". Code wraps `decimalToMinorUnits` with the registry's scale and
      `reducedScale`. Commit `feat(exchange): exact exchange amounts`. Then `make mutable` for 3a (above).

### step 6/9: walk config and the walk unit

Files: `src/crypto-sync/exchange/walk/walk-config.ts` (new, `ExchangeWalkConfig`), `src/crypto-sync/binance/
binance.walk-config.ts` (new, `BINANCE_WALK_CONFIG`), `binance.walk-config.test.ts` (new),
`src/crypto-sync/binance/binance.amounts.ts` (new home of `btcSatoshis`, moved from `binance.history-walk.ts` with
its callers' imports), `git mv binance.history-walk.ts exchange/walk/walk.ts`, `binance.history-records.ts ->
exchange/walk/records.ts`, `binance.walk-write-deps.ts -> exchange/walk/walk-write-deps.ts` (tests per the
placement rule), `exchange/walk/index.ts`, every Binance walk entry point (passes `BINANCE_WALK_CONFIG`),
`binance.history-client.ts` (`UnreadableRow` imported from `exchange/walk`, a type import).
- [ ] Test first in `binance.walk-config.test.ts`: "the Binance walk config carries today's asset, metadata field,
      names, page size and rate-limit check" (`asset` = `'BTC'`; `metadataField` = `'binanceAsset'`;
      `walletHoldingNameOf(key)` equals `WALLET_HOLDING_NAMES[key]` for every key; `totalPageSize` =
      `HISTORY_TOTAL_PAGE_SIZE`; `isRateLimitError(new BinanceRateLimitError(...))` true, `new Error()` false). Red:
      the file does not exist yet.
- [ ] Code: in the moved walk, `BINANCE_ASSET`, `binanceKeyOf`, `WALLET_HOLDING_NAMES[key]` and
      `resolveWalletHoldings`'s `metadataField: 'binanceAsset'` become `config.asset`, `config.holdingKeyOf`,
      `config.walletHoldingNameOf(key)`, `config.metadataField`; the config is threaded from the walk entry points;
      every other line unchanged. `btcSatoshis` keeps its behaviour.
- [ ] Check: the walk, records, properties and series-ranges suites and the step 1/9 snapshot green unchanged;
      `npm run check:feature-imports -- --tree` reports no `feature-cycle`. Commit
      `refactor(exchange): walk unit reads the per-exchange walk config`.

### step 7/9: the paging unit

Files: `git mv binance.history-paging.ts exchange/paging/paging.ts` (tests per the placement rule; the moving-depth
and paging tests import Binance fixtures, so they stay), `exchange/paging/index.ts`, `binance.history-client.ts`
(`TotalPage` from `exchange/paging`, a type import; `BinancePageWeights`), importers.
- [ ] Code: `Pager`, `SpanRead`, `offsetPager` are today's paging, moved; it imports `halfOf`, `SpanRead`,
      `WalkWindow` and the depth functions from `../walk`; the body reads `config.totalPageSize`,
      `config.isRateLimitError(error)` and `config.refusedCallWeights` where it read `HISTORY_TOTAL_PAGE_SIZE`,
      `instanceof BinanceRateLimitError` and `REFUSED_CALL`; `onRateLimit` is typed `(error: RateLimitError) =>
      void`; the run type comes from `exchange/budget`. No other body edit. Check: paging suites and the step 1/9
      snapshot green unchanged; `--tree` clean. Commit `refactor(exchange): paging unit with a per-exchange walk
      config`.

### step 8/9: one `BINANCE_ASSET`

- [ ] `BINANCE_ASSET` is defined once (today in both `binance.client.ts` and `binance.provider.ts`; re-grep), and
      `binance.provider.ts` imports it. Every suite and the step 1/9 snapshot green unchanged;
      `npm run check:feature-imports -- --tree` clean; knip clean. Commit `refactor(binance): one asset constant`.
      Then `make mutable` for 3b (above).

### step 9/9: skill text (kiko:scribe)

- [ ] `kiko-architecture` "Binance exchange sync" and "Binance transaction history" sections: the `exchange/` units as
      far as set 3 lands them; the container rule in `kiko-linter`/`kiko-code-style` if it names containers.

Set 3 gate deltas: `check:feature-imports --tree` clean at every commit is the set's main proof; mutation expected
low (moves); two deep gates (3a, 3b).

---

## Set 4: `crypto-exchanges-1.3-a task 4/15` (walk state to `sync_state`, 0060)

Spec ids: Z1-Z6, X1-X4, walk properties at 0 / 1 h / 1 day, C-NR8 (list shape). Expected mutable files: about 18.
TIMEOUT-HEAVY risk: none app-wide; the walk files have large related-test fan-out: name proofs if flagged.

**Interfaces produced:** `ExchangeState`, `WalkMarks`, `WalkId`, `CoinLists` (spec section 2) and
`parseExchangeState(text: string | null): ParsedExchangeState` in `src/crypto-sync/exchange/walk-state/`;
`syncStateRepo.patchExchangeState(accountId, exchangeId, patch: ExchangeStatePatch)` and
`syncStateRepo.resetExchangeState(accountId, exchangeId, floorMs)`; the walk deps seam `ExchangeStateDeps =
{ readExchangeState: (accountId: string) => Promise<string | null>; patchExchangeState: (accountId: string, patch:
ExchangeStatePatch) => Promise<void> }` (replaces `BinanceWalkWriteDeps` in step 5); test helpers in
`src/test-support/walk-marks.ts`: `walkMarksOf(database | rows, accountId, walkId)`, `withWalkMarks(seed,
accountId, walkId, marks)`, `expectWalkMarkWritten(deps, accountId, walkId, field, value)`,
`walkStateFake(world)`.

### step 1/11: test-only helper commit (Q11)

Files: `src/test-support/walk-marks.ts` (new; `test-support/**` is already `TEST_ONLY`) and the 19 test files that
read, seed or assert the 24 old keys (re-grep `binance(History|Pay|Transfer|Earn)(HistoryCursor|Cursor|
PendingOverlap|PointCursor|RangeCursor|RescanCursor|SpanHints)` and the `BINANCE_*_FIELD(S)` / `setBinanceWalk*` /
`resetBinanceWalkCursors` names in tests: 18 files by key text plus `binance.history-walk.properties.test.ts`),
including `holding-metadata.test.ts`, `holdings.repo.history-cursor-account-gate.test.ts`,
`holdings.repo.walk-owned-metadata.test.ts`, `binance.earn-test-fixtures.ts`.
- [ ] No app change. Every seed and read goes through `withWalkMarks`/`walkMarksOf`; every writer-call assertion
      (`deps.writeWalkCursor` / `writeWalkPending` / `writeWalkHints` `toHaveBeenCalledWith` and
      `toHaveBeenLastCalledWith`: about 62 in `binance.transactions.test.ts`, 39 in `binance.pay-history.test.ts`, 4
      in `binance.transfer-history.test.ts`; re-grep) goes through `expectWalkMarkWritten`; the stateful fakes
      (`binance.transactions.test.ts`'s writer fakes, `binance.earn-test-fixtures.ts`'s `writeWalkCursor` /
      `writeWalkPending` / `writeWalkHints` world fakes) go through `walkStateFake`. Today the helper maps (walk id,
      field) to the metadata key on the Spot holding and to today's writer; step 5 changes only the helper.
- [ ] Check: every touched suite green, same test and assertion counts; dup.sh alone per touched file. Commit
      `test(binance): one helper for walk marks`.

### step 2/11: schema and 0060 (Z1-Z5)

Files: `src/db/schema.ts` (`syncState.exchangeState: text('exchange_state')`), `npx drizzle-kit generate --name
exchange_state` -> `0060_*.sql` + snapshot + journal + `migrations.js` (re-check the file after generate; biome
write), the hand-appended copy, `drizzle/migrations/0060-exchange-state.test.ts` (new).
- [ ] Tests first (real sqlite through 0059): "creates the state row for an account with walk keys and leaves its
      stamps null" (Z1); "copies a disconnected account's floor values as stored" (Z2); "copies every walk field into
      its walk entry" (Z3, field map pinned as a table); "a walk with only a cursor copies no other field" (the
      entry has `cursor` only: no `null` siblings); "skips an account whose metadata is not JSON and still succeeds"
      (Z4); "copies a malformed pending value as stored" (Z5: a string, a boolean and an object `pending`; each reads
      back with its own `json_type`: `text`, `true`, `object`); "keeps a list a list" (`"[1]"` text stays text,
      `[1]` stays an array); "takes the walk state from the first Spot BTC holding" (two Spot BTC holdings with
      different cursors: the one first by `(sort_order, created_at)` wins, as the walk reads it); "an account whose
      state row only carries walk state reads as never synced" (grep every `syncStateRepo`/`syncState` reader for
      row-existence checks first and list them in the commit body).
- [ ] Code: `ALTER TABLE sync_state ADD exchange_state text;` then one `INSERT INTO sync_state (account_id,
      exchange_state) SELECT ... ON CONFLICT(account_id) DO UPDATE SET exchange_state = excluded.exchange_state` over
      the first Spot BTC holding per account (`ROW_NUMBER() OVER (PARTITION BY account_id ORDER BY sort_order,
      created_at)` = 1, filtered by `CASE WHEN json_valid(metadata) THEN json_extract(metadata, '$.binanceAsset')
      END = 'BTC'` and a guarded has-a-walk-key test). Each walk entry is `json_group_object(field, json(h.metadata ->
      path))` over a `VALUES (walk, field, path)` map of the 24 keys, including a row only when
      `json_type(h.metadata, path) IS NOT NULL`, the whole expression inside `CASE WHEN json_valid(h.metadata) THEN
      ... END`; a walk with no field is absent; `version` 1. Never `json_extract` into `json_object` (an absent key
      writes `null`; a string becomes unquoted text; `true` becomes 1).
- [ ] Commit `feat(db): walk state column on sync_state`.

### step 3/11: per-walk parse (X1 parse side, Z5 parse side, C-NR8 lists)

Files: `exchange/walk-state/walk-state.ts`, `index.ts`, `walk-state.test.ts`.
- [ ] Tests first: top level malformed (not JSON, wrong version) -> `malformed`; each walk field parsed by today's rule
      (`binanceWalkCursorOf`, `readPendingMark`, `readRoundRobinCursor`, `readSpanHints`; re-grep each), a malformed
      field never empties its siblings; a non-object walk entry reads as empty values with the walk tag; `trades` and
      each of the four coin lists (`untrackedCoins.balance`/`.history`, `oversizedCoins.balance`/`.history`) parse
      alone. The cases of `holding-metadata.test.ts` describes "the Binance walk cursors", "the Binance pending
      overlap lists", "the Binance point cursors", "the Binance range cursors", "the Binance span hints" and "the six
      keys of the Binance Earn walk" move here (same inputs, read from a walk entry). Commit
      `feat(exchange): parse walk state per field`.

### step 4/11: gated writers (X2-X4, C-NR8 union)

Files: `src/sync-state/sync-state.repo.ts`, `sync-state.repo.test.ts` (real sqlite).
- [ ] Tests first: "replaces only the named field and keeps a malformed sibling byte-identical" (X2); "writes nothing
      once the account left the exchange" (X3; the account-gate cases of `holdings.repo.history-cursor-account-gate
      .test.ts` move here: "is a no-op on a disconnected account", "keeps the other walks cursors when one walk
      advances its own", "a disconnect's floor write is not undone by a walk's late-arriving window commit", "a
      disconnect's reset is not undone by a walk's late-arriving write"); "inserts the row when none exists" (X4);
      "never overwrites a malformed top level"; "replaces a balance list and adds to a history list without
      duplicates"; reset: "resets every walk to the floor, empties pending lists, removes the coin lists and
      replaces a malformed value".
- [ ] Code: `patchExchangeState` inside `write(...)`: re-read, gate on `accounts.institution = exchangeId`, then
      patch. `resetExchangeState` inside `write(...)`: gate on the same institution (it runs before
      `accountsRepo.disconnect`), replace the whole column with `{ version: 1, walks }`: in each parsed walk entry
      (none for a malformed column) a stored `cursor` or `rescan` becomes the floor and a stored `pending` becomes
      `[]` (today's `withWalkOwnedMetadataResetToFloor` rule); point/range cursors, span hints, trades and both coin
      lists of each kind are removed. Commit `feat(sync-state): gated exchange state writers`.

### step 5/11: walks, disconnect and the caption read `exchange_state`; helper switched

Files: walk readers/writers (`binance.walk-write-deps.ts`, `binance.history-walk.ts`, `binance.transactions.ts`,
pay/transfer/earn walk entry points), `holdings.repo.ts` (`setBinanceWalkCursor`, `setBinanceWalkPending`,
`setBinanceWalkSpanHints`, `resetBinanceWalkCursors` removed; `carriedMetadataKeys` stops carrying the 24 keys),
`holding-metadata.ts` walk readers removed or moved, `src/crypto-sync/disconnect/disconnect.ts` and its test,
`binance-history-status.ts`, `crypto-sync-section.component.tsx`, their tests, `src/test-support/walk-marks.ts`
(now seeds/reads `exchange_state` and asserts `patchExchangeState` calls), retired suites.
- [ ] One commit, because removing `resetBinanceWalkCursors` and its caller in `disconnectCryptoAccount` together
      keeps the typecheck green.
- [ ] Tests first: "reads back every BTC walk mark equal to the old metadata" (Z3 read-back through the parse, all
      four passes of span hints); disconnect: "resets the walk state through the reset writer before the account
      disconnects, then clears the key" (order: `syncStateRepo.resetExchangeState(accountId, 'binance',
      HISTORY_FLOOR_MS)`, `accountsRepo.disconnect`, `clearCredentials`); holdings and rows stay; caption: "hides the
      caption when the state row's cursors are current and the metadata keys are gone".
- [ ] Code: `BinanceWalkWriteDeps` becomes `ExchangeStateDeps`; walks read their marks from the parsed state and
      write through `patchExchangeState`. `walkCursorsOf` and `transferOwesRange` read the parsed state from
      `useLiveQuery(syncStateRepo.getQuery(account.id), ['sync_state'])` in `crypto-sync-section.component.tsx`
      (the call site that passes `walkCursorsOf(holdings)` / `transferOwesRange(holdings)` to
      `isBinanceHistoryBehind`), in the same commit as the walks.
- [ ] Retired suites: `holdings.repo.history-cursor-account-gate.test.ts` (cases moved to step 4 and the disconnect
      test); `holdings.repo.walk-owned-metadata.test.ts` walk-key carry cases (replaced by "a balance-sync upsert
      drops the old walk keys"); the walk-key describes of `holding-metadata.test.ts` (moved in step 3). The commit
      body lists each retired case and its new home. Then the full binance suites green with the switched helper.
      Commit `feat(binance): walk state lives in sync_state`.

### step 6/11: malformed state pauses history, balance still syncs (X1, paused caption)

Files: run wiring (`run-crypto-sync.ts` / `binance.transactions.ts`), `binance-history-status.ts`,
`crypto-sync-section.component.tsx`, its test, `en.ts`, `uk.ts`.
- [ ] Tests first: "writes the balance and runs no history walk on a malformed state" (tag `exchange-state-malformed`
      logged once, nothing written to the column); "shows the paused caption" (`accountDetail.exchangeHistoryPaused`
      with `exchange: 'Binance'`). Key en "{{exchange}} history import is paused because Kiko could not read its saved
      import progress. Disconnect and reconnect {{exchange}} to repair it; your holdings and transactions stay."; uk
      «Імпорт історії {{exchange}} призупинено, бо Кіко не зміг прочитати збережений прогрес імпорту. Відʼєднайте й знову
      підключіть {{exchange}}, щоб це виправити; ваші активи й транзакції залишаться.» Commit.

### step 7/11: restore mirror (Z6)

Files: `restore-snapshot.ts` (`withWalkStateMoved`), `restore-walk-state.two-path.test.ts` (new).
- [ ] Tests first: "a backup without walk state restores equal to the migrated database" (Z1-Z5 seeds, the
      two-Spot-BTC-holding seed and the only-a-cursor seed); "adds a state row when the backup has none" (Z6); "a
      backup with walk state restores it unchanged"; "an implicit-account merge keeps the merged account's walk
      state".
- [ ] Code: `withWalkStateMoved` runs after `withImplicitAccountsMerged`, on its `syncState` output and on
      `holdingsAfterImplicitMerge`; it takes the first Spot BTC holding per account by `(sortOrder, createdAt)`, the
      one the walk reads, and copies only present fields (the 0060 rule). Commit.

### step 8/11: version decision and demo

Files: `envelope.test.ts`, demo `.kiko` files.
- [ ] `VERSION_DECISIONS` gains the reason "Through <0060 tag>, a nullable column riding inside the sync state row,
      derived on restore: an older build drops the key and its walks read from their floors, where keys dedupe; so it
      needed no bump." -> `{ version: 4, migrationCount: 61 }` ("was:" `migrationCount: 60`). `KIKO_REGEN_DEMO=1` regen.
      Commit.

### step 9/11: walk properties at three clock gaps

Files: `binance.history-walk.properties.test.ts` (has `RUN_GAPS = [0, HOUR_MS, DAY_MS]`; re-grep).
- [ ] Every property runs on the `exchange_state` store at each gap; add "a patch never loses another walk's marks
      across runs" at the three gaps. Commit.

### step 10/11: reviews

- [ ] `kiko:reviewer` on 0060 before BATCH READY (top question: "can any walk mark be lost, doubled, retyped or
      misread between migration, restore, parse and writer, or read from a holding the walk does not read?"; queries
      touching `sync_state`; no index -> no EXPLAIN test).
- [ ] Translator review of `exchangeHistoryPaused` (en + uk); diff to the coordinator for the user.

### step 11/11: skill text (kiko:scribe)

- [ ] `kiko-architecture` Binance history section: walk state in `sync_state.exchange_state`, parse per field, gated
      writers, disconnect reset, the two coin lists per kind; pointers only.

---

## Set 5: `crypto-exchanges-1.3-a task 5/15` (multi-coin balances, holdings, price fallback)

Spec ids: H1-H13, N2 (balance part), A1-A4 (balances), C-NR8 (balance lists). Expected mutable files: about 14-16;
optional 5a (steps 1-6) / 5b (steps 7-8) if `make mutable` passes 30.

### step 1/10: `ProviderBalance.currency`

Files: `src/crypto-sync/provider/provider.ts`, `src/crypto-sync/sync/sync.ts`, btc-wallet provider, tests.
- [ ] Test first: "writes the balance in the provider's currency" (`runBalanceSyncInner` writes `'BTC'` today).
      Commit.

### step 2/10: balances through `exchangeMinorUnits` (A1-A4 balance arms)

Files: `binance.provider.ts` (`sumSatoshis`, `Money.fromMajor(BINANCE_ASSET, Number(...))`), tests.
- [ ] Every balance goes through `exchangeMinorUnits(currency, text, 'balance')` (half away from zero past the scale,
      tag `balance-precision-rounded`), and only after the LD* skip and the not-tracked filter (a malformed balance of
      an untracked coin never fails anything).
- [ ] Tests: A1 `"0.00012345"` -> 12345 (same); A3 `"1e-8"` on Funding or Earn -> that wallet keeps its last good
      balance ("was:" 1); A3 on Spot -> the balance sync fails as a Spot read failure, nothing written (the Spot
      anchor; "was:" 1); A4 JSON number `0.5` via `decimalFromJsonNumber` -> 50000000 (same); "rounds a balance with
      more decimals than the scale half away from zero" (`"0.000000015"` BTC -> 2, tag logged). Commit.

### step 3/10: every asset, per-coin and fiat keys, LD* skip (H1, H5, H7, H8)

Files: `binance.client.ts` (`asset=` dropped from funding and Earn balance reads), `binance.holding-keys.ts` (open key
form `<CODE>`, `<CODE>:funding`, `<CODE>:earn`; BTC keys unchanged), `binance.provider.ts`, tests.
- [ ] Test first per row; "was:" pins in `binance.client.test.ts`/`binance.provider.test.ts` that assert `asset=BTC` in
      a query -> no `asset` parameter. Commit.

### step 4/10: appear, stay, dust, Spot anchor, wallet failure, absent coins (H2-H4, H11, H13)

- [ ] Tests first per row, H13 on fixture UA-1 (Spot BTC only non-zero: no USDT/UAH holding from the balance read);
      "zeroes an existing Funding (and Earn) holding whose coin is absent from a good read" (`USDT:funding` and
      `USDT:earn` exist at 10; a good Funding and Earn read lists no USDT -> both written 0, not archived). Commit.

### step 5/10: names and BTC rename (H9, H10)

Files: `provider.ts` (`renameFromDefaults: readonly string[]`), `holdings.repo.ts`, `binance.holding-keys.ts`, tests.
- [ ] Tests first: Spot BTC from `'Binance BTC'` or `'Binance Spot'` -> `'Binance Spot · BTC'`; Funding/Earn; a user name
      kept. "was:" pins: default names `'Binance Spot'`/`'Binance Funding'`/`'Binance Earn'` in 16 test files
      (re-grep `WALLET_HOLDING_NAMES` and the literals) -> `'Binance <Wallet> · <CODE>'`. Commit.

### step 6/10: not-tracked and oversized lines (H6, H12, N2 balance part, C-NR8)

Files: `exchange/history-status/` (`untrackedCoinsOf`, `oversizedCoinsOf`), `binance.provider.ts` (replaces the
balance lists `untrackedCoins.balance` and `oversizedCoins.balance` via `patchExchangeState` after each good balance
read), `crypto-sync-section.component.tsx`, `en.ts`, `uk.ts`, tests.
- [ ] Keys `accountDetail.untrackedCoins`, `accountDetail.oversizedAmount` with the spec section 10 en/uk text.
      Tests first: "lists PEPE as not tracked"; "skips the write and shows the oversized line above the safe bound";
      "shows the sorted union of the balance and history lists without duplicates" (balance [PEPE, ABC], history
      [PEPE, XYZ] -> "ABC, PEPE, XYZ"); "a good balance read replaces only the balance list" (history [XYZ] kept).
      Commit.

### step 7/10: Binance public price fallback

Files: `src/rates/binance-market/` (new; `ticker/price`, `klines` on the pinned host, no key), `rates-refresh.ts`,
`history-backfill.ts`, tests.
- [ ] Tests first: "prices a coin CoinGecko missed through its USDT symbol and USDT's price"; "prices USDT through
      EURUSDT and the EUR anchor when USDT is unpriced"; "never assumes 1:1"; "one coin missing from both stays out of
      net worth"; no key header sent. `check:plist` unchanged (no new host). Commit.
- [ ] Release hold (C2): no build that contains this fallback goes to App Review before Binance's market-data terms
      are read and recorded (source URL, check date, the clause that allows the use) in the set 5 BATCH READY; the
      coordinator holds the upload until then.

### step 8/10: privacy wording (Q10)

Files: `docs/privacy-policy.en.md`, `docs/privacy-policy.md`, `docs/privacy-site/en.html`, `docs/privacy-site/index.html`.
- [ ] Spec section 9 "Privacy policy, price fallback" text, same commit for all four. Commit.

### step 9/10: reviews

- [ ] Translator review of the two new keys and the uk privacy text; the reviewer checks each label at its screen.
- [ ] App Privacy label review (C1): the reviewer checks the App Store Connect App Privacy answers against the new
      price-fallback request, and the coordinator records the result in
      `/Users/drizzer14/Developer/Projects/pff-ios/memory/refs/resubmission-kit.md` section D (the user-side
      pre-submit checklist).

### step 10/10: skill text (kiko:scribe)

- [ ] `kiko-architecture` "Binance exchange sync" (`asset=BTC` line, keys, names), the sync lines on crypto upserts
      (re-grep "every crypto/exchange holding a `runBalanceSync` upserts" and the "crypto balance + Binance transaction
      import" line); `kiko-compliance` Binance bullets (privacy-site files, the market-data terms hold); pointers only.

---

## Set 6: `crypto-exchanges-1.3-a task 6/15` (account-wide walks; 6a matcher filter first)

Spec ids: S1-S3 (6a); Y1-Y8, E1-E2, W1-W2, A1-A4 (rows), N2 (Pay part), BTC key byte identity, key uniqueness
property, walk properties at 0 / 1 h / 1 day (6b). Expected mutable files: about 12.

Pay funds rule for the pins below (spec section 5, R-Q7): one row per `fundsDetail` entry with a curated
`currency`, placed by today's single-wallet and `walletAssetCost` rules applied to that entry exactly as they apply
to a BTC entry today; an order funded only in its own coin keeps today's comparison of its cost-less entries with
the order amount; an order funded in several coins compares each coin's costs with that entry's `amount` only.

### step 1/11 (6a): 2-minute matcher sees only unmarked rows (S1-S3)

Files: `src/statistics/internal-transfers/internal-transfers.ts` (pure helper `rowsForTransferMatch(rows)` beside
`internalTransferTransactionIds`), `internal-transfers.test.ts`, `src/screens/statistics/statistics.screen.tsx`
(call site over `ledgerWithCurrency`).
- [ ] Tests first in `internal-transfers.test.ts` (not the 3134-line screen test): "a Pay send counts when the
      same-amount rows nearby are exchange legs" (S1); "a BTC Pay send counts beside a Transfer pair" (S2); "two
      unmarked opposite rows are still matched" (S3). Keep `statistics.screen.test.tsx`'s existing matcher case as is.
      Commit `fix(statistics): exchange legs never consume an unmarked row`.

### step 2/11: row amounts through `exchangeMinorUnits` (A1-A4 rows)

Files: `binance.amounts.ts` (`btcSatoshis`, set 3's home), its callers in `binance.pay-history.ts`,
`binance.transactions.ts`, `binance.transfer-history.ts`, `binance.earn-history.ts`, tests.
- [ ] Every row amount goes through `exchangeMinorUnits(currency, text, 'row')`; a `Left` stops the window with its
      own code, owed at the record's point.
- [ ] Tests first: A2 `"0.000000001"` -> stop `amount-precision`, owed point ("was:" 0); A3 `"1e-8"` -> stop
      `amount-malformed` ("was:" 1); A1/A4 unchanged.
- [ ] "was:" pins: `binance.pay-history.ts` `payRowsOf`'s `Math.abs(btcSatoshis(order.amount) ?? 0)` reads a
      malformed amount as 0 and stops `pay-amount-invalid`; it now stops with the parser's code.
      `binance.pay-history.direction.test.ts` "stops on an amount that rounds to zero satoshis" (`'-0.000000001'`)
      -> `amount-precision`; "stops a send whose cost-less BTC funds entry is not a number" (`'lots'`) ->
      `amount-malformed`; "a cost that is not a number stops" (`'x'`) -> `amount-malformed`. Unchanged: "a negative
      cost stops" (`'-0.0005'` parses; `costsOf`'s sign check keeps `pay-amount-invalid`); a parsed zero amount keeps
      `pay-amount-invalid`; "row 13: the amount %p stops" (`payDirection`, re-grep whether it parses) stays null.
      Commit.

### step 3/11: walk-created holdings per coin

Files: `exchange/walk/walk.ts` (`resolveWalletHoldings`), `binance.walk-config.ts`, `binance.holding-keys.ts`, tests.
- [ ] Test first: "a walk-created USDT Funding holding is in USDT and named 'Binance Funding · USDT'"; "a
      walk-created BTC Funding holding keeps today's BTC key and set 5's name 'Binance Funding · BTC'".
- [ ] Code: `ExchangeWalkConfig` gains `coinOfKey: (key: string) => Currency | undefined` (Binance: the code before
      `:` of `binance.holding-keys.ts`'s key form, curated or fiat); `resolveWalletHoldings` creates a missing wallet
      holding with `coinOfKey(key)` as `currency` (a key with no coin creates nothing) and
      `config.walletHoldingNameOf(key)`; `BINANCE_WALK_CONFIG.walletHoldingNameOf` returns `Binance <Wallet> · <CODE>`
      for any key. Commit.

### step 4/11: capital account-wide (W1, W2)

Files: `binance.history-client.ts` (`coin=` dropped), `binance.transactions.ts`, tests.
- [ ] Tests first: "imports a USDT withdrawal as spending in the default category" (W1); "a hand-linked withdrawal stays
      excluded" (W2); BTC keys `${accountId}:deposit:<id>` / `:withdraw:<id>` unchanged; walletType placement.
- [ ] "was:" pin: `binance.history-client.test.ts` "keeps the capital reads on coin BTC with offset and limit 1000" ->
      "keeps the capital reads with offset and limit 1000 and no coin". Commit.

### step 5/11: Pay any curated coin, cross-coin, keys (Y1-Y8, N2 Pay part, C-NR8)

Files: `binance.pay-history.ts`, `binance.history-client.ts`, tests.
- [ ] Tests first per Y row; keys: BTC row of a BTC order byte-identical; others `...:${walletType}:${currency}`.
      N2 over two runs: "keeps a Pay-only untracked coin on the not-tracked line after the next balance read" (run N:
      balance list [PEPE], a Pay funds entry in XYZ adds XYZ to the history list; run N+1: the balance read writes
      [PEPE] again; the line shows "PEPE, XYZ" after each run).
- [ ] "was:" pins, each with its new value:
      - `binance.pay-history.test.ts` every `code: 'pay-btc-funded-other-coin'` stop; "stops the window, cursor
        unmoved, on a non-BTC order the user paid with BTC funds" -> one BTC Funding row (Y4), key
        `...:${walletType}:BTC`, cursor advances; "ignores a non-BTC order the user received though the payer paid
        with BTC funds" -> one receive row in the order's coin (Y6).
      - `binance.pay-history.direction.test.ts` (order: BTC, amount `'-0.001'`, walletType 2, `payOrder` default):
        "stops a send whose cost-less BTC funds entry is below the amount, the rest paid in another coin" (BTC 0.0004
        + USDT 40, cost-less) -> `toMatchObject([{ wallet: 'BTC', amountMinorUnits: -40_000, externalId:
        'acc-1:pay:C2C:tx-1:2' }, { wallet: 'USDT', amountMinorUnits: -4_000_000_000, externalId:
        'acc-1:pay:C2C:tx-1:2:USDT' }])` (Y5); "stops a send whose cost-less BTC funds entry is below the amount, with
        no other coin listed" -> unchanged, still `pay-split-mismatch` (funded only in its own coin); "stops a send
        with no BTC funds entry at all and funds in another coin" (USDT 100) -> `toMatchObject([{ wallet: 'USDT',
        amountMinorUnits: -10_000_000_000, externalId: 'acc-1:pay:C2C:tx-1:2:USDT' }])` (Y4 shape, cross-coin);
        "stops when the funds named are not BTC, so no BTC movement is guessed" (USDT 1) -> `toMatchObject([{ wallet:
        'USDT', amountMinorUnits: -100_000_000, externalId: 'acc-1:pay:C2C:tx-1:2:USDT' }])`. The cross-coin
        `comment` is pinned by Y3 only.
      - `binance.history-client.test.ts` "returns the BTC orders only, and counts every order of the page" -> returns
        every curated-coin order and counts every order; the six cases of `it.each` "does not fail the read for a
        non-BTC order with %s" -> a malformed USDT order is in `unreadable` and owes its point (`rows` only the BTC
        order, `unreadable` length 1, `gathered` 2), and the same six on an untracked-coin order (XYZ) are still
        ignored and counted; "lists the Binance ids of the parties of a non-BTC order that was paid with BTC funds"
        -> lists them as for any curated order; "reads a malformed fundsDetail of a non-BTC order as no BTC funds,
        never an error" -> a malformed `fundsDetail` of a USDT order makes the order unreadable (owed point).
      Commit.

### step 6/11: Transfer account-wide

Files: `binance.transfer-history.ts`, `binance.history-client.ts` (`btcRowOf` -> a curated-row reader: a row whose
upper-cased `asset` is a curated code is read strictly; any other is counted and ignored), tests.
- [ ] "was:" pins: `binance.transfer-history.test.ts` "a row of another asset gives no row", "a transfer of another
      asset is ignored, and counted for the pager...", "an off-contract row of another asset does not stall the BTC
      rows of its page" -> a curated asset imports on its own wallet holding, an untracked one is still counted and
      ignored; `binance.history-client.test.ts` `describe('fetchUniversalTransfers')`: "parses the readable rows of a
      page beside an unreadable one and a row of another asset" -> the other curated-asset row is parsed; "is counted
      for the pager and never parsed, whatever else is wrong with it" -> holds for an untracked asset only; a malformed
      curated-asset row is unreadable and owes its point; "is told from a BTC row by its asset alone: a row with a
      lowercase btc asset is another asset" -> a lowercase `btc` row is read as BTC (asset upper-cased once). Commit.

### step 7/11: Earn account-wide, reward grouping per asset (E1, E2)

Files: `binance.earn-history.ts`, `binance.history-client.ts` (`fetchEarnRecords` drops `asset: BINANCE_ASSET`),
`binance.earn-history.rewards.test.ts`, `binance.history-client.test.ts`.
- [ ] Tests first: E1 keys `...:0`, `...:1` unchanged; E2 BTC keys byte-equal to E1, USDT `...:0:USDT` (0.1),
      `...:1:USDT` (0.5).
- [ ] "was:" pins: `binance.history-client.test.ts` "GETs %s with asset BTC, current and size 100, and no type" ->
      "GETs %s with current and size 100, no asset and no type"; "always sends type=ALL on the flexible rewards read"
      -> its expected query has no `asset`. Commit.

### step 8/11: `multiCoinSince`

Files: walk entry points, `exchange/walk-state` (parse and patch of `multiCoinSince` and `multiCoinSeen`),
`syncStateRepo.resetExchangeState`, tests.
- [ ] Rule: on a walk's first run in this set's code, the walk writes `multiCoinSeen: true` whatever the cursor, and
      `multiCoinSince` = its PLAN cursor (capital: `cursor ?? latest ?? null` in `binance.transactions.ts`; the
      others re-grep their plan cursor) only when that is not null. A walk with `multiCoinSeen` never writes either
      again. Capital with a null stored cursor and a legacy `latest` records `latest`, so set 15's backfill covers
      `[floor, latest)`: no history skipped. `resetExchangeState` removes `multiCoinSince` and keeps
      `multiCoinSeen: true` (the reset cursor is the floor, so every coin is read from it; nothing is owed).
- [ ] Tests first: "records the plan cursor at the first multi-coin run"; "records none when the plan cursor is
      null"; "a second run after a null-cursor first run records none"; "records the latest row time for capital with
      no stored cursor"; "a disconnect removes the marker's range and keeps it seen". Commit.

### step 9/11: key identity and properties

- [ ] "every BTC key equals today's key for the same record" (set 3 step 1 snapshot reused); property "keys stay unique
      across coins, wallets and walks"; walk properties at gaps 0, 1 h, 1 day over mixed-coin fixtures. Commit.

### step 10/11: reviews

- [ ] `kiko:reviewer` with the top question "can any BTC key, cursor or row change, or any coin's row be dropped or
      doubled?"; exact-parity sums per coin.

### step 11/11: skill text (kiko:scribe)

- [ ] `kiko-architecture`: `coin=BTC` capital line, Pay/Transfer/Earn per-coin rules and keys, `multiCoinSince` and
      `multiCoinSeen`; `kiko-compliance` Binance history bullets (re-grep "transaction history import failed"
      context) where set 6 changes them.

End of plan: `make verify` through the queue on the set 6 tip, re-run until green.
