# Crypto exchanges 1.3-a, change set 7: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan step by step. Steps use checkbox (`- [ ]`) syntax.

**Goal:** land `crypto-exchanges-1.3-a task 7/15`: the nullable `transactions.operation` label column (migration
0063), the C-NR1 code forms `asset:`, `p2p:`, `card:`, `bank:` with their parser, the render-time labels ("Trading
fee", "P2P purchase", "Card purchase" / "Sale to card", "Bank deposit" / "Bank withdrawal", "Exchange to/from
<CODE>"), their en + uk copy, and the demo `.kiko` rows that show each one.

**Architecture:** the column is insert-only and labels only; statistics never read it (exclusion stays on the
stored markers). Codes stay codes: `parseUntrackedCounterpart` in `src/transactions/untracked-counterpart/` turns a
stored code into a tagged value; `transactionRowDescription` resolves the label through `t` at render time. No
writer of the new codes or of `operation` ships in this set except the demo seed (writers: sets 8-12).

**Tech stack:** React Native, op-sqlite + Drizzle (count-based runner `src/db/run-migrations.ts`), Jest with
`node:sqlite` (`src/test-support/real-sqlite.ts`), fnts `maybe`/`Either`, ts-pattern, i18next.

**Spec:** `docs/superpowers/specs/2026-10-15-crypto-exchanges-design.md`: section 6 "The `operation` column",
"Untracked-counterpart codes", "Labels", "Mapping and statistics per operation"; section 7 "Export version";
scenario N3; section 9 row "Demo `.kiko`"; section 10 rows `transactions.*`; section 11 row 7/15. Rulings:
`memory/refs/binance-multicoin-sdd-2026-10-21/rulings.md` (main checkout): R-Map, NR1 A, NR-F A, the dividend
removal (C-Div), and the two 2026-10-21 P2P rulings. Set 7 rulings: the same archive file, section "Set 7 plan
questions" (S7-Q1 ... S7-Q8, coordinator 2026-10-21, each = option A of `plan-questions.md`), marked
"(S7-Q<n>, coordinator 2026-10-21)" where the plan applies one.

**Base:** branch `binance-set7` at main `4577a619` (sets 1-6 and the account-currency track). Every code fact names
a symbol or anchor text. **The developer re-greps every fact on the actual base before relying on it.**

## Global constraints

- POWER: this worktree has no `node_modules` and the laptop is on battery. `npm ci`, `drizzle-kit generate`, jest,
  the demo regeneration (`KIKO_REGEN_DEMO=1`), `make verify` and `make deep` all wait for CHARGER BACK. Run `npm ci`
  first once the charger is back, then start at step 1/9.
- Migration index: main's journal (`drizzle/migrations/meta/_journal.json`) ends at idx 62
  `0062_add_account_currency`, 63 entries. Set 7 takes idx 63: `0063_add_transaction_operation`. Before the merge,
  re-check main's journal; if main moved, renumber the files, the journal, `migrations.js` and the tests. Never
  rename or edit a shipped migration (`check:shipped-migrations`).
- Migration files are edited with Edit/Write only, never by a shell write (run-log gap
  `20261015T1657-kiko-binance-backfill-fix/1`: `drizzle/` is not shell-write guarded).
- Every backticked `src/` path in the migration header names a real file (run-log gap
  `20261019T0912-kiko-account-currency/1`: no checker yet; the reviewer step checks it by hand).
- Tests: TDD, failing test first and shown red (quote the red count), then code. Test names and comments carry no
  scenario id, no migration number and no history text; the commit message carries them. Exception (orchestrator
  ruling R5): a migration's own test title may name its migration number (16 neighbours do;
  kiko-code-style is silent). Tests never read `src`
  source text.
- A pin changed by a behaviour change is updated in the same step (table "Pins this set changes"); never in a fix
  round.
- Identifiers in full words; imports through `@kiko/<feature>` barrels; every new export has a consumer at its own
  commit (a test through the barrel counts; knip still flagging it: stop and report, never add an ignore).
- Copy: en + uk for every new key, kiko-translator casing (labels are sentence case; "P2P" kept as written); the
  user reviews new keys before a deploy that ships them.
