---
name: kiko-domain
description: Invoke whenever you touch the domain model — the Account/Holding/Transaction schema, the Money value object, currency codes, or net worth calculation. Read before writing a Drizzle table, a repository, a form, or any code that handles an amount.
---

# Kiko domain model

Source of truth: `docs/superpowers/specs/2026-08-30-kiko-foundation-design.md`
("Domain model" section). This skill summarizes the settled contract;
if the two ever disagree, the spec wins and this skill needs updating.

## The three levels

`Account -> Holding -> Transaction`, plus supporting tables. **The
enumerated `{ enum: [...] }` column values below (`kind`, `type`,
`currency`, `source`) drift — a kind gets added or removed in code
without this skill being updated in lockstep (this happened: `broker`
was once a valid `Account.kind` and was later dropped). Do not trust
an enum list copied into this prose as current. Read
`src/db/schema.ts` directly for the live `sqliteTable` column
definitions before relying on a specific member being present or
absent** — this skill states the shape and non-enum facts only:

- **Account** — a bank, cash stash, or crypto wallet. `id`, `name`,
  `kind` (see `schema.ts`'s `accounts.kind` enum for the current
  member set), `institution` (nullable, e.g. `monobank`), `icon`,
  `color`, `sortOrder`, `archivedAt` (nullable), `createdAt`.
