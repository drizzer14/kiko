# Account currency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every account stores its own fixed currency. The account card totals the account in that
currency and shows a base-currency caption under it. The user can pick the currency on create and
on edit for every kind. No money data is rewritten.

**Architecture:** One additive migration (0062) adds `accounts.currency` and backfills it once by
the ruling-1 rule. A restore step mirrors the migration through the same pure rule, and
`EXPORT_VERSION` goes to 5. Every account write path passes a currency. The card reuses
`guardedNetWorth` with the account currency as its target, through a small `accountTotal` helper
and an `AccountTotal` view.

**Tech Stack:** Drizzle + op-sqlite (migrations through `run-migrations.ts`), `node:sqlite` tests
(`src/test-support/real-sqlite.ts`), React Native, i18next.

**Spec:** `docs/superpowers/specs/2026-10-19-account-currency-design.md` (D1-D9; Q1-Q3 are user rulings of
2026-10-19, and Q4-Q7 are orchestrator defaults that the plan applies).

## Global Constraints

- Re-grep every code fact on the actual base before you rely on it. Anchors are symbols, never
  line numbers.
- Every count here (files, call sites, tests) is a floor. The developer measures.
- Migration idx 62 is a SHARED namespace. Re-read the `drizzle/migrations/meta/_journal.json` tail
  before the merge, and renumber if another track landed 62 first.
- Migration SQL uses single-quoted string literals. Never edit a shipped migration (0044 included).
- Every write goes through `write()` / `db.transaction()`. A create writes the currency in its own
  insert, never in a second write.
- No holding, transaction or amount is rewritten because of an account currency (ruling 7).
- A base-currency change never touches `accounts.currency` (ruling 5).
- kiko-code-style: full-word identifiers, import ordering, blank-line rules, WHY-only comments of
  at most 100 columns, no history ids in comments or test titles.
- Guideline 2.5.19: no flag. Each task tip is safe on its own: no field without its effect.
- Developer runs scoped jest only. The orchestrator queues full jest / `make verify` once at the
  end, and `make deep` per task with `KIKO_MUTATION_BASE=<that task's base sha>` (the BATCH READY
  names the count from `KIKO_MUTATION_BASE=<base sha> make mutable`; the cap is 30 files).
- A touched test file must pass `dup.sh` alone. `accounts.screen.test.tsx` (2540 lines) and
  `account-form.screen.test.tsx` (4024 lines) are already large. Add only a few cases there, or put
  focused new cases in new small files without copying their mock blocks.

## Review Focus

1. An older `.kiko` restore must produce the same `accounts.currency` as the same data upgraded in
   place (two-path test, task 1/6).
2. A Connect (`createIfAbsent`) and then a currency pick and Save must keep the pick
   (`saveFormAccount` update branch, task 2/6 and task 5/6).
3. A cash account currency edit must leave its holding, transactions and amounts byte-identical
   (task 5/6).
4. A crypto-currency account with no rate shows its own sum and no caption. It never throws
   (`canConvert` guard, task 3/6).
5. A base-currency change leaves every stored account currency (task 2/6).

## Open gaps (run-log `stats --gaps --repo kiko`, read 2026-10-19)

- `20261015T1657-kiko-binance-backfill-fix/2` (no mechanized check that a migration's keyed lookups
  use an index): NOT closed. 0062 avoids the per-row lookup by design and pins its plan with an
  `EXPLAIN QUERY PLAN` test (task 1/6). The gap asks for a mechanized check, which is harness work.
- `20261016T2009-kiko-currency-pickers/2` item (4) (inline `CASH_CURRENCY_CONTEXT`): left open.
  This plan reads the constant in `account-form.screen.tsx` but does not do that sweep's minors.
- `20261016T2009-kiko-currency-pickers/3` (`currency-field.component.tsx` `selected` row mutants):
  left open. The form tests here assert the selected code through the field, not the component's
  row.
- Every other open gap (harness, Binance, Duo, scrub, date-range) is outside this track: left open.

---

### account-currency task 1/6: column, migration 0062, restore mirror, export version

Own change set; a `kiko:reviewer` pass on the migration alone before BATCH READY.