- No flag, no hidden feature (Guideline 2.5.19): every label this set adds is reachable in the demo file.
- Never write a `transactions.p2pSale` key (C-NR-F). Fact checked on the base: `src/` holds no `p2pSale` and no
  `p2pPurchase` key today, so "set 7 drops `transactions.p2pSale`" means only "never add it". Do not confuse it with
  `accountDetail.notImportedKind.p2pSale` (set 12, a different key).
- No `reward` operation code, no `transactions.reward` key, no reward demo row (C-Div).
- P2P cover rule (S7-Q5, coordinator 2026-10-21): the user's P2P cover rule (rulings.md 2026-10-21, the newest line
  of `memory/refs/binance-multicoin-sdd-2026-10-21/rulings.md`) keys on the `p2p:` code through
  `parseUntrackedCounterpart`, never on `operation`. Set 7 adds nothing else for it.
- Every commit passes the pre-commit typecheck; Bash `timeout: 300000` for commits; never `--no-verify`.

## Run-log gaps (`run-log.mjs stats --gaps --repo kiko`, read 2026-10-21)

Each gap, then this plan:

- `20261015T1657-kiko-binance-backfill-fix/1` (`drizzle/` shell writes unguarded): LEFT OPEN; constrained by the
  Edit/Write-only rule above.
- `20261015T1657-kiko-binance-backfill-fix/2` (no mechanized index check): LEFT OPEN; 0063 adds no index, so no
  EXPLAIN QUERY PLAN test (step 1/9 pins "no index").
- `20261019T0912-kiko-account-currency/1` (migration header paths unchecked): LEFT OPEN; hand check in the G1
  review (step 7/9).
- `20261015T1119-kiko-harness-h7/2`, `20261017T1639-kiko-binance-backfill-fix/7` (TIMEOUT-HEAVY fan-out): LEFT OPEN;
  `transactions.repo.ts` and `schema.ts` have a wide related-test fan-out: a TIMEOUT-HEAVY line is cleared per the
  gate rerun rule in step 9/9.
- every other open gap (harness, Duo, iPad, scrub, currency pickers): LEFT OPEN, unrelated.

## Scenario matrix (each row is a Jest case; the "was:" column shows today's result where it changes)

| # | Row | Label now | was: |
|---|---|---|---|
| L1 | description 'Fee', `operation = 'trade-fee'`, counterpart holding | "Fee" | "Fee" |
| L2 | no description, `operation = 'trade-fee'`, counterpart holding + pair id | "Trading fee" | n/a (no column) |
| L3 | no description, `operation = 'trade-fee'`, `asset:PEPE`, no counterpart holding | "Trading fee" | n/a |
| L4 | `operation = 'trade'`, counterpart holding of another currency | "Exchange to/from <holding>" | same |
| L5 | `operation = 'convert'` / `'dust'` with a counterpart holding | "Exchange to/from <holding>" | same |
| L6 | `-x`, `asset:ETH`, no counterpart holding | "Exchange to ETH" | "<holding> expense" |
| L7 | `+x`, `asset:ETH` | "Exchange from ETH" | "<holding> income" |
| L8 | `+x`, `p2p:UAH:4150.00` | "P2P purchase (UAH)" | "<holding> income" |
| L9 | `-x`, `p2p:UAH:4150.00` (not writable in 1.3-a) | "P2P purchase (UAH)" | "<holding> expense" |
| L10 | `+x`, `card:UAH:2600.00` / `-x`, same code | "Card purchase (UAH)" / "Sale to card (UAH)" | default label |
| L11 | `+x`, `bank:EUR:100.00` | "Bank deposit (EUR)" | default label |
| L11 | `-x`, `bank:EUR:50.00` | "Bank withdrawal (EUR)" | default label |
| L12 (N3) | `p2p:UAH:abc` | "P2P purchase (UAH)"; parse gives no total | default label |
| L13 | `wallet:UMFUTURE` | "Transfer to/from USDⓈ-M Futures" | same |
| L14 | `wallet:FOO`, `asset:`, `p2p:`, `p2p::5`, `foo:UAH:1`, `''` | default label | same |
| L15 | counterpart holding AND `asset:ETH` | "Exchange to/from <holding>" (marker wins) | same |
| L16 | each row above, in Statistics | excluded exactly when it carries a marker or code; | same |
| L16 | (cont.) | `operation` alone changes nothing | same |
| L17 | uk: L2 | «Торгова комісія» | n/a |
| L17 | uk: L8 | «Купівля P2P (UAH)» | n/a |
| L17 | uk: L10 | «Купівля карткою (UAH)» / «Продаж на картку (UAH)» | n/a |
| L17 | uk: L11 | «Поповнення з банку (EUR)» / «Виведення в банк (EUR)» | n/a |

