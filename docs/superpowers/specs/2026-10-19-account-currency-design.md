# Account currency: design

Track: account-currency (release 1.3). Base: main 841b1ab7.
Source: `memory/refs/brief-account-card-currency.md` (user request 2026-10-18, rulings 1-7, the
defaults the user confirmed 2026-10-18). Rulings 4-7 replace ruling 1 as the data model. Ruling 1's
"one currency, several or none" rule survives only as the ONE-TIME backfill rule.

Every code fact here names a symbol, not a line. Re-grep each one on the actual base before you
rely on it. Every count is a floor.

## Goal

Every account stores its own fixed currency. The account card shows the account's total in that
currency, with today's rates. When that currency is not the base currency and a rate exists, a
smaller base-currency caption sits under the total. The user can pick the currency for every
account kind, on create and on edit. A currency change only changes what the screen shows: no
holding, transaction or amount is rewritten (ruling 7).

## Decisions

### D1. Schema: `accounts.currency`

- The column is `currency: text('currency', { enum: currencyOptions }).notNull().default('UAH')`
  on `accounts` in `src/db/schema.ts`. It has the same name and enum source as
  `holdings.currency`.
- Rule: NOT NULL, because every account has a currency after the backfill and every write path sets
  one. The SQL `DEFAULT 'UAH'` exists only because SQLite cannot `ADD` a NOT NULL column without a
  default. It matches `settings.base_currency`'s own default.
- Production write paths never rely on the default. `NewAccount` in `accounts.repo.ts` makes
  `currency` required (D4), so a missed path fails `tsc`. Raw-SQL and Drizzle test seeds (78 test
  files insert accounts directly: a floor) keep working through the default.
- Cost if wrong: a production path that bypasses `NewAccount` gets a silent `'UAH'`. Only
  `accounts.repo.ts`, `restore-snapshot.ts` and `0044` insert accounts in production code (grep
  below). D4 and the repo tests close that path.

### D2. Migration 0062 `0062_add_account_currency.sql`: add and backfill ONCE

- Generate the `ALTER` with `npx drizzle-kit generate --name add_account_currency`. Then
  hand-append two `--> statement-breakpoint` statements, in this order:
  1. `UPDATE accounts SET currency = COALESCE((SELECT base_currency FROM settings WHERE id = 1), 'UAH')`
     sets every account to the base currency.
  2. `UPDATE accounts SET currency = single.currency FROM (SELECT account_id, MIN(currency) AS
     currency FROM holdings WHERE closed_at IS NULL GROUP BY account_id HAVING COUNT(DISTINCT
     currency) = 1) AS single WHERE single.account_id = accounts.id` gives each account whose open
     holdings share one currency that currency.
- The rule (ruling 1, as ruling 5 applies it): an account whose OPEN holdings (`closed_at IS NULL`)
  all share one currency gets that currency. An account with several currencies, or with no open
  holding, gets `settings.base_currency` (fallback `'UAH'` when there is no settings row). The rule
  applies to every account: archived, implicit (property/debt), synced, and the `crypto-from-`
  accounts 0044 created.
- Why open only: the card already sums only open holdings (`holdingsByAccount` in
  `accounts.screen.tsx` skips `closedAt != null`). "The account's holdings" is what the card shows.
  See Open question Q1.
- Crash-safe and additive: no delete, no temp table. `run-migrations.ts` applies the three
  statements and their bookkeeping row in ONE transaction, so a crash rolls back to 0061 and the
  whole migration retries. SQL string literals are single-quoted (`SQLITE_DQS=0`). `UPDATE ... FROM`
  has a precedent in 0052.
- One grouped scan of `holdings`, not a correlated subquery per account: run-log gap
  `20261015T1657-kiko-binance-backfill-fix/2` (unkeyed lookups). The migration test pins the plan
  with `EXPLAIN QUERY PLAN`: `holdings` is scanned once, and the plan has no `CORRELATED` subquery
  on `holdings`. The developer measures the plan text and pins the plan they measure. No index is
  added.
- Test: `drizzle/migrations/0062-add-account-currency.test.ts` seeds a `node:sqlite` database
  through `applyMigrationsThrough(db, '0061_exchange_state')`, runs the shipped 0062 SQL, and covers
  these cases: one currency, mixed currencies, empty, all holdings closed, one open EUR plus one
  closed USD, archived, implicit property, a `crypto-from-` account, no settings row, and a base of
  `USD`. `applyAllMigrations` must also run clean on an empty database.
- Cost if wrong: every existing account's card shows a currency the user did not expect. That is
  visible, not money loss, and the user can fix it per account in the form.