**Files (floor):**
- Modify: `src/db/schema.ts` (`accounts.currency`, D1)
- Create: `drizzle/migrations/0062_add_account_currency.sql`, `drizzle/migrations/meta/0062_snapshot.json`
- Modify: `drizzle/migrations/meta/_journal.json`, `drizzle/migrations/migrations.js`
- Create: `drizzle/migrations/0062-add-account-currency.test.ts`
- Create: `src/accounts/account-currency/account-currency.ts`, `index.ts`, `account-currency.test.ts`
- Create: `src/data-transfer/snapshot/with-account-currency-derived.ts`, `with-account-currency-derived.test.ts`
- Create: `src/data-transfer/snapshot/restore-account-currency.two-path.test.ts`
- Modify: `src/data-transfer/snapshot/restore-snapshot.ts` (call the step; `crypto-from-` literal copies `source.currency`)
- Modify: `src/data-transfer/snapshot/assert-known-currencies.ts` + `restore-unknown-currency.test.ts`
- Modify: `src/data-transfer/crypto/envelope.ts` (5; readable `[1, 2, 3, 4, 5]`), `envelope.test.ts` (`VERSION_DECISIONS` entry, `version: 5`, `migrationCount: 63`)
- Modify: `e2e/screenshot/fixtures/build-demo-snapshot.ts`; regenerate `kiko-demo-en.kiko`, `kiko-demo-uk.kiko`
- Modify: `src/data-transfer/import-data.back-compat.test.ts` (accounts come back derived)
- Modify: every test file whose `AccountRow` literal fails `tsc` (18 files reference `AccountRow`; a floor)

**Interfaces produced:**
- `accountCurrencyOf(holdings: readonly Pick<HoldingRow, 'currency' | 'closedAt'>[], baseCurrency: Currency): Currency`
- `withAccountCurrencyDerived({ fileAccounts, accounts, holdings, baseCurrency }): AccountRow[]`.
  `fileAccounts` is the file's own `snapshot.accounts`, used for the file-level presence check, and
  the step returns the same array reference when the file carries the key.
- `AccountRow['currency']: Currency` (NOT NULL, default `'UAH'`).

- [ ] **step 1/9: failing migration test.** Write `0062-add-account-currency.test.ts`.
  `applyMigrationsThrough(db, '0061_exchange_state')`, then seed through raw SQL: settings base
  `USD`, plus accounts for one currency (EUR), mixed (UAH + USD), empty, all-closed, open EUR plus
  closed USD, archived (GBP), implicit property (UAH items), and `crypto-from-x` (BTC). Run the
  shipped 0062 statements split on `--> statement-breakpoint`. Assert each account's `currency` per
  the spec's D2. Second case: no settings row means `'UAH'`. Third case: `EXPLAIN QUERY PLAN` of
  the last statement shows `holdings` scanned once with no `CORRELATED` subquery on it (pin the
  measured text). Fourth case: `applyAllMigrations` on an empty database. Run
  `npx jest drizzle/migrations/0062-add-account-currency.test.ts`: it FAILS (no file).
- [ ] **step 2/9: schema + generate.** Add the column (D1). Run
  `npx drizzle-kit generate --name add_account_currency`. Check that the generated statement is
  `ALTER TABLE \`accounts\` ADD \`currency\` text DEFAULT 'UAH' NOT NULL;`, restore the layout of
  `migrations.js`, and run `./node_modules/.bin/biome check --write` on the generated JSON. Then
  hand-append the two backfill statements (D2) above a header comment that states the rule,
  open-only, crash-safety and the shared pure rule. Run step 1's jest: it PASSES.
- [ ] **step 3/9: pure rule.** Write `account-currency.test.ts` (one, mixed, none, all closed,
  `closedAt` absent counts as open, a crypto currency). Watch it fail, then implement
  `accountCurrencyOf`. Run `npx jest src/accounts/account-currency`.
- [ ] **step 4/9: restore step.** Write `with-account-currency-derived.test.ts`:
  - a file without the key derives every account, including one not in `fileAccounts`;
  - a file with the key keeps every value, even when it disagrees with the rule;
  - no settings row means `'UAH'`;
  - the same reference comes back when nothing is derived.

  Implement the step and wire it into `restoreDataSnapshot` after `withImplicitAccountsMerged`, on
  `accountsToInsert` and `holdingsAfterImplicitMerge`, with the base taken from
  `settingsAfterImplicitMerge[0]?.baseCurrency ?? 'UAH'`. In `withCryptoCashHoldingsMoved` the new
  account copies `currency: source.currency`, with a WHY comment that the derive step replaces it.