- **Holding** — a balance-bearing thing under an account (a card, a
  jar, a term deposit, a crypto asset). `id`, `accountId` (FK),
  `name`, `type` (see `schema.ts`'s `holdings.type` enum), `currency`
  (see `schema.ts`'s `holdings.currency` enum), `icon`, `color`,
  `balanceMinorUnits` (integer), `metadata` (JSON: masked PAN, IBAN,
  deposit rate, maturity, Monobank account/jar id), `sortOrder`,
  `closedAt` (nullable), `createdAt`.
- **Transaction** — a movement against a holding. `id`, `holdingId`
  (FK), `amountMinorUnits` (signed integer), `time` (unix
  milliseconds), `description`, `category` (nullable), `mcc`
  (nullable), `hold` (nullable boolean — Monobank's pending-
  authorization flag, whose settled amount can still change; null on
  a manual row), `comment` (nullable), `source` (see `schema.ts`'s
  `transactions.source` enum), `externalId` (nullable, unique per
  source — the key a re-imported Monobank statement item is upserted
  on), `createdAt`.

  Re-syncing an existing `externalId` **refreshes** that row's
  bank-owned columns — the settled `amountMinorUnits` and `hold`
  among them — and **never** its `category` (the user's override, or
  a name rule's rewrite) or `comment`. Read `addManyDedup` in
  `src/repositories/transactions.repo.ts` for the exact refreshable
  set, and `transactions.hold` in `src/db/schema.ts` for why a
  pending item is imported at its provisional amount at all, rather
  than trusting a column list restated here.
- **CurrencyRate** — cache of the latest known conversion rate.
  `base`, `quote`, `rate` (a scaled integer or text — never a raw
  float, to avoid drift), `source` (see `schema.ts`'s
  `currencyRates.source` enum), `fetchedAt`. A sibling table,
  `currencyRateHistory`, additionally keeps one row per
  (base, quote, day) for the historical net-worth chart — read
  `schema.ts` directly, this skill does not restate its columns.
- **Settings** — single row: `baseCurrency`, `lastSyncAt`
  (nullable). The Monobank token is never stored here — see
  `kiko-architecture` for the Keychain rule.

A manual balance adjustment always writes a `manual` Transaction, so
a holding's balance history stays derivable from its transactions.
This is not a convention a caller is trusted to remember — three
repository functions enforce it, and every balance a USER sets goes
through one of them:

- **An edit**: `holdingsRepo.updateWithBalanceDelta`
  (`src/repositories/holdings.repo.ts`) writes the patch AND, when
  `balanceMinorUnits` differs from the stored value, the DIFFERENCE as
  a `manual` row — one `db.transaction()`, delta computed from the row
  re-read inside it (never a render snapshot), no row at all for a zero
  delta. The holding form's edit save calls this, never
  `holdingsRepo.update`, whose bare `set(patch)` stays for the
  non-balance writers (icon/color/metadata, the sync's own writes,
  reorder) and must never be handed a `balanceMinorUnits`.
- **A new holding's opening balance**: `holdingsRepo.create`
  (`src/repositories/holdings.repo.ts`) seeds the same kind of row for
  a non-zero `balanceMinorUnits`, in the transaction that inserts the
  holding. Zero seeds nothing.
- **A new cash account's opening balance**: `accountsRepo.createCashAccount`
  (`src/repositories/accounts.repo.ts`) does the same for its first
  holding, in the transaction that inserts the account and that
  holding.

Why it matters concretely: `holdingValueAt`
(`src/statistics/holding-value-at.ts`) back-derives a holding's opening
balance as `currentBalance - sum(allTransactions)`, so a balance written
without its ledger row retroactively shifts the ENTIRE historical
net-worth series by that amount, and the holding-detail transaction list
stops reconciling with its own displayed Value. None of the three routes
through `transactionsRepo.recordManual` (which would apply the amount to
the balance a second time), and none persists a description or a
category — the label resolves at render time (see the exchange section
below and `src/transactions/row-description.ts`). A null category folds
onto `settings.defaultCategoryKey`, so a downward correction counts as
spending like any other uncategorised manual row; that is a RULED
decision (the row is editable), not an oversight to be quietly patched.

A SYNC-owned balance is the exception and writes no ledger row: the
provider owns that number (`upsertByMetadataKey` in
`holdings.repo.ts`), and the form hides the balance field for a synced
holding entirely.

## Sync-only holding types are not manually creatable

Some `Holding.type` members are owned exclusively by the Monobank sync
pipeline (`src/monobank/sync.ts`, which creates those rows
programmatically) and must never appear as an option on the manual
create form — a bank's create form offers only the remaining,
non-sync types. Per Layer 2, this rule's exact type membership is not
restated here: read `src/holdings/holding-type.ts`
(`syncOnlyHoldingTypes`, `isSyncOnlyHoldingType`,
`creatableHoldingTypesForAccountKind`) for the current sync-only set
and the derived creatable-per-account-kind set, and cross-check
against `sync.ts` for which types it actually writes.

## Entity glyphs: one source of truth

The default SF Symbol for an `Account.kind` and for a `Holding.type`
each has exactly one source of truth: `src/holdings/entity-symbols.ts`
(`accountKindSymbol`, `holdingTypeSymbol`). Every reader — the account
card, the account-detail header, the Kind select, the holding card,
the holding-detail header, the holding-form icon-chip fallback, the
Type select — calls that same function; never add a second kind/type
-> glyph map in a screen module. A past `holding-icon.ts` plus a
screen-exported `KIND_ICON` drifted from this file, so the icon a user
picked in a select differed from the card glyph.

## The `Money` value object

`Money` is the one place amounts are OOP (see `kiko-code-style` for
why this is the deliberate exception to functional-first). It holds
`{ currency, minorUnits }` and is immutable.

- `minorUnits` is always an integer. **Never a float.** Scale is
  per-currency: `BTC` uses 8 decimals (satoshis); `USD`, `EUR`, and
  `UAH` use 2 (cents).
- The value object itself — construction, arithmetic, and the
  currency-mismatch guard — lives in `src/currency/money.ts`. Read it
  directly for the current method set rather than trusting a list
  restated here; it drifts (this skill once claimed `Money` had
  `convert`/`format`/comparison methods it does not have).
- Converting a `Money` to a different currency is not a `Money`
  method — that owns a separate concern and lives in `src/rates`.
  Read that directory for the current conversion entry point.
- Formatting a `Money` for display is not a `Money` method either —
  that owns a separate concern and lives in
  `src/currency/format.ts`. Read it for the current formatting entry
  point.
- Any table column holding an amount is an integer minor-units
  column (`balanceMinorUnits`, `amountMinorUnits`), never a decimal
  or float column. Convert to/from `Money` at the repository
  boundary.

## Currencies

A small closed set (`BTC` at scale 8, everything else at scale 2) —
read `schema.ts`'s `currency`/`baseCurrency` enum for the exact
current member list rather than trusting a count restated here. Map a
currency code to its scale with `ts-pattern`'s exhaustive `match` — a
currency literal type, not a free string, so adding a currency is a
compile error everywhere the mapping is missing.

Monobank statement currencies arrive as ISO 4217 numeric codes
(`980` = UAH, `840` = USD, `978` = EUR); map them to our currency
literal with `ts-pattern` at the sync boundary, never store the raw
numeric code.

## Category color resolution

A category's display color is never read as a raw
`category.color ?? undefined` at the call site — every renderer
(chart legend, chart slice, filter chip, transaction-row icon)
resolves it through `resolveCategoryColor(storedColor, key)`
(`src/statistics/category-breakdown.ts`), which falls back to a stable
per-key palette hash when no color is stored. The raw-fallback pattern
renders gray for an uncolored category while a chip for that same
category shows a palette hue — a past transaction-row icon regressed
this way.

The ten categories `0002_seed_categories.sql` seeds do NOT rely on that
hash fallback in practice: migration `0017_seed_category_colors`
(`drizzle/migrations/`) gives each seeded key an explicit, distinct
`categories.color` — one `theme.colors.entityColors` member per key,
guarded `WHERE color IS NULL` so it never overwrites a color the user
already picked, and safe to re-run. It exists because the hash, run
over those exact ten keys against the 8-entry `chartSeries` palette,
collapses to five hues (four categories rendered an identical blue
donut wedge before the seed). The per-key hash fallback above is real
and still exercised — a user-created category with no chosen color
still falls through to it — but for the seeded ten it is a fallback
that normally never fires.

The `key` handed to it is never a raw stored value. A stored category
resolves through `resolveCategoryKey` / `resolveCategoryDisplay`
(`src/categories/category-display.ts`): lowercased, with a null, empty,
or unknown-to-the-categories-table slug folding onto the **default**
key (`settings.defaultCategoryKey`, read at the call site — never a
separate "uncategorized" bucket). One fold, one place: the spending
breakdown's `groupKey`, Home's `categoryKeyForRow`, and every color
lookup all go through it, so a category can never render under two
keys — and therefore two hues — at once.

Writers hold up the other end: a category value is persisted only as
the lowercase `categories.key` slug. `categoryForMcc`
(`src/monobank/mcc-category.ts`) emits the slug, not a display title,
and migration `0014_lowercase_categories` lowercased the legacy rows a
capitalized-title era had already written. Because neither
`transactions.category` nor `category_overrides.category` is COLLATE
NOCASE, `categoriesRepo.delete`'s reassignment additionally compares
case-insensitively on both sides (`lower(column) = lower(key)`), so an
un-migrated row from an older build still gets folded onto the default
instead of being orphaned on a deleted slug.

## Spending-exclusion pipeline

An internal money movement (cash-out, own-account transfer, one leg of
a same-user transfer between holdings, an Exchange/Convert leg) is
excluded from the spending view — read
`src/statistics/transfer-exclusion.ts` (MCC/description based, backed by
`transactions.counterIban` and `settings.defaultCategoryKey`),
`src/statistics/internal-transfers.ts` (the matched-pair fallback), and
`src/statistics/exchange-exclusion.ts` (the exchange-marker rule)
directly rather than trusting a restated MCC list here; see
`kiko-architecture` for the same pointer.

## Exchange/Convert legs: a structural marker, a resolved label

An Exchange/Convert leg is NOT identified by its description. Both legs
carry the counterpart holding's id in a dedicated column — read
`src/db/schema.ts` (`transactions.exchangeCounterpartHoldingId`, whose
comment records why it is a column rather than a reserved `category`
value or a shared `externalId`) and `src/repositories/transactions.repo.ts`
(`recordExchange` / `recordExchangeCounterpart`, which write it on both
legs inside the one transaction; an exchange into a term deposit writes
the marker on its single debit leg). Three consequences hold together:

- The marker is what the spending view excludes on
  (`src/statistics/exchange-exclusion.ts`): no other rule can see these
  rows — a null `mcc`, an empty description, and a cross-currency pair
  the matched-pair matcher rejects.
- **The repository never writes a description for a leg.** The label is
  resolved at render time through `t` from the marker plus the
  counterpart's CURRENT name (a description the USER later types on that
  row still wins — the resolver prefers a stored one) — `src/transactions/exchange-description.ts`, applied by both
  transaction lists via `src/transactions/row-description.ts`. A
  persisted sentence stayed English after a language switch and went
  stale after a rename; that is the bug the column exists to prevent.
- A repository input therefore carries holding IDs, never holding
  display names, for an exchange.

## App lock / security settings

`settings.lockEnabled` is LIVE — wired through `src/auth/use-app-lock.ts`
and the `AppLockSetting` component
(`src/screens/settings/app-lock-setting/`). `settings.lockGraceSeconds`
is LEGACY/DEAD: it defaults to 30 and has no reader anywhere in `src/`
(a grace-period-after-backgrounding design was built, then replaced
with a cold-launch-only lock; the column was intentionally left in
place rather than dropped via a migration). Treat it as legacy — do
not re-wire it without a deliberate decision to resurrect the grace
period, and re-check `src/db/schema.ts` before relying on this
description if the lock design changes again.

## Net worth

Net worth is **assets-only** — liabilities and debt are out of scope
for this sub-project. It is the sum of every non-archived holding's
balance, each converted to the user's selected base currency (stored
in `Settings.baseCurrency`) using the latest cached `CurrencyRate`.
An archived account's or closed holding's balance is excluded. The
headline total (`guardedNetWorth`) and the per-currency breakdown
shown beneath it (`guardedBreakdown`) share one `canConvert` filter
in `src/rates/net-worth-view.ts`, so a currency with no cached rate
(e.g. BTC on a first run, before any sync) is dropped from both —
never included in the breakdown after being excluded from the total.