### D3. Restore mirror, back-compat, and EXPORT_VERSION

- New pure step `withAccountCurrencyDerived` in
  `src/data-transfer/snapshot/with-account-currency-derived.ts` (beside `with-walk-state-moved.ts`).
  It is called from `restoreDataSnapshot` AFTER `withImplicitAccountsMerged` and before inserting,
  because a live device runs 0062 after 0044 and 0050. Its input is `accountsToInsert`,
  `holdingsAfterImplicitMerge` and the file's settings row (`baseCurrency`, or `'UAH'` when there
  is no row, which matches the restored row's schema default).
- Presence check (the `Object.hasOwn` rule): the check is FILE-LEVEL. When no account in the file's
  own `snapshot.accounts` has an own `currency` key, every account to insert is derived, including
  the `crypto-from-` accounts that `withCryptoCashHoldingsMoved` added. Otherwise every account
  keeps the currency it was exported with. The check is per file, not per row, because
  `withCryptoCashHoldingsMoved` builds a new `AccountRow`, and that row must carry a `currency` key
  to type-check. Copy `source.currency`: it is undefined at runtime for a pre-0062 file and is
  replaced by the derive step. A per-row `Object.hasOwn` would see that key and skip the derive.
  A 0062+ build always exports the key on every account (`readDataSnapshot` selects every column),
  so mixed files do not occur.
- The SQL and JS rules share one pure function, `accountCurrencyOf(holdings, baseCurrency)`, in
  `src/accounts/account-currency/` (barrel `@kiko/accounts/account-currency`). It counts holdings
  with `closedAt == null` (null or absent), and returns the one distinct currency or the base. The
  demo builder uses the same function.
- Two-path test: `src/data-transfer/snapshot/restore-account-currency.two-path.test.ts`, shaped
  like `restore-walk-state.two-path.test.ts`. One seed on a database through 0061. Path 1 runs the
  two 0062 backfill statements. Path 2 runs only the `ALTER`, exports with `readDataSnapshot`,
  deletes `currency` from every account row, and restores into a fresh `applyAllMigrations`
  database. Compare `accounts` sorted by id. The seed also holds a 1.0-era crypto `cash` holding,
  so a `crypto-from-` account is derived on both paths.
- `assertKnownCurrencies` also reads `snapshot.accounts` `['currency']`: a file from a newer build
  holding an unknown code is refused, as holdings are.