- [ ] **step 5/9: two-path test.** Write `restore-account-currency.two-path.test.ts`, shaped like
  `restore-walk-state.two-path.test.ts`. Use the step 1 seed plus a 1.0-era crypto `cash` holding.
  Path 1 runs the backfill statements. Path 2 runs the `ALTER`, exports, deletes `currency` from
  each account, and restores into an `applyAllMigrations` database. Compare accounts by id. Run
  `npx jest src/data-transfer/snapshot/restore-account-currency src/data-transfer/snapshot/with-account-currency-derived`.
- [ ] **step 6/9: unknown currency.** Add a case to `restore-unknown-currency.test.ts` for an
  account with `currency: 'XYZ'`, which must be refused, and watch it fail. Add
  `hasUnknownCurrency(snapshot.accounts, ['currency'])` to `assert-known-currencies.ts`.
- [ ] **step 7/9: version.** Set `EXPORT_VERSION = 5` and readable `[1, 2, 3, 4, 5]`. Add a
  `VERSION_DECISIONS` entry "Through 0062_add_account_currency ...": the user's pick rides in the
  account row, and an older build would drop it and later re-derive a different currency, so it
  refuses the file by version (user ruling 2026-10-18). Set `version: 5`, `migrationCount: 63`.
  Add an assertion to `import-data.back-compat.test.ts` that the 1.1 file's accounts restore with
  the derived currency.
- [ ] **step 8/9: demo.** In `build-demo-snapshot.ts`, set each account's `currency` with
  `accountCurrencyOf(open holdings, dataset.baseCurrency)`. Run
  `KIKO_REGEN_DEMO=1 npx jest e2e/screenshot/fixtures/generate-demo-kiko.test.ts`, then the same
  command without the variable.
- [ ] **step 9/9: typecheck + scoped run + commit.** Add `currency` to every `AccountRow` literal
  `npm run check:typecheck` names. Run
  `npx jest drizzle/migrations/0062 src/accounts src/data-transfer e2e/screenshot src/db`. Commit
  `feat(accounts): store a fixed currency per account (migration 0062, export version 5)`.
  Then a `kiko:reviewer` pass on the migration and mirror, before BATCH READY.

**Checks:** step 1, 3, 4, 5 and 6 tests red then green; `check:typecheck`; `check:shipped-migrations`
(no shipped file touched); envelope test; demo test without regen; reviewer pass.

---

### account-currency task 2/6: every account write path sets the currency

**Files (floor):**
- Modify: `src/accounts/accounts.repo.ts`:
  - `NewAccount` requires `currency`;
  - `createCashAccount` writes `currency` on the account row;
  - `insertImplicitAccount` reads `settings.baseCurrency` where `id = SETTINGS_ID` inside the
    write, falling back to `'UAH'`;
  - the `saveFormAccount` update `set` adds `currency`.
- Modify: `src/screens/forms/account-form/account-form.screen.tsx`: `accountRow()` passes
  `currency: baseCurrency` from `useLiveQuery(settingsRepo.getQuery(), ['settings'])`. No UI change
  in this task.
- Create: `src/accounts/accounts.repo.currency.test.ts` (real SQLite, `executingClient`)
- Modify: `accounts.repo.test.ts`, `accounts.repo.implicit-account.test.ts`, and the test files
  calling `accountsRepo.create` (2 files), `createIfAbsent` (1), `saveFormAccount` (1),
  `createCashAccount` (4), and `account-form.screen.test.tsx` call-argument pins (floors).

- [ ] **step 1/5: failing repo tests.** In `accounts.repo.currency.test.ts`, on a fully migrated
  `node:sqlite` database with base `USD`:
  - `createCashAccount` with EUR stores `accounts.currency = 'EUR'`;
  - `createIfAbsent` and `saveFormAccount` store the input currency;
  - `saveFormAccount` on a stored row updates `currency`;
  - `createImplicitHolding('property', ...)` creates the account with `USD`;
  - after `settingsRepo.setBaseCurrency('UAH')`, every stored currency is unchanged (ruling 5);
  - adding a GBP holding to the EUR account leaves it `EUR`.

  Run `npx jest src/accounts/accounts.repo.currency`: it FAILS.