Parse cases (S7-Q3, coordinator 2026-10-21):
`p2p:UAH:4150.00` -> `{ kind: 'p2p', fiat: 'UAH', totalMinorUnits: 415000 }`; `p2p:UAH:4150` -> 415000;
`p2p:UAH:4150.001` (over-precise), `p2p:UAH:abc`, `p2p:UAH:0`, `p2p:UAH:-5.00`, `p2p:UAH`,
`p2p:UAH:1:2`, `p2p:TRY:100.00` (unknown fiat), `card:BTC:1` (crypto in the fiat slot) -> the fiat with
`totalMinorUnits: undefined`; `asset:ETH` -> `{ kind: 'asset', code: 'ETH' }`; `wallet:MARGIN` ->
`{ kind: 'wallet', name: 'Margin' }`; `asset:`, `p2p:`, `p2p::5`, `wallet:FOO`, `wallet:constructor`, `foo:x`, `''`,
`null` -> `undefined`.

## Pins this set changes ("was:" values)

Each pin, by file and test name:

- P1: `src/data-transfer/crypto/envelope.test.ts` "has a version decision for every migration".
- P2: `src/transactions/row-description/row-description.test.ts`
  "falls back to the default label for the unknown code %p".
- P3: `src/transactions/untracked-counterpart/untracked-counterpart.test.ts` "gives no name for the unknown code %p".
- P4: `e2e/screenshot/seed/screenshot-seed.test.ts`
  "seeds nine plain manual accounts spread across UAH/USD/EUR and eight coins".
- P5: `e2e/screenshot/seed/screenshot-seed.test.ts` "pins every ordered currency pair (110) at one fixed fetchedAt".

| Pin | Now | was: |
|---|---|---|
| P1 | `{ version: 5, migrationCount: 64 }` | `migrationCount: 63` |
| P2 | cases `wallet:FOO`, `''` (and the L14 codes); `asset:ETH` moves to L6 | `asset:ETH` -> "Black card expense" |
| P3 | moved to `parseUntrackedCounterpart`; `asset:ETH` parses as an asset | `asset:ETH` -> `undefined` |
| P4 | nine coins (DOGE) (S7-Q1, coordinator 2026-10-21) | eight coins |
| P5 | 132 (12 currencies) (S7-Q1, coordinator 2026-10-21) | 110 |
| P6 | "seeds rate history for each foreign:UAH pair": 11*27 rows, DOGE:UAH in the set (S7-Q1) | 10*27 rows |

Retitle each changed test so its name states the new rule; no "was" text in a title.

## Files (measured floor; the developer measures the real list)

Planned: 41 files at least (count of the lists below; the TransactionRow-literal fixtures found by `tsc` in step 1/9
add to it). Mutable source files (pass `mutable_source_files` in `scripts/checks/mutation.sh`): 7 at least:
`src/db/schema.ts`, `src/transactions/repo/transactions.repo.ts`,
`src/transactions/untracked-counterpart/untracked-counterpart.ts`,
`src/transactions/exchange-description/exchange-description.ts`, `src/transactions/row-description/row-description.ts`,
`src/screens/forms/transaction-form/row-labels/row-labels.ts`,
`src/design-system/components/example-transaction/example-transaction.component.tsx`. Not mutable: the locale files,
`e2e/`, `test-support/`, `drizzle/` (`.sql`, `.json`, `migrations.js`), tests. Spec section 11 said about 10.
The number that counts is `KIKO_MUTATION_BASE=<set base sha> make mutable` (step 9/9).

---

### step 1/9: the `operation` column, migration 0063, its version decision