- **EXPORT_VERSION goes to 5** (user ruling 4: "format version bump + back-compat for older
  files"). `READABLE_EXPORT_VERSIONS` becomes `[1, 2, 3, 4, 5]`. A new `VERSION_DECISIONS` entry
  states the reason. The column carries the user's own pick, and an older build restoring the file
  would silently drop it. After its own later upgrade it would re-derive a different currency by
  the rule, so the older build refuses the file by its version. `migrationCount: 63`. The
  architecture skill's default (a column riding in a row and derived on restore needs no bump)
  points the other way: see Q2. The derive step is presence-gated, not
  version-gated, so either outcome of Q2 needs no code change beyond `envelope.ts` and the test.
- Demo `.kiko` regeneration: `KIKO_REGEN_DEMO=1 npx jest e2e/screenshot/fixtures/generate-demo-kiko.test.ts`,
  then the same command without the variable. `build-demo-snapshot.ts` sets each account's
  `currency` through `accountCurrencyOf` over its open holdings, with `dataset.baseCurrency`.
  `kiko-demo-en-1.1.kiko` stays frozen. `import-data.back-compat.test.ts` gains an assertion that
  its accounts come back derived.
- Cost if wrong: a restored older file's cards differ from the same data upgraded in place. The
  two-path test catches that.

### D4. Every write path that creates an account sets the currency

Production inserts into `accounts` at the base: `src/accounts/accounts.repo.ts`,
`src/data-transfer/snapshot/restore-snapshot.ts`, and `drizzle/migrations/0044_move_crypto_cash_holdings.sql`
(`src/test-support/delete-cascade-fixture.ts` is test support and relies on the default). This is
a floor: re-grep `insert\((schema\.)?accounts\)|INSERT (OR [A-Z]+ )?INTO "?accounts`.

| Path | Writes |
|---|---|
| `accountsRepo.createCashAccount` (form, cash create) | `currency` = the cash pick (the same value as the holding currency) |
| `accountsRepo.saveFormAccount` (form Save, non-cash create; also updates a row a Connect inserted) | `input.currency` (required `Currency | null`) = the form's raw pick; `null` = base read inside the write on insert. The update branch leaves `currency` on `null` and writes a non-null pick, so a pick made after Connect is kept |
| `accountsRepo.createIfAbsent` (Monobank/Binance/wallet Connect from the form) | `input.currency` = the form's raw pick at Connect (`null` = base read inside the write). A later Save writes the final pick (row above) |
| `accountsRepo.create` (no production caller at the base, tests only) | `input.currency` (required in `NewAccount`) |
| `insertImplicitAccount` via `accountsRepo.createImplicitHolding` (holding form, property/loan) | base currency read INSIDE the write (`settings.baseCurrency` where `id = SETTINGS_ID`, fallback `'UAH'`) |
| migration 0044 `crypto-from-` accounts | shipped and never edited (check:shipped-migrations). On a device they predate the column, so 0062's backfill sets them |
| `withCryptoCashHoldingsMoved` (restore) | copies `source.currency`, then `withAccountCurrencyDerived` replaces it (D3) |
| `restoreDataSnapshot` insert | the file's value, or the derived value for a pre-0062 file (D3) |
| demo `build-demo-snapshot.ts` | `accountCurrencyOf(open holdings, dataset.baseCurrency)` |

`NewAccount` adds `currency` as a required `Currency | null`. `accountsRepo.update` keeps `Partial<AccountRow>`, and
the edit form passes `currency` in its patch (D5).

### D5. Account form picker

- One field for the account currency, `CurrencyField`, testID `account-currency-field` (the testID
  the cash field already has), label `forms.fields.currency`, sheet title
  `forms.fields.currencySheetTitle`. Both keys exist already, and the sheet title is already in
  `TITLE_KEYS`.
- Cash create: one field, so the account currency and the cash currency cannot drift apart. The
  existing cash field (`currency` state, `CASH_CURRENCY_CONTEXT` fiat groups, seed `'UAH'` as
  today) sets both the holding currency and `accounts.currency` (D4 row 1). No second field
  renders.
- Create for any other non-implicit kind (bank, crypto, metals, broker): the field is bound to a
  new state, `accountCurrency: Currency | null`. `null` means untouched, and the shown value is
  `accountCurrency ?? baseCurrency`, read from `settingsRepo.getQuery()` (display only). The write
  gets `accountCurrency` itself (`null` when untouched), never `accountCurrency ?? baseCurrency`.
  The picker groups use context `{ kind: 'any' }` (held, fiat, crypto).
- Edit, every kind: the field is seeded from the stored `editingAccount.currency` in the one-shot
  hydration effect, uses `{ kind: 'any' }` groups, and the edit patch
  (`accountsRepo.update(editId, {...})`) carries `currency` only when the user changed it. For a cash account the edit is DISPLAY
  ONLY (ruling 7): the patch touches `accounts.currency` alone and never the cash holding, a
  transaction or an amount.
- A hint under the field on every render except cash create: new key `forms.account.currencyHint`.
- Synced accounts (Monobank, Binance, wallet): the field is editable. Only the display changes, and
  the sync never reads `accounts.currency`.
- Implicit accounts (property, debt) are reached as Accounts screen section heading -> their
  `AccountDetail` -> the Edit bar item (`navigation.navigate('AccountForm', { accountId })`) -> the
  account form in edit mode. The field shows there in task 6/6, together with the section total that
  uses it (Q4). Task 5/6 hides it for implicit kinds, so no task tip shows a field with no effect.
  The account-detail headline (task 4/6) already follows the stored currency of an implicit
  account before task 6/6, from the migrated value. That is the same display rule as every other
  account, not a field without an effect.
- `AccountFormDraft` (`src/navigation/types/types.d.ts`) gains `accountCurrency: Currency | null`.
  A draft without the key reads `null`.
- No money data is rewritten anywhere: no path writes `holdings.currency`, `balanceMinorUnits` or
  `transactions` because of an account currency.

### D6. The card

- The pure helper `accountTotal(holdings, accountCurrency, baseCurrency, rates, now, book): {
  total: Money; inBase: Money | null }` lives in `src/rates/net-worth-view/` and is exported from
  its barrel.
  - `total = guardedNetWorth(holdings, accountCurrency, rates, now, book)`. It reuses the existing
    `rateBetween`/`canConvert` path, and a holding with no rate to the account currency is left
    out, as the base total does today.
  - `inBase = accountCurrency !== baseCurrency && canConvert(accountCurrency, baseCurrency, rates) ?
    guardedNetWorth(holdings, baseCurrency, rates, now, book) : null`. The caption is the same
    base figure the card shows today, which is what Home sums for these holdings. It is not a
    second conversion of `total` (Q5).
- The caption is the shared design-system view `ConvertedCaption` in
  `src/design-system/components/converted-caption/` (props `{ money: Money | null; testID:
  string }`). It renders nothing for `null`; otherwise it renders `Text variant="caption"
  tone="textSecondary"` with `formatMoney(money, activeLocale())`, the holding card's caption
  pattern. It lives in the design system, not under `src/screens/accounts/`, because the account
  detail screen uses it too and a cross-screen import fails `check:screen-imports`.
- The view `AccountTotal` in `src/screens/accounts/account-total/` renders `MoneyText`
  (`context="balance"`) with `ConvertedCaption` under it. Its `convertedTestID` prop names the
  caption.
- Main grid card (`renderAccountCard` in `accounts.screen.tsx`): the caption's testID is
  `account-card-converted`.
- A one-currency BTC account with no BTC rate showed 0 today and now shows its BTC sum with no
  caption.
- The account-detail headline follows the account currency (USER RULING Q3 = B, 2026-10-19). In
  `account-detail.screen.tsx`, `overallBalance` becomes `accountTotal(activeHoldings,
  account.currency, baseCurrency, rateTable, now, priceBook)`: the same helper as the card, not a
  new conversion. `EntityAmountHeader` shows `total`, and its existing `secondary` slot shows
  `<ConvertedCaption money={inBase} testID="account-detail-converted" />`. The caption appears
  only when the account currency differs from the base and a rate exists. The per-currency
  `CurrencyBreakdown` under it is unchanged. A card and its detail page always show the same total
  and caption.
- Stays in base (checked at 841b1ab7):
  - the Home total (`home.screen.tsx`, `guardedNetWorth(active, baseCurrency, ...)`)
  - the holding card caption and the holding-detail caption (`ValueHeaderSecondary`, left as it
    is)
- The Property and Debts section totals follow their implicit account's currency in task 6/6, with
  caption testIDs `property-total-converted` and `debts-total-converted` (Q4; the brief listed them
  as staying in base).
- Fix the stale sentence in the `HoldingCard` header comment, "the account card already shows the
  base currency": the account card now shows the account's own currency.

### D7. Fixed currency

A later base-currency change (`settingsRepo.setBaseCurrency`) never changes a stored
`accounts.currency` (ruling 5). Adding holdings in other currencies does not change it either. A
real-SQLite repo test pins both. No code path recomputes the rule after 0062, except the restore of
a pre-0062 file.

### D8. i18n

| Key | en | uk | Role / casing |
|---|---|---|---|
| `forms.account.currencyHint` | `The account card shows its total in this currency. Holdings keep their own currencies.` | `Картка рахунку показує суму в цій валюті. Активи зберігають свої валюти.` | Hint, sentence case, final "." |

No new title key: the field reuses `forms.fields.currency` and `forms.fields.currencySheetTitle`
(already in `TITLE_KEYS`). The user reviews the new key before a deploy (kiko-translator "Review
new/changed keys before a shipping deploy").

### D9. Tests that pin base text today (`src/screens/accounts/accounts.screen.test.tsx`)

`setLiveData` defaults every fixture account to `currency: 'UAH'` (the base in every fixture).
With that default every current pin STAYS:

- "renders an active account with its name and balance" (`1,000.00 ₴`)
- "reflects term-deposit growth in total net worth" (`1,077.00 ₴`)
- the Debts and Property section-total tests ("shows a Debts section total ...", "renders a
  Property section with ... its own section total", "keeps the Debts total stable ...")
- the heading-row a11y test that reads the total

`src/screens/account-detail/account-detail.screen.test.tsx`: the `account()` fixture helper
defaults to `currency: 'UAH'` (the base in every fixture). With that default every base-headline
pin STAYS:

- "shows the holding balance as money" (`1,000.00 ₴`)
- "shows the overall converted balance and a per-currency breakdown" (`3,000.00 ₴`)
- "renders a positive overall balance in the balance tone" (`3,000.00 ₴`)
- the matured-deposit tests (`1,077.00 ₴`)
- the loading-gate test (`0.00 ₴`)

New cases are added (task 3/6, task 4/6 and task 6/6). No existing assertion changes its expected
text.
Every test file with an `AccountRow`-typed literal gains `currency` for `tsc` (18 files reference
`AccountRow`: a floor; `tsc` measures).

## Scenario matrix (card)

The "was" column is ruling 1's result. Ruling 1 was superseded as the live model by rulings 4-7
and kept only as the backfill.

| Account currency | Holdings (open) | Rates | Card total | Caption | was (ruling 1 / today) |
|---|---|---|---|---|---|
| UAH = base | UAH 1,000 | any | ₴1,000 | none | ₴1,000 |
| USD, base UAH | USD 100 | USD:UAH 40 | $100 | ₴4,000 | ₴4,000, no caption |
| USD, base UAH | USD 100 + UAH 400 | USD:UAH 40 | $110 | ₴4,400 | ₴4,400 |
| UAH (mixed, migrated) | USD 100 + UAH 400 | USD:UAH 40 | ₴4,400 | none | ₴4,400 |
| BTC, base UAH | BTC 0.5 | no BTC rate | 0.5 BTC | none | ₴0 (BTC dropped) |
| BTC, base UAH | BTC 0.5 + UAH 100 | no BTC rate | 0.5 BTC (UAH has no rate to BTC: left out) | none | ₴100 |
| EUR (user-picked), base UAH | USD 100 only | USD, EUR rates | €(USD->EUR) | ₴ base total | ₴ base total |
| empty, migrated | none | any | base 0 | none | base 0 |
| empty USD, base UAH | none | USD:UAH 40 | $0.00 | 0.00 ₴ | n/a (D6: the caption shows for a non-base account with a rate, even at zero; orchestrator ruling, on the user's device-review list) |
| cash USD, edited to EUR | cash USD 100 | rates | €(converted) | ₴ | n/a; holding stays USD 100 |

## User rulings (Q1, Q3, Q4: 2026-10-19; Q2: ruling 4, 2026-10-18) and orchestrator defaults (Q5-Q7)

**Q1. Which holdings decide the backfill currency? USER RULING: A.**
Open holdings only (`closed_at IS NULL`), on every account, archived ones included. This matches
what the card sums. An account whose only foreign holding is closed gets the currency of its open
holdings.
- was: open question. Option B (open and closed holdings) was rejected.

**Q2. EXPORT_VERSION bump for 0062? A: USER RULING 4, 2026-10-18 (format version bump + back-compat).**
Bump to 5, with `READABLE_EXPORT_VERSIONS` `[1, 2, 3, 4, 5]`. Every version 4 build (1.2) refuses
every file that 1.3 writes, so a downgrade cannot silently drop the user's picks.
- was: open question. Option B (no bump, the kiko-architecture default) was rejected. Its
  `VERSION_DECISIONS` entry names this ruling.

**Q3. Account-detail headline. USER RULING: B.**
The headline follows the account currency through task 3/6's `accountTotal`, not a new
conversion. When the currency differs from the base and a rate exists, the base caption
`account-detail-converted` shows in the `EntityAmountHeader` `secondary` slot, the same rule as
the card (D6). It is implemented in task 4/6.

| Account currency | Holdings (open) | Rates | Headline was (A, 1st spec) | Headline now | Caption |
|---|---|---|---|---|---|
| UAH = base | UAH 1,000 + USD 50 | USD:UAH 40 | ₴3,000 | ₴3,000 | none |
| USD, base UAH | UAH 1,000 + USD 50 | USD:UAH 40 | ₴3,000 | $75 | ₴3,000 |
| BTC, base UAH | BTC 0.5 | no BTC rate | ₴0 | 0.5 BTC | none |

**Q4. Property/Debts (implicit) accounts. USER RULING: A.**
The section heading total acts as the implicit account's card: it follows the account currency,
with the base caption, and the field shows on the implicit edit (task 6/6).
- B (rejected): the field shows and the totals stay in base. That leaves a control with no effect.
- C (rejected): no field. That contradicts ruling 4.

- was: open question. Options B and C were rejected.

**Q5. Caption value.**
- A. `guardedNetWorth(holdings, base)`, today's figure. Consequence: it equals the account's share
  of the Home total, with no double rounding.
- B. `convert(total, base)`, the holding-card shape. Consequence: it converts through the UAH pivot
  twice, so the caption can differ from Home's sum by a minor unit.
- Recommendation: A, applied.

**Q6. Cash create default.**
- A. Keep today's `'UAH'` seed. Consequence: no change for current users.
- B. Seed the base currency. Consequence: consistent with the other kinds, but changes a pinned
  default.
- Recommendation: A (the user confirmed "cash = its chosen cash currency", not a new default).

**Q7. Picker list for the account currency.**
- A. `{ kind: 'any' }` (held, fiat, crypto) for every kind and mode except cash create. Consequence:
  one rule, and a crypto account can be BTC.
- B. Per kind (crypto first for crypto accounts, fiat only for bank). Consequence: more context
  plumbing.
- Recommendation: A, applied.

## Non-goals

- The App Store screenshot refresh: the regenerated demo changes account cards. The release track
  owns it.
- Base-currency settings, Home, Statistics, account contribution pie: unchanged.