- [ ] **step 2/5: implement the repo.** Make the changes listed under Files. Run the same jest: it
  PASSES.
- [ ] **step 3/5: form wiring.** In `account-form.screen.tsx`, `accountRow()` passes the base
  currency. Update the `account-form.screen.test.tsx` pins of `createIfAbsent`/`saveFormAccount`
  arguments to expect `currency`, and its live-query mock to answer `settings`. Run
  `npx jest src/screens/forms/account-form`.
- [ ] **step 4/5: callers' tests.** Add `currency` to every test call `tsc` names. Run
  `npm run check:typecheck` and `npx jest src/accounts src/screens/forms/holding-form`.
- [ ] **step 5/5: commit.** `feat(accounts): every account create writes its currency`.

**Checks:** new repo tests red then green; typecheck; scoped jest.

---

### account-currency task 3/6: the account card in the account's currency

**Files (floor):**
- Create: `src/rates/net-worth-view/account-total.ts` + `account-total.test.ts`; export from
  `src/rates/net-worth-view/index.ts`
- Create: `src/design-system/components/converted-caption/converted-caption.component.tsx`,
  `index.ts`, `converted-caption.component.test.tsx` (the shared caption. It sits in the design
  system because task 4/6's account detail uses it too, and a cross-screen import fails
  `check:screen-imports`)
- Create: `src/screens/accounts/account-total/account-total.component.tsx`,
  `account-total.props.d.ts`, `account-total.styles.ts` (if a style is needed), `index.ts`,
  `account-total.component.test.tsx`
- Modify: `src/screens/accounts/accounts.screen.tsx` (`renderAccountCard` uses `accountTotal` +
  `AccountTotal` with `convertedTestID="account-card-converted"`)
- Modify: `src/screens/accounts/accounts.screen.test.tsx` (`setLiveData` defaults
  `currency: 'UAH'`; a few new cases)
- Modify: `src/design-system/components/holding-card/holding-card.component.tsx` (the header
  comment only)

**Interfaces produced:** `accountTotal(holdings, accountCurrency, baseCurrency, rates, now, book): { total: Money; inBase: Money | null }`;
`ConvertedCaption` props `{ money: Money | null; testID: string }` (renders nothing for `null`);
`AccountTotal` props `{ total: Money; inBase: Money | null; convertedTestID: string }`.

- [ ] **step 1/6: failing helper test.** Write `account-total.test.ts` covering the spec's scenario
  matrix rows: same currency gives no `inBase`; USD with a rate gives a USD total and a base
  `inBase` equal to `guardedNetWorth(holdings, base)`; mixed holdings; BTC with no rate gives a BTC
  total and `inBase` null without throwing; empty. Run
  `npx jest src/rates/net-worth-view/account-total`: it FAILS.
- [ ] **step 2/6: implement `accountTotal`** (D6). Run the same jest: it PASSES.
- [ ] **step 3/6: views.** Write `converted-caption.component.test.tsx`: `null` renders nothing; a
  `Money` value renders `formatMoney` text, caption variant, `textSecondary` tone, under `testID`.
  Write `account-total.component.test.tsx`: the total plus the caption under `convertedTestID`
  only when `inBase` is set. Watch both fail, then implement `ConvertedCaption` (the holding-card
  caption pattern) and `AccountTotal` on top of it.
- [ ] **step 4/6: screen.** Add to `setLiveData` the default `currency: 'UAH'` per account, and add
  cases to `accounts.screen.test.tsx`:
  - a USD account with a USD:UAH rate shows `$` and `account-card-converted` with `₴`;
  - a UAH account shows no caption;
  - a BTC account with no rate shows the BTC sum, not `0,00 ₴`.

  Watch them fail, then change `renderAccountCard`. Every existing pin listed in spec D9 must stay
  unchanged.