Files: `src/db/schema.ts`; `npx drizzle-kit generate --name add_transaction_operation` ->
`drizzle/migrations/0063_add_transaction_operation.sql`, `meta/0063_snapshot.json`, `meta/_journal.json`,
`migrations.js` (re-check the file after generate; `./node_modules/.bin/biome check --write` on the generated
files); `drizzle/migrations/0063-add-transaction-operation.test.ts` (new); `src/test-support/real-sqlite.ts` and
`real-sqlite.test.ts`; `src/data-transfer/crypto/envelope.test.ts`; `src/data-transfer/import-data.back-compat.test.ts`;
the restore tests that build a pre-0063 database (re-grep `applyMigrationsThrough` with `from(transactions)`,
`restoreDataSnapshot` or `importData` in the same file; on the base: `restore-implicit-accounts`, `restore-walk-state`,
`restore-category-rules`, `restore-sets-balance`, `restore-usdt-rescale`, `restore-bank-other`,
`restore-account-currency`, `restore-exchange-pair`, `restore-crypto-cash` `.two-path.test.ts`: 9);
`e2e/screenshot/fixtures/build-demo-snapshot.ts` (`operation: null` in `buildLedger`'s row); both demo `.kiko` files;
every full `TransactionRow` literal `tsc` names.

- [ ] Tests first (real sqlite, seeded through `0062_add_account_currency`, the 0058 test's shape): "adds a nullable
      text column with no default"; "leaves every existing row's operation null"; "adds no index to transactions"
      (`pragma_index_list` count unchanged); "accepts each operation code on insert" (the seven codes). Red: the
      SQL file is missing.
- [ ] Code: `operation: text('operation', { enum: ['trade', 'trade-fee', 'convert', 'dust', 'p2p', 'card',
      'fiat'] })` on `transactions`, after `untrackedCounterpart`, with a comment in the style of its neighbours:
      the label of an exchange operation, insert-only, never read by statistics, null on every other row. The
      migration is one statement, `ALTER TABLE \`transactions\` ADD \`operation\` text;`, under a header comment like
      0058's (what the column is; crash-safe: one ADD COLUMN, no index, no backfill; the restore mirror is the
      nullable column itself).
- [ ] Version decision in the same commit (so "has a version decision for every migration" is never red):
      `VERSION_DECISIONS` gains "Through 0063_add_transaction_operation, a nullable column riding inside the
      transaction row (`operation`), a label only: an older build restoring a file that carries it drops the key,
      its rows keep their markers, and this build restores an older file without it as null, so it needed no bump."
      -> `{ version: 5, migrationCount: 64 }` (S7-Q7, coordinator 2026-10-21). `EXPORT_VERSION` stays 5.
- [ ] Back-compat (`import-data.back-compat.test.ts`, beside "a file written before transactions carried an untracked
      counterpart"): describe "a file written before transactions carried an operation": "restores every transaction
      with a null operation" (key deleted from every row) and "restores the operation a file carries".
- [ ] Test support: `addTransactionOperationColumn(database)` beside `addAccountCurrencyColumn` in `real-sqlite.ts`
      (reads the 0063 file's first statement), with its own case in `real-sqlite.test.ts`; every restore test above
      that restores into a database migrated short of 0063 calls it after its `addAccountCurrencyColumn` (or after
      `applyMigrationsThrough`); every `columnsWithout(getTableColumns(transactions), ...)` read of a pre-0063 source
      adds `'operation'`. Each touched suite green with its old test count.
- [ ] Demo: `buildLedger` writes `operation: null`; regenerate both files (`KIKO_REGEN_DEMO=1 npx jest
      e2e/screenshot/fixtures/generate-demo-kiko.test.ts`, then the plain run green), so
      "decrypts back to the current dataset" is never red at this commit. CHARGER BACK required.
- [ ] Check: `npx tsc --noEmit` clean (add `operation: null` to each full `TransactionRow` literal it names; quote
      the file count in the commit body); the touched suites green; `npm run check:shipped-migrations`;
      `bash scripts/checks/dup.sh <file>` alone on each touched test file. Commit
      `feat(db): operation label column on transactions`.

### step 2/9: the repository writes `operation` once and never refreshes it

Files: `src/transactions/repo/transactions.repo.ts` (`NewTransaction` gains `'operation'`; not in
`BANK_OWNED_TRANSACTION_COLUMNS`; not in `REWRITE_GUARD_FIELDS`, S7-Q4, coordinator 2026-10-21), its real-sqlite
repo test (the suite that pins `untrackedCounterpart` as insert-only; re-grep `untrackedCounterpart` in
`src/transactions/repo/*.test.ts`).
- [ ] Tests first: "stores the operation a new row carries"; "keeps the stored operation when the same key is
      upserted with another" (the upsert's set leaves it, as `untrackedCounterpart`); "a row with no operation stores
      null". Red: `operation` is not on `NewTransaction` (type error in the test file counts as red; quote it).
- [ ] Code: the type only; the insert already spreads the row. Update the insert-only comment above `NewTransaction`
      ("The three movement markers") to name the label too. Commit `feat(transactions): insert-only operation label`.

### step 3/9: the code forms and their parser

Files: `src/transactions/untracked-counterpart/untracked-counterpart.ts`, `untracked-counterpart.test.ts`,
`src/statistics/exchange-exclusion/exchange-exclusion.test.ts`.
- [ ] Tests first: the parse cases above the pins table (it.each per group: wallet, asset, fiat code with a total,
      fiat code without a total, unknown). Exact-parity rows: `p2p:UAH:4145.85` -> 414585, `card:UAH:2600.00` ->
      260000, `bank:EUR:100.00` -> 10000, `bank:EUR:0.01` -> 1. Exclusion (characterization, green on first run,
      say so in the commit): "excludes a row with each new code form, a malformed total included" (`asset:PEPE`,
      `p2p:UAH:4150.00`, `card:UAH:2600.00`, `bank:EUR:100.00`, `p2p:UAH:abc`).
- [ ] Code (S7-Q3 and S7-Q6, coordinator 2026-10-21; parsers only, no builder). S7-Q5: the user's P2P cover rule
      (rulings.md 2026-10-21) keys on the `p2p:` code through this `parseUntrackedCounterpart`, never on
      `operation`; set 7 adds nothing else for it.
      ```ts
      export type UntrackedCounterpart =
        | { kind: 'wallet'; name: string }
        | { kind: 'asset'; code: string }
        | { kind: 'p2p' | 'card' | 'bank'; fiat: string; totalMinorUnits: number | undefined };

      export const parseUntrackedCounterpart = (code: string | null): UntrackedCounterpart | undefined
      ```
      Split on the first `:` for the kind and the second `:` for the fiat; the total is the rest. The total goes
      through `decimalToMinorUnits(rest, currencyScale[fiat], 'exact')` only for a known non-crypto fiat
      (`isCurrency`, `isCrypto` from `@kiko/currency/currency`), kept only when right and above zero. The wallet arm
      reuses `UNTRACKED_WALLETS`/`NAME_BY_WALLET` (an own-property lookup: `wallet:constructor` stays unknown). A
      `match(kind)` over the closed prefix set, never an if-chain. Commit `feat(transactions): parse exchange
      counterpart codes`.

### step 4/9: render labels, copy, and every caller

Files: `src/i18n/locales/en.ts`, `uk.ts`; `src/transactions/exchange-description/exchange-description.ts` + test;
`src/transactions/row-description/row-description.ts` + test; `untracked-counterpart.ts` + test
(`untrackedCounterpartName` stops being exported; its cases move to the parser suite);
`src/transactions/repo/transactions.repo.ts` (`contextRowsQuery` projects `operation`);
`src/screens/forms/transaction-form/row-labels/row-labels.ts` + test;
`src/design-system/components/example-transaction/example-transaction.component.tsx`; the
`transaction-row.component.test.tsx` and `holding-detail` fixtures `tsc` names.
- [ ] Copy, keys under `transactions` beside `exchangeTo` (S7-Q8, coordinator 2026-10-21: no `matched*` key):
      | key | en | uk |
      |---|---|---|
      | `tradingFee` | Trading fee | Торгова комісія |
      | `p2pPurchase` | P2P purchase ({{currency}}) | Купівля P2P ({{currency}}) |
      | `cardPurchase` | Card purchase ({{currency}}) | Купівля карткою ({{currency}}) |
      | `cardSale` | Sale to card ({{currency}}) | Продаж на картку ({{currency}}) |
      | `bankDeposit` | Bank deposit ({{currency}}) | Поповнення з банку ({{currency}}) |
      | `bankWithdrawal` | Bank withdrawal ({{currency}}) | Виведення в банк ({{currency}}) |
- [ ] Tests first: L1-L15 and L17 in `row-description.test.ts` (`row()` gains `operation: null`); in
      `exchange-description.test.ts`: "reads a P2P purchase for either sign", "reads a card purchase for a positive
      row and a sale to card for a negative one", "reads a bank deposit and a bank withdrawal by sign", "reads zero
      as the positive wording" (as `exchangeLegDescription`), "resolves against the active language"; in
      `row-labels.test.ts`: "opens a blank trading-fee row with Trading fee" (`resolveBlankLabel`) and "previews
      Trading fee for an edited fee row" (the placeholder path reads `existing?.operation`). Red counts quoted.
- [ ] Code: `exchange-description.ts` gains `fiatCounterpartDescription({ kind, fiat, amountMinorUnits, t })`
      (`match(kind)`; sign rule `< 0` as its neighbours). `transactionRowDescription` takes `'operation'` in its
      `Pick` and applies, in order: (1) stored description; (2) `operation === 'trade-fee'` -> `tradingFee`; (3)
      counterpart holding -> `exchangeLegDescription` (as today); (4) `parseUntrackedCounterpart`: `wallet` ->
      `transferLegDescription`, `asset` -> `exchangeLegDescription` with `counterpartName: code`, `sameCurrency:
      false`, fiat kinds -> `fiatCounterpartDescription`; (5) `defaultTransactionDescription`. Rewrite its doc
      comment to the five steps. Callers: `contextRowsQuery` selects `operation`; `row-labels.ts` widens its two
      `Pick`s and passes `operation: existing?.operation ?? null` on the placeholder path; `ExampleTransaction`
      passes `operation: null`. `untrackedCounterpartName` becomes module-private or is removed (knip).
- [ ] Check: L16 holds by construction: re-grep `operation` under `src/statistics/` and `statistics.screen.tsx`
      (expect none) and quote the empty result in the commit body. `npx tsc --noEmit` clean; touched suites green;
      `en.uk.parity`, `en.casing-by-role`, `uk.casing`, `uk.catalog-rules` suites green. Commit
      `feat(transactions): labels for exchange operations`.

### step 5/9: demo rows (S7-Q1 and S7-Q2, coordinator 2026-10-21)

Files: `e2e/screenshot/seed/screenshot-seed.ts` (+ test), `e2e/screenshot/fixtures/build-demo-snapshot.ts` (+ test),
both demo `.kiko` files; `e2e/screenshot/seed/demo-text.ts` only if a new holding name needs text (DOGE is a brand
name: "Dogecoin", Latin in both languages, no text entry).
- [ ] Seed shape: `SeedTransaction` gains optional `pair?: { key: string; counterpartHoldingKey: string }`,
      `untrackedCounterpart?: string`, `operation?: NonNullable<TransactionRow['operation']>`, `comment?: string`; the
      Binance holdings gain `key`s; `buildLedger` maps a pair key to `pair-<n>` (dataset order, deterministic), a
      counterpart key to its `hold-n` id, and the other three fields as given (null when absent). DOGE joins
      `SeededCurrency`, `PRICE_IN_UAH` (6.6) and `CURRENCIES`; a "Dogecoin" holding joins `buildExchangeHoldings`.
- [ ] Rows on the Binance account. Operation rows store an empty description (the label renders); every set 7 row
      is dated more than 30 days before the anchor, and every existing holding ends at today's balance. Minor units
      at each coin's `currencyScale` (re-check: BTC 8, USDT 8, BNB 7, DOGE 4, UAH 2, EUR 2):
      | Day | Holding | Amount | Pair / counterpart | Code | Operation | Comment |
      |---|---|---|---|---|---|---|
      | 140 | BTC | +0.0079 (was +0.01) | - | - | - | - |
      | 110 | USDT | +99.9 (replaces the +50 deposit) | - | `p2p:UAH:4150.00` | `p2p` | 4150 UAH |
      | 100 | BNB | +0.0395 (was +0.05) | - | - | - | - |
      | 95 | DOGE | +50 | - | - | - | - |
      | 70 | UAH | +2000.00 (was +1000.00) | - | - | - | - |
      | 60 | EUR | +100.00 (replaces the +50.00 top-up) | - | `bank:EUR:100.00` | `fiat` | 100 EUR |
      | 50 | UAH / USDT | -1000.00 / +24 | convert pair, each leg names the other | - | `convert` | - |
      | 45 | USDT / BTC | -73.9 / +0.0011 | trade pair, each leg names the other | - | `trade` | - |
      | 45 | BNB | -0.0005 | trade pair id, counterpart BTC holding | - | `trade-fee` | - |
      | 40 | DOGE / BNB | -50 / +0.011 | dust pair, each leg names the other | - | `dust` | - |
      | 35 | BTC | +0.001 | - | `card:UAH:2600.00` | `card` | 2600 UAH |
      | 33 | EUR | -50.00 | - | `bank:EUR:50.00` | `fiat` | 50 EUR |
      | 38 | ETH | -0.013 (ETH deposit 0.043, was 0.03) | - | `card:UAH:1300.00` | `card` | 1300 UAH |
      | 42 | SOL | -0.2 (SOL deposit 0.7, was 0.5) | none, no counterpart holding | `asset:PEPE` | `trade` | - |
      The last two rows are orchestrator ruling R6: a card SALE and a trade with an untracked side, so every label
      set 7 adds is reachable (Guideline 2.5.19). Both holdings keep their end balance. DOGE also needs a
      `HISTORY_PAIRS` rate-history pair (DOGE:UAH, 5.2 -> 6.6), so the history row count goes 10x27 -> 11x27.
      The set 13 bank debit is not added here.
- [ ] Tests first (`build-demo-snapshot.test.ts`): "carries one row of every operation code on the crypto account"
      (the seven codes); "gives the legs of each pair one pair id and points each leg at the other's holding";
      "points the fee row at the received leg's holding under the trade's pair id"; "labels the fee row Trading fee
      and the coded rows by their code" (through `transactionRowDescription` with `i18n.t`, en and uk); "dates every
      exchange operation row outside the default 30-day window"; the existing "gives every holding a balance equal
      to the sum of its own transactions" stays green, plus "keeps each existing Binance holding's end balance".
      Seed pins per the "Pins" table.
- [ ] Regenerate both files (`KIKO_REGEN_DEMO=1 ...`, then the plain run green). CHARGER BACK required. Run
      `npx jest e2e/screenshot` and re-grep `e2e/` flows for a Binance holding name or count they assert. Commit
      `feat(demo): exchange operation rows`.

### step 6/9: spec corrections for the migration number and the export version

Files: `docs/superpowers/specs/2026-10-15-crypto-exchanges-design.md`.
- [ ] Re-grep `0062` and `count 63` in the spec. Edit: the header sentence "Migration numbers 0059-0062 follow ..."
      (set 7's is 0063: main's 0062 is account currency); the heading "The `operation` column (set 7, migration
      0062)" -> 0063; section 7 "Export version": "0062 (set 7) records its own decision: no bump, ... (count 63)" ->
      "0063 (set 7) records its own decision: no bump (version 5, after account currency's 0062 bump), ... (count
      64)"; section 11 row 7/15 "0062 ADD COLUMN" -> 0063, and its file count note.
- [ ] Record S7-Q1 ... S7-Q8 as coordinator rulings in section 1 "Coordinator rulings", each with its source line
      (`memory/refs/binance-multicoin-sdd-2026-10-21/rulings.md`, section "Set 7 plan questions", the "S7-Q<n>"
      line, coordinator 2026-10-21; never the gitignored worktree copy), so the spec never
      contradicts them, and align the text each one touches:
      S7-Q1 and S7-Q2 in section 9 row "Demo `.kiko`" (DOGE dust source; end balances kept; rows older than 30 days);
      S7-Q3 and S7-Q6 in section 6 "Untracked-counterpart codes" (parse rules; parsers only, builders per walk set);
      S7-Q4 and S7-Q5 in section 6 "The `operation` column" and "Mapping and statistics per operation" (not a
      rewrite guard field; labels only; the P2P cover rule keys on the `p2p:` code);
      S7-Q7 in section 7 "Export version" (no bump, `{ version: 5, migrationCount: 64 }`);
      S7-Q8 in section 10 rows `transactions.matched*` (set 13, not set 7).
- [ ] Lines stay at or under the spec's width; never write the phrase the `docs-known-limit` suite bans. Commit
      `docs(spec): set 7 takes migration 0063`.

### step 7/9: reviews

Reviews run per task group, not per step (harness-workflow "Review cadence"); each group's `kiko:reviewer` pass
runs after that group's last step is committed, before the next group starts.
- [ ] G1 = steps 1/9-2/9: `kiko:reviewer` on the column, the repository write, and migration 0063 (the migration
      review lives here). Top question: "can any reader treat `operation` as a statistics input, or any path write
      it after insert, or any restore of an older or newer file lose or invent it?" Also: each backticked path in
      the 0063 header resolves; the migration adds no index (so no EXPLAIN QUERY PLAN test); the version decision
      text.
- [ ] G2 = steps 3/9-4/9: `kiko:reviewer` on the code forms, the parser, the labels, and every caller; the same
      group runs the kiko-translator review of the six keys (en + uk); the uk keys go to the coordinator for the
      user's morning list.
- [ ] G3 = steps 5/9-6/9: `kiko:reviewer` on the demo rows and the spec corrections.
- [ ] One whole-branch `kiko:reviewer` pass at the set tip, before BATCH READY.

### step 8/9: skill text (kiko:retrospect, then kiko:scribe)

- [ ] `kiko-domain`: the `transactionRowDescription` order (five steps), the `operation` column bullet (label only,
      insert-only, never statistics), the code forms and their parse rules. `kiko-architecture`: the 0063
      data-transfer note beside 0058's, `addTransactionOperationColumn`, the demo pair-row seed shape. Pointers, no
      code copies. The completion report names the drift-fix sha or "no drift found".

### step 9/9: gates and BATCH READY

- [ ] `bash scripts/job-queue.sh check-all <worktree> "crypto-exchanges-1.3-a task 7/15 check-all"` exit 0.
- [ ] `KIKO_MUTATION_BASE=<set 7 base sha> make mutable`: quote the file list and `mutable files: N (cap 30)`.
- [ ] Coordinator (not the developer): `bash scripts/job-queue.sh gate <worktree> "crypto-exchanges-1.3-a task 7/15
      deep" <base> <head>` (`KIKO_MUTATION_BASE=<set 7 base sha> make deep`), detached; agents wait for the exit code
      only. TIMEOUT-HEAVY (`docs/harness/checks.md`, the "Clearing a TIMEOUT-HEAVY file" paragraph): when it is
      the only failure, the gate itself reruns the timed-out mutants alone, and that rerun report is the verdict.
      Only if that rerun still fails or is skipped: apply each timed-out mutant in a scratchpad copy, run the file's
      own colocated tests in plain jest (`npx jest <own tests> --runInBand`), record Killed or equivalent, and
      BATCH READY carries that proof per timed-out mutant. Never raise the timeout.
- [ ] `make verify` once at the set tip, through the queue
      (`bash scripts/job-queue.sh verify <worktree> "crypto-exchanges-1.3-a task 7/15 verify"`, tree clean, HEAD
      unchanged until DONE), re-run until green. CHARGER BACK required.
- [ ] BATCH READY names the base sha, the deep run id, the `make mutable` count, the reviewer verdict, the
      translator verdict, the scribe sha, and the Q1-Q8 rulings applied.

## Review focus

1. A label read from a code the user cannot see: an unknown or malformed code must never print raw text (L12, L14).
2. The fee row's two markers: `operation = 'trade-fee'` must win over the counterpart label (L2, L3), and a stored
   description over both (L1).
3. A restore of an older file (no key) and of a newer one (a code this build does not know, for example a future
   `reward`): both restore, and the label falls back (step 1/9 back-compat cases; L14).
4. The demo pairs: legs that do not point at each other, or a fee row on another pair id, would read as spending.
5. The P2P cover rule (rulings 2026-10-21) is not built here; nothing in this set reads `operation` in statistics,
   and the rule keys on the `p2p:` code through `parseUntrackedCounterpart`, never on `operation` (S7-Q5,
   coordinator 2026-10-21).
