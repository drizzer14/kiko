# Crypto exchanges 1.3-a, change sets 1-6: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan set by set. Steps use checkbox (`- [ ]`) syntax.

**Goal:** land change sets 1-6 of track `crypto-exchanges-1.3-a` (USDT at scale 8 with migration 0059 and `.kiko`
v4; the curated coin registry; the shared exchange layer; walk state in `sync_state` with migration 0061;
multi-coin balances; account-wide history walks), each set tip shippable alone.

**Architecture:** money stays integer minor units; every rescale is exact (`x 1000000`) and mirrored on restore;
JSON fields are touched only behind `CASE WHEN json_valid(...)`; the exchange layer lives in
`src/crypto-sync/exchange/<unit>/` (a declared container), Binance-specific code stays in `src/crypto-sync/binance/`.

**Tech stack:** React Native, op-sqlite + Drizzle (count-based runner `src/db/run-migrations.ts`), Jest with
`node:sqlite` (`src/test-support/real-sqlite.ts`), fnts `Either`/`maybe`, ts-pattern, i18next.

**Spec:** `docs/superpowers/specs/2026-10-15-crypto-exchanges-design.md` (approved at 73336657; C-NR8 at
ee08b145; plan alignment at 764d1512). Rulings: `.superpowers/sdd/binance-multicoin/rulings.md` (user rulings, C-NR*, plan-prep Q1-Q12, NR8,
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
- Migration numbers 0059/0060/0061 follow the base's last migration 0058; each migration set re-checks main's
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
- No flag, no hidden feature (Guideline 2.5.19); every new visible text ships reachable.
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
    asset: ExchangeHolding['currency'];                             // 'BTC' for Binance in 1.3-a
    metadataField: ExchangeHolding['metadataField'];                // 'binanceAsset'
    holdingKeyOf: (holding: Pick<HoldingRow, 'metadata'>) => string | undefined;
    walletHoldingNameOf: (key: string) => string;                   // wallet key -> default name
    isRateLimitError: (error: unknown) => error is RateLimitError;
    totalPageSize: number;
    refusedCallWeights: Weights;                                    // today's REFUSED_CALL
    depth: DepthConfig;                                             // unread; set 4 removes it
  };
  ```
  No code reads `depth` (the depth config travels on `DepthMemory.config` and `DepthGuard.config`);
  set 4's first commit removes it (deferred review Minor m1).
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
5. A `sync_state` row created by 0061 with null stamps: any reader that treats row existence as "synced"
   (`lastSyncAt`-free checks) would show a never-synced account as synced. Owner: set 4 step 2/10, a grep of
   `syncStateRepo` readers plus a test "an account whose state row only carries walk state reads as never synced".

## Release-note items (input to set 15's What's New and Notes for Review)

- Crypto amounts show their exact value with trailing zeros trimmed, never fewer than 2 decimals (set 1).
- The manual holding picker lists every curated coin, about 35 (set 2; the count is the registry's, quoted from
  `curatedCoins` at set 15, not this line).
- Two new import errors: a backup with a USDT amount too large to store exactly (set 1), and a backup made by a
  newer Kiko with a currency this version does not know (set 2).
- Screenshots: every shipped App Store screenshot that shows a crypto amount or the demo crypto account is shot
  again from the regenerated demo files (`docs/harness/screenshots-check.md`), since sets 1 and 2 change the crypto
  amount text and the demo coins.

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
      `'1 234,567'`; the existing uk-UA fiat case stays), "puts the sign outside the symbol of a crypto amount"
      (`Money.of('BTC', -5000000)` -> `'-₿0.05'`).
- [ ] "was:" pins changed in this step: `format.test.ts` test "formats BTC with eight decimals" becomes "formats
      one BTC with two decimals", `toContain('1.00000000')` -> `toContain('1.00')` (and not `'1.00000000'`);
      `format.test.ts` `'₿0.50000000'` -> `'₿0.50'`; `category-form.screen.test.tsx` test "shows an
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
      - "keeps the digits of a bare number element" (bare elements `0.30000000000000004`, `1.50`, `1e5` and
        `12345678901234567890` in `lots`, `matchers` and `draft.returns`, each beside a rescaled object: the column
        text holds each element's text unchanged; `element.value` would print them as `0.3`, `1.5`, `100000.0`,
        `1.23456789012346e+19`);
      - "leaves malformed JSON byte-unchanged and still succeeds" (U13: metadata `'{bad'`, matchers `'not json'`);
      - "leaves a string or real field and rescales its integer siblings" (U14: `"5000"`, `12.5`, integer
        `purchasePriceMinorUnits`; template `amountMinorUnits` null);
      - "leaves the bond register untouched" (Q12: `bond_register.terms` byte-identical);
      - "leaves a row with no rescaled field byte-identical" (untouched JSON texts compared as bytes).
- [ ] Red: the file does not exist yet; quote the failing count.
- [ ] Code: SQL shape (bound guard comes in step 4/11; keys in step 3/11). Element predicate, used verbatim in the
      rebuild, in `EXISTS` and in step 4's count: `CASE WHEN element.type = 'object' THEN json_type(element.value,
      '<field>') END = 'integer'`.
      A non-target element is copied through its own JSON text, `json(<column> -> element.fullkey)` (`fullkey` is the
      root-relative path, `$.lots[2]`, `$[0]`, `$.returns[1]`), so every element keeps its text: a boolean stays a
      boolean, a bare real keeps its digits (probed on `node:sqlite` 3.50.4).
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
              ELSE json(CASE WHEN json_valid(metadata) THEN metadata -> element.fullkey END)
              END ORDER BY element.key)
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
      values unchanged); "skips malformed JSON in the bound count" (U13 seed + an in-bound value: succeeds); "aborts on
      a value below the negative bound" (-9007199255 as a row amount and a `lots` element: the guard message);
      "aborts on the smallest 64-bit integer without an overflow" (`-9223372036854775808` as a key token and as a
      `lots` element: the guard message, never `integer overflow`).
      Gate test: "shows the migration error with the guard message" (`runMigrations` rejects with that message;
      `migrations-gate-error` shows `migrations.error` with it; children not rendered).
- [ ] Red; quote the count.
- [ ] Code: first statements of the file: `DROP TABLE IF EXISTS usdt_rescale_bound`; `CREATE TEMP TABLE
      usdt_rescale_bound (over_bound integer CONSTRAINT usdt_rescale_guard CHECK (over_bound = 0))`; one `INSERT INTO
      usdt_rescale_bound (over_bound) SELECT (<count>) + (<count>) + ...`, one count per rescale statement of steps 2
      and 3, each with EXACTLY that statement's predicate (`currency = 'USDT'`; the row's holding's currency; the
      CASE-guarded `json_type ... = 'integer'`; the element predicate of step 2; the matcher's own `$.currency`; the
      draft's own `$.currency` / `$.exchange.destinationCurrency`; the key's USDT first token and integer-token rule),
      the value term inside the CASE and two-sided, never `abs()` (`abs(-9223372036854775808)` raises `integer
      overflow`): `CASE WHEN <predicate> THEN <value> < -9007199254 OR <value> > 9007199254 END`. For example the
      `lots` count, probed on `node:sqlite`:
      ```sql
      (SELECT count(*) FROM holdings, json_each(CASE WHEN json_valid(holdings.metadata) THEN holdings.metadata END,
          '$.lots') AS element
        WHERE holdings.currency = 'USDT'
          AND CASE WHEN CASE WHEN element.type = 'object' THEN json_type(element.value, '$.costMinorUnits') END
              = 'integer'
            THEN json_extract(element.value, '$.costMinorUnits') < -9007199254
              OR json_extract(element.value, '$.costMinorUnits') > 9007199254 END)
      ```
      A key token's term: `CASE WHEN CAST(token AS INTEGER) || '' = token THEN CAST(token AS INTEGER) < -9007199254
      OR CAST(token AS INTEGER) > 9007199254 END`. Last statement `DROP TABLE usdt_rescale_bound`.
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
      USDT field restores"; "throws for an integer field far outside the safe range" (`-9223372036854775808` in a
      `lots` element, as 0059 aborts); "keeps the parsed value of a bare number element" (step 2's bare elements);
      "throws amount-too-large over the bound and names nothing restored" (message starts
      `data-transfer/amount-too-large`; pin the full message literal). In the migration test: "the bound literal
      equals `USDT_RESCALE_BOUND_MINOR_UNITS`" (reads the `.sql` text, not `src`).
- [ ] Two-path test, written in this step and shown red before the code (follow
      `restore-import-time-rezone.two-path.test.ts`): seed one scale-2 database through 0058 with U1-U5c rows, a
      legacy pre-`␟` dedup key, a two-holding USDT seed, the U13/U14 rows and step 2's bare number elements; path 1 applies 0059 and then the launch
      steps the gate runs (`upgradeStoredDedupKeys`, `rezoneImportTimes`); path 2 exports the seed as a version 3
      snapshot, restores it on a fresh migrated database, then runs the same launch steps. Assert every table equal
      (JSON columns compared parsed for rewritten rows, bytes for untouched rows): "a version 3 backup restores
      equal to the migrated database"; "a version 4 backup restores byte-unchanged" (12345000000 stays); "a version
      3 backup over the bound is refused and the live data stays" (error prefix, every table equal to before).
- [ ] Red; quote the count (the two-path file fails on every USDT value).
- [ ] Code: rescale only files with `version <= LAST_SCALE_2_USDT_VERSION` (named constant 3, never `<
      EXPORT_VERSION`). Per field: the predicate first (column parsed: metadata/draft a plain object; matchers
      `JSON.parse` in a try, rewritten with `JSON.stringify` only when a field changed; the field's own currency;
      a JSON integer as SQLite's `json_type` reads app-written JSON: `Number.isInteger(value) && Math.abs(value) <
      1e21`, the range in which `JSON.stringify` writes a number with no fraction and no exponent), then the bound,
      SQL's two-sided comparison (`value < -USDT_RESCALE_BOUND_MINOR_UNITS || value >
      USDT_RESCALE_BOUND_MINOR_UNITS` throws). Accepted limit: a number text the app never writes (`12.0`, `1e5`) is
      a real to SQLite and an integer here; the two paths agree on every value the app writes. A non-target array
      element and every untouched field keep their parsed value; a column is re-serialized only when one of its
      fields changed, so a number's text form (`1.50` against `1.5`) can differ only inside a rewritten column,
      which the two-path test compares parsed. A
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

Known red between commits: none (every pin that reads the grown `currencyOptions` or `cryptoCurrencyOptions` moves
in step 3).

Landed beyond the steps: migration 0060 adds the nullable device-local `settings.history_backfill_state` (the
history backfill's rotation cursor and settled marks; kept live on restore, no export bump, count 61), so the
later migrations are 0061 (set 4) and 0062 (set 7). Coin names read "Bitcoin" in uk too, and USDT's name is
"USDT".

**Interfaces produced:**
- `decimalToMinorUnits(text: string, scale: number, rounding: 'exact' | 'half-away-from-zero'):
  Either<DecimalAmountError, number>` in `src/currency/decimal/decimal.ts`, `DecimalAmountError = 'amount-malformed' |
  'amount-precision' | 'amount-too-large'`. Grammar `^-?[0-9]+(\.[0-9]+)?$` (no exponent, no spaces); BigInt inside.
- `CURATED_COIN_CODES = [...] as const`, `CuratedCoinCode`, `coinScale(entry: { baseAssetPrecision: number;
  maxUnits: number }): number`, `MIN_COIN_SCALE = 2`, `curatedCoins: Readonly<Record<CuratedCoinCode, CoinEntry>>`
  in `src/currency/coins/coins.ts` (barrel `src/currency/coins/index.ts`). `coins.ts` imports nothing from
  `currency.ts`; `currency.ts` derives from it (no circular derivation).
- `FROZEN_1_0_CRYPTO_CODES = ['BTC', 'ETH', 'USDT'] as const` in `restore-snapshot.ts` (step 3; its restore use
  in step 4).
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
`en.ts`, `uk.ts`, `currency-names.i18n.test.ts`, `restore-snapshot.ts` (the constant only),
`drizzle/migrations/0044-move-crypto-cash-holdings.test.ts`, `src/rates/coingecko/coingecko.test.ts`,
`src/rates/coingecko-history/coingecko-history.test.ts`, `holding-form.screen.test.tsx`,
`src/rates/rates-refresh/crypto-coverage.test.ts`, `src/rates/repo/rates.repo.test.ts`. One commit: the new codes
in `currencyOptions` need their `currencyNames` entries in the same commit, or the typecheck fails
(`en.currencyNames[code]` over every `Currency`). Every pin that reads the grown `currencyOptions` or
`cryptoCurrencyOptions` moves in this step, so no suite is red between commits.
- [ ] Tests first: "lists every curated code after the fiat block"; "derives scale, symbol and CoinGecko id from
      the registry"; "names every curated coin in en and uk" (`it.each` over the registry).
- [ ] "was:" pins: `currency.test.ts` `currencyOptions.slice(-3)` `['BTC','ETH','USDT']` -> the curated block in
      registry order; test "treats BTC, ETH, and USDT as crypto and everything else as fiat" -> every curated code is
      crypto; `[...cryptoCurrencyOptions]` -> the curated list; `coingecko-ids.ts` record type -> `Record<CryptoCurrency,
      string>` from the registry. The USDT-only name asserts stay.
- [ ] "was:" pins that read the default `currencies = cryptoCurrencyOptions` (the default parameter itself stays;
      each test keeps its intent by passing `['BTC', 'ETH', 'USDT']` explicitly): `coingecko.test.ts` "requests the
      simple-price endpoint for every crypto id" (URL `ids=bitcoin,ethereum,tether`) and "returns one <crypto>->USD
      entry per coin" (the 3-coin body); `coingecko-history.test.ts` "throws only when every coin request fails"
      (the other curated coins would answer `ok` with no prices, so it would resolve). Re-grep every
      `fetchCryptoPrices(`/`fetchCryptoHistory(` call without a `currencies` argument in `src` and pass the list
      where the result depends on it.
- [ ] "was:" pins of the frozen 1.0 list and the picker: `0044-move-crypto-cash-holdings.test.ts`
      `expect(['BTC', 'ETH', 'USDT']).toEqual(cryptoCurrencyOptions)` -> `toEqual(FROZEN_1_0_CRYPTO_CODES)` (the
      constant is added to `restore-snapshot.ts` in this step, exported, with no restore use yet);
      `holding-form.screen.test.tsx` "lists crypto currencies first when creating a crypto holding"
      `codes.slice(0, 4)` `['BTC','ETH','USDT','UAH']` -> `codes` (the mounted rows) equals the first 15 curated
      codes in the field's crypto order (`currency-field.component.tsx` sorts each group by its en `currencyNames`
      name, `localeCompare`; write the literal list). The picker `FlatList` mounts only `initialNumToRender={15}`
      rows in Jest, so UAH (after every curated coin) is never mounted; the crypto-then-UAH boundary stays pinned by
      `currency-field.component.test.tsx` "lists the crypto group before the fiat group when cryptoFirst is set"
      (small options list, unchanged).
- [ ] "was:" pins of the two suites that loop over the grown `currencyOptions`:
      `crypto-coverage.test.ts` "composes a convertible path from every crypto to every base currency"
      `for (const base of currencyOptions)` (rates for BTC/ETH/USDT only, so an unpriced curated coin as base fails)
      -> `for (const base of [...fiatCurrencyOptions, ...CRYPTO])` (every fiat base plus the three priced coins; the
      intent, every priced crypto reaches every base, stays); `rates.repo.test.ts` "chunks a full-sync batch under
      the SQLite bound-parameter limit, in one transaction" `toHaveLength(11_990)` (twice) and `toBe(11_990)` -> a
      `const pairCount = currencyOptions.length * (currencyOptions.length - 1)` used in all three asserts, and the
      `buildRates` header comment "110 currencies x 109 cross pairs each = 11,990 rows" -> "every ordered pair of
      `currencyOptions`" (no count). Re-grep test readers of `currencyOptions`, `cryptoCurrencyOptions`,
      `fiatCurrencyOptions`, `isCrypto`, `isFiat` in `src`, `e2e`, `drizzle`, `__tests__` on the base; the list is a
      floor. Readers that stay green unchanged: `amount-format.test.ts` (`it.each(currencyOptions)` round-trip and
      fraction-digit cases cover each new coin by design), `holding-currency.test.ts` (`toEqual(currencyOptions)`,
      derived), `rates-refresh.test.ts` "stores exactly one X:UAH row per priced currency" (fiat filter plus a
      literal 3-coin crypto list), and the fiat-only readers `fiat-rate-seed.test.ts`,
      `monobank-fiat-coverage.test.ts`, `currency-code.test.ts`, `history-backfill.test.ts`
      (`fiatCurrencyOptions`). A reader not on this list that goes red moves in this step.
- [ ] Code: `currencyOptions` spreads `...CURATED_COIN_CODES` after the fiat block (no literal duplicate);
      `CryptoCurrency = CuratedCoinCode`; `cryptoCurrencies`,
      crypto `currencyScale`, crypto `currencySymbol`, `cryptoCoinGeckoId` derived from `curatedCoins` (USDT's
      literal 8 from set 1 now comes from the registry, same value); `currencyNames.<CODE>` per coin (proper nouns
      per kiko-translator). Check `npx tsc --noEmit`, `npx jest src/currency src/rates src/i18n`. Commit
      `refactor(currency): derive the crypto lists and names from the registry`.

### step 4/10: 0044 stays frozen on restore

Files: `restore-snapshot.ts`, `drizzle/migrations/0044-move-crypto-cash-holdings.test.ts`,
`restore-crypto-cash.two-path.test.ts`.
- [ ] Tests first: "moves only the 1.0 crypto codes" (a `cash` USDC holding stays `cash`); in the 0044 test, "the
      restore's frozen list equals the migration's IN list" (reads the `.sql`).
- [ ] Code: `withCryptoCashHoldingsMoved` uses `FROZEN_1_0_CRYPTO_CODES` (step 3) instead of `!isFiat`. Commit
      `fix(data-transfer): keep the frozen 1.0 crypto list on restore`.

### step 5/10: restore refuses an unknown currency code (NR9 a)

Files: `restore-snapshot.ts`, `restore-snapshot.test.ts` (or a new `restore-unknown-currency.test.ts`),
`import-data.screen.tsx`, its test, `en.ts`, `uk.ts`.
- [ ] No "made by a newer Kiko" key exists on the base (`settings.dataImport.*Error` keys: `invalidFileError`,
      `keyTooShortError`, `noFileError`, `wrongFileTypeError`, `wrongKeyError`; re-grep), so one new key.
- [ ] Tests first: "refuses a backup with a currency code this build does not know and writes nothing" (a
      holding in `'XYZ'`: rejects with prefix `data-transfer/unknown-currency`, every table equal to before); the same
      for a price point, a rate pair, the base currency setting, an amount matcher `currency`, a template
      `draft.currency` and `draft.exchange.destinationCurrency` (`it.each`); "refuses a code that is an inherited
      object name" (a holding in `'constructor'`: the same refusal); "restores a matchers text that is not
      JSON as today" (the unknown-code check reads only parsed JSON); import screen: "shows the newer-Kiko message
      for an unknown currency".
- [ ] Code: the check runs first in `restoreDataSnapshot`, before any mirror and before `readLiveDeviceSettings`;
      a code is known when `Object.hasOwn(currencyScale, code)` (or `isCurrency`), never `code in` (an inherited
      name such as `'constructor'` would pass); fields = every `{ enum: currencyOptions }` column of
      `src/db/schema.ts` (`holdings.currency`, rate and rate-history `base`/`quote`, `settings.base_currency`,
      `price_points.currency`; re-grep) plus the JSON currency fields above. If any committed fixture or demo file
      holds a code outside `currencyScale`, stop and report. `IMPORT_ERROR_KEYS` gains `['data-transfer/unknown-
      currency', 'settings.dataImport.unknownCurrencyError']`; the text says "export file", not "backup" (en.ts and
      uk.ts are the source: read the text there).
- [ ] Check: `npx jest src/data-transfer src/screens/settings src/i18n` green. Commit
      `feat(data-transfer): refuse a backup with an unknown currency`.

### step 6/10: CoinGecko price per coin (closes "crypto price all-or-nothing")

Files: `src/rates/coingecko/coingecko.ts`, `coingecko.test.ts`, `rates-refresh.ts`, its test.
- [ ] Tests first: "returns the priced coins when one coin is missing"; refresh "writes a UAH row per priced coin and
      none for the missing one".
- [ ] "was:" pin: `coingecko.test.ts` "rejects when any requested coin is missing a finite usd price" -> resolves
      with that coin absent (whole response failure still rejects); it passes `['BTC', 'ETH', 'USDT']` explicitly,
      as step 3's pins do. Code; check `npx jest src/rates`. Commit
      `feat(rates): price each coin on its own`.

### step 7/10: held coins only, and a concurrency cap on CoinGecko history (Q9, NR9 b)

Files: `src/rates/coingecko-history/coingecko-history.ts`, `coingecko-history.test.ts`, `history-backfill.test.ts`,
`rates-refresh.test.ts`.
- [ ] Q9 already holds on the base: callers pass the held codes (`open-currencies-gate.ts` `historyCurrencies`,
      `rates-refresh.ts`); the `currencies = cryptoCurrencyOptions` defaults of `fetchCryptoPrices` and
      `fetchCryptoHistory` stay (the default-call pins moved to explicit lists in step 3). Pin it
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

Files: `currency-field.component.test.tsx` (code needs none: `holding-currency.ts` derives; re-grep; the holding
form's picker pin moved in step 3).
- [ ] "was:" pins: `currency-field.component.test.tsx` test "groups crypto (BTC, ETH, USDT) after every fiat
      currency..." (`options: ['USDT', 'UAH', 'ETH', 'BTC']`) -> `options: [...cryptoCurrencyOptions, 'UAH']`; the
      picker mounts only `initialNumToRender={15}` rows in Jest, so the pin is the 15 mounted labels: UAH, then the
      first 14 curated codes in en name order (literal list; the fiat-then-crypto boundary falls inside the 15 rows);
      base-currency setting test "offers fiat only" kept or added. Commit
      `test(forms): the holding picker lists every curated coin`.

### step 9/10: demo seed

Files: `e2e/screenshot/fixtures/build-demo-snapshot.ts`, `build-demo-snapshot.test.ts`, both demo `.kiko`.
- [ ] Test first: "the demo crypto account holds at least five curated coins, a UAH and a EUR holding, one coin with a
      dated price history". Code; `KIKO_REGEN_DEMO=1` regen. Commit `chore(demo): curated coins in the demo`.

### step 10/10: reviews and skill text

- [x] Translator review of the coin names and `settings.dataImport.unknownCurrencyError` (reviewer + user before
      deploy).
- [x] kiko:scribe: `kiko-domain` scale text -> pointer to `curatedCoins` and `coinScale`; `kiko-pricing` CoinGecko
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

Files: `exchange/budget/` (`RunBudget<Lane, Cost, Weights>`, `RequestGate`, `createExchangeRun`), Binance numbers and weight
headers stay in `binance.history-budget.ts`; `binance.history-depth.ts` functions -> `src/crypto-sync/exchange/walk/
depth.ts` (exported by a new `exchange/walk/index.ts`), its constants -> `BINANCE_DEPTH_CONFIG: DepthConfig` in
`binance.depth-config.ts`; the depth config travels on `DepthMemory.config` and `DepthGuard.config` (`DepthConfig = { resolutionMs; marginMs; marginCapMs; extrapolationMaxMs; maxRefusals;
maxLapses }` from `DEPTH_RESOLUTION_MS`, `DEPTH_MARGIN_MS`, `DEPTH_MARGIN_CAP_MS`, `DEPTH_EXTRAPOLATION_MAX_MS`,
`MAX_DEPTH_REFUSALS`, `MAX_DEPTH_LAPSES`; re-grep the exported constants), passed to the moved functions; importers (`binance.history-paging.ts`,
`binance.transfer-history.ts`, `binance.depth-test-fixtures.ts`) import through `@kiko/crypto-sync/exchange/walk`.
- [ ] Today's budget and depth suites green unchanged (depth tests stay in `binance/`); `check:feature-imports --tree`
      clean. Commit `refactor(exchange): budget shape and depth functions`.

### step 5/9: amounts unit (no production caller yet)

Files: `exchange/amounts/amounts.ts`, `index.ts`, `amounts.test.ts`.
- [ ] Signature: `exchangeMinorUnits(currency: Currency, text: string, use: 'balance' | 'row'):
      Either<AmountError, number>`. `'balance'` rounds half away from zero past the scale and logs
      `balance-precision-rounded`; `'row'` refuses past the scale (`amount-precision`) unless the coin is
      reduced-scale, where it rounds and logs `row-precision-rounded`; both refuse an exponent form
      (`amount-malformed`) and a result above the safe integer (`amount-too-large`). The tags are fixed text, no amount.
- [ ] Tests first (the test imports the unit through `'.'`; an alias into its own feature is denied):
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
- [ ] Code: the moved units are `fetchAllByTotal`, `readSeriesSpan` and `TotalPage<Row, Weights>` (no `Pager` or
      `offsetPager` exists); it imports `halfOf`, `WalkWindow` and the depth functions from `../walk`; the body
      reads `config.totalPageSize`, `config.isRateLimitError(error)`, `config.refusedCallWeights` and, as
      `depth.config.*` on the `DepthGuard`, `resolutionMs`, `maxLapses` and `maxRefusals` where it read `HISTORY_TOTAL_PAGE_SIZE`,
      `instanceof BinanceRateLimitError`, `REFUSED_CALL`, `DEPTH_RESOLUTION_MS`, `MAX_DEPTH_LAPSES` and
      `MAX_DEPTH_REFUSALS` (today imported from `binance.history-depth`; no value import of `binance/` stays); `onRateLimit` is typed `(error: RateLimitError) =>
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

## Set 4: `crypto-exchanges-1.3-a task 4/15` (walk state to `sync_state`, 0061)

Spec ids: Z1-Z6, X1-X4, walk properties at 0 / 1 h / 1 day, C-NR8 (list shape). Expected mutable files: about 18.
TIMEOUT-HEAVY risk: none app-wide; the walk files have large related-test fan-out: name proofs if flagged.

First commit: deferred set 3 Minors: drop `ExchangeWalkConfig.depth` (`walk-config.ts`,
`binance.walk-config.ts`, its test; fix the walk-config doc comment); retitle `binance.walk-config.test.ts`
"carries today asset…" (no relative-time wording).

Known red between commits: none (0061's version decision lands with 0061 in step 2).

**Interfaces produced:** `ExchangeState`, `WalkMarks`, `WalkId`, `CoinLists` (spec section 2) and
`parseExchangeState(text: string | null): ParsedExchangeState` in `src/crypto-sync/exchange/walk-state/`;
`syncStateRepo.patchExchangeState(accountId, exchangeId, patches: readonly ExchangeStatePatch[])` and
`syncStateRepo.resetExchangeStateDatabaseTransaction(databaseTransaction, accountId, exchangeId, floorMs)`, called
by `accountsRepo.disconnectExchange(accountId, exchangeId, floorMs)` (ONE write: reset, then the institution clear);
the walk deps seam `ExchangeStateDeps =
{ readExchangeState: (accountId: string) => Promise<string | null>; patchExchangeState: (accountId: string, patches:
readonly ExchangeStatePatch[]) => Promise<void> }` (replaces `BinanceWalkWriteDeps` in step 5); test helpers in
`src/test-support/walk-marks.ts`: `walkMarksOf(database | rows, accountId, walkId)`, `withWalkMarks(seed,
accountId, walkId, marks)`, `expectWalkMarkWritten(deps, accountId, walkId, field, value)`,
`walkMarkWritesOf(deps, walkId, field)` (the written values in call order), `walkStateFake(world)`.

### step 1/10: test-only helper commit (Q11)

Files: `src/test-support/walk-marks.ts` (new; `test-support/**` is already `TEST_ONLY`), the 19 test files that
read, seed or assert the 24 old keys (re-grep `binance(History|Pay|Transfer|Earn)(HistoryCursor|Cursor|
PendingOverlap|PointCursor|RangeCursor|RescanCursor|SpanHints)` and the `BINANCE_*_FIELD(S)` / `setBinanceWalk*` /
`resetBinanceWalkCursors` names in tests: 18 files by key text plus `binance.history-walk.properties.test.ts`),
including `holding-metadata.test.ts`, `holdings.repo.history-cursor-account-gate.test.ts`,
`holdings.repo.walk-owned-metadata.test.ts`, `binance.earn-test-fixtures.ts`; and the two Earn suites that reach the
keys only through `SPOT_FIELDS` or the writer seams, `binance.earn-history.test.ts` and
`binance.earn-history.rewards.test.ts` (re-grep `SPOT_FIELDS|writeWalk(Cursor|Pending|Hints)` in tests).
- [ ] No app change. Every seed and read goes through `withWalkMarks`/`walkMarksOf`; every writer-call assertion
      (`deps.writeWalkCursor` / `writeWalkPending` / `writeWalkHints` `toHaveBeenCalledWith` and
      `toHaveBeenLastCalledWith`: about 62 in `binance.transactions.test.ts`, 39 in `binance.pay-history.test.ts`, 4
      in `binance.transfer-history.test.ts`; re-grep) goes through `expectWalkMarkWritten`; the stateful fakes
      (`binance.transactions.test.ts`'s writer fakes, `binance.earn-test-fixtures.ts`'s `writeWalkCursor` /
      `writeWalkPending` / `writeWalkHints` world fakes, and the inline writer fakes of `binance.pay-history.test.ts`
      and `binance.transactions.test.ts`) go through `walkStateFake`; every raw read of a writer mock goes through
      `walkMarkWritesOf` or `expectWalkMarkWritten`: the 26 `writeWalk*.mock.calls` reads (13 in
      `binance.transactions.test.ts`, for example the `writeWalkCursor` filter helper near the top and the
      `account.writeWalkPending.mock.calls[0]` / `[1]` checks; 11 in `binance.pay-history.test.ts`; 1 in
      `binance.earn-history.test.ts`, "stores the end of the window of each owed day it read, under the Earn range
      cursor"; 1 in `binance.transfer-history.test.ts`, its `writesTo` helper), plus the `toHaveBeenCalledTimes` /
      `not.toHaveBeenCalled` / `mock.invocationCallOrder` reads of the writers (re-grep
      `writeWalk(Cursor|Pending|Hints)[^(]*\.mock\.|writeWalk(Cursor|Pending|Hints)\)\.(not\.)?toHaveBeenCalled`
      per file and quote the counts). Today the helper maps (walk id,
      field) to the metadata key on the Spot holding and to today's writer; step 5 changes only the helper.
- [ ] Check: every touched suite green, same test and assertion counts; dup.sh alone per touched file. Commit
      `test(binance): one helper for walk marks`.

### step 2/10: schema, 0061 and its version decision (Z1-Z5)

Files: `src/db/schema.ts` (`syncState.exchangeState: text('exchange_state')`), `npx drizzle-kit generate --name
exchange_state` -> `0061_exchange_state.sql` + snapshot + journal + `migrations.js` (re-check the file after generate; biome
write), the hand-appended copy, `drizzle/migrations/0061-exchange-state.test.ts` (new),
`src/data-transfer/crypto/envelope.test.ts`, both demo `.kiko` files.
- [ ] Tests first (real sqlite through 0061): "creates the state row for an account with walk keys and leaves its
      stamps null" (Z1); "copies a disconnected account's floor values as stored" (Z2); "copies every walk field into
      its walk entry" (Z3, field map pinned as a table); "a walk with only a cursor copies no other field" (the
      entry has `cursor` only: no `null` siblings); "skips an account whose metadata is not JSON and still succeeds"
      (Z4); "copies a malformed pending value as stored" (Z5: a string, a boolean and an object `pending`; each reads
      back with its own `json_type`: `text`, `true`, `object`); "keeps a list a list" (`"[1]"` text stays text,
      `[1]` stays an array); "takes the walk state from the first Spot BTC holding" (two Spot BTC holdings with
      different cursors: the one first by `(sort_order, created_at)` wins, as the walk reads it); "reads only the
      first Spot BTC holding, even when it has no walk key" (the first Spot BTC holding with no walk key, a second
      one with a cursor: no state row, no copy); "a Spot BTC holding with no walk key adds no row"; "copies no walk
      key from a Funding holding" (`binanceAsset` `'BTC:funding'` with a cursor: no row); "an account whose
      state row only carries walk state reads as never synced" (grep every `syncStateRepo`/`syncState` reader for
      row-existence checks first and list them in the commit body).
- [ ] Code: `ALTER TABLE sync_state ADD exchange_state text;` then one statement that ranks first and requires a
      walk key after (the walk reads the first Spot BTC holding even when it has no key), each walk entry a
      `json_group_object` over the fields present, the entries joined through `json(entry)` (without it an entry
      is stored as quoted text). Probed on `node:sqlite` 3.50.4 (map cut to 7 rows there; the file lists the 24):
      ```sql
      WITH walk_key_map (walk, field, path) AS (VALUES ('capital', 'cursor', '$.binanceHistoryCursor'), ...),
      first_spot_btc AS (
        SELECT account_id, metadata FROM (
          SELECT account_id, metadata,
            ROW_NUMBER() OVER (PARTITION BY account_id ORDER BY sort_order, created_at) AS position
          FROM holdings
          WHERE CASE WHEN json_valid(metadata) THEN json_extract(metadata, '$.binanceAsset') END = 'BTC')
        WHERE position = 1),
      walk_entries AS (
        SELECT first_spot_btc.account_id AS account_id, walk_key_map.walk AS walk,
          json_group_object(walk_key_map.field, json(CASE WHEN json_valid(first_spot_btc.metadata)
            THEN first_spot_btc.metadata -> walk_key_map.path END)) AS entry
        FROM first_spot_btc, walk_key_map
        WHERE CASE WHEN json_valid(first_spot_btc.metadata)
          THEN json_type(first_spot_btc.metadata, walk_key_map.path) END IS NOT NULL
        GROUP BY first_spot_btc.account_id, walk_key_map.walk)
      INSERT INTO sync_state (account_id, exchange_state)
      SELECT account_id, json_object('version', 1, 'walks', json_group_object(walk, json(entry)))
      FROM walk_entries GROUP BY account_id
      ON CONFLICT(account_id) DO UPDATE SET exchange_state = excluded.exchange_state;
      ```
      An account whose first Spot BTC holding has no walk key has no `walk_entries` row, so no state row. Ties on
      `(sort_order, created_at)` stay in the order the engine returns them, as the walk's `listByAccountQuery`
      does: no `id` tiebreak on either side, and no test seeds a tie. Never `json_extract` into `json_object` (an
      absent key writes `null`; a string becomes unquoted text; `true` becomes 1).
- [ ] Version decision in the same commit, so `envelope.test.ts` "has a version decision for every migration" is
      never red: `VERSION_DECISIONS` gains the reason "Through <0061 tag>, a nullable column riding inside the sync
      state row, derived on restore: an older build drops the key and its walks read from their floors, where keys
      dedupe; so it needed no bump." -> `{ version: 4, migrationCount: 62 }` ("was:" `migrationCount: 61`).
      `generate-demo-kiko.test.ts` has no red window: it compares the files with `EXPORT_VERSION` (still 4) and
      `buildDemoSnapshot` (its `syncState` is `[]` and it builds no Binance holding; re-grep), neither of which this
      set changes; the demo files are regenerated here (`KIKO_REGEN_DEMO=1`, then the plain run green), as the spec
      ties the regeneration to the decision commit.
- [ ] Commit `feat(db): walk state column on sync_state`.

### step 3/10: per-walk parse (X1 parse side, Z5 parse side, C-NR8 lists)

Files: `exchange/walk-state/walk-state.ts`, `index.ts`, `walk-state.test.ts`.
- [ ] Tests first: top level malformed (not JSON, wrong version) -> `malformed`; each walk field parsed by today's rule
      (`binanceWalkCursorOf`, `readPendingMark`, `readRoundRobinCursor`, `readSpanHints`; re-grep each), a malformed
      field never empties its siblings; a non-object walk entry reads as empty values with the walk tag; `trades` and
      each of the four coin lists (`untrackedCoins.balance`/`.history`, `oversizedCoins.balance`/`.history`) parse
      alone. The cases of `holding-metadata.test.ts` describes "the Binance walk cursors", "the Binance pending
      overlap lists", "the Binance point cursors", "the Binance range cursors", "the Binance span hints" and "the six
      keys of the Binance Earn walk" move here (same inputs, read from a walk entry). Commit
      `feat(exchange): parse walk state per field`.

### step 4/10: gated writers (X2-X4, C-NR8 union)

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
      patch. `resetExchangeStateDatabaseTransaction` inside `accountsRepo.disconnectExchange`'s single
      write: gated by the institution before the clear, it replaces the whole column with `{ version: 1, walks }`
      (capital `{ cursor: floor }` on a corrupt capital entry or a malformed top level): in each parsed walk entry
      (none for a malformed column) a stored `cursor` or `rescan` becomes the floor and a stored `pending` becomes
      `[]` (today's `withWalkOwnedMetadataResetToFloor` rule); point/range cursors, span hints, trades and both coin
      lists of each kind are removed. Commit `feat(sync-state): gated exchange state writers`.

### step 5/10: walks, disconnect and the caption read `exchange_state`; helper switched

Files: walk readers/writers (`binance.walk-write-deps.ts`, `binance.history-walk.ts`, `binance.transactions.ts`,
pay/transfer/earn walk entry points), `holdings.repo.ts` (`setBinanceWalkCursor`, `setBinanceWalkPending`,
`setBinanceWalkSpanHints`, `resetBinanceWalkCursors` removed; `carriedMetadataKeys` stops carrying the 24 keys),
`holding-metadata.ts` walk readers removed or moved, `src/crypto-sync/disconnect/disconnect.ts` and its test,
`binance-history-status.ts`, `crypto-sync-section.component.tsx`, their tests, `src/test-support/walk-marks.ts`
(now seeds/reads `exchange_state` and asserts `patchExchangeState` calls), retired suites, and residue edits in
`binance.pay-history.real-sqlite.test.ts`, `binance.pay-history.test.ts`, `binance.transactions.test.ts` and
`restore-snapshot.test.ts`. Note: `readPendingMark`'s `hasKnownSeries` runs on the PARSED pending list.
- [ ] One commit, because removing `resetBinanceWalkCursors` and its caller in `disconnectCryptoAccount` together
      keeps the typecheck green.
- [ ] Tests first: "reads back every BTC walk mark equal to the old metadata" (Z3 read-back through the parse, all
      four passes of span hints); disconnect: "resets the walk state and clears the institution in one write, then
      clears the key" (order: `accountsRepo.disconnectExchange(accountId, 'binance', HISTORY_FLOOR_MS)` (one write),
      `clearCredentials`); holdings and rows stay; caption: "hides the
      caption when the state row's cursors are current and the metadata keys are gone".
- [ ] Code: `BinanceWalkWriteDeps` becomes `ExchangeStateDeps`; walks read their marks from the parsed state and
      write through `patchExchangeState`. `walkCursorsOf` and `transferOwesRange` read the parsed state from
      `useLiveQuery(syncStateRepo.getQuery(account.id), ['sync_state'])` in `crypto-sync-section.component.tsx`
      (the call site that passes `walkCursorsOf(holdings)` / `transferOwesRange(holdings)` to
      `isBinanceHistoryBehind`), in the same commit as the walks. The caption gates on that query's `isLoading`,
      as `bank-sync-section.component.tsx` does with `syncStateLoading`: no caption while the state row loads. Test:
      "shows no caption while the state row is loading" (the live query mocked loading, cursors behind).
- [ ] Retired suites: `holdings.repo.history-cursor-account-gate.test.ts` (cases moved to step 4 and the disconnect
      test); `holdings.repo.walk-owned-metadata.test.ts` walk-key carry cases (replaced by "a balance-sync upsert
      drops the old walk keys"); the walk-key describes of `holding-metadata.test.ts` (moved in step 3). The commit
      body lists each retired case and its new home. Then the full binance suites green with the switched helper.
      Commit `feat(binance): walk state lives in sync_state`.

### step 6/10: malformed state pauses history, balance still syncs (X1, paused caption)

Files: run wiring (`run-crypto-sync.ts` / `binance.transactions.ts`), `binance-history-status.ts`,
`crypto-sync-section.component.tsx`, its test, `en.ts`, `uk.ts`.
- [ ] Tests first: "writes the balance and runs no history walk on a malformed state" (tag `exchange-state-malformed`
      logged once, nothing written to the column); "shows the paused caption" (`accountDetail.exchangeHistoryPaused`
      with `exchange: 'Binance'`). Key en "{{exchange}} history import is paused because Kiko could not read its saved
      import progress. Disconnect and reconnect {{exchange}} to repair it; your holdings and transactions stay."; uk
      «Імпорт історії {{exchange}} призупинено, бо Кіко не зміг прочитати збережений прогрес імпорту. Відʼєднайте й знову
      підключіть {{exchange}}, щоб це виправити; ваші активи й транзакції залишаться.» Commit.

### step 7/10: restore mirror (Z6)

Files: `restore-snapshot.ts` (`withWalkStateMoved`), `restore-walk-state.two-path.test.ts` (new).
- [ ] Tests first: "a backup without walk state restores equal to the migrated database" (Z1-Z5 seeds, the
      two-Spot-BTC-holding seed, the only-a-cursor seed, the first-holding-without-a-key seed (no row on either
      path) and the Spot-BTC-holding-without-a-key seed (no row on either path)); "adds a state row when the backup has none" (Z6); "a
      backup with walk state restores it unchanged"; "an implicit-account merge keeps the merged account's walk
      state".
- [ ] Code: `withWalkStateMoved` runs after `withImplicitAccountsMerged`, on its `syncState` output and on
      `holdingsAfterImplicitMerge`; it ranks first and requires a walk key after, as 0061 does: the first Spot BTC
      holding per account by a stable sort on `(sortOrder, createdAt)` (no `id` tiebreak), the one the walk reads,
      and no row when that holding has no walk key; it copies only present fields (the 0061 rule). Commit.

### step 8/10: walk properties at three clock gaps

Files: `binance.history-walk.properties.test.ts` (has `RUN_GAPS = [0, HOUR_MS, DAY_MS]`; re-grep).
- [ ] Every property runs on the `exchange_state` store at each gap; add "a patch never loses another walk's marks
      across runs" at the three gaps. Commit.

### step 9/10: reviews

- [ ] `kiko:reviewer` on 0061 before BATCH READY (top question: "can any walk mark be lost, doubled, retyped or
      misread between migration, restore, parse and writer, or read from a holding the walk does not read?"; queries
      touching `sync_state`; no index -> no EXPLAIN test).
- [ ] Translator review of `exchangeHistoryPaused` (en + uk); diff to the coordinator for the user.

### step 10/10: skill text (kiko:scribe)

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

Files: `binance.provider.ts` (`sumAmounts` and `amountMinorUnits` replaced `sumSatoshis` and
`Money.fromMajor(BINANCE_ASSET, Number(...))`), tests.
- [ ] Every balance goes through `exchangeMinorUnits(currency, text, 'balance')` (half away from zero past the scale,
      tag `balance-precision-rounded`), and only after the LD* skip and the not-tracked filter (a malformed balance of
      an untracked coin never fails anything).
- [ ] Tests: A1 `"0.00012345"` -> 12345 (same); A3 `"1e-8"` on Funding or Earn -> that wallet keeps its last good
      balance ("was:" 1); A3 on Spot -> the refused coin is skipped alone (the sync does not fail; the Spot BTC
      anchor rule is in spec section 4; "was:" 1); A4 JSON number `0.5` via `decimalFromJsonNumber` -> 50000000
      ("was:" refused: only a string was read); "rounds a balance with
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
      kept. "was:" pins: default names `'Binance Spot'`/`'Binance Funding'`/`'Binance Earn'` in test files (c74936e8
      touched 10: 8 pin produced names, the others are input fixtures; re-grep `WALLET_HOLDING_NAMES` and the literals) -> `'Binance <Wallet> · <CODE>'`. Commit.

### step 6/10: not-tracked and oversized lines (H6, H12, N2 balance part, C-NR8)

Files: `exchange/history-status/` (`untrackedCoinsOf`, `oversizedCoinsOf`), `binance.provider.ts` (replaces the
not-tracked list `untrackedCoins.balance` as stored unless every wallet read, and the oversized list per wallet
(`oversizedBalance`, `balanceByWallet`) via `patchExchangeState`, spec section 4 "Not-tracked coins"; on a first
connect `ProviderRead` and `runBinanceSyncAndImport` write the lists after the institution is set, under
`logOnFailure('[binance sync] balance lists failed')`), `crypto-sync-section.component.tsx`, `en.ts`, `uk.ts`, tests.
- [ ] Keys `accountDetail.untrackedCoins`, `accountDetail.oversizedAmount` with the spec section 10 en/uk text.
      Tests first: "lists PEPE as not tracked"; "skips the write and shows the oversized line above the safe bound";
      "shows the sorted union of the balance and history lists without duplicates" (balance [PEPE, ABC], history
      [PEPE, XYZ] -> "ABC, PEPE, XYZ"); "a good balance read replaces only the balance list" (history [XYZ] kept);
      "a balance read with a failed wallet keeps the not-tracked list" (untracked balance [PEPE] stored; the Funding
      read fails and Spot lists ABC: the list stays as stored; the oversized list is patched per wallet, a failed
      wallet keeping its array; the acceptance pin was renamed, coordinator-approved);
      "leaves out a ticker the tracked rule accepts now" (`untrackedCoinsOf(state, isTracked)` over balance [PEPE,
      USDC] and history [XYZ, DAI] -> [PEPE, XYZ]). `oversizedCoinsOf` keeps its union as is (every oversized ticker
      is a tracked coin, so dropping tracked coins would empty it).
- [ ] Code in this order: (1) the balance-list replace with no wallet gate (every balance read patches both
      lists); run the tests and show "a balance read with a failed wallet keeps both balance lists" red against it
      (quote the failure in BATCH READY); (2) add the gate (patch only when every wallet read succeeded); all green.
      Check `npx jest src/crypto-sync src/screens`. Commit.

### step 7/10: Binance public price fallback

Files: `src/rates/binance-market/` (new; `klines` with `limit=1`, accepted only for today's UTC candle, on the pinned host, no key), `rates-refresh.ts`,
`history-backfill.ts`, tests.
- [ ] Tests first: "prices a coin CoinGecko missed through its USDT symbol and USDT's price"; "prices USDT through
      EURUSDT and the EUR anchor when USDT is unpriced"; "never assumes 1:1"; "one coin missing from both stays out of
      net worth"; no key header sent. `check:plist` unchanged (no new host). Commit.
- [x] Release hold (C2): LIFTED by the user ruling 2026-10-18 on two conditions (no Binance logo in the app or
      metadata; the fallback stays fail-soft) and with no device-region check; the terms facts and the ruling are
      in the spec's "API terms gate" C2 note. BATCH READY cites the ruling instead of a hold.

### step 8/10: privacy wording (Q10)

Files: `docs/privacy-policy.en.md`, `docs/privacy-policy.md`, `docs/privacy-site/en.html`, `docs/privacy-site/index.html`.
- [ ] Spec section 9 "Privacy policy, price fallback" text (the Binance bullet names the market symbol and the dates
      of the prices it needs), same commit for all four. The effective date is 18 October 2026; re-date it to the
      publish day when gh-pages goes out later. Commit.

### step 9/10: reviews

- [ ] Translator review of the two new keys and the uk privacy text; the reviewer checks each label at its screen.
- [ ] App Privacy label review (C1): the reviewer checks the App Store Connect App Privacy answers against the new
      price-fallback request, and the coordinator records the result in
      `/Users/drizzer14/Developer/Projects/pff-ios/memory/refs/resubmission-kit.md` section D (the user-side
      pre-submit checklist).

### step 10/10: skill text (kiko:scribe)

- [ ] `kiko-architecture` "Binance exchange sync" (the false "all three SAPI reads send `asset=BTC`" line, keys, names), the sync lines on crypto upserts
      (re-grep "every crypto/exchange holding a `runBalanceSync` upserts" and the "crypto balance + Binance transaction
      import" line); `kiko-compliance` Binance bullets (privacy-site files, the market-data terms hold); pointers only.

---

## Set 6: `crypto-exchanges-1.3-a task 6/15` (account-wide walks; 6a matcher filter first)

Refreshed 2026-10-19 against `1eb08738` (set 5 merged). Spec ids: S1-S3 (6a); Y1-Y8, E1-E2, W1-W2, A1-A4 (rows),
N2 (Pay part), C-NR8 (history lists), BTC key byte identity, key uniqueness property, walk properties at 0 / 1 h /
1 day. Change set name: `crypto-exchanges-1.3-a task 6/15`; steps "step N/13". Every symbol below was re-grepped at
`1eb08738`; every count is a floor: **the developer re-greps every fact on the actual base.**

Done by sets 3-5 (no set 6 work):
- `ExchangeWalkConfig` (`exchange/walk/walk-config.ts`) and `BINANCE_WALK_CONFIG` exist (set 3; `depth` dropped in
  set 4). `btcSatoshis` lives in `binance.amounts.ts` (set 3), not in the walk.
- The history-list patch exists: `ExchangeStatePatch` `{ kind: 'coinList', coins: 'untrackedCoins' |
  'oversizedCoins', list: 'history', tickers }` is a union write (`withCoinList`, `exchange-state-patch.ts`, set 4).
  The account detail already shows both lists (`untrackedCoinsOf(state, isTracked)`, `oversizedCoinsOf`, in
  `crypto-sync-section.component.tsx`, set 5). Set 6 adds no copy and no i18n key.
- The tracked rule `isTrackedBinanceAsset` (`binance.tracked-coin.ts`: curated crypto plus `BINANCE_FIAT_CODES`), the
  per-coin keys `holdingKeyOf(code, wallet)` / `partsOfHoldingKey(key)` and the name rule `coinHoldingName(code,
  wallet)` (`binance.holding-keys.ts`) exist (set 5). `WALLET_HOLDING_NAMES` already yields the set 5 names
  (`'Binance Funding · BTC'`).
- `records.ts` types a planned row's wallet as `string` (`WalletPlannedRow`); the four walk files still type it
  `BinanceWalletKey` (the three BTC keys), so steps 6-9 widen each walk to `holdingKeyOf(code, wallet)`.

History tracked rule (steps 2 and 6-9; the same rule as set 5's balances):
- A record whose ticker, upper-cased once where it is parsed, `isTrackedBinanceAsset` accepts is read strictly. A
  malformed, too-precise or oversized amount of such a record stops the walk at that record and owes its point: a
  tracked history record is never "skipped".
- A record in any other ticker is COUNTED for the pager, imported as no row, and its ticker is added to
  `untrackedCoins.history`. That is one `coinList` history patch per committed window, written after the window's
  rows and before its mark patch (in `commitSettledSpan`, between `add` and `advance`); a window with no such ticker
  writes none. A record whose ticker is blank or not text is an unreadable row (owed), never an untracked one.
- Never "curated" for history: the LD rule and the fiat codes are the balance rule's (`isTrackedBinanceAsset`).

Migrations: none. The new stored fields are JSON in `sync_state.exchange_state` (`multiCoinSince`, `multiCoinSeen`;
with Q1 = B also `balanceSyncedAt`), and a `.kiko` restores that column as stored text (set 4's restore mirror;
re-grep `restore-snapshot.ts`), so there is no version decision and no migration reviewer step. If a step ends up
needing a migration, it gets its own `kiko:reviewer` step before BATCH READY (and, for an index, an EXPLAIN QUERY
PLAN test).

Known red between commits: none; every commit is green (step 5/13 is one commit by rule).

Guideline 2.5.19: no flag and no hidden path; each step ships visible behaviour or none. The set merges as ONE unit
(the two gate halves below are scratch heads, never merged). Never merged or released apart:
- step 5/13 is one commit (the anchor and the four walk guards);
- step 4/13 and step 5/13 (if Q1 = B): without the stamp, an account with no tracked holding reads "Last sync:
  Never" once the anchor is gone;
- step 3/13 lands before any of steps 6-9 (a walk-created holding must be in the row's coin);
- steps 6/13-9/13 and step 10/13: a walk's first multi-coin run without `multiCoinSince` loses set 15's backfill
  range for that walk;
- step 1/13 lands no later than step 7/13 (S1: a non-BTC Pay send must not be consumed by the matcher). Step 1/13
  alone is safe to merge early.

Run-log gaps (`run-log.mjs stats --gaps --repo kiko`, read 2026-10-19):

| Gap | Set 6 |
|---|---|
| `20261017T1639-kiko-binance-backfill-fix/7`, `20261018T1637-kiko-harness-h9/2` (TIMEOUT-HEAVY from wide test coverage: `walk-values.ts`, `walk.ts`) | LEFT OPEN (harness). Steps 3 and 10 touch `walk.ts`, step 10 `walk-state.ts`/`walk-values.ts`: clear a TIMEOUT-HEAVY line with the per-mutant plain-jest proof (Gates section) |
| `20261017T1639-kiko-binance-backfill-fix/1` (the walk-state gate checks the institution, not the connection) | LEFT OPEN (later set, with its migration). Set 6's new patches go through the same gate: no new exposure |
| `20261015T1657-kiko-binance-backfill-fix/2` (no mechanized index check) | not applicable: no migration |
| every other open gap | LEFT OPEN, unrelated |

Gates (deltas to the common Gates section):
- Expected `make mutable` for the whole set: about 20-22 files and 1300-1450 changed lines (a floor; measure with
  `KIKO_MUTATION_BASE=<set base sha> make mutable`). Under the 30-file cap, but two deep-gate halves of about 700
  changed lines each (set 5's halves of 685 and 735 lines ran about 1 h 20 min each):
  - half 1: steps 1-6, base = the set 6 base, head = step 6/13's commit; about 16-18 files, 600-700 lines
    (`internal-transfers.ts`, `statistics.screen.tsx`, the four walk files, `records.ts`, `walk.ts`,
    `walk-config.ts`, `binance.walk-config.ts`, `binance.holding-keys.ts`, `binance.provider.ts`,
    `binance.history-client.ts`; with Q1 = B also `walk-state.ts`, `exchange-state-patch.ts`,
    `crypto-sync-section.component.tsx` and the list writer's file);
  - half 2: steps 7-11, base = step 6/13's commit, head = the set tip; about 10-12 files, 600-750 lines (the
    Pay, Transfer and Earn walk files, `binance.history-client.ts`, `binance.transactions.ts`, `walk.ts`,
    `walk-state.ts`, `walk-values.ts`, `exchange-state-patch.ts`, `records.ts`, `exchange/paging/paging.ts`).
  - BATCH READY quotes each half's printed list and `mutable files: N (cap 30)`. A half over 30 files, or far over
    800 lines: stop and report, never cut silently.
- Per-file floor: `statistics.screen.tsx` failed its floor in set 5 because `toMatchObject` with a Set is vacuous:
  assert ids with `toEqual(new Set([...]))` or membership.
- TIMEOUT-HEAVY risk: `walk.ts`, `walk-values.ts` (gaps above).

Pay funds rule for the pins below (spec section 5, R-Q7): one row per `fundsDetail` entry with a tracked
`currency` (`isTrackedBinanceAsset`), placed by today's rules applied to that coin's entries exactly as they apply to the BTC entries today
(`sharesOfSend`): by its `walletAssetCost` costs, or, when the coin has no cost entry, whole on the one wallet
`walletTypes` declares (`declared.length === 1`; with no or several declared wallets it stops
`pay-split-mismatch`). What a coin's placement must add up to:
- an order whose funds entries are all in its own coin, or that lists none, keeps today's comparison with the
  order amount;
- an order funded in a coin that is not its own, in one coin (cross-coin) or in several, compares each coin's
  costs, or its cost-less entries, with that coin's entry `amount` only.

### step 1/13 (6a): 2-minute matcher sees only unmarked rows (S1-S3)

Files: `src/statistics/internal-transfers/internal-transfers.ts` (pure helper `rowsForTransferMatch(rows)` beside
`internalTransferTransactionIds`; the input type `InternalTransferTransaction` gains the three nullable markers
`exchangePairId`, `exchangeCounterpartHoldingId`, `untrackedCounterpart`), `internal-transfers.test.ts`,
`src/screens/statistics/statistics.screen.tsx` (the `internalTransferIds` memo over `ledgerWithCurrency`).
- [ ] Tests first in `internal-transfers.test.ts` (not the 3232-line screen test): "a Pay send counts when the
      same-amount rows nearby are exchange legs" (S1); "a BTC Pay send counts beside a Transfer pair" (S2); "two
      unmarked opposite rows are still matched" (S3); one case per marker ("a row with only an exchange pair id is
      never a partner", and the same for each of the other two markers). Ids by `toEqual(new Set([...]))`, never
      `toMatchObject` on a Set. Keep `statistics.screen.test.tsx`'s matcher case and the growth/ratio performance
      pins of `internal-transfers.test.ts` (kiko-domain) as they are.
- [ ] S2 changes today's BTC behaviour: the commit message names the reversal (spec section 1).
- [ ] Check: `npx jest src/statistics/internal-transfers src/screens/statistics`. Commit
      `fix(statistics): exchange legs never consume an unmarked row`.

### step 2/13: row amounts through `exchangeMinorUnits` (A1-A4 rows)

Files: `binance.amounts.ts` (deleted with `btcSatoshis`), the amount helpers of the four walk files (capital
`plannedRowOf`; Pay `costsOf`, the cost-less funds sum, `payRowsOf`'s `Math.abs(btcSatoshis(order.amount) ?? 0)`;
Transfer's `btcSatoshis(record.amount)`; Earn `positiveSatoshis` and `splitSatoshis`), `TRANSFER_FORWARD_OWES`
(`binance.transfer-history.ts`), `EARN_FORWARD_OWES` (`binance.earn-history.ts`), `exchange/walk/records.ts` (the
history-list write), tests (`describe('btcSatoshis')` in `binance.history-walk.test.ts` goes with the helper).
- [ ] Every row amount goes through `exchangeMinorUnits(currency, text, 'row')`, `currency` = the record's coin (BTC
      at this step). A `Left` stops at that record with the parser's code (`amount-malformed`, `amount-precision`,
      `amount-too-large`), owed at its point. The three codes join `TRANSFER_FORWARD_OWES` and `EARN_FORWARD_OWES`
      (Q5 = A), so those lanes owe the point and pass it as their `*-amount-invalid` does today; capital and Pay keep
      the A2 stop. A sign or zero check keeps the walk's own code (`pay-amount-invalid`, `earn-amount-invalid`,
      `transfer-amount-invalid`).
- [ ] An `amount-too-large` stop also adds the record's ticker to `oversizedCoins.history` (C-NR8) through one
      `coinList` history patch, written when a span read sees the stop, committed or not (Q3 = A: a capital or Pay
      forward stop never commits its span, so a commit-only write would never show it).
- [ ] Tests first: A2 `"0.000000001"` -> stop `amount-precision`, owed point ("was:" 0); A3 `"1e-8"` -> stop
      `amount-malformed` ("was:" 1); A1 unchanged; A4 for rows: re-grep that the record readers take `amount` as
      `text` (`DEPOSIT_FIELDS`, `WITHDRAWAL_FIELDS`, `PAY_ORDER_FIELDS`, `TRANSFER_FIELDS`, the Earn fields), so a JSON
      number stays an unreadable row (no change, no "was:"); "an amount too large owes its point and adds its coin to
      the oversized history list" (a row of `"90071992.54740992"` BTC); "a transfer amount in exponent form owes its
      point and the cursor passes it".
- [ ] "was:" pins (each title re-grepped at `1eb08738`): `binance.pay-history.direction.test.ts` "stops on an amount
      that rounds to zero satoshis" (`'-0.000000001'`) -> `amount-precision`; "stops a send whose cost-less BTC funds
      entry is not a number" (`'lots'`) -> `amount-malformed`; "a cost that is not a number stops" (`'x'`) ->
      `amount-malformed`. Unchanged: "a negative cost stops" (`'-0.0005'` parses; `costsOf`'s sign check keeps
      `pay-amount-invalid`); a parsed zero amount keeps `pay-amount-invalid`; "row 13: the amount %p stops"
      (`payDirection` over `'0'`, `'0.0'`, `''`, `'  '`, `'abc'`, `'NaN'`, `'Infinity'`, `'-Infinity'`) stays `null`
      (`payDirection` is no amount parse; re-grep). The `btcSatoshis` cases move to `exchange/amounts/amounts.test.ts`
      only where that file does not already cover them.
- [ ] Check: `npx jest src/crypto-sync`, knip. Commit.

### step 3/13: walk-created holdings per coin; `WALLET_HOLDING_NAMES` goes

Files: `exchange/walk/walk-config.ts`, `exchange/walk/walk.ts` (`resolveWalletHoldings`), `binance.walk-config.ts`,
`binance.holding-keys.ts`, tests (`binance.walk-config.test.ts`, `binance.holding-keys.test.ts`, and every
`ExchangeWalkConfig` literal in tests: re-grep `asset:` in `binance.history-walk.test.ts`,
`binance.history-records.test.ts`, `binance.history-paging.test.ts`, `binance.depth-test-fixtures.ts`).
- [ ] Code: `ExchangeWalkConfig` replaces `asset` and `walletHoldingNameOf` with one
      `walletHoldingOf: (key: string) => { currency: Currency; name: string } | undefined`. Binance:
      `partsOfHoldingKey(key)` mapped to `{ currency: code, name: coinHoldingName(code, wallet) }`.
      `resolveWalletHoldings` creates a missing wallet holding from it; a key it names nothing for creates nothing
      and resolves to no holding. `WALLET_HOLDING_NAMES` is deleted; `coinHoldingName` stays the one name rule
      (`BINANCE_WALK_CONFIG` was its only production reader; knip).
- [ ] Tests first: "a walk-created USDT Funding holding is in USDT and named 'Binance Funding · USDT'"; "a
      walk-created BTC Funding holding keeps the key 'BTC:funding' and the name 'Binance Funding · BTC'"; "a key that
      names no tracked coin creates no holding" (`'PEPE:funding'`).
- [ ] "was:" pins: `binance.walk-config.test.ts` "carries the asset, metadata field, key reader, page size, refused
      weights and rate-limit check" -> renamed "carries the metadata field, key reader, page size, refused weights and
      rate-limit check" (no `asset` line); its `it.each` "names the holding of %s %s" -> reads `walletHoldingOf(key)`
      as `{ currency: 'BTC', name }`, plus a `'USDT:funding'` row; `binance.holding-keys.test.ts` "name the three BTC
      holdings "Binance <Wallet> · BTC", keyed by the three BTC keys" -> deleted with `WALLET_HOLDING_NAMES` (the
      `coinHoldingName` describe gains a BTC row).
- [ ] Check: `npx jest src/crypto-sync`, knip. Commit.

### step 4/13: the last balance sync is stamped in `exchange_state` (only if Q1 = B)

Files: `exchange/walk-state/walk-state.ts` (`ExchangeState.balanceSyncedAt?: number`; parsed: a non-finite value
reads as absent and is named in `unreadable`), `exchange-state-patch.ts` (patch kind
`{ kind: 'balanceSyncedAt'; value: number }`), the list writer (re-grep where `runBinanceSyncAndImport`
(`run-crypto-sync.ts`) writes the balance lists after the institution is set, under
`logOnFailure('[binance sync] balance lists failed')`; the stamp rides that write on every good Spot read),
`crypto-sync-section.component.tsx` (the "Last sync" line and `lastBalanceSyncAt` read the later of
`latestSyncedAt(holdings)` and the stamp), tests.
- [ ] Tests first: "shows the last sync time for a Binance account with no holding" (stamp T, no holdings -> T, not
      `accountDetail.never`); "shows the later of the holding stamp and the state stamp"; "a disconnect removes the
      balance sync stamp" (`exchangeStateReset` keeps walks only; pin it); the history caption reads the same value.
- [ ] Check: `npx jest src/crypto-sync src/screens/account-detail src/sync-state`. Commit. If Q1 = A or C, drop this
      step and renumber.

### step 5/13: the zero Spot BTC anchor and the four walk guards go (ONE commit)

Files: `binance.provider.ts` (the `!existingKeys.has(SPOT_KEY)` push of `holdingOf(BINANCE_ASSET, 'spot', 0)` and
its comment "Those walks and this anchor go together"), `binance.transactions.ts`, `binance.transfer-history.ts`,
`binance.pay-history.ts`, `binance.earn-history.ts` (each `spot === undefined ||` in the entry guard; the
credentials check stays), tests.
- [ ] Capital reads `spot` twice beyond its guard (re-grep `runSync`, `placeRows`, `WindowContext`):
      `latestTransactionTime(spot.id, ...)` is called only when a Spot BTC holding exists, else the legacy cursor is
      `undefined` (an account with no Spot BTC holding never ran the capital walk, so it has no legacy capital row;
      pin it). The stored-row placeholder (`stored.has(row.externalId) ? spot : undefined`) goes (Q4 = B): a row
      whose key is already stored and whose wallet has no holding is left out of the write (it is stored; it loses
      only a refresh of its bank-owned columns). `WindowContext.spot` goes.
- [ ] Red first, against the base code (quote the red counts in BATCH READY): "writes no zero Spot BTC holding for
      a sync with no Spot BTC" (no stored holding, Spot lists USDT 10 only -> keys `['USDT']`); "writes no zero
      anchor for a refused Spot BTC with no Spot BTC holding"; per walk, holdings `[]` and stored credentials:
      capital "imports a Spot deposit with no Spot BTC holding and creates it" (key `'BTC'`, name
      `'Binance Spot · BTC'`); Pay "imports a send with no Spot BTC holding and creates its wallet holding"
      (walletType 1 -> `'BTC:funding'`); Transfer "imports a Spot-to-Funding transfer with no Spot BTC holding" (both
      leg holdings created); Earn "imports a flexible reward with no Spot BTC holding" (`'BTC:earn'` created).
- [ ] "was:" pins (each title re-grepped at `1eb08738`; a floor, re-grep `anchor` and `no Spot` in test titles):
      - `binance.provider.test.ts` "writes the Spot BTC holding once on every good sync, with or without a stored
        one" -> renamed "writes the Spot BTC holding once on every good sync that reads or holds it" (no stored one
        and no BTC entry: no `'BTC'` key); "keeps the other Spot coins to the dust and absent rules beside the anchor"
        -> keys `['ETH']` ("was:" `['BTC', 'ETH']`), renamed without "beside the anchor"; "writes the zero anchor,
        never NaN, for a Spot BTC amount that is no number" -> no BTC balance written; "writes a zero anchor and the
        other coins when a Spot amount is in exponent form" -> the other coins only.
      - `binance.provider.coin-lists.test.ts` "an oversized Spot BTC writes the zero anchor; the other coins still
        write" -> `writtenKeys` `['USDT']`, oversized `['BTC']`; "logs it for the refused Spot BTC that gets the zero
        anchor too" -> one refusal line, no anchor.
      - `binance.transactions.test.ts` "does nothing when the account has no Spot BTC holding";
        `binance.pay-history.test.ts` "does nothing, and is complete, with no Spot holding or no credentials";
        `binance.transfer-history.test.ts` "does nothing for an account with no Spot holding or no credentials";
        `binance.earn-history.test.ts` "writes nothing for an account with no Spot holding or no credentials": the
        no-credentials half stays; the no-Spot half becomes the creation case above.
- [ ] Check: `npx jest src/crypto-sync src/screens/account-detail`. One commit
      `feat(binance): walks run without a Spot BTC holding; the zero anchor goes`.

### step 6/13: capital account-wide (W1, W2) and the untracked history list

Files: `binance.history-client.ts` (`capitalParams` drops `coin`; `coin` in `DEPOSIT_FIELDS` and
`WITHDRAWAL_FIELDS` goes from `textOrEmpty` to `text`), `binance.transactions.ts` (`plannedRowOf` upper-cases the
coin once and applies the history tracked rule; tracked: `exchangeMinorUnits(coin, ...)`, key
`holdingKeyOf(coin, wallet)`, `description` = the coin; `walletOf` returns a `BinanceWallet`),
`exchange/walk/records.ts` (`SettledSpan` carries the untracked tickers, joined by `joinSettled`;
`commitSettledSpan` writes the one history patch between `add` and `advance`), tests.
- [ ] Tests first: W1 "imports a USDT withdrawal as spending in the default category"; W2 "a hand-linked withdrawal
      stays excluded"; "keeps the BTC keys `${accountId}:deposit:<id>` and `:withdraw:<id>`"; USDT placement
      (walletType 0 -> `'USDT'`, 1 -> `'USDT:funding'`); "a deposit of an untracked coin is counted, imports no row and
      adds its ticker to the not-tracked history list" (a `PEPE` deposit beside a BTC one: one row; one `coinList`
      history patch `['PEPE']`, written before the window's cursor patch); "reads a lowercase coin upper-cased"
      (`'usdt'`); "a deposit with a blank coin is an unreadable row and owes its point".
- [ ] "was:" pin: `binance.history-client.test.ts` "keeps the capital reads on coin BTC with offset and limit 1000" ->
      "keeps the capital reads with offset and limit 1000 and no coin".
- [ ] Check: `npx jest src/crypto-sync`. Commit. (Gate half 1 ends here.)

### step 7/13: Pay any tracked coin, cross-coin, keys (Y1-Y8, N2 Pay part, C-NR8)

Files: `binance.pay-history.ts`, `binance.history-client.ts`, tests.
- [ ] Reader (`readPayItem`, `payPage`): an order is read strictly when its upper-cased `currency` or any
      `fundsDetail` entry's currency is tracked (Q2 = A); any other order is counted, imports no row, and its tickers
      go to the history list. The Ruling A machinery goes (knip): `BtcFundedOtherCoinOrder`,
      `btcFundedOtherCoinOrders`, `readOtherCoinItem`, `paidWithBtc`, `isReceivedBy`, `stopOnBtcPaidOrder`,
      `isBtcFunds` (replaced by per-coin funds), and the stops `pay-btc-funded-other-coin` and `pay-funds-not-btc`
      (spec section 5). A receive in an untracked coin imports no row and adds its ticker.
- [ ] Tests first per Y row; keys: BTC row of a BTC order byte-identical; others `...:${walletType}:${currency}`.
      N2 over two runs: "keeps a Pay-only untracked coin on the not-tracked line after the next balance read" (run N:
      balance list [PEPE], a Pay funds entry in XYZ adds XYZ to the history list; run N+1: the balance read writes
      [PEPE] again; the line shows "PEPE, XYZ" after each run).
- [ ] "was:" pins, each with its new value:
      - `binance.pay-history.test.ts` every `code: 'pay-btc-funded-other-coin'` stop; "stops the window, cursor
        unmoved, on a non-BTC order the user paid with BTC funds" -> one BTC Funding row (Y4), key
        `...:${walletType}:BTC`, cursor advances; "ignores a non-BTC order the user received though the payer paid
        with BTC funds" -> one receive row in the order's coin (Y6).
      - `binance.pay-history.direction.test.ts` (order: BTC, amount `'-0.001'`, `payOrder` default walletType 2 and
        walletTypes `undefined`; the "a single wallet" describe passes walletTypes `[2]`), each by the funds rule
        above:
        - "stops a send whose cost-less BTC funds entry is below the amount, the rest paid in another coin" (BTC
          0.0004 + USDT 40, cost-less, walletTypes `[2]`; several coins, each on the one declared wallet) ->
          renamed "places each coin of a send paid in two coins on the one wallet named", `toMatchObject([{ wallet:
          'BTC', amountMinorUnits: -40_000, externalId: 'acc-1:pay:C2C:tx-1:2' }, { wallet: 'USDT',
          amountMinorUnits: -4_000_000_000, externalId: 'acc-1:pay:C2C:tx-1:2:USDT' }])` (Y5);
        - "stops a send with no BTC funds entry at all and funds in another coin" (USDT 100, cost-less, walletTypes
          `[2]`; one coin not its own, on the one declared wallet) -> renamed "places a send paid in another coin on
          the one wallet named", `toMatchObject([{ wallet: 'USDT', amountMinorUnits: -10_000_000_000, externalId:
          'acc-1:pay:C2C:tx-1:2:USDT' }])` (Y4 shape, cross-coin);
        - "stops when the funds named are not BTC, so no BTC movement is guessed" (USDT 1, cost-less, walletTypes
          `undefined`; one coin not its own, no declared wallet) -> renamed "stops a send paid in another coin with
          no cost and no declared wallet", `pay-split-mismatch` ("was:" `pay-funds-not-btc`), not a USDT row;
        - unchanged, funded only in its own coin or in none: "stops a send whose cost-less BTC funds entry is below
          the amount, with no other coin listed" (`pay-split-mismatch`); "places a send whose cost-less BTC funds
          entry equals the amount, besides an entry of no cost" (one BTC row, -100_000); "takes the cost-less BTC
          funds entries together before it compares them with the amount" (one BTC row, -100_000); "stops a send
          with an empty funds detail, whatever the one wallet walletTypes names" and the three "stops a send with no
          cost when walletTypes is absent / empty / names two wallets" (`pay-split-mismatch`).
        The cross-coin `comment` is pinned by Y3 only.
      - `binance.history-client.test.ts` "returns the BTC orders only, and counts every order of the page" -> returns
        every order the tracked rule reads and counts every order; the six cases of `it.each` "does not fail the read
        for a non-BTC order with %s" -> a malformed USDT order is in `unreadable` and owes its point (`rows` only the
        BTC order, `unreadable` length 1, `gathered` 2), and the same six on an untracked-coin order (XYZ, funds in
        XYZ or none) are still ignored and counted, the page reporting `XYZ` for the history list; "lists the Binance
        ids of the parties of a non-BTC order that was paid with BTC funds" -> deleted with
        `btcFundedOtherCoinOrders` (the strict order reader reads the parties; the "returns every order" pin covers
        it); "reads a malformed fundsDetail of a non-BTC order as no BTC funds, never an error" -> a malformed
        `fundsDetail` of a USDT order makes the order unreadable (owed point).
- [ ] Q2 = A pins: "imports a send in an untracked coin paid in USDT as a USDT row" (order XYZ, funds USDT on the one
      declared wallet: one USDT row, key `...:${walletType}:USDT`, XYZ on the history list); "imports no row for a
      receive in an untracked coin and lists its ticker".
- [ ] Check: `npx jest src/crypto-sync`. Commit.

### step 8/13: Transfer account-wide

Files: `binance.transfer-history.ts` (the walk-level `record.asset !== BINANCE_ASSET` filter goes; wallet keys from
`holdingKeyOf(asset, wallet)`), `binance.history-client.ts` (`totalPage` takes its row filter per call:
Transfer's `transferPage` passes a tracked-row reader; a row whose upper-cased `asset` the tracked rule accepts is
read strictly; any other is counted, imports no row, and its ticker is reported for `untrackedCoins.history`; the
Earn page kept its BTC-only row reader until step 9 (it was removed in `1a938441`, when Earn took the tracked-row
reader), so no non-BTC Earn row reaches the BTC-only Earn walk at this step's tip), `exchange/paging/paging.ts` (`TotalPage` gains the reported tickers; re-grep
`fetchAllByTotal`), tests.
- [ ] "was:" pins (titles re-grepped at `1eb08738`): `binance.transfer-history.test.ts` "a row of another asset gives
      no row", "a transfer of another asset is ignored, and counted for the pager...", "an off-contract row of
      another asset does not stall the BTC rows of its page" -> a tracked asset imports on its own wallet holding,
      an untracked one is still counted and imports no row; `binance.history-client.test.ts`
      `describe('fetchUniversalTransfers')`: "parses the readable rows of a page beside an unreadable one and a row of
      another asset" -> the other tracked-asset row is parsed; "is counted for the pager and never parsed, whatever
      else is wrong with it" -> holds for an untracked asset only; a malformed tracked-asset row is unreadable and
      owes its point; "is told from a BTC row by its asset alone: a row with a lowercase btc asset is another asset"
      -> a lowercase `btc` row is read as BTC (asset upper-cased once). The Earn page pin "counts every row of the
      page, and parses only the rows of BTC" stays green here (Earn keeps its BTC-only row reader); it moves in step 9.
- [ ] Test first: "a transfer of an untracked coin is counted, imports no row and adds its ticker to the not-tracked
      history list" (a `PEPE` transfer beside a BTC one: one row, `untrackedCoins.history` gains `PEPE`).
- [ ] Check: `npx jest src/crypto-sync`. Commit.

### step 9/13: Earn account-wide, reward grouping per asset (E1, E2)

Files: `binance.earn-history.ts` (`rewardGroupsOf` keys a group by product, `ownerId`, `type`, `time` and `asset`;
`rewardGroupRowsOf` numbers per coin through `exchangeMinorUnits(asset, ...)`; subscription and redemption keys from
`holdingKeyOf(asset, wallet)`), `binance.history-client.ts` (`fetchEarnRecords` drops `asset: BINANCE_ASSET`),
`binance.earn-history.rewards.test.ts`, `binance.history-client.test.ts`.
- [ ] Tests first: E1 keys `...:0`, `...:1` unchanged; E2 BTC keys byte-equal to E1, USDT `...:0:USDT` (0.1),
      `...:1:USDT` (0.5); "an Earn record of an untracked coin is counted, imports no row and adds its ticker to the
      not-tracked history list" (a `PEPE` reward beside a BTC one: one row, `untrackedCoins.history` gains `PEPE`).
- [ ] "was:" pins: `binance.history-client.test.ts` "GETs %s with asset BTC, current and size 100, and no type" ->
      "GETs %s with current and size 100, no asset and no type"; "always sends type=ALL on the flexible rewards read"
      -> its expected query has no `asset`; "counts every row of the page, and parses only the rows of BTC"
      (`lockedRewards`, rows `{ asset: 'ETH' }` and a whole BTC row) -> renamed "counts every row of the page, and
      reads an incomplete row of a tracked coin as unreadable": `gathered` 2, `rows` length 1, `unreadable` length 1
      ("was:" `toEqual([])`); a second case with `{ asset: 'XYZ' }` keeps `unreadable` `[]`.
- [ ] Code: the Earn page passes step 8's tracked-row reader instead of the BTC-only row reader; that reader goes (knip; done in `1a938441`).
- [ ] Check: `npx jest src/crypto-sync`. Commit.

### step 10/13: `multiCoinSince`

Files: the four walk entry points, `src/crypto-sync/exchange/walk/walk.ts` (`advanceCursor`: the marker rides its
cursor patch), `exchange/walk-state/walk-state.ts` and `walk-values.ts` (`WalkMarks` and `ParsedWalkMarks` gain
`multiCoinSince?: number` and `multiCoinSeen?: true`; parse), `exchange-state-patch.ts` (`marksAfterDisconnect`
keeps only `cursor`, `rescan`, `pending` today: it also keeps `multiCoinSeen: true`), tests (incl.
`src/sync-state/sync-state.repo.test.ts`).
- [ ] Parse rule: a present but malformed `multiCoinSince` (not a finite number) reads as the walk entry's parsed
      `cursor` (absent when that cursor is null): fail-safe, it owes a range rather than none; a malformed
      `multiCoinSeen` (anything but `true`) reads as absent.
- [ ] Rule: on a walk's first run in this set's code, the walk writes `multiCoinSeen: true` whatever the cursor, and
      `multiCoinSince` = its PLAN cursor (capital: `cursor ?? latest ?? null` in `binance.transactions.ts`; the
      others re-grep their plan cursor) only when that is not null, both in the same `patchExchangeState` patch as
      the cursor write of the run's first committed window, never before a window commits. A run that commits no
      window writes neither, so the next run is again the first multi-coin run; so `multiCoinSeen` is never stored
      without a stored cursor, which a disconnect resets to the floor. A walk with `multiCoinSeen` never writes either
      again. Capital with a null stored cursor and a legacy `latest` records `latest`, so set 15's backfill covers
      `[floor, latest)`: no history skipped. The reset (`resetExchangeStateDatabaseTransaction`) removes `multiCoinSince` and keeps
      `multiCoinSeen: true` (the reset cursor is the floor, so every coin is read from it; nothing is owed).
- [ ] Tests first: "records the plan cursor at the first multi-coin run"; "records none when the plan cursor is
      null"; "a second run after a null-cursor first run records none"; "records the latest row time for capital with
      no stored cursor"; "a disconnect removes the marker's range and keeps it seen"; "writes the marker in the patch
      of the first committed window" (the first cursor patch carries `cursor`, `multiCoinSeen` and `multiCoinSince`
      together; no patch before it names either marker); "a disconnect before any capital window commit keeps the
      backfill owed" (capital with no stored cursor and a legacy latest row time L; the first multi-coin run stops
      before any window commits: neither marker is stored; the account disconnects (`accountsRepo.disconnectExchange`) and
      reconnects; the next run's first committed window stores `multiCoinSince` = L, so set 15 owes `[floor, L)`);
      "reads a malformed multiCoinSince as the stored cursor and a malformed multiCoinSeen as absent" (a walk entry
      with `cursor` C, `multiCoinSince: 'x'`, `multiCoinSeen: 'yes'` parses to `multiCoinSince` C and no
      `multiCoinSeen`; the same entry with a null cursor parses to neither).
- [ ] "was:" pins: `sync-state.repo.test.ts` "resets every walk to the floor, empties pending lists and removes the
      coin lists" (seed `transfer: { pointCursor: 5, multiCoinSince: 8 }` -> `transfer: {}`): add `multiCoinSeen:
      true` to a seeded entry with a cursor and expect it kept (`multiCoinSince` still removed); the comment in
      "replaces only the named field and keeps a malformed sibling byte-identical" says the parse drops
      `multiCoinSince`: it now reads it (`'later'` is malformed, so the raw-patch assertion still holds); fix the
      comment, not the assertion.
- [ ] Check: `npx jest src/crypto-sync src/sync-state src/data-transfer`. Commit.

### step 11/13: key identity and properties

Files: `binance.layer-snapshot.test.ts` (set 3's key and request snapshot), a new
`binance.walks.multi-coin.properties.test.ts` (not `binance.history-walk.properties.test.ts`, 3171 lines).
- [ ] "every BTC key equals today's key for the same record" (the snapshot reused); property "keys stay unique across
      coins, wallets and walks"; walk properties at gaps 0, 1 h, 1 day over mixed-coin fixtures (tracked, untracked
      and oversized records mixed: no row lost or doubled; every untracked ticker on the history list).
- [ ] `bash scripts/checks/dup.sh <file>` alone on the new file (under 5%). Commit. (Gate half 2 ends here.)

### step 12/13: reviews

- [ ] `kiko:reviewer` with the top question "can any BTC key, cursor or row change, or any coin's row be dropped or
      doubled?"; exact-parity sums per coin; the history tracked rule in all four walks; step 5's red-first proof.
- [ ] No migration, so no migration review; no new i18n key, so no translator review.

### step 13/13: skill text (kiko:scribe)

- [ ] `kiko-architecture` "Binance exchange sync" and its history subsections, each re-grepped against the code (the
      set 5 retrospect lesson: read every source a sentence names): the anchor sentence of "Spot is strict" (gone);
      "`BINANCE_ASSET` filters the history reads only" (no history filter is left); capital "both `coin=BTC`",
      "Amounts convert through `Money.fromMajor('BTC', …)`", "`btcSatoshis` is in `binance.amounts.ts`", the
      description "the asset code (`BINANCE_ASSET`)"; Transfer "BTC only", Earn "imports BTC", "numbered from 0 by
      satoshis", Pay "imports BTC Pay orders", "B4 stops funds that are not BTC", the "Ruling A" bullet (gone); the
      walk-created holding bullet (`resolveWalletHoldings`, `walletHoldingOf`); the history tracked rule;
      `multiCoinSince` and `multiCoinSeen`; with Q1 = B the balance sync stamp. `kiko-domain`: the matcher input
      filter beside the internal-transfers notes. `kiko-compliance` Binance history bullets (re-grep "transaction
      history import failed") only where set 6 changes them. Pointers only.
- [ ] Each ruling that reverses a spec or plan sentence (S2; Q1-Q5 as ruled) is named file:line in the scribe list.

Set 6 notes owed from set 5 (retrospect 2026-10-18), now placed:
- The zero Spot BTC anchor and the four walk guards: step 5/13, one commit, after step 3/13 (walk-created holdings)
  and before the first account-wide walk (step 6/13).
- `WALLET_HOLDING_NAMES` goes in step 3/13; `coinHoldingName` stays.
- The history tracked rule and "never skipped" wording: the preamble above; steps 2 and 6-9.
- Accepted known costs (no step): a coin CoinGecko left empty and Binance priced is asked of CoinGecko once per 7
  days and of Binance every run; a pair that halted yesterday gets a one-day carry in its history.

Rulings on the former open questions (2026-10-19; spec: Pay rule and the balance "Spot anchor" bullets):
- Q1 = B (step 4/13), coordinator ruling on the user's standing approval for Binance edge cases: the balance sync is
  stamped in `exchange_state` (no migration) and "Last sync" reads it, so no "Never" without a tracked holding.
  Steps 4 and 5 are never merged apart.
- Q2 = A (step 7/13), USER ANSWER 2026-10-19: import the tracked funds rows (the Y3/Y4 cross-coin rule) and list the
  order's ticker on the not-tracked line.
- Q3 = A (step 2/13), coordinator ruling (standing approval): the oversized history patch is written at every span
  read that meets the stop, committed or not.
- Q4 = B (step 5/13), coordinator ruling (standing approval), PINNED in step 5: a stored capital row re-read with no
  Spot holding is left out of the write; new rows still import.
- Q5 = A (step 2/13), coordinator ruling (standing approval): the three amount codes join `TRANSFER_FORWARD_OWES` and
  `EARN_FORWARD_OWES`.

End of plan: `make verify` through the queue on the set 6 tip, re-run until green.