- [ ] **step 5/6: comment.** Replace the stale sentence in the `HoldingCard` header comment (the
  account card now shows the account's own currency).
- [ ] **step 6/6: scoped run + commit.** Run
  `npx jest src/rates/net-worth-view src/screens/accounts src/design-system/components/holding-card src/design-system/components/converted-caption`.
  Commit `feat(accounts): the account card totals in the account currency`.

**Checks:** helper and view tests red then green; D9 pins unchanged; `dup.sh` on the touched test
file.

---

### account-currency task 4/6: the account-detail headline in the account currency (spec Q3 = B, user ruling)

**Files (floor; 1 mutable source file):**
- Modify: `src/screens/account-detail/account-detail.screen.tsx`:
  - `overallBalance` (today `guardedNetWorth(activeHoldings, baseCurrency, ...)`) becomes
    `accountTotal(activeHoldings, account.currency, baseCurrency, rateTable, now, priceBook)`.
    Before the account row loads, it falls back to `baseCurrency`, as the screen's other
    account-dependent reads do.
  - `EntityAmountHeader` takes `money={total}` and
    `secondary={<ConvertedCaption money={inBase} testID="account-detail-converted" />}`.
  - `CurrencyBreakdown` stays unchanged.
- Modify: `src/screens/account-detail/account-detail.screen.test.tsx` (2741 lines). The `account()`
  fixture defaults to `currency: 'UAH'`. Add three new cases only; it must pass `dup.sh` alone.

**Interfaces consumed:** `accountTotal` (`@kiko/rates/net-worth-view`) and `ConvertedCaption`
(`@kiko/design-system/components/converted-caption`), both from task 3/6.

**Existing tests that pin the base headline:** all STAY unchanged, because the fixture's
`currency: 'UAH'` equals its base `UAH`.
- "shows the holding balance as money" (`1,000.00 ₴`)
- "shows the overall converted balance and a per-currency breakdown" (`multiCurrencyData`,
  `3,000.00 ₴`)
- "renders a positive overall balance in the balance tone" (`3,000.00 ₴` is `text-tone-textPrimary`)
- the matured-deposit tests (`1,077.00 ₴`)
- "shows a loading spinner, not the zero-balance content ..." (`0.00 ₴`)

"hands the offer the account and settings rows the page already read" passes `account({ kind:
'cash' })` as is, and still passes once the fixture carries `currency`.

- [ ] **step 1/4: failing tests.**
  - `multiCurrencyData` with `account({ currency: 'USD' })`: the headline shows `$75.00` (UAH
    1,000 / 40 + $50), and `account-detail-converted` shows `3,000.00 ₴`. The breakdown still lists
    `1,000.00 ₴` and `$50.00`.
  - The same data with `currency: 'UAH'`: no `account-detail-converted`.
  - `account({ currency: 'BTC' })` with one BTC holding and no BTC rate: the headline shows the BTC
    amount, there is no caption, and nothing throws.

  Run `npx jest src/screens/account-detail/account-detail.screen.test.tsx`: the new cases FAIL.
- [ ] **step 2/4: implement** as described under Files. Re-run: every case passes, and the pins
  above are unchanged.
- [ ] **step 3/4: typecheck + scoped run.** Run `npm run check:typecheck` and
  `npx jest src/screens/account-detail src/rates/net-worth-view`.
- [ ] **step 4/4: commit.** `feat(account-detail): the headline totals in the account currency`.

**Checks:** new cases red then green; the base-headline pins unchanged; `dup.sh` on the test file;
`check:screen-imports` (the caption comes from the design system, not from `src/screens/accounts`).

---

### account-currency task 5/6: the currency field on the account form (non-implicit kinds)

**Files (floor):**
- Modify: `src/screens/forms/account-form/account-form.screen.tsx`:
  - `accountCurrency` state, with the draft round trip;
  - the field for non-cash create and for edit of every non-implicit kind;
  - `{ kind: 'any' }` groups;
  - the hint;
  - hydration from `editingAccount.currency`;
  - `currency` in the edit patch and in `accountRow()`.
- Modify: `src/navigation/types/types.d.ts` (`AccountFormDraft.accountCurrency: Currency | null`)
- Modify: `src/i18n/locales/en.ts`, `src/i18n/locales/uk.ts` (`forms.account.currencyHint`, spec D8)
- Create or modify tests: a focused `account-form.account-currency.test.tsx`, or a few cases in
  `account-form.screen.test.tsx` (the developer picks the one that passes `dup.sh` alone)

- [ ] **step 1/5: failing form tests.**
  - Create bank: the field shows the base (USD from settings); a pick of EUR, then Save, calls
    `saveFormAccount` with `currency: 'EUR'`.
  - Create crypto, Connect, then pick BTC and Save: `saveFormAccount` gets BTC.
  - Create cash: exactly one `account-currency-field`; the cash pick reaches `createCashAccount`.
  - Edit a cash account to EUR: `accountsRepo.update` is called with `{ name, color, currency: 'EUR' }`,
    and no holdings or transactions repo call is made.
  - Edit a synced bank: the field is enabled and saves.
  - Edit an implicit property account: no `account-currency-field` (task 6/6 adds it).
  - The hint renders except on cash create.
  - Kind switch cash -> bank shows the base, not the cash pick.

  Run `npx jest src/screens/forms/account-form`: it FAILS.
- [ ] **step 2/5: implement** (spec D5). The field and hint render under the kind field, before
  the bank/crypto sync sections.
- [ ] **step 3/5: i18n.** Add the key in en and uk. Run
  `npx jest src/i18n/locales src/screens/forms/account-form`. The casing and full-stop suites pass,
  and there is no `TITLE_KEYS` change.
- [ ] **step 4/5: typecheck + scoped run.** Run `npm run check:typecheck` and
  `npx jest src/screens/forms src/navigation`.
- [ ] **step 5/5: commit.** `feat(account-form): pick the account currency on create and edit`.

**Checks:** form tests red then green; i18n parity, casing and full-stop suites; typecheck.

---

### account-currency task 6/6: implicit accounts follow their currency (spec Q4 = A, orchestrator default)

Drop or trim this task if the coordinator rules Q4 = B or C.

**Files (floor):**
- Modify: `src/screens/accounts/accounts.screen.tsx` (`propertyTotal`/`debtsTotal` through
  `accountTotal` with the implicit account's currency; `renderHoldingSection` renders `AccountTotal`
  with `property-total-converted` / `debts-total-converted`)
- Modify: `src/screens/forms/account-form/account-form.screen.tsx` (show the field on an implicit
  edit)
- Modify tests: `accounts.screen.test.tsx` (a few cases), the account-form currency test file

- [ ] **step 1/4: failing tests.**
  - A property account in USD with UAH items and a rate: the section total is in `$`, with
    `property-total-converted` in `₴`.
  - A debt account in base: no caption, and the existing totals are unchanged.
  - An edit of an implicit property account shows `account-currency-field` and saves `currency`.

  Run `npx jest src/screens/accounts src/screens/forms/account-form`: it FAILS.
- [ ] **step 2/4: implement.**
- [ ] **step 3/4: scoped run + typecheck.**
- [ ] **step 4/4: commit.** `feat(accounts): property and debts totals follow their account currency`.

**Checks:** tests red then green; existing section-total pins unchanged; heading a11y test (it reads
the total) re-checked.

---

## After the last task (coordinator)

- `make verify` once, queued, until green. `make deep` per task with its own base.
- Device check: the cards, the captions, the account-detail headline in the account currency
  with its caption (Q3), and the form on create and edit (cash edit display-only).
- Skill drift (`kiko:retrospect`, then `kiko:scribe`):
  - kiko-architecture "Storage": a 0062 bullet (add + backfill in one migration, open-only rule,
    `UPDATE ... FROM`).
  - kiko-architecture "Data transfer": `withAccountCurrencyDerived` with the file-level presence
    check and its order after the implicit merge; version 5 and its `VERSION_DECISIONS` reason;
    `assertKnownCurrencies` reads `accounts.currency`.
  - kiko-architecture "A create writes everything": add the currency.
  - kiko-domain "The three levels" Account bullet: `currency` is fixed and display-only, never
    re-derived after 0062 except on an old-file restore, and never follows the base.
  - kiko-domain "Net worth": the card and the account-detail headline use the account currency
    with a base caption; Home stays in base.
  - kiko-pricing: `accountTotal` next to `guardedNetWorth`/`canConvert`.
  - kiko-design-system: the shared `ConvertedCaption` (account card, account-detail header)
    beside the holding card's own caption.
  - kiko-compliance demo fixture: regenerated at version 5.
- The user reviews `forms.account.currencyHint` (en/uk) before the deploy.
